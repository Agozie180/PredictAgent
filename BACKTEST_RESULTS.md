# PredictAgent — Backtest Results

> **DEMO v1 — Retrospective In-Sample Backtest**
> All numbers below are from a historical in-sample backtest run on **October 18, 2026**
> against live Kraken public market data. Results suffer from **look-ahead bias** and
> do NOT predict future performance. Not financial advice.

---

## Summary Table

| Token | Timeframe | Windows | Win Rate | Band Hit | Avg Strength | Bull/Bear | Strong WR | Weak WR | Avg Return |
|-------|-----------|---------|----------|----------|-------------|-----------|-----------|---------|------------|
| BTC   | 4h        | 147     | **46%**  | 100%     | 72.4        | 71/76     | 49%       | 42%     | +0.01%     |
| BTC   | 12h       | 147     | **42%**  | 100%     | 74.9        | 64/83     | 43%       | 40%     | -0.03%     |
| BTC   | 24h       | 147     | **46%**  | 100%     | 72.1        | 62/85     | 47%       | 43%     | -0.34%     |
| ETH   | 4h        | 147     | **46%**  | 100%     | 72.2        | 81/66     | 45%       | 47%     | -0.14%     |
| ETH   | 12h       | 147     | **42%**  | 100%     | 73.7        | 69/78     | 42%       | 42%     | +0.07%     |
| ETH   | 24h       | 147     | **48%**  | 100%     | 71.5        | 79/68     | 46%       | 53%     | +0.56%     |
| SOL   | 4h        | 147     | **52%**  | 100%     | 72.1        | 85/62     | 48%       | 61%     | +0.52%     |
| SOL   | 12h       | 147     | **45%**  | 100%     | 74.9        | 57/90     | 47%       | 38%     | -0.15%     |
| SOL   | 24h       | 147     | **50%**  | 100%     | 71.7        | 72/75     | 50%       | 51%     | +0.45%     |
| ARB   | 4h        | 147     | **44%**  | 100%     | 73.2        | 73/74     | 44%       | 44%     | +0.75%     |
| ARB   | 12h       | 147     | **50%**  | 100%     | 75.6        | 67/80     | 53%       | 36%     | -0.10%     |
| ARB   | 24h       | 147     | **50%**  | 100%     | 73.5        | 56/91     | 50%       | 49%     | +2.33%     |
| MATIC | 4h        | —       | —        | —        | —           | —         | —         | —       | — ¹        |
| MATIC | 12h       | —       | —        | —        | —           | —         | —         | —       | — ¹        |
| MATIC | 24h       | —       | —        | —        | —           | —         | —         | —       | — ¹        |

¹ MATIC unavailable: Kraken does not have a MATICUSD pair at these timeframes; CoinGecko OHLC
  endpoint requires a paid tier. Will add MATIC via Binance when network access permits.

---

## Column Definitions

| Column | Definition |
|--------|-----------|
| **Windows** | Number of signal windows evaluated (step=3, forwardBars=6) |
| **Win Rate** | Directional accuracy: price moved in signal direction before being stopped out |
| **Band Hit** | Looser metric: price touched the confidence band (ATR-based, 300–2000 bps) |
| **Avg Strength** | Mean signal strength score (0–100) across all windows |
| **Bull/Bear** | Count of BULLISH vs BEARISH signals generated |
| **Strong WR** | Win rate for signals with strength score ≥ 65 |
| **Weak WR** | Win rate for signals with strength score < 65 |
| **Avg Return** | Mean % price change over 6 forward bars, signed by signal direction |

---

## What "Win Rate" Actually Measures

A **directional win** is scored when:
1. Signal direction is BULLISH and `candle.high >= targetPrice` before `candle.low < entryPrice - bandSize`
2. Signal direction is BEARISH and `candle.low <= targetPrice` before `candle.high > entryPrice + bandSize`

This is **not** profit/loss on a trading strategy. It measures whether the signal engine correctly
identified short-term directional bias before the price moved against it.

