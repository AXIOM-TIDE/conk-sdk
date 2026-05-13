/**
 * @axiomtide/conk-sdk — Chest
 * Walrus-backed encrypted file vault for Vessels.
 * SEAL encrypted. Walrus stored. CONK settled.
 * Three size tiers: Nano · Standard · Large.
 * Access: 97% author / 3% protocol.
 * Burn destroys the on-chain gate. Blob stays. Unreadable.
 */

import { Transaction }        from '@mysten/sui/transactions'
import { SuiClient }          from '@mysten/sui/client'
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519'
import { CONTRACTS, toBaseUnits, USDC_COIN_TYPE } from './config'
import { ConkError, ConkErrorCode }               from './types'
import type { Network, ZkLoginSession, TransactionReceipt } from './types'

// ─── Constants (mirror chest.move) ───────────────────────────────────────────

/** Size tiers — must match TIER_* constants in chest.move */
export const CHEST_TIER = {
  NANO:     0 as const,   // ≤ 100 KB
  STANDARD: 1 as const,   // ≤ 1 MB
  LARGE:    2 as const,   // ≤ 10 MB
} as const

export type ChestTier = typeof CHEST_TIER[keyof typeof CHEST_TIER]

/** Protocol fees in USDC (decimal) */
export const CHEST_FEES = {
  NANO:     0.05,   // $0.05 open fee
  STANDARD: 0.10,   // $0.10 open fee
  LARGE:    0.25,   // $0.25 open fee
  BURN:     0.02,   // $0.02 to destroy
  EXTEND:   0.02,   // $0.02 per extension
  MIN_ACCESS: 0.01, // $0.01 minimum access fee
} as const

/** Microunit fee amounts (1_000_000 = $1.00) */
export const CHEST_FEE_UNITS = {
  NANO:     50_000,
  STANDARD: 100_000,
  LARGE:    250_000,
  BURN:     20_000,
  EXTEND:   20_000,
} as const

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChestOpenOptions {
  /** Vessel ID (on-chain ID of the Vessel that owns this Chest) */
  vesselId: string
  /** Walrus blobId of the SEAL-encrypted file (bytes or hex string) */
  blobId: Uint8Array | string
  /** SEAL policy ID that gates decryption key delivery (bytes or hex string) */
  sealId: Uint8Array | string
  /** Size tier: 0=NANO (≤100KB), 1=STANDARD (≤1MB), 2=LARGE (≤10MB) */
  sizeTier: ChestTier
  /** Actual file size in bytes — must fit within declared tier */
  sizeBytes: number
  /** Access fee per read in USDC decimal (e.g. 0.05 = $0.05). 0 = free. */
  accessFee: number
  /** Storage duration in Walrus epochs (0 = default 5 epochs ≈ 35 days) */
  epochs?: number
}

export interface ChestResult {
  /** On-chain Chest object ID */
  id: string
  /** Transaction digest from the open() call */
  txDigest: string
  /** Timestamp when the Chest was opened (ms) */
  createdAt: number
}

export interface ChestAccessResult {
  /** Walrus blobId emitted in ChestAccessed event */
  blobId: string
  /** SEAL policy ID emitted in ChestAccessed event */
  sealId: string
  /** Total USDC microunits paid for this access */
  feePaid: number
  /** Updated total access count */
  accessCount: number
  /** Transaction digest */
  txDigest: string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Convert blobId/sealId to number[] for PTB vector<u8> arguments */
function toByteArray(input: Uint8Array | string): number[] {
  if (typeof input === 'string') {
    // Assume hex string — strip optional 0x prefix
    const hex = input.startsWith('0x') ? input.slice(2) : input
    const bytes: number[] = []
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, 2), 16))
    }
    return bytes
  }
  return Array.from(input)
}

/** Split a USDC coin from the sender's wallet for the given microunit amount */
async function splitUsdcCoin(
  suiClient: SuiClient,
  tx:        Transaction,
  sender:    string,
  amount:    bigint,
): Promise<ReturnType<Transaction['splitCoins']>> {
  const coins = await suiClient.getCoins({
    owner:    sender,
    coinType: USDC_COIN_TYPE,
  })

  if (!coins.data.length) {
    throw new ConkError(
      'No USDC coins found in wallet',
      ConkErrorCode.INSUFFICIENT_BALANCE,
    )
  }

  // Find a coin with enough balance, or use the largest
  const sorted = [...coins.data].sort(
    (a, b) => Number(BigInt(b.balance) - BigInt(a.balance)),
  )
  const coin = sorted.find(c => BigInt(c.balance) >= amount) ?? sorted[0]

  return tx.splitCoins(tx.object(coin.coinObjectId), [tx.pure.u64(amount)])
}

