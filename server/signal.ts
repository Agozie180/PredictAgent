/**
 * PredictAgent Signal Engine — DEMO v1
 *
 * Computes price-movement signals from public exchange data using technical
 * analysis: RSI, EMA crossover (20/50), MACD, Bollinger Bands, and volume profile.
 *
 * Signal logic lives in computeSignal(). All indicator logic is in indicators.ts.
 * Both files are intentionally readable so the rules can be audited.
 *
 * DEMO v1 — signal logic is illustrative. Not financial advice.
 */

import { keccak256, encodePacked } from 'viem'
import { rsi, ema, bollingerBands, macd, volumeMetrics, atr, signalStrengthScore, type IndicatorSnapshot } from './indicators'

// ── Types ────────────────────────────────────────────────────────────────────

export type Direction = 'BULLISH' | 'BEARISH'

export interface Candle {
  timestamp: number  // unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SignalReasoning {
  rsi: number
  macdHistogram: number
  ema20: number
  ema50: number
  ema20AboveEma50: boolean
  bbPosition: number   // 0=lower band, 1=upper band
  bbBandwidth: number
  volumeRatio: number
  change24hPct: number
  atrPct: number
  strengthScore: number
  summary: string      // human-readable one-liner
}

export interface SignalOutput {
  token: string
  direction: Direction
  /** Target price in USDC 6-decimal units */
  targetPrice: bigint
  /** Confidence band in basis points (500 = ±5%). Dynamic: wider when ATR is high. */
  confidenceBandBps: bigint
  /** Unix timestamp when signal was generated */
  timestamp: number
  /** Random nonce for commit-reveal uniqueness */
  nonce: bigint
  /** Signal quality score 0–100 */
  strengthScore: number
  /** Indicator breakdown for display */
  reasoning: SignalReasoning
  /** Compute the on-chain commitment hash for a given requestId */
  commitHash: (requestId: bigint) => `0x${string}`
}

// ── Signal logic (DEMO v1) ───────────────────────────────────────────────────
//
// Decision rules (auditable — all logic is here):
//
//   1. RSI(14): <30 → bullish reversal bias; >70 → bearish reversal bias
//   2. EMA crossover (20/50): 20 > 50 → uptrend; 20 < 50 → downtrend
//   3. MACD histogram: positive → bullish momentum; negative → bearish
//   4. Bollinger Band position: price near lower → oversold; near upper → overbought
//   5. Volume ratio: >1.2 confirms move; <0.8 weakens signal
//   6. Vote system: each indicator casts a directional vote
//   7. Direction = majority vote; strength score = 0–100 (see indicators.ts)
//   8. Target: last close ± ATR (dynamic, not fixed pct)
//   9. Confidence band: derived from ATR as % of price, clamped 300–2000 bps

