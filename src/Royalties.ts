/**
 * @axiomtide/conk-sdk — Royalties
 *
 * Split cast payment across multiple recipients at publish time.
 * Set once, automatic forever. No platform can change the terms.
 *
 * @example
 * import { RoyaltyBuilder } from '@axiomtide/conk-sdk'
 *
 * const split = new RoyaltyBuilder()
 *   .add('0xDirector...', 60, 'Director')
 *   .add('0xProducer...', 30, 'Producer')
 *   .add('0xDistrib...', 10, 'Distributor')
 *   .build()
 *
 * // Attach to a lighthouse publish
 * const cast = await beacon.publish({
 *   title:   'The Deep — Full Film',
 *   price:   5.00,
 *   royalties: split,
 *   ...
 * })
 *
 * // On every $5.00 purchase:
 * //   Director:    $2.91  (60% of $4.85)
 * //   Producer:    $1.455 (30% of $4.85)
 * //   Distributor: $0.485 (10% of $4.85)
 * //   Treasury:    $0.15  (3% always)
 */

import { ConkError, ConkErrorCode } from './types'
import { AUTHOR_SHARE, TREASURY_SHARE } from './config'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoyaltyRecipient {
  address: string
  /** Percentage of the author pool (must sum to 100 across all recipients) */
  share:   number
  label?:  string
}

export interface RoyaltySplit {
  recipients:  RoyaltyRecipient[]
  totalShares: number
}

export interface RoyaltyPayment {
  address: string
  amount:  number   // USDC base units
  share:   number   // percentage
  label?:  string
}

// ─── RoyaltyBuilder ───────────────────────────────────────────────────────────

export class RoyaltyBuilder {
  private recipients: RoyaltyRecipient[] = []

  add(address: string, share: number, label?: string): this {
    this.recipients.push({ address, share, label })
    return this
  }

  build(): RoyaltySplit {
    const split: RoyaltySplit = {
      recipients:  this.recipients,
      totalShares: this.recipients.reduce((sum, r) => sum + r.share, 0),
    }

    const validation = validateRoyaltySplit(split)
    if (!validation.valid) {
      throw new ConkError(
        validation.error ?? 'Invalid royalty split',
        ConkErrorCode.INVALID_CONFIG,
      )
    }

    return split
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateRoyaltySplit(split: RoyaltySplit): {
  valid:  boolean
  error?: string
} {
  if (!split.recipients.length) {
    return { valid: false, error: 'At least one recipient required' }
  }
  if (split.recipients.length > 10) {
    return { valid: false, error: 'Maximum 10 recipients' }
  }

  const total = split.recipients.reduce((sum, r) => sum + r.share, 0)
  if (total !== 100) {
    return { valid: false, error: `Shares must total 100% — currently ${total}%` }
  }

  for (const r of split.recipients) {
    if (r.share < 1) {
      return { valid: false, error: `Minimum share is 1%` }
    }
    if (!r.address || !/^0x[0-9a-fA-F]{64}$/.test(r.address)) {
      return { valid: false, error: `Invalid address: ${r.address}` }
    }
  }

  return { valid: true }
}

// ─── Payment calculation ──────────────────────────────────────────────────────

/**
 * Calculate individual payments for a given total amount.
 * Use this to preview what each recipient will receive before executing.
 */
export function calculateRoyaltyPayments(
  totalUsdc:   number,   // total price in USDC (e.g. 5.00)
  split:       RoyaltySplit,
): {
  treasury:   number
  recipients: RoyaltyPayment[]
  total:      number
} {
  const totalBaseUnits  = Math.round(totalUsdc * 1_000_000)
  const treasuryAmount  = Math.floor(totalBaseUnits * TREASURY_SHARE)
  const authorPool      = totalBaseUnits - treasuryAmount

  const payments: RoyaltyPayment[] = split.recipients.map(r => ({
    address: r.address,
    amount:  Math.floor(authorPool * (r.share / 100)),
    share:   r.share,
    label:   r.label,
  }))

  // Give rounding remainder to first recipient
  const allocated = payments.reduce((sum, p) => sum + p.amount, 0)
  const remainder = authorPool - allocated
  if (remainder > 0 && payments.length > 0) {
    payments[0].amount += remainder
  }

  return {
    treasury:   treasuryAmount,
    recipients: payments,
    total:      totalBaseUnits,
  }
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export function buildRoyaltyMetadata(split: RoyaltySplit): Record<string, unknown> {
  return {
    royalties: split.recipients.map(r => ({
      address: r.address,
      share:   r.share,
      label:   r.label ?? '',
    })),
  }
}

export function parseRoyaltyMetadata(body: string): RoyaltySplit | null {
  try {
    const match = body.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    if (!parsed.royalties) return null

    const recipients = (parsed.royalties as Array<{
      address: string
      share:   number
      label?:  string
    }>).map(r => ({ address: r.address, share: r.share, label: r.label }))

    return {
      recipients,
      totalShares: recipients.reduce((sum, r) => sum + r.share, 0),
    }
  } catch {
    return null
  }
}
