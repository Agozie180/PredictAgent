import {
  NetworkBitcoin,
  NetworkEthereum,
  NetworkSolana,
  NetworkArbitrumOne,
  NetworkPolygon,
} from '@web3icons/react'
import type { SVGProps } from 'react'

const ICONS: Record<string, React.FC<SVGProps<SVGSVGElement>>> = {
  BTC: NetworkBitcoin,
  ETH: NetworkEthereum,
  SOL: NetworkSolana,
  ARB: NetworkArbitrumOne,
  POL: NetworkPolygon,   // Polygon rebranded MATIC → POL in 2024
}

interface TokenIconProps extends SVGProps<SVGSVGElement> {
  token: string
  size?: number
}

export function TokenIcon({ token, size = 16, ...rest }: TokenIconProps) {
  const Icon = ICONS[token]
  if (!Icon) return null
  return <Icon width={size} height={size} {...rest} />
}