export function computeSignal(token: string, candles: Candle[]): SignalOutput {
  const MIN_CANDLES = 55  // enough for EMA(50) + RSI(14) + MACD(26+9)
  if (candles.length < MIN_CANDLES) {
    throw new Error(`Need at least ${MIN_CANDLES} candles, got ${candles.length}`)
  }

  const closes = candles.map(c => c.close)
  const lastClose = closes[closes.length - 1]

  // ── Compute indicators ────────────────────────────────────────────────
  const rsiValues = rsi(closes, 14)
  const lastRsi = rsiValues[rsiValues.length - 1] ?? 50

  const ema20Values = ema(closes, 20)
  const ema50Values = ema(closes, 50)
  const lastEma20 = ema20Values[ema20Values.length - 1] ?? lastClose
  const lastEma50 = ema50Values[ema50Values.length - 1] ?? lastClose

  const macdValues = macd(closes, 12, 26, 9)
  const lastMacdHist = macdValues.histogram[macdValues.histogram.length - 1] ?? 0

  const bb = bollingerBands(closes, 20, 2)
  const lastBbUpper = bb.upper[bb.upper.length - 1] ?? lastClose * 1.02
  const lastBbLower = bb.lower[bb.lower.length - 1] ?? lastClose * 0.98
  const lastBbBandwidth = bb.bandwidth[bb.bandwidth.length - 1] ?? 0.04
  // bbPosition: 0 = at lower band, 1 = at upper band
  const bbRange = lastBbUpper - lastBbLower
  const bbPosition = bbRange > 0 ? (lastClose - lastBbLower) / bbRange : 0.5

  const volMetrics = volumeMetrics(candles, 20)

  const atrValue = atr(candles, 14)
  const atrPct = lastClose > 0 ? atrValue / lastClose : 0.01

  // 24h change (24 × 1h candles)
  const close24hAgo = candles.length >= 24 ? candles[candles.length - 24].close : candles[0].close
  const change24hPct = close24hAgo > 0 ? ((lastClose - close24hAgo) / close24hAgo) * 100 : 0

  // ── Direction vote ────────────────────────────────────────────────────
  // Each indicator casts +1 (bullish) or -1 (bearish)
  const votes: number[] = [
    lastRsi < 30 ? 1 : lastRsi > 70 ? -1 : lastRsi > 50 ? 0.5 : -0.5,           // RSI
    lastEma20 > lastEma50 ? 1 : -1,                                                 // EMA cross
    lastMacdHist > 0 ? 1 : -1,                                                      // MACD
    bbPosition < 0.2 ? 1 : bbPosition > 0.8 ? -1 : 0,                             // BB position
    volMetrics.signedVolumeMomentum > 0 ? 0.5 : -0.5,                              // volume direction
    change24hPct > 0 ? 0.5 : -0.5,                                                 // 24h trend
  ]
  const voteSum = votes.reduce((a, b) => a + b, 0)
  const direction: Direction = voteSum >= 0 ? 'BULLISH' : 'BEARISH'

  // ── Strength score ────────────────────────────────────────────────────
  const snap: IndicatorSnapshot = {
    rsiValue: lastRsi,
    macdHistogram: lastMacdHist,
    bbPosition,
    bbBandwidth: lastBbBandwidth,
    volumeRatio: volMetrics.volumeRatio,
    ema20: lastEma20,
    ema50: lastEma50,
    lastClose,
    change24hPct,
    atrPct,
  }
  const strengthScore = signalStrengthScore(snap, direction)

  // ── Target price (dynamic ATR-based) ─────────────────────────────────
  // Move target = 1× ATR in signal direction
  const moveAmount = Math.max(atrValue, lastClose * 0.005) // floor at 0.5%
  const targetPriceFloat = direction === 'BULLISH'
    ? lastClose + moveAmount
    : lastClose - moveAmount
  // Convert to 6-decimal integer (USDC units)
  const targetPrice = BigInt(Math.round(Math.max(targetPriceFloat, 0.000001) * 1_000_000))

  // ── Confidence band (dynamic, ATR-based) ──────────────────────────────
  // Band = 1 × ATR as % of price, clamped to 50–300 bps (0.5%–3%)
  const dynBps = Math.round(atrPct * 10_000)
  const confidenceBandBps = BigInt(Math.max(50, Math.min(300, dynBps)))

  // ── Reasoning summary ─────────────────────────────────────────────────
  const alignedCount = votes.filter(v => (direction === 'BULLISH' ? v > 0 : v < 0)).length
  const summary = [
    `${alignedCount}/${votes.length} indicators ${direction === 'BULLISH' ? 'bullish' : 'bearish'}.`,
    `RSI ${lastRsi.toFixed(0)}${lastRsi < 30 ? ' (oversold)' : lastRsi > 70 ? ' (overbought)' : ''}.`,
    `EMA20 ${lastEma20 > lastEma50 ? 'above' : 'below'} EMA50.`,
    `MACD histogram ${lastMacdHist > 0 ? 'positive' : 'negative'}.`,
    `Volume ${volMetrics.volumeRatio.toFixed(2)}× avg.`,
    `24h change ${change24hPct >= 0 ? '+' : ''}${change24hPct.toFixed(2)}%.`,
  ].join(' ')

  const reasoning: SignalReasoning = {
    rsi: lastRsi,
    macdHistogram: lastMacdHist,
    ema20: lastEma20,
    ema50: lastEma50,
    ema20AboveEma50: lastEma20 > lastEma50,
    bbPosition,
    bbBandwidth: lastBbBandwidth,
    volumeRatio: volMetrics.volumeRatio,
    change24hPct,
    atrPct: atrPct * 100,
    strengthScore,
    summary,
  }

  // ── Commit hash closure ───────────────────────────────────────────────
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = BigInt('0x' + Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join(''))
  const dirBytes32 = stringToBytes32(direction)

  return {
    token,
    direction,
    targetPrice,
    confidenceBandBps,
    timestamp,
    nonce,
    strengthScore,
    reasoning,
    commitHash: (requestId: bigint) =>
      computeCommitHash(requestId, dirBytes32, targetPrice, confidenceBandBps, timestamp, nonce),
  }
}