/** Build a signer from the session's ephemeral key pair */
function keypairFromSession(session: ZkLoginSession): Ed25519Keypair {
  const raw = session.ephemeralKeyPair.privateKey
  const bytes = raw.startsWith('0x')
    ? Uint8Array.from(Buffer.from(raw.slice(2), 'hex'))
    : Uint8Array.from(Buffer.from(raw, 'base64'))
  return Ed25519Keypair.fromSecretKey(bytes)
}

/** Sign and execute a transaction block using the ZkLogin session */
async function executeWithSession(
  suiClient: SuiClient,
  session:   ZkLoginSession,
  tx:        Transaction,
  showObjectChanges = true,
  showEvents        = false,
) {
  tx.setSender(session.address)

  const keypair = keypairFromSession(session)
  const { bytes, signature: ephemeralSig } = await tx.sign({
    client: suiClient,
    signer: keypair,
  })

  // Build ZkLogin signature from session proof
  // The getZkLoginSignature helper concatenates proof + ephemeral sig per Sui spec
  const { getZkLoginSignature } = await import('@mysten/sui/zklogin')
  const zkSig = getZkLoginSignature({
    inputs: {
      proofPoints:      session.proof.proofPoints,
      issBase64Details: session.proof.issBase64Details,
      headerBase64:     session.proof.headerBase64,
      addressSeed:      session.addressSeed ?? '',
    },
    maxEpoch:      session.maxEpoch,
    userSignature: ephemeralSig,
  })

  return suiClient.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        zkSig,
    options: {
      showEffects:       true,
      showObjectChanges,
      showEvents,
    },
  })
}

// ─── Chest class ──────────────────────────────────────────────────────────────

export class Chest {
  readonly id:        string
  readonly txDigest:  string
  readonly createdAt: number

  private readonly suiClient: SuiClient
  private readonly network:   Network

  constructor(
    result:    ChestResult,
    suiClient: SuiClient,
    network:   Network,
  ) {
    this.id        = result.id
    this.txDigest  = result.txDigest
    this.createdAt = result.createdAt
    this.suiClient = suiClient
    this.network   = network
  }

  // ─── Static: open a new Chest ──────────────────────────────────────────────

  /**
   * Open a new Chest.
   *
   * Caller must have already uploaded the file to Walrus and encrypted it
   * with SEAL off-chain. Pass the resulting blobId and sealId here.
   * Protocol collects an open fee based on size tier (sent to Abyss).
   */
  static async open(
    suiClient: SuiClient,
    network:   Network,
    session:   ZkLoginSession,
    options:   ChestOpenOptions,
  ): Promise<Chest> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    // Determine the open fee for this tier
    const tierFees: Record<ChestTier, bigint> = {
      [CHEST_TIER.NANO]:     BigInt(CHEST_FEE_UNITS.NANO),
      [CHEST_TIER.STANDARD]: BigInt(CHEST_FEE_UNITS.STANDARD),
      [CHEST_TIER.LARGE]:    BigInt(CHEST_FEE_UNITS.LARGE),
    }
    const feeAmount = tierFees[options.sizeTier]

    const [feeCoin] = await splitUsdcCoin(suiClient, tx, session.address, feeAmount)

    const accessFeeUnits = options.accessFee > 0
      ? toBaseUnits(options.accessFee)
      : 0n

    tx.moveCall({
      target:    `${contracts.package}::chest::open`,
      arguments: [
        feeCoin,
        tx.object(contracts.abyss),
        tx.pure.id(options.vesselId),
        tx.pure.vector('u8', toByteArray(options.blobId)),
        tx.pure.vector('u8', toByteArray(options.sealId)),
        tx.pure.u8(options.sizeTier),
        tx.pure.u64(options.sizeBytes),
        tx.pure.u64(accessFeeUnits),
        tx.pure.u64(options.epochs ?? 0),
        tx.object(contracts.clock),
      ],
    })

