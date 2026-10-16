import { AlertTriangle } from 'lucide-react'

export function Disclaimer() {
  return (
    <div
      className="w-full rounded-xl px-4 py-3 flex items-start gap-3 text-sm"
      style={{
        background: 'rgba(232,109,122,0.08)',
        border: '1px solid rgba(232,109,122,0.2)',
        color: 'var(--muted)',
      }}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
      <p className="leading-relaxed" style={{ color: 'var(--muted)' }}>
        <strong style={{ color: 'var(--ink-2)' }}>Disclaimer:</strong>{' '}
        Signals are for informational purposes only and do not constitute financial advice. Past results do not
        guarantee future outcomes. This is a demo marketplace — signal logic is clearly labelled as a demo
        version and has not been independently validated. Always do your own research before making financial
        decisions.
      </p>
    </div>
  )
}
