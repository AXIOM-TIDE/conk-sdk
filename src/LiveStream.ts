/**
 * @axiomtide/conk-sdk — Stream (protocol primitive)
 * Time-gated paid access sessions for live content on Sui.
 * Creators open a Stream. Viewers join and receive a StreamSession.
 * Three payment models: Per-View · Per-Minute · Subscription.
 * Revenue split: 97% to creator / 3% to protocol on every join.
 * Settle on join — non-custodial. CONK never holds creator funds.
 */

import { Transaction }        from '@mysten/sui/transactions'
import { SuiClient }          from '@mysten/sui/client'
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519'
import { CONTRACTS, toBaseUnits, USDC_COIN_TYPE } from './config'
import { ConkError, ConkErrorCode }               from './types'
import type { Network, ZkLoginSession, TransactionReceipt } from './types'

// ─── Constants (mirror stream.move) ──────────────────────────────────────────

/** Payment types — must match PAYMENT_* constants in stream.move */
export const STREAM_PAYMENT_TYPE = {
  PER_VIEW:     0 as const,   // one-time access fee for full stream duration
  PER_MINUTE:   1 as const,   // per-unit time pricing, billed at join
  SUBSCRIPTION: 2 as const,   // access for active CONK subscription holders
} as const

export type StreamPaymentType = typeof STREAM_PAYMENT_TYPE[keyof typeof STREAM_PAYMENT_TYPE]

/** Protocol fee to create a stream (USDC decimal) */
export const STREAM_CREATE_FEE       = 0.05    // $0.05
export const STREAM_CREATE_FEE_UNITS = 50_000  // microunits

/** Minimum session price (USDC decimal) */
export const STREAM_MIN_SESSION_FEE       = 0.01
export const STREAM_MIN_SESSION_FEE_UNITS = 10_000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamCreateOptions {
  /** USDC per viewer session in decimal (e.g. 0.10 = $0.10). Min $0.01. */
  pricePerSession: number
  /** How long each session is valid, in seconds */
  durationSeconds: number
  /** Payment model */
  paymentType: StreamPaymentType
}

export interface StreamResult {
  /** On-chain Stream object ID */
  id: string
  /** Transaction digest from the create() call */
  txDigest: string
  /** Timestamp when the stream was created (ms) */
  createdAt: number
}

