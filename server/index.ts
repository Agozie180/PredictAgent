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
import { createPublicClient, createWalletClient, http, parseAbi, type Hash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { fetchCandles, fetchSpotPrices, SUPPORTED_TOKENS, type SpotPrice } from './marketData'
import { computeSignal, computeCommitHash, stringToBytes32, backtestSignal, type SignalOutput } from './signal'

const PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const STORE_PATH = join(import.meta.dir, '.signal-store.json')
const SIGNAL_CACHE_TTL_MS = 10 * 60 * 1000  // 10 min

// ── Required env vars — fail loudly on startup if missing ────────────────────
//
// Set these in Render: Dashboard → Your service → Environment
//
//   CONTRACT_ADDRESS   — PredictAgent contract address on Arc mainnet
//                        e.g. 0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f
//   SELLER_PRIVATE_KEY — Seller wallet private key (0x-prefixed, hex)
//                        Used for automatic commitSignal() after RequestCreated
//   ARC_RPC_URL        — Arc mainnet RPC endpoint
//                        e.g. https://rpc.mainnet.arc.io  (public, no auth)
//
// Optional:
//   PORT               — HTTP port (Render sets this automatically)

const _CONTRACT_ADDRESS_RAW =
  process.env['CONTRACT_ADDRESS'] ??
  process.env['VITE_CONTRACT_ADDRESS'] ?? ''  // legacy fallback

const SELLER_PRIVATE_KEY = process.env['SELLER_PRIVATE_KEY'] ?? ''
const ARC_RPC_URL_ENV = process.env['ARC_RPC_URL'] ?? 'https://rpc.mainnet.arc.io' // arc-studio-allow-onchain-literal

const STARTUP_ERRORS: string[] = []
if (!_CONTRACT_ADDRESS_RAW) {
  STARTUP_ERRORS.push('CONTRACT_ADDRESS is not set. Set it in Render → Environment to the deployed PredictAgent address.')
}
if (!SELLER_PRIVATE_KEY) {
  STARTUP_ERRORS.push('SELLER_PRIVATE_KEY is not set. Set it in Render → Environment. The seller agent needs it to call commitSignal() on-chain.')
}
if (STARTUP_ERRORS.length > 0) {
  console.error('\n[PredictAgent] FATAL — required env vars missing:')
  for (const e of STARTUP_ERRORS) console.error(`  ✗ ${e}`)
  console.error('\nSee README.md → "Signal service env vars" for the full list.\n')
  process.exit(1)
}

const CONTRACT_ADDRESS = _CONTRACT_ADDRESS_RAW as `0x${string}`

function buildRpcUrl(): string {
  return ARC_RPC_URL_ENV
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

// ── Wallet client for on-chain writes (commitSignal) ──────────────────────────

const sellerAccount = privateKeyToAccount(
  SELLER_PRIVATE_KEY.startsWith('0x')
    ? (SELLER_PRIVATE_KEY as `0x${string}`)
    : (`0x${SELLER_PRIVATE_KEY}` as `0x${string}`)
)

const ARC_CHAIN = {
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL_ENV] } },
} as const

let walletClient: ReturnType<typeof createWalletClient> | null = null
function getWalletClient() {
  if (!walletClient) {
    walletClient = createWalletClient({
      account: sellerAccount,
      chain: ARC_CHAIN,
      transport: http(buildRpcUrl()),
    })
  }
  return walletClient
}

const COMMIT_ABI = parseAbi([
  'function commitSignal(uint256 requestId, bytes32 commitHash) external',
  'function nextRequestId() external view returns (uint256)',
])

/** Commit a signal to the contract on-chain. Returns the tx hash. */
async function onChainCommit(requestId: bigint, commitHash: `0x${string}`): Promise<Hash> {
  const wc = getWalletClient()
  const hash = await wc.writeContract({
    address: CONTRACT_ADDRESS,
    abi: COMMIT_ABI,
    functionName: 'commitSignal',
    args: [requestId, commitHash],
    chain: ARC_CHAIN,
    account: sellerAccount,
  })
  console.log(`[commit] TX sent for request #${requestId}: ${hash}`)
  return hash
}

// Tracks requests we've already attempted so we don't loop on failures.
// Defined below loadStore() — must not be hoisted above it.
// (commitAttempted is initialised after store is loaded at line ~312)

/**
 * Auto-commit worker: polls the contract for PENDING requests and commits them.
 * Runs every 60 s. Skips requests whose windowOpen has already passed.
 */
