/**
 * Unit tests for PredictAgent signal engine (DEMO v1).
 * Run: bun test server/signal.test.ts
 */

import { describe, it, expect } from 'bun:test'
import { computeSignal, computeCommitHash, stringToBytes32, type Candle } from './signal'
import { ema, rsi, bollingerBands, macd, volumeMetrics, atr, signalStrengthScore } from './indicators'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate synthetic candles with a given trend */
function makeCandles(count: number, startPrice: number, trendPctPerCandle: number, volumeBase = 1000): Candle[] {
  const candles: Candle[] = []
  let price = startPrice
  for (let i = 0; i < count; i++) {
    const noise = (Math.random() - 0.5) * price * 0.005
    const open = price
    price = price * (1 + trendPctPerCandle) + noise
    const high = Math.max(open, price) * (1 + Math.random() * 0.003)
    const low = Math.min(open, price) * (1 - Math.random() * 0.003)
    candles.push({
      timestamp: 1_700_000_000 + i * 3600,
      open,
      high,
      low,
      close: price,
      volume: volumeBase + Math.random() * volumeBase * 0.5,
    })
  }
  return candles
}

// ── Indicator tests ───────────────────────────────────────────────────────────

describe('ema()', () => {
  it('returns NaN for first period-1 values', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    const result = ema(closes, 5)
    expect(isNaN(result[0])).toBe(true)
    expect(isNaN(result[3])).toBe(true)
    expect(isNaN(result[4])).toBe(false)
  })

  it('rises when prices rise', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2)
    const result = ema(closes, 5)
    const valid = result.filter(v => !isNaN(v))
    expect(valid[valid.length - 1]).toBeGreaterThan(valid[0])
  })
})

describe('rsi()', () => {
  it('returns values in 0–100 range', () => {
    const candles = makeCandles(60, 30000, 0.002)
    const closes = candles.map(c => c.close)
    const result = rsi(closes, 14)
    for (const v of result.filter(r => !isNaN(r))) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('gives high RSI on sustained uptrend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 3)
    const result = rsi(closes, 14)
    const last = result[result.length - 1]
    expect(last).toBeGreaterThan(70)
  })

  it('gives low RSI on sustained downtrend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i * 3)
    const result = rsi(closes, 14)
    const last = result[result.length - 1]
    expect(last).toBeLessThan(30)
  })
})

describe('bollingerBands()', () => {
  it('upper > middle > lower for all valid values', () => {
    const closes = makeCandles(40, 50000, 0.001).map(c => c.close)
    const bb = bollingerBands(closes, 20, 2)
    for (let i = 19; i < closes.length; i++) {
      expect(bb.upper[i]).toBeGreaterThan(bb.middle[i])
      expect(bb.middle[i]).toBeGreaterThan(bb.lower[i])
    }
  })

  it('bandwidth is positive', () => {
    const closes = makeCandles(40, 50000, 0.001).map(c => c.close)
    const bb = bollingerBands(closes, 20, 2)
    for (const bw of bb.bandwidth.filter(v => !isNaN(v))) {
      expect(bw).toBeGreaterThan(0)
    }
  })
})

describe('macd()', () => {
  it('histogram = macdLine - signalLine', () => {
    const closes = makeCandles(60, 40000, 0.001).map(c => c.close)
    const result = macd(closes, 12, 26, 9)
    for (let i = 0; i < closes.length; i++) {
      if (!isNaN(result.macdLine[i]) && !isNaN(result.signalLine[i])) {
        expect(result.histogram[i]).toBeCloseTo(result.macdLine[i] - result.signalLine[i], 8)
      }
    }
  })
})

describe('atr()', () => {
  it('returns a positive number', () => {
    const candles = makeCandles(30, 60000, 0)
    expect(atr(candles, 14)).toBeGreaterThan(0)
  })
})

describe('volumeMetrics()', () => {
  it('volumeRatio > 1 when last candle volume is high', () => {
    const candles = makeCandles(25, 50000, 0, 1000)
    candles[candles.length - 1].volume = 10000
    const m = volumeMetrics(candles, 20)
    expect(m.volumeRatio).toBeGreaterThan(1)
  })
})