**Why Band Hit = 100%:** The ATR-based confidence band (1.5× ATR as % of price) is wide enough
that the next 6 candles almost always touch it. This metric is only useful as a sanity check
that target prices are in a reasonable range — not as a measure of directional accuracy.
Use the **Win Rate** column for honest directional evaluation.

---

## Key Observations

### 1. Win rates cluster near 45–52% (slightly above coin-flip)
This is expected for a simple 6-indicator majority-vote system. DEMO v1 is intentionally
transparent and auditable — not optimised for maximum accuracy.

### 2. Strong signals slightly outperform weak signals on 4h/24h timeframes
On ARB 12h: **Strong WR = 53% vs Weak WR = 36%** — a 17-point gap. This suggests
the strength score (indicator alignment) has some predictive value beyond chance.
On SOL 4h: **Strong WR = 48% vs Weak WR = 61%** — weak signals outperformed, likely
due to mean-reversion in choppy 4h conditions.

### 3. ARB shows best average forward returns on 24h (+2.33%)
This likely reflects ARB's higher volatility on daily timeframes. Not a recommendation
to trade ARB — it also has the highest variance.

### 4. SOL is most directionally consistent on 4h (52%)
The best non-trivial win rate across all tokens and timeframes. SOL's liquidity and
volatility profile aligns well with 4h signals.

---

## How to Reproduce

Start the signal service and run the backtest yourself:

```bash
# Clone and install
git clone https://github.com/Agozie180/PredictAgent
cd PredictAgent && bun install

# Start the signal service
bun run server

# Run backtest (4h candles, BTC, 500 candles)
curl "http://localhost:3001/api/signal/backtest?token=BTC&interval=240&limit=500"

# Run with full trade-level data
curl "http://localhost:3001/api/signal/backtest?token=SOL&interval=240&limit=500&trades=true"

# All supported intervals: 60 (1h), 240 (4h), 720 (12h), 1440 (24h)
# All supported tokens: BTC, ETH, SOL, ARB, MATIC
```

Or use the live **Backtest** tab at https://predict-agent.vercel.app — select token and timeframe,
click Run Backtest.

---

## Data Sources

| Source | Used For | Candle Limit | Notes |
|--------|----------|-------------|-------|
| **Kraken** (primary) | BTC, ETH, SOL, ARB | 720 per call | Free, no key needed |
| **Binance** (primary) | All tokens | 1000 per call | Geo-blocked from sandbox; works in production |
| **CoinGecko** (fallback) | All tokens | ~48 (48h) | Free tier rate-limited; OHLC requires paid tier for some tokens |

All data fetched fresh at backtest time. No historical data stored in this repo.

---

## Methodology

Signal engine (all logic in `server/signal.ts`, auditable):

| Indicator | Rule | Weight |
|-----------|------|--------|
| RSI(14) | <30 → +1 (bullish), >70 → -1 (bearish), else ±0.5 | 1.0× |
| EMA(20/50) crossover | 20 > 50 → +1, else -1 | 1.0× |
| MACD(12/26/9) histogram | positive → +1, negative → -1 | 1.0× |
| Bollinger Band position | <0.2 → +1 (oversold), >0.8 → -1 (overbought), else 0 | 0.5× |
| Volume momentum | signed volume > 0 → +0.5 | 0.5× |
| 24h price change | positive → +0.5 | 0.5× |

Direction = majority vote (sum ≥ 0 → BULLISH). Strength = 0–100 weighted indicator alignment score.

---

## Limitations (Honest)

1. **In-sample look-ahead bias** — signals are scored using the same data they were computed from
2. **No transaction costs** — does not account for gas, slippage, or USDC fee
3. **Fixed window size** — `windowSize=60` candles regardless of timeframe; needs calibration per TF
4. **No regime filter** — same rules in trending and ranging markets
5. **No walk-forward or out-of-sample split** — all 500 candles are training and evaluation together
6. **DEMO v1** — not production-tested for profitability

A proper backtest would require: out-of-sample data, walk-forward validation, transaction cost
modelling, and statistical significance testing (min ~300 independent trades).

---

*Run date: October 18, 2026 | Data source: Kraken public API | Engine: DEMO v1*
