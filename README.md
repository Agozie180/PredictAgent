# PredictAgent — Pay-per-signal crypto price marketplace where payment is held in escrow until the signal is verified on-chain

![Tests](https://img.shields.io/badge/contract_tests-42%2F42_passing-4ade80)
![Signal Tests](https://img.shields.io/badge/signal_engine_tests-25%2F25_passing-4ade80)
![Solidity](https://img.shields.io/badge/solidity-0.8.20-acc6e9)
![Chain](https://img.shields.io/badge/chain-Arc_Mainnet-acc6e9)
![License](https://img.shields.io/badge/license-MIT-acc6e9)

**Links:** [Live App](#deployment) · [Contract Source](contracts/PredictAgent.sol) · [Signal Engine](server/signal.ts) · [Agent API Docs](server/README.md) · [Architecture](ARCHITECTURE.md) · [Security Audit](AUDIT.md)

> **The seller cannot receive payment unless the signal commitment matches the reveal — enforced by the contract, not by trust.**

A marketplace on Arc where AI agents buy short-term crypto price-movement signals from a seller agent using USDC. The buyer's fee is held in escrow. The seller commits a cryptographic hash of the signal before the window opens, reveals the data after it closes, and a verifier confirms the outcome. Only a matching reveal triggers settlement — a mismatch or missed deadline automatically refunds the buyer in full.

Built on **Arc** (USDC as native gas), using Circle's USDC escrow pattern. DEMO v1 — signal logic is illustrative, not financial advice.

---

## What we built

A three-part system:

1. **`contracts/PredictAgent.sol`** — A commit-reveal USDC escrow contract. Buyers deposit a fixed USDC fee; the seller commits a `keccak256` hash of the signal before the window opens; after the window closes the seller reveals; a verifier records the outcome; the contract settles or refunds atomically.

2. **`server/`** — A Bun TypeScript signal service. Fetches live Binance candles, computes signals using RSI(14), EMA(20/50) crossover, MACD(12/26/9), Bollinger Bands(20,2), ATR(14), and volume profile. Persists committed signals to disk so they survive restarts. Exposes a REST API for buyer agents.

3. **`src/`** — A React/wagmi frontend. Live market ticker (Binance 24h stats), indicator breakdown before purchase, request tracking with live countdowns, and a full buy flow (approve USDC → submit request → track status).

---

## How it works

```
Buyer                  Contract                Seller Agent         Verifier
  |                       |                        |                    |
  |-- requestSignal() --->|                        |                    |
  |   [fee in escrow]     |                        |                    |
  |                       |<--- commitSignal() ----|                    |
  |                       |    [hash stored]       |                    |
  |         [window open → close]                  |                    |
  |                       |<--- revealSignal() ----|                    |
  |                       |    [hash verified]     |                    |
  |                       |<---------------------------------recordOutcome()
  |                       |                                  [correct?]  |
  |                 [correct] → transfer fee to seller                   |
  |                 [wrong]  → transfer fee back to buyer                |
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full state machine and sequence diagrams.

---

## The thesis, enforced (not asserted)

| The contract enforces | How |
|---|---|
| Seller cannot change the signal after the buyer pays | `commitHash` is immutable once written; `revealSignal` reverts on hash mismatch |
| Seller cannot collect payment without revealing | `_settle` is only reachable via `recordOutcome(correct=true)`, which requires `status == REVEALED` |
| Buyer cannot be locked in permanently | `claimRefund` available after `revealDeadlineOffset` (PENDING/COMMITTED) or `outcomeDeadlineOffset` (REVEALED) |
| Fee changes never affect in-flight requests | `feePaid` stored per-request at creation; `_settle`/`_refund` use `req.feePaid`, not `signalFeeUsdc` |

Test that proves it: `test_RevealSignal_HashMismatch_Reverts` in [`contracts/test/PredictAgent.t.sol`](contracts/test/PredictAgent.t.sol) — this test would **FAIL** against the pre-fix code.

---

## Measured

| Claim | Number | Reproduce with |
|---|---|---|
| Contract unit tests | 42 / 42 passing | `forge test` |
| Signal engine unit tests | 25 / 25 passing | `bun test server/signal.test.ts` |
| Security findings fixed | 4 / 4 (balanced severity) | See [AUDIT.md](AUDIT.md) |
| Signal indicators | 6 (RSI, EMA, MACD, BB, ATR, volume) | [`server/signal.ts`](server/signal.ts) L77–L200 |
| Audit regression tests | Each finding has a named test that fails against pre-fix code | [`contracts/test/PredictAgent.t.sol`](contracts/test/PredictAgent.t.sol) |

---

## What's used, and what's deliberately not

| Component | Used | Evidence |
|---|---|---|
| Arc (USDC-native chain) | USDC at `0x3600...0000` as escrow currency | `contracts/PredictAgent.sol:9` |
| Circle USDC (ERC-20) | `transferFrom` for escrow, `transfer` for settle/refund | `_settle`, `_refund` functions |
| wagmi v2 + ConnectKit | Wallet connection, contract reads/writes, chain switching | `src/config.ts`, `src/components/` |
| OpenZeppelin 5.x | `Ownable` (explicit `_initialOwner`), `ReentrancyGuard` | `PredictAgent.sol:4-6` |
| Binance public API | Live candles (1h, 60 candles) + 24h ticker | `server/marketData.ts` |
| CoinGecko (fallback) | Spot price fallback when Binance rate-limits | `server/marketData.ts:fetchSpotPrices` |
| Commit-reveal scheme | Signal committed as `keccak256(abi.encodePacked(...))` before window | `revealSignal()` hash check |
| Permissioned verifier | Owner sets verifier per request; verifier or owner calls `recordOutcome` | `setVerifier`, `recordOutcome` |
| **Not used**: price oracle (Chainlink etc.) | Outcome is recorded by a permissioned verifier, not an on-chain oracle — noted as a limitation | See Limitations |
| **Not used**: upgradeable proxy | Ownable with `setSeller`/`setFee` for param updates; no proxy pattern needed for this scope | — |

---

## Try it in 30 seconds

**As a buyer agent (REST API):**
```bash
# 1. Check service health
curl http://localhost:3001/api/health

# 2. Get the current signal for BTC (with full indicator breakdown)
curl "http://localhost:3001/api/signal/latest?token=BTC"

# 3. Commit a signal to request ID 1 (seller-side)
curl -X POST http://localhost:3001/api/signal/commit \
  -H 'Content-Type: application/json' \
  -d '{"token":"BTC","requestId":"1"}'
```

**Full on-chain cycle (after deploy):**
```bash
# Buyer: approve + request
cast send $USDC "approve(address,uint256)" $CONTRACT 1000000 --private-key $BUYER_KEY --rpc-url $RPC
cast send $CONTRACT "requestSignal(string,uint256,uint256)" "BTC" $WINDOW_OPEN $WINDOW_CLOSE \
  --private-key $BUYER_KEY --rpc-url $RPC

# Seller: commit hash (before windowOpen)
cast send $CONTRACT "commitSignal(uint256,bytes32)" 1 $COMMIT_HASH \
  --private-key $SELLER_KEY --rpc-url $RPC

# Seller: reveal (after windowClose)
cast send $CONTRACT "revealSignal(uint256,bytes32,uint256,uint256,uint256,uint256)" \
  1 $DIRECTION $TARGET $CONFIDENCE $TIMESTAMP $NONCE \
  --private-key $SELLER_KEY --rpc-url $RPC

# Owner/Verifier: record outcome
cast send $CONTRACT "recordOutcome(uint256,bool)" 1 true \
  --private-key $OWNER_KEY --rpc-url $RPC
```

See [server/README.md](server/README.md) for the full agent integration guide.

---

## Deployment

```bash
# 1. Build
forge build

# 2. Deploy (Arc mainnet)
forge create contracts/PredictAgent.sol:PredictAgent \
  --rpc-url https://rpc.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $SELLER_ADDRESS 1000000 $OWNER_ADDRESS

# 3. Wire the contract address
printf 'VITE_CONTRACT_ADDRESS=0xYOUR_ADDRESS\n' >> .env

# 4. Start signal service
bun run server

# 5. Start frontend
bun run dev
```

Arc Testnet RPC: `https://rpc.testnet.arc.io` · Explorer: `https://explorer.arc.io`

---

## Limitations, stated plainly

- **Verifier is permissioned, not trustless.** The outcome oracle is a wallet address set by the owner — not a decentralized price oracle like Chainlink. A malicious or offline verifier can delay or skew outcomes. Upgrading to a Chainlink price feed is the natural next step.
- **Single seller per deployment.** The contract has one registered seller. Multi-seller support would require a registry pattern.
- **Signal logic is DEMO v1.** The RSI/EMA/MACD rules are readable and auditable but not backtested for profitability. They are illustrative only.
- **No on-chain oracle integration.** Price verification relies on an off-chain verifier calling `recordOutcome`. On-chain automation (Chainlink Automation + Data Feeds) is a planned upgrade.
- **Buyer timeout requires waiting.** Buyers can only claim a refund after `revealDeadlineOffset` (1h default after `windowClose`) or `outcomeDeadlineOffset` (24h default after reveal). These are configurable by the owner but not by buyers.
- **CoinGecko fallback may lag.** The free CoinGecko tier can rate-limit under load; the fallback may return prices up to 60s stale.

---

## Disclosures

- Signals are informational only, not financial advice.
- Past signal results do not guarantee future outcomes.
- DEMO v1 — the signal logic has not been backtested for profitability or audited for trading accuracy.
- This contract holds real USDC on mainnet. Review the code and audit before deploying with real funds.
- The contract has been audited internally (see [AUDIT.md](AUDIT.md)) but has not undergone a professional third-party audit.

---

## Project structure

```
contracts/
  PredictAgent.sol          # Core escrow + commit-reveal contract
  test/PredictAgent.t.sol   # 42 Foundry unit tests
  test-helpers/MockERC20.sol
server/
  index.ts                  # Bun HTTP server (port 3001)
  signal.ts                 # Signal computation (DEMO v1)
  indicators.ts             # RSI, EMA, MACD, BB, ATR, volume
  marketData.ts             # Binance + CoinGecko data fetchers
  signal.test.ts            # 25 signal engine unit tests
  README.md                 # Agent integration guide
src/
  components/               # React UI components
  hooks/                    # wagmi hooks (usePredictAgent, useSpotPrices, etc.)
  lib/                      # ABI, utils, direction constants
ARCHITECTURE.md             # State machine + sequence diagrams
AUDIT.md                    # Security findings + fixes
```

---

*Built on Arc · Powered by USDC · DEMO v1*
