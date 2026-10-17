import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { arc } from 'viem/chains'
import { AlertTriangle } from 'lucide-react'

const ARC_CHAIN_ID = arc.id

// Wordmark SVG — clean geometric mark, no placeholder text
function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="PredictAgent">
      <rect width="28" height="28" rx="7" fill="var(--accent)" fillOpacity="0.15" />
      <rect width="28" height="28" rx="7" stroke="var(--accent)" strokeOpacity="0.3" strokeWidth="1" fill="none"/>
      {/* P shape */}
      <path d="M8 7h5.5a3.5 3.5 0 0 1 0 7H8V7Z" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
      <path d="M8 14v7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
      {/* Upward arrow */}
      <path d="M18 20l2-4 2 4M18.5 18.5h3" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function Header() {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: 'rgba(8,15,26,0.85)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <LogoMark />
          <div className="flex flex-col leading-none">
            <span className="display font-semibold text-[15px]" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              PredictAgent
            </span>
            <span className="text-[9px] font-medium" style={{ color: 'var(--subtle)', letterSpacing: '0.05em' }}>
              SIGNAL MARKETPLACE · ARC
            </span>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {wrongChain && (
            <button
              onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
              disabled={isPending}
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 active:scale-95"
              style={{
                background: 'var(--danger-dim)',
                color: 'var(--danger)',
                border: '1px solid rgba(240,112,128,0.25)',
              }}
            >
              <AlertTriangle size={11} />
              {isPending ? 'Switching…' : 'Switch to Arc'}
            </button>
          )}
          <ConnectKitButton />
        </div>
      </div>
    </header>
  )
}
