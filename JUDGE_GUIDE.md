# Judge Guide — PredictAgent

Everything you need to evaluate this project in under 10 minutes.

---

## 1. Live app

**https://predict-agent.vercel.app**

- Connect wallet (MetaMask or WalletConnect) to Arc mainnet (chain ID 5042)
- Market ticker loads live prices from Kraken + CoinGecko
- Click **Backtest** → **Run Backtest** to see signal accuracy across 500 candles per token
- Click **Buy Signal** → select BTC → approve USDC → submit request

---

## 2. Contract on Arc mainnet

```
Address:  0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff
Chain:    Arc Mainnet (5042)
Explorer: https://explorer.arc.io/address/0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff
```

Read live state (no wallet needed):
```bash
# Signal fee
cast call 0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff \
  "signalFeeUsdc()(uint256)" \
  --rpc-url https://rpc.mainnet.arc.io

# Next request ID
cast call 0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff \
  "nextRequestId()(uint256)" \
  --rpc-url https://rpc.mainnet.arc.io

# Get a request (replace 1 with any requestId)
cast call 0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff \
  "getRequest(uint256)((uint256,address,string,uint256,uint256,bytes32,bytes32,uint256,uint256,uint256,uint256,uint8,address,uint256,bool,bool))" \
  1 --rpc-url https://rpc.mainnet.arc.io
```

---

## 3. Run everything locally (5 minutes)

