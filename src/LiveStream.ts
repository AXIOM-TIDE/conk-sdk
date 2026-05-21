/**
 * @axiomtide/conk-sdk — Stream
 * Time-gated paid access sessions for live content on Sui.
 *
 * Creators open a Stream (shared object). Viewers join and receive
 * a StreamSession (owned object) that is valid for a configured duration.
 * Revenue split: 97% to creator / 3% to Abyss on every join.
 * Settlement is non-custodial — CONK never holds creator funds.
 *
 * Three payment models:
 *   PER_VIEW     (0) — one-time flat fee for full duration
 *   PER_MINUTE   (1) — rate-based billing, charged upfront at join
 *   SUBSCRIPTION (2) — recurring access for subscribers
 *
 * Usage (creator):
 *   const s = await Stream.create(suiClient, 'mainnet', senderAddress, {
 *     pricePerSession: 0.10,
 *     durationSeconds: 3600,
 *     paymentType: STREAM_PAYMENT_TYPE.PER_VIEW,
 *   }, signAndExecute)
 *   console.log(s.id)   // shared Stream object ID
 *
 * Usage (viewer):
 *   const session = await Stream.join(suiClient, 'mainnet', senderAddress, streamId, signAndExecute)
 *   const active  = await Stream.verify(suiClient, session.sessionId)
 *
 * Usage (creator close):
 *   await Stream.end(suiClient, 'mainnet', senderAddress, streamId, signAndExecute, { vodChestId })
 */

import { Transaction }    from '@mysten/sui/transactions'
import { SuiClient }      from '@mysten/sui/client'
import { CONTRACTS, toBaseUnits, USDC_TYPE } from './config'
import { ConkError, ConkErrorCode }          from './types'
import type { Network }                      from './types'

// ─── Constants (mirror stream.move) ──────────────────────────────────────────

/** Payment types — must match PAYMENT_* constants in stream.move */
export const STREAM_PAYMENT_TYPE = {
  PER_VIEW:     0 as const,
  PER_MINUTE:   1 as const,
  SUBSCRIPTION: 2 as const,
} as const

export type StreamPaymentType =
  typeof STREAM_PAYMENT_TYPE[keyof typeof STREAM_PAYMENT_TYPE]

/** Protocol fee to create a stream: $0.05 (USDC microunits) */
export const STREAM_CREATE_FEE       = 0.05
export const STREAM_CREATE_FEE_UNITS = 50_000n

/** Minimum session price: $0.01 (USDC microunits) */
export const STREAM_MIN_SESSION_FEE       = 0.01
export const STREAM_MIN_SESSION_FEE_UNITS = 10_000n

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StreamCreateOptions {
  /** USDC per session in decimal (e.g. 0.10 = $0.10). Min $0.01. */
  pricePerSession: number
  /** Session validity window in seconds after join */
  durationSeconds: number
  /** Payment model */
  paymentType: StreamPaymentType
  /**
   * v11: Publisher's Vessel object ID.
   * Required for cross-primitive reputation attribution.
   * Set to the Vessel.objectId() of the stream creator.
   */
  vesselId: string
}

export interface StreamResult {
  /** On-chain Stream (shared) object ID */
  id:        string
  txDigest:  string
  createdAt: number
}

export interface StreamSessionResult {
  /** On-chain StreamSession (owned by viewer) object ID */
  sessionId:  string
  /** Stream object this session belongs to */
  streamId:   string
  /** Unix ms when this session expires */
  expiresAt:  number
  /** USDC microunits paid */
  paid:       number
  txDigest:   string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getLargestUsdcCoin(
  suiClient: SuiClient,
  sender:    string,
  needed:    bigint,
): Promise<string> {
  const { data } = await suiClient.getCoins({ owner: sender, coinType: USDC_TYPE })
  if (!data.length) {
    throw new ConkError('No USDC coins found', ConkErrorCode.INSUFFICIENT_BALANCE, { sender })
  }
  const sorted = [...data].sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))
  const coin   = sorted.find(c => BigInt(c.balance) >= needed) ?? sorted[0]
  return coin.coinObjectId
}



// ─── Stream class ─────────────────────────────────────────────────────────────

