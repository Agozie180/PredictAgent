/**
 * BacktestPanel — DEMO v1 retrospective backtest results.
 *
 * Fetches live backtest results from the signal service and renders
 * a per-token table with win rate, signal count, and average strength.
 *
 * Prominent disclaimer: in-sample, look-ahead bias, not financial advice.
 */
import { useState } from 'react'
import { AlertTriangle, RefreshCw, BarChart2, TrendingUp, TrendingDown } from 'lucide-react'
import { SUPPORTED_TOKENS } from '../lib/utils'
import { TokenIcon } from './TokenIcon'

interface BacktestResult {
  token: string
  windowCount: number
  wins: number
  losses: number
  winRate: number
  avgStrength: number
  disclaimer: string
  warning?: string
  error?: string
  candles?: number
}

async function fetchBacktest(token: string): Promise<BacktestResult> {
  const res = await fetch(`/api/signal/backtest?token=${token}&limit=200`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<BacktestResult>
}

export function BacktestPanel() {
  const [results, setResults] = useState<Record<string, BacktestResult>>({})
  const [loading, setLoading] = useState(false)
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runBacktests() {
    setLoading(true)
    setError(null)
    try {
      const entries = await Promise.all(
        SUPPORTED_TOKENS.map(t =>
          fetchBacktest(t).then(r => [t, r] as [string, BacktestResult]).catch(e => [t, { error: String(e), token: t, windowCount: 0, wins: 0, losses: 0, winRate: 0, avgStrength: 0, disclaimer: '' }] as [string, BacktestResult])
        )
      )
      setResults(Object.fromEntries(entries))
      setLastRun(Date.now())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }



  const hasResults = Object.keys(results).length > 0
  const avgWinRate = hasResults
    ? Object.values(results).filter(r => !r.error && r.windowCount > 0).reduce((s, r) => s + r.winRate, 0) /
      Object.values(results).filter(r => !r.error && r.windowCount > 0).length
    : 0

  return (
    <div className="flex flex-col gap-6">

      {/* Disclaimer — always first, always prominent */}
      <div
        className="rounded-2xl p-4 flex gap-3"
        style={{ background: 'rgba(240,112,128,0.08)', border: '1px solid rgba(240,112,128,0.25)' }}
      >
        <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
        <div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--danger)' }}>
            DEMO v1 — Retrospective In-Sample Backtest Only
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--subtle)' }}>
            These results are computed over the same candles used to generate the signal.
            They suffer from <strong style={{ color: 'var(--ink-2)' }}>look-ahead bias</strong> and
            cannot predict future performance. Signal logic (RSI, EMA, MACD, Bollinger Bands) is
            illustrative. <strong style={{ color: 'var(--ink-2)' }}>Not financial advice.</strong> Do
            not make investment decisions based on these numbers.
          </p>
        </div>
      </div>

      {/* Header + run button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Signal Backtest</h2>
          {lastRun && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
              Last run: {new Date(lastRun).toLocaleTimeString()} · 200 candles per token · 1h intervals
            </p>
          )}
        </div>
        <button
          onClick={() => { void runBacktests() }}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--ink-2)',
            opacity: loading ? 0.6 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Running…' : 'Run Again'}
        </button>
      </div>

      {/* Service offline notice */}
      {error && (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
          Signal service offline — start with <code className="px-1 rounded text-xs" style={{ background: 'var(--surface-2)' }}>bun run server</code>. {error}
        </div>
      )}

      {/* Summary stat */}
      {hasResults && !error && (
        <div
          className="rounded-2xl p-5 flex items-center gap-6"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(110,201,138,0.12)' }}>
              <BarChart2 size={20} style={{ color: 'var(--success)' }} />
            </div>
            <div>
              <p className="text-xs mb-0.5" style={{ color: 'var(--subtle)' }}>AVG WIN RATE ACROSS ALL TOKENS</p>
              <p className="display text-3xl font-bold tabular-nums" style={{ color: avgWinRate >= 0.55 ? 'var(--success)' : avgWinRate >= 0.45 ? 'var(--ink)' : 'var(--danger)' }}>
                {(avgWinRate * 100).toFixed(1)}%
              </p>
            </div>
          </div>
          <div className="text-xs leading-relaxed ml-auto max-w-xs text-right" style={{ color: 'var(--subtle)' }}>
            Win = target price hit within next 6 candles. In-sample only.
          </div>
        </div>
      )}

      {/* Per-token results */}
      {loading && !hasResults ? (
        <div className="flex flex-col gap-3">
          {SUPPORTED_TOKENS.map(t => (
            <div key={t} className="rounded-2xl p-5 animate-pulse h-20" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {SUPPORTED_TOKENS.map(token => {
            const r = results[token]
            if (!r) return null
            if (r.error) return (
              <div key={token} className="rounded-2xl p-5 flex items-center gap-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <TokenIcon token={token} size={28} />
                <span className="font-bold" style={{ color: 'var(--ink)' }}>{token}</span>
                <span className="text-xs ml-auto" style={{ color: 'var(--danger)' }}>Failed: {r.error}</span>
              </div>
            )

            const wr = r.winRate
            const wrColor = wr >= 0.6 ? 'var(--success)' : wr >= 0.5 ? 'var(--ink-2)' : wr >= 0.4 ? 'var(--warn, #f0a070)' : 'var(--danger)'
            const barWidth = `${Math.round(wr * 100)}%`

            return (
              <div
                key={token}
                className="rounded-2xl p-5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                {/* Row 1: header */}
                <div className="flex items-center gap-3 mb-4">
                  <TokenIcon token={token} size={28} />
                  <span className="font-bold text-base" style={{ color: 'var(--ink)' }}>{token}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full ml-1" style={{ background: 'var(--surface-2)', color: 'var(--subtle)', border: '1px solid var(--border)' }}>
                    {r.candles ?? r.windowCount * 6 + 55} candles · {r.windowCount} windows
                  </span>
                  <span className="ml-auto display text-2xl font-bold tabular-nums" style={{ color: wrColor }}>
                    {(wr * 100).toFixed(1)}%
                  </span>
                </div>

                {/* Win rate bar */}
                <div className="rounded-full overflow-hidden mb-3" style={{ height: 6, background: 'var(--surface-2)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: barWidth, background: wrColor }}
                  />
                </div>

                {/* Row 2: stats */}
                <div className="grid grid-cols-4 gap-3">
                  <Stat label="WINS" value={String(r.wins)} color="var(--success)" icon={<TrendingUp size={12} />} />
                  <Stat label="LOSSES" value={String(r.losses)} color="var(--danger)" icon={<TrendingDown size={12} />} />
                  <Stat label="WIN RATE" value={`${(wr * 100).toFixed(1)}%`} color={wrColor} />
                  <Stat label="AVG STRENGTH" value={r.avgStrength.toFixed(0)} color="var(--ink-2)" />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer methodology */}
      <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em' }}>DEMO v1 SIGNAL RULES (AUDITABLE)</p>
        <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--subtle)' }}>
          {[
            ['RSI(14)', 'Oversold (<30) → bullish bias; Overbought (>70) → bearish bias'],
            ['EMA 20/50', 'Golden cross (20>50) → bullish; Death cross → bearish'],
            ['MACD(12,26,9)', 'Positive histogram → bullish momentum; negative → bearish'],
            ['Bollinger Bands', 'Price near lower band → oversold; near upper → overbought'],
            ['Volume ratio', '>1.2× avg confirms move; <0.8× weakens signal'],
            ['24h change', 'Positive → bullish tilt; negative → bearish tilt (0.5 weight)'],
          ].map(([name, desc]) => (
            <div key={name} className="flex gap-2">
              <span className="font-semibold shrink-0" style={{ color: 'var(--ink-2)', minWidth: 80 }}>{name}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--subtle)', opacity: 0.7 }}>
          Direction = majority vote across 6 indicators (equal weight, except 24h change and volume at 0.5). Target = spot ± 1× ATR(14). Confidence band = 1.5× ATR%, clamped 3–20%.
        </p>
      </div>

    </div>
  )
}

function Stat({ label, value, color, icon }: { label: string; value: string; color: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-semibold flex items-center gap-1" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>
        {icon}{label}
      </p>
      <p className="display text-lg font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  )
}
