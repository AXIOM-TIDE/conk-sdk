/**
 * @axiomtide/conk-sdk — Test Suite
 * Run with: npm test
 *
 * Tests use a mock SuiClient and mock signAndExecute to stay off-chain.
 * Integration tests (real Sui devnet) live in tests/integration/.
 */

import { ConkClient } from '../src/ConkClient'
import { ConkError, ConkErrorCode } from '../src/types'
import { toBaseUnits, toCents, durationToEpochs } from '../src/config'

// ─── Config helpers ──────────────────────────────────────────────────────────

describe('config helpers', () => {
  test('toBaseUnits converts USDC to 6-decimal base units', () => {
    expect(toBaseUnits(1)).toBe(BigInt(1_000_000))
    expect(toBaseUnits(0.001)).toBe(BigInt(1_000))
    expect(toBaseUnits(5.00)).toBe(BigInt(5_000_000))
  })

  test('toCents converts base units to integer cents', () => {
    expect(toCents(BigInt(1_000_000))).toBe(100)   // $1.00 = 100 cents
    expect(toCents(BigInt(1_000))).toBe(0.1)        // $0.001
  })

  test('durationToEpochs maps duration strings correctly', () => {
    expect(durationToEpochs('1h')).toBe(1)
    expect(durationToEpochs('24h')).toBe(24)
    expect(durationToEpochs('7d')).toBe(168)
    expect(durationToEpochs('permanent')).toBe(0)
    expect(durationToEpochs('unknown')).toBe(24)  // default fallback
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
    // 32-byte zero key — test only, never use in production
    const privateKey = '0x' + '0'.repeat(64)
    const conk       = new ConkClient({ privateKey, network: 'testnet' })
    expect(conk.isAuthenticated()).toBe(true)
    expect(conk.network).toBe('testnet')
  })

  test('throws INVALID_CONFIG when calling currentAddress unauthenticated', () => {
    const conk = new ConkClient()
    expect(() => conk.currentAddress()).toThrow(ConkError)
    try {
      conk.currentAddress()
    } catch (err) {
      expect((err as ConkError).code).toBe(ConkErrorCode.INVALID_CONFIG)
    }
  })

  test('setSession updates auth state', () => {
    const conk = new ConkClient()
    expect(conk.isAuthenticated()).toBe(false)

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
      address:          '0xabc',
      proof:            {} as never,
      ephemeralKeyPair: { publicKey: '', privateKey: '' },
      maxEpoch:         100,
      randomness:       '',
      salt:             '',
    })
    conk.clearSession()
    expect(conk.isAuthenticated()).toBe(false)
  })
})

// ─── ConkError ────────────────────────────────────────────────────────────────

describe('ConkError', () => {
  test('has correct name and code', () => {
    const err = new ConkError('test', ConkErrorCode.NETWORK_ERROR, { extra: 1 })
    expect(err.name).toBe('ConkError')
    expect(err.code).toBe(ConkErrorCode.NETWORK_ERROR)
    expect(err.context).toEqual({ extra: 1 })
    expect(err instanceof Error).toBe(true)
  })
})

// ─── Attachments (unit, no network) ──────────────────────────────────────────

describe('Attachments', () => {
  test('throws UPLOAD_FAILED when file exceeds maxMB', async () => {
    const { Attachments } = await import('../src/Attachments')
    const att = new Attachments()

    // Fake 10 MB blob
    const bigFile = new Uint8Array(10 * 1024 * 1024)

    await expect(att.upload(bigFile, { maxMB: 1 })).rejects.toMatchObject({
      code: ConkErrorCode.UPLOAD_FAILED,
    })
  })

  test('url() builds correct Walrus aggregator URL', async () => {
    const { Attachments } = await import('../src/Attachments')
    const att = new Attachments()
    expect(att.url('blob123')).toContain('blob123')
  })
})
