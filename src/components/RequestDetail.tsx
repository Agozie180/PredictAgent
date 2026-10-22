import { useState, useMemo } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { useRequest, useClaimRefund } from '../hooks/usePredictAgent'
import { useCountdown } from '../hooks/useCountdown'
import { formatUsdc, formatAddress, formatTimestamp, STATUS_LABELS, STATUS_COLORS, directionLabel } from '../lib/utils'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { keccak256, encodePacked } from 'viem'
import { arc } from 'viem/chains'
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, RefreshCw, Clock, ExternalLink, ShieldCheck, AlertCircle, RotateCcw, CheckCircle2 } from 'lucide-react'

const ARC_EXPLORER = 'https://explorer.arc.io'
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

function explorerAddr(addr: string) { return `${ARC_EXPLORER}/address/${addr}` }
function explorerTx(hash: string) { return `${ARC_EXPLORER}/tx/${hash}` }

/** Recompute commit hash client-side — same encoding as the contract */
function recomputeHash(
  requestId: bigint,
  direction: `0x${string}`,
  targetPrice: bigint,
  confidenceBandBps: bigint,
  signalTimestamp: bigint,
  nonce: bigint,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ['uint256', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256'],
      [requestId, direction, targetPrice, confidenceBandBps, signalTimestamp, nonce],
    ),
  )
}

