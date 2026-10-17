/**
 * Horizontal price ticker strip — shown just below the header.
 * Compact single-line strip, not a card. Fast to scan.
 */
import { useSpotPrices } from '../hooks/useSpotPrices'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { TokenIcon } from './TokenIcon'

function formatPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 })
  return p.toFixed(6)
}

export function MarketTicker() {
  const { prices, isLoading } = useSpotPrices()

  return (
    <div
      className="w-full overflow-x-auto"
      style={{
        background: 'rgba(8,15,26,0.7)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-0 min-w-max">
          {/* Label */}
          <div className="flex items-center gap-1.5 pr-4 mr-2 shrink-0" style={{ borderRight: '1px solid var(--border)' }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: 'var(--success)' }} />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: 'var(--success)' }} />
            </span>
            <span className="text-[10px] font-semibold" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>LIVE</span>
          </div>

          {isLoading && prices.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-2.5" style={{ borderRight: '1px solid var(--border)' }}>
                  <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: 'var(--border)' }} />
                  <div className="w-14 h-3 rounded animate-pulse" style={{ background: 'var(--border)' }} />
                  <div className="w-8 h-2.5 rounded animate-pulse" style={{ background: 'var(--border)' }} />
                </div>
              ))
            : prices.map((p, idx) => {
                const up = p.change24hPct > 0
                const neutral = Math.abs(p.change24hPct) < 0.05
                const changeColor = neutral ? 'var(--subtle)' : up ? 'var(--success)' : 'var(--danger)'
                return (
                  <div
                    key={p.token}
                    className="flex items-center gap-2.5 px-4 py-2.5"
                    style={{ borderRight: idx < prices.length - 1 ? '1px solid var(--border)' : 'none' }}
                  >
                    <TokenIcon token={p.token} size={14} style={{ borderRadius: '50%', flexShrink: 0 }} />
                    <span className="text-xs font-bold" style={{ color: 'var(--ink-2)' }}>{p.token}</span>
                    <span className="display text-xs font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                      ${formatPrice(p.price)}
                    </span>
                    <span className="flex items-center gap-0.5 text-[11px] font-semibold tabular-nums" style={{ color: changeColor }}>
                      {!neutral && (up ? <TrendingUp size={10} /> : <TrendingDown size={10} />)}
                      {up && !neutral ? '+' : ''}{p.change24hPct.toFixed(2)}%
                    </span>
                  </div>
                )
              })}
        </div>
      </div>
    </div>
  )
}
