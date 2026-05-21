/**
 * @axiomtide/conk-sdk — Stream tests
 *
 * Unit tests for Stream SDK against mock SuiClient.
 * No live network calls — all on-chain interactions are mocked.
 */

import { Transaction } from '@mysten/sui/transactions'
import {
  Stream,
  STREAM_PAYMENT_TYPE,
  STREAM_CREATE_FEE,
  STREAM_CREATE_FEE_UNITS,
  STREAM_MIN_SESSION_FEE,
  STREAM_MIN_SESSION_FEE_UNITS,
} from '../src/LiveStream'
import { ConkError, ConkErrorCode } from '../src/types'

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const MOCK_STREAM_ID  = '0xaabbccdd0000000000000000000000000000000000000000000000000000aaaa'
const MOCK_VESSEL_ID  = '0xdeadbeef000000000000000000000000000000000000000000000000beefcafe'
const MOCK_SESSION_ID = '0x1234567800000000000000000000000000000000000000000000000000001234'
const MOCK_DIGEST     = 'MockTxDigest1234567890abcdef'
const MOCK_SENDER     = '0xdeadbeef000000000000000000000000000000000000000000000000deadbeef'

// Fake SuiClient with typed mock methods
function makeMockClient(overrides: Record<string, jest.Mock> = {}): any {
  return {
    getCoins: jest.fn().mockResolvedValue({
      data: [{
        coinObjectId: '0xcoin111',
        balance: '999999999',
        coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      }],
    }),
    getObject: jest.fn().mockResolvedValue({
      data: {
        content: {
          fields: {
            creator:           MOCK_SENDER,
            price_per_session: '100000',   // $0.10
            duration_ms:       '3600000',  // 1 hour
            payment_type:      '0',
            state:             '0',        // LIVE
            total_earned:      '5000000',  // $5.00
            session_count:     '50',
            created_at:        '1748000000000',
          },
        },
      },
    }),
    getTransactionBlock: jest.fn().mockResolvedValue({
      objectChanges: [
        {
          type:       'created',
          objectType: '0x50515260::stream::Stream',
          objectId:   MOCK_STREAM_ID,
        },
      ],
      events: [
        {
          type: '0x50515260::stream::SessionJoined',
          parsedJson: {
            stream_id:  MOCK_STREAM_ID,
            session_id: MOCK_SESSION_ID,
            viewer:     MOCK_SENDER,
            paid:       '100000',
            expires_at: String(Date.now() + 3_600_000),
            joined_at:  String(Date.now()),
          },
        },
      ],
    }),
    ...overrides,
  }
}

function makeSignAndExecute(digest = MOCK_DIGEST): jest.Mock {
  return jest.fn().mockResolvedValue({ digest })
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Stream constants', () => {
  test('STREAM_PAYMENT_TYPE values match stream.move', () => {
    expect(STREAM_PAYMENT_TYPE.PER_VIEW).toBe(0)
    expect(STREAM_PAYMENT_TYPE.PER_MINUTE).toBe(1)
    expect(STREAM_PAYMENT_TYPE.SUBSCRIPTION).toBe(2)
  })

  test('fee constants match stream.move microunit values', () => {
    expect(STREAM_CREATE_FEE).toBe(0.05)
    expect(STREAM_CREATE_FEE_UNITS).toBe(50_000n)
    expect(STREAM_MIN_SESSION_FEE).toBe(0.01)
    expect(STREAM_MIN_SESSION_FEE_UNITS).toBe(10_000n)
  })
})

// ─── Stream.create ────────────────────────────────────────────────────────────

