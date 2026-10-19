# DEMO.md — PredictAgent Demo Video Guide

Two scripts below: **Short form** (90 sec, for hackathon submission) and **Long form** (3–5 min, for YouTube / social). Record the short form first — it is the submission requirement.

---

## Recording setup (do this before pressing record)

**Screen layout:**
- Browser: `https://predict-agent.vercel.app` open in a clean window (no bookmarks bar, no other tabs visible)
- Terminal: one pane ready, font size 16+, dark theme
- Wallet: MetaMask connected to Arc Mainnet (chain ID 5042) with $1.00+ USDC

**Tools:**
- macOS: QuickTime → New Screen Recording, or OBS
- Windows: OBS or Win + G (Xbox Game Bar)
- Linux: OBS

**Settings:** 1080p minimum, 30 fps. Record system audio off; add voiceover in post or talk while recording.

**Before you hit record:**
1. Open `https://predict-agent.vercel.app` — let the market ticker load
2. Connect MetaMask to Arc Mainnet in the browser
3. Open a terminal and confirm `curl https://predictagent.onrender.com/api/health` returns `200`
4. Clear the terminal history (`clear`)
5. Have the cast commands from Section 5 of `JUDGE_GUIDE.md` ready to paste — do not type live

---

## Short-form script — 90 seconds

**Target audience:** Hackathon judge who has 90 seconds.
**Goal:** Show the three proof points — live contract, tamper-proof commit, automated USDC settlement.
**Tone:** Calm and direct. No hype. Let the on-chain evidence speak.

---

### [0:00–0:10] Hook — one sentence, show the live app

> "PredictAgent is a trustless signal marketplace on Arc where AI agents pay USDC for price predictions that are cryptographically committed before the window opens."

**Screen:** Live app with market ticker scrolling. Do not click anything yet.

---

### [0:10–0:25] The problem it solves — 15 seconds

> "The problem: any signal seller can claim they predicted correctly after the fact. PredictAgent fixes that with a commit-reveal scheme — the seller locks a hash of their prediction on-chain before the window opens, then reveals after it closes. The contract settles automatically."

**Screen:** Click the **About** tab → scroll past the "How it works" section slowly so the four steps are visible.

---

### [0:25–0:45] Live signal + buy flow — 20 seconds

> "Here is the live app. The ticker shows real prices from Kraken. I'll request a BTC signal."

**Screen:**
1. Click **Buy Signal** tab
2. Select **BTC**
3. Show the signal preview panel — point at the indicator breakdown (RSI, EMA, MACD)
4. Show the fee: $0.10 USDC
5. Click **Approve USDC** (if wallet connected) — do not wait for the full tx in the short form, just show the MetaMask popup appearing

> "One approval, one transaction. USDC is the gas token on Arc — no ETH needed."

---

### [0:45–1:05] On-chain proof — 20 seconds

Switch to terminal.

> "The commit is already on-chain. Here's the contract."

```bash
cast call 0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f \
  "nextRequestId()(uint256)" \
  --rpc-url https://rpc.mainnet.arc.io
```

> "That's the request counter. Here's the signal fee the contract enforces:"

```bash
cast call 0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f \
  "signalFeeUsdc()(uint256)" \
  --rpc-url https://rpc.mainnet.arc.io
```

> "100000 — $0.10 in 6-decimal USDC. Hardcoded in the escrow."

---

### [1:05–1:20] The guarantee — 15 seconds

> "The seller cannot change their prediction after committing — the contract reverts on hash mismatch. If the seller never reveals, the buyer claims a full refund. 51 Foundry tests, 30 signal engine tests, a public audit doc. All in the repo."

**Screen:** Switch back to browser → click **Backtest** tab → show the win-rate bars for one token briefly.

---

### [1:20–1:30] Closing — 10 seconds

> "PredictAgent. Trustless signal market on Arc. $0.10 USDC per prediction, cryptographic commitment, automatic settlement."

**Screen:** Show the live app homepage with the market ticker. Fade out.

---

### Editing notes (short form)

- Cut all dead air and typing delays in post
- Add lower-thirds: contract address, GitHub URL, "Arc Mainnet" label
- Subtitle the terminal commands so judges can read them at 1.5x speed
- No background music — it distracts from the terminal output
- Total target: 85–90 seconds after cuts. Do not go over 90.

---

---

## Long-form script — 3–5 minutes

**Target audience:** Developer or investor watching on YouTube or in a project showcase.
**Goal:** Explain the architecture, show the full commit-reveal cycle end-to-end, and demonstrate the refund guardrail.
**Tone:** Technical but accessible.

---

### [0:00–0:20] Hook + thesis

> "Most signal services are just promises. I'll show you a different approach — price predictions that are cryptographically locked before the signal window opens, settled automatically in USDC on-chain, with a full refund guarantee if the seller disappears."

**Screen:** App homepage, ticker scrolling.

---

### [0:20–0:50] Architecture walkthrough

> "Three components. A Solidity escrow contract on Arc mainnet. A TypeScript signal service deployed on Render. And a Vite frontend on Vercel."

**Screen:** Open `ARCHITECTURE.md` in the browser (GitHub) → walk through the system diagram slowly.

> "The seller agent watches the contract for RequestCreated events. When a buyer submits a request, the seller computes a signal hash — keccak256 of the direction, target price, confidence band, timestamp, and a nonce — and commits it on-chain before the window opens. The contract stores the hash. After the window closes, the seller reveals the plaintext. The contract verifies the hash, checks the window, then settles."

