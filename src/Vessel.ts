/**
 * @axiomtide/conk-sdk — Vessel
 * An anonymous Sui object identity. Publishes and reads casts.
 */

import { Transaction }  from '@mysten/sui/transactions'
import { SuiClient }    from '@mysten/sui/client'
import { Cast }         from './Cast'
import { CONTRACTS, LIGHTHOUSE_REGISTRY_ID } from './config'
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

  id():          string           { return this.state.id }
  address():     string           { return this.state.address }
  fuelCents():   number           { return this.state.fuelCents }
  objectId():    string           { return this.state.objectId }
  /** VesselCap co-owned with this Vessel (required for v11 cast::sound). */
  capObjectId(): string | undefined { return this.state.capObjectId }

  // ─── Guard: assert capObjectId is present ─────────────────────────────────

  private requireCap(): string {
    if (!this.state.capObjectId) {
      throw new ConkError(
        'Vessel is missing capObjectId — re-create this Vessel with the v11 SDK to capture VesselCap',
        ConkErrorCode.INVALID_CONFIG,
        { vesselId: this.state.id },
      )
    }
    return this.state.capObjectId
  }

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
      this.requireCap(),
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
      this.session,
    )
  }

  // ─── Raise a Cast to the LighthouseRegistry ───────────────────────────────

  /**
   * Register a published Cast in the on-chain LighthouseRegistry.
   *
   * Call immediately after `vessel.publish()` to make the content
   * discoverable by agents and buyers.
   *
   * v11 PTB: lighthouse::raise(
   *   &mut Cast,               // [0] the published Cast
   *   &mut Vessel,             // [1] publisher's Vessel (mutable)
   *   &VesselCap,              // [2] publisher's VesselCap
   *   &mut LighthouseRegistry, // [3] shared registry object
   *   &Drift,                  // [4] shared Drift object
   *   &Clock,                  // [5]
   * )
   *
   * @param castId      Cast object ID returned by vessel.publish()
   * @param registryId  LighthouseRegistry object ID (defaults to mainnet constant)
   */
  async raiseToLighthouse(
    castId:     string,
    registryId: string = LIGHTHOUSE_REGISTRY_ID,
  ): Promise<{ txDigest: string }> {
    const capId     = this.requireCap()
    const contracts = CONTRACTS[this.network]
    const tx        = new Transaction()

    tx.moveCall({
      target:    `${contracts.package}::lighthouse::raise`,
      arguments: [
        tx.object(castId),               // [0] &mut Cast
        tx.object(this.state.objectId),  // [1] &mut Vessel
        tx.object(capId),                // [2] &VesselCap
        tx.object(registryId),           // [3] &mut LighthouseRegistry
        tx.object(contracts.drift),      // [4] &Drift
        tx.object(contracts.clock),      // [5] &Clock
      ],
    })

    let digest: string
    try {
      const result = await this.signAndExecute(tx)
      digest = result.digest
    } catch (err) {
      throw new ConkError(
        `lighthouse::raise failed: ${(err as Error).message}`,
        ConkErrorCode.TRANSACTION_FAILED,
        { error: err, castId },
      )
    }

    return { txDigest: digest }
  }

  // ─── Claim a vessel name ──────────────────────────────────────────────────

  /**
   * Sound a special identity Cast that registers a human-readable name for
   * this vessel. The cast hook follows the `[VESSEL:NAME] <name>` pattern,
   * which VesselRegistry.findVessel() uses to index names.
   *
   * @param name  Human-readable label (e.g. "alice" or "my-agent")
   * @returns     Cast ID and transaction digest of the name claim
   *
   * @example
   * const { castId } = await vessel.claimName('alice')
   */
  async claimName(name: string): Promise<{ castId: string; txDigest: string }> {
    const hook = `[VESSEL:NAME] ${name}`
    const body = JSON.stringify({
      type:      'vessel:name',
      vesselId:  this.state.objectId,
      name,
      claimedAt: new Date().toISOString(),
    })

    const cast = await Cast.publish(
      this.suiClient,
      this.network,
      this.session,
      this.state.objectId,
      {
        hook,
        body,
        price:    0.001,   // 0.001 USDC — standard sound fee, readable by anyone
        mode:     'open',
        duration: '24h',
      },
      this.signAndExecute,
      this.requireCap(),
    )

    return { castId: cast.id, txDigest: cast.txDigest }
  }

  // ─── Static factory — create Vessel object on-chain ───────────────────────

  static async create(
    suiClient:       SuiClient,
    network:         Network,
    session:         ZkLoginSession,
    harborObjectId:  string,
    fuelAmountCents: number,
    signAndExecute:  (tx: Transaction) => Promise<{ digest: string }>,
  ): Promise<Vessel> {
    const contracts = CONTRACTS[network]
    const tx        = new Transaction()

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

    // v11: capture VesselCap co-created alongside the Vessel
    const capObj = txData.objectChanges?.find(
      (c) =>
        c.type === 'created' &&
        (c as { objectType?: string }).objectType?.includes('::vessel::VesselCap'),
    ) as { objectId?: string } | undefined

    const state: VesselState = {
      id:          vesselObj.objectId,
      address:     vesselObj.owner?.AddressOwner ?? session.address,
      fuelCents:   fuelAmountCents,
      objectId:    vesselObj.objectId,
      capObjectId: capObj?.objectId,
    }

    return new Vessel(state, suiClient, network, session, signAndExecute)
  }

  // ─── v11: Reputation ───────────────────────────────────────────

  /** Fetch on-chain reputation for this Vessel. */
  async getReputation(): Promise<VesselReputation> {
    return Vessel.fetchReputation(this.suiClient, this.state.objectId)
  }

  /** Fetch reputation for any Vessel by object ID. */
  static async fetchReputation(
    suiClient:      SuiClient,
    vesselObjectId: string,
  ): Promise<VesselReputation> {
    const obj = await suiClient.getObject({
      id:      vesselObjectId,
      options: { showContent: true },
    })
    const fields       = (obj.data?.content as { fields?: Record<string, unknown> })?.fields ?? {}
    const castCount       = Number(fields.cast_count       ?? 0)
    const lighthouseCount = Number(fields.lighthouse_count ?? 0)
    const createdAt       = Number(fields.created_at       ?? Date.now())
    const lastCast        = Number(fields.last_cast        ?? createdAt)
    const tier            = Number(fields.tier             ?? 0)
    return {
      objectId:         vesselObjectId,
      castCount,
      lighthouseCount,
      tier,
      createdAt,
      expiresAt:        lastCast + 365 * 24 * 60 * 60 * 1000,
      lighthouseRate:   lighthouseCount / Math.max(1, castCount),
      ageDays:          Math.floor((Date.now() - createdAt) / 86_400_000),
    }
  }
}

// ─── v11: Reputation ──────────────────────────────────────────────────────────

/** On-chain reputation data for a Vessel. */
export interface VesselReputation {
  objectId:         string
  castCount:        number
  lighthouseCount:  number
  tier:             number
  createdAt:        number
  expiresAt:        number
  /** lighthouse_count / max(1, cast_count) */
  lighthouseRate:   number
  /** Days since Vessel was created */
  ageDays:          number
}
