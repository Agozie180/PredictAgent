import { useQuery } from '@tanstack/react-query'
import { apiUrl } from '@/api'

export interface SignalReasoning {
  rsi: number
  macdHistogram: number
  ema20: number
  ema50: number
  ema20AboveEma50: boolean
  bbPosition: number
  bbBandwidth: number
  volumeRatio: number
  change24hPct: number
  atrPct: number
  strengthScore: number
  summary: string
}

/** Locked response from /signal/latest — indicator names + price only, no direction */
export interface LockedSignal {
  locked: true
  token: string
  currentPrice: number | null
  currentPriceUsd: string | null
  fee: string
  feeCurrency: string
  contract: string
  chainId: number
  indicators: string[]
  howToUnlock: string
}

/** Full signal — only returned after on-chain payment confirmed */
export interface FullSignal {
  locked: false
  token: string
  direction: 'BULLISH' | 'BEARISH'
  strengthScore: number
  strengthLabel: 'STRONG' | 'MODERATE' | 'WEAK'
  reasoning: SignalReasoning
  targetPriceUsd: string
  confidenceBandPct: string
  signalTimestamp: number
  requestId: string | null
}

export type LatestSignal = LockedSignal | FullSignal

async function fetchLatestSignal(token: string): Promise<LatestSignal> {
  const res = await fetch(apiUrl(`/api/signal/latest?token=${token}`))
  if (!res.ok) throw new Error(`Signal fetch failed: ${res.status}`)
  const data = await res.json() as Record<string, unknown>
  // Backend always returns locked:true now; if it ever returns full signal mark locked:false
  if (data['locked'] === false && 'direction' in data) {
    return { locked: false, ...data } as FullSignal
  }
  return { locked: true, ...data } as LockedSignal
}

export function useLatestSignal(token: string) {
  return useQuery({
    queryKey: ['latest-signal', token],
    queryFn: () => fetchLatestSignal(token),
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
    enabled: Boolean(token),
  })
}
