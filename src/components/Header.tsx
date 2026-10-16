import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { arc } from 'viem/chains'
import { AlertTriangle } from 'lucide-react'

const ARC_CHAIN_ID = arc.id

export function Header() {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID

  return (
    <header className="sticky top-0 z-50 w-full border-b" style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.92)', backdropFilter: 'blur(16px)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            PA
          </div>
          <span className="display font-semibold text-sm tracking-tight" style={{ color: 'var(--ink)' }}>
            PredictAgent
          </span>
          <span
            className="hidden sm:inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)', border: '1px solid rgba(172,198,233,0.2)', letterSpacing: '0.06em' }}
          >
            DEMO
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {wrongChain && (
            <button
              onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
              disabled={isPending}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: 'rgba(232,109,122,0.15)', color: 'var(--danger)', border: '1px solid rgba(232,109,122,0.3)' }}
            >
              <AlertTriangle size={12} />
              {isPending ? 'Switching...' : 'Switch to Arc'}
            </button>
          )}
          <ConnectKitButton />
        </div>
      </div>
    </header>
  )
}
