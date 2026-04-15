/**
 * @axiomtide/conk-sdk — Receipt
 * On-chain transaction verification and read-event subscription.
 */

import { SuiClient } from '@mysten/sui/client'
import type {
  TransactionReceipt,
  ReadEvent,
  ReadEventCallback,
} from './types'
import { ConkError, ConkErrorCode } from './types'

export class Receipt {
  private listeners: ReadEventCallback[] = []
  private pollingInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly suiClient: SuiClient,
    private readonly castId: string,
    private readonly txDigest: string,
    private readonly amountCents: number,
  ) {}

  // ─── Static factory — verify a tx digest on-chain ─────────────────────────

  static async fromTxDigest(
    suiClient: SuiClient,
    txDigest: string,
  ): Promise<TransactionReceipt> {
    let tx: Awaited<ReturnType<typeof suiClient.getTransactionBlock>>

    try {
      tx = await suiClient.getTransactionBlock({
        digest: txDigest,
        options: { showEffects: true, showEvents: true },
      })
    } catch {
      throw new ConkError(
        `Transaction not found: ${txDigest}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { txDigest },
      )
    }

    if (tx.effects?.status?.status !== 'success') {
      throw new ConkError(
        `Transaction failed on-chain: ${tx.effects?.status?.error ?? 'unknown'}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { txDigest, status: tx.effects?.status },
      )
    }

    // Extract CONK-specific event data from tx events
    const readEvent = tx.events?.find(
      (e) => e.type?.includes('::cast::ReadEvent'),
    )

    return {
      txDigest,
      castId:      readEvent?.parsedJson
        ? (readEvent.parsedJson as Record<string, string>).cast_id ?? ''
        : '',
      amount:      readEvent?.parsedJson
        ? Number((readEvent.parsedJson as Record<string, string>).amount ?? 0)
        : 0,
      timestamp:   tx.timestampMs ? Number(tx.timestampMs) : Date.now(),
      message:     readEvent?.parsedJson
        ? (readEvent.parsedJson as Record<string, string>).message
        : undefined,
    }
  }

  // ─── Instance receipt data ────────────────────────────────────────────────

  toJSON(): TransactionReceipt {
    return {
      txDigest:  this.txDigest,
      castId:    this.castId,
      amount:    this.amountCents,
      timestamp: Date.now(),
    }
  }

  // ─── Event subscription ───────────────────────────────────────────────────

  /**
   * Subscribe to incoming read events for this cast.
   * Polls the Sui event stream every 10 seconds.
   */
  onRead(callback: ReadEventCallback, pollMs = 10_000): () => void {
    this.listeners.push(callback)

    if (!this.pollingInterval) {
      this.pollingInterval = setInterval(
        () => this.pollReadEvents(),
        pollMs,
      )
    }

    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback)
      if (this.listeners.length === 0 && this.pollingInterval) {
        clearInterval(this.pollingInterval)
        this.pollingInterval = null
      }
    }
  }

  private async pollReadEvents(): Promise<void> {
    try {
      const events = await this.suiClient.queryEvents({
        query: {
          MoveEventType: `${this.castId}::cast::ReadEvent`,
        },
        limit: 50,
        order: 'descending',
      })

      for (const event of events.data) {
        const parsed = event.parsedJson as Record<string, unknown> | undefined
        if (!parsed) continue

        const readEvent: ReadEvent = {
          castId:    this.castId,
          amount:    Number(parsed.amount ?? 0),
          txDigest:  event.id.txDigest,
          timestamp: Number(event.timestampMs ?? Date.now()),
          message:   parsed.message as string | undefined,
        }

        for (const listener of this.listeners) {
          listener(readEvent)
        }
      }
    } catch {
      // Polling errors are silent — don't crash daemon loops
    }
  }

  destroy(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
    this.listeners = []
  }
}
