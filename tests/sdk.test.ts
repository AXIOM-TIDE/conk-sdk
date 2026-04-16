/**
 * @axiomtide/conk-sdk — Test Suite
 */

import { ConkClient }           from '../src/ConkClient'
import { ConkError, ConkErrorCode } from '../src/types'
import { toBaseUnits, toCents, durationToEpochs } from '../src/config'
import { withRetry }            from '../src/retry'

// ─── Config helpers ──────────────────────────────────────────────────────────

describe('config helpers', () => {
  test('toBaseUnits converts USDC to 6-decimal base units', () => {
    expect(toBaseUnits(1)).toBe(BigInt(1_000_000))
    expect(toBaseUnits(0.001)).toBe(BigInt(1_000))
    expect(toBaseUnits(5.00)).toBe(BigInt(5_000_000))
  })

  test('toCents converts base units to integer cents', () => {
    expect(toCents(BigInt(1_000_000))).toBe(100)
    expect(toCents(BigInt(1_000))).toBe(0.1)
  })

  test('durationToEpochs maps duration strings correctly', () => {
    expect(durationToEpochs('1h')).toBe(0)
    expect(durationToEpochs('24h')).toBe(1)
    expect(durationToEpochs('7d')).toBe(2)
    expect(durationToEpochs('permanent')).toBe(255)
    expect(durationToEpochs('unknown')).toBe(1)
  })
})

// ─── Retry ────────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  test('returns immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('retries on failure and succeeds on second attempt', async () => {
    let calls = 0
    const fn  = jest.fn().mockImplementation(async () => {
      calls++
      if (calls < 2) throw new Error('transient')
      return 'recovered'
    })
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test('throws after maxAttempts exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'))
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    ).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('aborts immediately when shouldAbort returns true', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('move abort'))
    await expect(
      withRetry(fn, {
        maxAttempts:  5,
        baseDelayMs:  1,
        shouldAbort: (e) => (e instanceof Error && e.message.includes('move abort')),
      })
    ).rejects.toThrow('move abort')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ─── ConkClient ───────────────────────────────────────────────────────────────

describe('ConkClient', () => {
  test('initialises with default config', () => {
    const conk = new ConkClient()
    expect(conk.network).toBe('mainnet')
    expect(conk.proxyUrl).toContain('workers.dev')
    expect(conk.isAuthenticated()).toBe(false)
  })

  test('initialises with private key (daemon mode)', () => {
    const privateKey = '0x' + '0'.repeat(64)
    const conk       = new ConkClient({ privateKey, network: 'testnet' })
    expect(conk.isAuthenticated()).toBe(true)
    expect(conk.network).toBe('testnet')
  })

  test('throws INVALID_CONFIG when calling currentAddress unauthenticated', () => {
    const conk = new ConkClient()
    try {
      conk.currentAddress()
      fail('should have thrown')
    } catch (err) {
      expect((err as ConkError).code).toBe(ConkErrorCode.INVALID_CONFIG)
    }
  })

  test('setSession updates auth state', () => {
    const conk = new ConkClient()
    conk.setSession({
      address:          '0xabc',
      proof:            {} as never,
      ephemeralKeyPair: { publicKey: '', privateKey: '' },
      maxEpoch:         100,
      randomness:       'rand',
      salt:             'salt',
    })
    expect(conk.isAuthenticated()).toBe(true)
    expect(conk.currentAddress()).toBe('0xabc')
  })

  test('clearSession removes auth', () => {
    const conk = new ConkClient()
    conk.setSession({
      address: '0xabc', proof: {} as never,
      ephemeralKeyPair: { publicKey: '', privateKey: '' },
      maxEpoch: 100, randomness: '', salt: '',
    })
    conk.clearSession()
    expect(conk.isAuthenticated()).toBe(false)
  })
})

// ─── ConkError ────────────────────────────────────────────────────────────────

describe('ConkError', () => {
  test('has correct name, code, and context', () => {
    const err = new ConkError('test', ConkErrorCode.NETWORK_ERROR, { extra: 1 })
    expect(err.name).toBe('ConkError')
    expect(err.code).toBe(ConkErrorCode.NETWORK_ERROR)
    expect(err.context).toEqual({ extra: 1 })
    expect(err instanceof Error).toBe(true)
  })

  test('all error codes are defined', () => {
    const codes = Object.values(ConkErrorCode)
    expect(codes.length).toBeGreaterThan(5)
    expect(codes).toContain('INSUFFICIENT_FUEL')
    expect(codes).toContain('TRANSACTION_FAILED')
    expect(codes).toContain('SPENDING_CAP_EXCEEDED')
  })
})

// ─── Attachments ─────────────────────────────────────────────────────────────

describe('Attachments', () => {
  test('throws UPLOAD_FAILED when file exceeds maxMB', async () => {
    const { Attachments } = await import('../src/Attachments')
    const att = new Attachments()
    const bigFile = new Uint8Array(10 * 1024 * 1024)
    await expect(att.upload(bigFile, { maxMB: 1 })).rejects.toMatchObject({
      code: ConkErrorCode.UPLOAD_FAILED,
    })
  })

  test('url() builds correct Walrus aggregator URL', async () => {
    const { Attachments } = await import('../src/Attachments')
    const att = new Attachments()
    const url = att.url('blob123')
    expect(url).toContain('blob123')
    expect(url).toContain('walrus')
  })

  test('url() returns different URLs for different blobIds', async () => {
    const { Attachments } = await import('../src/Attachments')
    const att = new Attachments()
    expect(att.url('blob-a')).not.toBe(att.url('blob-b'))
  })
})
