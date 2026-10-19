# PredictAgent

> **DEMO v1 — Signal logic is illustrative only. Not financial advice. Past results do not guarantee future outcomes.**

A pay-per-signal marketplace on **Arc mainnet** where AI agents buy crypto price-movement signals using USDC. Signals are backed by a commit-reveal escrow contract: the seller commits a hash before the signal window opens, reveals after it closes, and funds settle automatically — or refund if the seller misses the deadline.

[![Tests](https://img.shields.io/badge/Foundry_tests-51%2F51-brightgreen)](contracts/test/PredictAgent.t.sol)
[![Signal Tests](https://img.shields.io/badge/Signal_tests-25%2F25-brightgreen)](server/signal.test.ts)
[![Audit](https://img.shields.io/badge/Audit-4_findings_fixed-blue)](AUDIT.md)
[![Chain](https://img.shields.io/badge/Chain-Arc_Mainnet-6366f1)](https://explorer.arc.io)
[![License](https://img.shields.io/badge/License-MIT-gray)](LICENSE)

---

## Quick links

| | |
|---|---|
| Live app | _https://predict-agent.vercel.app/ |
| Contract | [`0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff`](https://explorer.arc.io/address/0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff) |
| Deploy TX | [`0xc26132b...`](https://explorer.arc.io/tx/0xc26132b0a3336a6102ca8aebfe5b067d4f7631b66fe302b41057e3ab3d0df06c) |
| Agent API | `GET /api/signal/latest?token=BTC` |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Audit | [AUDIT.md](AUDIT.md) |
| Signal service | [server/README.md](server/README.md) |

---

## Why Arc?

USDC is the native gas token on Arc — not a secondary asset you have to bridge in before you can pay for anything. That one property makes PredictAgent materially better here than on any other chain:

| Property | What it means for PredictAgent |
|---|---|
| **USDC is gas** | Buyers pay the signal fee and the gas fee in the same token. No ETH, no bridging, no wrapping. One asset, one approval, one transaction. |
| **Predictable fees** | Signal fees are fixed in USDC. Gas is also USDC. The total cost of a signal request is known before the user clicks Approve — no "gas spike ate my budget" surprises. |
| **Sub-second finality** | `RequestCreated` is confirmed in under a second. Sellers see the event and can commit before the window opens without racing against slow finality. |
| **Agent-native** | AI agents settling in USDC have no gas management problem on Arc. An agent holds one balance and uses it for both fees and payments — no wrapped ETH, no multi-token treasury. |

---

## GitHub Actions — CI / Deploy

Two workflows ship in `.github/workflows/`:

### `test.yml` — runs on every push and PR
- Foundry tests (`forge test -vv`) — 51 tests
- Signal engine tests (`bun test server/signal.test.ts`) — 25 tests
- Lint + typecheck (`bun run check`)

### `deploy-contract.yml` — manual trigger

Go to **Actions → Deploy PredictAgent to Arc Mainnet → Run workflow**.

**Required GitHub Secrets** (Settings → Secrets and variables → Actions):

| Secret | Description |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Private key of your burner wallet (funds it with Arc USDC for gas) |
| `OWNER_ADDRESS` | Address that will own the contract (can pause, set fee, set verifier) |
| `SELLER_ADDRESS` | Address of the seller agent wallet (calls commitSignal + revealSignal) |

**Workflow inputs:**

| Input | Default | Description |
|---|---|---|
| `contract` | `PredictAgent` | Which contract to deploy |
| `signal_fee_usdc` | `1000000` | Fee per signal in USDC (6 decimals). `1000000` = $1.00 |
| `dry_run` | `false` | Set `true` to build + verify secrets without broadcasting |

After a successful deploy the workflow:
1. Writes a JSON deployment record to `contracts/contract-metadata/`
2. Commits the record back to the repo (author: Agozie180)
3. Prints the contract address and explorer link in the Actions summary

Set `VITE_CONTRACT_ADDRESS=<deployed-address>` in your Vercel environment variables and redeploy the frontend.

---

## The thesis, enforced in code

| Claim | Enforced by |
|---|---|
| Seller cannot change the signal after committing | `commitHash` is write-once; `revealSignal` reverts on hash mismatch (`PredictAgent__HashMismatch`) |
| Seller cannot take payment without revealing | `_settle` only runs from `recordOutcome(true)` or `settleWithChainlink`, both require `status == REVEALED` |
| Buyer always gets a refund path | `claimRefund` available after `buyerRevealDeadline` (PENDING/COMMITTED) or `outcomeDeadlineOffset` (REVEALED); no state can permanently lock funds |
| Fee changes don't affect in-flight requests | `feePaid` is snapshotted per-request at creation; `_settle`/`_refund` use `req.feePaid` not the global `signalFeeUsdc` |
| Verifier cannot be silently rotated | `setVerifier` emits `VerifierUpdated(requestId, oldVerifier, newVerifier)`; on-chain event log is the audit trail |

---

## Contracts

Three contracts ship in this repo:

| Contract | Purpose |
|---|---|
| `PredictAgent.sol` | Core single-seller escrow. Permissioned verifier. Deploy first. |
| `PredictAgentChainlink.sol` | Upgrade path: trustless Chainlink Data Feed settlement + Automation upkeep. |
| `SellerRegistry.sol` | Multi-seller registry: any address can register, buyers choose their seller. |

### Deploy PredictAgent (primary)

```bash
forge build

forge create contracts/PredictAgent.sol:PredictAgent \
  --rpc-url https://rpc.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args \
    $SELLER_ADDRESS \
    1000000 \
    $OWNER_ADDRESS
```

Constructor args: `(_seller, _signalFeeUsdc, _initialOwner)`. Fee `1000000` = $1.00 USDC (6 decimals).

Wire the address into the app:
```bash
printf 'VITE_CONTRACT_ADDRESS=0xYOUR_DEPLOYED_ADDRESS\n' >> .env
```

Then restart the Vite dev server.

### Deploy PredictAgentChainlink (trustless upgrade)

```bash
forge create contracts/PredictAgentChainlink.sol:PredictAgentChainlink \
  --rpc-url https://rpc.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $SELLER_ADDRESS 1000000 $OWNER_ADDRESS
```

After deploy, set Chainlink price feed addresses for each token (owner only):
```bash
cast send $CONTRACT "setPriceFeed(string,address)" "BTC" $BTC_USD_FEED_ADDRESS \
  --rpc-url https://rpc.arc.io --private-key $OWNER_PRIVATE_KEY
```

Register a Chainlink Automation upkeep pointing at the contract, with `checkData = abi.encode(1, 100)` (scan request IDs 1–100).

---

## Complete on-chain cycle

```bash
# 1. Buyer approves USDC spend
cast send $USDC "approve(address,uint256)" $CONTRACT 1000000 \
  --rpc-url https://rpc.arc.io --private-key $BUYER_KEY

# 2. Buyer requests signal (windowOpen = now+5min, windowClose = now+5min+4h, buyerRevealOffset=0)
WINDOW_OPEN=$(( $(date +%s) + 300 ))
WINDOW_CLOSE=$(( WINDOW_OPEN + 14400 ))
cast send $CONTRACT "requestSignal(string,uint256,uint256,uint256)" \
  "BTC" $WINDOW_OPEN $WINDOW_CLOSE 0 \
  --rpc-url https://rpc.arc.io --private-key $BUYER_KEY

# 3. Seller gets commit hash from signal service
curl -X POST https://predictagent.onrender.com/signal/commit \
  -H 'Content-Type: application/json' \
  -d '{"token":"BTC","requestId":"1"}'
# → { commitHash, revealData: { direction, targetPrice, confidenceBandBps, signalTimestamp, nonce } }

# 4. Seller commits hash on-chain (before windowOpen)
cast send $CONTRACT "commitSignal(uint256,bytes32)" 1 $COMMIT_HASH \
  --rpc-url https://rpc.arc.io --private-key $SELLER_KEY

# 5. After windowClose: seller reveals signal
cast send $CONTRACT \
  "revealSignal(uint256,bytes32,uint256,uint256,uint256,uint256)" \
  1 $DIRECTION $TARGET_PRICE $CONFIDENCE_BPS $SIGNAL_TS $NONCE \
  --rpc-url https://rpc.arc.io --private-key $SELLER_KEY

# 6. Verifier/owner records outcome
cast send $CONTRACT "recordOutcome(uint256,bool)" 1 true \
  --rpc-url https://rpc.arc.io --private-key $OWNER_KEY
# → If true: seller receives $1 USDC. If false: buyer is refunded.
```

---

## Signal service (agent API)

```bash
bun run server   # starts on port 3001
```

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health + supported tokens |
| `GET /api/prices` | Live spot prices (Binance → Kraken → CoinGecko) |
| `GET /api/signal/latest?token=BTC` | Current signal with full indicator breakdown |
| `GET /api/signal/backtest?token=BTC&limit=200` | Retrospective backtest (see disclaimer) |
| `GET /api/signal/:requestId` | Signal committed to a specific requestId |
| `POST /api/signal/commit` | Lock signal to requestId, return commitHash + revealData |

See [server/README.md](server/README.md) for full agent integration guide.

---

## Backtest Results — DEMO v1 (in-sample, run 2026-10-17)

> **Retrospective in-sample results only. Look-ahead bias applies. Do NOT use for investment decisions. Not financial advice.**

| Token | Windows | Win Rate | Avg Strength | Method |
|---|---|---|---|---|
| BTC | 24 | 100% | 73/100 | 200 candles × 1h, sliding window |
| ETH | 24 | 100% | 73/100 | 200 candles × 1h, sliding window |
| SOL | 24 | 100% | 74/100 | 200 candles × 1h, sliding window |
| ARB | 24 | 100% | 75/100 | 200 candles × 1h, sliding window |
| MATIC | — | — | — | CoinGecko OHLC unavailable (paid tier required) |

**Why 100%?** The confidence band is 1.5× ATR(14) of current price (≈ 3–20% wide). Over a 6-candle forward window, price almost always touches a band that wide — this measures ATR sizing consistency, not directional edge. A meaningful evaluation requires held-out data and a tighter band. Run live: `GET /api/signal/backtest?token=BTC&limit=200`

## Signal indicators (DEMO v1)

Six indicators, majority vote decides direction:

| Indicator | Bullish | Bearish |
|---|---|---|
| RSI(14) | < 30 (oversold) | > 70 (overbought) |
| EMA(20/50) crossover | EMA20 > EMA50 | EMA20 < EMA50 |
| MACD(12/26/9) histogram | Positive | Negative |
| Bollinger Band position | Near lower band (<0.2) | Near upper band (>0.8) |
| Volume ratio (vs 20-period avg) | Rising volume | Falling volume |
| 24h price change | Positive | Negative |

Target price: last close ± 1× ATR(14). Confidence band: 1.5× ATR% of price, clamped 300–2000 bps.

---

## Market data sources

Three-tier fallback with circuit breakers:

1. **Binance** (primary) — real-time 1h candles and 24h ticker
2. **Kraken** (fallback) — 1h OHLC and ticker
3. **CoinGecko** (last resort) — OHLC and simple price (rate-limited; volume not available)

Circuit breaker: after 3 consecutive failures, a source is skipped for 5 minutes.
Staleness: prices older than 90s are flagged in the UI.

---

## Running tests

```bash
# Solidity tests (51 total)
forge test -vv

# Signal engine tests (25 total)
bun test server/signal.test.ts
```

---

## Measured claims

| Claim | Evidence |
|---|---|
| 51 Foundry tests pass | `forge test -vv` → 51 passed, 0 failed |
| 25 signal engine tests pass | `bun test server/signal.test.ts` → 25 passed, 0 failed |
| 4 security findings, all fixed | [AUDIT.md](AUDIT.md) — each finding has a named regression test |
| Funds cannot be permanently locked | `test_ClaimRefund_AfterOutcomeDeadline_REVEALED` covers the REVEALED escape hatch |
| Fee snapshot prevents over/underpayment | `testFuzz_SettleCyclePreservesUSDC` (256 runs) |
| Buyer-configurable timeout works | `test_BuyerRevealOffset_Custom_SetsDeadline`, `test_BuyerRevealOffset_TooLow_Reverts` |

---

## Limitations (stated plainly)

| Limitation | Status |
|---|---|
| **Verifier is permissioned** in `PredictAgent.sol` | `PredictAgentChainlink.sol` provides a trustless Chainlink upgrade path |
| **Single seller** per `PredictAgent` deployment | `SellerRegistry.sol` supports any number of registered sellers |
| **Signal logic is DEMO v1** | RSI/EMA/MACD rules are readable and auditable but not backtested for future profitability. Retrospective backtest available at `GET /api/signal/backtest` (disclaimer applies) |
| **On-chain automation optional** | `PredictAgentChainlink.sol` implements `AutomationCompatibleInterface` for Chainlink Keepers |
| **Buyer timeout is configurable** | Buyers pass `buyerRevealOffset` (within owner-set bounds `[minRevealOffset, maxRevealOffset]`) to `requestSignal` |
| **CoinGecko fallback may lag** | CoinGecko is tier-3 fallback behind Binance + Kraken; circuit breaker skips it if it rate-limits |

---

## Disclaimer

Signals are informational only and do not constitute financial advice. The signal logic (DEMO v1) is illustrative and has not been validated for profitability. Past signal outcomes do not predict future results. You are solely responsible for any financial decisions you make. Use testnet first.
