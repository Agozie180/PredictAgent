# PredictAgent — Architecture

## Overview

PredictAgent is a pay-per-signal marketplace. AI agents (buyers) pay USDC to request a price-movement signal from a seller agent. The seller uses a commit-reveal scheme to prove the signal was fixed before the window opened — not invented after the fact.

Three on-chain contracts ship in this repo, each addressing a specific design goal:

| Contract | Goal |
|---|---|
| `PredictAgent` | Core single-seller escrow. Permissioned verifier. Production-ready. |
| `PredictAgentChainlink` | Trustless upgrade: Chainlink Data Feeds + Automation. |
| `SellerRegistry` | Multi-seller marketplace: any address can register as a seller. |

---

## System diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Arc Mainnet                          │
│                                                          │
│  ┌──────────────────┐    ┌───────────────────────────┐  │
│  │  PredictAgent    │    │  PredictAgentChainlink    │  │
│  │  (primary)       │    │  (upgrade path)           │  │
│  │                  │    │                           │  │
│  │  requestSignal() │    │  requestSignal()          │  │
│  │  commitSignal()  │    │  commitSignal()           │  │
│  │  revealSignal()  │    │  revealSignal()           │  │
│  │  recordOutcome() │    │  settleWithChainlink()    │  │
│  │  claimRefund()   │    │  checkUpkeep()            │  │
│  │                  │    │  performUpkeep()          │  │
│  │  USDC escrow     │    │                           │  │
│  └──────────────────┘    │  ← Chainlink Data Feeds  │  │
│           │              │  ← Chainlink Automation  │  │
│           │              └───────────────────────────┘  │
│           │                                              │
│  ┌────────▼────────┐     ┌───────────────────────────┐  │
│  │  SellerRegistry │     │  USDC (Arc predeploy)     │  │
│  │  (multi-seller) │     │  0x3600...0000            │  │
│  │                 │     └───────────────────────────┘  │
│  │  register()     │                                    │
│  │  requestSignalFrom()                                 │
│  └─────────────────┘                                    │
└─────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                    Off-chain                              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Signal Service (Bun, port 3001)                 │   │
│  │                                                  │   │
│  │  marketData.ts  →  Binance → Kraken → CoinGecko │   │
│  │  indicators.ts  →  RSI, EMA, MACD, BB, ATR      │   │
│  │  signal.ts      →  computeSignal(), backtest()  │   │
│  │  index.ts       →  REST API + persistence       │   │
│  └──────────────────────────────────────────────────┘   │
│                          ↑                               │
│  ┌───────────────────────┴──────────────────────────┐   │
│  │  React Frontend (Vite, port 5173)                │   │
│  │                                                  │   │
│  │  MarketTicker  →  live spot prices               │   │
│  │  SignalFeed    →  open windows, reputation       │   │
│  │  SignalPreview →  indicator breakdown            │   │
│  │  BuySignal     →  approve USDC + requestSignal  │   │
│  │  RequestDetail →  status, countdown, result     │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## Commit-reveal scheme

The commit-reveal prevents the seller from choosing a direction after seeing price movement.

**Hash preimage (must match on-chain exactly):**
```
keccak256(abi.encodePacked(
    requestId,           // uint256
    direction,           // bytes32 (ASCII left-padded: "BULLISH" or "BEARISH")
    targetPrice,         // uint256 (6-decimal USDC units)
    confidenceBandBps,   // uint256 (basis points, e.g. 500 = ±5%)
    signalTimestamp,     // uint256 (unix seconds)
    nonce                // uint256 (random, prevents replay)
))
```

**Direction encoding:**
```
BULLISH = 0x42554c4c495348000000000000000000000000000000000000000000000000  (32 bytes)
BEARISH = 0x4245415249534800000000000000000000000000000000000000000000000000  (32 bytes)
```

Both the TypeScript `computeCommitHash()` and the Solidity `keccak256(abi.encodePacked(...))` produce identical hashes.

---

## State machine (PredictAgent)

```
                requestSignal()
PENDING ──────────────────────────────────────────────────────┐
   │                                                          │
   │ commitSignal()                            claimRefund()  │
   │ (before windowOpen)               (after buyerReveal-   │
   │                                    Deadline)            │
   ▼                                                          │
COMMITTED                                                     │
   │                                          claimRefund()  │
   │ revealSignal()                    (after buyerReveal-   │
   │ (after windowClose,                Deadline)            │
   │  within buyerRevealDeadline)                            │
   ▼                                                          │
REVEALED                                                      │
   │                                          claimRefund()  │
   │ recordOutcome(true/false)         (after outcomeDeadline │
   │ OR settleWithChainlink()           Offset)              │
   │                                                          │
   ├── correct=true ──► SETTLED (seller receives feePaid)    │
   │                                                          │
   └── correct=false ─► REFUNDED (buyer receives feePaid) ◄──┘
```

