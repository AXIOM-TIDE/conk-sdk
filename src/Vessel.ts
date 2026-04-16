/**
 * @axiomtide/conk-sdk — Vessel
 * An anonymous Sui object identity. Publishes and reads casts.
 *
 * NOTE: move_call targets below reference the CONK package.
 * Slot exact module::function names from client.ts once extracted.
 */

import { Transaction }  from '@mysten/sui/transactions'
import { SuiClient }    from '@mysten/sui/client'
import { Cast }         from './Cast'
import { CONTRACTS }    from './config'
import { ConkError, ConkErrorCode } from './types'
import type {
  Network,
  VesselState,
  PublishOptions,
  ReadOptions,
  ZkLoginSession,
} from './types'

export class Vessel {
  constructor(
    private readonly state:          VesselState,
    private readonly suiClient:      SuiClient,
    private readonly network:        Network,
    private readonly session:        ZkLoginSession,
    private readonly signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
  ) {}

  // ─── Identity ─────────────────────────────────────────────────────────────

  id():         string { return this.state.id }
  address():    string { return this.state.address }
  fuelCents():  number { return this.state.fuelCents }
  objectId():   string { return this.state.objectId }

  // ─── Publish a cast ───────────────────────────────────────────────────────

  async publish(options: PublishOptions): Promise<Cast> {
    if (this.state.fuelCents <= 0) {
      throw new ConkError(
        'Vessel has no fuel — top up via Harbor.createVessel()',
        ConkErrorCode.INSUFFICIENT_FUEL,
        { vesselId: this.state.id },
      )
    }

    return Cast.publish(
      this.suiClient,
      this.network,
      this.session,
      this.state.objectId,
      options,
      this.signAndExecute,
    )
  }

  // ─── Read a cast and pay ──────────────────────────────────────────────────

  async read(options: ReadOptions) {
    return Cast.read(
      this.suiClient,
      this.network,
      this.state.objectId,
      options,
      this.signAndExecute,
    )
  }

  // ─── Static factory — create Vessel object on-chain ───────────────────────

  static async create(
    suiClient:      SuiClient,
    network:        Network,
    session:        ZkLoginSession,
    harborObjectId: string,
    fuelAmountCents: number,
    signAndExecute: (tx: Transaction) => Promise<{ digest: string }>,
  ): Promise<Vessel> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

    // TODO: slot exact module path from client.ts
    tx.moveCall({
      target:    `${contracts.package}::vessel::launch`,
      arguments: [
        tx.object(harborObjectId),
        tx.pure.u64(fuelAmountCents),
      ],
    })

    let digest: string
    try {
      const result = await signAndExecute(tx)
      digest = result.digest
    } catch (err) {
      throw new ConkError(
        `Create vessel transaction failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err },
      )
    }

    const txData = await suiClient.getTransactionBlock({
      digest,
      options: { showEffects: true, showObjectChanges: true },
    })

    const vesselObj = txData.objectChanges?.find(
      (c) =>
        c.type === 'created' &&
        (c as { objectType?: string }).objectType?.includes('::vessel::Vessel'),
    ) as { objectId?: string; owner?: { AddressOwner?: string } } | undefined

    if (!vesselObj?.objectId) {
      throw new ConkError(
        'Could not locate Vessel object in transaction output',
        ConkErrorCode.TRANSACTION_FAILED,
        { digest },
      )
    }

    const state: VesselState = {
      id:          vesselObj.objectId,
      address:     vesselObj.owner?.AddressOwner ?? session.address,
      fuelCents:   fuelAmountCents,
      objectId:    vesselObj.objectId,
    }

    return new Vessel(state, suiClient, network, session, signAndExecute)
  }
}
