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

const BINANCE_BASE = 'https://api.binance.com/api/v3'
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

// Map token symbol → Binance pair
const BINANCE_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  ARB: 'ARBUSDT',
  MATIC: 'MATICUSDT',
}

// Map token symbol → CoinGecko id (fallback)
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ARB: 'arbitrum',
  MATIC: 'matic-network',
}

export const SUPPORTED_TOKENS = Object.keys(BINANCE_PAIRS)

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

export async function fetchCandles(token: string, limit = 60): Promise<Candle[]> {
  const t = token.toUpperCase()
  try {
    return await fetchCandlesBinance(t, limit)
  } catch (err) {
    console.warn(`[marketData] Binance candle fetch failed for ${t}, trying CoinGecko fallback:`, err)
    return fetchCandlesCoinGecko(t, limit)
  }
}

async function fetchCandlesBinance(token: string, limit: number): Promise<Candle[]> {
  const pair = BINANCE_PAIRS[token]
  if (!pair) throw new Error(`No Binance pair for ${token}`)

  const url = `${BINANCE_BASE}/klines?symbol=${pair}&interval=1h&limit=${limit}`
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
  try {
    return await fetchSpotBinance(tokens)
  } catch (err) {
    console.warn('[marketData] Binance spot fetch failed, using CoinGecko fallback:', err)
    return fetchSpotCoinGecko(tokens)
  }
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
