/**
 * @axiomtide/conk-sdk — Stream
 * Streaming delivery for large cast bodies via Walrus aggregator.
 *
 * For small casts (< 64KB) the body is returned inline in the Read tx.
 * For large casts the body is a Walrus blobId — stream it here.
 *
 * Usage:
 *   const stream = conk.stream(blobId)
 *   for await (const chunk of stream.chunks()) {
 *     process(chunk)
 *   }
 *   // or collect all:
 *   const text = await stream.text()
 *   const bytes = await stream.bytes()
 */

import { WALRUS_AGGREGATOR }    from './config'
import { ConkError, ConkErrorCode } from './types'

// ─── Chunk size ───────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_BYTES = 64 * 1024  // 64KB chunks

// ─── CastStream ──────────────────────────────────────────────────────────────

export class CastStream {
  private url: string

  constructor(
    private readonly blobId: string,
    private readonly aggregatorUrl: string = WALRUS_AGGREGATOR,
  ) {
    this.url = `${aggregatorUrl}/v1/${blobId}`
  }

  // ─── Async iterator — yields Uint8Array chunks ────────────────────────────

  async *chunks(chunkSize = DEFAULT_CHUNK_BYTES): AsyncGenerator<Uint8Array> {
    const res = await fetch(this.url)

    if (!res.ok) {
      throw new ConkError(
        `Stream fetch failed: ${res.status} ${res.statusText}`,
        ConkErrorCode.NETWORK_ERROR,
        { blobId: this.blobId, status: res.status },
      )
    }

    if (!res.body) {
      // No streaming support in this environment — fall back to full read
      const bytes = new Uint8Array(await res.arrayBuffer())
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        yield bytes.slice(offset, offset + chunkSize)
      }
      return
    }

    const reader = res.body.getReader()
    const buffer: Uint8Array[] = []
    let buffered = 0

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          // Flush remaining buffer
          if (buffered > 0) {
            yield mergeChunks(buffer, buffered)
          }
          break
        }

        buffer.push(value)
        buffered += value.length

        // Yield full chunks as they fill
        while (buffered >= chunkSize) {
          const merged  = mergeChunks(buffer, buffered)
          yield merged.slice(0, chunkSize)
          const remaining = merged.slice(chunkSize)
          buffer.length = 0
          if (remaining.length > 0) {
            buffer.push(remaining)
          }
          buffered = remaining.length
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ─── Convenience collectors ───────────────────────────────────────────────

  /** Collect all chunks and return as a single Uint8Array */
  async bytes(): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    let total = 0

    for await (const chunk of this.chunks()) {
      parts.push(chunk)
      total += chunk.length
    }

    return mergeChunks(parts, total)
  }

  /** Collect all chunks and decode as UTF-8 text */
  async text(): Promise<string> {
    const bytes   = await this.bytes()
    const decoder = new TextDecoder('utf-8')
    return decoder.decode(bytes)
  }

  /** Collect all chunks and parse as JSON */
  async json<T = unknown>(): Promise<T> {
    const text = await this.text()
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ConkError(
        'Stream content is not valid JSON',
        ConkErrorCode.NETWORK_ERROR,
        { blobId: this.blobId },
      )
    }
  }

  /**
   * Stream with progress reporting.
   * onProgress receives bytes received so far and total size (if known).
   */
  async *withProgress(
    onProgress: (received: number, total: number | null) => void,
  ): AsyncGenerator<Uint8Array> {
    const res = await fetch(this.url)

    if (!res.ok) {
      throw new ConkError(
        `Stream fetch failed: ${res.status}`,
        ConkErrorCode.NETWORK_ERROR,
        { blobId: this.blobId },
      )
    }

    const contentLength = res.headers.get('content-length')
    const total         = contentLength ? parseInt(contentLength, 10) : null
    let received        = 0

    for await (const chunk of this.chunks()) {
      received += chunk.length
      onProgress(received, total)
      yield chunk
    }
  }
}

// ─── Factory function ─────────────────────────────────────────────────────────

export function createStream(blobId: string, aggregatorUrl?: string): CastStream {
  return new CastStream(blobId, aggregatorUrl)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function mergeChunks(parts: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total)
  let offset   = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}