export function RequestDetail({ onBack, initialRequestId }: { onBack: () => void; initialRequestId?: string }) {
  const [inputId, setInputId] = useState(initialRequestId ?? '')
  const [inputError, setInputError] = useState<string | null>(null)
  const [lookupId, setLookupId] = useState<bigint | undefined>(
    initialRequestId && /^\d+$/.test(initialRequestId) && parseInt(initialRequestId, 10) > 0
      ? BigInt(parseInt(initialRequestId, 10))
      : undefined
  )
  const [verifyResult, setVerifyResult] = useState<'match' | 'mismatch' | null>(null)

  const { address: connectedAddress } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { claimRefund, isPending: claimPending, error: claimError, txHash: claimTx } = useClaimRefund()

  const { request, isLoading, refetch } = useRequest(lookupId)

  function handleInputChange(val: string) {
    if (val !== '' && !/^\d+$/.test(val)) {
      setInputError('Request ID must be a number')
      return
    }
    setInputError(null)
    setInputId(val)
  }

  function handleLookup(e?: React.FormEvent) {
    e?.preventDefault()
    if (!inputId) return
    if (!/^\d+$/.test(inputId)) { setInputError('Request ID must be a number'); return }
    const n = parseInt(inputId, 10)
    if (n <= 0) { setInputError('Request ID must be a positive number'); return }
    setInputError(null)
    setVerifyResult(null)
    setLookupId(BigInt(n))
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

  /**
   * Refund eligibility:
   *   status === 0 (PENDING — seller never committed)
   *   AND now > buyerRevealDeadline (= windowClose + revealDeadlineOffset)
   *   AND connected wallet is the buyer
   */
  const isBuyer = !!connectedAddress && !!request &&
    connectedAddress.toLowerCase() === request.buyer.toLowerCase()

  // buyerRevealDeadline stores the OFFSET in seconds (not an absolute timestamp).
  // The actual absolute deadline is windowClose + buyerRevealDeadline.
  // claimRefund also allows claims on COMMITTED status past this deadline.
  const absoluteRevealDeadline = request
    ? Number(request.windowClose) + Number(request.buyerRevealDeadline)
    : 0
  const refundEligible = !!request &&
    (request.status === 0 || request.status === 1) &&
    nowSecs > absoluteRevealDeadline &&
    absoluteRevealDeadline > 0

  async function handleClaimRefund() {
    if (!request || !walletClient) return
    await claimRefund(request.requestId, walletClient)
    // Refetch after a short delay so the status badge updates
    setTimeout(() => { void refetch() }, 3000)
  }

  /** Verify: recompute hash from revealed data and compare to stored commitHash */
  function handleVerify() {
    if (!request || !dirLabel || request.revealedNonce === 0n) return
    const computed = recomputeHash(
      request.requestId,
      request.revealedDirection,
      request.revealedTargetPrice,
      request.revealedConfidenceBandBps,
      request.revealedTimestamp,
      request.revealedNonce,
    )
    setVerifyResult(computed.toLowerCase() === request.commitHash.toLowerCase() ? 'match' : 'mismatch')
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm transition-opacity hover:opacity-70 min-h-[44px] w-fit"
        style={{ color: 'var(--accent)' }}
      >
        <ArrowLeft size={16} /> Back to feed
      </button>

      <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>Track Request</h2>

        {/* Lookup form */}
        <form onSubmit={handleLookup} className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputId}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLookup() } }}
              placeholder="Enter request ID (e.g. 1)…"
              className="flex-1 rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{
                height: 44,
                background: 'var(--surface-muted)',
                border: `1px solid ${inputError ? 'rgba(240,112,128,0.5)' : 'var(--border)'}`,
                color: 'var(--ink)',
              }}
            />
            <button
              type="button"
              onClick={() => handleLookup()}
              disabled={!inputId || !!inputError}
              className="px-4 rounded-xl text-sm font-semibold disabled:opacity-40 transition-all hover:opacity-90 shrink-0"
              style={{ height: 44, background: 'var(--accent)', color: '#0d1b2f' }}
            >
              Look up
            </button>
          </div>
          {inputError && (
            <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
              <AlertCircle size={11} /> {inputError}
            </p>
          )}
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
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}>
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
                  className="p-1.5 rounded-lg transition-opacity hover:opacity-70 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>

            {/* Window phase */}
            {windowPhase && (request.status === 0 || request.status === 1 || request.status === 2) && (
              <div
                className="rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm font-semibold"
                style={{
                  background: windowPhase === 'open' ? 'rgba(141,216,159,0.1)' : windowPhase === 'before' ? 'rgba(172,198,233,0.08)' : 'rgba(255,255,255,0.04)',
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

            {/* ── CLAIM REFUND SECTION ─────────────────────────────────────── */}
            {refundEligible && (
              <div
                className="rounded-xl p-4 flex flex-col gap-3"
                style={{
                  background: 'rgba(240,112,128,0.06)',
                  border: '1px solid rgba(240,112,128,0.25)',
                }}
              >
                <div className="flex items-start gap-3">
                  <RotateCcw size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Refund available</p>
                    <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                      The seller did not commit before the reveal deadline. You are entitled to a full refund of{' '}
                      <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>${formatUsdc(request.feePaid)} USDC</span>.
                    </p>
                  </div>
                </div>

                {/* Claim tx success */}
                {claimTx && (
                  <div
                    className="rounded-xl px-4 py-3 flex items-center gap-2 text-xs font-semibold"
                    style={{ background: 'rgba(141,216,159,0.08)', border: '1px solid rgba(141,216,159,0.25)', color: 'var(--success)' }}
                  >
                    <CheckCircle2 size={13} />
                    Refund claimed!{' '}
                    <a
                      href={explorerTx(claimTx)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:opacity-70 flex items-center gap-1"
                    >
                      View tx <ExternalLink size={10} />
                    </a>
                  </div>
                )}

                {/* Claim error */}
                {claimError && !claimTx && (
                  <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
                    <AlertCircle size={11} /> {claimError}
                  </p>
                )}

                {/* Connect wallet prompt if not connected */}
                {!connectedAddress && (
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                    Connect your wallet to claim this refund.
                  </p>
                )}

                {/* Wrong wallet warning */}
                {connectedAddress && !isBuyer && (
                  <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--subtle)' }}>
                    <AlertCircle size={11} />
                    Connect the buyer wallet ({formatAddress(request.buyer)}) to claim.
                  </p>
                )}

                {/* Claim button — only shown when connected as buyer and no tx yet */}
                {isBuyer && !claimTx && (
                  <button
                    onClick={() => { void handleClaimRefund() }}
                    disabled={claimPending || !walletClient}
                    className="flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40 min-h-[44px] px-5 w-fit"
                    style={{ background: 'var(--danger)', color: '#fff' }}
                  >
                    {claimPending
                      ? <><Loader2 size={15} className="animate-spin" /> Claiming…</>
                      : <><RotateCcw size={15} /> Claim ${formatUsdc(request.feePaid)} USDC refund</>
                    }
                  </button>
                )}
              </div>
            )}
            {/* ── END CLAIM REFUND ─────────────────────────────────────────── */}

            {/* Fields grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {[
                {
                  label: 'BUYER',
                  value: formatAddress(request.buyer),
                  mono: true,
                  href: explorerAddr(request.buyer),
                },
                {
                  label: 'VERIFIER',
                  value: request.verifier !== '0x0000000000000000000000000000000000000000'
                    ? formatAddress(request.verifier)
                    : '(not set)',
                  mono: true,
                  href: request.verifier !== '0x0000000000000000000000000000000000000000' ? explorerAddr(request.verifier) : undefined,
                },
                { label: 'WINDOW OPEN',  value: formatTimestamp(request.windowOpen),  mono: false },
                { label: 'WINDOW CLOSE', value: formatTimestamp(request.windowClose), mono: false },
                { label: 'FEE PAID',     value: `$${formatUsdc(request.feePaid)} USDC`, mono: false },
                {
                  label: 'REFUND ELIGIBLE AFTER',
                  value: absoluteRevealDeadline > 0
                    ? formatTimestamp(BigInt(absoluteRevealDeadline))
                    : '—',
                  mono: false,
                },
              ].map(f => (
                <div key={f.label} className="rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>{f.label}</p>
                  {f.href ? (
                    <a
                      href={f.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--accent)' }}
                    >
                      <span className={`${f.mono ? 'mono' : ''} tabular-nums text-sm`}>{f.value}</span>
                      <ExternalLink size={10} />
                    </a>
                  ) : (
                    <p className={`${f.mono ? 'mono' : ''} tabular-nums`} style={{ color: 'var(--ink-2)' }}>{f.value}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Commit hash */}
            {request.commitHash !== ZERO_HASH && (
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>COMMITMENT HASH</p>
                <p className="mono text-xs break-all" style={{ color: 'var(--muted)' }}>{request.commitHash}</p>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--subtle)' }}>
                  This hash was submitted on-chain before the window opened, locking the signal direction in advance.
                </p>
              </div>
            )}

            {/* Revealed signal */}
            {dirLabel && request.status >= 2 && (
              <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>REVEALED SIGNAL</p>
                <div className="flex items-center gap-3">
                  <div style={{ color: dirLabel === 'BULLISH' ? 'var(--success)' : 'var(--danger)' }}>
                    {dirLabel === 'BULLISH' ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
                  </div>
                  <span className="display text-xl font-bold" style={{ color: dirLabel === 'BULLISH' ? 'var(--success)' : 'var(--danger)' }}>
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

                {/* Verify button — recomputes hash client-side from revealed data */}
                {request.revealedNonce !== 0n && request.commitHash !== ZERO_HASH && (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleVerify}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all hover:opacity-80 min-h-[44px] w-fit"
                      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}
                    >
                      <ShieldCheck size={13} style={{ color: 'var(--accent)' }} />
                      Verify commitment hash
                    </button>
                    {verifyResult && (
                      <div
                        className="rounded-xl px-4 py-3 flex items-start gap-2 text-xs"
                        style={{
                          background: verifyResult === 'match' ? 'rgba(110,201,138,0.08)' : 'rgba(240,112,128,0.08)',
                          border: `1px solid ${verifyResult === 'match' ? 'rgba(110,201,138,0.25)' : 'rgba(240,112,128,0.25)'}`,
                          color: verifyResult === 'match' ? 'var(--success)' : 'var(--danger)',
                        }}
                      >
                        <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                        {verifyResult === 'match'
                          ? 'Hash verified — the revealed signal matches the on-chain commitment exactly. The seller did not change the signal after committing.'
                          : 'Hash mismatch — the revealed data does not match the on-chain commitment. This should not happen on a valid reveal.'}
                      </div>
                    )}
                  </div>
                )}

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
                    Outcome: <strong>{request.outcomeCorrect ? 'Signal was CORRECT — seller was paid.' : 'Signal was INCORRECT — buyer was refunded.'}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Settlement explorer links */}
            {(request.status === 3 || request.status === 4) && (
              <div className="flex flex-wrap gap-3 text-xs">
                <a
                  href={explorerAddr(request.buyer)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-70 min-h-[44px]"
                  style={{ color: 'var(--accent)' }}
                >
                  View buyer on explorer <ExternalLink size={10} />
                </a>
                <a
                  href={buildAddressExplorerUrl(arc.id, '0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-70 min-h-[44px]"
                  style={{ color: 'var(--accent)' }}
                >
                  View contract on explorer <ExternalLink size={10} />
                </a>
              </div>
            )}
          </div>
        )}

        {/* No result */}
        {lookupId !== undefined && !isLoading && request?.requestId === undefined && (
          <div className="py-8 text-center flex flex-col items-center gap-3">
            <p className="text-sm" style={{ color: 'var(--subtle)' }}>
              No request found for ID #{lookupId.toString()}.
            </p>
            <a
              href={buildAddressExplorerUrl(arc.id, '0xf4DcF358ecea1B66Fe3d61bBb1C17b23F109C65f')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent)' }}
            >
              View contract on Arc Explorer <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
