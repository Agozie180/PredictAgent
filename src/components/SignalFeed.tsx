import { useState, useMemo } from 'react'
import { useContractInfo, useSellerReputation, useMultipleRequests, type SignalRequest } from '../hooks/usePredictAgent'
import { formatUsdc, formatAddress, STATUS_LABELS, STATUS_COLORS, STATUS_BG, formatTimestamp, directionLabel, SUPPORTED_TOKENS } from '../lib/utils'
import { SignalPreview } from './SignalPreview'
import { ExternalLink, TrendingUp, TrendingDown, Loader2, Activity } from 'lucide-react'

function StatusBadge({ status }: { status: number }) {
  return (
    <span
      className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${STATUS_BG[status] ?? ''} ${STATUS_COLORS[status] ?? ''}`}
      style={{ letterSpacing: '0.06em' }}
    >
      {STATUS_LABELS[status] ?? 'UNKNOWN'}
    </span>
  )
}

function RequestRow({ req }: { req: SignalRequest }) {
  const ts = Number(req.windowOpen) * 1000
  const te = Number(req.windowClose) * 1000
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [])
  const isOpen = now >= ts && now < te
  const isClosed = now >= te
  const dirLabel = req.revealedDirection !== '0x0000000000000000000000000000000000000000000000000000000000000000'
    ? directionLabel(req.revealedDirection)
    : null

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-all hover:border-opacity-40"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="display text-base font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
            #{req.requestId.toString()}
          </span>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded"
            style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}
          >
            {req.tokenSymbol}
          </span>
          {isOpen && (
            <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--success)', letterSpacing: '0.04em' }}>
              <Activity size={10} />
              LIVE
            </span>
          )}
        </div>
        <StatusBadge status={req.status} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs" style={{ color: 'var(--subtle)' }}>
        <div>
          <p className="mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em', fontSize: 10 }}>WINDOW OPEN</p>
          <p className="tabular-nums" style={{ color: 'var(--muted)' }}>{formatTimestamp(req.windowOpen)}</p>
        </div>
        <div>
          <p className="mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em', fontSize: 10 }}>WINDOW CLOSE</p>
          <p className="tabular-nums" style={{ color: 'var(--muted)' }}>
            {isClosed ? <span style={{ color: 'var(--subtle)' }}>Closed</span> : formatTimestamp(req.windowClose)}
          </p>
        </div>
        <div>
          <p className="mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em', fontSize: 10 }}>FEE PAID</p>
          <p className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>
            ${formatUsdc(req.feePaid)} USDC
          </p>
        </div>
        <div>
          <p className="mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em', fontSize: 10 }}>BUYER</p>
          <p className="mono tabular-nums" style={{ color: 'var(--muted)' }}>
            {formatAddress(req.buyer)}
          </p>
        </div>
      </div>

      {/* Revealed signal */}
      {req.status >= 2 && dirLabel && (
        <div
          className="rounded-lg p-3 flex items-center gap-3"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <div className={`shrink-0 ${dirLabel === 'BULLISH' ? 'text-green-400' : 'text-red-400'}`}>
            {dirLabel === 'BULLISH' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div>
              <p style={{ color: 'var(--subtle)', letterSpacing: '0.05em', fontSize: 10 }}>DIRECTION</p>
              <p className="font-semibold" style={{ color: dirLabel === 'BULLISH' ? 'var(--success)' : 'var(--danger)' }}>{dirLabel}</p>
            </div>
            <div>
              <p style={{ color: 'var(--subtle)', letterSpacing: '0.05em', fontSize: 10 }}>TARGET PRICE</p>
              <p className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>
                ${formatUsdc(req.revealedTargetPrice)}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--subtle)', letterSpacing: '0.05em', fontSize: 10 }}>CONFIDENCE ±</p>
              <p className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>
                {(Number(req.revealedConfidenceBandBps) / 100).toFixed(2)}%
              </p>
            </div>
          </div>
          {req.outcomeRecorded && (
            <div
              className="shrink-0 text-[11px] font-bold px-2 py-1 rounded"
              style={{
                background: req.outcomeCorrect ? 'rgba(141,216,159,0.15)' : 'rgba(232,109,122,0.15)',
                color: req.outcomeCorrect ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {req.outcomeCorrect ? 'CORRECT' : 'INCORRECT'}
            </div>
          )}
        </div>
      )}

      {/* Commit hash */}
      {req.commitHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
        <div className="text-xs flex items-center gap-2" style={{ color: 'var(--subtle)' }}>
          <span style={{ letterSpacing: '0.04em', fontSize: 10 }}>COMMIT HASH</span>
          <span className="mono" style={{ color: 'var(--muted)' }}>{req.commitHash.slice(0, 18)}…</span>
        </div>
      )}
    </div>
  )
}

export function SignalFeed({ onBuySignal }: { onBuySignal: () => void }) {
  const [previewToken, setPreviewToken] = useState<string>('BTC')
  const { isLoading: infoLoading, signalFeeUsdc, sellerAddr, nextRequestId, paused } = useContractInfo()
  const { settled, refunded, isLoading: repLoading } = useSellerReputation(sellerAddr)
  const requestCount = Number(nextRequestId) - 1
  const { requests, isLoading: reqsLoading } = useMultipleRequests(Math.min(requestCount, 20))
  // Win rate = settled / requestCount (all requests ever made, not just resolved ones)
  // refundedCount[sellerAddr] is always 0 — refunds go to buyers, not the seller.
  // Use requestCount as denominator so the number reflects actual delivery rate.
  const accuracy = requestCount > 0 ? Math.round((Number(settled) / requestCount) * 100) : null

  if (infoLoading) {
    return (
      <div className="flex flex-col gap-6">
        {/* Stat skeletons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="h-2 w-16 rounded mb-3 animate-pulse" style={{ background: 'var(--border)' }} />
              <div className="h-7 w-12 rounded animate-pulse" style={{ background: 'var(--surface-strong)' }} />
            </div>
          ))}
        </div>
        {/* Card skeletons */}
        {[0,1,2].map(i => (
          <div key={i} className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between">
              <div className="h-4 w-24 rounded animate-pulse" style={{ background: 'var(--surface-strong)' }} />
              <div className="h-4 w-16 rounded animate-pulse" style={{ background: 'var(--border)' }} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[0,1,2,3].map(j => (
                <div key={j} className="h-8 rounded animate-pulse" style={{ background: 'var(--surface-muted)' }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'SIGNAL FEE', value: `$${formatUsdc(signalFeeUsdc)} USDC`, accent: true },
          { label: 'TOTAL REQUESTS', value: requestCount.toString(), accent: false },
          { label: 'SETTLED', value: settled.toString(), accent: false },
          { label: 'WIN RATE', value: accuracy !== null ? `${accuracy}%` : '—', accent: accuracy !== null && accuracy >= 60 },
        ].map(stat => (
          <div
            key={stat.label}
            className="rounded-xl p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
              {stat.label}
            </p>
            <p
              className="display text-xl font-semibold tabular-nums"
              style={{ color: stat.accent ? 'var(--accent)' : 'var(--ink)' }}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Seller reputation */}
      {sellerAddr && !repLoading && (
        <div
          className="rounded-xl p-4 flex items-center gap-4 flex-wrap"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
              SELLER AGENT
            </p>
            <p className="mono text-sm" style={{ color: 'var(--ink-2)' }}>{formatAddress(sellerAddr)}</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div>
              <p style={{ color: 'var(--subtle)', letterSpacing: '0.06em', fontSize: 10 }}>SETTLED</p>
              <p className="tabular-nums font-semibold" style={{ color: 'var(--success)' }}>{settled.toString()}</p>
            </div>
            <div>
              <p style={{ color: 'var(--subtle)', letterSpacing: '0.06em', fontSize: 10 }}>REFUNDED</p>
              <p className="tabular-nums font-semibold" style={{ color: 'var(--danger)' }}>{refunded.toString()}</p>
            </div>
          </div>
          <a
            href={`https://explorer.arc.io/address/${sellerAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent)' }}
          >
            Explorer <ExternalLink size={12} />
          </a>
        </div>
      )}

      {/* Pause banner */}
      {paused && (
        <div
          className="rounded-xl px-4 py-3 text-sm font-semibold"
          style={{ background: 'rgba(232,109,122,0.12)', border: '1px solid rgba(232,109,122,0.3)', color: 'var(--danger)' }}
        >
          Marketplace is currently paused — new requests are not being accepted.
        </div>
      )}

      {/* Buy signal CTA */}
      {!paused && (
        <button
          onClick={onBuySignal}
          className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.99]"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          Buy a Signal — ${formatUsdc(signalFeeUsdc)} USDC
        </button>
      )}

      {/* Signal preview panel */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="display text-sm font-semibold" style={{ color: 'var(--ink-2)', letterSpacing: '-0.01em' }}>
            Current Signal Preview
          </h2>
          <div className="flex gap-1">
            {SUPPORTED_TOKENS.map(t => (
              <button
                key={t}
                onClick={() => setPreviewToken(t)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: previewToken === t ? 'var(--accent)' : 'var(--surface)',
                  color: previewToken === t ? '#0d1b2f' : 'var(--muted)',
                  border: `1px solid ${previewToken === t ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <SignalPreview token={previewToken} />
      </div>

      {/* Request feed */}
      <div>
        <h2 className="display text-sm font-semibold mb-3" style={{ color: 'var(--ink-2)', letterSpacing: '-0.01em' }}>
          Recent Requests
        </h2>
        {reqsLoading && requestCount > 0 && (
          <div className="flex items-center gap-2 text-sm py-4" style={{ color: 'var(--subtle)' }}>
            <Loader2 size={16} className="animate-spin" />
            Loading requests…
          </div>
        )}
        {requestCount === 0 && !reqsLoading && (
          <div
            className="rounded-xl py-10 text-center text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}
          >
            No signal requests yet. Be the first to buy a signal.
          </div>
        )}
        <div className="flex flex-col gap-3">
          {[...requests].reverse().map(req => (
            <RequestRow key={req.requestId.toString()} req={req} />
          ))}
        </div>
      </div>
    </div>
  )
}
