/**
 * @axiomtide/conk-sdk
 * Anonymous micropayment and communication SDK for CONK protocol.
 *
 * @example
 * import { ConkClient } from '@axiomtide/conk-sdk'
 *
 * const conk = new ConkClient({ network: 'mainnet' })
 */

export { ConkClient }    from './ConkClient'
export { Harbor }        from './Harbor'
export { Vessel }        from './Vessel'
export { Cast }          from './Cast'
export { Receipt }       from './Receipt'
export { Attachments }   from './Attachments'

// Config helpers (useful for integrators)
export {
  DEFAULT_PROXY,
  CONTRACTS,
  RPC_ENDPOINTS,
  toBaseUnits,
  toCents,
  USDC_DECIMALS,
} from './config'

// Types
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
