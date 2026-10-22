import { useState, useRef, useEffect } from 'react'
import { useContractInfo, useSellerReputation, useMultipleRequests, type SignalRequest } from '../hooks/usePredictAgent'
import { formatUsdc, formatAddress, STATUS_LABELS, STATUS_COLORS, STATUS_BG, formatTimestamp, directionLabel, SUPPORTED_TOKENS } from '../lib/utils'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { arc } from 'viem/chains'
import { PREDICT_AGENT_ADDRESS } from '../lib/predictAgentAbi'
import { SignalPreview } from './SignalPreview'
import { ExternalLink, TrendingUp, TrendingDown, Activity, ChevronRight, Zap, Award } from 'lucide-react'
import { TokenIcon } from './TokenIcon'

/** Returns whether the window is currently open, stable from first render. */
function useIsOpen(tsOpen: number, tsClose: number): boolean {
  const [now, setNow] = useState(0)
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; setNow(Date.now()) }
  }, [])
  return now > 0 && now >= tsOpen && now < tsClose
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3 animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex justify-between">
        <div className="flex gap-2 items-center">
          <div className="w-8 h-8 rounded-lg" style={{ background: 'var(--surface-strong)' }} />
          <div className="w-16 h-4 rounded" style={{ background: 'var(--surface-strong)' }} />
        </div>
        <div className="w-20 h-5 rounded-lg" style={{ background: 'var(--surface-strong)' }} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0,1,2].map(i => <div key={i} className="h-10 rounded-xl" style={{ background: 'var(--surface-muted)' }} />)}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <p className="text-[10px] font-semibold" style={{ color: 'var(--subtle)', letterSpacing: '0.09em' }}>{label}</p>
      <p className="display text-2xl font-bold tabular-nums" style={{ color: accent ? 'var(--accent)' : 'var(--ink)', letterSpacing: '-0.04em' }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--subtle)' }}>{sub}</p>}
    </div>
  )
}

