# PredictAgent — Security Audit

Internal audit conducted at balanced severity. Four findings identified and fixed. Each fix has a regression test that **would FAIL against the pre-fix code**.

---

## Summary

| Severity | Finding | Status |
|---|---|---|
| Critical | Fee escrow accounting: `_settle`/`_refund` used mutable global fee | Fixed |
| Critical | REVEALED deadlock: buyer funds could lock if verifier goes offline | Fixed |
| High | Missing `VerifierUpdated` event on authorization change | Fixed |
| High | `renounceOwnership` not blocked while paused — permanent pause risk | Fixed |

---

## Finding 1 — Critical: Mutable global fee breaks escrow accounting

**Location:** `PredictAgent._settle`, `PredictAgent._refund`, `PredictAgent.setFee`

**Description:**
Each `requestSignal` call escrows funds at the current `signalFeeUsdc`. However, `_settle` and `_refund` transferred `signalFeeUsdc` (the current global value) rather than the amount the buyer actually paid. If the owner changed the fee between request and settlement:
- A fee increase could cause `_settle`/`_refund` to over-transfer, draining funds from other buyers' escrows.
- A fee decrease would under-pay the seller or buyer.

**Fix:**
Added `feePaid` field to `SignalRequest` struct. Set at request time (`req.feePaid = signalFeeUsdc`). All settlement and refund paths use `req.feePaid`.

```solidity
// Before (vulnerable)
bool ok = IERC20(USDC).transfer(seller, signalFeeUsdc);  // uses mutable global

// After (fixed)
bool ok = IERC20(USDC).transfer(seller, req.feePaid);    // uses per-request snapshot
```

**Regression test:** `testFuzz_SettleCyclePreservesUSDC` — calls `setFee` between request and settlement and asserts seller receives exactly `req.feePaid`, not the updated fee.

---

## Finding 2 — Critical: REVEALED state deadlock — buyer funds lock if verifier goes offline

**Location:** `PredictAgent.recordOutcome`, `PredictAgent.claimRefund`

**Description:**
After `revealSignal` moves a request to `REVEALED`, only `recordOutcome` (verifier/owner) could advance it. `claimRefund` only allowed `PENDING` or `COMMITTED` states. If the verifier wallet became unavailable, the buyer's funds would be locked indefinitely with no recovery path.

**Fix:**
- Added `outcomeDeadlineOffset` (default 86400 — 24 hours).
- `claimRefund` now also permits `REVEALED` status when `block.timestamp > windowClose + revealDeadlineOffset + outcomeDeadlineOffset`.
- Added `setOutcomeDeadlineOffset` owner function with `OutcomeDeadlineOffsetUpdated` event.

**Regression tests:**
- `test_ClaimRefund_AfterOutcomeDeadline_REVEALED` — buyer reclaims after deadline.
- `test_ClaimRefund_BeforeOutcomeDeadline_REVEALED_Reverts` — boundary: reverts one second before deadline.

---

## Finding 3 — High: `setVerifier` emits no event — authorization change is silent

**Location:** `PredictAgent.setVerifier`

**Description:**
`setVerifier` changes who is authorized to call `recordOutcome` for a specific request — a security-relevant authorization transition. It emitted no event, making it impossible for off-chain monitors to detect verifier rotations in real time.

**Fix:**
Added `VerifierUpdated(uint256 indexed requestId, address indexed oldVerifier, address indexed newVerifier)` event. `setVerifier` now captures the old verifier, updates, and emits the event.

**Regression test:** `test_SetVerifier_EmitsVerifierUpdated` — asserts the event fires with correct old and new verifier values.

---

## Finding 4 — High: `renounceOwnership` not restricted while paused — permanent pause possible

**Location:** Inherited `Ownable.renounceOwnership`

**Description:**
`pause()` and `unpause()` are both `onlyOwner`. If the owner called `renounceOwnership` while the contract was paused (or paused then renounced), no account could ever call `unpause`. This would permanently disable `requestSignal` and trap the marketplace in a bricked state.

**Fix:**
Override `renounceOwnership` to revert with `PredictAgent__RenounceDisabled()` when `paused == true`. When not paused, calls `super.renounceOwnership()` normally.

```solidity
function renounceOwnership() public override onlyOwner {
    if (paused) {
        revert PredictAgent__RenounceDisabled();
    }
    super.renounceOwnership();
}
```

**Regression tests:**
- `test_RenounceOwnership_RevertsWhenPaused` — asserts revert when paused.
- `test_RenounceOwnership_SucceedsWhenNotPaused` — asserts normal renounce works when not paused.

---

## Audit methodology

- Severity: **balanced** (covers critical, high, and medium findings).
- Scope: `contracts/PredictAgent.sol` + imported OpenZeppelin 5.1.0 contracts.
- Checks-effects-interactions ordering verified on all token transfer paths.
- Reentrancy: `nonReentrant` applied to `requestSignal`, `recordOutcome`, `claimRefund`.
- Custom errors used throughout (no `require` strings).
- No ETH acceptance (`receive`/`fallback` absent).

## What this audit does NOT cover

- No professional third-party audit has been conducted.
- Gas optimization analysis not performed.
- The permissioned verifier is a centralization risk that requires operational security — not a code fix.
- Signal accuracy and profitability are explicitly out of scope (DEMO v1).
