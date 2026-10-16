/**
 * Displays the current computed signal for a token.
 * Used inside the Buy Signal flow so buyers can see what they're paying for
 * before the window closes (the committed hash is public, the data is hidden
 * until reveal — this preview is a live fresh computation, not the committed signal).
 */
import { useLatestSignal } from '../hooks/useLatestSignal'
import { useSingleSpotPrice } from '../hooks/useSpotPrices'
import { TrendingUp, TrendingDown, Loader2, RefreshCw, AlertCircle } from 'lucide-react'

const STRENGTH_COLOR: Record<string, string> = {
  STRONG: 'var(--success)',
  MODERATE: 'var(--accent)',
  WEAK: 'var(--subtle)',
}

interface IndicatorRowProps {
  label: string
  value: string
  subtext?: string
  bullish?: boolean | null
}

function IndicatorRow({ label, value, subtext, bullish }: IndicatorRowProps) {
  const color = bullish === null || bullish === undefined
    ? 'var(--muted)'
    : bullish ? 'var(--success)' : 'var(--danger)'
  return (
    <div className="flex items-center justify-between gap-2 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</span>
      <div className="text-right">
        <span className="text-xs font-semibold tabular-nums" style={{ color }}>{value}</span>
        {subtext && <span className="ml-1.5 text-[10px]" style={{ color: 'var(--subtle)' }}>{subtext}</span>}
      </div>
    </div>
  )
}

export function SignalPreview({ token }: { token: string }) {
  const { data: signal, isLoading, error, refetch, isFetching } = useLatestSignal(token)
  const { price: spot } = useSingleSpotPrice(token)

  if (isLoading) {
    return (
      <div className="rounded-xl p-4 flex items-center gap-2 text-xs" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
        <Loader2 size={14} className="animate-spin" /> Computing signal for {token}…
      </div>
    )
  }

  if (error || !signal) {
    return (
      <div className="rounded-xl p-4 flex items-center gap-2 text-xs" style={{ background: 'rgba(232,109,122,0.07)', border: '1px solid rgba(232,109,122,0.2)', color: 'var(--subtle)' }}>
        <AlertCircle size={14} style={{ color: 'var(--danger)' }} />
        Signal service unavailable — start the backend with <code className="mono mx-1">bun run server</code> to see signal reasoning.
      </div>
    )
  }

  const r = signal.reasoning
  const isBull = signal.direction === 'BULLISH'
  const dirColor = isBull ? 'var(--success)' : 'var(--danger)'
  const strengthColor = STRENGTH_COLOR[signal.strengthLabel] ?? 'var(--muted)'

  // Market regime: derived from ATR (volatility) + BB bandwidth + 24h change
  const isHighVol = r.atrPct > 3 || r.bbBandwidth > 0.06
  const isTrending = Math.abs(r.change24hPct) > 2 && r.ema20AboveEma50 === isBull
  const regime = isHighVol ? (isTrending ? 'TRENDING' : 'VOLATILE') : isTrending ? 'TRENDING' : 'RANGING'
  const regimeColor = regime === 'TRENDING' ? 'var(--accent)' : regime === 'VOLATILE' ? 'var(--danger)' : 'var(--subtle)'

  return (
    <div className="rounded-xl flex flex-col gap-0" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div style={{ color: dirColor }}>
            {isBull ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          </div>
          <span className="text-sm font-bold" style={{ color: dirColor }}>{signal.direction}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: strengthColor }}>
            {signal.strengthLabel}
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: regimeColor, border: `1px solid ${regimeColor}33` }}>
            {regime}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
            Score: <span style={{ color: strengthColor }}>{signal.strengthScore}/100</span>
          </span>
          <button
            onClick={() => { void refetch() }}
            disabled={isFetching}
            className="p-1 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ color: 'var(--subtle)' }}
            title="Refresh signal"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-2 text-xs" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
        {r.summary}
      </div>

      {/* Indicator breakdown */}
      <div className="px-4 py-1">
        <IndicatorRow
          label="RSI (14)"
          value={r.rsi.toFixed(1)}
          subtext={r.rsi < 30 ? 'oversold' : r.rsi > 70 ? 'overbought' : 'neutral'}
          bullish={r.rsi < 30 ? isBull : r.rsi > 70 ? !isBull : null}
        />
        <IndicatorRow
          label="EMA 20 / 50"
          value={r.ema20AboveEma50 ? '20 above 50' : '20 below 50'}
          bullish={isBull ? r.ema20AboveEma50 : !r.ema20AboveEma50}
        />
        <IndicatorRow
          label="MACD histogram"
          value={r.macdHistogram >= 0 ? `+${r.macdHistogram.toFixed(2)}` : r.macdHistogram.toFixed(2)}
          bullish={isBull ? r.macdHistogram > 0 : r.macdHistogram < 0}
        />
        <IndicatorRow
          label="Bollinger position"
          value={`${(r.bbPosition * 100).toFixed(0)}% of band`}
          subtext={r.bbPosition < 0.2 ? 'near lower' : r.bbPosition > 0.8 ? 'near upper' : ''}
          bullish={isBull ? r.bbPosition < 0.3 : r.bbPosition > 0.7}
        />
        <IndicatorRow
          label="Volume ratio"
          value={`${r.volumeRatio.toFixed(2)}×`}
          subtext={r.volumeRatio > 1.5 ? 'high' : r.volumeRatio < 0.8 ? 'low' : 'normal'}
          bullish={r.volumeRatio > 1.2}
        />
        <IndicatorRow
          label="24h change"
          value={`${r.change24hPct >= 0 ? '+' : ''}${r.change24hPct.toFixed(2)}%`}
          bullish={isBull ? r.change24hPct > 0 : r.change24hPct < 0}
        />
        <IndicatorRow
          label="ATR (volatility)"
          value={`${r.atrPct.toFixed(2)}%`}
          subtext="of price"
          bullish={null}
        />
      </div>

      {/* Target */}
      <div className="px-4 py-3 flex items-center justify-between gap-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>TARGET PRICE</p>
          <p className="display text-base font-semibold tabular-nums" style={{ color: dirColor }}>${signal.targetPriceUsd}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold mb-0.5 text-right" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>CONFIDENCE ±</p>
          <p className="display text-base font-semibold tabular-nums text-right" style={{ color: 'var(--ink-2)' }}>{signal.confidenceBandPct}</p>
        </div>
        {spot && (
          <div>
            <p className="text-[10px] font-semibold mb-0.5 text-right" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>CURRENT</p>
            <p className="display text-base font-semibold tabular-nums text-right" style={{ color: 'var(--ink)' }}>${spot.price >= 1000 ? spot.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : spot.price.toFixed(4)}</p>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-2 rounded-b-xl border-t" style={{ borderColor: 'var(--border)', background: 'rgba(0,0,0,0.12)' }}>
        <p className="text-[10px]" style={{ color: 'var(--subtle)' }}>
          DEMO v1 — Signal reasoning is shown pre-purchase for transparency. The actual committed signal is locked on-chain before the window opens and revealed after it closes, preventing manipulation.
        </p>
      </div>
    </div>
  )
}
