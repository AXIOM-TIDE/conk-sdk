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
   * Resolve a blobId to a publicly accessible URL.
   */
  url(blobId: string): string {
    return `${this.aggregatorUrl}/v1/${blobId}`
  }
}
