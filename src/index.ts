/**
 * @axiomtide/conk-sdk
 * Anonymous micropayment and communication SDK for the CONK protocol on Sui.
 *
 * @example
 * import { ConkClient } from '@axiomtide/conk-sdk'
 *
 * const conk = new ConkClient({ network: 'mainnet' })
 *   .withLimits({ maxTxPerMinute: 10, maxCentsPerWindow: 500 })
 */

// ─── Core ─────────────────────────────────────────────────────────────────────
export { ConkClient }  from './ConkClient'
export { Harbor }      from './Harbor'
export { Vessel }      from './Vessel'
export { Cast }        from './Cast'
export { Receipt }     from './Receipt'
export { Attachments } from './Attachments'

// ─── Gas ──────────────────────────────────────────────────────────────────────
export { Gas }         from './gas'
export type { GasEstimate } from './gas'

// ─── Rate limiting ────────────────────────────────────────────────────────────
export { TxRateLimiter, SpendRateLimiter, DaemonLimiter } from './ratelimit'
export type { TxRateLimitConfig, SpendLimitConfig, DaemonLimiterConfig } from './ratelimit'

// ─── Streaming ────────────────────────────────────────────────────────────────
export { CastStream, createStream } from './stream'

// ─── Retry ────────────────────────────────────────────────────────────────────
export { withRetry, withRpcRetry, withTxRetry } from './retry'
export type { RetryOptions } from './retry'

// ─── Config ───────────────────────────────────────────────────────────────────
export {
  DEFAULT_PROXY,
  CONTRACTS,
  RPC_ENDPOINTS,
  toBaseUnits,
  toCents,
  USDC_DECIMALS,
} from './config'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  ConkClientConfig,
  Network,
  CastMode,
  ZkLoginSession,
  ZkProof,
  EphemeralKeyPair,
  HarborState,
  SweepOptions,
  CreateVesselOptions,
  VesselState,
  AutoResponse,
  PublishOptions,
  ReadOptions,
  CastResult,
  ReadResult,
  TransactionReceipt,
  ReadEvent,
  ReadEventCallback,
  UploadOptions,
  UploadResult,
} from './types'

export { ConkError, ConkErrorCode } from './types'

// ─── Lighthouse / Beacon / Registry ──────────────────────────────────────────
export { Lighthouse }  from './Lighthouse'
export { Beacon }      from './Beacon'
export { Registry }    from './Registry'

export type {
  MediaType,
  LighthouseCategory,
  LighthousePublishOptions,
  LighthousePurchaseResult,
  LighthouseMetadata,
} from './Lighthouse'

export type {
  BeaconProfile,
  BeaconState,
} from './Beacon'

export type {
  RegistrySearchOptions,
  RegistryEntry,
} from './Registry'

// ─── Siren ────────────────────────────────────────────────────────────────────
export { Siren, SirenClient, SirenRegistry } from './Siren'
export {
  SIREN_ABYSS_FLOOR_USDC,
  SIREN_ABYSS_FLOOR_UNITS,
} from './Siren'
export type {
  SirenTier,
  SirenClientConfig,
  SirenPublishOptions,
  SirenMetadata,
  SirenSearchOptions,
} from './Siren'

export { SealClient, buildSealMetadata, parseSealMetadata } from './Seal'
export type { SealEncryptOptions, SealEncryptResult, SealDecryptOptions, SealPolicy } from './Seal'
