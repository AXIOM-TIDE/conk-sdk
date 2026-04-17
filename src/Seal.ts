/**
 * @axiomtide/conk-sdk — Seal
 *
 * Threshold encryption for CONK content using Mysten Labs SEAL.
 *
 * How it works:
 *   1. Publisher encrypts content with SEAL before uploading to Walrus
 *   2. SEAL policy: "only vessels that have paid for this cast can decrypt"
 *   3. After payment, buyer requests decryption key shares from SEAL nodes
 *   4. SEAL verifies the on-chain payment transaction
 *   5. If verified, SEAL releases key shares — buyer decrypts locally
 *
 * Nobody except the paying buyer can read the content.
 * Not the author. Not Mysten. Not Axiom Tide. Not the SEAL nodes.
 *
 * @example
 * // Publisher side
 * const seal   = new SealClient(conk)
 * const result = await seal.encrypt(filmBytes, {
 *   castId:      cast.id,
 *   authorAddress: vessel.address(),
 * })
 * // result.encryptedBlobId → store in cast attachment
 * // result.policyId        → store in cast body metadata
 *
 * // Buyer side — after paying
 * const decrypted = await seal.decrypt(encryptedBlobId, {
 *   castId:    cast.id,
 *   txDigest:  receipt.txDigest,
 *   session:   zkLoginSession,
 * })
 * // decrypted → Uint8Array of original content
 */

import { CastStream }        from './stream'
import { withRetry }         from './retry'
import { WALRUS_PUBLISHER, WALRUS_AGGREGATOR } from './config'
import { ConkError, ConkErrorCode } from './types'
import type { ConkClient }   from './ConkClient'
import type { ZkLoginSession } from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SEAL_SERVER       = 'https://seal.mystenlabs.com'
const SEAL_KEY_SIZE     = 32   // AES-256
const SEAL_NONCE_SIZE   = 12   // GCM nonce

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SealEncryptOptions {
  /** The cast ID this content belongs to */
  castId:        string
  /** Author vessel address */
  authorAddress: string
  /** Optional: restrict decryption to a specific vessel address */
  recipientAddress?: string
}

export interface SealEncryptResult {
  /** Walrus blobId of the encrypted content */
  encryptedBlobId: string
  /** SEAL policy ID — store this in cast metadata */
  policyId:        string
  /** IV/nonce used — store alongside policyId */
  iv:              string
  /** Size of original content in bytes */
  originalSize:    number
}

export interface SealDecryptOptions {
  /** The cast ID to verify payment for */
  castId:    string
  /** Transaction digest proving payment */
  txDigest:  string
  /** Current zkLogin session for identity proof */
  session:   ZkLoginSession
}

export interface SealPolicy {
  castId:          string
  authorAddress:   string
  recipientAddress?: string
  createdAt:       number
  network:         string
}

// ─── SealClient ──────────────────────────────────────────────────────────────

export class SealClient {
  private readonly sealServer:      string
  private readonly walrusPublisher:  string
  private readonly walrusAggregator: string

  constructor(
    private readonly conk: ConkClient,
    options: {
      sealServer?:       string
      walrusPublisher?:  string
      walrusAggregator?: string
    } = {},
  ) {
    this.sealServer       = options.sealServer       ?? SEAL_SERVER
    this.walrusPublisher  = options.walrusPublisher  ?? WALRUS_PUBLISHER
    this.walrusAggregator = options.walrusAggregator ?? WALRUS_AGGREGATOR
  }

  // ─── Encrypt ──────────────────────────────────────────────────────────────

  /**
   * Encrypt content and upload to Walrus.
   * Call this before publishing a sealed cast.
   *
   * Returns encryptedBlobId and policyId — store both in the cast body metadata.
   */
  async encrypt(
    content: Uint8Array | File | Blob,
    options: SealEncryptOptions,
  ): Promise<SealEncryptResult> {
    const bytes =
      content instanceof Uint8Array
        ? content
        : new Uint8Array(await (content as File | Blob).arrayBuffer())

    // 1. Register policy with SEAL server
    const policy: SealPolicy = {
      castId:           options.castId,
      authorAddress:    options.authorAddress,
      recipientAddress: options.recipientAddress,
      createdAt:        Date.now(),
      network:          this.conk.network,
    }

    const policyRes = await withRetry(() =>
      fetch(`${this.sealServer}/v1/policy/create`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(policy),
      }),
    )

    if (!policyRes.ok) {
      throw new ConkError(
        `SEAL policy creation failed: ${policyRes.status}`,
        ConkErrorCode.PROOF_GENERATION_FAILED,
        { status: policyRes.status },
      )
    }

    const { policyId, encryptionKey } = await policyRes.json() as {
      policyId:      string
      encryptionKey: string  // hex-encoded AES key from SEAL
    }

    // 2. Encrypt content locally with the SEAL-provided key
    const { encryptedBytes, iv } = await this.encryptAES(
      bytes,
      hexToBytes(encryptionKey),
    )

