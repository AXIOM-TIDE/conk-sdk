/**
 * @axiomtide/conk-sdk — Protocol Configuration
 * Synced with apps/conk/src/sui/index.ts — April 15, 2026
 */

import type { Network } from './types'

// ─── Contract Addresses ───────────────────────────────────────────────────────

export const CONTRACTS = {
  mainnet: {
    package:  '0x8cde30c2af7523193689e2f3eaca6dc4fadf6fd486471a6c31b14bc9db5164b2',
    treasury: '0xe0117fba317d2267b8d90adca1fe79eceeec756bcf54edf04cc29ee5306ab32e',
    abyss:    '0x22d066f6337d68848e389402926b4a10424d9728744efb9e6dd0d0ca1c5921c7',
    drift:    '0x95520350968d56b3552521d3ea508934517dde94ad30bb43209aa4fc3cec21de',
    clock:    '0x6',
  },
  testnet: {
    package:  '',
    treasury: '',
    abyss:    '',
    drift:    '',
    clock:    '0x6',
  },
  devnet: {
    package:  '',
    treasury: '',
    abyss:    '',
    drift:    '',
    clock:    '0x6',
  },
} as const

// ─── RPC Endpoints ────────────────────────────────────────────────────────────

export const RPC_ENDPOINTS: Record<Network, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  devnet:  'https://fullnode.devnet.sui.io:443',
}

// ─── Proxy ────────────────────────────────────────────────────────────────────

export const DEFAULT_PROXY = 'https://conk-zkproxy-v2.italktonumbers.workers.dev'

// ─── USDC ─────────────────────────────────────────────────────────────────────

/** Real mainnet USDC type — from apps/conk/src/sui/client.ts */
export const USDC_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

export const USDC_DECIMALS = 6
export const USDC_UNIT     = 1_000_000

export function toBaseUnits(usdc: number): bigint {
  return BigInt(Math.round(usdc * USDC_UNIT))
}

export function toCents(baseUnits: bigint): number {
  return Number(baseUnits) / (USDC_UNIT / 100)
}

// ─── Walrus ───────────────────────────────────────────────────────────────────

/** Real production Walrus endpoints — from apps/conk/src/sui/index.ts */
export const WALRUS_AGGREGATOR = 'https://aggregator.walrus.site'
export const WALRUS_PUBLISHER  = 'https://publisher.walrus.site'

// ─── Cast modes (matches Move contract u8 enum) ───────────────────────────────

export const CAST_MODE = {
  OPEN:       0,
  BURN:       1,
  EYES_ONLY:  2,
} as const

// ─── Cast durations (matches Move contract u8 enum) ──────────────────────────

export const CAST_DURATION = {
  '1h':        0,
  '24h':       1,
  '7d':        2,
  '30d':       3,
  'permanent': 255,   // max u8 — signals no expiry to the contract
} as const

export type CastDurationKey = keyof typeof CAST_DURATION

export function durationToEpochs(duration: string): number {
  return CAST_DURATION[duration as CastDurationKey] ?? CAST_DURATION['24h']
}

// ─── Lighthouse types ─────────────────────────────────────────────────────────

/**
 * Two lighthouse types — mutually exclusive:
 *
 *   VIRAL     — earned by read momentum (1M reads / 24h or 500K × 3 tides)
 *               has expiresAt, shows DecayBadge, resets on each read
 *
 *   PERMANENT — deliberately published by creator, no expiry,
 *               shows PermanentBadge, anchored to a Beacon
 */
export const LIGHTHOUSE_TYPE = {
  VIRAL:     'viral',
  PERMANENT: 'permanent',
} as const

export type LighthouseType = typeof LIGHTHOUSE_TYPE[keyof typeof LIGHTHOUSE_TYPE]

// ─── Fee split (matches crossPaywall in client.ts) ───────────────────────────

export const AUTHOR_SHARE   = 0.97   // 97% to creator
export const TREASURY_SHARE = 0.03   // 3% to protocol

// ─── Siren floor ──────────────────────────────────────────────────────────────

/**
 * The non-negotiable Abyss floor for every Siren broadcast.
 * "Sample" tier pays this. "Paid" tier pays this plus the author's price.
 * The Abyss always gets paid. This is how the network stays alive.
 */
export const SIREN_FLOOR_USDC  = 0.001
export const SIREN_FLOOR_UNITS = 1_000

export const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
