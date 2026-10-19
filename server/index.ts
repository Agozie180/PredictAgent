/**
 * PredictAgent Signal Service — DEMO v1
 *
 * Endpoints (all proxied from Vite at /api → localhost:3001):
 *   GET  /health                       — service health + supported tokens
 *   GET  /prices                       — live spot prices for all tokens
 *   GET  /signal/latest?token=BTC      — latest computed signal + reasoning
 *   GET  /signal/:requestId            — signal committed to a specific requestId
 *   POST /signal/commit                — associate signal with requestId, return commitHash + revealData
 *
 * Signal state is persisted to .signal-store.json so it survives restarts.
 * The seller must keep revealData secret until after windowClose.
 *
 * PORT: 3001
 * DEMO v1 — signal logic is illustrative only, not financial advice.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchCandles, fetchSpotPrices, SUPPORTED_TOKENS, type SpotPrice } from './marketData'
import { computeSignal, computeCommitHash, stringToBytes32, backtestSignal, type SignalOutput } from './signal'

const PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const STORE_PATH = join(import.meta.dir, '.signal-store.json')
const SIGNAL_CACHE_TTL_MS = 10 * 60 * 1000  // 10 min

// ── Persistent store ──────────────────────────────────────────────────────────

interface StoredSignal {
  token: string
  direction: string
  targetPrice: string     // bigint serialised as string
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
  } catch { /* corrupt file — start fresh */ }
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

// In-memory cache of live SignalOutput objects (not serialisable due to commitHash closure)
const liveSignals: Map<string, { output: SignalOutput; computedAt: number }> = new Map()