describe('signalStrengthScore()', () => {
  it('returns value in 0–100', () => {
    const snap = { rsiValue: 55, macdHistogram: 100, bbPosition: 0.4, bbBandwidth: 0.04, volumeRatio: 1.3, ema20: 50100, ema50: 49900, lastClose: 50000, change24hPct: 1.5, atrPct: 1.2 }
    const score = signalStrengthScore(snap, 'BULLISH')
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('bullish aligned indicators give score > 60', () => {
    const snap = { rsiValue: 35, macdHistogram: 500, bbPosition: 0.15, bbBandwidth: 0.03, volumeRatio: 1.8, ema20: 50200, ema50: 49500, lastClose: 50000, change24hPct: 2.0, atrPct: 0.8 }
    const score = signalStrengthScore(snap, 'BULLISH')
    expect(score).toBeGreaterThan(60)
  })

  it('opposing indicators give lower score', () => {
    const snap = { rsiValue: 75, macdHistogram: -200, bbPosition: 0.9, bbBandwidth: 0.05, volumeRatio: 0.7, ema20: 49500, ema50: 50200, lastClose: 50000, change24hPct: -1.5, atrPct: 1.5 }
    const scoreBull = signalStrengthScore(snap, 'BULLISH')
    const scoreBear = signalStrengthScore(snap, 'BEARISH')
    expect(scoreBear).toBeGreaterThan(scoreBull)
  })
})

// ── computeSignal() ───────────────────────────────────────────────────────────

describe('computeSignal()', () => {
  it('throws if too few candles', () => {
    expect(() => computeSignal('BTC', makeCandles(10, 50000, 0))).toThrow()
  })

  it('returns valid signal structure regardless of direction', () => {
    // Use stronger trend to reduce noise impact, but don't assert direction
    // (6-indicator majority vote on synthetic data is non-deterministic with noise)
    const candles = makeCandles(60, 50000, 0.002)
    const signal = computeSignal('BTC', candles)
    expect(['BULLISH', 'BEARISH']).toContain(signal.direction)
    expect(Number(signal.targetPrice)).toBeGreaterThan(0)
    expect(Number(signal.confidenceBandBps)).toBeGreaterThanOrEqual(300)
    expect(Number(signal.confidenceBandBps)).toBeLessThanOrEqual(2000)
    expect(signal.strengthScore).toBeGreaterThanOrEqual(0)
    expect(signal.strengthScore).toBeLessThanOrEqual(100)
    expect(signal.reasoning.summary.length).toBeGreaterThan(0)
    expect(signal.reasoning.rsi).toBeGreaterThanOrEqual(0)
    expect(signal.reasoning.rsi).toBeLessThanOrEqual(100)
    expect(signal.nonce).toBeGreaterThan(0n)
  })

  it('gentle uptrend with above-average volume produces BULLISH direction', () => {
    // Gentle uptrend (0.3% per candle) keeps RSI in bullish-confirming range (50–70)
    // rather than overbought (>70 triggers bearish reversal vote)
    const gentleUp: Candle[] = Array.from({ length: 60 }, (_, i) => {
      const p = 50000 * (1 + i * 0.003)
      return { timestamp: 1700000000 + i * 3600, open: p * 0.999, high: p * 1.002, low: p * 0.998, close: p, volume: 1000 + i * 5 }
    })
    const signal = computeSignal('BTC', gentleUp)
    expect(signal.direction).toBe('BULLISH')
  })

  it('strong downtrend produces BEARISH direction (zero noise, steep decline)', () => {
    const strongDown: Candle[] = Array.from({ length: 60 }, (_, i) => {
      const p = 60000 - i * 200  // falling $200 per candle
      return { timestamp: 1700000000 + i * 3600, open: p, high: p * 1.005, low: p * 0.995, close: p, volume: 1000 + i * 10 }
    })
    const signal = computeSignal('BTC', strongDown)
    expect(signal.direction).toBe('BEARISH')
  })

  it('targetPrice is near last close', () => {
    const candles = makeCandles(60, 50000, 0.001)
    const signal = computeSignal('BTC', candles)
    const lastClose = candles[candles.length - 1].close
    const target = Number(signal.targetPrice) / 1e6
    const diffPct = Math.abs(target - lastClose) / lastClose
    expect(diffPct).toBeLessThan(0.10)  // target within 10% of close
  })

  it('nonce is unique across two calls', () => {
    const candles = makeCandles(60, 50000, 0.001)
    const a = computeSignal('ETH', candles)
    const b = computeSignal('ETH', candles)
    expect(a.nonce).not.toBe(b.nonce)
  })
})

// ── Commit-reveal hash ────────────────────────────────────────────────────────

describe('computeCommitHash()', () => {
  it('produces a 0x-prefixed 32-byte hex string', () => {
    const dir = stringToBytes32('BULLISH')
    const hash = computeCommitHash(1n, dir, 50000_000000n, 500n, 1700000000, 12345n)
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('same inputs produce same hash', () => {
    const dir = stringToBytes32('BEARISH')
    const h1 = computeCommitHash(7n, dir, 3000_000000n, 400n, 1700001000, 99n)
    const h2 = computeCommitHash(7n, dir, 3000_000000n, 400n, 1700001000, 99n)
    expect(h1).toBe(h2)
  })

  it('different requestId produces different hash', () => {
    const dir = stringToBytes32('BULLISH')
    const h1 = computeCommitHash(1n, dir, 50000_000000n, 500n, 1700000000, 1n)
    const h2 = computeCommitHash(2n, dir, 50000_000000n, 500n, 1700000000, 1n)
    expect(h1).not.toBe(h2)
  })

  it('commitHash closure on signal matches direct call', () => {
    const candles = makeCandles(60, 50000, 0.001)
    const signal = computeSignal('BTC', candles)
    const requestId = 42n
    const dir32 = stringToBytes32(signal.direction)
    const direct = computeCommitHash(requestId, dir32, signal.targetPrice, signal.confidenceBandBps, signal.timestamp, signal.nonce)
    const fromClosure = signal.commitHash(requestId)
    expect(fromClosure).toBe(direct)
  })
})

describe('stringToBytes32()', () => {
  it('pads BULLISH to 32 bytes', () => {
    const b = stringToBytes32('BULLISH')
    expect(b).toHaveLength(66)  // 0x + 64 hex chars
    expect(b.startsWith('0x42554c4c495348')).toBe(true)  // ASCII "BULLISH"
  })

  it('pads BEARISH to 32 bytes', () => {
    const b = stringToBytes32('BEARISH')
    expect(b).toHaveLength(66)
    expect(b.startsWith('0x4245415249534800')).toBe(true)
  })
})
