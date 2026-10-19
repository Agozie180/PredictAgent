import { Info, Copy } from 'lucide-react'
import { useState } from 'react'

const DEPLOY_CMD = `forge create contracts/PredictAgent.sol:PredictAgent \\
  --rpc-url https://rpc.arc.io \\
  --private-key $DEPLOYER_PRIVATE_KEY \\
  --constructor-args \\
    $SELLER_ADDRESS \\
    100000 \\
    $OWNER_ADDRESS`

const ENV_CMD = `printf 'VITE_CONTRACT_ADDRESS=0xYOUR_DEPLOYED\\n' >> .env`

export function ContractNotDeployed() {
  const [copied, setCopied] = useState<'deploy' | 'env' | null>(null)

  function copy(text: string, key: 'deploy' | 'env') {
    void navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div
      className="rounded-2xl p-8 flex flex-col items-center gap-5 text-center"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(172,198,233,0.12)' }}
      >
        <Info size={24} style={{ color: 'var(--accent)' }} />
      </div>

      <div>
        <h2 className="display text-lg font-semibold mb-1" style={{ color: 'var(--ink)' }}>
          Contract not yet deployed
        </h2>
        <p className="text-sm max-w-sm mx-auto" style={{ color: 'var(--muted)' }}>
          Deploy PredictAgent to Arc mainnet, then set{' '}
          <span className="mono text-xs px-1 py-0.5 rounded" style={{ background: 'var(--surface-muted)' }}>
            VITE_CONTRACT_ADDRESS
          </span>{' '}
          in your <span className="mono text-xs">.env</span> and restart the dev server.
        </p>
      </div>

      {/* Step 1: Deploy */}
      <div className="w-full max-w-lg text-left">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
            STEP 1 — Deploy the contract
          </p>
          <button
            onClick={() => copy(DEPLOY_CMD, 'deploy')}
            className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent)' }}
          >
            <Copy size={11} />
            {copied === 'deploy' ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre
          className="mono text-xs rounded-xl px-4 py-3 overflow-x-auto text-left leading-relaxed"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          {DEPLOY_CMD}
        </pre>
        <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
          Set <span className="mono">$SELLER_ADDRESS</span> to your signal service wallet,{' '}
          <span className="mono">$OWNER_ADDRESS</span> to your deployer.{' '}
          <span className="mono">100000</span> = $0.10 USDC fee (6 decimals).
        </p>
      </div>

      {/* Step 2: Wire address */}
      <div className="w-full max-w-lg text-left">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
            STEP 2 — Wire the address into the app
          </p>
          <button
            onClick={() => copy(ENV_CMD, 'env')}
            className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent)' }}
          >
            <Copy size={11} />
            {copied === 'env' ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre
          className="mono text-xs rounded-xl px-4 py-3 overflow-x-auto text-left"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          {ENV_CMD}
        </pre>
        <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
          Then restart the dev server — Vite reads <span className="mono">.env</span> only at startup.
        </p>
      </div>

      {/* Step 3: Start signal service */}
      <div className="w-full max-w-lg text-left">
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
          STEP 3 — Start the signal service
        </p>
        <pre
          className="mono text-xs rounded-xl px-4 py-3 text-left"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          bun run server
        </pre>
        <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
          Listens on port 3001. See <span className="mono">server/README.md</span> for the full agent integration guide.
        </p>
      </div>
    </div>
  )
}
