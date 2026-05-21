/**
 * @axiomtide/conk-sdk — Cast
 * Publish content casts and read them with micropayments.
 *
 * PTB construction verified against mainnet tx CWWbABJn2vXH9EnDZTjeC9DmfuBRR2v18cgJMVXSY4DL
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient }   from '@mysten/sui/client'
import { bcs }         from '@mysten/sui/bcs'
import { Receipt }     from './Receipt'
import {
  CONTRACTS,
  PROTOCOL_CONFIG_ID,
  toBaseUnits,
  durationToEpochs,
  USDC_TYPE,
} from './config'
import { ConkError, ConkErrorCode } from './types'
import type {
  Network,
  PublishOptions,
  ReadOptions,
  CastResult,
  ReadResult,
  ZkLoginSession,
  ReadEventCallback,
} from './types'

/** USDC fee paid to the Abyss when sounding a cast (0.001 USDC) */
const SOUND_FEE = 1000n

/** Map CastMode string to on-chain u8 */
const MODE_U8: Record<string, number> = {
  open:      0,
  burn:      1,
  eyes_only: 2,
}

export class Cast {
  readonly id:          string
  readonly url:         string
  readonly txDigest:    string
  readonly publishedAt: number

  private receipt: Receipt

  constructor(
    result: CastResult,
    private readonly suiClient: SuiClient,
  ) {
    this.id          = result.id
    this.url         = result.url
    this.txDigest    = result.txDigest
    this.publishedAt = result.publishedAt
    this.receipt     = new Receipt(suiClient, result.id, result.txDigest, 0)
  }

  // ─── Subscribe to read events ──────────────────────────────────────────────

  onRead(callback: ReadEventCallback, pollMs?: number): () => void {
    return this.receipt.onRead(callback, pollMs)
  }

  destroy(): void {
    this.receipt.destroy()
  }

  // ─── Static: publish a new cast ───────────────────────────────────────────

