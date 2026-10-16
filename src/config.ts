/**
 * wagmi + ConnectKit configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Wallet connectors: MetaMask (injected) + WalletConnect (all mobile wallets)
 * Set VITE_WALLETCONNECT_PROJECT_ID in .env for WalletConnect support.
 * Get a free project ID at https://cloud.walletconnect.com
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arc.id, arc.rpcUrls.default.http[0])

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined

const connectors = WC_PROJECT_ID
  ? [
      injected(),
      walletConnect({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: 'PredictAgent',
          description: 'AI-powered price-movement signal marketplace on Arc',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://predictAgent.arc.io',
          icons: ['https://arc.io/favicon.ico'],
        },
      }),
    ]
  : [injected()]

export const config = createConfig({
  chains: [arc, arcTestnet, mainnet],
  connectors,
  transports: {
    [arc.id]: http(),
    [arcTestnet.id]: http(),
    [mainnet.id]: http(), // ENS resolution
  },
})
