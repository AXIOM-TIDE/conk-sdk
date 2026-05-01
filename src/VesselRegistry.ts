/**
 * @axiomtide/conk-sdk — VesselRegistry
 *
 * Discover CONK vessels by human-readable name.
 *
 * Vessel names are claimed by sounding a Cast with hook `[VESSEL:NAME] <name>`.
 * This registry queries CONK on-chain events to find those casts and return
 * structured entries.
 *
 * @example
 * const registry = new VesselRegistry(suiClient)
 * const entries  = await registry.findVessel({ name: 'alice' })
 * console.log(entries[0].vesselId)
 */

import { SuiClient }    from '@mysten/sui/client'
import { withRpcRetry } from './retry'
import { CONTRACTS }    from './config'
import type { Network } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VesselEntry {
  /** On-chain object ID of the vessel */
  vesselId:  string
  /** Human-readable name claimed by the vessel */
  name:      string
  /** Cast ID that carries the name claim */
  castId:    string
  /** Transaction digest of the name-claim sound */
  txDigest:  string
  /** Unix timestamp (ms) when the name was claimed */
  timestamp: number
}

export interface FindVesselOptions {
  /** Filter by exact name (case-insensitive) */
  name?:     string
  /** Filter by vessel object ID */
  vesselId?: string
  /** Maximum results to return (default: 50) */
  limit?:    number
}

// ─── Hook prefix used by vessel.claimName() ───────────────────────────────────

const VESSEL_NAME_HOOK_PREFIX = '[VESSEL:NAME]'

// ─── VesselRegistry ───────────────────────────────────────────────────────────

export class VesselRegistry {
  constructor(
    private readonly suiClient: SuiClient,
    private readonly network: Network = 'mainnet',
  ) {}

  /**
   * Query CONK on-chain events for vessel name claims and return matches.
   *
   * Events are queried from the `cast` module of the CONK package,
   * filtered by the `[VESSEL:NAME]` hook prefix in each event's parsedJson.
   *
   * @param options  name and/or vesselId filter, plus optional limit
   */
  async findVessel(options: FindVesselOptions = {}): Promise<VesselEntry[]> {
    const contracts = CONTRACTS[this.network]
    const limit     = options.limit ?? 50

    // Fetch a batch of events from the cast module — we over-fetch to allow
    // for hook filtering (most events won't be name claims)
    const batchSize = Math.min(limit * 10, 500)

    const events = await withRpcRetry(() =>
      this.suiClient.queryEvents({
        query: { MoveModule: { package: contracts.package, module: 'cast' } },
        limit: batchSize,
        order: 'descending',
      }),
    )

    const results: VesselEntry[] = []

    for (const event of events.data) {
      const parsed = (event.parsedJson ?? {}) as Record<string, unknown>

      // hook may be raw string or bytes-decoded string depending on indexer
      const hook = parsed.hook as string | undefined
      if (!hook?.startsWith(VESSEL_NAME_HOOK_PREFIX)) continue

      const name     = hook.slice(VESSEL_NAME_HOOK_PREFIX.length).trim()
      const vesselId = (
        parsed.vessel_id ??
        parsed.vesselId  ??
        ''
      ) as string
      const castId   = (
        parsed.cast_id ??
        parsed.castId  ??
        ''
      ) as string

      // Apply name filter (case-insensitive)
      if (options.name && name.toLowerCase() !== options.name.toLowerCase()) continue

      // Apply vesselId filter
      if (options.vesselId && vesselId !== options.vesselId) continue

      results.push({
        vesselId,
        name,
        castId,
        txDigest:  event.id.txDigest,
        timestamp: Number(event.timestampMs ?? Date.now()),
      })

      if (results.length >= limit) break
    }

    return results
  }
}
