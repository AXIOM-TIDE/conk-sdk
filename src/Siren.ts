/**
 * @axiomtide/conk-sdk — Siren
 *
 * Sirens are the discovery layer of CONK.
 * A Siren is a permanent audio broadcast — a sample that anyone can hear.
 *
 * Two tiers:
 *   'sample'  — $0.001 minimum → Abyss (network upkeep, non-negotiable)
 *               Honest about cost. Not free. A sample.
 *   'paid'    — author sets price above the floor
 *               97% → author · 3% → treasury · $0.001 floor → Abyss always
 *
 * This is distinct from a Lighthouse (full media, paid gate).
 * The relationship: Siren draws attention, Lighthouse closes the sale.
 *
 * SDK use case:
 *   Developers building on CONK can use Sirens as the marketing layer
 *   for their entire app. Configure once, your users have built-in
 *   audio discovery. Agents browse Sirens, find what their humans want,
 *   purchase the linked Lighthouse.
 *
 * @example
 * // Creator side — publish a sample
 * const sirens = new SirenClient(conk, { samplePrice: 0.001 })
 *
 * const siren = await sirens.broadcast({
 *   title:      'Untitled Project — 30s preview',
 *   description: 'Full film available on lighthouse',
 *   tier:        'sample',
 *   file:        previewClip,
 *   lighthouseId: filmLighthouse.castId,  // links to the full purchase
 * })
 *
 * // Agent side — discover and evaluate
 * const registry = new SirenRegistry(conk)
 * const samples  = await registry.search({ category: 'film', tier: 'sample' })
 *
 * for (const s of samples) {
 *   const audio = await s.stream().bytes()
 *   // evaluate for human, then purchase the linked Lighthouse
 * }
 */

import { CastStream }       from './stream'
import { withRetry }        from './retry'
import { WALRUS_PUBLISHER, WALRUS_AGGREGATOR } from './config'
import { ConkError, ConkErrorCode } from './types'
import type { ConkClient }  from './ConkClient'
import type { Vessel }      from './Vessel'
import type { LighthouseCategory } from './Lighthouse'

// ─── Constants ────────────────────────────────────────────────────────────────

/** The non-negotiable floor. Every Siren pays this to the Abyss. */
export const SIREN_ABYSS_FLOOR_USDC  = 0.001
export const SIREN_ABYSS_FLOOR_UNITS = 1_000  // base units

// ─── Siren tier ───────────────────────────────────────────────────────────────

/**
 * 'sample' — pays the $0.001 floor to Abyss only. Not free — a sample.
 * 'paid'   — author-set price above the floor.
 */
export type SirenTier = 'sample' | 'paid'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SirenClientConfig {
  /**
   * Price for sample-tier Sirens.
   * Defaults to SIREN_ABYSS_FLOOR_USDC ($0.001).
   * Cannot be set below the floor — the Abyss always gets paid.
   */
  samplePrice?: number

  /**
   * Default category for Sirens published via this client.
   * Can be overridden per-broadcast.
   */
  defaultCategory?: LighthouseCategory

  /**
   * Custom Walrus endpoints — defaults to production walrus.site.
   */
  walrusPublisher?:  string
  walrusAggregator?: string
}

// ─── Siren data ───────────────────────────────────────────────────────────────

export interface SirenPublishOptions {
  title:         string
  description?:  string
  tier:          SirenTier
  /** File to upload — MP3, WAV, FLAC, any audio format */
  file:          File | Blob | Uint8Array
  mediaType?:    string
  category?:     LighthouseCategory
  tags?:         string[]
  /**
   * Link to a Lighthouse castId.
   * Agents use this to find the full media after evaluating the sample.
   */
  lighthouseId?: string
  /**
   * Custom price for paid-tier Sirens (USDC, e.g. 0.05).
   * Ignored for sample tier — floor is used.
   * Must be >= SIREN_ABYSS_FLOOR_USDC.
   */
  price?:        number
}

