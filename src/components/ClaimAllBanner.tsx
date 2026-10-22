import { useMemo, useState, useEffect, useRef } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { arc } from 'viem/chains'
import { RotateCcw, Loader2, CheckCircle2, ExternalLink, AlertCircle } from 'lucide-react'
import { useMultipleRequests, useContractInfo, useClaimAllRefunds } from '../hooks/usePredictAgent'
import { formatUsdc } from '../lib/utils'

const ARC_EXPLORER = 'https://explorer.arc.io'

/** Banner that appears when the connected wallet has one or more claimable refunds. */
export function ClaimAllBanner() {
  const { address: connectedAddress } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { nextRequestId } = useContractInfo()
  const count = Number(nextRequestId) - 1  // nextRequestId is the next unused id
  const { requests, isLoading } = useMultipleRequests(count > 0 ? count : 0)
  const { claimAll, isPending, errors, txHashes, progress } = useClaimAllRefunds()

  // Use a real ticking clock — useCountdown(0n) returns epoch 0 which never passes any deadline
  const [nowSecs, setNowSecs] = useState(() => Math.floor(Date.now() / 1000))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    timerRef.current = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 5_000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const eligibleRequests = useMemo(() => {
    if (!connectedAddress || !requests.length) return []
    return requests.filter(r => {
      // buyerRevealDeadline is an OFFSET in seconds, not an absolute timestamp.
      // The absolute refund-eligible time is windowClose + buyerRevealDeadline.
      // claimRefund also accepts COMMITTED (status 1) past the same deadline.
      const absoluteDeadline = Number(r.windowClose) + Number(r.buyerRevealDeadline)
      return (r.status === 0 || r.status === 1) &&
        absoluteDeadline > 0 &&
        nowSecs > absoluteDeadline &&
        r.buyer.toLowerCase() === connectedAddress.toLowerCase()
    })
  }, [requests, connectedAddress, nowSecs])

  // Snapshot the claimable total at the moment the user clicks "Claim All" so the
  // success subtitle stays correct even after eligibleRequests drains to zero.
  const [claimedTotal, setClaimedTotal] = useState<bigint>(0n)
  const liveTotal = eligibleRequests.reduce((sum, r) => sum + r.feePaid, 0n)
  const totalRefundable = txHashes.length > 0 && claimedTotal > 0n ? claimedTotal : liveTotal

  // Nothing to show: not connected, loading, or no eligible refunds and no completed claims
  if (!connectedAddress) return null
  if (isLoading && !requests.length) return null
  if (eligibleRequests.length === 0 && txHashes.length === 0) return null

  const allDone = txHashes.length > 0 && !isPending

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 mb-4"
      style={{
        background: allDone ? 'rgba(141,216,159,0.06)' : 'rgba(240,112,128,0.06)',
        border: `1px solid ${allDone ? 'rgba(141,216,159,0.25)' : 'rgba(240,112,128,0.25)'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {allDone
            ? <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
            : <RotateCcw size={18} style={{ color: 'var(--danger)' }} />
          }
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {allDone
                ? `${txHashes.length} refund${txHashes.length > 1 ? 's' : ''} claimed`
                : `${eligibleRequests.length} refund${eligibleRequests.length > 1 ? 's' : ''} available`
              }
            </p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              {allDone
                ? `$${formatUsdc(totalRefundable)} USDC returned to your wallet.`
                : `The seller did not commit to ${eligibleRequests.length > 1 ? 'these requests' : 'this request'} in time. Claim your full refund of $${formatUsdc(totalRefundable)} USDC in one transaction per request.`
              }
            </p>
          </div>
        </div>

        {/* Progress during batch claim */}
        {isPending && progress && (
          <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--subtle)' }}>
            {progress.done} / {progress.total}
          </span>
        )}
      </div>

      {/* Request IDs row */}
      {!allDone && eligibleRequests.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {eligibleRequests.map(r => (
            <span
              key={r.requestId.toString()}
              className="text-[11px] font-semibold px-2 py-0.5 rounded"
              style={{ background: 'rgba(240,112,128,0.12)', color: 'var(--danger)' }}
            >
              #{r.requestId.toString()} {r.tokenSymbol}
            </span>
          ))}
        </div>
      )}

      {/* Success tx links */}
      {allDone && txHashes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {txHashes.map((h, i) => (
            <a
              key={h}
              href={`${ARC_EXPLORER}/tx/${h}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs underline hover:opacity-70 transition-opacity"
              style={{ color: 'var(--success)' }}
            >
              Tx {i + 1} <ExternalLink size={10} />
            </a>
          ))}
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="flex flex-col gap-1">
          {errors.map((e, i) => (
            <p key={i} className="text-xs flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
              <AlertCircle size={11} /> {e}
            </p>
          ))}
        </div>
      )}

      {/* Claim All button */}
      {!allDone && eligibleRequests.length > 0 && (
        <button
          onClick={() => {
            if (!walletClient) return
            setClaimedTotal(liveTotal)
            void claimAll(
              eligibleRequests.map(r => r.requestId),
              walletClient,
              nowSecs,
            )
          }}
          disabled={isPending || !walletClient}
          className="flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40 min-h-[44px] px-6 w-fit"
          style={{ background: 'var(--danger)', color: '#fff' }}
        >
          {isPending
            ? <><Loader2 size={15} className="animate-spin" /> Claiming {progress?.done ?? 0} of {progress?.total}…</>
            : <><RotateCcw size={15} /> Claim all {eligibleRequests.length > 1 ? `${eligibleRequests.length} refunds` : 'refund'} — ${formatUsdc(totalRefundable)} USDC</>
          }
        </button>
      )}

      {/* No wallet client (wrong chain) */}
      {!walletClient && !allDone && (
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>
          Switch to Arc mainnet (chain {arc.id}) to claim.
        </p>
      )}
    </div>
  )
}
