/**
 * @axiomtide/conk-sdk — VesselReputation
 *
 * Read a Vessel's on-chain reputation scores.
 *
 * In CONK v11 the Move contracts maintain a Reputation object co-located with
 * each Vessel. It tracks cast count, total earnings, reader count, and a
 * derived trust score used by agents when routing payments.
 *
 * @example
 * const rep = await getVesselReputation(suiClient, vesselId)
 * console.log(rep.trustScore, rep.totalEarnedUsdc)
 */

import { SuiClient }    from '@mysten/sui/client'
import { withRpcRetry } from './retry'
import { CONTRACTS }    from './config'
import { ConkError, ConkErrorCode } from './types'
import type { Network } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VesselReputation {
  /** On-chain object ID of the Vessel */
  vesselId:          string
  /** Number of casts published by this vessel */
  castCount:         number
  /** Unique reader addresses that have read at least one cast */
  uniqueReaderCount: number
  /** Total USDC earned across all casts (decimal, e.g. 12.34 = $12.34) */
  totalEarnedUsdc:   number
  /** Total number of read events recorded */
  totalReadCount:    number
  /**
   * Derived trust score in [0, 100].
   * Computed by the contract as a function of cast count, read volume,
   * and age. Higher is more trustworthy.
   */
  trustScore:        number
  /** Unix ms when the reputation object was last mutated on-chain */
  lastActivityAt:    number
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Fetch the reputation object for a given Vessel.
 *
 * Reads the `vessel::Reputation` dynamic field attached to the Vessel object.
 * Returns null if the Vessel has no reputation record yet (e.g. brand-new vessel).
 *
 * @param suiClient  Sui RPC client
 * @param vesselId   Vessel object ID
 * @param network    Network ('mainnet' | 'testnet' | 'devnet')
 */
export async function getVesselReputation(
  suiClient: SuiClient,
  vesselId:  string,
  network:   Network = 'mainnet',
): Promise<VesselReputation | null> {
  const contracts = CONTRACTS[network]

  try {
    // The Reputation is a dynamic field on the Vessel keyed by the module name
    const repField = await withRpcRetry(() =>
      suiClient.getDynamicFieldObject({
        parentId: vesselId,
        name: {
          type:  'vector<u8>',
          value: Array.from(new TextEncoder().encode('reputation')),
        },
      }),
    )

    const fields = (repField.data?.content as { fields?: Record<string, unknown> })?.fields
    if (!fields) return null

    return {
      vesselId,
      castCount:         Number(fields.cast_count         ?? 0),
      uniqueReaderCount: Number(fields.unique_reader_count ?? 0),
      totalEarnedUsdc:   Number(fields.total_earned        ?? 0) / 1_000_000,
      totalReadCount:    Number(fields.total_read_count    ?? 0),
      trustScore:        Number(fields.trust_score         ?? 0),
      lastActivityAt:    Number(fields.last_activity_at    ?? 0),
    }
  } catch {
    // Dynamic field missing → vessel has no reputation record yet
    return null
  }
}

/**
 * Fetch reputation for multiple vessels in parallel.
 * Silently returns null for any vessel without a record.
 */
export async function getVesselReputations(
  suiClient:  SuiClient,
  vesselIds:  string[],
  network:    Network = 'mainnet',
): Promise<Map<string, VesselReputation | null>> {
  const entries = await Promise.all(
    vesselIds.map(async (id) => {
      const rep = await getVesselReputation(suiClient, id, network)
      return [id, rep] as [string, VesselReputation | null]
    }),
  )
  return new Map(entries)
}
