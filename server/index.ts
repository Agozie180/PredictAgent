/**
 * PredictAgent Signal Service — v1 heuristic model
 *
 * Endpoints (all available at /api/* as well as bare paths):
 *   GET  /health                         — service health + supported tokens
 *   GET  /prices                         — live spot prices for all tokens
 *   GET  /signal/latest?token=X          — LOCKED: returns indicator names only.
 *                                          Full signal only after on-chain payment.
 *   GET  /signal/:requestId              — Full signal for a paid, committed requestId.
 *                                          Returns 402 if not yet paid/committed.
 *   GET  /signal/backtest?token=X&...    — Walk-forward backtest results
 *   POST /signal/commit                  — Seller: lock signal to requestId
 *
 * PORT: 3001
 * Live on Arc mainnet · v1 heuristic model · Not financial advice.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, http } from 'viem'
import { fetchCandles, fetchSpotPrices, SUPPORTED_TOKENS, type SpotPrice } from './marketData'
import { computeSignal, computeCommitHash, stringToBytes32, backtestSignal, type SignalOutput } from './signal'

const PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const STORE_PATH = join(import.meta.dir, '.signal-store.json')
const SIGNAL_CACHE_TTL_MS = 10 * 60 * 1000  // 10 min

// Contract address comes from env — same value the frontend uses
const CONTRACT_ADDRESS = (process.env['VITE_CONTRACT_ADDRESS'] ?? '') as `0x${string}`

// RPC: prefer the provisioned proxy; fall back to the public Arc mainnet RPC
const RPC_PROXY_BASE = process.env['RPC_PROXY_BASE_URL']
const RPC_PROXY_TOKEN = process.env['RPC_PROXY_TOKEN']
const RPC_PROXY_CHAINS = process.env['RPC_PROXY_CHAINS'] ?? ''
const ARC_CHAIN_ID_STR = '5042'
function buildRpcUrl(): string {
  if (RPC_PROXY_BASE && RPC_PROXY_TOKEN && RPC_PROXY_CHAINS.includes(ARC_CHAIN_ID_STR)) {
    return `${RPC_PROXY_BASE}/api/rpc/${ARC_CHAIN_ID_STR}?_rpc_token=${RPC_PROXY_TOKEN}`
  }
  // Public fallback — Arc mainnet
  return process.env['ARC_RPC_URL'] ?? 'https://rpc.mainnet.arc.io' // arc-studio-allow-onchain-literal
}

// Minimal ABI fragment — only what we need to check payment status
const STATUS_ABI = [{
  name: 'getRequest',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'requestId', type: 'uint256' }],
  outputs: [{
    type: 'tuple',
    components: [
      { name: 'requestId', type: 'uint256' },
      { name: 'buyer', type: 'address' },
      { name: 'tokenSymbol', type: 'string' },
      { name: 'windowOpen', type: 'uint256' },
      { name: 'windowClose', type: 'uint256' },
      { name: 'commitHash', type: 'bytes32' },
      { name: 'revealedDirection', type: 'bytes32' },
      { name: 'revealedTargetPrice', type: 'uint256' },
      { name: 'revealedConfidenceBandBps', type: 'uint256' },
      { name: 'revealedTimestamp', type: 'uint256' },
      { name: 'revealedNonce', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'verifier', type: 'address' },
      { name: 'feePaid', type: 'uint256' },
      { name: 'outcomeRecorded', type: 'bool' },
      { name: 'outcomeCorrect', type: 'bool' },
      { name: 'buyerRevealDeadline', type: 'uint256' },
    ],
  }],
}] as const

let publicClient: ReturnType<typeof createPublicClient> | null = null
function getClient() {
  if (!publicClient) {
    publicClient = createPublicClient({ transport: http(buildRpcUrl()) })
  }
  return publicClient
}

/** Check on-chain: returns status 0=PENDING,1=COMMITTED,2+=REVEALED/SETTLED/REFUNDED or null on error */
async function getOnChainStatus(requestId: bigint): Promise<{ status: number; buyer: string } | null> {
  if (!CONTRACT_ADDRESS) return null
  try {
    const client = getClient()
    const req = await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: STATUS_ABI,
      functionName: 'getRequest',
      args: [requestId],
    }) as { status: number; buyer: string; requestId: bigint }
    if (req.requestId === 0n) return null
    return { status: Number(req.status), buyer: req.buyer }
  } catch {
    return null  // RPC failure — gate closes conservatively
  }
}

// ── Persistent store ──────────────────────────────────────────────────────────

