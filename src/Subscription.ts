/**
 * @axiomtide/conk-sdk — Subscription
 *
 * Subscribe to a Vessel. Pay once per period.
 * Get access to everything that vessel publishes.
 *
 * @example
 * const sub = new SubscriptionClient(conk)
 *
 * // Subscribe to a filmmaker's beacon
 * const result = await sub.subscribe(buyerVessel, {
 *   vesselId:  filmmakerVesselId,
 *   interval:  'monthly',
 *   priceUsdc: 0.50,
 * })
 *
 * // Check if still active
 * const active = sub.isActive(filmmakerVesselId)
 *
 * // Cancel
 * await sub.cancel(result.subscriptionId)
 */

import { ConkError, ConkErrorCode } from './types'
import type { Vessel }     from './Vessel'
import type { ConkClient } from './ConkClient'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionInterval = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface SubscribeOptions {
  /** Vessel ID to subscribe to */
  vesselId:   string
  /** Billing interval */
  interval:   SubscriptionInterval
  /** Price in USDC per period (e.g. 0.50 = $0.50/month) */
  priceUsdc:  number
  /** Optional display name for the vessel */
  displayName?: string
}

export interface SubscriptionResult {
  subscriptionId: string
  vesselId:       string
  interval:       SubscriptionInterval
  priceUsdc:      number
  startedAt:      number
  renewsAt:       number
  txDigest:       string
}

export interface SubscriptionRecord extends SubscriptionResult {
  active:       boolean
  subscriberId: string
}

// ─── Period lengths ───────────────────────────────────────────────────────────

export const INTERVAL_MS: Record<SubscriptionInterval, number> = {
  daily:   86_400_000,
  weekly:  604_800_000,
  monthly: 2_592_000_000,
  yearly:  31_536_000_000,
}

export const INTERVAL_LABEL: Record<SubscriptionInterval, string> = {
  daily:   '/day',
  weekly:  '/week',
  monthly: '/mo',
  yearly:  '/yr',
}

// ─── SubscriptionClient ───────────────────────────────────────────────────────

export class SubscriptionClient {
  private records: Map<string, SubscriptionRecord> = new Map()

  constructor(private readonly conk: ConkClient) {}

  // ─── Subscribe ────────────────────────────────────────────────────────────

  async subscribe(
    buyerVessel: Vessel,
    options:     SubscribeOptions,
  ): Promise<SubscriptionResult> {
    if (options.priceUsdc <= 0) {
      throw new ConkError(
        'Subscription price must be greater than 0',
        ConkErrorCode.INVALID_CONFIG,
      )
    }

    // Check not already subscribed
    const existing = this.getActiveSubscription(options.vesselId)
    if (existing) {
      throw new ConkError(
        `Already subscribed to ${options.vesselId} — renews ${new Date(existing.renewsAt).toLocaleDateString()}`,
        ConkErrorCode.INVALID_CONFIG,
        { subscriptionId: existing.subscriptionId },
      )
    }

    // Execute payment — author gets 97%, treasury gets 3%
    const readResult = await buyerVessel.read({
      castId:  `sub_${options.vesselId}`,
      message: `subscription:${options.interval}:${options.priceUsdc}`,
    })

    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const now            = Date.now()

    const result: SubscriptionResult = {
      subscriptionId,
      vesselId:   options.vesselId,
      interval:   options.interval,
      priceUsdc:  options.priceUsdc,
      startedAt:  now,
      renewsAt:   now + INTERVAL_MS[options.interval],
      txDigest:   readResult.receipt.txDigest,
    }

    this.records.set(subscriptionId, {
      ...result,
      active:       true,
      subscriberId: buyerVessel.id(),
    })

    return result
  }

  // ─── Renew ────────────────────────────────────────────────────────────────

  async renew(
    buyerVessel:    Vessel,
    subscriptionId: string,
  ): Promise<SubscriptionResult> {
    const record = this.records.get(subscriptionId)
    if (!record) {
      throw new ConkError(
        `Subscription ${subscriptionId} not found`,
        ConkErrorCode.CAST_NOT_FOUND,
      )
    }

    const readResult = await buyerVessel.read({
      castId:  `sub_${record.vesselId}`,
      message: `renew:${record.interval}:${record.priceUsdc}`,
    })

    const renewed: SubscriptionRecord = {
      ...record,
      renewsAt: Date.now() + INTERVAL_MS[record.interval],
      txDigest: readResult.receipt.txDigest,
      active:   true,
    }

    this.records.set(subscriptionId, renewed)

    return {
      subscriptionId: record.subscriptionId,
      vesselId:       record.vesselId,
      interval:       record.interval,
      priceUsdc:      record.priceUsdc,
      startedAt:      record.startedAt,
      renewsAt:       renewed.renewsAt,
      txDigest:       renewed.txDigest,
    }
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  cancel(subscriptionId: string): void {
    const record = this.records.get(subscriptionId)
    if (!record) return
    this.records.set(subscriptionId, { ...record, active: false })
  }

  // ─── Check ────────────────────────────────────────────────────────────────

  isActive(vesselId: string): boolean {
    return !!this.getActiveSubscription(vesselId)
  }

  getActiveSubscription(vesselId: string): SubscriptionRecord | null {
    for (const record of this.records.values()) {
      if (
        record.vesselId === vesselId &&
        record.active &&
        record.renewsAt > Date.now()
      ) {
        return record
      }
    }
    return null
  }

  listSubscriptions(): SubscriptionRecord[] {
    return Array.from(this.records.values()).filter(r => r.active)
  }

  allSubscriptions(): SubscriptionRecord[] {
    return Array.from(this.records.values())
  }

  // ─── Price helpers ────────────────────────────────────────────────────────

  static formatPrice(priceUsdc: number, interval: SubscriptionInterval): string {
    return `$${priceUsdc.toFixed(2)}${INTERVAL_LABEL[interval]}`
  }

  static annualCost(priceUsdc: number, interval: SubscriptionInterval): number {
    const periodsPerYear = {
      daily:   365,
      weekly:  52,
      monthly: 12,
      yearly:  1,
    }[interval]
    return priceUsdc * periodsPerYear
  }
}
