import { useState } from 'react'
import { PREDICT_AGENT_ADDRESS } from './lib/predictAgentAbi'
import { Header } from './components/Header'
import { Disclaimer } from './components/Disclaimer'
import { ContractNotDeployed } from './components/ContractNotDeployed'
import { MarketTicker } from './components/MarketTicker'
import { SignalFeed } from './components/SignalFeed'
import { BuySignal } from './components/BuySignal'
import { RequestDetail } from './components/RequestDetail'

type View = 'feed' | 'buy' | 'detail'

export default function App() {
  const [view, setView] = useState<View>('feed')
  const [detailRequestId, setDetailRequestId] = useState<string | undefined>()

  function navigate(v: View) {
    setView(v)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6 pb-24">
        {/* Page title */}
        <div>
          <h1 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            PredictAgent
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            AI-powered price-movement signal marketplace on Arc — pay per signal, settle on-chain.
          </p>
          <p className="text-xs mt-1 font-semibold" style={{ color: 'var(--accent)', letterSpacing: '0.04em' }}>
            DEMO v1 — Signal logic is illustrative only.
          </p>
        </div>

        <Disclaimer />
        <MarketTicker />

        {!PREDICT_AGENT_ADDRESS ? (
          <ContractNotDeployed />
        ) : (
          <>
            {/* Tab nav (only shown when deployed) */}
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              {([
                { id: 'feed', label: 'Signal Feed' },
                { id: 'buy', label: 'Buy Signal' },
                { id: 'detail', label: 'Request Detail' },
              ] as { id: View; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => navigate(tab.id)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: view === tab.id ? 'var(--surface-strong)' : 'transparent',
                    color: view === tab.id ? 'var(--ink)' : 'var(--subtle)',
                    border: view === tab.id ? '1px solid var(--border)' : '1px solid transparent',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {view === 'feed' && <SignalFeed onBuySignal={() => navigate('buy')} />}
            {view === 'buy' && (
              <BuySignal
                onBack={() => navigate('feed')}
                onViewRequest={(id) => {
                  setDetailRequestId(id)
                  navigate('detail')
                }}
              />
            )}
            {view === 'detail' && (
              <RequestDetail
                onBack={() => navigate('feed')}
                initialRequestId={detailRequestId}
              />
            )}
          </>
        )}

        {/* Agent API docs */}
        <div className="rounded-2xl p-6 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="display text-sm font-semibold" style={{ color: 'var(--ink-2)', letterSpacing: '-0.01em' }}>
            Agent API
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Other AI agents can request signals programmatically via the signal service REST API (running on port 3001):
          </p>
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            {[
              { method: 'GET', path: '/api/signal/latest?token=BTC', desc: 'Latest signal for a token' },
              { method: 'GET', path: '/api/signal/:requestId', desc: 'Signal for a specific request ID' },
              { method: 'GET', path: '/api/health', desc: 'Service health + supported tokens' },
            ].map(e => (
              <div key={e.path} className="flex items-start gap-3">
                <span
                  className="mono text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                  style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}
                >
                  {e.method}
                </span>
                <div className="min-w-0">
                  <p className="mono text-xs break-all" style={{ color: 'var(--ink-2)' }}>{e.path}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{e.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            See <span className="mono">server/README.md</span> for the full agent integration guide and commit/reveal flow.
          </p>
        </div>
      </main>
    </div>
  )
}
