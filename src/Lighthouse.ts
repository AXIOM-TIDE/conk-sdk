/**
 * @axiomtide/conk-sdk — Lighthouse
 *
 * A Lighthouse is a permanent, monetised content address on CONK.
 * Creators publish once. Buyers pay and stream or download forever.
 * No server. No platform cut. No takedowns.
 *
 * Flow:
 *   1. Creator uploads media to Walrus via conk.attachments.upload()
 *   2. Creator calls Lighthouse.publish() — creates a permanent Cast
 *   3. Buyers read the Cast, receive the blobId, stream via CastStream
 *   4. Creator receives USDC instantly on every read
 *
 * @example
 * // Creator side
 * const beacon = await Beacon.load(conk)
 * const light  = await beacon.publish({
 *   title:       'Untitled Project — Full Film',
 *   description: 'A feature-length documentary about ocean plastics.',
 *   mediaType:   'video/mp4',
 *   price:       3.00,
 *   permanent:   true,
 *   file:        filmFile,
 * })
 * console.log('Lighthouse live:', light.url)
 *
 * // Buyer side (via agent)
 * const result = await light.purchase(buyerVessel)
 * const stream = result.stream()
 * const bytes  = await stream.bytes()
 */

import { CastStream }  from './stream'
import { ConkError, ConkErrorCode } from './types'
import type { Vessel } from './Vessel'
import type { ReadResult, AutoResponse } from './types'

// ─── Media types ──────────────────────────────────────────────────────────────

export type MediaType =
  | 'video/mp4'
  | 'video/webm'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/flac'
  | 'application/pdf'
  | 'application/epub+zip'
  | 'application/zip'
  | 'application/json'
  | 'text/plain'
  | 'image/jpeg'
  | 'image/png'
  | (string & Record<never, never>)  // allow custom types

export type LighthouseCategory =
  | 'film'
  | 'short'
  | 'music'
  | 'album'
  | 'book'
  | 'article'
  | 'dataset'
  | 'software'
  | 'art'
  | 'other'

// ─── Options ──────────────────────────────────────────────────────────────────

export interface LighthousePublishOptions {
  /** Title shown on the cast hook */
  title:        string
  /** Short description — becomes the cast body preview */
  description:  string
  /** MIME type of the media */
  mediaType:    MediaType
  /** Category for registry discovery */
  category:     LighthouseCategory
  /** Price in USDC per access */
  price:        number
  /**
   * Whether to publish as permanent (no expiry).
   * Permanent lighthouses persist on Walrus indefinitely.
   * Default: true
   */
  permanent?:   boolean
  /** File to upload to Walrus before publishing */
  file:         File | Blob | Uint8Array
  /** File size in bytes (optional — used for display only) */
  fileSizeBytes?: number
  /** Optional auto-response sent to buyer after purchase */
  autoResponse?: AutoResponse
  /** Tags for registry discovery */
  tags?:        string[]
}

// ─── Lighthouse result ────────────────────────────────────────────────────────

export interface LighthousePurchaseResult {
  /** On-chain receipt */
  receipt:  ReadResult['receipt']
  /** Walrus blobId for the media */
  blobId:   string
  /** Media type of the content */
  mediaType: MediaType
  /** Open a stream to download/play the media */
  stream:   () => CastStream
  /** Auto-response from creator (if configured) */
  message?: string
}

export interface LighthouseMetadata {
  castId:        string
  url:           string
  title:         string
  description:   string
  mediaType:     MediaType
  category:      LighthouseCategory
  price:         number
  permanent:     boolean
  blobId:        string
  fileSizeBytes?: number
  tags:          string[]
  publishedAt:   number
  beaconId:      string
}

// ─── Lighthouse ───────────────────────────────────────────────────────────────

export class Lighthouse {
  constructor(private readonly meta: LighthouseMetadata) {}

  // ─── Identity ─────────────────────────────────────────────────────────────

  get castId():    string          { return this.meta.castId }
  get url():       string          { return this.meta.url }
  get title():     string          { return this.meta.title }
  get price():     number          { return this.meta.price }
  get mediaType(): MediaType       { return this.meta.mediaType }
  get category():  LighthouseCategory { return this.meta.category }
  get permanent(): boolean         { return this.meta.permanent }
  get blobId():    string          { return this.meta.blobId }
  get tags():      string[]        { return this.meta.tags }

  // ─── Purchase ─────────────────────────────────────────────────────────────

  /**
   * Purchase access to this lighthouse.
   * Pays the creator's vessel and returns the media stream.
   *
   * @example
   * const result = await lighthouse.purchase(agentVessel)
   * const text   = await result.stream().text()
   */
  async purchase(
    buyerVessel: Vessel,
    message?: string,
  ): Promise<LighthousePurchaseResult> {
    const result = await buyerVessel.read({
      castId:  this.meta.castId,
      message: message,
    })

    const blobId = result.attachment

    if (!blobId) {
      throw new ConkError(
        `Lighthouse ${this.meta.castId} has no media attachment`,
        ConkErrorCode.CAST_NOT_FOUND,
        { castId: this.meta.castId },
      )
    }

    return {
      receipt:   result.receipt,
      blobId,
      mediaType: this.meta.mediaType,
      stream:    () => new CastStream(blobId),
      message:   result.autoResponse?.body,
    }
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  toJSON(): LighthouseMetadata {
    return { ...this.meta }
  }

  static fromJSON(meta: LighthouseMetadata): Lighthouse {
    return new Lighthouse(meta)
  }

  // ─── Human-readable summary ───────────────────────────────────────────────

  toString(): string {
    const size = this.meta.fileSizeBytes
      ? ` · ${(this.meta.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
      : ''
    return (
      `[Lighthouse] ${this.meta.title} · ` +
      `${this.meta.category} · ` +
      `$${this.meta.price.toFixed(2)}${size} · ` +
      `${this.meta.permanent ? 'permanent' : 'temporary'}`
    )
  }
}