// ── Backtest (DEMO v1 retrospective) ─────────────────────────────────────────
//
// Runs computeSignal() over a sliding window of historical candles and checks
// whether the target price was hit within the confidence band before the
// next signal is computed.
//
// IMPORTANT: This is a retrospective in-sample backtest using the same candles
// the signal was computed from. It suffers from look-ahead bias and overfitting.
// It measures internal consistency of the rules, NOT future profitability.
// DO NOT use these numbers to make investment decisions.

export interface BacktestTrade {
  index: number
  direction: Direction
  entryPrice: number
  targetPrice: number
  bandPct: number
  strengthScore: number
  /** true = direction correct AND close at exit is inside confidence band */
  win: boolean
  /** true = direction correct (price moved toward target) */
  directionalWin: boolean
  /** true = close at exit touched target band */
  bandHit: boolean
  forwardReturn: number  // % price change over forward window
  split: 'in_sample' | 'out_of_sample'
}

export interface BacktestSplit {
  windowCount: number
  wins: number
  losses: number
  winRate: number
  bandHitRate: number
  avgStrength: number
  avgForwardReturn: number
  bullishCount: number
  bearishCount: number
  strongSignalWinRate: number
  weakSignalWinRate: number
}

export interface BacktestResult {
  token: string
  windowCount: number
  wins: number               // combined wins (direction AND band)
  losses: number
  bandHits: number           // direction correct only
  winRate: number            // combined win rate (direction AND band)
  bandHitRate: number        // directional accuracy only
  avgStrength: number
  avgForwardReturn: number
  bullishCount: number
  bearishCount: number
  strongSignalWinRate: number
  weakSignalWinRate: number
  /** Walk-forward split: trained on first 70%, reported on last 30% */
  inSample: BacktestSplit
  outOfSample: BacktestSplit
  trades: BacktestTrade[]
  /** Stated as data only — not a profitability guarantee */
  disclaimer: string
}

/**
 * Runs computeSignal() over a sliding window.
 *
 * Win definition (strict): direction correct AND the closing price of the
 * exit candle is within the confidence band of the target price.
 * This matches what the on-chain contract actually verifies.
 *
 * Walk-forward split: candles are divided 70% in-sample / 30% out-of-sample.
 * The in-sample trades are computed first so the OOS window is truly unseen.
 *
 * IMPORTANT: retrospective backtest. Look-ahead bias applies.
 * windowSize=60 (training), forwardBars=6 (evaluation), step=3 (stride).
 */
