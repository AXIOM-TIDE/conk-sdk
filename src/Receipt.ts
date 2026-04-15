/**
 * @axiomtide/conk-sdk — Receipt
 * On-chain transaction verification and read-event subscription.
 *
 * Subscription strategy:
 *   1. Attempt WebSocket subscription via SuiClient.subscribeEvent()
 *   2. On WS failure or disconnect, fall back to polling with exponential backoff
 *   3. Polling uses cursor-based pagination — never re-processes the same event
 */

import { SuiClient }    from '@mysten/sui/client'
import { withRpcRetry } from './retry'
import { ConkError, ConkErrorCode } from './types'
import type {
  TransactionReceipt,
  ReadEvent,
  ReadEventCallback,
} from './types'

interface SubscriptionState {
  listeners:        ReadEventCallback[]
  unsubscribeWs:    (() => Promise<boolean | void>) | null
  pollingInterval:  ReturnType<typeof setInterval> | null
  eventCursor:      string | null
  pollMs:           number
  consecutiveFails: number
}

const MAX_CONSECUTIVE_FAILS = 5
const BACKOFF_MULTIPLIER    = 1.5
const MAX_POLL_MS           = 60_000

export class Receipt {
  private sub: SubscriptionState = {
    listeners:        [],
    unsubscribeWs:    null,
    pollingInterval:  null,
    eventCursor:      null,
    pollMs:           10_000,
    consecutiveFails: 0,
  }

  constructor(
    private readonly suiClient: SuiClient,
    private readonly castId:    string,
    private readonly txDigest:  string,
    private readonly amountCents: number,
  ) {}

  static async fromTxDigest(
    suiClient: SuiClient,
    txDigest:  string,
  ): Promise<TransactionReceipt> {
    const tx = await withRpcRetry(() =>
      suiClient.getTransactionBlock({
        digest:  txDigest,
        options: { showEffects: true, showEvents: true },
      }),
    ).catch(() => {
      throw new ConkError(
        `Transaction not found: ${txDigest}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { txDigest },
      )
    })

    if (tx.effects?.status?.status !== 'success') {
      throw new ConkError(
        `Transaction failed on-chain: ${tx.effects?.status?.error ?? 'unknown'}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { txDigest, status: tx.effects?.status },
      )
    }

    const readEvent = tx.events?.find((e) => e.type?.includes('::cast::ReadEvent'))
    const parsed    = (readEvent?.parsedJson ?? {}) as Record<string, string>

    return {
      txDigest,
      castId:    parsed.cast_id ?? '',
      amount:    Number(parsed.amount ?? 0),
      timestamp: tx.timestampMs ? Number(tx.timestampMs) : Date.now(),
      message:   parsed.message ?? undefined,
    }
  }

  toJSON(): TransactionReceipt {
    return {
      txDigest:  this.txDigest,
      castId:    this.castId,
      amount:    this.amountCents,
      timestamp: Date.now(),
    }
  }

  onRead(callback: ReadEventCallback, pollMs = 10_000): () => void {
    this.sub.listeners.push(callback)
    this.sub.pollMs = pollMs
    if (this.sub.listeners.length === 1) this.startSubscription()

    return () => {
      this.sub.listeners = this.sub.listeners.filter((l) => l !== callback)
      if (this.sub.listeners.length === 0) this.stopAll()
    }
  }

  private async startSubscription(): Promise<void> {
    try {
      const unsubscribe = await this.suiClient.subscribeEvent({
        filter:    { MoveEventType: `${this.castId}::cast::ReadEvent` },
        onMessage: (event) => this.handleEvent(event),
      })
      this.sub.unsubscribeWs    = unsubscribe
      this.sub.consecutiveFails = 0
    } catch {
      this.startPolling()
    }
  }

  private startPolling(): void {
    if (this.sub.pollingInterval) return
    this.sub.pollingInterval = setInterval(() => this.pollReadEvents(), this.sub.pollMs)
  }

  private stopPolling(): void {
    if (this.sub.pollingInterval) {
      clearInterval(this.sub.pollingInterval)
      this.sub.pollingInterval = null
    }
  }

  private async pollReadEvents(): Promise<void> {
    try {
      const events = await withRpcRetry(() =>
        this.suiClient.queryEvents({
          query:  { MoveEventType: `${this.castId}::cast::ReadEvent` },
          cursor: this.sub.eventCursor
            ? { txDigest: this.sub.eventCursor, eventSeq: '0' }
            : undefined,
          limit:  50,
          order:  'ascending',
        }),
      )

      if (events.data.length > 0) {
        this.sub.eventCursor = events.data[events.data.length - 1].id.txDigest
      }

      for (const event of events.data) this.handleEvent(event)

      this.sub.consecutiveFails = 0
      this.sub.pollMs = Math.max(this.sub.pollMs / BACKOFF_MULTIPLIER, 10_000)

    } catch {
      this.sub.consecutiveFails++
      if (this.sub.consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        this.sub.pollMs = Math.min(this.sub.pollMs * BACKOFF_MULTIPLIER, MAX_POLL_MS)
        this.stopPolling()
        this.startPolling()
      }
    }
  }

  private handleEvent(event: {
    id:          { txDigest: string }
    parsedJson?: unknown
    timestampMs?: string | number | null
  }): void {
    const parsed = (event.parsedJson ?? {}) as Record<string, unknown>
    const readEvent: ReadEvent = {
      castId:    this.castId,
      amount:    Number(parsed.amount ?? 0),
      txDigest:  event.id.txDigest,
      timestamp: Number(event.timestampMs ?? Date.now()),
      message:   parsed.message as string | undefined,
    }
    for (const listener of this.sub.listeners) {
      try { listener(readEvent) } catch { /* never crash the subscription */ }
    }
  }

  private stopAll(): void {
    this.stopPolling()
    if (this.sub.unsubscribeWs) {
      this.sub.unsubscribeWs().catch(() => {})
      this.sub.unsubscribeWs = null
    }
  }

  destroy(): void {
    this.sub.listeners = []
    this.stopAll()
  }
}
