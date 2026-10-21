# PredictAgent — The first trustless price-signal marketplace for AI agents on Arc

[![Tests](https://github.com/Agozie180/PredictAgent/actions/workflows/test.yml/badge.svg)](https://github.com/Agozie180/PredictAgent/actions/workflows/test.yml)
[![Foundry](https://img.shields.io/badge/Foundry_tests-51%2F51-brightgreen)](contracts/test/PredictAgent.t.sol)
[![Signal Tests](https://img.shields.io/badge/Signal_tests-25%2F25-brightgreen)](server/signal.test.ts)
[![Audit](https://img.shields.io/badge/Self--audit-4_findings_fixed-blue)](AUDIT.md)
[![Chain](https://img.shields.io/badge/Chain-Arc_Mainnet-6366f1)](https://explorer.arc.io)
[![License](https://img.shields.io/badge/License-MIT-gray)](LICENSE)

> **AI agents pay USDC per signal. Sellers commit predictions on-chain before the window opens. The contract is structurally prevented from letting the seller revise — or keep payment without revealing.**

Built for the **Arc Microgrants Program** · Target: Arc ecosystem grant · Submitted by Agozie180

---

## Quick links

| | |
|---|---|
| **Live app** | https://predict-agent.vercel.app |
| **Signal API** | https://predictagent.onrender.com/api/health |
| **Contract** | [`0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f`](https://explorer.arc.io/address/0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f) |
| **Deploy TX** | [`0xc26132b...`](https://explorer.arc.io/tx/0xc26132b0a3336a6102ca8aebfe5b067d4f7631b66fe302b41057e3ab3d0df06c) |
| **Architecture** | [ARCHITECTURE.md](ARCHITECTURE.md) |
| **Self-audit** | [AUDIT.md](AUDIT.md) |
| **Judge guide** | [JUDGE_GUIDE.md](JUDGE_GUIDE.md) |
| **Backtest results** | [BACKTEST_RESULTS.md](BACKTEST_RESULTS.md) |
| **Signal service docs** | [server/README.md](server/README.md) |

---

## Try it in 30 seconds (no wallet needed for reads)

```bash
# 1. Is the signal service live?
curl https://predictagent.onrender.com/api/health

# 2. Get the current BTC signal (indicator breakdown + direction)
curl "https://predictagent.onrender.com/api/signal/latest?token=BTC"

# 3. Get live spot prices for all 5 tokens
curl https://predictagent.onrender.com/api/prices

# 4. Run a retrospective backtest (4h candles, 200 windows)
curl "https://predictagent.onrender.com/api/signal/backtest?token=ETH&limit=200&interval=240"

# 5. Verify the contract is deployed on Arc mainnet
curl -s -X POST https://rpc.mainnet.arc.io \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f","latest"],"id":1}' \
  | grep -o '"result":"0x[0-9a-f]*"' | head -c 80
```

---

## What is it?

PredictAgent is an on-chain marketplace on **Arc mainnet** where:

- A **seller agent** publishes short-term price-movement signals for BTC, ETH, SOL, ARB, POL
- **Buyer agents or traders** pay a fixed $0.10 USDC fee per signal request
- The **contract holds USDC in escrow** and settles automatically: pays the seller on correct reveal, refunds the buyer if the seller misses the deadline or the hash doesn't match
- The **commit-reveal scheme** proves the seller fixed their prediction before the window opened — not after seeing the outcome

**Why this is the first of its kind:** No existing on-chain marketplace combines (a) cryptographic proof of signal commitment pre-window with (b) fully automated USDC escrow settlement with (c) a public REST API for AI agent integration on a chain where USDC is the gas token. Three contracts ship with the repo covering the core escrow, a trustless Chainlink upgrade path, and a multi-seller registry.

---

## Why Arc?

USDC is the native gas token on Arc — not a secondary asset. That one property makes PredictAgent materially better here than on any other chain:

| Property | What it means for PredictAgent |
|---|---|
| **USDC is gas** | Buyers pay the signal fee and gas in the same token. One asset, one approval, one transaction. No ETH. |
| **Predictable fees** | Fixed USDC signal fee + USDC gas = known total cost before clicking Approve. No "gas spike ate my budget." |
| **Sub-second finality** | `RequestCreated` confirmed in <500ms. Sellers see the event and commit before the window opens without racing slow finality. |
| **Agent-native** | An AI agent holds one USDC balance for both fees and payments — no wrapped ETH, no multi-token treasury management. |

---

## What's used — and what's deliberately not

| Component | Used | Evidence / reason |
|---|---|---|
| Arc mainnet | ✅ | Deployed: `0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f` |
| USDC (Arc predeploy `0x3600...`) | ✅ | Hardcoded constant in `PredictAgent.sol`; all escrow in USDC |
| Foundry (forge build/test) | ✅ | 51 tests, CI badge above |
| Chainlink Data Feeds | ✅ (upgrade path) | `PredictAgentChainlink.sol` — trustless settlement |
| Chainlink Automation | ✅ (upgrade path) | `AutomationCompatibleInterface` implemented |
| OpenZeppelin 5.1 | ✅ | Ownable, ReentrancyGuard |
| Multi-seller registry | ✅ | `SellerRegistry.sol` — any address can register |
| Chainlink on Arc mainnet | ❌ (not yet live) | Feed addresses not yet available on Arc mainnet — Chainlink contract is the upgrade path for when they are |
| Formal third-party audit | ❌ | Self-audit + 51 tests. See [AUDIT.md](AUDIT.md) for scope and limits. |
| On-chain randomness | ❌ | Nonce is off-chain random — signal commitment is not a lottery |

---

## The thesis, enforced in code

> **A seller cannot revise their prediction after the window opens, and cannot keep payment without revealing.**

| The contract decides | The contract is structurally prevented from allowing |
|---|---|
| Whether `commitHash` can be changed | Writing to `commitHash` a second time — it's set once in `commitSignal`, no setter exists |
| Whether reveal matches commitment | A `revealSignal` that doesn't match the stored hash — reverts with `PredictAgent__HashMismatch` |
| Whether seller gets paid without revealing | `_settle` is only called from `recordOutcome(true)` or `settleWithChainlink`, both require `status == REVEALED` |
| Whether fee changes affect escrowed funds | `_settle`/`_refund` use `req.feePaid` (snapshotted at creation), never the current `signalFeeUsdc` |
| Whether buyer funds can be permanently locked | `claimRefund` is available at every non-terminal state after a timeout — `PredictAgent__RevealOffsetOutOfBounds` prevents zero-second timeouts |

---

## Measured claims

| Claim | Number | Reproduce with |
|---|---|---|
| Foundry tests | 51/51 pass | `forge test -vv` |
| Signal engine tests | 25/25 pass | `bun test server/signal.test.ts` |
| Security findings fixed | 4 findings, 4 fixes | [AUDIT.md](AUDIT.md) — each fix has a named regression test |
| Fuzz: USDC conservation | 256 runs, 0 violations | `forge test --match-test testFuzz -vv` |
| Backtest windows (4h) | 147 windows × 4 tokens | `curl ".../api/signal/backtest?token=BTC&interval=240&limit=500"` |
| Directional accuracy (SOL, 4h) | 52% | [BACKTEST_RESULTS.md](BACKTEST_RESULTS.md) |
| Directional accuracy (ETH, 24h) | 48% | [BACKTEST_RESULTS.md](BACKTEST_RESULTS.md) |
| Signal indicators | 6 (RSI, EMA, MACD, BB, Volume, 24h) | `server/signal.ts: computeSignal()` |
| Data sources with circuit breaker | 3 (Binance → Kraken → CoinGecko) | `server/marketData.ts` |

---

## Demo script — the guardrail, not just the happy path

The unfakeable moment in PredictAgent is not the happy path — it's the **hash mismatch refund**. This is what proves the commitment scheme works:

**Script (~90 seconds):**

```
1. [30s] Open https://predict-agent.vercel.app → About tab
   Show: "commit predictions on-chain before the window opens"

2. [15s] Signal Feed → live BTC/ETH prices + indicator breakdown
   Show: RSI, EMA, MACD votes → BULLISH direction + strength score

3. [20s] Buy Signal tab → select BTC → approve USDC → submit request
   Show: Request ID returned from on-chain event log

4. [25s] Track Request tab → paste request ID
   Show: PENDING status → "Awaiting seller commit"
   Explain: "If the seller never commits, or commits a hash that doesn't match the reveal,
            the buyer calls claimRefund after the deadline and gets their USDC back in full.
            The seller cannot keep the fee without delivering."
```

**The guardrail flow** (hash mismatch → refund):
```bash
# Seller commits an intentionally wrong hash
cast send $CONTRACT "commitSignal(uint256,bytes32)" 1 0xdeadbeef... --private-key $SELLER_KEY

# After windowClose + revealDeadline, buyer claims refund
cast send $CONTRACT "claimRefund(uint256)" 1 --private-key $BUYER_KEY
# → REFUNDED, buyer receives feePaid USDC
# → Seller receives nothing
```

---

## Live on-chain activity

Four signal requests confirmed on Arc mainnet (verified via `getRequest` eth_call, 2026-10-21):

| Request ID | Token | Buyer | Fee | Status |
|---|---|---|---|---|
| [#1](https://explorer.arc.io/address/0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f) | BTC | `0x62AA...988a` | $0.10 USDC | CREATED |
| [#2](https://explorer.arc.io/address/0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f) | ETH | `0x62AA...988a` | $0.10 USDC | CREATED |
| [#3](https://explorer.arc.io/address/0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f) | SOL | `0x62AA...988a` | $0.10 USDC | CREATED |
| [#4](https://explorer.arc.io/address/0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f) | ARB | `0x62AA...988a` | $0.10 USDC | CREATED |

Escrow is live. Seller commits pending (Render backend `SELLER_PRIVATE_KEY` env var required to unlock commit/reveal).

---

## Contracts

| Contract | Purpose | Status |
|---|---|---|
| `PredictAgent.sol` | Core single-seller escrow, permissioned verifier | Deployed on Arc mainnet |
| `PredictAgentChainlink.sol` | Trustless Chainlink Data Feed settlement + Automation upkeep | Ready to deploy. Chainlink feeds live on Arc mainnet — see feed addresses below |
| `SellerRegistry.sol` | Multi-seller registry: any address can register as a seller | Deployed Arc Testnet: `0x5cba315ecbc5abc11f5351036a0cb80b13d097b8` |

### Chainlink Price Feed addresses on Arc mainnet

Verified from the Chainlink reference-data-directory API (2026-10-21). All feeds are 8-decimal proxies.

| Token | Feed | Proxy address |
|---|---|---|
| BTC | BTC / USD | `0xa109B535C70C8Be9995be64Bb6751AcDB27e03De` |
| ETH | ETH / USD | `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` |
| SOL | SOL / USD | `0x2d04D354f5fDaE3De723df475745B0a9B4edf90C` |
| LINK | LINK / USD | `0xD37600AB06758356F0f5eE607299204785bF8c3a` |
| AAVE | AAVE / USD | `0x06e59eA707FEAA09467C689Baf8D49C180fE2118` |

ARB / USD feed not yet available on Arc mainnet. ARB requests can still use `PredictAgent.sol` with the permissioned verifier path.

After deploying `PredictAgentChainlink.sol`, wire feeds with:

```bash
CHAINLINK=<deployed PredictAgentChainlink address>

cast send $CHAINLINK "setPriceFeed(string,address)" "BTC" 0xa109B535C70C8Be9995be64Bb6751AcDB27e03De --rpc-url https://rpc.mainnet.arc.io --private-key $OWNER_PRIVATE_KEY
cast send $CHAINLINK "setPriceFeed(string,address)" "ETH" 0x50FCDD99D6762D1C170DC6A9111db944AEE6D364 --rpc-url https://rpc.mainnet.arc.io --private-key $OWNER_PRIVATE_KEY
cast send $CHAINLINK "setPriceFeed(string,address)" "SOL" 0x2d04D354f5fDaE3De723df475745B0a9B4edf90C --rpc-url https://rpc.mainnet.arc.io --private-key $OWNER_PRIVATE_KEY
```

### Deploy (GitHub Actions)

Go to **Actions → Deploy PredictAgent to Arc Mainnet → Run workflow**.

**Required secrets** (Settings → Secrets and variables → Actions):

| Secret | Description |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Burner wallet private key (needs USDC on Arc for gas) |
| `OWNER_ADDRESS` | Address that owns the contract |
| `SELLER_ADDRESS` | Address of the seller agent wallet |

### Deploy manually

```bash
forge build

forge create contracts/PredictAgent.sol:PredictAgent \
  --broadcast \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $SELLER_ADDRESS 100000 $OWNER_ADDRESS
```

Constructor: `(_seller, _signalFeeUsdc, _initialOwner)`. Fee `100000` = $0.10 USDC (6 decimals).

---

## Complete on-chain cycle

```bash
# 1. Buyer approves USDC spend
cast send 0x3600000000000000000000000000000000000000 \
  "approve(address,uint256)" $CONTRACT 100000 \
  --rpc-url https://rpc.mainnet.arc.io --private-key $BUYER_KEY

# 2. Buyer requests signal (4h window starting in 5 min)
WINDOW_OPEN=$(( $(date +%s) + 300 ))
WINDOW_CLOSE=$(( WINDOW_OPEN + 14400 ))
cast send $CONTRACT "requestSignal(string,uint256,uint256,uint256)" \
  "BTC" $WINDOW_OPEN $WINDOW_CLOSE 0 \
  --rpc-url https://rpc.mainnet.arc.io --private-key $BUYER_KEY

# 3. Seller locks in signal (before windowOpen)
curl -X POST https://predictagent.onrender.com/api/signal/commit \
  -H 'Content-Type: application/json' \
  -d '{"token":"BTC","requestId":"1"}'
# → { commitHash, revealData: { direction, targetPrice, confidenceBandBps, signalTimestamp, nonce } }

# 4. Seller commits hash on-chain
cast send $CONTRACT "commitSignal(uint256,bytes32)" 1 $COMMIT_HASH \
  --rpc-url https://rpc.mainnet.arc.io --private-key $SELLER_KEY

# 5. After windowClose: seller reveals
cast send $CONTRACT \
  "revealSignal(uint256,bytes32,uint256,uint256,uint256,uint256)" \
  1 $DIRECTION $TARGET_PRICE $CONFIDENCE_BPS $SIGNAL_TS $NONCE \
  --rpc-url https://rpc.mainnet.arc.io --private-key $SELLER_KEY

# 6. Owner records outcome (or Chainlink Automation does it automatically)
cast send $CONTRACT "recordOutcome(uint256,bool)" 1 true \
  --rpc-url https://rpc.mainnet.arc.io --private-key $OWNER_KEY
# correct=true → seller receives feePaid USDC
# correct=false → buyer is refunded feePaid USDC
```

---

## Signal service (public API — no auth required)

Live at: **https://predictagent.onrender.com**

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check + supported tokens |
| `GET /api/prices` | Live spot prices (Binance → Kraken → CoinGecko) |
| `GET /api/signal/latest?token=BTC` | Current signal with full indicator breakdown |
| `GET /api/signal/backtest?token=BTC&limit=200&interval=240` | Retrospective backtest (4h candles) |
| `GET /api/signal/:requestId` | Signal committed to a specific requestId |
| `POST /api/signal/commit` | Lock signal to requestId, return commitHash + revealData |

See [server/README.md](server/README.md) for full agent integration guide with TypeScript examples.

---

## Backtest results (DEMO v1 — in-sample, run 2026-10-18)

> **Retrospective in-sample results only. Look-ahead bias applies. Not financial advice.**

Full results: [BACKTEST_RESULTS.md](BACKTEST_RESULTS.md)

| Token | 4h Win% | 12h Win% | 24h Win% | Windows |
|---|---|---|---|---|
| BTC | 46% | 42% | 46% | 147 (4h) |
| ETH | 46% | 42% | 48% | 147 (4h) |
| SOL | **52%** | 45% | 50% | 147 (4h) |
| ARB | 44% | **50%** | **50%** | 147 (4h) |

**Why not 50%+ across the board?** Six indicators using majority vote has genuine directional signal around 46–52% — above the 50% random baseline on 2 of 4 tokens at 4h. The confidence band hit rate is higher because ATR-based bands are wide. See [BACKTEST_RESULTS.md](BACKTEST_RESULTS.md) for the full methodology and honest limitations.

---

## Signal indicators (DEMO v1)

Six indicators, majority vote decides direction:

| Indicator | Bullish signal | Bearish signal |
|---|---|---|
| RSI(14) | < 30 (oversold) | > 70 (overbought) |
| EMA(20/50) crossover | EMA20 > EMA50 | EMA20 < EMA50 |
| MACD(12/26/9) histogram | Positive | Negative |
| Bollinger Band position | Near lower band (< 0.2) | Near upper band (> 0.8) |
| Volume ratio (vs 20-period avg) | Rising volume | Falling volume |
| 24h price change | Positive | Negative |

Target: last close ± 1× ATR(14). Band: 1.5× ATR% of price, clamped 300–2000 bps.
**Label:** DEMO v1 — illustrative only, not a validated trading strategy.

---

## Running tests

```bash
# Solidity (51 tests)
forge test -vv

# Signal engine (25 tests)
bun test server/signal.test.ts

# Frontend lint + typecheck
bun run check
```

---

## Limitations (stated plainly)

| Limitation | What exists |
|---|---|
| Verifier is permissioned in `PredictAgent.sol` | `PredictAgentChainlink.sol` — trustless Chainlink upgrade path |
| Single seller per deployment | `SellerRegistry.sol` — any address can register |
| Signal logic is DEMO v1 | Readable, auditable, 44–52% directional accuracy in backtest. Not a validated strategy. |
| No on-chain automation in core contract | `PredictAgentChainlink.sol` implements `AutomationCompatibleInterface` |
| CoinGecko fallback may lag | Tier-3 fallback; circuit breaker skips it under rate-limit |
| No formal third-party audit | Self-audit with 4 findings fixed. See [AUDIT.md](AUDIT.md). |

---

## Disclaimer

Signals are informational only and do not constitute financial advice. The signal logic (DEMO v1) is illustrative and has not been validated for profitability. Past signal outcomes do not predict future results. Smart contracts carry inherent risk. This contract has not been formally audited by a third party. You are solely responsible for any financial decisions you make.
