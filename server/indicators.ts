/**
 * Technical indicators for PredictAgent signal engine.
 *
 * All functions are pure, dependency-free, and auditable.
 * Input: Candle[] sorted oldest → newest.
 *
 * DEMO v1 — for illustrative purposes only, not financial advice.
 */

import type { Candle } from './signal'

// ── EMA ──────────────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * Returns an array the same length as input; first (period-1) entries are NaN.
 */
export function ema(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = new Array(closes.length).fill(NaN)
  // Seed with SMA of first `period` closes
  const seed = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  result[period - 1] = seed
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

// ── RSI ──────────────────────────────────────────────────────────────────────

/**
 * Relative Strength Index (Wilder smoothing).
 * Returns an array the same length as input; first `period` entries are NaN.
 */
export function rsi(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN)
  if (closes.length <= period) return result

  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? -diff : 0)
  }

  let avgGain = gains.reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.reduce((a, b) => a + b, 0) / period

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────

export interface BollingerBands {
  upper: number[]
  middle: number[]  // SMA
  lower: number[]
  bandwidth: number[]  // (upper - lower) / middle — squeeze detector
}

export function bollingerBands(closes: number[], period = 20, stdDevMult = 2): BollingerBands {
  const upper: number[] = new Array(closes.length).fill(NaN)
  const middle: number[] = new Array(closes.length).fill(NaN)
  const lower: number[] = new Array(closes.length).fill(NaN)
  const bandwidth: number[] = new Array(closes.length).fill(NaN)

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1)
    const sma = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((sum, v) => sum + (v - sma) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    upper[i] = sma + stdDevMult * sd
    middle[i] = sma
    lower[i] = sma - stdDevMult * sd
    bandwidth[i] = sma > 0 ? (upper[i] - lower[i]) / sma : 0
  }

  return { upper, middle, lower, bandwidth }
}

// ── MACD ─────────────────────────────────────────────────────────────────────

export interface MACD {
  macdLine: number[]     // EMA(12) - EMA(26)
  signalLine: number[]   // EMA(9) of macdLine
  histogram: number[]    // macdLine - signalLine
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9): MACD {
  const fastEma = ema(closes, fast)
  const slowEma = ema(closes, slow)
  const macdLine = fastEma.map((v, i) => (isNaN(v) || isNaN(slowEma[i])) ? NaN : v - slowEma[i])

  // Signal EMA only on valid MACD values
  const validStart = macdLine.findIndex(v => !isNaN(v))
  const signalLine: number[] = new Array(closes.length).fill(NaN)
  if (validStart >= 0) {
    const validMacd = macdLine.slice(validStart)
    const signalEma = ema(validMacd, signal)
    signalEma.forEach((v, i) => { signalLine[validStart + i] = v })
  }

  const histogram = macdLine.map((v, i) =>
    (isNaN(v) || isNaN(signalLine[i])) ? NaN : v - signalLine[i]
  )

  return { macdLine, signalLine, histogram }
}

// ── Volume Profile ────────────────────────────────────────────────────────────

export interface VolumeMetrics {
  /** Ratio of last candle volume to rolling average (>1 = above avg) */
  volumeRatio: number
  /** True if volume is expanding (last 3 candles trend up) */
  volumeExpanding: boolean
  /** OBV-style: cumulative signed volume momentum over lookback */
  signedVolumeMomentum: number
}

export function volumeMetrics(candles: Candle[], lookback = 20): VolumeMetrics {
  const recent = candles.slice(-Math.max(lookback, 4))
  const vols = recent.map(c => c.volume)
  const avgVol = vols.slice(0, -1).reduce((a, b) => a + b, 0) / (vols.length - 1)
  const lastVol = vols[vols.length - 1]
  const volumeRatio = avgVol > 0 ? lastVol / avgVol : 1

  // Volume expanding = each of last 3 candles has higher volume than the one before
  const last3 = vols.slice(-3)
  const volumeExpanding = last3.length === 3 && last3[1] > last3[0] && last3[2] > last3[1]

  // Signed volume momentum: sum of (volume × sign of close-open) over lookback
  let signed = 0
  for (const c of recent) {
    signed += c.volume * Math.sign(c.close - c.open)
  }

  return { volumeRatio, volumeExpanding, signedVolumeMomentum: signed }
}

