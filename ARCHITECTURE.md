# PredictAgent — Architecture

## One-line thesis

> The seller cannot receive payment unless the on-chain commitment hash matches the reveal — enforced structurally, not by trust.

---

## State machine

Each `SignalRequest` moves through exactly these states. No transitions are reversible.

```
                    ┌─────────────┐
                    │   PENDING   │  ← requestSignal() — fee in escrow
                    └──────┬──────┘
                           │ commitSignal() — before windowOpen
                           ▼
                    ┌─────────────┐
                    │  COMMITTED  │  ← hash locked on-chain
                    └──────┬──────┘
                           │ revealSignal() — after windowClose, hash verified
                           ▼
                    ┌─────────────┐
                    │  REVEALED   │  ← signal public
                    └──────┬──────┘
               ____________│____________
              │                         │
    recordOutcome(true)       recordOutcome(false) OR
    (verifier/owner)          claimRefund() after outcomeDeadlineOffset
              │                         │
              ▼                         ▼
        ┌──────────┐             ┌──────────────┐
        │ SETTLED  │             │   REFUNDED   │
        └──────────┘             └──────────────┘
         seller paid              buyer refunded

Timeout paths:
  PENDING  → REFUNDED  via claimRefund() after windowClose + revealDeadlineOffset
  COMMITTED → REFUNDED  via claimRefund() after windowClose + revealDeadlineOffset
  REVEALED  → REFUNDED  via claimRefund() after windowClose + revealDeadlineOffset + outcomeDeadlineOffset
```

---

## Sequence diagram — happy path (signal correct)

```
Buyer              USDC            PredictAgent          SellerAgent        Verifier
  │                  │                   │                    │                 │
  │─approve()───────►│                   │                    │                 │
  │                  │                   │                    │                 │
  │─requestSignal()──────────────────────►                    │                 │
  │                  │◄─transferFrom()───│                    │                 │
  │                  │                   │──RequestCreated──► (event)           │
  │                  │                   │                    │                 │
  │                  │         [before windowOpen]            │                 │
  │                  │                   │◄──commitSignal()───│                 │
  │                  │                   │  [hash stored]     │                 │
  │                  │                   │──SignalCommitted──► (event)          │
  │                  │                   │                    │                 │
  │                  │         [window open → close]          │                 │
  │                  │                   │                    │                 │
  │                  │         [after windowClose]            │                 │
  │                  │                   │◄──revealSignal()───│                 │
  │                  │                   │  [hash verified]   │                 │
  │                  │                   │──SignalRevealed───► (event)          │
  │                  │                   │                    │                 │
  │                  │                   │◄────────────────────────recordOutcome(true)
  │                  │                   │  [status → SETTLED]│                 │
  │                  │◄─transfer()───────│  [fee to seller]   │                 │
  │                  │                   │──RequestSettled───► (event)          │
```

---

## Sequence diagram — hash mismatch (refund)

```
Buyer              USDC            PredictAgent          SellerAgent
  │                  │                   │                    │
  │─requestSignal()──────────────────────►                    │
  │                  │◄─transferFrom()───│                    │
  │                  │                   │◄──commitSignal()───│
  │                  │                   │  [hash H1 stored]  │
  │                  │         [window closes]                │
  │                  │                   │◄──revealSignal()───│  [data D2 ≠ H1]
  │                  │                   │  REVERT: HashMismatch
  │                  │                   │                    │
  │─claimRefund()────────────────────────►  [after deadline]  │
  │                  │◄─transfer()───────│  [fee returned]    │
  │                  │                   │──RequestRefunded──► (event)
```

---

## Commit hash specification

Must match **exactly** between the signal service (`server/signal.ts`) and the Solidity contract (`contracts/PredictAgent.sol`):

```solidity
// Solidity
keccak256(abi.encodePacked(requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce))
// types:  uint256    bytes32    uint256      uint256           uint256           uint256
```

```typescript
// TypeScript (server/signal.ts)
keccak256(encodePacked(
  ['uint256', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256'],
  [requestId, direction, targetPrice, confidenceBandBps, BigInt(signalTimestamp), nonce]
))
```

`direction` is a right-zero-padded `bytes32` ASCII encoding:
- `BULLISH` = `0x42554c4c49534800000000000000000000000000000000000000000000000000`
- `BEARISH` = `0x4245415249534800000000000000000000000000000000000000000000000000`

---

## Signal engine (DEMO v1)

```
Binance 1h candles (60 candles)
          │
          ▼
┌─────────────────────────────────────┐
│  computeSignal() — server/signal.ts  │
│                                     │
│  Indicators (server/indicators.ts): │
│  ┌──────────────────────────────┐   │
│  │ 1. RSI(14)       vote ±1     │   │
│  │ 2. EMA(20/50)    vote ±1     │   │
│  │ 3. MACD(12/26/9) vote ±1     │   │
│  │ 4. Bollinger(20) vote ±1     │   │
│  │ 5. Volume ratio  vote ±0.5   │   │
│  │ 6. 24h change    vote ±0.5   │   │
│  └──────────────────────────────┘   │
│                                     │
│  direction = majority vote          │
│  target    = lastClose ± 1× ATR     │
│  band      = 1.5× ATR% (300–2000bps)│
│  strength  = 0–100 alignment score  │
└─────────────────────────────────────┘
          │
          ▼
  SignalOutput { direction, targetPrice,
    confidenceBandBps, nonce, commitHash() }
```

---

## Key parameters (owner-configurable)

| Parameter | Default | Setter |
|---|---|---|
| `signalFeeUsdc` | Set at deploy | `setFee()` |
| `revealDeadlineOffset` | 3600s (1h) | `setRevealDeadlineOffset()` |
| `outcomeDeadlineOffset` | 86400s (24h) | `setOutcomeDeadlineOffset()` |
| `seller` | Set at deploy | `setSeller()` |
| `paused` | false | `pause()` / `unpause()` |

---

## USDC on Arc

Arc is an EVM chain where USDC is the native gas token. The USDC ERC-20 contract is at the Arc predeploy address `0x3600000000000000000000000000000000000000`. The contract uses `IERC20(USDC).transferFrom` and `IERC20(USDC).transfer` — standard ERC-20 calls work identically to any other chain.
