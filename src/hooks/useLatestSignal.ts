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

export interface LatestSignal {
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

async function fetchLatestSignal(token: string): Promise<LatestSignal> {
  const res = await fetch(apiUrl(`/api/signal/latest?token=${token}`))
  if (!res.ok) throw new Error(`Signal fetch failed: ${res.status}`)
  return (await res.json()) as LatestSignal
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