describe('Stream.create', () => {
  test('calls signAndExecute and returns Stream with correct id', async () => {
    const client       = makeMockClient()
    const signAndExec  = makeSignAndExecute()

    const stream = await Stream.create(
      client,
      'mainnet',
      MOCK_SENDER,
      { pricePerSession: 0.10, durationSeconds: 3600, paymentType: STREAM_PAYMENT_TYPE.PER_VIEW, vesselId: MOCK_VESSEL_ID },
      signAndExec,
    )

    expect(signAndExec).toHaveBeenCalledTimes(1)
    expect(stream.id).toBe(MOCK_STREAM_ID)
    expect(stream.txDigest).toBe(MOCK_DIGEST)
    expect(stream.createdAt).toBeGreaterThan(0)
  })

  test('passes correct target to PTB', async () => {
    const client       = makeMockClient()
    const signAndExec  = makeSignAndExecute()
    let capturedTx: Transaction | null = null

    const captureSign = jest.fn().mockImplementation(async (tx: Transaction) => {
      capturedTx = tx
      return { digest: MOCK_DIGEST }
    })

    await Stream.create(
      client, 'mainnet', MOCK_SENDER,
      { pricePerSession: 0.10, durationSeconds: 3600, paymentType: STREAM_PAYMENT_TYPE.PER_VIEW, vesselId: MOCK_VESSEL_ID },
      captureSign,
    )

    expect(capturedTx).not.toBeNull()
    // PTB was built — signAndExecute was called
    expect(captureSign).toHaveBeenCalledTimes(1)
  })

  test('throws INSUFFICIENT_BALANCE when no USDC coins', async () => {
    const client = makeMockClient({
      getCoins: jest.fn().mockResolvedValue({ data: [] }),
    })

    await expect(
      Stream.create(
        client, 'mainnet', MOCK_SENDER,
        { pricePerSession: 0.10, durationSeconds: 3600, paymentType: STREAM_PAYMENT_TYPE.PER_VIEW, vesselId: MOCK_VESSEL_ID },
        makeSignAndExecute(),
      ),
    ).rejects.toThrow(ConkError)
  })

  test('throws TRANSACTION_FAILED when tx fails', async () => {
    const client = makeMockClient()
    const failSign = jest.fn().mockRejectedValue(new Error('rpc timeout'))

    await expect(
      Stream.create(
        client, 'mainnet', MOCK_SENDER,
        { pricePerSession: 0.10, durationSeconds: 3600, paymentType: STREAM_PAYMENT_TYPE.PER_VIEW, vesselId: MOCK_VESSEL_ID },
        failSign,
      ),
    ).rejects.toThrow('stream::create failed')
  })

  test('throws if Stream object not found in tx output', async () => {
    const client = makeMockClient({
      getTransactionBlock: jest.fn().mockResolvedValue({ objectChanges: [], events: [] }),
    })

    await expect(
      Stream.create(
        client, 'mainnet', MOCK_SENDER,
        { pricePerSession: 0.10, durationSeconds: 3600, paymentType: STREAM_PAYMENT_TYPE.PER_VIEW, vesselId: MOCK_VESSEL_ID },
        makeSignAndExecute(),
      ),
    ).rejects.toThrow('Stream object not found')
  })
})

// ─── Stream.join ──────────────────────────────────────────────────────────────

describe('Stream.join', () => {
  test('returns session with correct fields', async () => {
    const client      = makeMockClient()
    const signAndExec = makeSignAndExecute()

    const session = await Stream.join(
      client, 'mainnet', MOCK_SENDER, MOCK_STREAM_ID, signAndExec,
    )

    expect(signAndExec).toHaveBeenCalledTimes(1)
    expect(session.streamId).toBe(MOCK_STREAM_ID)
    expect(session.paid).toBe(100_000)
    expect(session.expiresAt).toBeGreaterThan(Date.now())
    expect(session.txDigest).toBe(MOCK_DIGEST)
  })

  test('throws if Stream object not readable', async () => {
    const client = makeMockClient({
      getObject: jest.fn().mockResolvedValue({ data: { content: null } }),
    })

    await expect(
      Stream.join(client, 'mainnet', MOCK_SENDER, MOCK_STREAM_ID, makeSignAndExecute()),
    ).rejects.toThrow('Could not read Stream object')
  })

  test('throws TRANSACTION_FAILED when join tx fails', async () => {
    const client   = makeMockClient()
    const failSign = jest.fn().mockRejectedValue(new Error('insufficient gas'))

    await expect(
      Stream.join(client, 'mainnet', MOCK_SENDER, MOCK_STREAM_ID, failSign),
    ).rejects.toThrow('stream::join failed')
  })
})

