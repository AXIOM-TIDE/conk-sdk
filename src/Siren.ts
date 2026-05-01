/**
 * @axiomtide/conk-sdk — Siren
 *
 * Sirens are the discovery and marketing layer of CONK.
 * A Siren is a permanent audio broadcast with full author payment options —
 * the same control an author has over a Cast, applied to audio.
 *
 * Two tiers:
 *   'sample' — $0.03 publishing fee → Abyss. Per-play price set by author.
 *              Sample plays route 97% → author vessel · 3% → treasury.
 *              $0 per-play = pure marketing. Any price above = revenue.
 *
 *   'paid'   — author sets per-play price freely.
 *              Same 97/3 split. Same mode options. Same auto-response.
 *              $0.03 Abyss floor on publish is still non-negotiable.
 *
 * Author options mirror Cast exactly:
 *   - Price:        author sets it (0 to any amount)
 *   - Mode:         open | burn | eyes_only
 *   - Auto-response: triggered on every play
 *   - Linked lighthouse: agents follow this to purchase full media
 *
 * Payment flow (per play):
 *   buyer pays → 97% → author vessel address
 *               → 3%  → treasury
 *   (Abyss floor paid once at publish time, not per play)
 *
 * @example
 * const sirens = new SirenClient(conk)
 *
 * const siren = await sirens.broadcast(vessel, {
 *   title:       'The Deep — 60s preview',
 *   tier:        'sample',
 *   price:       0,            // pure marketing — author still gets 97% of 0
 *   mode:        'open',
 *   file:        previewFile,
 *   autoResponse: {
 *     message: 'Full film on lighthouse — conk.app/cast/0x...',
 *   },
 *   lighthouseId: filmCastId,
 * })
 */

import { CastStream }        from './stream'
import { withRetry }         from './retry'
import { WALRUS_PUBLISHER, WALRUS_AGGREGATOR, AUTHOR_SHARE, TREASURY_SHARE } from './config'
import { ConkError, ConkErrorCode } from './types'
import type { ConkClient }   from './ConkClient'
import type { Vessel }       from './Vessel'
import type { CastMode, AutoResponse } from './types'
import type { LighthouseCategory } from './Lighthouse'

// ─── Constants ────────────────────────────────────────────────────────────────

/** One-time publishing fee to Abyss. Non-negotiable. */
export const SIREN_ABYSS_FLOOR_USDC  = 0.03
export const SIREN_ABYSS_FLOOR_UNITS = 30_000

// ─── Siren tier ───────────────────────────────────────────────────────────────

export type SirenTier = 'sample' | 'paid'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SirenClientConfig {
  /** Default category. Can be overridden per-broadcast. */
  defaultCategory?:  LighthouseCategory
  /** Custom Walrus endpoints — defaults to production walrus.site. */
  walrusPublisher?:  string
  walrusAggregator?: string
}

// ─── Publish options — mirrors Cast options + audio-specific fields ───────────

export interface SirenPublishOptions {
  title:        string
  description?: string
  tier:         SirenTier

  /** Audio file — MP3, WAV, FLAC, any format */
  file:         File | Blob | Uint8Array
  mediaType?:   string

  /**
   * Per-play price in USDC (e.g. 0.05).
   * 0 = author uses Siren purely as marketing — still earns 97% of 0.
   * Any amount routes 97% to author vessel, 3% to treasury.
   * Default: 0
   */
  price?:       number

  /**
   * Cast mode — same options as a regular Cast.
   *   'open'      — anyone can play
   *   'burn'      — plays once per vessel, then access expires
   *   'eyes_only' — content is not stored after play
   * Default: 'open'
   */
  mode?:        CastMode

  /**
   * Auto-response sent to the player after each play.
   * Use this to deliver a link to the full Lighthouse, contact info,
   * tour dates, purchase instructions, or any follow-up message.
   */
  autoResponse?: {
    message: string
    /** Send on every play, not just first. Default: true */
    triggerOnEveryPlay?: boolean
  }

  category?:     LighthouseCategory
  tags?:         string[]

  /**
   * Link to a Lighthouse castId.
   * Agents follow this to purchase the full media after evaluating the sample.
   */
  lighthouseId?: string
}

// ─── Siren metadata ───────────────────────────────────────────────────────────

export interface SirenMetadata {
  castId:           string
  url:              string
  title:            string
  description?:     string
  tier:             SirenTier
  /** Per-play price in USDC base units */
  priceUnits:       number
  /** Human-readable price */
  priceLabel:       string
  /** Author's vessel address — receives 97% of every play */
  authorAddress:    string
  /** Author's vessel ID — for registry lookup */
  beaconId:         string
  mode:             CastMode
  blobId:           string
  mediaType:        string
  category?:        LighthouseCategory
  tags:             string[]
  lighthouseId?:    string
  autoResponse?:    { message: string; triggerOnEveryPlay: boolean }
  publishedAt:      number
}

// ─── Siren ────────────────────────────────────────────────────────────────────

export class Siren {
  constructor(private readonly meta: SirenMetadata) {}

  get castId():       string              { return this.meta.castId }
  get url():          string              { return this.meta.url }
  get title():        string              { return this.meta.title }
  get tier():         SirenTier           { return this.meta.tier }
  get priceLabel():   string              { return this.meta.priceLabel }
  get priceUnits():   number              { return this.meta.priceUnits }
  get authorAddress(): string             { return this.meta.authorAddress }
  get mode():         CastMode            { return this.meta.mode }
  get blobId():       string              { return this.meta.blobId }
  get mediaType():    string              { return this.meta.mediaType }
  get category():     LighthouseCategory | undefined { return this.meta.category }
  get tags():         string[]            { return this.meta.tags }
  get lighthouseId(): string | undefined  { return this.meta.lighthouseId }
  get autoResponse(): SirenMetadata['autoResponse'] { return this.meta.autoResponse }

