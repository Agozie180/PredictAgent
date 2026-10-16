import { useState, useMemo } from 'react'
import { useRequest } from '../hooks/usePredictAgent'
import { useCountdown } from '../hooks/useCountdown'
import { formatUsdc, formatAddress, formatTimestamp, STATUS_LABELS, STATUS_COLORS, directionLabel } from '../lib/utils'
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, RefreshCw, Clock } from 'lucide-react'

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

export function RequestDetail({ onBack, initialRequestId }: { onBack: () => void; initialRequestId?: string }) {
  const [inputId, setInputId] = useState(initialRequestId ?? '')
  const [lookupId, setLookupId] = useState<bigint | undefined>(
    initialRequestId && parseInt(initialRequestId, 10) > 0 ? BigInt(parseInt(initialRequestId, 10)) : undefined
  )

  const { request, isLoading, refetch } = useRequest(lookupId)

  function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    const n = parseInt(inputId, 10)
    if (n > 0) setLookupId(BigInt(n))
  }

  const dirLabel = request?.revealedDirection && request.revealedDirection !== ZERO_HASH
    ? directionLabel(request.revealedDirection)
    : null

  const { label: openLabel, nowSecs } = useCountdown(request?.windowOpen)
  const { label: closeLabel } = useCountdown(request?.windowClose)
  const windowPhase = useMemo(() => {
    if (!request) return null
    if (nowSecs < Number(request.windowOpen)) return 'before' as const
    if (nowSecs < Number(request.windowClose)) return 'open' as const
    return 'closed' as const
  }, [request, nowSecs])

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--accent)' }}
      >
        <ArrowLeft size={16} /> Back to feed
      </button>

      <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>Request Detail</h2>

        {/* Lookup form */}
        <form onSubmit={handleLookup} className="flex gap-2">
          <input
            type="number"
            min={1}
            value={inputId}
            onChange={e => setInputId(e.target.value)}
            placeholder="Enter request ID…"
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          />
          <button
            type="submit"
            disabled={!inputId}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-all hover:opacity-90"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            Look up
          </button>
        </form>

        {/* Loading */}
        {Boolean(isLoading) && (
          <div className="flex items-center gap-2 text-sm py-4" style={{ color: 'var(--subtle)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading request…
          </div>
        )}

        {/* Result */}
        {request && !isLoading && (
          <div className="flex flex-col gap-4">
            {/* Header row */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="display text-lg font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                  #{request.requestId.toString()}
                </span>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded"
                  style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}
                >
                  {request.tokenSymbol}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${STATUS_COLORS[request.status] ?? ''}`}
                  style={{ letterSpacing: '0.06em', background: 'var(--surface-muted)' }}
                >
                  {STATUS_LABELS[request.status] ?? 'UNKNOWN'}
                </span>
                <button
                  onClick={() => { void refetch() }}
                  className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
                  style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>

            {/* Window phase indicator */}
            {windowPhase && (request.status === 0 || request.status === 1 || request.status === 2) && (
              <div
                className="rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm font-semibold"
                style={{
                  background: windowPhase === 'open'
                    ? 'rgba(141,216,159,0.1)'
                    : windowPhase === 'before'
                      ? 'rgba(172,198,233,0.08)'
                      : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${windowPhase === 'open' ? 'rgba(141,216,159,0.25)' : 'var(--border)'}`,
                  color: windowPhase === 'open' ? 'var(--success)' : 'var(--muted)',
                }}
              >
                <Clock size={14} />
                {windowPhase === 'before' && `Window opens in ${openLabel}`}
                {windowPhase === 'open' && `Window closes in ${closeLabel} — LIVE`}
                {windowPhase === 'closed' && 'Window closed — awaiting reveal'}
              </div>
            )}

            {/* Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {[
                { label: 'BUYER', value: formatAddress(request.buyer), mono: true },
                { label: 'VERIFIER', value: request.verifier !== '0x0000000000000000000000000000000000000000' ? formatAddress(request.verifier) : '(not set)', mono: true },
                { label: 'WINDOW OPEN', value: formatTimestamp(request.windowOpen), mono: false },
                { label: 'WINDOW CLOSE', value: formatTimestamp(request.windowClose), mono: false },
                { label: 'FEE PAID', value: `$${formatUsdc(request.feePaid)} USDC`, mono: false },
              ].map(f => (
                <div key={f.label} className="rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
                    {f.label}
                  </p>
                  <p className={`${f.mono ? 'mono' : ''} tabular-nums`} style={{ color: 'var(--ink-2)' }}>{f.value}</p>
                </div>
              ))}
            </div>

            {/* Commit hash */}
            {request.commitHash !== ZERO_HASH && (
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
                  COMMITMENT HASH
                </p>
                <p className="mono text-xs break-all" style={{ color: 'var(--muted)' }}>{request.commitHash}</p>
              </div>
            )}

            {/* Revealed signal */}
            {dirLabel && request.status >= 2 && (
              <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
                  REVEALED SIGNAL
                </p>
                <div className="flex items-center gap-3">
                  <div className={dirLabel === 'BULLISH' ? 'text-green-400' : 'text-red-400'}>
                    {dirLabel === 'BULLISH' ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
                  </div>
                  <span
                    className="display text-xl font-bold"
                    style={{ color: dirLabel === 'BULLISH' ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {dirLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>TARGET PRICE</p>
                    <p className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>${formatUsdc(request.revealedTargetPrice)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>CONFIDENCE ±</p>
                    <p className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>
                      {(Number(request.revealedConfidenceBandBps) / 100).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--subtle)', letterSpacing: '0.06em' }}>SIGNAL TIME</p>
                    <p className="tabular-nums" style={{ color: 'var(--muted)' }}>{formatTimestamp(request.revealedTimestamp)}</p>
                  </div>
                </div>

                {/* Outcome */}
                {request.outcomeRecorded && (
                  <div
                    className="rounded-lg px-4 py-3 text-sm font-semibold text-center"
                    style={{
                      background: request.outcomeCorrect ? 'rgba(141,216,159,0.1)' : 'rgba(232,109,122,0.1)',
                      color: request.outcomeCorrect ? 'var(--success)' : 'var(--danger)',
                      border: `1px solid ${request.outcomeCorrect ? 'rgba(141,216,159,0.25)' : 'rgba(232,109,122,0.25)'}`,
                    }}
                  >
                    Outcome: <strong>{request.outcomeCorrect ? 'Signal was CORRECT' : 'Signal was INCORRECT'}</strong>
                    {' — '}
                    {request.status === 3 ? 'Seller was paid.' : 'Buyer was refunded.'}
                  </div>
                )}
              </div>
            )}

            {/* Settlement tx link — shown when settled/refunded */}
            {(request.status === 3 || request.status === 4) && (
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                Settlement recorded on-chain.{' '}
                <a
                  href={`https://explorer.arc.io/address/${request.buyer}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-opacity hover:opacity-70"
                  style={{ color: 'var(--accent)' }}
                >
                  View buyer on explorer →
                </a>
              </p>
            )}
          </div>
        )}

        {/* No result */}
        {lookupId !== undefined && !isLoading && request?.requestId === undefined && (
          <p className="text-sm py-4 text-center" style={{ color: 'var(--subtle)' }}>
            No request found for ID #{lookupId.toString()}. Make sure the contract is deployed and the ID exists.
          </p>
        )}
      </div>
    </div>
  )
}