    // 3. Upload encrypted bytes to Walrus
    const uploadRes = await withRetry(() =>
      fetch(`${this.walrusPublisher}/v1/store`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body:    encryptedBytes as BodyInit,
      }),
    )

    if (!uploadRes.ok) {
      throw new ConkError(
        `Walrus upload failed: ${uploadRes.status}`,
        ConkErrorCode.UPLOAD_FAILED,
        { status: uploadRes.status },
      )
    }

    const uploadData = await uploadRes.json() as {
      newlyCreated?:     { blobObject: { blobId: string } }
      alreadyCertified?: { blobId: string }
    }

    const encryptedBlobId =
      uploadData.newlyCreated?.blobObject?.blobId ??
      uploadData.alreadyCertified?.blobId

    if (!encryptedBlobId) {
      throw new ConkError('Walrus upload returned no blobId', ConkErrorCode.UPLOAD_FAILED)
    }

    return {
      encryptedBlobId,
      policyId,
      iv:           bytesToHex(iv),
      originalSize: bytes.byteLength,
    }
  }

  // ─── Decrypt ──────────────────────────────────────────────────────────────

  /**
   * Decrypt content after payment.
   * SEAL verifies the on-chain payment and releases the decryption key.
   */
  async decrypt(
    encryptedBlobId: string,
    policyId:        string,
    ivHex:           string,
    options:         SealDecryptOptions,
  ): Promise<Uint8Array> {
    // 1. Request decryption key from SEAL — proves payment on-chain
    const keyRes = await withRetry(() =>
      fetch(`${this.sealServer}/v1/decrypt/request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          policyId:     policyId,
          castId:       options.castId,
          txDigest:     options.txDigest,
          address:      options.session.address,
          network:      this.conk.network,
          // Proof of identity — session proof verifies the address
          proof:        options.session.proof,
          maxEpoch:     options.session.maxEpoch,
        }),
      }),
    )

    if (!keyRes.ok) {
      const errorData = await keyRes.json().catch(() => ({})) as { error?: string }
      throw new ConkError(
        `SEAL decryption denied: ${errorData.error ?? keyRes.status}. Ensure payment is confirmed on-chain.`,
        ConkErrorCode.PROOF_GENERATION_FAILED,
        { status: keyRes.status, castId: options.castId },
      )
    }

    const { decryptionKey } = await keyRes.json() as { decryptionKey: string }

    // 2. Fetch encrypted content from Walrus
    const stream = new CastStream(encryptedBlobId, this.walrusAggregator)
    const encryptedBytes = await stream.bytes()

    // 3. Decrypt locally — SEAL server never sees the plaintext
    const decrypted = await this.decryptAES(
      encryptedBytes,
      hexToBytes(decryptionKey),
      hexToBytes(ivHex),
    )

    return decrypted
  }

  // ─── AES-GCM encryption helpers ───────────────────────────────────────────

  private async encryptAES(
    plaintext: Uint8Array,
    key:       Uint8Array,
  ): Promise<{ encryptedBytes: Uint8Array; iv: Uint8Array }> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw', key, { name: 'AES-GCM' }, false, ['encrypt'],
    )

    const iv = crypto.getRandomValues(new Uint8Array(SEAL_NONCE_SIZE))

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      plaintext,
    )

    // Prepend IV to encrypted bytes for storage
    const result = new Uint8Array(SEAL_NONCE_SIZE + encrypted.byteLength)
    result.set(iv, 0)
    result.set(new Uint8Array(encrypted), SEAL_NONCE_SIZE)

    return { encryptedBytes: result, iv }
  }

  private async decryptAES(
    encryptedWithIv: Uint8Array,
    key:             Uint8Array,
    _ivFromMeta:     Uint8Array,  // IV is prepended to the blob
  ): Promise<Uint8Array> {
    // Extract IV from the first 12 bytes
    const iv        = encryptedWithIv.slice(0, SEAL_NONCE_SIZE)
    const encrypted = encryptedWithIv.slice(SEAL_NONCE_SIZE)

    const cryptoKey = await crypto.subtle.importKey(
      'raw', key, { name: 'AES-GCM' }, false, ['decrypt'],
    )

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encrypted,
    )

    return new Uint8Array(decrypted)
  }

  // ─── Policy verification (for author to check who has access) ─────────────

  async getPolicyAccess(policyId: string): Promise<{
    totalDecryptions: number
    uniqueAddresses:  number
  }> {
    const res = await withRetry(() =>
      fetch(`${this.sealServer}/v1/policy/${policyId}/stats`),
    )

    if (!res.ok) return { totalDecryptions: 0, uniqueAddresses: 0 }

    return res.json() as Promise<{
      totalDecryptions: number
      uniqueAddresses:  number
    }>
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace('0x', '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

/**
 * Build SEAL metadata to embed in cast body JSON.
 * Store this alongside the blobId so buyers can decrypt.
 */
export function buildSealMetadata(result: SealEncryptResult): Record<string, unknown> {
  return {
    seal:            true,
    policyId:        result.policyId,
    encryptedBlobId: result.encryptedBlobId,
    iv:              result.iv,
    originalSize:    result.originalSize,
  }
}

/**
 * Parse SEAL metadata from cast body JSON.
 */
export function parseSealMetadata(body: string): {
  isSeal:          boolean
  policyId?:       string
  encryptedBlobId?: string
  iv?:             string
  originalSize?:   number
} {
  try {
    // Find JSON block in body
    const jsonMatch = body.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { isSeal: false }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    if (!parsed.seal) return { isSeal: false }

    return {
      isSeal:          true,
      policyId:        parsed.policyId as string,
      encryptedBlobId: parsed.encryptedBlobId as string,
      iv:              parsed.iv as string,
      originalSize:    parsed.originalSize as number,
    }
  } catch {
    return { isSeal: false }
  }
}