export interface SirenMetadata {
  castId:        string
  url:           string
  title:         string
  description?:  string
  tier:          SirenTier
  /** Price in USDC base units — always >= SIREN_ABYSS_FLOOR_UNITS */
  priceUnits:    number
  /** Human-readable price string */
  priceLabel:    string
  blobId:        string
  mediaType:     string
  category?:     LighthouseCategory
  tags:          string[]
  lighthouseId?: string
  beaconId:      string
  publishedAt:   number
}

// ─── Siren ────────────────────────────────────────────────────────────────────

export class Siren {
  constructor(private readonly meta: SirenMetadata) {}

  get castId():      string             { return this.meta.castId }
  get url():         string             { return this.meta.url }
  get title():       string             { return this.meta.title }
  get tier():        SirenTier          { return this.meta.tier }
  get priceLabel():  string             { return this.meta.priceLabel }
  get blobId():      string             { return this.meta.blobId }
  get mediaType():   string             { return this.meta.mediaType }
  get category():    LighthouseCategory | undefined { return this.meta.category }
  get tags():        string[]           { return this.meta.tags }
  /** Linked Lighthouse castId — purchase the full media here */
  get lighthouseId(): string | undefined { return this.meta.lighthouseId }

  /** Open a stream to play the audio */
  stream(aggregatorUrl?: string): CastStream {
    return new CastStream(this.meta.blobId, aggregatorUrl)
  }

  toString(): string {
    return `[Siren:${this.meta.tier}] ${this.meta.title} · ${this.meta.priceLabel}`
  }

  toJSON(): SirenMetadata {
    return { ...this.meta }
  }

  static fromJSON(meta: SirenMetadata): Siren {
    return new Siren(meta)
  }
}

// ─── SirenClient ─────────────────────────────────────────────────────────────

export class SirenClient {
  private readonly samplePrice:       number
  private readonly walrusPublisher:   string
  private readonly walrusAggregator:  string
  private readonly defaultCategory?:  LighthouseCategory

  constructor(
    private readonly conk:   ConkClient,
    config: SirenClientConfig = {},
  ) {
    // Enforce floor — sample price can never go below Abyss floor
    this.samplePrice = Math.max(
      SIREN_ABYSS_FLOOR_USDC,
      config.samplePrice ?? SIREN_ABYSS_FLOOR_USDC,
    )
    this.walrusPublisher  = config.walrusPublisher  ?? WALRUS_PUBLISHER
    this.walrusAggregator = config.walrusAggregator ?? WALRUS_AGGREGATOR
    this.defaultCategory  = config.defaultCategory
  }

  /**
   * Upload audio and broadcast a Siren.
   * The Abyss always receives its floor. No exceptions.
   */
  async broadcast(
    vessel:  Vessel,
    options: SirenPublishOptions,
  ): Promise<Siren> {
    // Resolve price
    const priceUsdc =
      options.tier === 'sample'
        ? this.samplePrice
        : Math.max(
            SIREN_ABYSS_FLOOR_USDC,
            options.price ?? SIREN_ABYSS_FLOOR_USDC,
          )

    const priceUnits = Math.round(priceUsdc * 1_000_000)

    // Upload to Walrus
    const { blobId } = await this.upload(options.file, options.mediaType)

    // Build cast body with machine-readable metadata
    const bodyMeta = JSON.stringify({
      v:            1,
      type:         'siren',
      tier:         options.tier,
      mediaType:    options.mediaType ?? 'audio/mpeg',
      category:     options.category ?? this.defaultCategory,
      tags:         options.tags ?? [],
      blobId,
      lighthouseId: options.lighthouseId,
      beaconId:     vessel.id(),
    })

    const body = options.description
      ? `${options.description}\n\n${bodyMeta}`
      : bodyMeta

    const cast = await vessel.publish({
      hook:      options.title,
      body,
      price:     priceUsdc,
      mode:      'open',
      duration:  'permanent',
      attachment: blobId,
    })

    const meta: SirenMetadata = {
      castId:        cast.id,
      url:           cast.url,
      title:         options.title,
      description:   options.description,
      tier:          options.tier,
      priceUnits,
      priceLabel:    this.priceLabel(options.tier, priceUsdc),
      blobId,
      mediaType:     options.mediaType ?? 'audio/mpeg',
      category:      options.category ?? this.defaultCategory,
      tags:          options.tags ?? [],
      lighthouseId:  options.lighthouseId,
      beaconId:      vessel.id(),
      publishedAt:   Date.now(),
    }

    return new Siren(meta)
  }