interface StoredSignal {
  token: string
  direction: string
  targetPrice: string
  confidenceBandBps: string
  signalTimestamp: number
  nonce: string
  strengthScore: number
  reasoning: object
  dirBytes32: string
  requestId: string | null
  computedAt: number
}

interface Store {
  signals: Record<string, StoredSignal>
  requestIndex: Record<string, string>  // requestId → token
}

function loadStore(): Store {
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as Store
    }
  } catch { /* corrupt — start fresh */ }
  return { signals: {}, requestIndex: {} }
}

function saveStore(store: Store) {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2))
  } catch (e) {
    console.error('[store] Failed to persist store:', e)
  }
}

let store = loadStore()

const liveSignals: Map<string, { output: SignalOutput; computedAt: number }> = new Map()

for (const [token, s] of Object.entries(store.signals)) {
  const tp = BigInt(s.targetPrice)
  const cb = BigInt(s.confidenceBandBps)
  const nc = BigInt(s.nonce)
  const dir32 = s.dirBytes32 as `0x${string}`
  const output: SignalOutput = {
    token: s.token,
    direction: s.direction as 'BULLISH' | 'BEARISH',
    targetPrice: tp,
    confidenceBandBps: cb,
    timestamp: s.signalTimestamp,
    nonce: nc,
    strengthScore: s.strengthScore,
    reasoning: s.reasoning as SignalOutput['reasoning'],
    commitHash: (requestId: bigint) => computeCommitHash(requestId, dir32, tp, cb, s.signalTimestamp, nc),
  }
  liveSignals.set(token, { output, computedAt: s.computedAt })
}

// ── Spot price cache ──────────────────────────────────────────────────────────

let spotPrices: SpotPrice[] = []
let spotFetchedAt = 0

async function refreshSpotPrices() {
  try {
    spotPrices = await fetchSpotPrices(SUPPORTED_TOKENS)
    spotFetchedAt = Date.now()
  } catch (e) {
    console.error('[prices] Failed to refresh spot prices:', e)
  }
}

// ── Signal refresh loop ───────────────────────────────────────────────────────

async function refreshSignal(token: string): Promise<SignalOutput> {
  const candles = await fetchCandles(token, 60)
  const output = computeSignal(token, candles)
  const dirBytes32 = stringToBytes32(output.direction)

  liveSignals.set(token, { output, computedAt: Date.now() })

  const existing = store.signals[token]
  store.signals[token] = {
    token,
    direction: output.direction,
    targetPrice: output.targetPrice.toString(),
    confidenceBandBps: output.confidenceBandBps.toString(),
    signalTimestamp: output.timestamp,
    nonce: output.nonce.toString(),
    strengthScore: output.strengthScore,
    reasoning: output.reasoning,
    dirBytes32,
    requestId: existing?.requestId ?? null,
    computedAt: Date.now(),
  }
  saveStore(store)

  console.log(
    `[signal] ${token} → ${output.direction} score=${output.strengthScore} ` +
    `target=$${(Number(output.targetPrice) / 1e6).toFixed(2)} ` +
    `conf=±${(Number(output.confidenceBandBps) / 100).toFixed(2)}%`
  )
  return output
}

async function getOrRefreshSignal(token: string): Promise<SignalOutput> {
  const cached = liveSignals.get(token)
  if (cached && Date.now() - cached.computedAt < SIGNAL_CACHE_TTL_MS) {
    return cached.output
  }
  return refreshSignal(token)
}

async function refreshAll() {
  await Promise.allSettled(SUPPORTED_TOKENS.map(t => refreshSignal(t)))
}

refreshAll()
refreshSpotPrices()
setInterval(refreshAll, 10 * 60 * 1000)
setInterval(refreshSpotPrices, 60 * 1000)

// ── HTTP server ───────────────────────────────────────────────────────────────

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
    { status, headers: CORS }
  )
}