### Prerequisites
- [Bun](https://bun.sh) ≥ 1.1
- [Foundry](https://getfoundry.sh) (`forge`, `cast`)
- Node.js ≥ 18 (for Vite)

```bash
git clone https://github.com/Agozie180/PredictAgent
cd PredictAgent
bun install
```

### Run Solidity tests (51 tests)
```bash
forge test -vv
```
Expected: `51 passed, 0 failed`

### Run signal engine tests (30 tests)
```bash
bun test server/signal.test.ts
```
Expected: `30 pass, 0 fail`

### Start the signal service
```bash
bun run server
# Listening on https://predictagent.onrender.com
```

### Run backtests
```bash
# BTC — 500 candles, ~74 signal windows
curl "https://predictagent.onrender.com/signal/backtest?token=BTC&limit=500"

# ETH, SOL, ARB
for t in ETH SOL ARB; do
  echo "=== $t ===" && curl -s "https://predictagent.onrender.com/signal/backtest?token=$t&limit=500" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  windows={d[\"windowCount\"]} winRate={d[\"winRate\"]:.1%} avgStrength={d[\"avgStrength\"]:.1f}')"
done

# Per-trade breakdown (BTC, 500 candles)
curl "https://predictagent.onrender.com/signal/backtest?token=BTC&limit=500&trades=true" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); trades=d.get('trades',[]); print(f'{len(trades)} trades, {sum(t[\"directionalWin\"] for t in trades)} directional wins')"
```

### Start the frontend
```bash
bun run dev
# https://predict-agent.vercel.app
```

---

## 4. Get a live signal (agent API)

```bash
# Latest BTC signal
curl "https://predictagent.onrender.com/signal/latest?token=BTC"

# Response includes:
# - direction: BULLISH | BEARISH
# - strengthScore: 0–100
# - targetPrice: price in USDC 6-decimal units
# - reasoning: { rsi, macdHistogram, ema20AboveEma50, bbPosition, volumeRatio, ... }
# - commitHash: null until committed to a requestId
```

---

## 5. Run a complete on-chain cycle

### Step A — Buyer approves USDC
```bash
cast send 0x3600000000000000000000000000000000000000 \
  "approve(address,uint256)" \
  0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff 100000 \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $BUYER_KEY
```

### Step B — Buyer requests a signal
```bash
# windowOpen = now + 60s, windowClose = now + 3660s, buyerRevealOffset = 0 (use global default)
cast send 0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff \
  "requestSignal(string,uint256,uint256,uint256)(uint256)" \
  "BTC" $(($(date +%s) + 60)) $(($(date +%s) + 3660)) 0 \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $BUYER_KEY
```

### Step C — Seller commits signal hash (before windowOpen)
```bash
curl -s -X POST https://predictagent.onrender.com/signal/commit \
  -H 'Content-Type: application/json' \
  -d '{"token":"BTC","requestId":"1"}'
# Returns: commitHash + revealData (keep revealData secret)

cast send 0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff \
  "commitSignal(uint256,bytes32)" \
  1 0xYOUR_COMMIT_HASH \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $SELLER_KEY
```

### Step D — Seller reveals (after windowClose)
```bash
cast send 0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff \
  "revealSignal(uint256,bytes32,uint256,uint256,uint256,uint256)" \
  1 $DIRECTION $TARGET_PRICE $CONF_BAND $SIGNAL_TIMESTAMP $NONCE \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $SELLER_KEY
```

### Step E — Owner/verifier records outcome → auto-settles
```bash
cast send 0xD64d1FD08e81bbF5aAa194a138d005AA4d4E75Ff \
  "recordOutcome(uint256,bool)" \
  1 true \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $OWNER_KEY
# USDC released to seller automatically
```

---

## 6. Audit the signal logic yourself

The entire signal logic is in **`server/signal.ts`**, function `computeSignal()` at line 77.

Rules (all auditable, ~50 lines):
1. **RSI(14)**: <30 → bullish reversal; >70 → bearish reversal
2. **EMA crossover (20/50)**: 20>50 → uptrend; 20<50 → downtrend
3. **MACD histogram**: positive → bullish; negative → bearish
4. **Bollinger Band position**: near lower → oversold; near upper → overbought
5. **Volume ratio**: >1.2 confirms; <0.8 weakens
6. **24h price change**: positive → bullish bias; negative → bearish bias

Direction = majority vote. Strength score = weighted indicator alignment (0–100).

```bash
# Verify the logic matches the tests
bun test server/signal.test.ts --reporter=verbose
```

---

## 7. Verify the commit-reveal scheme

The contract enforces that the seller commits a hash BEFORE the signal window opens, then reveals AFTER it closes. The hash is:

```solidity
keccak256(abi.encodePacked(
  requestId, direction, targetPrice,
  confidenceBandBps, signalTimestamp, nonce
))
```

The TypeScript implementation in `server/signal.ts::computeCommitHash()` must produce an identical hash. Test:

```bash
bun test server/signal.test.ts -t "commitHash closure"
# Verifies: TypeScript hash === Solidity hash for the same inputs
```

---

## 8. What the contract is structurally prevented from doing

| Claim | Enforcement |
|---|---|
| Seller cannot retroactively change the signal | `commitHash` is immutable once stored; `revealSignal` reverts if hash doesn't match |
| Buyer always gets refunded if seller disappears | `claimRefund` available after `buyerRevealDeadline` (PENDING/COMMITTED) or `outcomeDeadlineOffset` (REVEALED) |
| Fee change doesn't affect in-flight requests | Each request stores `feePaid` at creation; settlement uses that value |
| Paused contract can't be permanently bricked | `renounceOwnership()` reverts when `paused == true` |

---

## 9. GitHub

**https://github.com/Agozie180/PredictAgent**

Key files:
```
contracts/PredictAgent.sol          — core escrow contract
contracts/PredictAgentChainlink.sol — trustless Chainlink upgrade path
contracts/SellerRegistry.sol        — multi-seller registry
contracts/test/PredictAgent.t.sol   — 51 Foundry tests
server/signal.ts                    — signal engine (DEMO v1)
server/indicators.ts                — RSI, EMA, MACD, BB, ATR, volume
server/signal.test.ts               — 30 signal tests
AUDIT.md                            — security findings + fixes
ARCHITECTURE.md                     — system design + sequence diagrams
```