// ── ATR (Average True Range) ──────────────────────────────────────────────────

/**
 * Returns the average ATR over last `period` candles.
 * Used to compute dynamic confidence bands.
 */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0
  const recent = candles.slice(-(period + 1))
  let sum = 0
  for (let i = 1; i < recent.length; i++) {
    const high = recent[i].high
    const low = recent[i].low
    const prevClose = recent[i - 1].close
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    sum += tr
  }
  return sum / period
}

// ── Signal Strength Score ─────────────────────────────────────────────────────

export interface IndicatorSnapshot {
  rsiValue: number        // 0–100
  macdHistogram: number   // positive = bullish momentum
  bbPosition: number      // 0 = at lower band, 0.5 = middle, 1 = at upper band
  bbBandwidth: number     // squeeze proxy (lower = tighter = breakout pending)
  volumeRatio: number     // >1 confirms move
  ema20: number
  ema50: number
  lastClose: number
  change24hPct: number    // % change last 24 candles (1h interval)
  atrPct: number          // ATR as % of price
}

/**
 * Returns a 0–100 score where:
 *   > 70 = strong signal in direction
 *   50–70 = moderate signal
 *   < 50 = weak / uncertain
 */
export function signalStrengthScore(snap: IndicatorSnapshot, direction: 'BULLISH' | 'BEARISH'): number {
  let score = 50 // start neutral

  // RSI contribution (max ±20)
  if (direction === 'BULLISH') {
    if (snap.rsiValue > 50 && snap.rsiValue < 70) score += 10  // trending up, not overbought
    if (snap.rsiValue <= 30) score += 20  // oversold reversal potential
    if (snap.rsiValue >= 80) score -= 10  // overbought = weak bullish
  } else {
    if (snap.rsiValue < 50 && snap.rsiValue > 30) score += 10
    if (snap.rsiValue >= 70) score += 20  // overbought reversal potential
    if (snap.rsiValue <= 20) score -= 10  // oversold = weak bearish
  }

  // MACD histogram (max ±15)
  const macdNorm = Math.min(Math.abs(snap.macdHistogram / Math.max(snap.lastClose * 0.0001, 1e-9)), 1)
  if (direction === 'BULLISH' && snap.macdHistogram > 0) score += Math.round(macdNorm * 15)
  if (direction === 'BULLISH' && snap.macdHistogram < 0) score -= Math.round(macdNorm * 10)
  if (direction === 'BEARISH' && snap.macdHistogram < 0) score += Math.round(macdNorm * 15)
  if (direction === 'BEARISH' && snap.macdHistogram > 0) score -= Math.round(macdNorm * 10)

  // EMA alignment (max ±10)
  if (direction === 'BULLISH' && snap.ema20 > snap.ema50) score += 10
  if (direction === 'BULLISH' && snap.ema20 < snap.ema50) score -= 5
  if (direction === 'BEARISH' && snap.ema20 < snap.ema50) score += 10
  if (direction === 'BEARISH' && snap.ema20 > snap.ema50) score -= 5

  // Volume confirmation (max +10)
  if (snap.volumeRatio > 1.5) score += 10
  else if (snap.volumeRatio > 1.2) score += 5

  // Bollinger Band position (max ±5)
  if (direction === 'BULLISH' && snap.bbPosition < 0.2) score += 5   // near lower band = buy zone
  if (direction === 'BEARISH' && snap.bbPosition > 0.8) score += 5   // near upper band = sell zone

  return Math.max(0, Math.min(100, score))
}