  // ─── Walrus upload ────────────────────────────────────────────────────────

  private async upload(
    file:       File | Blob | Uint8Array,
    mediaType?: string,
  ): Promise<{ blobId: string }> {
    const mtype =
      mediaType ??
      (file instanceof File ? file.type : undefined) ??
      'audio/mpeg'

    const body =
      file instanceof Uint8Array
        ? file
        : new Uint8Array(await (file as File | Blob).arrayBuffer())

    const res = await withRetry(() =>
      fetch(`${this.walrusPublisher}/v1/store`, {
        method:  'PUT',
        headers: { 'Content-Type': mtype },
        body:    body as BodyInit,
      }),
    )

    if (!res.ok) {
      throw new ConkError(
        `Walrus upload failed: ${res.status} ${res.statusText}`,
        ConkErrorCode.UPLOAD_FAILED,
        { status: res.status },
      )
    }

    const data = await res.json() as {
      newlyCreated?:     { blobObject: { blobId: string } }
      alreadyCertified?: { blobId: string }
    }

    const blobId =
      data.newlyCreated?.blobObject?.blobId ??
      data.alreadyCertified?.blobId

    if (!blobId) {
      throw new ConkError(
        'Walrus upload returned no blobId',
        ConkErrorCode.UPLOAD_FAILED,
      )
    }

    return { blobId }
  }

  // ─── Price label ──────────────────────────────────────────────────────────

  private priceLabel(tier: SirenTier, priceUsdc: number): string {
    if (tier === 'sample') return `sample · $${priceUsdc.toFixed(3)}`
    return `$${priceUsdc.toFixed(3)}`
  }
}

// ─── SirenRegistry ───────────────────────────────────────────────────────────

export interface SirenSearchOptions {
  tier?:      SirenTier
  category?:  LighthouseCategory
  tags?:      string[]
  /** Only return Sirens that link to a Lighthouse */
  hasLighthouse?: boolean
  limit?:     number
  offset?:    number
}

export class SirenRegistry {
  private cache:         Siren[]  = []
  private lastFetchedAt: number   = 0
  private readonly cacheTtlMs     = 5 * 60 * 1_000

  constructor(private readonly conk: ConkClient) {}

  async search(options: SirenSearchOptions = {}): Promise<Siren[]> {
    await this.ensureFresh()

    let results = [...this.cache]

    if (options.tier) {
      results = results.filter((s) => s.tier === options.tier)
    }

    if (options.category) {
      results = results.filter((s) => s.category === options.category)
    }

    if (options.tags?.length) {
      results = results.filter((s) =>
        options.tags!.some((t) => s.tags.includes(t)),
      )
    }

    if (options.hasLighthouse) {
      results = results.filter((s) => !!s.lighthouseId)
    }

    const offset = options.offset ?? 0
    const limit  = options.limit  ?? 20
    return results.slice(offset, offset + limit)
  }

  addToCache(siren: Siren): void {
    const exists = this.cache.findIndex((s) => s.castId === siren.castId)
    if (exists >= 0) this.cache[exists] = siren
    else this.cache.push(siren)
  }

  invalidate(): void { this.lastFetchedAt = 0 }
  get size(): number { return this.cache.length }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.lastFetchedAt < this.cacheTtlMs && this.cache.length > 0) return
    // On-chain indexing hooks in here once the CONK indexer is live
    this.lastFetchedAt = Date.now()
  }
}