const VALID_TOKENS = new Set(SUPPORTED_TOKENS)
const VALID_INTERVALS = new Set([60, 240, 720, 1440])

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/^\/api/, '')

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } })
    }

    // GET / — service info
    if (path === '/') {
      return json({
        name: 'PredictAgent Signal Service',
        version: 'v1',
        status: 'ok',
        note: 'Live on Arc mainnet · v1 heuristic model · Not financial advice.',
        docs: 'https://github.com/Agozie180/PredictAgent/blob/main/JUDGE_GUIDE.md',
        endpoints: [
          'GET /health',
          'GET /prices',
          'GET /signal/latest?token=BTC  (locked — pay on-chain to unlock)',
          'GET /signal/:requestId         (full signal after payment)',
          'GET /signal/backtest?token=BTC&limit=200&interval=60',
          'POST /signal/commit',
        ],
      })
    }

    // GET /health
    if (path === '/health') {
      return json({
        status: 'ok',
        version: 'v1',
        note: 'Live on Arc mainnet · v1 heuristic model · Not financial advice.',
        supportedTokens: SUPPORTED_TOKENS,
        cachedSignals: [...liveSignals.keys()],
        committedRequests: Object.keys(store.requestIndex).length,
        contract: CONTRACT_ADDRESS || '(not configured)',
        chainId: 5042,
      })
    }

    // GET /prices
    if (path === '/prices' && req.method === 'GET') {
      if (spotPrices.length === 0 || Date.now() - spotFetchedAt > 90_000) {
        await refreshSpotPrices()
      }
      return json({ prices: spotPrices, fetchedAt: spotFetchedAt })
    }

    // GET /signal/latest?token=BTC — LOCKED response
    if (path === '/signal/latest' && req.method === 'GET') {
      const token = (url.searchParams.get('token') ?? '').toUpperCase()
      if (!token) return json({ error: 'Missing ?token= query parameter' }, 400)
      if (!VALID_TOKENS.has(token)) {
        return json({ error: `Unsupported token "${token}". Supported: ${SUPPORTED_TOKENS.join(', ')}` }, 400)
      }
      try {
        await getOrRefreshSignal(token)
        if (spotPrices.length === 0 || Date.now() - spotFetchedAt > 90_000) {
          await refreshSpotPrices()
        }
        const spot = spotPrices.find(p => p.token === token)
        return json({
          note: 'Live on Arc mainnet · v1 heuristic model · Not financial advice.',
          token,
          currentPrice: spot?.price ?? null,
          currentPriceUsd: spot
            ? `$${spot.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: spot.price >= 100 ? 2 : 6 })}`
            : null,
          fee: '1.00',
          feeCurrency: 'USDC',
          contract: CONTRACT_ADDRESS || '(not configured)',
          chainId: 5042,
          locked: true,
          indicators: ['RSI (14)', 'EMA 20/50 crossover', 'MACD histogram', 'Bollinger Band position', 'Volume ratio', '24h price change'],
          howToUnlock: 'Call requestSignal() on-chain with $1 USDC. After the seller commits, GET /signal/:requestId returns the full signal.',
        })
      } catch {
        return json({ error: 'Market data temporarily unavailable. Please retry.' }, 503)
      }
    }

    // GET /signal/:requestId — full signal, gated on on-chain payment
    const reqMatch = path.match(/^\/signal\/(\d+)$/)
    if (reqMatch && req.method === 'GET') {
      const requestIdStr = reqMatch[1]!
      const requestId = BigInt(requestIdStr)

      const onChain = await getOnChainStatus(requestId)
      if (!onChain) {
        return json({
          error: `Request ${requestIdStr} not found on-chain. It may not exist yet.`,
          contract: CONTRACT_ADDRESS || '(not configured)',
          chainId: 5042,
        }, 404)
      }
      if (onChain.status < 1) {
        return json({
          error: 'Signal not yet committed. The seller will commit before the window opens.',
          status: 'PENDING',
          requestId: requestIdStr,
          fee: '1.00',
          contract: CONTRACT_ADDRESS || '(not configured)',
          chainId: 5042,
        }, 402)
      }

      const token = store.requestIndex[requestIdStr]
      if (!token) {
        return json({
          error: `Signal data for request ${requestIdStr} is not in this service instance. The seller agent may need to recommit.`,
          requestId: requestIdStr,
        }, 503)
      }
      const cached = liveSignals.get(token)
      if (!cached) {
        return json({ error: 'Signal data not in memory. Service may have just restarted.' }, 503)
      }
      return json(buildFullSignalResponse(cached.output, requestId))
    }

    // GET /signal/backtest
    if (path === '/signal/backtest' && req.method === 'GET') {
      const token = (url.searchParams.get('token') ?? '').toUpperCase()
      const limitRaw = url.searchParams.get('limit')
      const intervalRaw = url.searchParams.get('interval')

      if (!token) return json({ error: 'Missing ?token= query parameter' }, 400)
      if (!VALID_TOKENS.has(token)) {
        return json({ error: `Unsupported token "${token}". Supported: ${SUPPORTED_TOKENS.join(', ')}` }, 400)
      }

      const limitN = limitRaw !== null ? parseInt(limitRaw, 10) : 200
      if (limitRaw !== null && (isNaN(limitN) || !Number.isInteger(limitN) || String(limitN) !== limitRaw.trim())) {
        return json({ error: 'limit must be an integer (e.g. 200)' }, 400)
      }
      if (limitN < 66 || limitN > 1000) {
        return json({ error: 'limit must be between 66 and 1000' }, 400)
      }

      const intervalN = intervalRaw !== null ? parseInt(intervalRaw, 10) : 60
      if (intervalRaw !== null && (isNaN(intervalN) || !Number.isInteger(intervalN) || String(intervalN) !== intervalRaw.trim())) {
        return json({ error: 'interval must be an integer (e.g. 60)' }, 400)
      }
      if (!VALID_INTERVALS.has(intervalN)) {
        return json({ error: 'interval must be one of: 60, 240, 720, 1440' }, 400)
      }

      const includeTrades = url.searchParams.get('trades') === 'true'
      try {
        const candles = await fetchCandles(token, limitN, intervalN)
        const result = backtestSignal(token, candles)
        const { trades, ...summary } = result
        return json({
          note: 'v1 heuristic model backtest. Win = direction correct AND close within confidence band. Out-of-sample = last 30% of candles. Not financial advice.',
          ...summary,
          ...(includeTrades ? { trades } : { tradesOmitted: trades.length, hint: 'Add ?trades=true to include per-trade breakdown' }),
          candles: candles.length,
          intervalMinutes: intervalN,
        })
      } catch (e) {
        return json({ error: `Backtest failed: ${String(e)}` }, 503)
      }
    }

    // POST /signal/commit
    if (path === '/signal/commit' && req.method === 'POST') {
      let body: { token?: string; requestId?: string }
      try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

      const token = (body.token ?? '').toUpperCase()
      const requestIdStr = body.requestId ?? ''
      if (!token || !requestIdStr) return json({ error: 'Body must include { token, requestId }' }, 400)
      if (!VALID_TOKENS.has(token)) {
        return json({ error: `Unsupported token "${token}". Supported: ${SUPPORTED_TOKENS.join(', ')}` }, 400)
      }

      let requestId: bigint
      try { requestId = BigInt(requestIdStr) } catch { return json({ error: 'Invalid requestId — must be a positive integer string' }, 400) }

      let output: SignalOutput
      try { output = await refreshSignal(token) } catch (e) { return json({ error: `Market data unavailable: ${String(e)}` }, 503) }

      store.signals[token] = { ...store.signals[token]!, requestId: requestId.toString() }
      store.requestIndex[requestId.toString()] = token
      saveStore(store)

      const dirBytes32 = stringToBytes32(output.direction)
      const hash = computeCommitHash(
        requestId, dirBytes32,
        output.targetPrice, output.confidenceBandBps,
        output.timestamp, output.nonce,
      )

      return json({
        requestId: requestId.toString(),
        token,
        commitHash: hash,
        strengthScore: output.strengthScore,
        revealData: {
          direction: dirBytes32,
          targetPrice: output.targetPrice.toString(),
          confidenceBandBps: output.confidenceBandBps.toString(),
          signalTimestamp: output.timestamp,
          nonce: output.nonce.toString(),
        },
        note: 'Call commitSignal(requestId, commitHash) on-chain. Keep revealData secret until after windowClose, then call revealSignal.',
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`[PredictAgent] Signal service v1 listening on http://localhost:${PORT}`)
console.log(`[PredictAgent] Live on Arc mainnet · v1 heuristic model · Not financial advice.`)
console.log(`[PredictAgent] Contract: ${CONTRACT_ADDRESS || '(VITE_CONTRACT_ADDRESS not set)'}`)
console.log(`[PredictAgent] Persistence: ${STORE_PATH}`)

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFullSignalResponse(output: SignalOutput, requestId: bigint) {
  const dirBytes32 = stringToBytes32(output.direction)
  return {
    note: 'Live on Arc mainnet · v1 heuristic model · Not financial advice. Past results do not guarantee future outcomes.',
    token: output.token,
    direction: output.direction,
    strengthScore: output.strengthScore,
    strengthLabel: output.strengthScore >= 70 ? 'STRONG' : output.strengthScore >= 55 ? 'MODERATE' : 'WEAK',
    reasoning: output.reasoning,
    targetPrice: output.targetPrice.toString(),
    targetPriceUsd: (Number(output.targetPrice) / 1e6).toFixed(2),
    confidenceBandBps: output.confidenceBandBps.toString(),
    confidenceBandPct: (Number(output.confidenceBandBps) / 100).toFixed(2) + '%',
    signalTimestamp: output.timestamp,
    // nonce is NOT returned — it stays secret until revealSignal() is called on-chain
    requestId: requestId.toString(),
    commitHash: computeCommitHash(requestId, dirBytes32, output.targetPrice, output.confidenceBandBps, output.timestamp, output.nonce),
  }
}
