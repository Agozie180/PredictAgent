import { useReadContract, useReadContracts } from 'wagmi'
import { arc } from 'viem/chains'
import { PREDICT_AGENT_ABI, PREDICT_AGENT_ADDRESS } from '../lib/predictAgentAbi'

const CHAIN_ID = arc.id

export function useContractInfo() {
  const addr = PREDICT_AGENT_ADDRESS
  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'signalFeeUsdc', chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'seller', chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'nextRequestId', chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'paused', chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'revealDeadlineOffset', chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'outcomeDeadlineOffset', chainId: CHAIN_ID },
    ],
    query: { enabled: !!addr, refetchInterval: 15_000 },
  })

  return {
    isLoading,
    signalFeeUsdc: (data?.[0]?.result) ?? 0n,
    sellerAddr: (data?.[1]?.result as string | undefined) ?? '',
    nextRequestId: (data?.[2]?.result) ?? 1n,
    paused: (data?.[3]?.result) ?? false,
    revealDeadlineOffset: (data?.[4]?.result) ?? 3600n,
    outcomeDeadlineOffset: (data?.[5]?.result) ?? 86400n,
  }
}

export function useSellerReputation(sellerAddr: string) {
  const addr = PREDICT_AGENT_ADDRESS
  const { data, isLoading } = useReadContract({
    address: addr,
    abi: PREDICT_AGENT_ABI,
    functionName: 'getReputation',
    args: [sellerAddr as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: !!addr && !!sellerAddr, refetchInterval: 15_000 },
  })

  return {
    isLoading,
    settled: (data as [bigint, bigint] | undefined)?.[0] ?? 0n,
    refunded: (data as [bigint, bigint] | undefined)?.[1] ?? 0n,
  }
}

// Field order MUST match Solidity struct exactly — used for named ABI tuple access
export interface SignalRequest {
  requestId: bigint
  buyer: `0x${string}`
  tokenSymbol: string
  windowOpen: bigint
  windowClose: bigint
  commitHash: `0x${string}`
  revealedDirection: `0x${string}`
  revealedTargetPrice: bigint
  revealedConfidenceBandBps: bigint
  revealedTimestamp: bigint
  revealedNonce: bigint
  status: number
  verifier: `0x${string}`
  feePaid: bigint
  outcomeRecorded: boolean
  outcomeCorrect: boolean
}

export function useRequest(requestId: bigint | undefined) {
  const addr = PREDICT_AGENT_ADDRESS
  const { data, isLoading, refetch } = useReadContract({
    address: addr,
    abi: PREDICT_AGENT_ABI,
    functionName: 'getRequest',
    args: [requestId ?? 0n],
    chainId: CHAIN_ID,
    query: { enabled: !!addr && !!requestId && requestId > 0n, refetchInterval: 10_000 },
  })

  // wagmi returns a named tuple — cast to our interface which has identical field order
  const request = data
  // Treat zero requestId as "not found" (Solidity returns zero struct for missing ids)
  const found = request && request.requestId > 0n ? request : undefined
  return { request: found, isLoading, refetch }
}

export function useMultipleRequests(count: number) {
  const addr = PREDICT_AGENT_ADDRESS
  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1))

  const { data, isLoading } = useReadContracts({
    contracts: ids.map(id => ({
      address: addr,
      abi: PREDICT_AGENT_ABI,
      functionName: 'getRequest' as const,
      args: [id] as [bigint],
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!addr && count > 0, refetchInterval: 10_000 },
  })

  const requests: SignalRequest[] = []
  if (data) {
    for (const item of data) {
      if (item.result) {
        requests.push(item.result as SignalRequest)
      }
    }
  }

  return { requests, isLoading }
}
