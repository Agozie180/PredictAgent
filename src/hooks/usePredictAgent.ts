import { useState } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { arc } from 'viem/chains'
import type { Chain } from 'viem'
import { PREDICT_AGENT_ABI, PREDICT_AGENT_ADDRESS } from '../lib/predictAgentAbi'

// Full Arc mainnet chain definition for viem writeContract calls.
// Passing only { id } is an incomplete Chain and causes gas estimation failures.
const ARC_CHAIN: Chain = arc

const CHAIN_ID = arc.id

export function useContractInfo() {
  const addr = PREDICT_AGENT_ADDRESS
  const { data, isLoading } = useReadContracts({
    // chainId at the batch level ensures reads always hit Arc mainnet,
    // regardless of which chain the user's wallet is currently on.
    contracts: [
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'signalFeeUsdc',          chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'seller',                  chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'nextRequestId',            chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'paused',                   chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'revealDeadlineOffset',     chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'outcomeDeadlineOffset',    chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'minRevealOffset',          chainId: CHAIN_ID },
      { address: addr, abi: PREDICT_AGENT_ABI, functionName: 'maxRevealOffset',          chainId: CHAIN_ID },
    ],
    query: { enabled: !!addr, refetchInterval: 15_000 },
  })

  // Raw result — undefined while loading, 0n only after a successful read that returned 0
  const rawFee = data?.[0]?.result

  return {
    isLoading,
    // isFeeLoaded: true once we have a real on-chain value (not the loading default)
    isFeeLoaded: !isLoading && rawFee !== undefined,
    signalFeeUsdc:          rawFee                                    ?? 0n,
    sellerAddr:             (data?.[1]?.result as string | undefined) ?? '',
    nextRequestId:          (data?.[2]?.result) ?? 1n,
    paused:                 (data?.[3]?.result) ?? false,
    revealDeadlineOffset:   (data?.[4]?.result) ?? 3600n,
    outcomeDeadlineOffset:  (data?.[5]?.result) ?? 86400n,
    minRevealOffset:        (data?.[6]?.result) ?? 3600n,
    maxRevealOffset:        (data?.[7]?.result) ?? 172800n,
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
  buyerRevealDeadline: bigint
}

export function useRequest(requestId: bigint | undefined) {
  const addr = PREDICT_AGENT_ADDRESS
  const { data, isLoading, refetch } = useReadContract({
    address: addr,
    abi: PREDICT_AGENT_ABI,
    functionName: 'getRequest',
    args: [requestId ?? 0n],
    chainId: CHAIN_ID,
    query: {
      enabled: !!addr && !!requestId && requestId > 0n,
      // Stop polling once the request reaches a terminal state (SETTLED=3, REFUNDED=4)
      refetchInterval: (q) => {
        const status = (q.state.data as { status?: number } | undefined)?.status
        return status !== undefined && status >= 3 ? false : 10_000
      },
    },
  })

  // wagmi returns a named tuple — cast to our interface which has identical field order
  const request = data
  // Treat zero requestId as "not found" (Solidity returns zero struct for missing ids)
  const found = request && request.requestId > 0n ? request : undefined
  return { request: found, isLoading, refetch }
}

export function useClaimRefund() {
  const addr = PREDICT_AGENT_ADDRESS
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)

  async function claimRefund(requestId: bigint, walletClient: import('viem').WalletClient) {
    if (!addr) return
    setIsPending(true)
    setError(null)
    setTxHash(null)
    try {
      const hash = await walletClient.writeContract({
        address: addr,
        abi: PREDICT_AGENT_ABI,
        functionName: 'claimRefund',
        args: [requestId],
        chain: ARC_CHAIN,
        account: walletClient.account!,
      })
      setTxHash(hash)
    } catch (e) {
      const { parseOnchainError } = await import('../lib/utils')
      setError(parseOnchainError(e))
    } finally {
      setIsPending(false)
    }
  }

  return { claimRefund, isPending, error, txHash }
}

/**
 * Claim all eligible refunds for the connected wallet in sequence.
 * Eligible = status PENDING (0) AND buyerRevealDeadline has passed AND buyer === connectedAddress.
 */
export function useClaimAllRefunds() {
  const addr = PREDICT_AGENT_ADDRESS
  const [isPending, setIsPending] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [txHashes, setTxHashes] = useState<`0x${string}`[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function claimAll(
    requestIds: bigint[],
    walletClient: import('viem').WalletClient,
  ) {
    if (!addr || requestIds.length === 0) return
    setIsPending(true)
    setErrors([])
    setTxHashes([])
    setProgress({ done: 0, total: requestIds.length })
    const hashes: `0x${string}`[] = []
    const errs: string[] = []
    for (let i = 0; i < requestIds.length; i++) {
      try {
        const hash = await walletClient.writeContract({
          address: addr,
          abi: PREDICT_AGENT_ABI,
          functionName: 'claimRefund',
          args: [requestIds[i]],
          chain: ARC_CHAIN,
          account: walletClient.account!,
        })
        hashes.push(hash)
      } catch (e) {
        const { parseOnchainError } = await import('../lib/utils')
        errs.push(`Request #${requestIds[i]}: ${parseOnchainError(e)}`)
      }
      setProgress({ done: i + 1, total: requestIds.length })
    }
    setTxHashes(hashes)
    setErrors(errs)
    setIsPending(false)
  }

  return { claimAll, isPending, errors, txHashes, progress }
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