export class Stream {
  readonly id:        string
  readonly txDigest:  string
  readonly createdAt: number

  constructor(result: StreamResult) {
    this.id        = result.id
    this.txDigest  = result.txDigest
    this.createdAt = result.createdAt
  }

  // ─── create ───────────────────────────────────────────────────────────────

  /**
   * Create a new Stream on-chain.
   *
   * Creator pays $0.05 to Abyss. The Stream becomes a shared object
   * that any viewer can join via `Stream.join()`.
   *
   * @param signAndExecute  Caller-provided signing function. Accepts a Transaction
   *   and returns `{ digest: string }`. Works with zkLogin, keypair, or wallet adapter.
   */
  static async create(
    suiClient:      SuiClient,
    network:        Network,
    sender:         string,
    options:        StreamCreateOptions,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
  ): Promise<Stream> {
    const contracts  = CONTRACTS[network]
    const priceUnits = toBaseUnits(options.pricePerSession)
    const durationMs = BigInt(options.durationSeconds * 1000)
    const usdcCoin   = await getLargestUsdcCoin(suiClient, sender, STREAM_CREATE_FEE_UNITS)

    const tx = new Transaction()
    const [feeCoin] = tx.splitCoins(tx.object(usdcCoin), [tx.pure.u64(STREAM_CREATE_FEE_UNITS)])

    tx.moveCall({
      target: `${contracts.package}::stream::create`,
      arguments: [
        feeCoin,
        tx.object(contracts.abyss),
        tx.pure.id(options.vesselId),          // v11: vessel_id for attribution
        tx.pure.u64(priceUnits),
        tx.pure.u64(durationMs),
        tx.pure.u8(options.paymentType),
        tx.object(contracts.clock),
      ],
    })

    let digest: string
    try {
      ;({ digest } = await signAndExecute(tx))
    } catch (err) {
      throw new ConkError(
        `stream::create failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    // Fetch the shared Stream object from the tx effects
    const result = await suiClient.getTransactionBlock({
      digest,
      options: { showObjectChanges: true },
    })

    const created = result.objectChanges?.find(
      c => c.type === 'created' &&
           (c as { objectType?: string }).objectType?.includes('::stream::Stream'),
    ) as { objectId?: string } | undefined

    if (!created?.objectId) {
      throw new ConkError(
        'Stream object not found in tx output',
        ConkErrorCode.TRANSACTION_FAILED,
        { digest },
      )
    }

    return new Stream({ id: created.objectId, txDigest: digest, createdAt: Date.now() })
  }

  // ─── join ─────────────────────────────────────────────────────────────────

  /**
   * Join a live Stream as a viewer.
   *
   * Pays `price_per_session`: 97% goes to creator immediately, 3% to Abyss.
   * Returns a `StreamSessionResult` containing the owned StreamSession object ID.
   * Call `Stream.verify(sessionId)` before serving any gated content.
   */
  static async join(
    suiClient:      SuiClient,
    network:        Network,
    sender:         string,
    streamId:       string,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
  ): Promise<StreamSessionResult> {
    const contracts = CONTRACTS[network]

    // Read stream state to get the session price
    const streamObj = await suiClient.getObject({ id: streamId, options: { showContent: true } })
    const fields    = (streamObj.data?.content as { fields?: Record<string, unknown> })?.fields
    if (!fields) {
      throw new ConkError('Could not read Stream object', ConkErrorCode.TRANSACTION_FAILED, { streamId })
    }
    const priceUnits = BigInt(fields.price_per_session as string | number)
    const durationMs = Number(fields.duration_ms as string | number)
    const usdcCoin   = await getLargestUsdcCoin(suiClient, sender, priceUnits)

    const tx = new Transaction()
    const [feeCoin] = tx.splitCoins(tx.object(usdcCoin), [tx.pure.u64(priceUnits)])

    tx.moveCall({
      target: `${contracts.package}::stream::join`,
      arguments: [
        tx.object(streamId),
        feeCoin,
        tx.object(contracts.abyss),
        tx.object(contracts.clock),
      ],
    })

    let digest: string
    try {
      ;({ digest } = await signAndExecute(tx))
    } catch (err) {
      throw new ConkError(
        `stream::join failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err, streamId },
      )
    }

