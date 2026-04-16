/**
 * @axiomtide/conk-sdk — RateLimiter
 * Token bucket rate limiter for daemon transaction throughput.
 *
 * Prevents Agent Spark daemons from accidentally flooding the network
 * or burning through a Harbor balance faster than intended.
 *
 * Two limiters work together:
 *   1. TxRateLimiter  — max transactions per minute
 *   2. SpendRateLimiter — max USDC spend per time window
 */

import { ConkError, ConkErrorCode } from './types'

// ─── Token Bucket ─────────────────────────────────────────────────────────────

class TokenBucket {
  private tokens:       number
  private lastRefillMs: number

  constructor(
    private readonly capacity:     number,
    private readonly refillRate:   number,   // tokens per ms
    private readonly refillEveryMs: number,
  ) {
    this.tokens       = capacity
    this.lastRefillMs = Date.now()
  }

  /**
   * Try to consume `count` tokens.
   * Returns true if consumed, false if rate limit exceeded.
   */
  tryConsume(count = 1): boolean {
    this.refill()
    if (this.tokens >= count) {
      this.tokens -= count
      return true
    }
    return false
  }

  /**
   * Consume tokens, waiting if necessary.
   */
  async consume(count = 1): Promise<void> {
    while (!this.tryConsume(count)) {
      await sleep(this.refillEveryMs / this.capacity)
    }
  }

  /** Milliseconds until `count` tokens are available */
  msUntilAvailable(count = 1): number {
    this.refill()
    if (this.tokens >= count) return 0
    const needed = count - this.tokens
    return Math.ceil(needed / this.refillRate)
  }

  get available(): number {
    this.refill()
    return Math.floor(this.tokens)
  }

  private refill(): void {
    const now     = Date.now()
    const elapsed = now - this.lastRefillMs
    const refill  = elapsed * this.refillRate
    this.tokens        = Math.min(this.capacity, this.tokens + refill)
    this.lastRefillMs  = now
  }
}

// ─── Transaction Rate Limiter ─────────────────────────────────────────────────

export interface TxRateLimitConfig {
  /** Max transactions per minute (default: 10) */
  maxTxPerMinute?: number
  /** Max burst — transactions that can fire immediately (default: 3) */
  burstSize?: number
}

export class TxRateLimiter {
  private bucket: TokenBucket

  constructor(config: TxRateLimitConfig = {}) {
    const maxPerMin = config.maxTxPerMinute ?? 10
    const burst     = config.burstSize      ?? 3

    this.bucket = new TokenBucket(
      burst,
      maxPerMin / 60_000,  // tokens per ms
      60_000 / maxPerMin,  // refill interval
    )
  }

  /**
   * Call before every transaction. Waits if rate limit is active.
   */
  async throttle(): Promise<void> {
    await this.bucket.consume(1)
  }

  /**
   * Check without waiting. Throws if limit exceeded.
   */
  checkOrThrow(): void {
    if (!this.bucket.tryConsume(1)) {
      const waitMs = this.bucket.msUntilAvailable(1)
      throw new ConkError(
        `Transaction rate limit exceeded. Try again in ${Math.ceil(waitMs / 1000)}s`,
        ConkErrorCode.NETWORK_ERROR,
        { waitMs },
      )
    }
  }

  get availableTokens(): number {
    return this.bucket.available
  }
}

// ─── Spend Rate Limiter ───────────────────────────────────────────────────────

export interface SpendLimitConfig {
  /** Max USDC spend in cents per window (default: 1000 = $10) */
  maxCentsPerWindow?: number
  /** Window duration in ms (default: 3_600_000 = 1 hour) */
  windowMs?: number
}

export class SpendRateLimiter {
  private spentCents: number   = 0
  private windowStart: number  = Date.now()
  private readonly maxCents:   number
  private readonly windowMs:   number

  constructor(config: SpendLimitConfig = {}) {
    this.maxCents = config.maxCentsPerWindow ?? 1_000
    this.windowMs = config.windowMs          ?? 3_600_000
  }

  /**
   * Record a spend. Throws if it would exceed the window limit.
   */
  recordSpend(amountCents: number): void {
    this.maybeResetWindow()

    if (this.spentCents + amountCents > this.maxCents) {
      const remaining   = this.maxCents - this.spentCents
      const resetInMs   = this.windowMs - (Date.now() - this.windowStart)
      const resetInSecs = Math.ceil(resetInMs / 1000)

      throw new ConkError(
        `Spend limit exceeded. Remaining: $${(remaining / 100).toFixed(2)}. ` +
        `Resets in ${resetInSecs}s`,
        ConkErrorCode.SPENDING_CAP_EXCEEDED,
        { spentCents: this.spentCents, maxCents: this.maxCents, remaining },
      )
    }

    this.spentCents += amountCents
  }

  get remainingCents(): number {
    this.maybeResetWindow()
    return this.maxCents - this.spentCents
  }

  get spentThisWindow(): number {
    this.maybeResetWindow()
    return this.spentCents
  }

  private maybeResetWindow(): void {
    if (Date.now() - this.windowStart >= this.windowMs) {
      this.spentCents  = 0
      this.windowStart = Date.now()
    }
  }
}

// ─── Combined limiter for daemon use ─────────────────────────────────────────

export interface DaemonLimiterConfig extends TxRateLimitConfig, SpendLimitConfig {}

export class DaemonLimiter {
  readonly tx:    TxRateLimiter
  readonly spend: SpendRateLimiter

  constructor(config: DaemonLimiterConfig = {}) {
    this.tx    = new TxRateLimiter(config)
    this.spend = new SpendRateLimiter(config)
  }

  /**
   * Call before every transaction that involves a payment.
   * Checks both rate limit and spend limit.
   */
  async checkAndRecord(amountCents: number): Promise<void> {
    this.spend.recordSpend(amountCents)  // throws if over spend limit
    await this.tx.throttle()             // waits if over tx rate limit
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
