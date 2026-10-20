import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatUsdc(raw: bigint, decimals = 6): string {
  // Use BigInt arithmetic to avoid Number precision loss on large balances.
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  // Left-pad fractional part to `decimals` digits, then trim trailing zeros (min 2).
  const fracStr = frac.toString().padStart(decimals, '0')
  const trimmed = fracStr.replace(/0+$/, '').padEnd(2, '0')
  const combined = `${whole}.${trimmed}`
  // Use Intl only for the integer part's thousand-separators; keep our own frac.
  const [intPart] = combined.split('.')
  const formatted = new Intl.NumberFormat('en-US').format(BigInt(intPart))
  return `${formatted}.${trimmed}`
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || (error as { code?: number })?.code === 4001) {
    return 'Transaction cancelled.'
  }
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) {
    return 'Insufficient USDC balance. Please add funds.'
  }
  if (msg.includes('paused')) return 'The marketplace is currently paused.'
  if (msg.includes('notseller')) return 'Only the registered seller can perform this action.'
  if (msg.includes('hashmismatch')) return 'Signal hash mismatch — reveal data does not match commitment.'
  if (msg.includes('reverted')) {
    const m = msg.match(/reason="([^"]+)"/)
    return m ? `Transaction failed: ${m[1]}` : 'Transaction failed. Please try again.'
  }
  if (msg.includes('network') || msg.includes('timeout')) {
    return 'Network error. Please check your connection and retry.'
  }
  return 'Something went wrong. Please try again.'
}

// Status labels
export const STATUS_LABELS: Record<number, string> = {
  0: 'PENDING',
  1: 'COMMITTED',
  2: 'REVEALED',
  3: 'SETTLED',
  4: 'REFUNDED',
}

export const STATUS_COLORS: Record<number, string> = {
  0: 'text-yellow-400',
  1: 'text-blue-400',
  2: 'text-purple-400',
  3: 'text-green-400',
  4: 'text-red-400',
}

export const STATUS_BG: Record<number, string> = {
  0: 'bg-yellow-400/10 border-yellow-400/20',
  1: 'bg-blue-400/10 border-blue-400/20',
  2: 'bg-purple-400/10 border-purple-400/20',
  3: 'bg-green-400/10 border-green-400/20',
  4: 'bg-red-400/10 border-red-400/20',
}

export const SUPPORTED_TOKENS = ['BTC', 'ETH', 'SOL', 'ARB', 'POL'] as const
export type SupportedToken = (typeof SUPPORTED_TOKENS)[number]

// bytes32 ASCII encoding: right-zero-padded, 32 bytes = 64 hex chars after 0x
// "BULLISH" = 42 55 4c 4c 49 53 48 + 25×00
export const DIRECTION_BULLISH = '0x42554c4c49534800000000000000000000000000000000000000000000000000' as `0x${string}`
// "BEARISH" = 42 45 41 52 49 53 48 + 25×00
export const DIRECTION_BEARISH = '0x4245415249534800000000000000000000000000000000000000000000000000' as `0x${string}`

export function directionLabel(d: string): 'BULLISH' | 'BEARISH' | null {
  const lower = (d).toLowerCase()
  // Exact match first (most reliable)
  if (lower === DIRECTION_BULLISH.toLowerCase()) return 'BULLISH'
  if (lower === DIRECTION_BEARISH.toLowerCase()) return 'BEARISH'
  // Prefix match on first 7 ASCII bytes (handles minor padding differences)
  const hex = lower.startsWith('0x') ? lower.slice(2) : lower
  if (hex.startsWith('42554c4c495348')) return 'BULLISH'  // BULLISH
  if (hex.startsWith('42454152495348')) return 'BEARISH'  // BEARISH
  return null
}

export function formatTimestamp(ts: bigint): string {
  if (ts === 0n) return '—'
  return new Date(Number(ts) * 1000).toLocaleString()
}