async function autoCommitWorker() {
  try {
    const client = getClient()
    const nextId = await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: COMMIT_ABI,
      functionName: 'nextRequestId',
    }) as bigint

    if (nextId <= 1n) return  // no requests yet

    const nowSecs = Math.floor(Date.now() / 1000)

    for (let id = 1n; id < nextId; id++) {
      const key = id.toString()
      if (commitAttempted.has(key)) continue

      const onChain = await getOnChainStatus(id)
      if (!onChain) continue
      if (onChain.status !== 0) {
        // Already committed/revealed/settled — mark as attempted so we skip next time
        commitAttempted.add(key)
        continue
      }

      // Read the request to get windowOpen and tokenSymbol
      const req = await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: STATUS_ABI,
        functionName: 'getRequest',
        args: [id],
      }) as {
        requestId: bigint; tokenSymbol: string; windowOpen: bigint; windowClose: bigint
        status: number; buyer: string; feePaid: bigint
      }

      if (req.requestId === 0n) continue

      const windowOpen = Number(req.windowOpen)
      if (nowSecs >= windowOpen) {
        // Window already open — too late to commit, skip permanently
        console.warn(`[commit] Request #${key}: windowOpen already passed (${windowOpen}), skipping`)
        commitAttempted.add(key)
        continue
      }

      const token = req.tokenSymbol.toUpperCase()
      if (!SUPPORTED_TOKENS.includes(token as typeof SUPPORTED_TOKENS[number])) {
        console.warn(`[commit] Request #${key}: unsupported token "${token}", skipping`)
        commitAttempted.add(key)
        continue
      }

      console.log(`[commit] Auto-committing request #${key} (${token})...`)

      // Compute / refresh signal for this token
      let output: SignalOutput
      try {
        output = await getOrRefreshSignal(token)
      } catch (e) {
        console.error(`[commit] Failed to compute signal for ${token}: ${String(e)}`)
        continue  // retry next cycle
      }

      const dirBytes32 = stringToBytes32(output.direction)
      const hash = computeCommitHash(
        id, dirBytes32,
        output.targetPrice, output.confidenceBandBps,
        output.timestamp, output.nonce,
      )

      try {
        await onChainCommit(id, hash)
        // Persist to store so /signal/:requestId can serve it
        store.signals[token] = { ...store.signals[token]!, requestId: key }
        store.requestIndex[key] = token
        saveStore(store)
        commitAttempted.add(key)
        console.log(`[commit] ✓ Request #${key} committed on-chain (${token} ${output.direction})`)
      } catch (e) {
        console.error(`[commit] ✗ on-chain commit failed for #${key}: ${String(e)}`)
        // Do NOT add to attempted — retry next cycle
      }
    }
  } catch (e) {
    console.error('[commit] autoCommitWorker error:', e)
  }
}

// autoCommitWorker() is started after store is loaded — see below loadStore()

/** Check on-chain: returns status 0=PENDING,1=COMMITTED,2+=REVEALED/SETTLED/REFUNDED or null on error */
async function getOnChainStatus(requestId: bigint): Promise<{ status: number; buyer: string } | null> {
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

// Seeded from the persisted store so a server restart doesn't re-commit
// already-committed requests. MUST be declared after loadStore().
const commitAttempted = new Set<string>(Object.keys(store.requestIndex))

// Start workers AFTER store and commitAttempted are initialised
autoCommitWorker()
setInterval(autoCommitWorker, 60_000)

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
        contract: CONTRACT_ADDRESS,
        seller: sellerAccount.address,
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
          feeNote: 'Read signalFeeUsdc() from the contract for the current fee.',
          contract: CONTRACT_ADDRESS,
          chainId: 5042,
          locked: true,
          indicators: ['RSI (14)', 'EMA 20/50 crossover', 'MACD histogram', 'Bollinger Band position', 'Volume ratio', '24h price change'],
          howToUnlock: 'Call requestSignal() on-chain with $0.10 USDC. After the seller commits, GET /signal/:requestId returns the full signal.',
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
          contract: CONTRACT_ADDRESS,
          chainId: 5042,
        }, 404)
      }
      if (onChain.status < 1) {
        return json({
          error: 'Signal not yet committed. The seller will commit before the window opens.',
          status: 'PENDING',
          requestId: requestIdStr,
          feeNote: 'Read signalFeeUsdc() from the contract for the current fee.',
          contract: CONTRACT_ADDRESS,
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

      // Guard: verify the request exists on-chain before writing to the store
      // (prevents a poisoned store from fake requestIds)
      const onChainCheck = await getOnChainStatus(requestId)
      if (!onChainCheck) {
        return json({ error: `Request ${requestIdStr} not found on-chain. Cannot commit.` }, 404)
      }
      if (onChainCheck.status >= 2) {
        return json({ error: `Request ${requestIdStr} is already past the commit stage (status ${onChainCheck.status}).` }, 409)
      }

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
console.log(`[PredictAgent] Contract : ${CONTRACT_ADDRESS}`)
console.log(`[PredictAgent] RPC      : ${ARC_RPC_URL_ENV}`)
console.log(`[PredictAgent] Seller PK: ${SELLER_PRIVATE_KEY ? '****' + SELLER_PRIVATE_KEY.slice(-4) : '(not set)'}`)
console.log(`[PredictAgent] Store    : ${STORE_PATH}`)

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