    let txResult: Awaited<ReturnType<typeof executeWithSession>>
    try {
      txResult = await executeWithSession(suiClient, session, tx, true, false)
    } catch (err) {
      throw new ConkError(
        `Chest open transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    const digest = txResult.digest

    const chestChange = txResult.objectChanges?.find(
      (c) =>
        c.type === 'created' &&
        (c as { objectType?: string }).objectType?.includes('::chest::Chest'),
    ) as { objectId?: string } | undefined

    if (!chestChange?.objectId) {
      throw new ConkError(
        'Could not locate Chest object in transaction output',
        ConkErrorCode.TRANSACTION_FAILED,
        { digest },
      )
    }

    const result: ChestResult = {
      id:        chestChange.objectId,
      txDigest:  digest,
      createdAt: Date.now(),
    }

    return new Chest(result, suiClient, network)
  }

  // ─── Instance: access this Chest ──────────────────────────────────────────

  /**
   * Access this Chest.
   *
   * Reader pays access_fee. Author receives 97%, protocol 3%.
   * blobId and sealId are emitted in ChestAccessed — use them to fetch
   * the Walrus blob and request the SEAL decryption key.
   */
  async access(session: ZkLoginSession): Promise<ChestAccessResult> {
    const contracts = CONTRACTS[this.network]
    const tx        = new Transaction()

    // Fetch the chest on-chain to know the access fee
    const chestObj = await this.suiClient.getObject({
      id:      this.id,
      options: { showContent: true },
    })

    const fields = (
      chestObj.data?.content as { fields?: Record<string, unknown> }
    )?.fields

    const accessFeeUnits = BigInt(
      (fields?.access_fee as string | number | undefined) ?? 0,
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let feeCoin: any
    if (accessFeeUnits > 0n) {
      ;[feeCoin] = await splitUsdcCoin(
        this.suiClient,
        tx,
        session.address,
        accessFeeUnits,
      )
    } else {
      // Free chest — pass a zero-value coin split from gas
      ;[feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(0)])
    }

    tx.moveCall({
      target:    `${contracts.package}::chest::access`,
      arguments: [
        tx.object(this.id),
        feeCoin,
        tx.object(contracts.abyss),
        tx.object(contracts.clock),
      ],
    })

    let txResult: Awaited<ReturnType<typeof executeWithSession>>
    try {
      txResult = await executeWithSession(
        this.suiClient,
        session,
        tx,
        false,
        true,
      )
    } catch (err) {
      throw new ConkError(
        `Chest access transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    // Extract ChestAccessed event fields
    const accessEvent = txResult.events?.find(
      (e) => e.type?.includes('::chest::ChestAccessed'),
    )
    const parsed = (accessEvent?.parsedJson ?? {}) as Record<string, unknown>

    return {
      blobId:      (parsed.blob_id as string) ?? '',
      sealId:      (parsed.seal_id as string) ?? '',
      feePaid:     Number(parsed.fee_paid ?? 0),
      accessCount: Number(parsed.access_count ?? 0),
      txDigest:    txResult.digest,
    }
  }

  // ─── Static: burn a Chest ─────────────────────────────────────────────────

  /**
   * Burn a Chest.
   *
   * Zeroes blob_id and seal_id on-chain, marks state BURNED.
   * Costs $0.02. Only the chest owner may burn.
   */
  static async burn(
    suiClient: SuiClient,
    network:   Network,
    session:   ZkLoginSession,
    chestId:   string,
  ): Promise<TransactionReceipt> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    const [feeCoin] = await splitUsdcCoin(
      suiClient,
      tx,
      session.address,
      BigInt(CHEST_FEE_UNITS.BURN),
    )

    tx.moveCall({
      target:    `${contracts.package}::chest::burn`,
      arguments: [
        tx.object(chestId),
        feeCoin,
        tx.object(contracts.abyss),
        tx.object(contracts.clock),
      ],
    })

    let txResult: Awaited<ReturnType<typeof executeWithSession>>
    try {
      txResult = await executeWithSession(suiClient, session, tx, false, false)
    } catch (err) {
      throw new ConkError(
        `Chest burn transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    return {
      txDigest:     txResult.digest,
      castId:       chestId,
      amount:       CHEST_FEE_UNITS.BURN,
      timestamp:    Date.now(),
      buyerAddress: session.address,
    }
  }

  // ─── Static: extend a Chest's storage ────────────────────────────────────

  /**
   * Extend Chest storage duration.
   *
   * Costs $0.02 per extension call. Walrus storage extension must be done
   * off-chain via publisher API before calling this — otherwise on-chain
   * expiry will outlive the Walrus blob.
   */
  static async extend(
    suiClient: SuiClient,
    network:   Network,
    session:   ZkLoginSession,
    chestId:   string,
    epochs:    number,
  ): Promise<TransactionReceipt> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    const [feeCoin] = await splitUsdcCoin(
      suiClient,
      tx,
      session.address,
      BigInt(CHEST_FEE_UNITS.EXTEND),
    )

    tx.moveCall({
      target:    `${contracts.package}::chest::extend`,
      arguments: [
        tx.object(chestId),
        feeCoin,
        tx.object(contracts.abyss),
        tx.pure.u64(epochs),
        tx.object(contracts.clock),
      ],
    })

    let txResult: Awaited<ReturnType<typeof executeWithSession>>
    try {
      txResult = await executeWithSession(suiClient, session, tx, false, false)
    } catch (err) {
      throw new ConkError(
        `Chest extend transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    return {
      txDigest:     txResult.digest,
      castId:       chestId,
      amount:       CHEST_FEE_UNITS.EXTEND,
      timestamp:    Date.now(),
      buyerAddress: session.address,
    }
  }
}
