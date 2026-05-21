/**
 * @axiomtide/conk-sdk — LighthouseRegistry (v11)
 *
 * On-chain LighthouseRegistry query helpers.
 *
 * The LighthouseRegistry is a shared object created at the CONK v11 deploy.
 * It holds a Table<castId, LighthouseEntry> — every Cast that earned Lighthouse
 * status is registered here atomically when lighthouse::raise() is called.
 *
 * Use isLighthouse() for O(1) existence checks composable from any consumer.
 * Use getLighthouseEntry() to fetch full metadata for a registered Cast.
 *
 * @example
 * import { isLighthouse, getLighthouseEntry } from '@axiomtide/conk-sdk'
 *
 * const lit = await isLighthouse(suiClient, castId)
 * if (lit) {
 *   const entry = await getLighthouseEntry(suiClient, castId)
 *   console.log(`Birth path: ${entry.birthPath}, reads at birth: ${entry.totalReadsAtBirth}`)
 * }
 */

import { SuiClient }            from '@mysten/sui/client'
import { LIGHTHOUSE_REGISTRY_ID } from './config'

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single entry in the on-chain LighthouseRegistry. */
export interface LighthouseEntry {
  castId:              string
  vesselId:            string
  lighthouseId:        string
  registeredAt:        number
  /** 1 = direct (1 × threshold reads in 24h) · 2 = tides (3 × tide threshold) */
  birthPath:           1 | 2
  totalReadsAtBirth:   number
  /** Timestamp of last lighthouse::visit() call (ms). Used for recency filtering. */
  lastVisitAt:         number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check whether a Cast is registered in the on-chain LighthouseRegistry.
 *
 * Uses a devInspect call to evaluate registry::contains() without
 * submitting a transaction. O(1).
 *
 * @param suiClient  Sui RPC client
 * @param castId     The Cast object ID to check
 * @returns          true if the Cast has earned Lighthouse status
 */
export async function isLighthouse(
  suiClient: SuiClient,
  castId:    string,
): Promise<boolean> {
  try {
    // Fetch the registry's dynamic fields — Table entries are stored as
    // dynamic fields keyed by the cast_id.
    // The Table key type is sui::object::ID (32 bytes).
    const fields = await suiClient.getDynamicFieldObject({
      parentId: LIGHTHOUSE_REGISTRY_ID,
      name: {
        type:  '0x2::object::ID',
        value: castId,
      },
    })
    return fields.data != null
  } catch {
    return false
  }
}

/**
 * Fetch a LighthouseEntry from the on-chain registry.
 *
 * Returns null if the Cast is not registered.
 *
 * @param suiClient  Sui RPC client
 * @param castId     The Cast object ID to look up
 */
export async function getLighthouseEntry(
  suiClient: SuiClient,
  castId:    string,
): Promise<LighthouseEntry | null> {
  try {
    const field = await suiClient.getDynamicFieldObject({
      parentId: LIGHTHOUSE_REGISTRY_ID,
      name: {
        type:  '0x2::object::ID',
        value: castId,
      },
    })
    if (!field.data) return null

    const content = field.data.content as {
      fields?: {
        value?: {
          fields?: Record<string, unknown>
        }
      }
    }
    const f = content?.fields?.value?.fields ?? {}

    return {
      castId:            String(f.cast_id            ?? castId),
      vesselId:          String(f.vessel_id          ?? ''),
      lighthouseId:      String(f.lighthouse_id      ?? ''),
      registeredAt:      Number(f.registered_at      ?? 0),
      birthPath:         (Number(f.birth_path)        === 2 ? 2 : 1) as 1 | 2,
      totalReadsAtBirth: Number(f.total_reads_at_birth ?? 0),
      lastVisitAt:       Number(f.last_visit_at       ?? 0),
    }
  } catch {
    return null
  }
}
