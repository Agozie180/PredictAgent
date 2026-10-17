# PredictAgent — Security Audit

> Self-audit conducted against the unified rule corpus at balanced severity.
> All findings were fixed before deployment. Each fix has a named regression test.
> This document is not a substitute for an independent professional security review.

---

## Scope

| File | Lines | Status |
|---|---|---|
| `contracts/PredictAgent.sol` | ~390 | Audited + fixed |
| `contracts/PredictAgentChainlink.sol` | ~500 | Reviewed (upgrade path) |
| `contracts/SellerRegistry.sol` | ~360 | Reviewed |
| `server/signal.ts` | ~300 | Logic review only — off-chain |

---

## Findings — PredictAgent.sol (all fixed)

### Finding 1 — Critical: Mutable global fee breaks escrow accounting

**Rule:** adversary-resistant escrow
**Location:** `_settle()`, `_refund()`, `setFee()`

**Description:** `_settle` and `_refund` originally used the global `signalFeeUsdc` to determine transfer amounts. If the owner called `setFee()` between a request creation and its settlement, the transferred amount could differ from what the buyer deposited — either draining pooled funds from other buyers (overpayment) or underpaying the intended amount (underpayment). An increased fee could cause the transfer to revert, permanently locking the buyer's funds.

**Fix:** Added `feePaid` field to `SignalRequest`, set at creation time to `signalFeeUsdc`. Both `_settle` and `_refund` now use `req.feePaid`.

**Regression test:** `testFuzz_SettleCyclePreservesUSDC` (256 fuzz runs across full fee range)

---

### Finding 2 — Critical: REVEALED deadlock — buyer cannot recover funds if verifier is offline

**Rule:** fund-lock prevention
**Location:** `claimRefund()`, `recordOutcome()`

**Description:** After a request reached `REVEALED` status, funds could only be released by the verifier (or owner) calling `recordOutcome`. If the verifier became unavailable or unresponsive, buyer funds were permanently locked with no escape path.

**Fix:**
- Added `outcomeDeadlineOffset` (default 86400 = 24h).
- `claimRefund` now accepts `REVEALED` status when `block.timestamp > windowClose + buyerRevealDeadline + outcomeDeadlineOffset`.
- Added `setOutcomeDeadlineOffset(uint256)` owner function with `OutcomeDeadlineOffsetUpdated` event.

**Regression test:** `test_ClaimRefund_AfterOutcomeDeadline_REVEALED`, `test_ClaimRefund_BeforeOutcomeDeadline_REVEALED_Reverts`

---

### Finding 3 — High: setVerifier emits no event — authorization change is silent

**Rule:** emit-events-access-control
**Location:** `setVerifier()`

**Description:** `setVerifier` changes who is authorized to call `recordOutcome` for a request. No event was emitted, making it impossible for off-chain monitors to detect verifier rotations in real time.

**Fix:** Added `VerifierUpdated(uint256 indexed requestId, address indexed oldVerifier, address indexed newVerifier)` event. `setVerifier` captures the old verifier, updates, and emits.

**Regression test:** `test_SetVerifier_EmitsVerifierUpdated`, `test_SetVerifier_UpdateExisting_EmitsVerifierUpdated`

---

### Finding 4 — High: renounceOwnership while paused permanently bricks the contract

**Rule:** pause-without-viable-unpause
**Location:** Inherited `Ownable.renounceOwnership()`

**Description:** `pause()` and `unpause()` are both `onlyOwner`. The inherited `renounceOwnership()` was enabled without restriction. An owner could pause the contract and then renounce ownership, making it impossible to ever call `unpause()`. This would permanently prevent new signal requests.

**Fix:** Overrode `renounceOwnership()` to revert with `PredictAgent__RenounceDisabled()` when `paused == true`. When not paused, it delegates to `super.renounceOwnership()` normally.

**Regression test:** `test_RenounceOwnership_RevertsWhenPaused`, `test_RenounceOwnership_SucceedsWhenNotPaused`

---

## Additional hardening (not from initial audit)

### Buyer-configurable reveal timeout

Buyers can now pass a `buyerRevealOffset` to `requestSignal`, within owner-set bounds `[minRevealOffset, maxRevealOffset]` (defaults: 1h–48h). This gives buyers more control over their refund timing without requiring the owner to change the global offset. Out-of-bounds values revert with `PredictAgent__RevealOffsetOutOfBounds(requested, min, max)`.

**Tests:** `test_BuyerRevealOffset_Custom_SetsDeadline`, `test_BuyerRevealOffset_TooLow_Reverts`, `test_BuyerRevealOffset_TooHigh_Reverts`

---

## PredictAgentChainlink.sol — known limitations (not findings)

These are design constraints, not vulnerabilities:

1. **Feed heartbeat lag:** Settlement uses the feed price at `settleWithChainlink` call time, not the real-time price at `windowClose`. A caller can wait for a favorable feed update within the settlement window. Mitigation: use settlement windows shorter than the feed's heartbeat (~1h for most Chainlink feeds on Arc).

2. **Feed staleness:** Prices older than `maxStaleness` (default 3600s) cause `settleWithChainlink` to revert. If the feed is stale at settlement time, the buyer's `claimRefund` escape hatch remains available after `outcomeDeadlineOffset`.

3. **Feed decimals:** Chainlink ETH/USD returns 8 decimals. `_readFeedPrice` normalizes to 6-decimal USDC units before comparison. BTC/USD is also 8 decimals. Feed decimals are read dynamically via `feed.decimals()`.

---

## What this audit does NOT cover

- Formal verification
- Economic attacks on signal pricing / fee levels
- Chainlink oracle manipulation (see Chainlink's own security documentation)
- SellerRegistry staking / slashing logic (not implemented — stated as a future extension)
- Cross-contract reentrancy between PredictAgent and SellerRegistry (they are independent deployments)
- Smart contract wallet / ERC-4337 compatibility

---

## Test coverage

| Suite | Tests | Passed |
|---|---|---|
| PredictAgent Foundry | 51 | 51/51 |
| Signal engine (TypeScript) | 25 | 25/25 |

Run: `forge test -vv && bun test server/signal.test.ts`