Key invariants:
- State transitions are strictly forward — no reversion to an earlier state
- `feePaid` is snapshotted at creation — fee changes never affect in-flight requests
- `buyerRevealDeadline` is set at creation within `[minRevealOffset, maxRevealOffset]`
- Funds cannot be permanently locked at any state

---

## Happy path sequence

```
Buyer                 Contract              Seller Agent          Verifier
  │                      │                       │                    │
  │── approve(USDC) ────►│                       │                    │
  │── requestSignal() ──►│ PENDING               │                    │
  │                      │──── emit RequestCreated ─────────────────► │
  │                      │                       │                    │
  │  (before windowOpen) │                       │                    │
  │                      │◄── commitSignal(hash)─┤                    │
  │                      │ COMMITTED             │                    │
  │                      │                       │                    │
  │  (windowOpen → windowClose: signal window live)                   │
  │                      │                       │                    │
  │  (after windowClose) │                       │                    │
  │                      │◄── revealSignal() ────┤                    │
  │                      │ REVEALED              │                    │
  │                      │                       │                    │
  │                      │◄────────── recordOutcome(true) ────────────┤
  │                      │ SETTLED               │                    │
  │                      │──── transfer(seller, feePaid) ────────────►│
  │                      │                       │                    │
```

---

## Hash mismatch / missed reveal — refund path

```
Buyer                 Contract              Seller Agent
  │                      │                       │
  │── requestSignal() ──►│ PENDING               │
  │                      │                       │
  │  (seller commits wrong hash or misses reveal deadline)
  │                      │                       │
  │  (after windowClose + buyerRevealDeadline)   │
  │── claimRefund() ────►│                       │
  │                      │ REFUNDED              │
  │◄── transfer(buyer, feePaid) ─────────────────│
```

---

## Chainlink upgrade path (PredictAgentChainlink)

Replaces `recordOutcome(bool)` with `settleWithChainlink(requestId)`:

```
settleWithChainlink(requestId):
  1. Read feed price:  AggregatorV3Interface(priceFeeds[tokenSymbol]).latestRoundData()
  2. Normalize to 6 decimals
  3. Check staleness:  block.timestamp - updatedAt <= maxStaleness
  4. Compute:          |feedPrice - targetPrice| / targetPrice <= confidenceBandBps / 10_000
  5. If hit  → _settle(requestId)  (pay seller)
  6. If miss → _refund(requestId) (pay buyer)
```

Chainlink Automation: `checkUpkeep(abi.encode(fromId, toId))` scans a range of request IDs and returns the first REVEALED request with a live, non-stale feed. `performUpkeep(abi.encode(requestId))` calls `settleWithChainlink`.

---

## Signal engine (DEMO v1)

```
fetchCandles(token, 60)         ← Binance → Kraken → CoinGecko (circuit-breaker)
        │
        ▼
computeSignal(token, candles)
        │
        ├── RSI(14)              vote: <30 bullish, >70 bearish
        ├── EMA(20/50) cross     vote: EMA20 > EMA50 bullish
        ├── MACD(12,26,9) hist   vote: positive bullish
        ├── Bollinger position   vote: near lower band bullish
        ├── Volume ratio         vote: >1.0 confirms direction
        └── 24h change           vote: positive bullish
                │
                ▼
        direction = majority vote
        strengthScore = weighted alignment (0–100)
        targetPrice = lastClose ± 1×ATR(14) → 6-decimal bigint
        confidenceBandBps = 1.5×ATR% clamped [300, 2000]
        nonce = 8 random bytes
        commitHash = keccak256(abi.encodePacked(requestId, ...))
```

---

## Data flow: buyer agent integration

```
1. GET /api/signal/latest?token=BTC
   → { direction, strengthScore, reasoning, targetPrice, confidenceBandBps }

2. Approve USDC: contract.approve(PREDICT_AGENT_ADDRESS, signalFeeUsdc)

3. requestSignal(token, windowOpen, windowClose, 0)
   → receipt.logs → decodeEventLog(RequestCreated) → requestId

4. GET /api/signal/:requestId
   → { commitHash, revealData } (only available after seller commits)

5. Poll getRequest(requestId) until status == SETTLED or REFUNDED
```

See [server/README.md](server/README.md) for full curl/TypeScript examples.

---

## Security properties

| Property | Mechanism |
|---|---|
| Seller cannot front-run direction | Commit hash submitted before `windowOpen`; reveal checked against stored hash |
| Buyer cannot deny payment | USDC transferred to contract at request time; no buyer action needed for settlement |
| Reentrancy | `nonReentrant` on all external functions that transfer USDC |
| Checks-effects-interactions | Status updated before USDC transfer in `_settle` and `_refund` |
| Authorization event trail | `VerifierUpdated` emitted on every verifier change |
| Permanent pause prevention | `renounceOwnership()` reverts when `paused == true` |
| Fee integrity | `feePaid` snapshotted per-request; `setFee` only affects future requests |
| Fund lock prevention | Buyer escape hatch at every non-terminal state |
