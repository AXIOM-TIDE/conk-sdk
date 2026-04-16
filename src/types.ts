/**
 * @axiomtide/conk-sdk — Type Definitions
 * All interfaces and enums for the CONK protocol SDK.
 */

// ─── Network ────────────────────────────────────────────────────────────────

export type Network = 'mainnet' | 'testnet' | 'devnet'

export type CastMode = 'open' | 'burn' | 'eyes_only'

// ─── Config ─────────────────────────────────────────────────────────────────

export interface ConkClientConfig {
  /** Cloudflare Worker proxy URL for ZK proof generation */
  proxy?: string
  /** Sui network to target */
  network?: Network
  /** Optional raw private key for daemon (non-zkLogin) use */
  privateKey?: string
  /** Optional pre-loaded zkLogin session */
  zkLoginSession?: ZkLoginSession
  /** Max USDC spending cap in cents (daemon use) */
  harborLimit?: number
  /** Default cast mode for daemon publishing */
  castMode?: CastMode
  /** Default cast price in USDC */
  castPrice?: number
}

// ─── ZkLogin ─────────────────────────────────────────────────────────────────

export interface ZkLoginSession {
  address: string
  proof: ZkProof
  ephemeralKeyPair: EphemeralKeyPair
  maxEpoch: number
  randomness: string
  salt: string
  /** Optional — derived from salt if not present */
  addressSeed?: string
}

export interface ZkProof {
  proofPoints: {
    a: string[]
    b: string[][]
    c: string[]
  }
  issBase64Details: {
    value: string
    indexMod4: number
  }
  headerBase64: string
}

export interface EphemeralKeyPair {
  publicKey: string
  privateKey: string
}

// ─── Harbor ──────────────────────────────────────────────────────────────────

export interface HarborState {
  address: string
  balanceCents: number
  objectId: string
}

export interface SweepOptions {
  toAddress: string
  amount: number | 'all'
}

export interface CreateVesselOptions {
  /** Fuel amount in USDC cents */
  fuelAmount: number
}

// ─── Vessel ──────────────────────────────────────────────────────────────────

export interface VesselState {
  id: string
  address: string
  fuelCents: number
  objectId: string
}

// ─── Cast ────────────────────────────────────────────────────────────────────

export interface AutoResponse {
  hook: string
  body: string
  triggerOnEveryRead: boolean
}

export interface PublishOptions {
  hook: string
  body: string
  /** Price per read in USDC (decimal, e.g. 0.001 = $0.001) */
  price: number
  mode: CastMode
  /** Duration string — '1h' | '24h' | '7d' | 'permanent' */
  duration?: string
  autoResponse?: AutoResponse
  /** Walrus blobId from Attachments.upload() */
  attachment?: string
}

export interface ReadOptions {
  castId: string
  /** Optional buyer message attached to the payment */
  message?: string
}

export interface CastResult {
  id: string
  url: string
  txDigest: string
  publishedAt: number
}

export interface ReadResult {
  castId: string
  hook: string
  body: string
  autoResponse?: AutoResponse
  attachment?: string
  receipt: TransactionReceipt
}

// ─── Receipt ─────────────────────────────────────────────────────────────────

export interface TransactionReceipt {
  txDigest: string
  castId: string
  /** Amount paid in USDC cents */
  amount: number
  timestamp: number
  buyerAddress?: string
  message?: string
}

export interface ReadEvent {
  castId: string
  amount: number
  txDigest: string
  timestamp: number
  message?: string
}

export type ReadEventCallback = (event: ReadEvent) => void

// ─── Attachments ─────────────────────────────────────────────────────────────

export interface UploadOptions {
  maxMB?: number
}

export interface UploadResult {
  blobId: string
  url: string
  size: number
  mediaType: string
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ConkError extends Error {
  constructor(
    message: string,
    public readonly code: ConkErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ConkError'
  }
}

export enum ConkErrorCode {
  INSUFFICIENT_FUEL     = 'INSUFFICIENT_FUEL',
  INSUFFICIENT_BALANCE  = 'INSUFFICIENT_BALANCE',
  CAST_NOT_FOUND        = 'CAST_NOT_FOUND',
  PROOF_GENERATION_FAILED = 'PROOF_GENERATION_FAILED',
  TRANSACTION_FAILED    = 'TRANSACTION_FAILED',
  UPLOAD_FAILED         = 'UPLOAD_FAILED',
  INVALID_CONFIG        = 'INVALID_CONFIG',
  NETWORK_ERROR         = 'NETWORK_ERROR',
  SPENDING_CAP_EXCEEDED = 'SPENDING_CAP_EXCEEDED',
}
