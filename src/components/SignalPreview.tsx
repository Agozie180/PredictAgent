import { useLatestSignal } from '../hooks/useLatestSignal'
import { useSingleSpotPrice } from '../hooks/useSpotPrices'
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Zap } from 'lucide-react'

const STRENGTH_LABEL_COLOR: Record<string, string> = {
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
  const dotColor = bullish === null || bullish === undefined
    ? 'var(--subtle)'
    : bullish ? 'var(--success)' : 'var(--danger)'
  const valColor = bullish === null || bullish === undefined
    ? 'var(--muted)'
    : bullish ? 'var(--success)' : 'var(--danger)'
  return (
    <div className="flex items-center justify-between gap-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <span className="w-1 h-1 rounded-full shrink-0" style={{ background: dotColor }} />
        <span className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</span>
      </div>
      <div className="text-right">
        <span className="text-xs font-semibold tabular-nums" style={{ color: valColor }}>{value}</span>
        {subtext && <span className="ml-1.5 text-[10px]" style={{ color: 'var(--subtle)' }}>{subtext}</span>}
      </div>
    </div>
  )
}

function formatPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1) return p.toFixed(4)
  return p.toFixed(6)
}

export function SignalPreview({ token }: { token: string }) {
  const { data: signal, isLoading, error, refetch, isFetching } = useLatestSignal(token)
  const { price: spot } = useSingleSpotPrice(token)

  if (isLoading) {
    return (
      <div className="rounded-2xl p-5 flex flex-col gap-3 animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex justify-between">
          <div className="h-7 w-28 rounded-lg" style={{ background: 'var(--surface-strong)' }} />
          <div className="h-5 w-16 rounded-lg" style={{ background: 'var(--surface-strong)' }} />
        </div>
        <div className="h-3 w-full rounded" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-3 w-3/4 rounded" style={{ background: 'var(--surface-muted)' }} />
      </div>
    )
  }

  if (error || !signal) {
    return (
      <div
        className="rounded-2xl p-5 flex items-start gap-3 text-xs"
        style={{ background: 'rgba(240,112,128,0.05)', border: '1px solid rgba(240,112,128,0.15)' }}
      >
        <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
        <span style={{ color: 'var(--muted)' }}>
          Signal service offline — start the backend with <code className="mono mx-1 px-1 rounded" style={{ background: 'var(--surface-strong)' }}>bun run server</code> to see signal reasoning.
        </span>
      </div>
    )
  }

  const r = signal.reasoning
  const isBull = signal.direction === 'BULLISH'
  const dirColor = isBull ? 'var(--success)' : 'var(--danger)'
  const dirDim = isBull ? 'var(--success-dim)' : 'var(--danger-dim)'
  const strengthColor = STRENGTH_LABEL_COLOR[signal.strengthLabel] ?? 'var(--muted)'

  const isHighVol = r.atrPct > 3 || r.bbBandwidth > 0.06
  const isTrending = Math.abs(r.change24hPct) > 2 && r.ema20AboveEma50 === isBull
  const regime = isHighVol ? (isTrending ? 'TRENDING' : 'VOLATILE') : isTrending ? 'TRENDING' : 'RANGING'
  const regimeColor = regime === 'TRENDING' ? 'var(--accent)' : regime === 'VOLATILE' ? 'var(--danger)' : 'var(--subtle)'

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {/* ── Hero direction ─────────────────────────────────────────── */}
      <div
        className="px-5 py-4 flex items-center justify-between gap-4"
        style={{ background: dirDim, borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: isBull ? 'rgba(110,201,138,0.15)' : 'rgba(240,112,128,0.15)' }}
          >
            {isBull ? <TrendingUp size={20} style={{ color: dirColor }} /> : <TrendingDown size={20} style={{ color: dirColor }} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="display text-xl font-bold" style={{ color: dirColor, letterSpacing: '-0.04em' }}>
                {signal.direction}
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.07)', color: strengthColor, border: `1px solid ${strengthColor}33` }}
              >
                {signal.strengthLabel}
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.04)', color: regimeColor, border: `1px solid ${regimeColor}33` }}
              >
                {regime}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{r.summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-semibold" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>SCORE</p>
            <p className="display text-lg font-bold tabular-nums" style={{ color: strengthColor }}>
              {signal.strengthScore}<span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>/100</span>
            </p>
          </div>
          <button
            onClick={() => { void refetch() }}
            disabled={isFetching}
            className="p-2 rounded-xl transition-all hover:opacity-70 disabled:opacity-30"
            style={{ background: 'var(--surface-raised)' }}
            title="Refresh signal"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} style={{ color: 'var(--muted)' }} />
          </button>
        </div>
      </div>

      {/* ── Target / current ───────────────────────────────────────── */}
      <div className="px-5 py-3 grid grid-cols-3 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>TARGET</p>
          <p className="display text-base font-bold tabular-nums" style={{ color: dirColor }}>${signal.targetPriceUsd}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>BAND ±</p>
          <p className="display text-base font-bold tabular-nums" style={{ color: 'var(--ink-2)' }}>{signal.confidenceBandPct}</p>
        </div>
        {spot && (
          <div>
            <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>CURRENT</p>
            <p className="display text-base font-bold tabular-nums" style={{ color: 'var(--ink)' }}>${formatPrice(spot.price)}</p>
          </div>
        )}
      </div>

      {/* ── Indicators ─────────────────────────────────────────────── */}
      <div className="px-5 py-2">
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
          subtext={r.volumeRatio > 1.5 ? 'elevated' : r.volumeRatio < 0.8 ? 'low' : 'normal'}
          bullish={r.volumeRatio > 1.2}
        />
        <IndicatorRow
          label="24h change"
          value={`${r.change24hPct >= 0 ? '+' : ''}${r.change24hPct.toFixed(2)}%`}
          bullish={isBull ? r.change24hPct > 0 : r.change24hPct < 0}
        />
        <IndicatorRow label="ATR (volatility)" value={`${r.atrPct.toFixed(2)}%`} subtext="of price" bullish={null} />
      </div>

      {/* ── Footer disclaimer ──────────────────────────────────────── */}
      <div className="px-5 py-3 flex items-start gap-2" style={{ background: 'var(--surface-muted)' }}>
        <Zap size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--gold)' }} />
        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--subtle)' }}>
          DEMO v1 — Reasoning shown pre-purchase for transparency. Committed signal is locked on-chain before the window opens, preventing manipulation.
        </p>
      </div>
    </div>
  )
}
