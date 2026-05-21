/**
 * @axiomtide/conk-sdk — LighthouseIndex
 *
 * Query the on-chain LighthouseRegistry to verify whether a given Cast has
 * been raised as a Lighthouse and to retrieve its registry entry.
 *
 * In CONK v11 the LighthouseRegistry is a shared object. When a creator calls
 * lighthouse::raise(), a LighthouseEntry dynamic field is written into the
 * registry keyed by the Cast object ID. This module provides two lightweight
 * read-only helpers that agents can use before purchasing:
 *
 *   isLighthouse(suiClient, castId)          → boolean
 *   getLighthouseEntry(suiClient, castId)    → LighthouseEntry | null
 *
 * @example
 * const ok = await isLighthouse(suiClient, castId)
 * if (ok) {
 *   const entry = await getLighthouseEntry(suiClient, castId)
 *   console.log(entry?.beaconId, entry?.mediaType)
 * }
 */

import { SuiClient }    from '@mysten/sui/client'
import { withRpcRetry } from './retry'
import { LIGHTHOUSE_REGISTRY_ID } from './config'
import type { LighthouseCategory, MediaType } from './Lighthouse'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LighthouseEntry {
  /** Cast object ID of the lighthouse */
  castId:        string
  /** Vessel (Beacon) that raised it */
  beaconId:      string
  /** USDC price per access (decimal) */
  price:         number
  /** Content MIME type */
  mediaType:     MediaType
  /** Content category */
  category:      LighthouseCategory
  /** Walrus blob ID of the media */
  blobId:        string
  /** Whether the content is flagged as permanent */
  permanent:     boolean
  /** Tags for discovery */
  tags:          string[]
  /** Unix ms when the entry was raised */
  raisedAt:      number
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Check whether a Cast has been registered in the LighthouseRegistry.
 *
 * Pure read — no transaction required.
 *
 * @param suiClient   Sui RPC client
 * @param castId      Cast object ID to check
 * @param registryId  LighthouseRegistry object ID (defaults to mainnet constant)
 */
export async function isLighthouse(
  suiClient:  SuiClient,
  castId:     string,
  registryId: string = LIGHTHOUSE_REGISTRY_ID,
): Promise<boolean> {
  const entry = await getLighthouseEntry(suiClient, castId, registryId)
  return entry !== null
}

/**
 * Retrieve the LighthouseRegistry entry for a given Cast.
 *
 * Returns null if the Cast has not been raised as a Lighthouse.
 *
 * @param suiClient   Sui RPC client
 * @param castId      Cast object ID
 * @param registryId  LighthouseRegistry object ID (defaults to mainnet constant)
 */
export async function getLighthouseEntry(
  suiClient:  SuiClient,
  castId:     string,
  registryId: string = LIGHTHOUSE_REGISTRY_ID,
): Promise<LighthouseEntry | null> {
  try {
    // LighthouseEntry is stored as a dynamic field on the registry keyed by castId (ID type)
    const field = await withRpcRetry(() =>
      suiClient.getDynamicFieldObject({
        parentId: registryId,
        name: {
          type:  'address',
          value: castId,
        },
      }),
    )

    const fields = (field.data?.content as { fields?: Record<string, unknown> })?.fields
    if (!fields) return null

    const tags = Array.isArray(fields.tags)
      ? (fields.tags as string[])
      : []

    return {
      castId,
      beaconId:  String(fields.beacon_id  ?? ''),
      price:     Number(fields.price      ?? 0) / 1_000_000,
      mediaType: String(fields.media_type ?? 'application/octet-stream') as MediaType,
      category:  String(fields.category   ?? 'other') as LighthouseCategory,
      blobId:    String(fields.blob_id    ?? ''),
      permanent: Boolean(fields.permanent ?? false),
      tags,
      raisedAt:  Number(fields.raised_at  ?? 0),
    }
  } catch {
    return null
  }
}
