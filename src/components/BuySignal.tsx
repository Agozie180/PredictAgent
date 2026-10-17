import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi'
import { erc20Abi, decodeEventLog } from 'viem'
import { arc } from 'viem/chains'
import { PREDICT_AGENT_ABI, PREDICT_AGENT_ADDRESS } from '../lib/predictAgentAbi'
import { useContractInfo } from '../hooks/usePredictAgent'
import { SUPPORTED_TOKENS, formatUsdc, parseOnchainError } from '../lib/utils'
import { buildTxExplorerUrl, getUsdc } from '@/onchain-facts'
import { SignalPreview } from './SignalPreview'
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, Wallet } from 'lucide-react'

const ARC_CHAIN_ID = arc.id
const USDC_ADDRESS = getUsdc(ARC_CHAIN_ID)?.address as `0x${string}`

export function BuySignal({ onBack, onViewRequest }: { onBack: () => void; onViewRequest?: (id: string) => void }) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { signalFeeUsdc, paused } = useContractInfo()

  // Live USDC balance for the connected wallet
  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address && isConnected },
  })
  const hasEnoughUsdc = usdcBalance !== undefined && usdcBalance >= signalFeeUsdc

  const [token, setToken] = useState<string>('BTC')
  const [windowDurationHrs, setWindowDurationHrs] = useState(4)
  // manualStep drives step when wagmi success flags don't drive it
  const [manualStep, setManualStep] = useState<'idle' | 'approving' | 'requesting'>('idle')

  const isWrongChain = isConnected && chainId !== ARC_CHAIN_ID

  // ── Approve USDC ─────────────────────────────────────────────────────
  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: isApprovePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract()

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } =
    useWaitForTransactionReceipt({ hash: approveHash })

  // ── Request signal ────────────────────────────────────────────────────
  const {
    writeContract: writeRequest,
    data: requestHash,
    isPending: isRequestPending,
    error: requestError,
    reset: resetRequest,
  } = useWriteContract()

  const { isLoading: isRequestConfirming, isSuccess: isRequestSuccess, data: requestReceipt } =
    useWaitForTransactionReceipt({ hash: requestHash })

  // Derive txHash and requestId from receipt using decodeEventLog.
  // We scan all logs and find the one that decodes as RequestCreated —
  // USDC Transfer events come first in the receipt so logs[0] is wrong.
  const txHash = isRequestSuccess ? requestHash : undefined
  const requestId = (() => {
    if (!isRequestSuccess || !requestReceipt) return undefined
    for (const log of requestReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: PREDICT_AGENT_ABI,
          eventName: 'RequestCreated',
          data: log.data,
          topics: log.topics,
        })
        return (decoded.args as { requestId?: bigint }).requestId
      } catch {
        // not RequestCreated — try next log
      }
    }
    return undefined
  })()

  // ── Derived error ─────────────────────────────────────────────────────
  const errorMsg = approveError
    ? parseOnchainError(approveError)
    : requestError
      ? parseOnchainError(requestError)
      : ''

  // ── Derived step ──────────────────────────────────────────────────────
  // isApproveSuccess drives advancement to 'request' without an effect
  const effectiveManualStep = isApproveSuccess && manualStep === 'approving' ? 'requesting' : manualStep
  type DisplayStep = 'select' | 'approve' | 'request' | 'done'
  const step: DisplayStep = isRequestSuccess
    ? 'done'
    : effectiveManualStep === 'requesting'
      ? 'request'
      : effectiveManualStep === 'approving'
        ? 'approve'
        : 'select'

  // ── Helpers ───────────────────────────────────────────────────────────
  function buildWindows() {
    const now = Math.floor(Date.now() / 1000)
    const windowOpen = now + 300
    const windowClose = windowOpen + windowDurationHrs * 3600
    return { windowOpen: BigInt(windowOpen), windowClose: BigInt(windowClose) }
  }

  function handleApprove() {
    if (!PREDICT_AGENT_ADDRESS) return
    resetApprove()
    setManualStep('approving')
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [PREDICT_AGENT_ADDRESS, signalFeeUsdc],
      chainId: ARC_CHAIN_ID,
    })
  }

  function handleRequest() {
    if (!PREDICT_AGENT_ADDRESS) return
    resetRequest()
    const { windowOpen, windowClose } = buildWindows()
    writeRequest({
      address: PREDICT_AGENT_ADDRESS,
      abi: PREDICT_AGENT_ABI,
      functionName: 'requestSignal',
      args: [token, windowOpen, windowClose, 0n], // 0n = use global default revealDeadlineOffset
      chainId: ARC_CHAIN_ID,
    })
  }

  function handleReset() {
    setManualStep('idle')
    resetApprove()
    resetRequest()
  }

  // ── Guards ────────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="flex items-center gap-2 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p style={{ color: 'var(--muted)' }}>Connect your wallet to buy a signal.</p>
        </div>
      </div>
    )
  }

  if (isWrongChain) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="flex items-center gap-2 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="rounded-2xl p-8 text-center flex flex-col items-center gap-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <AlertCircle size={32} style={{ color: 'var(--danger)' }} />
          <p style={{ color: 'var(--muted)' }}>Switch to Arc mainnet to continue.</p>
          <button
            onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
            disabled={isSwitching}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {isSwitching ? 'Switching…' : 'Switch to Arc'}
          </button>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="flex items-center gap-2 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={16} /> Back to feed
        </button>
        <div className="rounded-2xl p-8 flex flex-col items-center gap-5 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(141,216,159,0.1)' }}>
            <CheckCircle2 size={32} style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <h2 className="display text-xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>Signal requested!</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              The seller agent will commit a signal hash before the window opens, then reveal after it closes.
            </p>
          </div>
          <div className="w-full rounded-xl p-4 text-left flex flex-col gap-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            {requestId !== undefined && (
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--subtle)' }}>Request ID</span>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>#{requestId.toString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--subtle)' }}>Token</span>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>{token}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--subtle)' }}>Fee paid</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>${formatUsdc(signalFeeUsdc)} USDC</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--subtle)' }}>Window</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{windowDurationHrs}h</span>
            </div>
          </div>
          {txHash && (
            <a
              href={buildTxExplorerUrl(ARC_CHAIN_ID, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent)' }}
            >
              View transaction on explorer →
            </a>
          )}
          <div className="flex flex-col gap-2 w-full">
            {requestId !== undefined && onViewRequest && (
              <button
                onClick={() => onViewRequest(requestId.toString())}
                className="w-full py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
                style={{ background: 'var(--accent)', color: '#0d1b2f' }}
              >
                Track Request #{requestId.toString()} →
              </button>
            )}
            <button
              onClick={handleReset}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
            >
              Buy another signal
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Selection + flow ──────────────────────────────────────────────────
  const approveInFlight = isApprovePending || isApproveConfirming
  const requestInFlight = isRequestPending || isRequestConfirming

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-2 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--accent)' }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="rounded-2xl p-6 flex flex-col gap-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div>
          <h2 className="display text-lg font-semibold mb-0.5" style={{ color: 'var(--ink)' }}>Buy a Signal</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Pay <span className="font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>${formatUsdc(signalFeeUsdc)} USDC</span> for one price-movement signal.
          </p>
        </div>

        {/* Token select */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
            TOKEN
          </label>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_TOKENS.map(t => (
              <button
                key={t}
                onClick={() => setToken(t)}
                disabled={step !== 'select'}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: token === t ? 'var(--accent)' : 'var(--surface-muted)',
                  color: token === t ? '#0d1b2f' : 'var(--muted)',
                  border: `1px solid ${token === t ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Window duration */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
            SIGNAL WINDOW
          </label>
          <div className="flex flex-wrap gap-2">
            {[1, 4, 8, 24].map(h => (
              <button
                key={h}
                onClick={() => setWindowDurationHrs(h)}
                disabled={step !== 'select'}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: windowDurationHrs === h ? 'var(--accent)' : 'var(--surface-muted)',
                  color: windowDurationHrs === h ? '#0d1b2f' : 'var(--muted)',
                  border: `1px solid ${windowDurationHrs === h ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        {/* Live signal preview */}
        {step === 'select' && <SignalPreview token={token} />}

        {/* Order summary */}
        <div className="rounded-xl p-4 flex flex-col gap-2 text-sm" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between">
            <span style={{ color: 'var(--subtle)' }}>Token</span>
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>{token}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--subtle)' }}>Window duration</span>
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>{windowDurationHrs} hour{windowDurationHrs !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--subtle)' }}>Signal fee</span>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>${formatUsdc(signalFeeUsdc)} USDC</span>
          </div>
          {usdcBalance !== undefined && (
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1" style={{ color: 'var(--subtle)' }}>
                <Wallet size={12} />
                Your balance
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ color: hasEnoughUsdc ? 'var(--success)' : 'var(--danger)' }}
              >
                ${formatUsdc(usdcBalance)} USDC
              </span>
            </div>
          )}
          <div className="pt-2 mt-1 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Step 1 of 2: Approve USDC spend, then step 2: submit request on-chain.
            </p>
          </div>
        </div>

        {/* Insufficient balance warning */}
        {usdcBalance !== undefined && !hasEnoughUsdc && (
          <div className="rounded-xl px-4 py-3 flex items-start gap-2 text-sm" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)', color: 'var(--danger)' }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            Insufficient USDC balance. You need ${formatUsdc(signalFeeUsdc)} USDC to buy a signal. Use the "Get test USDC" button in the Arc Studio sidebar to fund your wallet.
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="rounded-xl px-4 py-3 flex items-start gap-2 text-sm" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)', color: 'var(--danger)' }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {errorMsg}
          </div>
        )}

        {/* CTA buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleApprove}
            disabled={approveInFlight || step !== 'select' || paused || !hasEnoughUsdc}
            className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {approveInFlight ? (
              <><Loader2 size={16} className="animate-spin" /> {isApprovePending ? 'Confirm in wallet…' : 'Approving USDC…'}</>
            ) : isApproveSuccess ? (
              <><CheckCircle2 size={16} /> Approved</>
            ) : '1. Approve USDC'}
          </button>

          <button
            onClick={handleRequest}
            disabled={requestInFlight || step !== 'request' || paused}
            className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
            style={{
              background: step === 'request' ? 'var(--surface-strong)' : 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: step === 'request' ? 'var(--ink)' : 'var(--subtle)',
            }}
          >
            {requestInFlight ? (
              <><Loader2 size={16} className="animate-spin" /> {isRequestPending ? 'Confirm in wallet…' : 'Submitting…'}</>
            ) : '2. Submit Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