  /**
   * Build and execute a `cast::sound` PTB.
   *
   * v11 PTB layout:
   *   cmd[0]: SplitCoins(usdcCoin, [SOUND_FEE])
   *   cmd[1]: MoveCall cast::sound(
   *     NestedResult[0][0],  // [0]  Coin<USDC> (sound fee)
   *     &mut Abyss,          // [1]  shared object
   *     &mut Vessel,         // [2]  publisher's Vessel (mutable object ref, v11)
   *     &VesselCap,          // [3]  publisher's VesselCap (immutable object ref, v11)
   *     mode (u8),           // [4]
   *     hook (vector<u8>),   // [5]
   *     body (vector<u8>),   // [6]
   *     attachment (vector<vector<u8>>),  // [7]  BCS-encoded Option<vector<u8>>
   *     auto_response (u8),  // [8]
   *     author (address),    // [9]
   *     duration (u8),       // [10]
   *     price (u64),         // [11]
   *     &Clock,              // [12] shared object 0x6
   *   )
   *
   * Breaking change in v11: vessel_id (ID) + vessel_tier (u8) replaced by
   * &mut Vessel + &VesselCap. The contract now derives ID and tier from
   * the on-chain Vessel object directly.
   *
   * @param vesselCapId  The publisher's VesselCap object ID (required in v11).
   */
  static async publish(
    suiClient:      SuiClient,
    network:        Network,
    session:        ZkLoginSession,
    vesselId:       string,
    options:        PublishOptions,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
    vesselCapId:    string,
  ): Promise<Cast> {
    const contracts = CONTRACTS[network]

    // ── Fetch author's USDC coin ──────────────────────────────────────────────
    const coinsResult = await suiClient.getCoins({
      owner:    session.address,
      coinType: USDC_TYPE,
    })
    if (!coinsResult.data.length) {
      throw new ConkError(
        'No USDC coins found for author address',
        ConkErrorCode.INSUFFICIENT_BALANCE,
        { address: session.address },
      )
    }
    const usdcCoinId = coinsResult.data[0].coinObjectId

    // ── Build PTB ─────────────────────────────────────────────────────────────
    const tx = new Transaction()

    // cmd[0]: Split the Abyss sound fee
    const [feeCoin] = tx.splitCoins(tx.object(usdcCoinId), [tx.pure.u64(SOUND_FEE)])

    // Encode hook and body as vector<u8>
    const hookBytes = Array.from(new TextEncoder().encode(options.hook))
    const bodyBytes = Array.from(new TextEncoder().encode(options.body))

    // Attachment: Option<vector<u8>> → represented as vector<vector<u8>> via BCS
    //   None  → serialize([])
    //   Some(bytes) → serialize([[...bytes...]])
    // media_blob is Option<vector<u8>> in Move — encode as bcs option
    const attachmentBcs = options.attachment
      ? bcs.option(bcs.vector(bcs.u8())).serialize(
          Array.from(new TextEncoder().encode(options.attachment)),
        ).toBytes()
      : bcs.option(bcs.vector(bcs.u8())).serialize(null).toBytes()

    // cmd[1]: cast::sound  (v11 exact signature)
    // fee_coin, abyss, vessel(&mut), vessel_cap(&), hook, content_blob,
    // media_blob(Option), mode, recipient, duration, fee, max_claims,
    // dock_description, clock
    tx.moveCall({
      target:    `${contracts.package}::cast::sound`,
      arguments: [
        feeCoin,                                                  // [0]  Coin<USDC>
        tx.object(contracts.abyss),                              // [1]  &mut Abyss
        tx.object(vesselId),                                     // [2]  &mut Vessel
        tx.object(vesselCapId),                                  // [3]  &VesselCap
        tx.pure.vector('u8', hookBytes),                         // [4]  hook
        tx.pure.vector('u8', bodyBytes),                         // [5]  content_blob
        tx.pure(attachmentBcs),                                  // [6]  media_blob Option<vector<u8>>
        tx.pure.u8(MODE_U8[options.mode] ?? 0),                  // [7]  mode
        tx.pure.address(session.address),                        // [8]  recipient
        tx.pure.u8(durationToEpochs(options.duration ?? '24h')), // [9]  duration
        tx.pure.u64(toBaseUnits(options.price)),                 // [10] fee
        tx.pure.u64(1n),                                         // [11] max_claims: 1
        tx.pure.vector('u8', []),                                // [12] dock_description: empty
        tx.object(contracts.clock),                              // [13] &Clock
      ],
    })

    let digest: string
    try {
      const result = await signAndExecute(tx)
      digest = result.digest
    } catch (err) {
      throw new ConkError(
        `Publish transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    // ── Extract created Cast object from tx effects ───────────────────────────
    const txData = await suiClient.getTransactionBlock({
      digest,
      options: { showEffects: true, showObjectChanges: true },
    })

    const castChange = txData.objectChanges?.find(
      (c) =>
        c.type === 'created' &&
        (c as { objectType?: string }).objectType?.includes('::cast::Cast'),
    ) as { objectId?: string } | undefined

    if (!castChange?.objectId) {
      throw new ConkError(
        'Could not locate Cast object in transaction output',
        ConkErrorCode.TRANSACTION_FAILED,
        { digest },
      )
    }

    const result: CastResult = {
      id:          castChange.objectId,
      url:         `https://conk.app/cast/${castChange.objectId}`,
      txDigest:    digest,
      publishedAt: Date.now(),
    }

    return new Cast(result, suiClient)
  }

  // ─── Static: read a cast and pay ──────────────────────────────────────────

  /**
   * Build and execute a `cast::read` PTB.
   *
   * PTB layout (verified against on-chain ABI):
   *   cmd[0]: SplitCoins(usdcCoin, [castPrice])
   *   cmd[1]: MoveCall cast::read(
   *     &mut Cast,           // cast object to read
   *     NestedResult[0][0],  // Coin<USDC> payment
   *     &mut Abyss,
   *     readerAddress,
   *     &Clock,
   *   )
   *
   * @param session  Reader's zkLogin session (used for coin selection + address)
   */
  static async read(
    suiClient:      SuiClient,
    network:        Network,
    vesselId:       string,
    options:        ReadOptions,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
    session?:       ZkLoginSession,
  ): Promise<ReadResult> {
    const contracts = CONTRACTS[network]

    // ── Fetch cast's on-chain price ───────────────────────────────────────────
    const castObj = await suiClient.getObject({
      id:      options.castId,
      options: { showContent: true },
    })
    const castFields =
      (castObj.data?.content as { fields?: Record<string, unknown> })?.fields ?? {}
    const readPrice = BigInt((castFields.price as string | number | undefined) ?? 0)

    // ── Resolve reader identity ───────────────────────────────────────────────
    const readerAddress = session?.address ?? vesselId

    // Fetch reader's USDC coin
    const coinsResult = await suiClient.getCoins({
      owner:    readerAddress,
      coinType: USDC_TYPE,
    })
    if (!coinsResult.data.length) {
      throw new ConkError(
        'No USDC coins found for reader address',
        ConkErrorCode.INSUFFICIENT_BALANCE,
        { address: readerAddress },
      )
    }
    const usdcCoinId = coinsResult.data[0].coinObjectId

    // ── Build PTB ─────────────────────────────────────────────────────────────
    const tx = new Transaction()

    // cmd[0]: Split the cast's read price
    const [paymentCoin] = tx.splitCoins(tx.object(usdcCoinId), [tx.pure.u64(readPrice)])

    // cmd[1]: cast::read  (v11: ProtocolConfig added at position [3])
    tx.moveCall({
      target:    `${contracts.package}::cast::read`,
      arguments: [
        tx.object(options.castId),        // [0] &mut Cast
        paymentCoin,                       // [1] Coin<USDC>
        tx.object(contracts.abyss),        // [2] &mut Abyss
        tx.object(PROTOCOL_CONFIG_ID),     // [3] &ProtocolConfig (new in v11)
        tx.pure.address(readerAddress),    // [4] reader address
        tx.object(contracts.clock),        // [5] &Clock
      ],
    })

    let digest: string
    try {
      const result = await signAndExecute(tx)
      digest = result.digest
    } catch (err) {
      throw new ConkError(
        `Read transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    // ── Parse read event from tx ──────────────────────────────────────────────
    const txData = await suiClient.getTransactionBlock({
      digest,
      options: { showEffects: true, showEvents: true },
    })

    const readEvent = txData.events?.find(
      (e) => e.type?.includes('::cast::ReadEvent'),
    )

    const parsed = (readEvent?.parsedJson ?? {}) as Record<string, unknown>

    const receipt = await Receipt.fromTxDigest(suiClient, digest)

    return {
      castId:       options.castId,
      hook:         (parsed.hook as string)         ?? '',
      body:         (parsed.body as string)         ?? '',
      attachment:   (parsed.attachment as string)   ?? undefined,
      autoResponse: parsed.auto_response
        ? {
            hook:               (parsed.auto_response as Record<string, string>).hook ?? '',
            body:               (parsed.auto_response as Record<string, string>).body ?? '',
            triggerOnEveryRead: true,
          }
        : undefined,
      receipt,
    }
  }
}
