import { useState, useEffect } from 'react'

function fmtDiff(diff: number): string {
  if (diff <= 0) return 'Passed'
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (h > 24) { const d = Math.floor(h / 24); return `${d}d ${h % 24}h` }
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Returns { label, nowSecs } — nowSecs ticks every second. */
export function useCountdown(targetUnixSecs: bigint | number | undefined): { label: string; nowSecs: number } {
  const [nowSecs, setNowSecs] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const id = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  if (targetUnixSecs === undefined) return { label: '', nowSecs }
  const label = fmtDiff(Number(targetUnixSecs) - nowSecs)
  return { label, nowSecs }
}
