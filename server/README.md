# PredictAgent Signal Service — Agent Integration Guide

**DEMO v1** — Signal logic is illustrative only, not financial advice.  
Past results do not guarantee future outcomes.

---

## Overview

The signal service is a Bun HTTP server on port 3001, proxied through Vite at `/api`.  
It fetches public market data (Binance, CoinGecko fallback), computes technical signals,  
and drives the on-chain commit-reveal flow.

**Supported tokens:** BTC, ETH, SOL, ARB, MATIC

---

## Starting the service

```bash
bun run server
```

---

## REST API

All endpoints are accessible at `http://localhost:3001` or via the Vite proxy at `/api`.

### `GET /health`
Service health check.

```json
{
  "status": "ok",
  "version": "demo-v1",
  "supportedTokens": ["BTC", "ETH", "SOL", "ARB", "MATIC"],
  "cachedSignals": ["BTC", "ETH"],
  "committedRequests": 3
}
```

---

### `GET /prices`
Live spot prices for all supported tokens (updates every 60s).

```json
{
  "prices": [
    {
      "token": "BTC",
      "price": 67420.50,
      "change24hPct": 2.14,
      "high24h": 68100.00,
      "low24h": 65900.00,
      "volume24h": 18400000000,
      "fetchedAt": 1729123456789
    }
  ],
  "fetchedAt": 1729123456789
}
```

---

### `GET /signal/latest?token=BTC`
Latest computed signal with full indicator reasoning.

**Query params:** `token` (required) — one of `BTC`, `ETH`, `SOL`, `ARB`, `MATIC`

```json
{
  "note": "DEMO v1 — Signals are informational only, not financial advice.",
  "token": "BTC",
  "direction": "BULLISH",
  "strengthScore": 72,
  "strengthLabel": "STRONG",
  "reasoning": {
    "rsi": 58.3,
    "macdHistogram": 42.17,
    "ema20": 67100.0,
    "ema50": 65800.0,
    "ema20AboveEma50": true,
    "bbPosition": 0.61,
    "bbBandwidth": 0.043,
    "volumeRatio": 1.34,
    "change24hPct": 2.14,
    "atrPct": 1.12,
    "strengthScore": 72,
    "summary": "4/6 indicators bullish. RSI 58 (neutral). EMA20 above EMA50. MACD histogram positive. Volume 1.34× avg. 24h change +2.14%."
  },
  "targetPriceUsd": "68573.22",
  "confidenceBandPct": "1.68%",
  "signalTimestamp": 1729123000,
  "requestId": null,
  "commitHash": null
}
```

---

### `GET /signal/:requestId`
Signal associated with a specific on-chain request ID.

Returns the same shape as `/signal/latest`, with `requestId` and `commitHash` populated.

---

### `POST /signal/commit`
Associate a fresh signal with an on-chain request ID.  
The seller agent calls this after the buyer's `requestSignal` transaction confirms.

**Request body:**
```json
{
  "token": "BTC",
  "requestId": "1"
}
```

**Response:**
```json
{
  "requestId": "1",
  "token": "BTC",
  "commitHash": "0xabc123...",
  "strengthScore": 72,
  "reasoning": { ... },
  "revealData": {
    "direction": "0x42554c4c49534800000000000000000000000000000000000000000000000000",
    "targetPrice": "68573220000",
    "confidenceBandBps": "168",
    "signalTimestamp": 1729123000,
    "nonce": "12345678901234"
  },
  "note": "DEMO v1. Call commitSignal(requestId, commitHash) on-chain. Keep revealData secret until after windowClose."
}
```

**IMPORTANT:** Keep `revealData` secret until after `windowClose`. Revealing it early breaks the commit-reveal scheme.

---

## On-chain flow (complete cycle)

### 1. Buyer requests a signal

The buyer calls `requestSignal(tokenSymbol, windowOpen, windowClose)` on the contract (after approving USDC).  
Use the UI or call directly with cast:

```bash
cast send $CONTRACT \
  "requestSignal(string,uint256,uint256)" \
  "BTC" \
  $WINDOW_OPEN \
  $WINDOW_CLOSE \
  --rpc-url https://rpc.arc.io \
  --private-key $BUYER_KEY
```

Record the `requestId` from the `RequestCreated` event (first indexed topic).

### 2. Seller commits signal hash (before windowOpen)

Call `POST /signal/commit` with the requestId, then submit the returned `commitHash` on-chain:

```bash
cast send $CONTRACT \
  "commitSignal(uint256,bytes32)" \
  $REQUEST_ID \
  $COMMIT_HASH \
  --rpc-url https://rpc.arc.io \
  --private-key $SELLER_KEY
```

### 3. Owner sets verifier (optional but recommended)

```bash
cast send $CONTRACT \
  "setVerifier(uint256,address)" \
  $REQUEST_ID \
  $VERIFIER_ADDRESS \
  --rpc-url https://rpc.arc.io \
  --private-key $OWNER_KEY
```

### 4. Seller reveals signal (after windowClose, before revealDeadline)

Use the `revealData` values from step 2:

```bash
cast send $CONTRACT \
  "revealSignal(uint256,bytes32,uint256,uint256,uint256,uint256)" \
  $REQUEST_ID \
  $DIRECTION_BYTES32 \
  $TARGET_PRICE \
  $CONFIDENCE_BAND_BPS \
  $SIGNAL_TIMESTAMP \
  $NONCE \
  --rpc-url https://rpc.arc.io \
  --private-key $SELLER_KEY
```

### 5. Verifier records outcome

```bash
cast send $CONTRACT \
  "recordOutcome(uint256,bool)" \
  $REQUEST_ID \
  true \
  --rpc-url https://rpc.arc.io \
  --private-key $VERIFIER_KEY
```

`true` = signal was correct (seller paid). `false` = signal was incorrect (buyer refunded).

### 6. Settlement

Settlement happens automatically inside `recordOutcome`. If the seller misses the reveal deadline, buyers can call `claimRefund(requestId)` after the timeout.

---

## Signal logic (DEMO v1)

Signal direction is determined by majority vote across 6 indicators:

| Indicator | Bullish condition | Bearish condition |
|---|---|---|
| RSI (14) | < 30 (oversold) or 50–70 (trending) | > 70 (overbought) or 30–50 |
| EMA 20/50 crossover | EMA20 > EMA50 | EMA20 < EMA50 |
| MACD histogram | Positive | Negative |
| Bollinger Band position | Near lower band (< 20%) | Near upper band (> 80%) |
| Signed volume momentum | Positive (buying pressure) | Negative |
| 24h price change | Positive | Negative |

**Target price:** last close ± 1× ATR (Average True Range)  
**Confidence band:** 1.5× ATR as % of price, clamped to ±3%–±20%  
**Strength score:** 0–100 based on indicator alignment and volume confirmation

See `server/signal.ts` and `server/indicators.ts` for full implementation.

---

## Persistence

Signals are persisted to `server/.signal-store.json`. The service rehydrates on restart so committed signals survive. Do not delete this file between `commit` and `reveal`.

---

## Timeouts (default contract values)

| Parameter | Default | Description |
|---|---|---|
| `revealDeadlineOffset` | 1 hour | Seller must reveal within this time after windowClose |
| `outcomeDeadlineOffset` | 24 hours | Buyer can claim refund if verifier doesn't record outcome |

---

## Disclaimer

DEMO v1. Signal logic has not been independently validated and is provided for illustrative purposes only. Not financial advice. Past results do not guarantee future outcomes.
