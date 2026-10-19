import { ArrowRight, Shield, Zap, Brain, Lock, DollarSign, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useState } from 'react'

interface LandingPageProps {
  onEnterApp: () => void
}

const FAQS = [
  {
    q: 'What is PredictAgent?',
    a: 'PredictAgent is a pay-per-signal marketplace on Arc where AI agents and traders buy short-term price-movement signals for crypto assets. A registered seller agent publishes cryptographically committed signals; buyers pay a fixed USDC fee per request. The contract holds payment in escrow and settles automatically based on outcome verification.',
  },
  {
    q: 'Who is it for?',
    a: 'Two groups: (1) AI agents — autonomous bots that need trustless, on-chain access to price-movement signals without API keys, subscriptions, or off-chain intermediaries. (2) Traders who want a transparent, auditable signal record where the seller committed to the prediction before the window opened — not after.',
  },
  {
    q: 'Why is this built on Arc?',
    a: 'Arc uses USDC as its native gas token. That means paying for a signal IS a single USDC transaction — no ETH, no wrapped assets, no multi-step approvals for a different gas token. For AI agents making hundreds of micro-payments, this is a real simplification. Sub-second finality and predictable fees also mean agent workflows don\'t stall on gas estimation.',
  },
  {
    q: 'How does the commit-reveal scheme work?',
    a: 'Before the signal window opens, the seller submits a hash of their prediction on-chain. The hash locks in direction, target price, confidence band, and a nonce — the seller cannot change it after the fact. After the window closes, the seller reveals the raw data. The contract verifies it matches the hash. This is what makes the signal tamper-proof: a seller who got it wrong cannot quietly update their prediction.',
  },
  {
    q: 'What happens if the seller never reveals?',
    a: 'Buyers are fully protected. If the seller misses the reveal deadline (default 1 hour after window close), any buyer can call claimRefund and receive their USDC back in full. There is no way for the seller to keep the fee without delivering and revealing the signal.',
  },
  {
    q: 'Is the signal logic profitable?',
    a: 'No — and we are explicit about that. The signal engine uses a v1 heuristic model: RSI(14), EMA(20/50) crossover, MACD(12/26/9), Bollinger Bands, volume ratio, and 24h momentum. Backtests show 44–52% directional accuracy depending on the token and timeframe. This is illustrative, not a trading strategy. The value of the system is the trustless commitment and payment mechanism, not the current signal quality.',
  },
  {
    q: 'How does a buyer agent integrate programmatically?',
    a: 'The signal service exposes a public REST API at https://predictagent.onrender.com. Agents call GET /api/signal/latest?token=BTC to get the current signal before requesting on-chain, then use the contract ABI to call requestSignal(). Full curl and cast commands are in the JUDGE_GUIDE.md in the GitHub repo.',
  },
  {
    q: 'Is the contract audited?',
    a: 'The contract was reviewed for security with all findings fixed and documented in AUDIT.md. Four findings were addressed: per-request fee locking, verifier deadlock escape hatch, missing access control event, and renounce-while-paused protection. All 51 Foundry unit tests pass. This is not a formal third-party audit — see AUDIT.md for full scope and limitations.',
  },
  {
    q: 'What are the fees?',
    a: 'The signal fee is set by the contract owner (currently $1.00 USDC per request). There is no platform fee. Gas on Arc is paid in USDC at sub-cent amounts per transaction. The entire fee goes to the seller on a correct, settled signal — or back to the buyer on a refund.',
  },
  {
    q: 'Can I run my own seller agent?',
    a: 'Yes — SellerRegistry.sol (included in the repo) is a multi-seller upgrade pattern. Any address can register as a seller, set their own fee, and build their own signal logic. The core escrow contract is permissioned to one seller per deployment; multi-seller support requires deploying SellerRegistry.',
  },
]

const WHY_ARC = [
  {
    icon: DollarSign,
    title: 'USDC is the gas token',
    body: 'On Arc, USDC is the native gas asset. Buying a signal costs one USDC transaction — no ETH, no wrapping, no separate gas wallet. Agents pay exactly what they owe, nothing else.',
  },
  {
    icon: Zap,
    title: 'Sub-second finality',
    body: 'Signals have tight timing windows. Arc\'s ~500ms block time means agent workflows execute without waiting minutes for confirmation. Commit before the window opens. Reveal after it closes. No stalling.',
  },
  {
    icon: Shield,
    title: 'Predictable fees',
    body: 'Fee volatility on other chains forces agents to overestimate gas, wasting capital. Arc\'s stable fee model means agents budget exactly what they need — critical for high-frequency micro-payment flows.',
  },
  {
    icon: Brain,
    title: 'Agent-native design',
    body: 'Arc is built for apps where code is the user. PredictAgent\'s REST API + ABI lets any autonomous agent request, pay for, and verify signals without human intervention or off-chain dependencies.',
  },
]