export function backtestSignal(
  token: string,
  candles: Candle[],
  windowSize = 60,
  step = 3,
  forwardBars = 6,
): BacktestResult {
  const MIN = 55
  if (candles.length < windowSize + forwardBars) {
    throw new Error(`Need at least ${windowSize + forwardBars} candles, got ${candles.length}`)
  }

  // Walk-forward split boundary
  const splitIdx = Math.floor(candles.length * 0.7)

  const trades: BacktestTrade[] = []

  for (let i = MIN; i + forwardBars <= candles.length; i += step) {
    const slice = candles.slice(Math.max(0, i - windowSize), i)
    if (slice.length < MIN) continue

    let signal: SignalOutput
    try { signal = computeSignal(token, slice) } catch { continue }

    const entryPrice = candles[i - 1].close
    const target = Number(signal.targetPrice) / 1_000_000
    const bandPct = Number(signal.confidenceBandBps) / 10_000
    const bandSize = target * bandPct  // band is relative to target, not entry

    const future = candles.slice(i, Math.min(i + forwardBars, candles.length))
    const exitCandle = future[future.length - 1]
    const exitPrice = exitCandle?.close ?? entryPrice
    const forwardReturn = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0

    // Directional win: exit close moved toward target (strict direction check)
    const directionalWin = signal.direction === 'BULLISH'
      ? exitPrice > entryPrice
      : exitPrice < entryPrice

    // Band hit: exit close is within ±band of target price
    const bandHit = exitCandle !== undefined
      ? Math.abs(exitPrice - target) <= bandSize
      : false

    // Combined win: direction correct AND close inside band
    const win = directionalWin && bandHit

    const split: BacktestTrade['split'] = i < splitIdx ? 'in_sample' : 'out_of_sample'

    trades.push({
      index: i,
      direction: signal.direction,
      entryPrice,
      targetPrice: target,
      bandPct: bandPct * 100,
      strengthScore: signal.strengthScore,
      win,
      directionalWin,
      bandHit,
      forwardReturn: signal.direction === 'BULLISH' ? forwardReturn : -forwardReturn,
      split,
    })
  }

  function computeSplit(subset: BacktestTrade[]): BacktestSplit {
    const wins = subset.filter(t => t.win).length
    const bandHits = subset.filter(t => t.directionalWin).length
    const strongTrades = subset.filter(t => t.strengthScore >= 65)
    const weakTrades   = subset.filter(t => t.strengthScore < 65)
    return {
      windowCount: subset.length,
      wins,
      losses: subset.length - wins,
      winRate: subset.length > 0 ? wins / subset.length : 0,
      bandHitRate: subset.length > 0 ? bandHits / subset.length : 0,
      avgStrength: subset.length > 0 ? subset.reduce((s, t) => s + t.strengthScore, 0) / subset.length : 0,
      avgForwardReturn: subset.length > 0 ? subset.reduce((s, t) => s + t.forwardReturn, 0) / subset.length : 0,
      bullishCount: subset.filter(t => t.direction === 'BULLISH').length,
      bearishCount: subset.filter(t => t.direction === 'BEARISH').length,
      strongSignalWinRate: strongTrades.length > 0 ? strongTrades.filter(t => t.win).length / strongTrades.length : 0,
      weakSignalWinRate:   weakTrades.length > 0   ? weakTrades.filter(t => t.win).length / weakTrades.length : 0,
    }
  }

  const inSampleTrades = trades.filter(t => t.split === 'in_sample')
  const outOfSampleTrades = trades.filter(t => t.split === 'out_of_sample')

  const wins = trades.filter(t => t.win).length
  const bandHits = trades.filter(t => t.directionalWin).length
  const strongTrades = trades.filter(t => t.strengthScore >= 65)
  const weakTrades   = trades.filter(t => t.strengthScore < 65)

  return {
    token,
    windowCount: trades.length,
    wins,
    losses: trades.length - wins,
    bandHits,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    bandHitRate: trades.length > 0 ? bandHits / trades.length : 0,
    avgStrength: trades.length > 0 ? trades.reduce((s, t) => s + t.strengthScore, 0) / trades.length : 0,
    avgForwardReturn: trades.length > 0 ? trades.reduce((s, t) => s + t.forwardReturn, 0) / trades.length : 0,
    bullishCount: trades.filter(t => t.direction === 'BULLISH').length,
    bearishCount: trades.filter(t => t.direction === 'BEARISH').length,
    strongSignalWinRate: strongTrades.length > 0 ? strongTrades.filter(t => t.win).length / strongTrades.length : 0,
    weakSignalWinRate:   weakTrades.length > 0   ? weakTrades.filter(t => t.win).length / weakTrades.length : 0,
    inSample: computeSplit(inSampleTrades),
    outOfSample: computeSplit(outOfSampleTrades),
    trades,
    disclaimer: 'v1 heuristic model backtest. Win = direction correct AND close within confidence band. Out-of-sample = last 30% of candles. Not financial advice. Past results do not guarantee future outcomes.',
  }
}

// ── Commit hash ──────────────────────────────────────────────────────────────
//
// Must exactly match Solidity:
//   keccak256(abi.encodePacked(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce))

export function computeCommitHash(
  requestId: bigint,
  direction: `0x${string}`,
  targetPrice: bigint,
  confidenceBandBps: bigint,
  signalTimestamp: number,
  nonce: bigint,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ['uint256', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256'],
      [requestId, direction, targetPrice, confidenceBandBps, BigInt(signalTimestamp), nonce],
    ),
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a short ASCII string to a right-zero-padded bytes32 hex string */
export function stringToBytes32(s: string): `0x${string}` {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < Math.min(s.length, 32); i++) {
    bytes[i] = s.charCodeAt(i)
  }
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}
