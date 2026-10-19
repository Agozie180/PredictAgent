/**
 * Public market data fetcher.
 *
 * Primary: Binance public REST API (no key needed).
 * Fallback: CoinGecko public API (no key needed, rate-limited).
 *
 * Fetches OHLCV candlestick data for supported tokens.
 * Also provides live spot price and 24h stats for display.
 */

import type { Candle } from './signal'

const BINANCE_BASE   = 'https://api.binance.com/api/v3'
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'
const KRAKEN_BASE    = 'https://api.kraken.com/0/public'

// Map token symbol → Binance pair
const BINANCE_PAIRS: Record<string, string> = {
  BTC:  'BTCUSDT',
  ETH:  'ETHUSDT',
  SOL:  'SOLUSDT',
  ARB:  'ARBUSDT',
  POL:  'POLUSDT',   // Polygon rebranded MATIC → POL in 2024; Binance uses POLUSDT
}

// Map token symbol → Kraken pair (fallback tier 2)
const KRAKEN_PAIRS: Record<string, string> = {
  BTC:  'XBTUSD',
  ETH:  'ETHUSD',
  SOL:  'SOLUSD',
  ARB:  'ARBUSD',
  POL:  'POLUSD',    // Kraken lists POL (Polygon) as POLUSD
}

// Map token symbol → CoinGecko id (fallback tier 3)
const COINGECKO_IDS: Record<string, string> = {
  BTC:  'bitcoin',
  ETH:  'ethereum',
  SOL:  'solana',
  ARB:  'arbitrum',
  POL:  'matic-network', // CoinGecko still uses matic-network id for POL
}

export const SUPPORTED_TOKENS = Object.keys(BINANCE_PAIRS)

// ── Circuit breaker ───────────────────────────────────────────────────────────
//
// Tracks how many consecutive failures each source has had.
// After CIRCUIT_OPEN_THRESHOLD failures, the source is "open" (skipped) for
// CIRCUIT_RESET_MS milliseconds before we try again.

interface CircuitState { failures: number; openUntil: number }
const CIRCUIT_OPEN_THRESHOLD = 3
const CIRCUIT_RESET_MS = 5 * 60 * 1000  // 5 min

const circuits: Record<string, CircuitState> = {
  binance:   { failures: 0, openUntil: 0 },
  kraken:    { failures: 0, openUntil: 0 },
  coingecko: { failures: 0, openUntil: 0 },
}

function isCircuitOpen(source: string): boolean {
  const c = circuits[source]
  if (!c) return false
  return c.failures >= CIRCUIT_OPEN_THRESHOLD && Date.now() < c.openUntil
}

function recordSuccess(source: string) {
  const c = circuits[source]
  if (c) { c.failures = 0; c.openUntil = 0 }
}

function recordFailure(source: string) {
  const c = circuits[source]
  if (!c) return
  c.failures++
  if (c.failures >= CIRCUIT_OPEN_THRESHOLD) {
    c.openUntil = Date.now() + CIRCUIT_RESET_MS
    console.warn(`[marketData] Circuit OPEN for ${source} until ${new Date(c.openUntil).toISOString()}`)
  }
}

// ── Staleness tracking ────────────────────────────────────────────────────────
// Each SpotPrice already has a fetchedAt field. Consumers should check
// (Date.now() - fetchedAt) against MAX_PRICE_AGE_MS and warn if stale.

export const MAX_PRICE_AGE_MS = 90_000  // 90s

export interface SpotPrice {
  token: string
  price: number
  change24hPct: number
  high24h: number
  low24h: number
  volume24h: number
  fetchedAt: number  // unix ms
}

// ── Candle fetch ──────────────────────────────────────────────────────────────