    const result = await suiClient.getTransactionBlock({
      digest,
      options: { showObjectChanges: true, showEvents: true },
    })

    const sessionChange = result.objectChanges?.find(
      c => c.type === 'created' &&
           (c as { objectType?: string }).objectType?.includes('::stream::StreamSession'),
    ) as { objectId?: string } | undefined

    const joinEvent  = result.events?.find(e => e.type?.includes('::stream::SessionJoined'))
    const eventData  = (joinEvent?.parsedJson ?? {}) as Record<string, unknown>

    return {
      sessionId: sessionChange?.objectId ?? '',
      streamId,
      expiresAt: Number(eventData.expires_at ?? Date.now() + durationMs),
      paid:      Number(priceUnits),
      txDigest:  digest,
    }
  }

  // ─── verify ───────────────────────────────────────────────────────────────

  /**
   * Check whether a viewer's StreamSession is still active.
   *
   * Pure client-side read — no transaction required.
   * Returns false if the session has expired, been consumed, or does not exist.
   */
  static async verify(
    suiClient: SuiClient,
    sessionId: string,
  ): Promise<boolean> {
    try {
      const obj    = await suiClient.getObject({ id: sessionId, options: { showContent: true } })
      const fields = (obj.data?.content as { fields?: Record<string, unknown> })?.fields
      if (!fields) return false
      return Date.now() < Number(fields.expires_at ?? 0)
    } catch {
      return false
    }
  }

  // ─── end ──────────────────────────────────────────────────────────────────

  /**
   * End a Stream (creator only).
   *
   * Sets state to CLOSED. Emits StreamEnded with lifetime earnings and
   * session count. Optionally links a VOD Chest ID so viewers can find
   * the replay after the live session closes.
   *
   * @param options.vodChestId  Optional Chest object ID for VOD replay.
   */
  static async end(
    suiClient:      SuiClient,
    network:        Network,
    _sender:        string,
    streamId:       string,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
    options?:       { vodChestId?: string },
  ): Promise<{ txDigest: string }> {
    const contracts = CONTRACTS[network]

    const tx = new Transaction()
    tx.moveCall({
      target: `${contracts.package}::stream::end`,
      arguments: [
        tx.object(streamId),
        tx.pure.option('id', options?.vodChestId ?? null),
        tx.object(contracts.clock),
      ],
    })

    let digest: string
    try {
      ;({ digest } = await signAndExecute(tx))
    } catch (err) {
      throw new ConkError(
        `stream::end failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err, streamId },
      )
    }

    return { txDigest: digest }
  }

  // ─── fetchState ───────────────────────────────────────────────────────────

  /**
   * Fetch live state of a Stream object.
   *
   * Returns creator, price, duration, payment model, earnings, and
   * session count. Useful for building stream discovery UIs or daemon
   * intelligence reports.
   */
  static async fetchState(
    suiClient: SuiClient,
    streamId:  string,
  ): Promise<{
    id:               string
    creator:          string
    pricePerSession:  number   // USDC decimal
    durationSeconds:  number
    paymentType:      StreamPaymentType
    isLive:           boolean
    totalEarned:      number   // USDC decimal
    sessionCount:     number
    createdAt:        number   // Unix ms
  }> {
    const obj    = await suiClient.getObject({ id: streamId, options: { showContent: true } })
    const fields = (obj.data?.content as { fields?: Record<string, unknown> })?.fields
    if (!fields) {
      throw new ConkError('Could not read Stream state', ConkErrorCode.TRANSACTION_FAILED, { streamId })
    }

    return {
      id:              streamId,
      creator:         fields.creator as string,
      pricePerSession: Number(fields.price_per_session) / 1_000_000,
      durationSeconds: Number(fields.duration_ms) / 1000,
      paymentType:     Number(fields.payment_type) as StreamPaymentType,
      isLive:          Number(fields.state) === 0,
      totalEarned:     Number(fields.total_earned) / 1_000_000,
      sessionCount:    Number(fields.session_count),
      createdAt:       Number(fields.created_at),
    }
  }
}