function StatusPip({ status }: { status: number }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BG[status] ?? ''} ${STATUS_COLORS[status] ?? ''}`}
      style={{ letterSpacing: '0.06em' }}
    >
      {STATUS_LABELS[status] ?? 'UNKNOWN'}
    </span>
  )
}

function RequestCard({ req, onViewRequest }: { req: SignalRequest; onViewRequest?: (id: string) => void }) {
  const ts = Number(req.windowOpen) * 1000
  const te = Number(req.windowClose) * 1000
  const isOpen = useIsOpen(ts, te)
  const dirLabel = req.revealedDirection !== '0x0000000000000000000000000000000000000000000000000000000000000000'
    ? directionLabel(req.revealedDirection)
    : null
  const isBull = dirLabel === 'BULLISH'

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4 transition-all hover:border-opacity-60"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: onViewRequest ? 'pointer' : 'default' }}
      onClick={() => onViewRequest?.(req.requestId.toString())}
      role={onViewRequest ? 'button' : undefined}
    >
      {/* Row 1 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <TokenIcon token={req.tokenSymbol} size={22} style={{ borderRadius: 6 }} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="display text-base font-bold" style={{ color: 'var(--ink)' }}>{req.tokenSymbol}</span>
              <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>#{req.requestId.toString()}</span>
              {isOpen && (
                <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--success)', letterSpacing: '0.05em' }}>
                  <Activity size={9} /> LIVE
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
              {formatTimestamp(req.windowOpen)} → {formatTimestamp(req.windowClose)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>${formatUsdc(req.feePaid)}</span>
          <StatusPip status={req.status} />
        </div>
      </div>

      {/* Revealed signal */}
      {req.status >= 2 && dirLabel && (
        <div
          className="rounded-xl px-4 py-3 flex items-center gap-4"
          style={{
            background: isBull ? 'var(--success-dim)' : 'var(--danger-dim)',
            border: `1px solid ${isBull ? 'rgba(110,201,138,0.2)' : 'rgba(240,112,128,0.2)'}`,
          }}
        >
          <div style={{ color: isBull ? 'var(--success)' : 'var(--danger)' }}>
            {isBull ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          </div>
          <div className="flex-1 grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>DIRECTION</p>
              <p className="font-bold" style={{ color: isBull ? 'var(--success)' : 'var(--danger)' }}>{dirLabel}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>TARGET</p>
              <p className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>${formatUsdc(req.revealedTargetPrice)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>CONFIDENCE ±</p>
              <p className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>{(Number(req.revealedConfidenceBandBps) / 100).toFixed(2)}%</p>
            </div>
          </div>
          {req.outcomeRecorded && (
            <div
              className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0"
              style={{
                background: req.outcomeCorrect ? 'var(--success-dim)' : 'var(--danger-dim)',
                color: req.outcomeCorrect ? 'var(--success)' : 'var(--danger)',
                border: `1px solid ${req.outcomeCorrect ? 'rgba(110,201,138,0.3)' : 'rgba(240,112,128,0.3)'}`,
              }}
            >
              {req.outcomeCorrect ? 'WIN' : 'MISS'}
            </div>
          )}
        </div>
      )}

      {/* Commit hash preview */}
      {req.commitHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--subtle)' }}>
          <span style={{ letterSpacing: '0.05em', fontSize: 10 }}>COMMIT</span>
          <span className="mono" style={{ color: 'var(--muted)' }}>{req.commitHash.slice(0, 20)}…</span>
        </div>
      )}

      {/* Track link */}
      {onViewRequest && (
        <div
          className="flex items-center justify-end gap-1 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
          onClick={e => { e.stopPropagation(); onViewRequest(req.requestId.toString()) }}
        >
          Track request <ChevronRight size={12} />
        </div>
      )}
    </div>
  )
}

export function SignalFeed({ onBuySignal, onViewRequest }: { onBuySignal: () => void; onViewRequest?: (id: string) => void }) {
  const [previewToken, setPreviewToken] = useState<string>('BTC')
  const { isLoading: infoLoading, signalFeeUsdc, sellerAddr, nextRequestId, paused } = useContractInfo()
  const { settled, refunded, isLoading: repLoading } = useSellerReputation(sellerAddr)
  const requestCount = Number(nextRequestId) - 1
  const { requests, isLoading: reqsLoading } = useMultipleRequests(Math.min(requestCount, 20))
  const accuracy = requestCount > 0 ? Math.round((Number(settled) / requestCount) * 100) : null

  if (infoLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="rounded-2xl p-5 animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="h-2.5 w-16 rounded mb-3" style={{ background: 'var(--border)' }} />
              <div className="h-8 w-20 rounded" style={{ background: 'var(--surface-strong)' }} />
            </div>
          ))}
        </div>
        {[0,1,2].map(i => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Stats ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="SIGNAL FEE" value={`$${formatUsdc(signalFeeUsdc)}`} sub="per request · USDC" accent />
        <StatCard label="TOTAL REQUESTS" value={requestCount.toString()} sub="on-chain" />
        <StatCard label="SETTLED" value={settled.toString()} sub="paid out" />
        <StatCard
          label="WIN RATE"
          value={accuracy !== null ? `${accuracy}%` : '—'}
          sub={accuracy !== null ? 'delivery rate' : 'no data yet'}
          accent={accuracy !== null && accuracy >= 60}
        />
      </div>

      {/* ── Seller agent ───────────────────────────────────────────── */}
      {sellerAddr && !repLoading && (
        <div
          className="rounded-2xl px-5 py-4 flex items-center gap-4 flex-wrap"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--accent-dim)' }}
          >
            <Award size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>SELLER AGENT</p>
            <p className="mono text-sm" style={{ color: 'var(--ink-2)' }}>{formatAddress(sellerAddr)}</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="text-center">
              <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>SETTLED</p>
              <p className="tabular-nums font-bold" style={{ color: 'var(--success)' }}>{settled.toString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>REFUNDED</p>
              <p className="tabular-nums font-bold" style={{ color: 'var(--danger)' }}>{refunded.toString()}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <a
              href={buildAddressExplorerUrl(arc.id, sellerAddr)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent)' }}
            >
              Seller <ExternalLink size={11} />
            </a>
            {PREDICT_AGENT_ADDRESS && (
              <a
                href={buildAddressExplorerUrl(arc.id, PREDICT_AGENT_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--subtle)' }}
              >
                Contract <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Pause ──────────────────────────────────────────────────── */}
      {paused && (
        <div
          className="rounded-xl px-4 py-3 text-sm font-semibold"
          style={{ background: 'var(--danger-dim)', border: '1px solid rgba(240,112,128,0.25)', color: 'var(--danger)' }}
        >
          Marketplace paused — new requests are not being accepted.
        </div>
      )}

      {/* ── Buy CTA ────────────────────────────────────────────────── */}
      {!paused && (
        <button
          onClick={onBuySignal}
          className="w-full py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99]"
          style={{ background: 'var(--accent)', color: '#080f1a', letterSpacing: '0.01em' }}
        >
          <Zap size={15} />
          Buy a Signal — ${formatUsdc(signalFeeUsdc)} USDC
          <ChevronRight size={15} />
        </button>
      )}

      {/* ── Signal preview ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="display text-sm font-semibold" style={{ color: 'var(--ink-2)', letterSpacing: '-0.01em' }}>
            Current Signal Preview
          </h2>
          <div className="flex gap-1">
            {SUPPORTED_TOKENS.map(t => {
              const active = previewToken === t
              return (
                <button
                  key={t}
                  onClick={() => setPreviewToken(t)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--subtle)',
                    border: `1px solid ${active ? 'rgba(172,198,233,0.3)' : 'transparent'}`,
                  }}
                >
                  <TokenIcon token={t} size={12} />
                  {t}
                </button>
              )
            })}
          </div>
        </div>
        <SignalPreview token={previewToken} />
      </div>

      {/* ── Request feed ───────────────────────────────────────────── */}
      <div>
        <h2 className="display text-sm font-semibold mb-3" style={{ color: 'var(--ink-2)', letterSpacing: '-0.01em' }}>
          Recent Requests
        </h2>

        {reqsLoading && requestCount > 0 && (
          <div className="flex flex-col gap-3">
            {[0,1,2].map(i => <SkeletonCard key={i} />)}
          </div>
        )}

        {requestCount === 0 && !reqsLoading && (
          <div
            className="rounded-2xl py-16 text-center flex flex-col items-center gap-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-dim)' }}>
              <BarChart2Icon />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>No signals bought yet</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>Be the first to buy a signal and start the feed.</p>
            <button
              onClick={onBuySignal}
              className="mt-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
              style={{ height: 44, background: 'var(--accent)', color: '#080f1a' }}
            >
              Buy first signal
            </button>
            {PREDICT_AGENT_ADDRESS && (
              <a
                href={buildAddressExplorerUrl(arc.id, PREDICT_AGENT_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--subtle)' }}
              >
                Contract on Arc Explorer <ExternalLink size={10} />
              </a>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {[...requests].reverse().map(req => (
            <RequestCard key={req.requestId.toString()} req={req} onViewRequest={onViewRequest} />
          ))}
        </div>
      </div>
    </div>
  )
}

function BarChart2Icon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
}