  /** What the author earns per play in USDC base units */
  get authorEarningsPerPlay(): number {
    return Math.floor(this.meta.priceUnits * AUTHOR_SHARE)
  }

  /** Open a stream to play or download the audio */
  stream(aggregatorUrl?: string): CastStream {
    return new CastStream(this.meta.blobId, aggregatorUrl)
  }

  toString(): string {
    return `[Siren:${this.meta.tier}] ${this.meta.title} · ${this.meta.priceLabel} · ${this.meta.mode}`
  }

  toJSON(): SirenMetadata { return { ...this.meta } }

  static fromJSON(meta: SirenMetadata): Siren {
    return new Siren(meta)
  }
}

// ─── SirenClient ─────────────────────────────────────────────────────────────

export class SirenClient {
  private readonly walrusPublisher:  string
  private readonly walrusAggregator: string
  private readonly defaultCategory?: LighthouseCategory

  constructor(
    private readonly conk: ConkClient,
    config: SirenClientConfig = {},
  ) {
    this.walrusPublisher  = config.walrusPublisher  ?? WALRUS_PUBLISHER
    this.walrusAggregator = config.walrusAggregator ?? WALRUS_AGGREGATOR
    this.defaultCategory  = config.defaultCategory
  }

  /**
   * Upload audio and broadcast a Siren.
   *
   * Publishing always pays $0.03 → Abyss (one-time network fee).
   * Per-play payments route 97% → author vessel, 3% → treasury.
   */
  async broadcast(
    vessel:  Vessel,
    options: SirenPublishOptions,
  ): Promise<Siren> {
    const priceUsdc  = options.price ?? 0
    const priceUnits = Math.round(priceUsdc * 1_000_000)
    const mode       = options.mode ?? 'open'

    // Upload audio to Walrus
    const { blobId } = await this.upload(options.file, options.mediaType)

    // Build auto-response for Cast — carries author's follow-up message
    const castAutoResponse: AutoResponse | undefined = options.autoResponse
      ? {
          hook:               options.autoResponse.message.slice(0, 80),
          body:               options.autoResponse.message,
          triggerOnEveryRead: options.autoResponse.triggerOnEveryPlay ?? true,
        }
      : {
          // Default auto-response routes listener to the Lighthouse if linked
          hook:               options.lighthouseId
            ? 'Full media available'
            : 'Thanks for listening',
          body:               options.lighthouseId
            ? `Purchase the full release: conk.app/cast/${options.lighthouseId}`
            : `Powered by CONK · conk.app`,
          triggerOnEveryRead: true,
        }

    // Machine-readable metadata agents can parse
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
      authorAddress: vessel.address(),
      // Payment routing — agents read this to know where money goes
      payment: {
        priceUnits,
        authorShare:   AUTHOR_SHARE,
        treasuryShare: TREASURY_SHARE,
        abyssFloor:    SIREN_ABYSS_FLOOR_UNITS,
      },
    })

    const body = options.description
      ? `${options.description}\n\n${bodyMeta}`
      : bodyMeta

    // Publish the Cast — vessel.publish() handles the on-chain transaction
    const cast = await vessel.publish({
      hook:         options.title,
      body,
      price:        priceUsdc,
      mode,
      duration:     'permanent',
      attachment:   blobId,
      autoResponse: castAutoResponse,
    })

    const meta: SirenMetadata = {
      castId:        cast.id,
      url:           cast.url,
      title:         options.title,
      description:   options.description,
      tier:          options.tier,
      priceUnits,
      priceLabel:    this.priceLabel(options.tier, priceUsdc),
      authorAddress: vessel.address(),
      beaconId:      vessel.id(),
      mode,
      blobId,
      mediaType:     options.mediaType ?? 'audio/mpeg',
      category:      options.category ?? this.defaultCategory,
      tags:          options.tags ?? [],
      lighthouseId:  options.lighthouseId,
      autoResponse:  options.autoResponse
        ? {
            message:           options.autoResponse.message,
            triggerOnEveryPlay: options.autoResponse.triggerOnEveryPlay ?? true,
          }
        : undefined,
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
      throw new ConkError('Walrus upload returned no blobId', ConkErrorCode.UPLOAD_FAILED)
    }

    return { blobId }
  }

  // ─── Price label ──────────────────────────────────────────────────────────

  private priceLabel(tier: SirenTier, priceUsdc: number): string {
    if (priceUsdc === 0) {
      return tier === 'sample' ? 'sample · $0.03 publish fee' : 'open'
    }
    return `$${priceUsdc.toFixed(3)} · ${tier}`
  }
}

// ─── SirenRegistry ───────────────────────────────────────────────────────────

export interface SirenSearchOptions {
  tier?:           SirenTier
  category?:       LighthouseCategory
  tags?:           string[]
  hasLighthouse?:  boolean
  /** Only return Sirens that pay authors */
  isPaid?:         boolean
  limit?:          number
  offset?:         number
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
      results = results.filter((s) => options.tags!.some((t) => s.tags.includes(t)))
    }
    if (options.hasLighthouse) {
      results = results.filter((s) => !!s.lighthouseId)
    }
    if (options.isPaid) {
      results = results.filter((s) => s.priceUnits > 0)
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
    this.lastFetchedAt = Date.now()
  }
}