/** intervalMinutes: 60=1h (default), 240=4h, 720=12h, 1440=24h */
export async function fetchCandles(token: string, limit = 60, intervalMinutes = 60): Promise<Candle[]> {
  const t = token.toUpperCase()

  // Tier 1: Binance
  if (!isCircuitOpen('binance')) {
    try {
      const result = await fetchCandlesBinance(t, limit, intervalMinutes)
      recordSuccess('binance')
      return result
    } catch (err) {
      console.warn(`[marketData] Binance candle fetch failed for ${t}:`, err)
      recordFailure('binance')
    }
  } else {
    console.warn(`[marketData] Binance circuit open — skipping for ${t}`)
  }

  // Tier 2: Kraken
  if (!isCircuitOpen('kraken')) {
    try {
      const result = await fetchCandlesKraken(t, limit, intervalMinutes)
      recordSuccess('kraken')
      return result
    } catch (err) {
      console.warn(`[marketData] Kraken candle fetch failed for ${t}:`, err)
      recordFailure('kraken')
    }
  } else {
    console.warn(`[marketData] Kraken circuit open — skipping for ${t}`)
  }

  // Tier 3: CoinGecko (always 1h equivalent — ignores intervalMinutes)
  console.warn(`[marketData] Falling back to CoinGecko for ${t}`)
  const result = await fetchCandlesCoinGecko(t, limit)
  return result
}

const BINANCE_INTERVALS: Record<number, string> = { 60: '1h', 240: '4h', 720: '12h', 1440: '1d' }

async function fetchCandlesBinance(token: string, limit: number, intervalMinutes = 60): Promise<Candle[]> {
  const pair = BINANCE_PAIRS[token]
  if (!pair) throw new Error(`No Binance pair for ${token}`)
  const interval = BINANCE_INTERVALS[intervalMinutes] ?? '1h'
  const url = `${BINANCE_BASE}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Binance klines ${res.status}: ${res.statusText}`)

  // [openTime, open, high, low, close, volume, ...]
  const raw = (await res.json()) as string[][]
  return raw.map(k => ({
    timestamp: Math.floor(Number(k[0]) / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }))
}

async function fetchCandlesKraken(token: string, limit: number, intervalMinutes = 60): Promise<Candle[]> {
  const pair = KRAKEN_PAIRS[token]
  if (!pair) throw new Error(`No Kraken pair for ${token}`)
  // Kraken supported intervals: 1,5,15,30,60,240,1440,10080,21600
  const krakenInterval = [60, 240, 1440].includes(intervalMinutes) ? intervalMinutes : 60
  const url = `${KRAKEN_BASE}/OHLC?pair=${pair}&interval=${krakenInterval}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`Kraken OHLC ${res.status}: ${res.statusText}`)

  interface KrakenOhlcResponse {
    error: string[]
    result: Record<string, Array<[number, string, string, string, string, string, string, number]>>
  }
  const data = (await res.json()) as KrakenOhlcResponse
  if (data.error && data.error.length > 0) throw new Error(`Kraken error: ${data.error.join(', ')}`)

  // Result key is the pair name (may differ from input, e.g. "XXBTZUSD")
  const resultKey = Object.keys(data.result).find(k => k !== 'last')
  if (!resultKey) throw new Error(`Kraken: no candle data for ${pair}`)

  // [time, open, high, low, close, vwap, volume, count]
  const raw = data.result[resultKey]
  return raw.slice(-limit).map(k => ({
    timestamp: k[0],
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[6]),
  }))
}

async function fetchCandlesCoinGecko(token: string, limit: number): Promise<Candle[]> {
  const id = COINGECKO_IDS[token]
  if (!id) throw new Error(`No CoinGecko id for ${token}`)

  // CoinGecko OHLC: last 2 days gives hourly candles (~48)
  const days = Math.ceil(limit / 24) + 1
  const url = `${COINGECKO_BASE}/coins/${id}/ohlc?vs_currency=usd&days=${days}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`CoinGecko OHLC ${res.status}: ${res.statusText}`)

  // [[timestamp_ms, open, high, low, close], ...]
  const raw = (await res.json()) as number[][]
  return raw.slice(-limit).map(k => ({
    timestamp: Math.floor(k[0] / 1000),
    open:   k[1],
    high:   k[2],
    low:    k[3],
    close:  k[4],
    volume: 0,  // CoinGecko OHLC has no volume; volume metrics will be neutral
  }))
}

// ── Spot price ────────────────────────────────────────────────────────────────

