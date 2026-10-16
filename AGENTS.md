# PredictAgent — Project Memory

## Project Summary
Pay-per-signal marketplace on Arc mainnet. AI buyer agents pay a fixed USDC fee per signal request. The contract holds payment via commit-reveal scheme, then releases to seller (correct signal) or refunds buyer (missed reveal / incorrect outcome).

## Smart Contract
- **File:** `contracts/PredictAgent.sol`
- **Tests:** `contracts/test/PredictAgent.t.sol` (42 passing)
- **Test helpers:** `contracts/test-helpers/MockERC20.sol`
- **Status:** Not yet deployed (awaiting mainnet credentials)
- **Contract address:** _TBD — set VITE_CONTRACT_ADDRESS in .env after deploy_

## Key Addresses (Arc)
- **USDC:** `0x3600000000000000000000000000000000000000` (Arc mainnet + testnet)
- **Chain ID mainnet:** `5042`
- **Chain ID testnet:** `5042002`
- **Explorer:** https://explorer.arc.io

---

## Deployment Instructions (Arc mainnet)

### Prerequisites
1. Foundry installed: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. Deployer wallet funded with USDC on Arc mainnet
3. Seller agent wallet address ready

### Step 1 — Build
```bash
forge build
```

### Step 2 — Deploy
```bash
forge create contracts/PredictAgent.sol:PredictAgent \
  --rpc-url https://rpc.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args \
    $SELLER_ADDRESS \
    1000000 \
    $OWNER_ADDRESS
```

- `$SELLER_ADDRESS` — the signal service wallet (calls `commitSignal` and `revealSignal`)
- `1000000` — $1.00 USDC fee per signal (6 decimals; adjust as desired)
- `$OWNER_ADDRESS` — deployer/admin wallet (calls `pause`, `setFee`, `setVerifier`)

### Step 3 — Wire the deployed address
```bash
printf 'VITE_CONTRACT_ADDRESS=0xYOUR_DEPLOYED_ADDRESS\n' >> .env
```
Then restart the dev server (Vite reads `.env` only at startup).

### Step 4 — Start the signal service
```bash
bun run server
```
Listens on port 3001. See `server/README.md` for the full agent integration guide.

### Step 5 — Run a complete cycle (using `cast`)

**Approve USDC (buyer):**
```bash
cast send 0x3600000000000000000000000000000000000000 \
  "approve(address,uint256)" $CONTRACT 1000000 \
  --rpc-url https://rpc.arc.io --private-key $BUYER_KEY
```

**Buy signal (buyer):**
```bash
cast send $CONTRACT \
  "requestSignal(string,uint256,uint256)" "BTC" $WINDOW_OPEN $WINDOW_CLOSE \
  --rpc-url https://rpc.arc.io --private-key $BUYER_KEY
```

**Commit hash (seller — use POST /signal/commit first):**
```bash
cast send $CONTRACT \
  "commitSignal(uint256,bytes32)" $REQUEST_ID $COMMIT_HASH \
  --rpc-url https://rpc.arc.io --private-key $SELLER_KEY
```

**Set verifier (owner):**
```bash
cast send $CONTRACT \
  "setVerifier(uint256,address)" $REQUEST_ID $VERIFIER_ADDRESS \
  --rpc-url https://rpc.arc.io --private-key $OWNER_KEY
```

**Reveal signal (seller — after windowClose, within revealDeadlineOffset):**
```bash
cast send $CONTRACT \
  "revealSignal(uint256,bytes32,uint256,uint256,uint256,uint256)" \
  $REQUEST_ID $DIRECTION $TARGET_PRICE $CONFIDENCE_BPS $SIGNAL_TIMESTAMP $NONCE \
  --rpc-url https://rpc.arc.io --private-key $SELLER_KEY
```

**Record outcome (verifier or owner):**
```bash
cast send $CONTRACT \
  "recordOutcome(uint256,bool)" $REQUEST_ID true \
  --rpc-url https://rpc.arc.io --private-key $VERIFIER_KEY
```

---

## Signal Fee
Default: `1000000` = $1.00 USDC (6 decimals). Set in constructor; change later with `setFee(newFee)` (owner only).

## Signal Service (Backend)
- **Files:** `server/index.ts`, `server/signal.ts`, `server/indicators.ts`, `server/marketData.ts`
- **Run:** `bun run server`
- **Tests:** `bun test server/signal.test.ts` (25 passing)
- **Port:** 3001 (proxied by Vite at `/api`)
- **Docs:** `server/README.md`
- **Data source:** Binance public REST API + CoinGecko fallback (no key required)
- **Signal version:** DEMO v1 — RSI, EMA crossover, MACD, Bollinger Bands, volume profile, 24h change

## Timeouts (default contract values)
| Parameter | Default | Setter |
|---|---|---|
| `revealDeadlineOffset` | 3600s (1h) | `setRevealDeadlineOffset(offset)` |
| `outcomeDeadlineOffset` | 86400s (24h) | `setOutcomeDeadlineOffset(offset)` |

## Transaction History
_To be filled after mainnet deployment_
- Deploy tx: TBD
- First request tx: TBD
- First commit tx: TBD
- First reveal tx: TBD
- First settlement tx: TBD