// Restore live signals from store on startup
for (const [token, s] of Object.entries(store.signals)) {
  // Rehydrate — rebuild the commitHash closure from stored fields
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

  // Persist to store — preserve requestId if already committed
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
    `conf=±${(Number(output.confidenceBandBps) / 100).toFixed(1)}%`
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

// Startup: refresh everything in parallel
refreshAll()
refreshSpotPrices()

// Refresh signals every 10 min, spot prices every 60s
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

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    // Strip /api prefix if proxied via Vite
    const path = url.pathname.replace(/^\/api/, '')

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } })
    }

    // GET / and GET /health
    if (path === '/') {
      return json({
        name: 'PredictAgent Signal Service',
        version: 'demo-v1',
        status: 'ok',
        docs: 'https://github.com/Agozie180/PredictAgent/blob/main/JUDGE_GUIDE.md',
        endpoints: ['/health', '/prices', '/signal/latest?token=BTC', '/signal/backtest?token=BTC&limit=200'],
      })
    }

    if (path === '/health' || path === '/api/health') {
      return json({
        status: 'ok',
        version: 'demo-v1',
        supportedTokens: SUPPORTED_TOKENS,
        cachedSignals: [...liveSignals.keys()],
        committedRequests: Object.keys(store.requestIndex).length,
        note: 'DEMO v1 — signal logic is illustrative only, not financial advice.',
      })
    }

    // GET /prices — live spot prices for all tokens
    if ((path === '/prices' || path === '/api/prices') && req.method === 'GET') {
      if (spotPrices.length === 0 || Date.now() - spotFetchedAt > 90_000) {
        await refreshSpotPrices()
      }
      return json({ prices: spotPrices, fetchedAt: spotFetchedAt })
    }

    // GET /signal/latest?token=BTC
    if ((path === '/signal/latest' || path === '/api/signal/latest') && req.method === 'GET') {
      const token = (url.searchParams.get('token') ?? '').toUpperCase()
      if (!token) return json({ error: 'Missing ?token=' }, 400)
      if (!SUPPORTED_TOKENS.includes(token)) {
        return json({ error: `Unsupported token. Supported: ${SUPPORTED_TOKENS.join(', ')}` }, 400)
      }
      try {
        const output = await getOrRefreshSignal(token)
        const stored = store.signals[token]
        return json(buildSignalResponse(output, stored?.requestId ? BigInt(stored.requestId) : null))
      } catch (e) {
        return json({ error: String(e) }, 503)
      }
    }

    // GET /signal/:requestId
    const reqMatch = path.match(/^\/signal\/(\d+)$/)
    if (reqMatch && req.method === 'GET') {
      const requestId = reqMatch[1]
      const token = store.requestIndex[requestId]
      if (!token) {
        return json({ error: `No signal committed for requestId ${requestId}. Seller may not have committed yet.` }, 404)
      }
      const cached = liveSignals.get(token)
      if (!cached) return json({ error: 'Signal data not in memory. Service may have just restarted.' }, 503)
      return json(buildSignalResponse(cached.output, BigInt(requestId)))
    }

    // GET /signal/backtest?token=BTC&limit=200
    if ((path === '/signal/backtest' || path === '/api/signal/backtest') && req.method === 'GET') {
      const token = (url.searchParams.get('token') ?? '').toUpperCase()
      const limit = Math.min(720, Math.max(60, parseInt(url.searchParams.get('limit') ?? '200', 10)))
      const intervalMinutes = parseInt(url.searchParams.get('interval') ?? '60', 10)
      if (!token) return json({ error: 'Missing ?token=' }, 400)
      if (!SUPPORTED_TOKENS.includes(token)) return json({ error: `Unsupported token: ${token}` }, 400)
      if (![60, 240, 720, 1440].includes(intervalMinutes)) return json({ error: 'interval must be 60, 240, 720, or 1440' }, 400)
      const includeTrades = url.searchParams.get('trades') === 'true'
      try {
        const candles = await fetchCandles(token, limit, intervalMinutes)
        const result = backtestSignal(token, candles)
        const { trades, ...summary } = result
        return json({
          ...summary,
          ...(includeTrades ? { trades } : { tradesOmitted: trades.length, hint: 'Add ?trades=true to include per-trade breakdown' }),
          candles: candles.length,
          warning: 'DEMO v1 retrospective backtest only — in-sample, look-ahead bias applies. Do NOT use for investment decisions.',
        })
      } catch (e) {
        return json({ error: String(e) }, 503)
      }
    }

    // POST /signal/commit — seller agent calls this to lock signal to a requestId
    if ((path === '/signal/commit' || path === '/api/signal/commit') && req.method === 'POST') {
      let body: { token?: string; requestId?: string }
      try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

      const token = (body.token ?? '').toUpperCase()
      const requestIdStr = body.requestId ?? ''
      if (!token || !requestIdStr) return json({ error: 'Body must include { token, requestId }' }, 400)
      if (!SUPPORTED_TOKENS.includes(token)) return json({ error: `Unsupported token: ${token}` }, 400)

      let requestId: bigint
      try { requestId = BigInt(requestIdStr) } catch { return json({ error: 'Invalid requestId' }, 400) }

      // Refresh signal for a fresh commit
      let output: SignalOutput
      try { output = await refreshSignal(token) } catch (e) { return json({ error: String(e) }, 503) }

      // Associate requestId with this token's signal
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
        reasoning: output.reasoning,
        // revealData — seller keeps secret until after windowClose
        revealData: {
          direction: dirBytes32,
          targetPrice: output.targetPrice.toString(),
          confidenceBandBps: output.confidenceBandBps.toString(),
          signalTimestamp: output.timestamp,
          nonce: output.nonce.toString(),
        },
        note: 'DEMO v1. Call commitSignal(requestId, commitHash) on-chain. Keep revealData secret until after windowClose, then call revealSignal with these values.',
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`[PredictAgent] Signal service listening on http://localhost:${PORT}`)
console.log(`[PredictAgent] DEMO v1 — signal logic is illustrative only, not financial advice.`)
console.log(`[PredictAgent] Persistence: ${STORE_PATH}`)

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSignalResponse(output: SignalOutput, requestId: bigint | null) {
  const dirBytes32 = stringToBytes32(output.direction)
  return {
    note: 'DEMO v1 — Signals are informational only, not financial advice. Past results do not guarantee future outcomes.',
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
    nonce: output.nonce.toString(),
    requestId: requestId?.toString() ?? null,
    commitHash: requestId !== null
      ? computeCommitHash(requestId, dirBytes32, output.targetPrice, output.confidenceBandBps, output.timestamp, output.nonce)
      : null,
  }
}