export interface StreamSessionResult {
  /** On-chain StreamSession object ID (owned by viewer) */
  sessionId: string
  /** Stream object ID this session belongs to */
  streamId: string
  /** Unix timestamp (ms) when session expires */
  expiresAt: number
  /** USDC microunits paid */
  paid: number
  /** Transaction digest */
  txDigest: string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function splitUsdcCoin(
  suiClient: SuiClient,
  tx:        Transaction,
  sender:    string,
  amount:    bigint,
): Promise<ReturnType<Transaction['splitCoins']>> {
  const coins = await suiClient.getCoins({
    owner:    sender,
    coinType: USDC_COIN_TYPE,
  })

  if (!coins.data.length) {
    throw new ConkError(
      'No USDC coins found in wallet',
      ConkErrorCode.INSUFFICIENT_BALANCE,
    )
  }

  const sorted = [...coins.data].sort(
    (a, b) => Number(BigInt(b.balance) - BigInt(a.balance)),
  )
  const coin = sorted.find(c => BigInt(c.balance) >= amount) ?? sorted[0]

  return tx.splitCoins(tx.object(coin.coinObjectId), [tx.pure.u64(amount)])
}

function keypairFromSession(session: ZkLoginSession): Ed25519Keypair {
  const raw = session.ephemeralKeyPair.privateKey
  const bytes = raw.startsWith('0x')
    ? Uint8Array.from(Buffer.from(raw.slice(2), 'hex'))
    : Uint8Array.from(Buffer.from(raw, 'base64'))
  return Ed25519Keypair.fromSecretKey(bytes)
}

async function executeWithSession(
  suiClient: SuiClient,
  session:   ZkLoginSession,
  tx:        Transaction,
  showObjectChanges = true,
  showEvents        = false,
) {
  tx.setSender(session.address)

  const keypair = keypairFromSession(session)
  const { bytes, signature: ephemeralSig } = await tx.sign({
    client: suiClient,
    signer: keypair,
  })

  const { getZkLoginSignature } = await import('@mysten/sui/zklogin')
  const zkSig = getZkLoginSignature({
    inputs: {
      proofPoints:      session.proof.proofPoints,
      issBase64Details: session.proof.issBase64Details,
      headerBase64:     session.proof.headerBase64,
      addressSeed:      session.addressSeed ?? '',
    },
    maxEpoch:      session.maxEpoch,
    userSignature: ephemeralSig,
  })

  return suiClient.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        zkSig,
    options: {
      showEffects:       true,
      showObjectChanges,
      showEvents,
    },
  })
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

  // ─── Static: create a new Stream ──────────────────────────────────────────

  /**
   * Create a new Stream.
   *
   * Creator pays $0.05 to Abyss. The Stream becomes a shared object
   * that any viewer can join. Set price, duration, and payment type.
   */
  static async create(
    suiClient: SuiClient,
    network:   Network,
    session:   ZkLoginSession,
    options:   StreamCreateOptions,
  ): Promise<Stream> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    const [feeCoin] = await splitUsdcCoin(
      suiClient,
      tx,
      session.address,
      BigInt(STREAM_CREATE_FEE_UNITS),
    )

    const priceUnits = toBaseUnits(options.pricePerSession)
    const durationMs = BigInt(options.durationSeconds * 1000)

    tx.moveCall({
      target:    `${contracts.package}::stream::create`,
      arguments: [
        feeCoin,
        tx.object(contracts.abyss),
        tx.pure.u64(priceUnits),
        tx.pure.u64(durationMs),
        tx.pure.u8(options.paymentType),
        tx.object(contracts.clock),
      ],
    })

    let txResult: Awaited<ReturnType<typeof executeWithSession>>
    try {
      txResult = await executeWithSession(suiClient, session, tx, true, false)
    } catch (err) {
      throw new ConkError(
        `Stream create transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    const streamChange = txResult.objectChanges?.find(
      (c) =>
        c.type === 'created' &&
        (c as { objectType?: string }).objectType?.includes('::stream::Stream'),
    ) as { objectId?: string } | undefined

    if (!streamChange?.objectId) {
      throw new ConkError(
        'Could not locate Stream object in transaction output',
        ConkErrorCode.TRANSACTION_FAILED,
        { digest: txResult.digest },
      )
    }

    return new Stream({
      id:        streamChange.objectId,
      txDigest:  txResult.digest,
      createdAt: Date.now(),
    })
  }

  // ─── Static: join a Stream ────────────────────────────────────────────────

  /**
   * Join a live Stream as a viewer.
   *
   * Pays price_per_session: 97% to creator immediately, 3% to protocol.
   * Returns a StreamSession object — owned by viewer, expires after
   * the stream's configured duration_ms.
   */
  static async join(
    suiClient: SuiClient,
    network:   Network,
    session:   ZkLoginSession,
    streamId:  string,
  ): Promise<StreamSessionResult> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    // Fetch stream to know the session price and duration
    const streamObj = await suiClient.getObject({
      id:      streamId,
      options: { showContent: true },
    })

    const fields = (
      streamObj.data?.content as { fields?: Record<string, unknown> }
    )?.fields

    const priceUnits = BigInt((fields?.price_per_session as string | number) ?? 0)
    const durationMs = Number((fields?.duration_ms as string | number) ?? 0)

    const [feeCoin] = await splitUsdcCoin(
      suiClient,
      tx,
      session.address,
      priceUnits,
    )

    tx.moveCall({
      target:    `${contracts.package}::stream::join`,
      arguments: [
        tx.object(streamId),
        feeCoin,
        tx.object(contracts.abyss),
        tx.object(contracts.clock),
      ],
    })

    let txResult: Awaited<ReturnType<typeof executeWithSession>>
    try {
      txResult = await executeWithSession(suiClient, session, tx, true, true)
    } catch (err) {
      throw new ConkError(
        `Stream join transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    const sessionChange = txResult.objectChanges?.find(
      (c) =>
        c.type === 'created' &&
        (c as { objectType?: string }).objectType?.includes('::stream::StreamSession'),
    ) as { objectId?: string } | undefined

    const joinEvent = txResult.events?.find(
      (e) => e.type?.includes('::stream::SessionJoined'),
    )
    const parsed = (joinEvent?.parsedJson ?? {}) as Record<string, unknown>

    return {
      sessionId: sessionChange?.objectId ?? '',
      streamId,
      expiresAt: Number(parsed.expires_at ?? Date.now() + durationMs),
      paid:      Number(priceUnits),
      txDigest:  txResult.digest,
    }
  }

  // ─── Static: verify a session ─────────────────────────────────────────────

  /**
   * Verify a viewer's StreamSession is still active.
   *
   * Pure read — no transaction. Returns true if session has not expired.
   * Call this before serving any gated video content.
   */
  static async verify(
    suiClient: SuiClient,
    _network:  Network,
    sessionId: string,
  ): Promise<boolean> {
    const sessionObj = await suiClient.getObject({
      id:      sessionId,
      options: { showContent: true },
    })

    const fields = (
      sessionObj.data?.content as { fields?: Record<string, unknown> }
    )?.fields

    if (!fields) return false

    const expiresAt = Number(fields.expires_at ?? 0)
    return Date.now() < expiresAt
  }

  // ─── Static: end a Stream ─────────────────────────────────────────────────

  /**
   * End a Stream.
   *
   * Only the creator may call this. Sets state to CLOSED and emits
   * StreamEnded with lifetime totals. Pass vodChestId to link the
   * VOD recording so viewers can find and access the replay.
   */
  static async end(
    suiClient: SuiClient,
    network:   Network,
    session:   ZkLoginSession,
    streamId:  string,
    options?:  { vodChestId?: string },
  ): Promise<TransactionReceipt> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    // Encode Option<ID> — Move BCS: 0x00 = None, 0x01 ++ bytes = Some(id)
    const vodOptionBytes = options?.vodChestId
      ? new Uint8Array([
          1,
          ...Buffer.from(options.vodChestId.replace('0x', '').padStart(64, '0'), 'hex'),
        ])
      : new Uint8Array([0])

    tx.moveCall({
      target:    `${contracts.package}::stream::end`,
      arguments: [
        tx.object(streamId),
        tx.pure(vodOptionBytes),
        tx.object(contracts.clock),
      ],
    })

    let txResult: Awaited<ReturnType<typeof executeWithSession>>
    try {
      txResult = await executeWithSession(suiClient, session, tx, false, false)
    } catch (err) {
      throw new ConkError(
        `Stream end transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    return {
      txDigest:     txResult.digest,
      castId:       streamId,
      amount:       0,
      timestamp:    Date.now(),
      buyerAddress: session.address,
    }
  }
}
