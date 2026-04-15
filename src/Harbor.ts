/**
 * @axiomtide/conk-sdk — Harbor
 * USDC deposit address, balance management, Vessel factory.
 *
 * NOTE: move_call targets reference the CONK package.
 * Slot exact module::function names from client.ts once extracted.
 */

import { Transaction }         from '@mysten/sui/transactions'
import { SuiClient }           from '@mysten/sui/client'
import { Vessel }              from './Vessel'
import { CONTRACTS, toBaseUnits, toCents, USDC_COIN_TYPE } from './config'
import { withRpcRetry, withTxRetry } from './retry'
import { ConkError, ConkErrorCode } from './types'
import type {
  Network,
  HarborState,
  SweepOptions,
  CreateVesselOptions,
  ZkLoginSession,
} from './types'

export class Harbor {
  constructor(
    private state:               HarborState,
    private readonly suiClient:  SuiClient,
    private readonly network:    Network,
    private readonly session:    ZkLoginSession,
    private readonly signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
    private readonly spendingCapCents?: number,
  ) {}

  // ─── Identity ─────────────────────────────────────────────────────────────

  address():    string { return this.state.address }
  objectId():   string { return this.state.objectId }

  // ─── Balance ──────────────────────────────────────────────────────────────

  async balance(): Promise<number> {
    const coins = await withRpcRetry(() =>
      this.suiClient.getCoins({
        owner:    this.state.address,
        coinType: USDC_COIN_TYPE,
      }),
    )

    const total = coins.data.reduce(
      (sum, c) => sum + BigInt(c.balance),
      BigInt(0),
    )

    this.state.balanceCents = toCents(total)
    return this.state.balanceCents
  }

  // ─── Sweep ────────────────────────────────────────────────────────────────

  async sweep(options: SweepOptions): Promise<{ txDigest: string; amount: number }> {
    const currentBalance = await this.balance()

    if (currentBalance <= 0) {
      throw new ConkError(
        'Harbor balance is zero — nothing to sweep',
        ConkErrorCode.INSUFFICIENT_BALANCE,
        { address: this.state.address },
      )
    }

    const amountCents =
      options.amount === 'all' ? currentBalance : options.amount

    if (this.spendingCapCents && amountCents > this.spendingCapCents) {
      throw new ConkError(
        `Sweep amount ${amountCents} cents exceeds spending cap of ${this.spendingCapCents} cents`,
        ConkErrorCode.SPENDING_CAP_EXCEEDED,
        { amountCents, cap: this.spendingCapCents },
      )
    }

    const contracts = CONTRACTS[this.network]
    const tx        = new Transaction()

    // TODO: slot exact module path from client.ts
    tx.moveCall({
      target:    `${contracts.package}::harbor::sweep`,
      arguments: [
        tx.object(this.state.objectId),
        tx.pure.address(options.toAddress),
        tx.pure.u64(toBaseUnits(amountCents / 100)),
      ],
    })

    let digest: string
    try {
      const result = await withTxRetry(() => this.signAndExecute(tx))
      digest = result.digest
    } catch (err) {
      throw new ConkError(
        `Sweep transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    this.state.balanceCents -= amountCents

    return { txDigest: digest, amount: amountCents }
  }

  // ─── Create Vessel ────────────────────────────────────────────────────────

  async createVessel(options: CreateVesselOptions): Promise<Vessel> {
    const currentBalance = await this.balance()

    if (currentBalance < options.fuelAmount) {
      throw new ConkError(
        `Insufficient Harbor balance. Required: ${options.fuelAmount} cents, available: ${currentBalance} cents`,
        ConkErrorCode.INSUFFICIENT_BALANCE,
        { required: options.fuelAmount, available: currentBalance },
      )
    }

    return Vessel.create(
      this.suiClient,
      this.network,
      this.session,
      this.state.objectId,
      options.fuelAmount,
      this.signAndExecute,
    )
  }

  // ─── Static factory — load or create Harbor object ────────────────────────

  static async load(
    suiClient:      SuiClient,
    network:        Network,
    session:        ZkLoginSession,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
    spendingCapCents?: number,
  ): Promise<Harbor> {
    const contracts = CONTRACTS[network]

    // Check if Harbor object already exists for this address
    const objects = await withRpcRetry(() =>
      suiClient.getOwnedObjects({
        owner:   session.address,
        filter:  { StructType: `${contracts.package}::harbor::Harbor` },
        options: { showContent: true },
      }),
    )

    if (objects.data.length > 0) {
      const obj     = objects.data[0]
      const content = obj.data?.content as {
        fields?: { balance?: string }
      } | undefined

      const state: HarborState = {
        address:      session.address,
        balanceCents: toCents(BigInt(content?.fields?.balance ?? '0')),
        objectId:     obj.data?.objectId ?? '',
      }

      return new Harbor(state, suiClient, network, session, signAndExecute, spendingCapCents)
    }

    // Create a new Harbor
    const tx = new Transaction()

    // TODO: slot exact module path from client.ts
    tx.moveCall({
      target:    `${contracts.package}::harbor::create`,
      arguments: [],
    })

    let digest: string
    try {
      const result = await signAndExecute(tx)
      digest = result.digest
    } catch (err) {
      throw new ConkError(
        `Create Harbor transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    const txData = await suiClient.getTransactionBlock({
      digest,
      options: { showObjectChanges: true },
    })

    const harborObj = txData.objectChanges?.find(
      (c) =>
        c.type === 'created' &&
        (c as { objectType?: string }).objectType?.includes('::harbor::Harbor'),
    ) as { objectId?: string } | undefined

    if (!harborObj?.objectId) {
      throw new ConkError(
        'Could not locate Harbor object in transaction output',
        ConkErrorCode.TRANSACTION_FAILED,
        { digest },
      )
    }

    const state: HarborState = {
      address:      session.address,
      balanceCents: 0,
      objectId:     harborObj.objectId,
    }

    return new Harbor(state, suiClient, network, session, signAndExecute, spendingCapCents)
  }
}