export async function fetchSpotPrices(tokens: string[]): Promise<SpotPrice[]> {
  // Tier 1: Binance
  if (!isCircuitOpen('binance')) {
    try {
      const result = await fetchSpotBinance(tokens)
      recordSuccess('binance')
      return result
    } catch (err) {
      console.warn('[marketData] Binance spot fetch failed:', err)
      recordFailure('binance')
    }
  }

  // Tier 2: Kraken
  if (!isCircuitOpen('kraken')) {
    try {
      const result = await fetchSpotKraken(tokens)
      recordSuccess('kraken')
      return result
    } catch (err) {
      console.warn('[marketData] Kraken spot fetch failed:', err)
      recordFailure('kraken')
    }
  }

  // Tier 3: CoinGecko
  console.warn('[marketData] Falling back to CoinGecko for spot prices')
  return fetchSpotCoinGecko(tokens)
}

async function fetchSpotBinance(tokens: string[]): Promise<SpotPrice[]> {
  const pairs = tokens.map(t => BINANCE_PAIRS[t.toUpperCase()]).filter(Boolean)
  if (pairs.length === 0) return []

  const url = `${BINANCE_BASE}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pairs))}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Binance ticker ${res.status}`)

  interface BinanceTicker {
    symbol: string
    lastPrice: string
    priceChangePercent: string
    highPrice: string
    lowPrice: string
    quoteVolume: string
  }
  const data = (await res.json()) as BinanceTicker[]
  const out: SpotPrice[] = []
  for (const d of data) {
    const token = Object.entries(BINANCE_PAIRS).find(([, v]) => v === d.symbol)?.[0]
    if (!token) continue
    out.push({
      token,
      price: parseFloat(d.lastPrice),
      change24hPct: parseFloat(d.priceChangePercent),
      high24h: parseFloat(d.highPrice),
      low24h: parseFloat(d.lowPrice),
      volume24h: parseFloat(d.quoteVolume),
      fetchedAt: Date.now(),
    })
  }
  return out
}

async function fetchSpotKraken(tokens: string[]): Promise<SpotPrice[]> {
  const pairs = tokens
    .map(t => KRAKEN_PAIRS[t.toUpperCase()])
    .filter(Boolean)
  if (pairs.length === 0) return []

  const url = `${KRAKEN_BASE}/Ticker?pair=${pairs.join(',')}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`Kraken Ticker ${res.status}`)

  interface KrakenTickerData {
    c: [string, string]   // [last trade price, lot volume]
    h: [string, string]   // [today's high, last 24h high]
    l: [string, string]   // [today's low, last 24h low]
    v: [string, string]   // [today's volume, last 24h volume]
    p: [string, string]   // [VWAP today, VWAP 24h]
    o: string             // today's opening price
  }
  interface KrakenTickerResponse {
    error: string[]
    result: Record<string, KrakenTickerData>
  }
  const data = (await res.json()) as KrakenTickerResponse
  if (data.error?.length) throw new Error(`Kraken Ticker error: ${data.error.join(', ')}`)

  const out: SpotPrice[] = []
  for (const [krakenKey, tick] of Object.entries(data.result)) {
    // Find our token for this Kraken key (Kraken may normalise key)
    const token = Object.entries(KRAKEN_PAIRS).find(([, v]) => krakenKey.includes(v.slice(0, 3)))?.[0]
    if (!token) continue
    const price = parseFloat(tick.c[0])
    const open  = parseFloat(tick.o)
    const change24hPct = open > 0 ? ((price - open) / open) * 100 : 0
    out.push({
      token,
      price,
      change24hPct,
      high24h:   parseFloat(tick.h[1]),
      low24h:    parseFloat(tick.l[1]),
      volume24h: parseFloat(tick.v[1]) * price,
      fetchedAt: Date.now(),
    })
  }
  return out
}

async function fetchSpotCoinGecko(tokens: string[]): Promise<SpotPrice[]> {
  const ids = tokens.map(t => COINGECKO_IDS[t.toUpperCase()]).filter(Boolean).join(',')
  if (!ids) return []
  const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_high_low=false`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`CoinGecko price ${res.status}`)

  interface CoinGeckoPrice {
    usd: number
    usd_24h_change: number
    usd_24h_vol: number
  }
  const data = (await res.json()) as Record<string, CoinGeckoPrice>
  return Object.entries(data).map(([id, v]) => {
    const token = Object.entries(COINGECKO_IDS).find(([, gid]) => gid === id)?.[0] ?? id
    return {
      token,
      price: v.usd,
      change24hPct: v.usd_24h_change ?? 0,
      high24h: 0,
      low24h: 0,
      volume24h: v.usd_24h_vol ?? 0,
      fetchedAt: Date.now(),
    }
  })
}
