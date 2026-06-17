/**
 * @axiomtide/conk-sdk — Protocol Configuration
 * Synced with CONK v11 protocol.
 */

import type { Network } from './types'

// ─── v11 Package & Shared Object IDs ─────────────────────────────────────────
// These are populated via environment variables after the v11 deploy.
// Until deploy completes the sentinel 'PENDING_V11_DEPLOY' is used.

/** CONK Move package address (v13). Deploy tx: 7EpFFVv7TPSus6WeHno1n2JZUSRGZkwjAebgRdUEaqnT */
export const CONK_PACKAGE_ID =
  process.env.CONK_PACKAGE_ID || '0x6eca0063f930674f26a4a4593a7ef5ed487e21f31caafe74290ab5df88478cc6'

/**
 * ProtocolConfig shared object (new in v11).
 * Required as input to cast::read().
 */
export const PROTOCOL_CONFIG_ID =
  process.env.CONK_PROTOCOL_CONFIG_ID || '0xdc8e5131d6e3bec492a2e12b1d7beddbfec709ae5def8e775dab59c7a45421ea'

/**
 * LighthouseRegistry shared object (new in v11).
 * Required as input to lighthouse::raise() and registry queries.
 */
export const LIGHTHOUSE_REGISTRY_ID =
  process.env.CONK_LIGHTHOUSE_REGISTRY_ID || '0x5ee0f0a6ad1b89412a2e05def4f1e0ad6e606df3751c030e9601fd155b444e94'

// ─── Contract Addresses ───────────────────────────────────────────────────────

export const CONTRACTS: Record<Network, {
  package:  string
  treasury: string
  abyss:    string
  drift:    string
  clock:    string
}> = {
  mainnet: {
    package:  CONK_PACKAGE_ID,  // v11 — deploy tx FzZPXnyBKqFitg5KU5cApHjx8G75dexk9vdnBewen8dL
    treasury: '0xe0117fba317d2267b8d90adca1fe79eceeec756bcf54edf04cc29ee5306ab32e',
    abyss:    '0x075c8667d1780bdde01a8175cd458aa345b3f6e2a84c45b91f82b344a4325bd0',  // v11
    drift:    '0x9312b6837bb12381849b413636064cd8d56b6ef84bf891b3f756b3cbb6157fad',  // v11
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
}

// ─── RPC Endpoints ────────────────────────────────────────────────────────────

/** Tatum enterprise Sui RPC — set TATUM_API_KEY env var; key intentionally removed from source */
export const TATUM_API_KEY = process.env.TATUM_API_KEY ?? ''

export const RPC_ENDPOINTS: Record<Network, string> = {
  mainnet: 'https://sui-mainnet.gateway.tatum.io',
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

/**
 * v11 sentinel value — present in IDs until post-deploy env vars are set.
 * Consumer code may check against this to detect unconfigured deployments.
 */
export const PENDING_V11_DEPLOY = 'PENDING_V11_DEPLOY'
