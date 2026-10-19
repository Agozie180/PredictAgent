import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi'
import { erc20Abi, decodeEventLog } from 'viem'
import { arc } from 'viem/chains'
import { PREDICT_AGENT_ABI, PREDICT_AGENT_ADDRESS } from '../lib/predictAgentAbi'
import { useContractInfo } from '../hooks/usePredictAgent'
import { SUPPORTED_TOKENS, formatUsdc, parseOnchainError } from '../lib/utils'
import { buildTxExplorerUrl, getUsdc } from '@/onchain-facts'
import { SignalPreview } from './SignalPreview'
import { TokenIcon } from './TokenIcon'
import { ConnectKitButton } from 'connectkit'
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, Wallet, Zap, ChevronRight, ExternalLink, ShieldCheck } from 'lucide-react'

const ARC_CHAIN_ID = arc.id
const USDC_ADDRESS = getUsdc(ARC_CHAIN_ID)?.address as `0x${string}`

const WINDOW_OPTIONS = [
  { h: 1, label: '1h' },
  { h: 4, label: '4h' },
  { h: 8, label: '8h' },
  { h: 24, label: '24h' },
]

export function BuySignal({ onBack, onViewRequest }: { onBack: () => void; onViewRequest?: (id: string) => void }) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { signalFeeUsdc, paused } = useContractInfo()

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
  const [manualStep, setManualStep] = useState<'idle' | 'approving' | 'requesting'>('idle')
  const isWrongChain = isConnected && chainId !== ARC_CHAIN_ID

  const { writeContract: writeApprove, data: approveHash, isPending: isApprovePending, error: approveError, reset: resetApprove } = useWriteContract()
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })

  const { writeContract: writeRequest, data: requestHash, isPending: isRequestPending, error: requestError, reset: resetRequest } = useWriteContract()
  const { isLoading: isRequestConfirming, isSuccess: isRequestSuccess, data: requestReceipt } = useWaitForTransactionReceipt({ hash: requestHash })

  const txHash = isRequestSuccess ? requestHash : undefined
  const requestId = (() => {
    if (!isRequestSuccess || !requestReceipt) return undefined
    for (const log of requestReceipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: PREDICT_AGENT_ABI, eventName: 'RequestCreated', data: log.data, topics: log.topics })
        return (decoded.args as { requestId?: bigint }).requestId
      } catch { /* not RequestCreated */ }
    }
    return undefined
  })()

  const errorMsg = approveError ? parseOnchainError(approveError) : requestError ? parseOnchainError(requestError) : ''
  const effectiveManualStep = isApproveSuccess && manualStep === 'approving' ? 'requesting' : manualStep
  type DisplayStep = 'select' | 'approve' | 'request' | 'done'
  const step: DisplayStep = isRequestSuccess ? 'done' : effectiveManualStep === 'requesting' ? 'request' : effectiveManualStep === 'approving' ? 'approve' : 'select'

  function buildWindows() {
    const now = Math.floor(Date.now() / 1000)
    const windowOpen = now + 300
    const windowClose = windowOpen + windowDurationHrs * 3600
    return { windowOpen: BigInt(windowOpen), windowClose: BigInt(windowClose) }
  }

  function handleApprove() {
    if (!PREDICT_AGENT_ADDRESS) return
    resetApprove(); setManualStep('approving')
    writeApprove({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [PREDICT_AGENT_ADDRESS, signalFeeUsdc], chainId: ARC_CHAIN_ID })
  }

  function handleRequest() {
    if (!PREDICT_AGENT_ADDRESS) return
    resetRequest()
    const { windowOpen, windowClose } = buildWindows()
    writeRequest({ address: PREDICT_AGENT_ADDRESS, abi: PREDICT_AGENT_ABI, functionName: 'requestSignal', args: [token, windowOpen, windowClose, 0n], chainId: ARC_CHAIN_ID })
  }

  function handleReset() { setManualStep('idle'); resetApprove(); resetRequest() }

  // ── Guard: not connected ───────────────────────────────────────────────
  if (!isConnected) return (
    <div className="flex flex-col gap-4">
      <BackButton onClick={onBack} />
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Header */}
        <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Buy a Signal</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet to pay $1.00 USDC and request a price-movement signal.</p>
        </div>
        <div className="p-6 flex flex-col gap-5">
          {/* Network + fee */}
          <div className="rounded-xl p-4 flex flex-col gap-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--subtle)' }}>Network</span>
              <div className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--gold)' }}>
                <Zap size={12} /> Arc mainnet
              </div>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--subtle)' }}>Signal fee</span>
              <span className="font-bold" style={{ color: 'var(--accent)' }}>$1.00 USDC</span>
            </div>
          </div>
          {/* Steps */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>How it works</p>
            {[
              { n: '1', label: 'Approve USDC', sub: 'Allow the contract to spend $1.00 from your wallet' },
              { n: '2', label: 'Pay & request', sub: 'Submit the signal request — fee is held in escrow' },
              { n: '3', label: 'Seller commits', sub: 'Seller locks in their prediction on-chain before the window opens' },
              { n: '4', label: 'Reveal & settle', sub: 'Signal is verified — correct prediction releases payment, wrong one refunds you' },
            ].map(s => (
              <div key={s.n} className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold mt-0.5"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(172,198,233,0.3)' }}>
                  {s.n}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{s.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{s.sub}</p>
                </div>
              </div>
            ))}
          </div>
          {/* Security note */}
          <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(110,201,138,0.06)', border: '1px solid rgba(110,201,138,0.18)', color: 'var(--success)' }}>
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            If the seller never reveals, you get a full refund — the contract enforces it.
          </div>
          {/* Connect button */}
          <div className="flex justify-center">
            <ConnectKitButton label="Connect Wallet to Continue" />
          </div>
        </div>
      </div>
    </div>
  )

  // ── Guard: wrong chain ─────────────────────────────────────────────────
  if (isWrongChain) return (
    <div className="flex flex-col gap-4">
      <BackButton onClick={onBack} />
      <div className="rounded-2xl p-12 text-center flex flex-col items-center gap-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <AlertCircle size={32} style={{ color: 'var(--danger)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Switch to Arc mainnet to continue</p>
        <button
          onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
          disabled={isSwitching}
          className="px-6 py-3 rounded-xl text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#080f1a' }}
        >
          {isSwitching ? 'Switching…' : 'Switch to Arc'}
        </button>
      </div>
    </div>
  )

  // ── Done ──────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div className="flex flex-col gap-4">
      <BackButton onClick={onBack} label="Back to feed" />
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-6 py-8 flex flex-col items-center gap-5 text-center" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--success-dim)' }}>
            <CheckCircle2 size={32} style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <h2 className="display text-2xl font-bold mb-1.5" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Signal requested</h2>
            <p className="text-sm max-w-xs mx-auto" style={{ color: 'var(--muted)' }}>
              The seller will commit a hash before the window opens, then reveal after it closes.
            </p>
          </div>
          {txHash && (
            <a
              href={buildTxExplorerUrl(ARC_CHAIN_ID, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent)' }}
            >
              View on Arc Explorer <ExternalLink size={11} />
            </a>
          )}
        </div>
        <div className="px-6 py-4 flex flex-col gap-2 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>
          {requestId !== undefined && <Row label="Request ID" value={`#${requestId.toString()}`} />}
          <Row label="Token" value={token} />
          <Row label="Fee paid" value={`$${formatUsdc(signalFeeUsdc)} USDC`} />
          <Row label="Window" value={`${windowDurationHrs}h`} />
        </div>
        <div className="px-6 py-4 flex flex-col gap-2">
          {requestId !== undefined && onViewRequest && (
            <button
              onClick={() => onViewRequest(requestId.toString())}
              className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90"
              style={{ background: 'var(--accent)', color: '#080f1a' }}
            >
              Track Request #{requestId.toString()} <ChevronRight size={14} />
            </button>
          )}
          <button
            onClick={handleReset}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-70"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
          >
            Buy another signal
          </button>
        </div>
      </div>
    </div>
  )

  // ── Flow ──────────────────────────────────────────────────────────────
  const approveInFlight = isApprovePending || isApproveConfirming
  const requestInFlight = isRequestPending || isRequestConfirming

  return (
    <div className="flex flex-col gap-4">
      <BackButton onClick={onBack} />

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Header */}
        <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Buy a Signal</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Pay <span className="font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>${formatUsdc(signalFeeUsdc)} USDC</span> for one price-movement signal.
          </p>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Token */}
          <div>
            <label className="block text-[10px] font-semibold mb-2.5" style={{ color: 'var(--subtle)', letterSpacing: '0.09em' }}>TOKEN</label>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_TOKENS.map(t => {
                const active = token === t
                return (
                  <button
                    key={t}
                    onClick={() => setToken(t)}
                    disabled={step !== 'select'}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                    style={{
                      background: active ? 'var(--accent-dim)' : 'var(--surface-muted)',
                      color: active ? 'var(--accent)' : 'var(--muted)',
                      border: `1px solid ${active ? 'rgba(172,198,233,0.35)' : 'var(--border)'}`,
                    }}
                  >
                    <TokenIcon token={t} size={14} />
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Window duration */}
          <div>
            <label className="block text-[10px] font-semibold mb-2.5" style={{ color: 'var(--subtle)', letterSpacing: '0.09em' }}>SIGNAL WINDOW</label>
            <div className="flex gap-2">
              {WINDOW_OPTIONS.map(({ h, label }) => {
                const active = windowDurationHrs === h
                return (
                  <button
                    key={h}
                    onClick={() => setWindowDurationHrs(h)}
                    disabled={step !== 'select'}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                    style={{
                      background: active ? 'var(--accent-dim)' : 'var(--surface-muted)',
                      color: active ? 'var(--accent)' : 'var(--muted)',
                      border: `1px solid ${active ? 'rgba(172,198,233,0.35)' : 'var(--border)'}`,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Live signal preview */}
          {step === 'select' && <SignalPreview token={token} />}

          {/* Order summary */}
          <div className="rounded-xl p-4 flex flex-col gap-2.5 text-sm" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <Row label="Token" value={token} />
            <Row label="Window" value={`${windowDurationHrs} hour${windowDurationHrs !== 1 ? 's' : ''}`} />
            <Row label="Signal fee" value={`$${formatUsdc(signalFeeUsdc)} USDC`} accent />
            {usdcBalance !== undefined && (
              <div className="flex justify-between items-center pt-2 mt-0.5" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="flex items-center gap-1.5" style={{ color: 'var(--subtle)' }}>
                  <Wallet size={11} /> Your balance
                </span>
                <span className="font-semibold tabular-nums" style={{ color: hasEnoughUsdc ? 'var(--success)' : 'var(--danger)' }}>
                  ${formatUsdc(usdcBalance)} USDC
                </span>
              </div>
            )}
          </div>

          {/* Insufficient balance */}
          {usdcBalance !== undefined && !hasEnoughUsdc && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs" style={{ background: 'var(--danger-dim)', border: '1px solid rgba(240,112,128,0.2)', color: 'var(--danger)' }}>
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              Insufficient USDC. You need ${formatUsdc(signalFeeUsdc)} to continue. Use the "Get test USDC" button in the Arc Studio sidebar.
            </div>
          )}

          {/* Error */}
          {errorMsg && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs" style={{ background: 'var(--danger-dim)', border: '1px solid rgba(240,112,128,0.2)', color: 'var(--danger)' }}>
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Step progress */}
          <div className="flex items-center gap-3">
            <StepDot active={step === 'select' || step === 'approve'} done={isApproveSuccess} n={1} label="Approve" />
            <div className="flex-1 h-px" style={{ background: isApproveSuccess ? 'var(--accent)' : 'var(--border)' }} />
            <StepDot active={step === 'request'} done={isRequestSuccess} n={2} label="Submit" />
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-2.5">
            <button
              onClick={handleApprove}
              disabled={approveInFlight || step !== 'select' || paused || !hasEnoughUsdc}
              className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-35"
              style={{ background: 'var(--accent)', color: '#080f1a' }}
            >
              {approveInFlight
                ? <><Loader2 size={15} className="animate-spin" /> {isApprovePending ? 'Confirm in wallet…' : 'Approving…'}</>
                : isApproveSuccess
                  ? <><CheckCircle2 size={15} /> Approved</>
                  : <><Zap size={15} /> Approve USDC</>
              }
            </button>
            <button
              onClick={handleRequest}
              disabled={requestInFlight || step !== 'request' || paused}
              className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-35"
              style={{
                background: step === 'request' ? 'var(--surface-raised)' : 'var(--surface-muted)',
                border: `1px solid ${step === 'request' ? 'var(--border-strong)' : 'var(--border)'}`,
                color: step === 'request' ? 'var(--ink)' : 'var(--subtle)',
              }}
            >
              {requestInFlight
                ? <><Loader2 size={15} className="animate-spin" /> {isRequestPending ? 'Confirm in wallet…' : 'Submitting…'}</>
                : <>Submit Request <ChevronRight size={14} /></>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70"
      style={{ color: 'var(--muted)' }}
    >
      <ArrowLeft size={14} /> {label}
    </button>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span style={{ color: 'var(--subtle)' }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: accent ? 'var(--accent)' : 'var(--ink-2)' }}>{value}</span>
    </div>
  )
}

function StepDot({ active, done, n, label }: { active: boolean; done: boolean; n: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
        style={{
          background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--surface-strong)',
          color: done || active ? '#080f1a' : 'var(--subtle)',
        }}
      >
        {done ? <CheckCircle2 size={12} /> : n}
      </div>
      <span className="text-[10px] font-semibold" style={{ color: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--subtle)', letterSpacing: '0.05em' }}>
        {label}
      </span>
    </div>
  )
}
