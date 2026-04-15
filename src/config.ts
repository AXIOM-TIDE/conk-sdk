/**
 * @axiomtide/conk-sdk — Protocol Configuration
 * Contract addresses, RPC endpoints, and protocol constants.
 */

import type { Network } from './types'

// ─── Contract Addresses ───────────────────────────────────────────────────────

export const CONTRACTS = {
  mainnet: {
    package:
      '0x8cde30c2af7523193689e2f3eaca6dc4fadf6fd486471a6c31b14bc9db5164b2',
    // Populated once deployed — stub here if testnet differs
    harbor: '',
    vessel: '',
    cast: '',
  },
  testnet: {
    package: '',
    harbor: '',
    vessel: '',
    cast: '',
  },
  devnet: {
    package: '',
    harbor: '',
    vessel: '',
    cast: '',
  },
} as const

// ─── RPC Endpoints ───────────────────────────────────────────────────────────

export const RPC_ENDPOINTS: Record<Network, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  devnet:  'https://fullnode.devnet.sui.io:443',
}

// ─── Proxy ────────────────────────────────────────────────────────────────────

/**
 * Default Cloudflare Worker proxy for ZK proof generation.
 * Overridable via ConkClientConfig.proxy.
 */
export const DEFAULT_PROXY =
  'https://conk-zkproxy-v2.italktonumbers.workers.dev'

// ─── Protocol Constants ───────────────────────────────────────────────────────

/** USDC coin type on Sui */
export const USDC_COIN_TYPE =
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'

/** Walrus aggregator endpoint */
export const WALRUS_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space'

/** Walrus publisher endpoint */
export const WALRUS_PUBLISHER  = 'https://publisher.walrus-testnet.walrus.space'

/** One USDC in base units (6 decimals) */
export const USDC_DECIMALS = 6
export const USDC_UNIT     = 1_000_000

/** Convert human-readable USDC to base units */
export function toBaseUnits(usdc: number): bigint {
  return BigInt(Math.round(usdc * USDC_UNIT))
}

/** Convert base units to human-readable USDC cents (integer) */
export function toCents(baseUnits: bigint): number {
  return Number(baseUnits) / (USDC_UNIT / 100)
}

/** Duration string to epoch offset */
export function durationToEpochs(duration: string): number {
  const map: Record<string, number> = {
    '1h':        1,
    '24h':      24,
    '7d':      168,
    '30d':     720,
    'permanent': 0,  // 0 = no expiry
  }
  return map[duration] ?? 24
}
