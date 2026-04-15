/**
 * @axiomtide/conk-sdk — Retry
 * Exponential backoff with jitter for RPC calls and transaction execution.
 */

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?:  number
  maxDelayMs?:   number
  factor?:       number
  /** Return true to abort immediately without retrying */
  shouldAbort?: (err: unknown) => boolean
}

const DEFAULT: Required<RetryOptions> = {
  maxAttempts: 4,
  baseDelayMs: 300,
  maxDelayMs:  8_000,
  factor:      2.5,
  shouldAbort: () => false,
}

/**
 * Execute `fn` with exponential backoff + full jitter.
 *
 * Delay formula: min(maxDelay, base * factor^attempt) * random(0.5, 1.0)
 * This avoids thundering-herd on shared RPC nodes.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const cfg = { ...DEFAULT, ...options }
  let lastError: unknown

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err

      if (cfg.shouldAbort(err)) throw err
      if (attempt === cfg.maxAttempts - 1) break

      const exponential = cfg.baseDelayMs * Math.pow(cfg.factor, attempt)
      const capped       = Math.min(exponential, cfg.maxDelayMs)
      const jittered     = capped * (0.5 + Math.random() * 0.5)

      await sleep(jittered)
    }
  }

  throw lastError
}

/**
 * Retry specifically for Sui RPC calls.
 * Aborts immediately on non-retryable errors (bad Move call, out of gas).
 */
export async function withRpcRetry<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
  return withRetry(fn, {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs:  6_000,
    shouldAbort: isNonRetryable,
  })
}

/**
 * Retry for transaction execution.
 * Faster cadence — we want to re-submit quickly on transient failures.
 */
export async function withTxRetry<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
  return withRetry(fn, {
    maxAttempts: 3,
    baseDelayMs: 200,
    maxDelayMs:  2_000,
    shouldAbort: isNonRetryable,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Errors that should never be retried — they won't change on retry */
function isNonRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('insufficient gas')          ||
    msg.includes('move abort')                ||
    msg.includes('invalid object')            ||
    msg.includes('object not found')          ||
    msg.includes('equivocation')              ||
    msg.includes('already exists')            ||
    msg.includes('invalid params')
  )
}
