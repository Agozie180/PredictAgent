import { useState } from 'react'
import { PREDICT_AGENT_ADDRESS } from './lib/predictAgentAbi'
import { Header } from './components/Header'
import { Disclaimer } from './components/Disclaimer'
import { ContractNotDeployed } from './components/ContractNotDeployed'
import { MarketTicker } from './components/MarketTicker'
import { SignalFeed } from './components/SignalFeed'
import { BuySignal } from './components/BuySignal'
import { RequestDetail } from './components/RequestDetail'
import { BacktestPanel } from './components/BacktestPanel'
import { LandingPage } from './components/LandingPage'
import { ErrorToastProvider } from './components/ErrorToast'
import { BarChart2, ShoppingCart, Search, Zap, FlaskConical, Home } from 'lucide-react'

type View = 'home' | 'feed' | 'buy' | 'detail' | 'backtest'

const TABS = [
  { id: 'home' as View,     label: 'About',          icon: Home },
  { id: 'feed' as View,     label: 'Signal Feed',    icon: BarChart2 },
  { id: 'backtest' as View, label: 'Backtest',        icon: FlaskConical },
  { id: 'buy' as View,      label: 'Buy Signal',     icon: ShoppingCart },
  { id: 'detail' as View,   label: 'Track Request',  icon: Search },
]

export default function App() {
  const [view, setView] = useState<View>('home')
  const [detailRequestId, setDetailRequestId] = useState<string | undefined>()

  function navigate(v: View) {
    setView(v)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <ErrorToastProvider>
      <div className="min-h-dvh flex flex-col">
        <Header />
        <MarketTicker />

        <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {!PREDICT_AGENT_ADDRESS ? (
            <ContractNotDeployed />
          ) : (
            <div className="flex flex-col lg:flex-row gap-6">
              {/* ── Sidebar nav (desktop) / tab bar (mobile) ──────────── */}
              <aside className="w-full lg:w-56 shrink-0">
                {/* Mobile: horizontal scrolling tab bar */}
                <nav
                  className="lg:hidden flex gap-1 overflow-x-auto pb-1"
                  style={{ scrollbarWidth: 'none' }}
                >
                  {TABS.map(tab => {
                    const Icon = tab.icon
                    const active = view === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => navigate(tab.id)}
                        className="flex items-center gap-2 px-3.5 rounded-xl font-medium transition-all shrink-0 whitespace-nowrap"
                        style={{
                          height: 44,
                          minHeight: 44,
                          background: active ? 'var(--surface-raised)' : 'transparent',
                          color: active ? 'var(--ink)' : 'var(--muted)',
                          border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                          fontSize: 13,
                        }}
                      >
                        <Icon size={14} style={{ color: active ? 'var(--accent)' : 'var(--subtle)' }} />
                        {tab.label}
                      </button>
                    )
                  })}
                </nav>

                {/* Desktop: vertical sidebar */}
                <nav className="hidden lg:flex flex-col gap-1 lg:sticky lg:top-20">
                  {TABS.map(tab => {
                    const Icon = tab.icon
                    const active = view === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => navigate(tab.id)}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-left w-full"
                        style={{
                          background: active ? 'var(--surface-raised)' : 'transparent',
                          color: active ? 'var(--ink)' : 'var(--muted)',
                          border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                        }}
                      >
                        <Icon size={15} style={{ color: active ? 'var(--accent)' : 'var(--subtle)' }} />
                        {tab.label}
                      </button>
                    )
                  })}

                  {/* Agent API quick-ref */}
                  <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-semibold mb-2 px-1" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
                      AGENT API
                    </p>
                    {[
                      { method: 'GET', path: '/api/signal/latest?token=BTC' },
                      { method: 'GET', path: '/api/signal/:requestId' },
                      { method: 'GET', path: '/api/health' },
                    ].map(e => (
                      <div key={e.path} className="flex items-start gap-1.5 mb-1.5 px-1">
                        <span className="mono text-[9px] font-bold shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}>{e.method}</span>
                        <span className="mono text-[9px] break-all leading-relaxed" style={{ color: 'var(--subtle)' }}>{e.path}</span>
                      </div>
                    ))}
                  </div>

                  {/* Mainnet badge */}
                  <div className="flex items-center gap-1.5 mt-4 px-1">
                    <Zap size={10} style={{ color: 'var(--gold)' }} />
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--gold)', letterSpacing: '0.06em' }}>
                      LIVE · ARC MAINNET
                    </span>
                  </div>
                </nav>
              </aside>

              {/* ── Main content ─────────────────────────────────────────── */}
              <main className="flex-1 min-w-0">
                {view !== 'home' && <Disclaimer />}

                {view === 'home' && (
                  <LandingPage onEnterApp={() => navigate('feed')} />
                )}
                {view === 'feed' && (
                  <SignalFeed onBuySignal={() => navigate('buy')} />
                )}
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
                {view === 'backtest' && (
                  <BacktestPanel />
                )}
              </main>
            </div>
          )}
        </div>
      </div>
    </ErrorToastProvider>
  )
}
