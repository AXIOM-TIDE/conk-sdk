/**
 * @axiomtide/conk-sdk — Attachments
 * Walrus decentralised file storage. Upload before publishing a cast.
 */

import {
  WALRUS_PUBLISHER,
  WALRUS_AGGREGATOR,
} from './config'
import { ConkError, ConkErrorCode } from './types'
import type { UploadOptions, UploadResult } from './types'

const DEFAULT_MAX_MB = 5

export class Attachments {
  constructor(
    private readonly publisherUrl: string = WALRUS_PUBLISHER,
    private readonly aggregatorUrl: string = WALRUS_AGGREGATOR,
  ) {}

  /**
   * Upload a file to Walrus.
   * Returns a blobId you can attach to a cast via PublishOptions.attachment.
   */
  async upload(
    file: File | Blob | Uint8Array,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const maxBytes = (options.maxMB ?? DEFAULT_MAX_MB) * 1024 * 1024
    const size     = file instanceof Uint8Array ? file.byteLength : (file as File).size

    if (size > maxBytes) {
      throw new ConkError(
        `File size ${(size / 1024 / 1024).toFixed(2)} MB exceeds limit of ${options.maxMB ?? DEFAULT_MAX_MB} MB`,
        ConkErrorCode.UPLOAD_FAILED,
        { size, maxBytes },
      )
    }

    const mediaType =
      file instanceof File
        ? file.type || 'application/octet-stream'
        : 'application/octet-stream'

    const body =
      file instanceof Uint8Array
        ? file
        : file instanceof File
          ? new Uint8Array(await file.arrayBuffer())
          : new Uint8Array(await (file as Blob).arrayBuffer())

    const res = await fetch(`${this.publisherUrl}/v1/store`, {
      method:  'PUT',
      headers: { 'Content-Type': mediaType },
      body: body as BodyInit,
    })

    if (!res.ok) {
      throw new ConkError(
        `Walrus upload failed: ${res.status} ${res.statusText}`,
        ConkErrorCode.UPLOAD_FAILED,
        { status: res.status },
      )
    }

    const data = (await res.json()) as {
      newlyCreated?: { blobObject: { blobId: string } }
      alreadyCertified?: { blobId: string }
    }

    const blobId =
      data.newlyCreated?.blobObject?.blobId ??
      data.alreadyCertified?.blobId

    if (!blobId) {
      throw new ConkError(
        'Walrus upload returned no blobId',
        ConkErrorCode.UPLOAD_FAILED,
        { data },
      )
    }

    return {
      blobId,
      url:       `${this.aggregatorUrl}/v1/${blobId}`,
      size,
      mediaType,
    }
  }

  /**
   * Upload multiple files to Walrus and return a Cast-ready blob manifest.
   *
   * The manifest is JSON — pass it as the cast body (hook = title, body = manifest).
   * When a reader pays the Cast price, they receive the manifest and can fetch
   * each blob directly from the Walrus aggregator. No new protocol primitive needed.
   *
   * Supports files up to the Walrus per-blob limit (13.3 GiB). For files larger
   * than `chunkMB` (default 512MB), the file is split into chunks automatically.
   *
   * @example
   * const manifest = await conk.attachments.attachBlobs([
   *   { data: videoBuffer, name: 'film.mp4', mediaType: 'video/mp4' },
   *   { data: subtitlesBuffer, name: 'subs.vtt', mediaType: 'text/vtt' },
   * ])
   * // Then publish a Cast with body: JSON.stringify(manifest)
   * // Reader pays Cast price → gets manifest → fetches blobs from Walrus
   */
  async attachBlobs(
    files: Array<{
      data:       File | Blob | Uint8Array
      name:       string
      mediaType?: string
    }>,
    options: UploadOptions & {
      /** Max single-upload chunk size in MB. Files larger than this are split. Default: 512 */
      chunkMB?: number
    } = {},
  ): Promise<BlobManifest> {
    const chunkBytes = (options.chunkMB ?? 512) * 1024 * 1024
    const blobs: BlobManifestEntry[] = []

    for (const file of files) {
      const raw: Uint8Array =
        file.data instanceof Uint8Array
          ? file.data
          : new Uint8Array(await (file.data as Blob).arrayBuffer())

      const mediaType = file.mediaType ??
        (file.data instanceof File ? file.data.type : undefined) ??
        'application/octet-stream'

      if (raw.byteLength <= chunkBytes) {
        // Single upload
        const result = await this.upload(raw, { ...options, maxMB: Math.ceil(chunkBytes / 1024 / 1024) })
        blobs.push({
          name:      file.name,
          mediaType,
          blobId:    result.blobId,
          url:       result.url,
          sizeBytes: raw.byteLength,
          chunks:    1,
        })
      } else {
        // Multi-chunk upload — split into chunkBytes pieces
        const chunkIds: string[] = []
        let offset = 0
        let chunkIndex = 0

        while (offset < raw.byteLength) {
          const slice  = raw.slice(offset, offset + chunkBytes)
          const result = await this.upload(slice, { ...options, maxMB: Math.ceil(chunkBytes / 1024 / 1024) })
          chunkIds.push(result.blobId)
          offset += chunkBytes
          chunkIndex++
        }

        blobs.push({
          name:        file.name,
          mediaType,
          blobId:      chunkIds[0],   // primary blob for backward compat
          url:         this.url(chunkIds[0]),
          sizeBytes:   raw.byteLength,
          chunks:      chunkIds.length,
          chunkBlobIds: chunkIds,
        })
      }
    }

    return {
      version:     1,
      schema:      'conk:blob-manifest',
      totalBytes:  blobs.reduce((s, b) => s + b.sizeBytes, 0),
      blobCount:   blobs.length,
      aggregator:  this.aggregatorUrl,
      blobs,
    }
  }

  /**
   * Resolve a blobId to a publicly accessible URL.
   */
  url(blobId: string): string {
    return `${this.aggregatorUrl}/v1/${blobId}`
  }
}

// ─── Manifest types ───────────────────────────────────────────────────────────

export interface BlobManifestEntry {
  /** Original filename */
  name:         string
  /** MIME type */
  mediaType:    string
  /** Primary Walrus blobId (first chunk for multi-chunk files) */
  blobId:       string
  /** Direct Walrus aggregator URL for the primary blob */
  url:          string
  /** Total size of this file in bytes */
  sizeBytes:    number
  /** Number of chunks (1 = single blob, >1 = chunked large file) */
  chunks:       number
  /** All chunk blobIds in order — only present when chunks > 1 */
  chunkBlobIds?: string[]
}

export interface BlobManifest {
  /** Schema version */
  version:    number
  /** Schema identifier for Cast body parsers */
  schema:     'conk:blob-manifest'
  /** Total bytes across all files */
  totalBytes: number
  /** Number of files */
  blobCount:  number
  /** Walrus aggregator base URL for fetching blobs */
  aggregator: string
  /** File entries */
  blobs:      BlobManifestEntry[]
}