---

### [0:50–1:30] Live signal + indicator breakdown

> "Let's see the signal engine live."

**Screen:** Click **Buy Signal** → select ETH.

> "Six indicators: RSI 14, EMA crossover 20/50, MACD histogram, Bollinger Band position, volume ratio, and 24-hour price change. Each votes bullish or bearish. The majority wins. The strength score is a weighted alignment — 100 means all six agree."

Point at each indicator row in the signal preview.

> "The target price is current price plus or minus one ATR, clamped between 0.5% and 3%. That's the band the contract settles against."

---

### [1:30–2:30] Full on-chain cycle in the terminal

> "I'll run a complete cycle. Approve, request, commit, reveal, settle."

**Screen:** Terminal. Paste each command, wait for output, narrate.

**Step 1 — Approve USDC:**
```bash
cast send 0x3600000000000000000000000000000000000000 \
  "approve(address,uint256)" \
  0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f 100000 \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $BUYER_KEY
```
> "Approved. $0.10 USDC. Sub-second confirmation on Arc."

**Step 2 — Request signal:**
```bash
cast send 0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f \
  "requestSignal(string,uint256,uint256,uint256)(uint256)" \
  "BTC" $(($(date +%s) + 60)) $(($(date +%s) + 3660)) 0 \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $BUYER_KEY
```
> "RequestCreated event emitted. The seller's service picked it up."

**Step 3 — Seller commits:**
```bash
curl -s -X POST https://predictagent.onrender.com/api/signal/commit \
  -H 'Content-Type: application/json' \
  -d '{"token":"BTC","requestId":"1"}'
```
> "The commit hash is now on-chain. The seller cannot change what they predicted."

**Step 4 — After window closes, reveal:**
> "After the window closes, the service reveals automatically. I'll trigger it manually:"
```bash
# (show the reveal API call or cast send revealSignal)
```

**Step 5 — Settle:**
```bash
cast call 0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f \
  "getRequest(uint256)((uint256,address,string,uint256,uint256,bytes32,bytes32,uint256,uint256,uint256,uint256,uint8,address,uint256,bool,bool))" \
  1 --rpc-url https://rpc.mainnet.arc.io
```
> "Status 3 — SETTLED. USDC released to the seller."

---

### [2:30–3:00] Guardrail demo — hash mismatch → refund

> "Now the adversarial case. What happens if the seller tries to change their prediction?"

**Screen:** Terminal.

> "I'll attempt to reveal with a different direction than what was committed."

```bash
# This reverts — hash doesn't match
cast send 0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f \
  "revealSignal(uint256,bytes32,uint256,uint256,uint256,uint256)" \
  1 0x0000000000000000000000000000000000000000000000000000000000000002 \
  999999 200 0 12345 \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $SELLER_KEY
```

> "Reverted: HashMismatch. The contract enforces the original commitment. If the seller never reveals at all, the buyer calls claimRefund after the deadline and gets their $0.10 back automatically."

---

### [3:00–3:30] Backtest results

> "How accurate is the signal engine? Let's run the backtest."

**Screen:** App → Backtest tab → Run Backtest.

> "500 candles per token at 4-hour intervals. The out-of-sample block — the last 30% of data the engine never trained on — shows 44 to 52% directional accuracy. That's honest. We're explicit in the docs that this is a v1 heuristic model, not a profitable trading system. The value is the cryptographic commitment, not the accuracy."

---

### [3:30–4:00] Code tour — 60 seconds

**Screen:** GitHub repo at `https://github.com/Agozie180/PredictAgent`

> "51 Foundry tests, all passing. 30 signal engine tests. A self-audit with 4 findings, all fixed. Three contracts: core escrow, a Chainlink trustless upgrade path for automated settlement, and a multi-seller registry for when you want multiple sellers competing."

Click `contracts/PredictAgent.sol` → show the `commitSignal` and `revealSignal` functions briefly.

> "The commit-reveal logic is about 60 lines. The escrow settlement is fully automated — no owner interaction needed for the happy path."

---

### [4:00–4:20] Why Arc

> "One thing worth calling out: USDC is the gas token on Arc. The buyer approves USDC, pays the signal fee in USDC, and pays gas in USDC. One asset, one wallet balance. An AI agent running this doesn't need to manage ETH or any wrapped token — just USDC. That's a meaningful UX difference for autonomous agents."

---

### [4:20–4:30] Close

> "PredictAgent. Live on Arc mainnet. $0.10 USDC per signal. Trustless commit-reveal. Full refund guarantee. MIT license. Links in the description."

**Screen:** App homepage. Fade out.

---

### Editing notes (long form)

- Add chapter markers at each section timestamp for YouTube
- Lower-thirds for: contract address, GitHub URL, "Arc Mainnet (chain 5042)", "51 Foundry tests", "30 Signal tests"
- Subtitle all terminal commands — judges and developers will pause to read them
- Cut the waiting time during `cast send` confirmations — Arc is fast (<500ms) but splice out any loading delay
- Add a text callout when "Reverted: HashMismatch" appears — this is the key proof moment
- Total target: 3:45–4:30 after cuts
- Export: 1080p H.264, < 500MB for upload

---

## After you record

1. Upload to YouTube (unlisted is fine for the submission)
2. Add the link to the README quick links table:

```markdown
| **Demo video** | https://youtu.be/YOUR_LINK |
```

3. Add the same link to `JUDGE_GUIDE.md` section 1 (Live app block)
4. Commit and push — one line change, takes 30 seconds