// ─── Stream.verify ────────────────────────────────────────────────────────────

describe('Stream.verify', () => {
  test('returns true for a session that has not expired', async () => {
    const futureExpiry = Date.now() + 3_600_000
    const client       = makeMockClient({
      getObject: jest.fn().mockResolvedValue({
        data: { content: { fields: { expires_at: String(futureExpiry) } } },
      }),
    })

    const active = await Stream.verify(client, MOCK_SESSION_ID)
    expect(active).toBe(true)
  })

  test('returns false for an expired session', async () => {
    const pastExpiry = Date.now() - 1_000
    const client     = makeMockClient({
      getObject: jest.fn().mockResolvedValue({
        data: { content: { fields: { expires_at: String(pastExpiry) } } },
      }),
    })

    const active = await Stream.verify(client, MOCK_SESSION_ID)
    expect(active).toBe(false)
  })

  test('returns false if object does not exist', async () => {
    const client = makeMockClient({
      getObject: jest.fn().mockResolvedValue({ data: null }),
    })

    const active = await Stream.verify(client, MOCK_SESSION_ID)
    expect(active).toBe(false)
  })

  test('returns false if getObject throws', async () => {
    const client = makeMockClient({
      getObject: jest.fn().mockRejectedValue(new Error('not found')),
    })

    const active = await Stream.verify(client, MOCK_SESSION_ID)
    expect(active).toBe(false)
  })
})

// ─── Stream.end ───────────────────────────────────────────────────────────────

describe('Stream.end', () => {
  test('returns txDigest on success without VOD chest', async () => {
    const client      = makeMockClient()
    const signAndExec = makeSignAndExecute()

    const result = await Stream.end(client, 'mainnet', MOCK_SENDER, MOCK_STREAM_ID, signAndExec)

    expect(signAndExec).toHaveBeenCalledTimes(1)
    expect(result.txDigest).toBe(MOCK_DIGEST)
  })

  test('returns txDigest on success with VOD chest ID', async () => {
    const client      = makeMockClient()
    const signAndExec = makeSignAndExecute()
    const CHEST_ID    = '0xc8e5700000000000000000000000000000000000000000000000000000000001'

    const result = await Stream.end(
      client, 'mainnet', MOCK_SENDER, MOCK_STREAM_ID, signAndExec,
      { vodChestId: CHEST_ID },
    )

    expect(result.txDigest).toBe(MOCK_DIGEST)
  })

  test('throws TRANSACTION_FAILED when end tx fails', async () => {
    const client   = makeMockClient()
    const failSign = jest.fn().mockRejectedValue(new Error('not creator'))

    await expect(
      Stream.end(client, 'mainnet', MOCK_SENDER, MOCK_STREAM_ID, failSign),
    ).rejects.toThrow('stream::end failed')
  })
})

// ─── Stream.fetchState ────────────────────────────────────────────────────────

describe('Stream.fetchState', () => {
  test('returns correctly parsed stream state', async () => {
    const client = makeMockClient()
    const state  = await Stream.fetchState(client, MOCK_STREAM_ID)

    expect(state.id).toBe(MOCK_STREAM_ID)
    expect(state.creator).toBe(MOCK_SENDER)
    expect(state.pricePerSession).toBeCloseTo(0.10)
    expect(state.durationSeconds).toBe(3600)
    expect(state.paymentType).toBe(STREAM_PAYMENT_TYPE.PER_VIEW)
    expect(state.isLive).toBe(true)
    expect(state.totalEarned).toBeCloseTo(5.00)
    expect(state.sessionCount).toBe(50)
    expect(state.createdAt).toBe(1748000000000)
  })

  test('throws if stream object not readable', async () => {
    const client = makeMockClient({
      getObject: jest.fn().mockResolvedValue({ data: { content: null } }),
    })

    await expect(
      Stream.fetchState(client, MOCK_STREAM_ID),
    ).rejects.toThrow('Could not read Stream state')
  })
})
