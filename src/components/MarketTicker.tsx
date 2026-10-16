/**
 * Live market price ticker — shown above the feed.
 * Pulls from the signal service /api/prices endpoint.
 */
import { useSpotPrices } from '../hooks/useSpotPrices'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 })
  return p.toFixed(6)
}

function formatVol(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toFixed(0)}`
}

export function MarketTicker() {
  const { prices, isLoading } = useSpotPrices()

  if (isLoading && prices.length === 0) {
    return (
      <div className="rounded-xl px-4 py-3 flex items-center gap-2 text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
        <span className="animate-pulse">Loading live prices…</span>
      </div>
    )
  }

  if (prices.length === 0) return null

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[10px] font-semibold tracking-widest" style={{ color: 'var(--subtle)' }}>LIVE MARKET PRICES</span>
        <span className="text-[10px]" style={{ color: 'var(--subtle)' }}>via Binance · updates every 60s</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
        {prices.map(p => {
          const up = p.change24hPct >= 0
          const neutral = Math.abs(p.change24hPct) < 0.05
          const color = neutral ? 'var(--muted)' : up ? 'var(--success)' : 'var(--danger)'
          return (
            <div key={p.token} className="px-4 py-3 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold" style={{ color: 'var(--ink-2)' }}>{p.token}</span>
                <div className="flex items-center gap-0.5 text-[11px] font-semibold" style={{ color }}>
                  {neutral ? <Minus size={11} /> : up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {up && !neutral ? '+' : ''}{p.change24hPct.toFixed(2)}%
                </div>
              </div>
              <span className="display text-base font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                ${formatPrice(p.price)}
              </span>
              {p.volume24h > 0 && (
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--subtle)' }}>
                  Vol {formatVol(p.volume24h)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
