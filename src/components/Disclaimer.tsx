import { Info } from 'lucide-react'

export function Disclaimer() {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-4 py-3 mb-5 text-xs"
      style={{
        background: 'rgba(172,198,233,0.05)',
        border: '1px solid rgba(172,198,233,0.12)',
        color: 'var(--muted)',
      }}
    >
      <Info size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
      <span>
        <strong style={{ color: 'var(--ink-2)' }}>DEMO v1 — Informational only.</strong>{' '}
        Signals are not financial advice. Past results do not guarantee future outcomes.
        Signal logic uses public exchange data and is auditable in{' '}
        <span className="mono">server/signal.ts</span>.
      </span>
    </div>
  )
}
