/**
 * @axiomtide/conk-sdk — Beacon
 *
 * A Beacon is a permanent creator identity on CONK.
 * One Beacon per creator. It hosts all their Lighthouses.
 * Agents discover Beacons via the registry and purchase from them.
 *
 * A Beacon is a permanent Vessel with a profile cast attached —
 * a directory cast that lists the creator's active Lighthouses.
 *
 * @example
 * const conk   = new ConkClient({ privateKey: process.env.KEY })
 * const beacon = await Beacon.load(conk)
 *
 * // Publish a film
 * const light = await beacon.publish({
 *   title:     'The Deep — Full Film',
 *   category:  'film',
 *   mediaType: 'video/mp4',
 *   price:     3.00,
 *   permanent: true,
 *   file:      filmFile,
 * })
 *
 * // List all published lighthouses
 * const catalog = beacon.catalog()
 * console.log(catalog.map(l => l.title))
 */

import { Lighthouse } from './Lighthouse'
import { ConkError, ConkErrorCode } from './types'
import type { ConkClient } from './ConkClient'
import type { Vessel }     from './Vessel'
import type { LighthousePublishOptions, LighthouseMetadata } from './Lighthouse'

// ─── Beacon profile ───────────────────────────────────────────────────────────

export interface BeaconProfile {
  /** Display name (optional — can stay anonymous) */
  name?:        string
  /** Short bio */
  bio?:         string
  /** Creator category */
  category?:    string
  /** Website or link */
  link?:        string
  /** Whether this beacon is discoverable in the registry */
  discoverable: boolean
}

export interface BeaconState {
  /** Beacon's permanent vessel ID */
  vesselId:     string
  /** Beacon profile cast ID */
  profileCastId: string
  /** Creator's anonymous address */
  address:      string
  profile:      BeaconProfile
  /** All published lighthouses */
  lighthouses:  LighthouseMetadata[]
  createdAt:    number
}

// ─── Beacon ───────────────────────────────────────────────────────────────────

export class Beacon {
  private state: BeaconState

  private constructor(
    private readonly conk:   ConkClient,
    private readonly vessel: Vessel,
    state: BeaconState,
  ) {
    this.state = state
  }

  // ─── Identity ─────────────────────────────────────────────────────────────

  get id():      string        { return this.state.vesselId }
  get address(): string        { return this.state.address }
  get profile(): BeaconProfile { return this.state.profile }

  // ─── Publish a lighthouse ──────────────────────────────────────────────────

  /**
   * Upload media to Walrus and publish a monetised lighthouse.
   * Returns a Lighthouse ready for buyers to discover and purchase.
   */
  async publish(options: LighthousePublishOptions): Promise<Lighthouse> {
    // 1. Upload to Walrus
    const upload = await this.conk.attachments.upload(options.file, {
      maxMB: 500,  // 500 MB max per lighthouse
    })

    // 2. Build cast body — includes machine-readable metadata for agents
    const meta = JSON.stringify({
      v:          1,
      type:       'lighthouse',
      mediaType:  options.mediaType,
      category:   options.category,
      tags:       options.tags ?? [],
      sizeBytes:  options.fileSizeBytes ?? 0,
      beaconId:   this.state.vesselId,
    })

    // 3. Publish the cast
    const cast = await this.vessel.publish({
      hook:       options.title,
      body:       `${options.description}\n\n${meta}`,
      price:      options.price,
      mode:       'open',
      duration:   options.permanent !== false ? 'permanent' : '7d',
      attachment: upload.blobId,
      autoResponse: options.autoResponse ?? {
        hook:               'Purchase confirmed',
        body:               `Thank you for supporting this creator. Your receipt is on-chain.`,
        triggerOnEveryRead: true,
      },
    })

    // 4. Build and cache the lighthouse metadata
    const lighthouseMeta: LighthouseMetadata = {
      castId:        cast.id,
      url:           cast.url,
      title:         options.title,
      description:   options.description,
      mediaType:     options.mediaType,
      category:      options.category,
      price:         options.price,
      permanent:     options.permanent !== false,
      blobId:        upload.blobId,
      fileSizeBytes: options.fileSizeBytes,
      tags:          options.tags ?? [],
      publishedAt:   Date.now(),
      beaconId:      this.state.vesselId,
    }

    this.state.lighthouses.push(lighthouseMeta)

    return new Lighthouse(lighthouseMeta)
  }

  // ─── Catalog ──────────────────────────────────────────────────────────────

  /** All lighthouses published by this beacon */
  catalog(): Lighthouse[] {
    return this.state.lighthouses.map((m) => Lighthouse.fromJSON(m))
  }

  /** Filter catalog by category */
  byCategory(category: LighthouseMetadata['category']): Lighthouse[] {
    return this.catalog().filter((l) => l.category === category)
  }

  /** Filter catalog by tag */
  byTag(tag: string): Lighthouse[] {
    return this.catalog().filter((l) => l.tags.includes(tag))
  }

  // ─── Serialization — persist beacon state across sessions ─────────────────

  exportState(): BeaconState {
    return JSON.parse(JSON.stringify(this.state)) as BeaconState
  }

  static async restoreFromState(
    conk:   ConkClient,
    vessel: Vessel,
    state:  BeaconState,
  ): Promise<Beacon> {
    return new Beacon(conk, vessel, state)
  }

  // ─── Static factory ───────────────────────────────────────────────────────

  /**
   * Load or create a Beacon for the current ConkClient identity.
   *
   * Pass a savedState to restore a previously created beacon
   * (important — daemons should persist this between restarts).
   */
  static async load(
    conk:       ConkClient,
    profile:    BeaconProfile = { discoverable: true },
    savedState?: BeaconState,
  ): Promise<Beacon> {
    if (savedState) {
      const harbor = await conk.harbor()
      // Re-use the existing vessel — don't create a new one
      const vessel = await Beacon.loadVessel(harbor, savedState.vesselId)
      return Beacon.restoreFromState(conk, vessel, savedState)
    }

    // First time — create harbor + vessel
    const harbor = await conk.harbor()
    const vessel = await harbor.createVessel({ fuelAmount: 100 })

    const state: BeaconState = {
      vesselId:      vessel.id(),
      profileCastId: '',
      address:       vessel.address(),
      profile,
      lighthouses:   [],
      createdAt:     Date.now(),
    }

    return new Beacon(conk, vessel, state)
  }

  private static async loadVessel(
    harbor:   Awaited<ReturnType<ConkClient['harbor']>>,
    vesselId: string,
  ) {
    // Harbor.createVessel with zero fuel just to get the vessel handle
    // In a real implementation this would fetch the existing vessel object
    // TODO: add Harbor.getVessel(vesselId) once client.ts is extracted
    void harbor
    void vesselId
    throw new ConkError(
      'Harbor.getVessel() not yet implemented — extract from client.ts',
      ConkErrorCode.INVALID_CONFIG,
    )
  }
}
