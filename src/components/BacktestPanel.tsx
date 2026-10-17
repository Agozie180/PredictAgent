/**
 * BacktestPanel — runs retrospective signal backtests via the signal service API
 * and displays results with full transparency.
 *
 * Prominent disclaimer: in-sample, look-ahead bias, not financial advice.
 */
import { useState } from 'react'
import { AlertTriangle, RefreshCw, FlaskConical, TrendingUp, TrendingDown, Info } from 'lucide-react'
import { SUPPORTED_TOKENS } from '../lib/utils'
import { TokenIcon } from './TokenIcon'

interface BacktestResult {
  token: string
  windowCount: number
  wins: number
  losses: number
  bandHits: number
  winRate: number
  bandHitRate: number
  avgStrength: number
  avgForwardReturn: number
  bullishCount: number
  bearishCount: number
  strongSignalWinRate: number
  weakSignalWinRate: number
  candles: number
  disclaimer: string
  warning: string
  tradesOmitted?: number
}

function WinBar({ rate, label, color }: { rate: number; label: string; color: string }) {
  const pct = Math.round(rate * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function TokenCard({ result }: { result: BacktestResult }) {
  const winColor = result.winRate >= 0.6 ? 'var(--success)' : result.winRate >= 0.5 ? 'var(--gold)' : 'var(--danger)'
  const returnColor = result.avgForwardReturn >= 0 ? 'var(--success)' : 'var(--danger)'

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4" style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <TokenIcon token={result.token} size={22} />
          <span className="text-base font-bold" style={{ color: 'var(--ink)' }}>{result.token}</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
            background: 'var(--surface-raised)',
            color: 'var(--subtle)',
            border: '1px solid var(--border)',
          }}>{result.windowCount} signals</span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black tabular-nums" style={{ color: winColor, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(result.winRate * 100)}%
          </div>
          <div className="text-[10px]" style={{ color: 'var(--subtle)' }}>directional</div>
        </div>
      </div>

      {/* Win bars */}
      <div className="flex flex-col gap-2.5">
        <WinBar rate={result.winRate} label="Directional accuracy (strict)" color={winColor} />
        <WinBar rate={result.bandHitRate} label="Target band hit rate (loose)" color="var(--accent)" />
        {result.windowCount > 0 && (
          <>
            <WinBar rate={result.strongSignalWinRate} label="Strong signals (score ≥65) win rate" color="var(--success)" />
            <WinBar rate={result.weakSignalWinRate} label="Weak signals (score <65) win rate" color="var(--muted)" />
          </>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Windows', value: result.windowCount.toString() },
          { label: 'Wins', value: result.wins.toString(), color: 'var(--success)' },
          { label: 'Losses', value: result.losses.toString(), color: result.losses > 0 ? 'var(--danger)' : 'var(--subtle)' },
          { label: 'Candles', value: result.candles.toString() },
          { label: 'Avg Strength', value: result.avgStrength.toFixed(0) + '/100' },
          { label: 'Avg Fwd Rtn', value: (result.avgForwardReturn >= 0 ? '+' : '') + result.avgForwardReturn.toFixed(2) + '%', color: returnColor },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-2 text-center" style={{ background: 'var(--surface-raised)' }}>
            <div className="text-sm font-bold tabular-nums" style={{ color: s.color ?? 'var(--ink-2)' }}>{s.value}</div>
            <div className="text-[9px] mt-0.5" style={{ color: 'var(--subtle)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Signal mix */}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-1.5 rounded-xl p-2.5" style={{ background: 'rgba(110,201,138,0.08)', border: '1px solid rgba(110,201,138,0.2)' }}>
          <TrendingUp size={12} style={{ color: 'var(--success)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>{result.bullishCount} BULLISH</span>
        </div>
        <div className="flex-1 flex items-center gap-1.5 rounded-xl p-2.5" style={{ background: 'rgba(240,112,128,0.08)', border: '1px solid rgba(240,112,128,0.2)' }}>
          <TrendingDown size={12} style={{ color: 'var(--danger)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>{result.bearishCount} BEARISH</span>
        </div>
      </div>
    </div>
  )
}

export function BacktestPanel() {
  const [results, setResults] = useState<Record<string, BacktestResult>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candles, setCandles] = useState(500)
  const [ran, setRan] = useState(false)

  async function runBacktests() {
    setLoading(true)
    setError(null)
    const out: Record<string, BacktestResult> = {}
    const errors: string[] = []
    await Promise.allSettled(
      SUPPORTED_TOKENS.map(async token => {
        try {
          const res = await fetch(`/api/signal/backtest?token=${token}&limit=${candles}`)
          if (!res.ok) { errors.push(`${token}: HTTP ${res.status}`); return }
          const data = await res.json() as BacktestResult
          if ('error' in data) { errors.push(`${token}: ${(data as { error: string }).error}`); return }
          out[token] = data
        } catch (e) {
          errors.push(`${token}: ${String(e)}`)
        }
      })
    )
    setResults(out)
    if (errors.length > 0) setError(errors.join(' | '))
    setLoading(false)
    setRan(true)
  }

  const tokens = Object.values(results)
  const avgWinRate = tokens.length > 0 ? tokens.reduce((s, t) => s + t.winRate, 0) / tokens.length : 0
  const totalWindows = tokens.reduce((s, t) => s + t.windowCount, 0)

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">

      {/* Title + Run */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <FlaskConical size={18} style={{ color: 'var(--accent)' }} />
            <h2 className="text-xl font-black" style={{ color: 'var(--ink)' }}>Signal Backtest</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,200,80,0.15)', color: 'var(--gold)', border: '1px solid rgba(255,200,80,0.3)' }}>DEMO v1</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Runs the signal engine over {candles} historical 1h candles — Kraken → CoinGecko fallback.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={candles}
            onChange={e => setCandles(Number(e.target.value))}
            disabled={loading}
            className="rounded-xl px-3 py-2 text-sm"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          >
            {[100, 200, 500].map(n => (
              <option key={n} value={n}>{n} candles</option>
            ))}
          </select>
          <button
            onClick={() => { void runBacktests() }}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-opacity"
            style={{
              background: loading ? 'var(--surface-raised)' : 'var(--accent)',
              color: loading ? 'var(--muted)' : '#fff',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Running…' : ran ? 'Run Again' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {/* Disclaimer — always visible */}
      <div className="rounded-2xl p-4 flex gap-3" style={{ background: 'rgba(240,112,128,0.08)', border: '1px solid rgba(240,112,128,0.25)' }}>
        <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
        <div className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          <span className="font-bold" style={{ color: 'var(--danger)' }}>RETROSPECTIVE IN-SAMPLE BACKTEST ONLY. </span>
          These results use the same candles the signal was trained on (look-ahead bias applies).
          They measure internal consistency of the indicator rules — not future profitability.
          <span className="font-semibold"> Not financial advice. Past results do not guarantee future outcomes.</span>
        </div>
      </div>

      {/* Empty state */}
      {!ran && !loading && (
        <div className="rounded-2xl p-12 text-center flex flex-col items-center gap-4" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
          <FlaskConical size={36} style={{ color: 'var(--subtle)' }} />
          <div>
            <p className="font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>No results yet</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Click "Run Backtest" to fetch live historical data and score each signal.</p>
          </div>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SUPPORTED_TOKENS.map(t => (
            <div key={t} className="rounded-2xl p-5 animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)', height: 280 }} />
          ))}
        </div>
      )}

      {/* Summary bar */}
      {!loading && tokens.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Tokens tested', value: tokens.length.toString() },
            { label: 'Total signals', value: totalWindows.toString() },
            { label: 'Avg win rate', value: Math.round(avgWinRate * 100) + '%', color: avgWinRate >= 0.6 ? 'var(--success)' : avgWinRate >= 0.5 ? 'var(--gold)' : 'var(--danger)' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-4 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-2xl font-black" style={{ color: s.color ?? 'var(--ink)' }}>{s.value}</div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--subtle)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Token cards */}
      {!loading && tokens.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tokens.map(r => <TokenCard key={r.token} result={r} />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl p-4 flex gap-2 text-sm" style={{ background: 'rgba(240,112,128,0.08)', border: '1px solid rgba(240,112,128,0.25)', color: 'var(--danger)' }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Methodology */}
      <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--ink)' }}>How to run this yourself</h3>
        <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--ink-2)' }}>
          <div>
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>1. Start the signal service:</span>
            <pre className="mt-1 rounded-lg p-3 text-xs overflow-x-auto mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-2)' }}>bun run server</pre>
          </div>
          <div>
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>2. Hit the backtest endpoint:</span>
            <pre className="mt-1 rounded-lg p-3 text-xs overflow-x-auto mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-2)' }}>
{`# Summary (default):
curl "http://localhost:3001/signal/backtest?token=BTC&limit=500"

# With full per-trade breakdown:
curl "http://localhost:3001/signal/backtest?token=BTC&limit=500&trades=true"

# All tokens:
for t in BTC ETH SOL ARB MATIC; do
  curl -s "http://localhost:3001/signal/backtest?token=$t&limit=500"
done`}
            </pre>
          </div>
          <div>
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>3. What each metric means:</span>
            <div className="mt-2 flex flex-col gap-1.5">
              {[
                ['Directional accuracy', 'Price moved toward target before being stopped out by a full ATR in the opposite direction'],
                ['Band hit rate', 'Price touched the 1.5×ATR confidence band within 6 forward candles (looser, higher)'],
                ['Strong vs Weak', 'Win rate split at strengthScore=65 — tests whether the strength score predicts outcome'],
                ['Avg forward return', 'Mean % price move in signal direction over the 6-candle evaluation window'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-[11px]" style={{ color: 'var(--ink-2)', minWidth: 140 }}>{k}:</span>
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>4. Verify the signal logic:</span>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>All rules are in <code className="mono px-1 py-0.5 rounded" style={{ background: 'var(--surface-raised)' }}>server/signal.ts</code> · <code className="mono px-1 py-0.5 rounded" style={{ background: 'var(--surface-raised)' }}>computeSignal()</code> function, ~50 lines. Tests: <code className="mono px-1 py-0.5 rounded" style={{ background: 'var(--surface-raised)' }}>bun test server/signal.test.ts</code></p>
          </div>
        </div>
      </div>
    </div>
  )
}