export function LandingPage({ onEnterApp }: LandingPageProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-24">

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="text-center space-y-6 pt-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mono"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          LIVE ON ARC MAINNET · CONTRACT DEPLOYED
        </div>

        <h1 className="display text-4xl sm:text-5xl font-bold leading-tight" style={{ color: 'var(--ink)' }}>
          The first trustless<br />
          <span style={{ color: 'var(--accent)' }}>price-signal marketplace</span><br />
          for AI agents
        </h1>

        <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          AI agents pay USDC per signal. Sellers commit to predictions on-chain before the window opens.
          Payments are held in escrow and settled automatically — no trust required.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={onEnterApp}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all"
            style={{ background: 'var(--accent)', color: '#080f1a' }}
          >
            Open the app <ArrowRight size={16} />
          </button>
          <a
            href="https://github.com/Agozie180/PredictAgent"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }}
          >
            View on GitHub <ExternalLink size={14} />
          </a>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-8 max-w-2xl mx-auto">
          {[
            { n: '51', label: 'Foundry tests' },
            { n: '30', label: 'Signal tests' },
            { n: '3', label: 'Contracts' },
            { n: '$1.00', label: 'Per signal (USDC)' },
          ].map(s => (
            <div key={s.label} className="card p-4 text-center">
              <div className="display text-2xl font-bold" style={{ color: 'var(--accent)' }}>{s.n}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── What is it ────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>What is PredictAgent?</h2>
        <div className="card p-6 space-y-4 text-base leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          <p>
            PredictAgent is an on-chain marketplace where a <strong style={{ color: 'var(--ink)' }}>seller agent</strong> publishes short-term price-movement signals for crypto assets (BTC, ETH, SOL, ARB, POL). <strong style={{ color: 'var(--ink)' }}>Buyer agents or traders</strong> pay a fixed USDC fee per signal request.
          </p>
          <p>
            The key innovation is a <strong style={{ color: 'var(--ink)' }}>commit-reveal scheme</strong>: the seller must hash and submit their prediction on-chain <em>before</em> the signal window opens. This makes the signal tamper-proof — the seller cannot revise their prediction after seeing the outcome.
          </p>
          <p>
            Payment is held in escrow by the smart contract. If the seller reveals a valid signal that matches their commitment, payment is released. If they miss the deadline or the hash doesn't match, the buyer is refunded in full. No intermediary. No trust required.
          </p>
        </div>
      </section>

      {/* ── Who it's for ──────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Who is it for?</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              title: 'AI Agents',
              icon: Brain,
              color: 'var(--accent)',
              points: [
                'Autonomous bots that need trustless market signals',
                'No API keys, subscriptions, or off-chain intermediaries',
                'Pay per signal — pay only when you need data',
                'Full REST API for programmatic access',
                'On-chain proof of signal commitment',
              ],
            },
            {
              title: 'Traders & Researchers',
              icon: Shield,
              color: 'var(--success)',
              points: [
                'Transparent signal with auditable commit history',
                'Seller cannot revise prediction after the fact',
                'Full refund if signal is not delivered',
                'Backtest data published for every token',
                'Open-source signal logic — audit it yourself',
              ],
            },
          ].map(card => {
            const Icon = card.icon
            return (
              <div key={card.title} className="card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: `${card.color}20` }}>
                    <Icon size={18} style={{ color: card.color }} />
                  </div>
                  <h3 className="font-semibold text-base" style={{ color: 'var(--ink)' }}>{card.title}</h3>
                </div>
                <ul className="space-y-2">
                  {card.points.map(p => (
                    <li key={p} className="flex items-start gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
                      <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: card.color }} />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Why Arc ───────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <div>
          <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Why Arc?</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Arc is Circle's blockchain where USDC is the native gas token. That changes everything for a payments-first app.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {WHY_ARC.map(item => {
            const Icon = item.icon
            return (
              <div key={item.title} className="card p-5 flex gap-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: 'var(--accent-dim)' }}>
                  <Icon size={17} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--ink)' }}>{item.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{item.body}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>How it works</h2>
        <div className="card p-6">
          <ol className="space-y-6">
            {[
              {
                n: '01',
                title: 'Buyer requests a signal',
                body: 'Connect your wallet, select a token (BTC, ETH, SOL, ARB, POL), approve USDC, and submit a signal request. The contract holds your USDC in escrow and emits a RequestCreated event.',
              },
              {
                n: '02',
                title: 'Seller commits a hash',
                body: 'Before the signal window opens, the seller agent submits a keccak256 hash of (direction, target price, confidence band, timestamp, nonce) on-chain. The prediction is now locked — the seller cannot change it.',
              },
              {
                n: '03',
                title: 'Window opens and closes',
                body: 'The signal window runs its course (typically 1–24 hours). The market moves. When the window closes, the seller has a deadline to reveal.',
              },
              {
                n: '04',
                title: 'Seller reveals',
                body: 'The seller submits the raw signal data. The contract verifies it matches the committed hash. If it matches, the request moves to REVEALED status.',
              },
              {
                n: '05',
                title: 'Outcome recorded and settled',
                body: 'A permissioned verifier (or Chainlink Data Feed in the upgrade path) posts the observed price outcome. If the signal was correct, USDC is released to the seller. If not, the buyer is refunded.',
              },
            ].map((step, i, arr) => (
              <li key={step.n} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mono text-xs font-bold"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>
                    {step.n}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="w-px flex-1 mt-2" style={{ background: 'var(--border)' }} />
                  )}
                </div>
                <div className="pb-2">
                  <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--ink)' }}>{step.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Security & trust ──────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Security & trust model</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { icon: Lock, title: 'Escrow enforced', body: 'USDC is held by the contract, not the seller. No one can move it until the outcome is determined.' },
            { icon: Shield, title: 'CEI ordering', body: 'All state changes happen before token transfers. Reentrancy guards on every external call.' },
            { icon: Zap, title: '51 tests, 0 failures', body: 'Foundry unit tests cover every state transition, every refund path, and a 256-run fuzz suite.' },
          ].map(item => {
            const Icon = item.icon
            return (
              <div key={item.title} className="card p-5 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto"
                  style={{ background: 'var(--success-dim)' }}>
                  <Icon size={18} style={{ color: 'var(--success)' }} />
                </div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{item.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Frequently asked questions</h2>
        <div className="space-y-2">
          {FAQS.map((faq, i) => (
            <div key={i} className="card overflow-hidden">
              <button
                className="w-full flex items-center justify-between gap-4 p-5 text-left"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <span className="font-medium text-sm" style={{ color: 'var(--ink)' }}>{faq.q}</span>
                {openFaq === i
                  ? <ChevronUp size={16} className="shrink-0" style={{ color: 'var(--muted)' }} />
                  : <ChevronDown size={16} className="shrink-0" style={{ color: 'var(--muted)' }} />}
              </button>
              {openFaq === i && (
                <div className="px-5 pb-5 text-sm leading-relaxed" style={{ color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                  <p className="pt-4">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Disclaimer ────────────────────────────────────────────────── */}
      <section className="card p-5 text-xs leading-relaxed space-y-1" style={{ color: 'var(--subtle)', borderColor: 'var(--border)' }}>
        <p className="font-semibold uppercase tracking-widest text-[10px] mb-2" style={{ color: 'var(--muted)' }}>Disclaimer</p>
        <p>Signals are informational only and are NOT financial advice. The signal engine uses a v1 heuristic model (RSI, EMA, MACD, Bollinger, volume). Past signal performance does not guarantee future results. Backtests show 44–52% directional accuracy — treat this as a protocol demonstration, not a trading strategy.</p>
        <p>Smart contracts carry inherent risk. This contract has not been formally audited by a third party. The security review is documented in <a href="https://github.com/Agozie180/PredictAgent/blob/main/AUDIT.md" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>AUDIT.md</a>. Use only funds you can afford to lose. The contract is deployed on Arc mainnet — transactions are irreversible.</p>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="text-center pb-12 space-y-4">
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Ready to start?</h2>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet and request your first signal on Arc mainnet.</p>
        <button
          onClick={onEnterApp}
          className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-sm transition-all"
          style={{ background: 'var(--accent)', color: '#080f1a' }}
        >
          Open the app <ArrowRight size={16} />
        </button>
      </section>

    </div>
  )
}
