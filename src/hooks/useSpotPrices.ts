import { useQuery } from '@tanstack/react-query'
import { apiUrl } from '@/api'

export interface SpotPrice {
  token: string
  price: number
  change24hPct: number
  high24h: number
  low24h: number
  volume24h: number
  fetchedAt: number
}

async function fetchSpotPrices(): Promise<SpotPrice[]> {
  const res = await fetch(apiUrl('/api/prices'))
  if (!res.ok) throw new Error(`Prices fetch failed: ${res.status}`)
  const data = (await res.json()) as { prices: SpotPrice[] }
  return data.prices
}

export function useSpotPrices() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['spot-prices'],
    queryFn: fetchSpotPrices,
    refetchInterval: 60_000,
    retry: 2,
  })
  return { prices: data ?? [], isLoading, error }
}

export function useSingleSpotPrice(token: string) {
  const { prices, isLoading } = useSpotPrices()
  const price = prices.find(p => p.token === token)
  return { price, isLoading }
}
