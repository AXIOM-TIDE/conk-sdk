/**
 * @axiomtide/conk-sdk — Cast
 * Publish content casts and read them with micropayments.
 *
 * NOTE: The PTB (Programmable Transaction Block) construction calls below
 * reference move_call targets against the CONK package. Slot in the exact
 * module::function names from client.ts once extracted.
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient }   from '@mysten/sui/client'
import { Receipt }     from './Receipt'
import { CONTRACTS, toBaseUnits, durationToEpochs } from './config'
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

export class Cast {
  readonly id:     string
  readonly url:    string
  readonly txDigest: string
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

  static async publish(
    suiClient:   SuiClient,
    network:     Network,
    session:     ZkLoginSession,
    vesselId:    string,
    options:     PublishOptions,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
  ): Promise<Cast> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    // TODO: slot exact module path from client.ts
    tx.moveCall({
      target:    `${contracts.package}::cast::sound`,
      arguments: [
        tx.pure.string(options.hook),
        tx.pure.string(options.body),
        tx.pure.u64(toBaseUnits(options.price)),
        tx.pure.string(options.mode),
        tx.pure.u64(durationToEpochs(options.duration ?? '24h')),
        tx.pure.string(options.attachment ?? ''),
        // Auto-response fields
        tx.pure.bool(!!options.autoResponse),
        tx.pure.string(options.autoResponse?.hook ?? ''),
        tx.pure.string(options.autoResponse?.body ?? ''),
        tx.pure.bool(options.autoResponse?.triggerOnEveryRead ?? false),
        tx.object(vesselId),
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

    // Fetch published cast object ID from tx effects
    const txData = await suiClient.getTransactionBlock({
      digest,
      options: { showEffects: true, showObjectChanges: true },
    })

    const castObjectId = txData.objectChanges?.find(
      (c) => c.type === 'created' && (c as { objectType?: string }).objectType?.includes('::cast::Cast'),
    ) as { objectId?: string } | undefined

    if (!castObjectId?.objectId) {
      throw new ConkError(
        'Could not locate Cast object in transaction output',
        ConkErrorCode.TRANSACTION_FAILED,
        { digest },
      )
    }

    const result: CastResult = {
      id:          castObjectId.objectId,
      url:         `https://conk.app/cast/${castObjectId.objectId}`,
      txDigest:    digest,
      publishedAt: Date.now(),
    }

    return new Cast(result, suiClient)
  }

  // ─── Static: read a cast and pay ──────────────────────────────────────────
  //
  // Reading a cast is a USDC transfer — matches crossPaywall() in client.ts.
  // 97% goes to the author, 3% to the protocol treasury.
  //
  static async read(
    suiClient:      SuiClient,
    network:        Network,
    vesselId:       string,
    options:        ReadOptions,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
  ): Promise<ReadResult> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()
    void vesselId   // vessel identity used for auth — payment handled by signer

    // Payment is a direct USDC split transfer (no Move call needed)
    // The signAndExecute function handles coin selection and splitting
    // matching crossPaywall() in apps/conk/src/sui/client.ts

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

    // Fetch cast content and receipt from tx events
    const txData = await suiClient.getTransactionBlock({
      digest,
      options: { showEffects: true, showEvents: true },
    })

    const readEvent = txData.events?.find(
      (e) => e.type?.includes('::cast::ReadResult'),
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
            hook:                 (parsed.auto_response as Record<string, string>).hook  ?? '',
            body:                 (parsed.auto_response as Record<string, string>).body  ?? '',
            triggerOnEveryRead:   true,
          }
        : undefined,
      receipt,
    }
  }
}
