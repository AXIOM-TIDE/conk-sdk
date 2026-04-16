/**
 * @axiomtide/conk-sdk — Registry
 *
 * The Registry is how agents discover Lighthouses.
 * It is itself a set of CONK casts — a free-to-read directory of
 * Beacons and their published Lighthouses.
 *
 * Think of it as the browse page. An agent reads the Registry,
 * finds what its human wants, then purchases via the Lighthouse.
 *
 * @example
 * const registry = new Registry(conk)
 *
 * // Find all films under $5
 * const films = await registry.search({
 *   category: 'film',
 *   maxPrice: 5.00,
 * })
 *
 * // Find by tag
 * const jazz = await registry.search({ tags: ['jazz', 'instrumental'] })
 *
 * // Buy the first result
 * const result = await films[0].purchase(agentVessel)
 * const stream = result.stream()
 */

import { Lighthouse }     from './Lighthouse'
import { withRpcRetry }   from './retry'
import type { ConkClient } from './ConkClient'
import type { LighthouseMetadata, LighthouseCategory } from './Lighthouse'

// ─── Search options ───────────────────────────────────────────────────────────

export interface RegistrySearchOptions {
  category?:    LighthouseCategory
  tags?:        string[]
  maxPrice?:    number
  minPrice?:    number
  beaconId?:    string
  /** Max results to return (default: 20) */
  limit?:       number
  /** Offset for pagination */
  offset?:      number
}

export interface RegistryEntry {
  lighthouse:  Lighthouse
  beaconId:    string
  indexedAt:   number
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class Registry {
  private cache: RegistryEntry[] = []
  private lastFetchedAt: number  = 0
  private readonly cacheTtlMs    = 5 * 60 * 1000   // 5 minutes

  constructor(
    private readonly conk: ConkClient,
    private readonly registryCastId?: string,
  ) {}

  // ─── Search ───────────────────────────────────────────────────────────────

  /**
   * Search the registry for lighthouses.
   * Results are cached for 5 minutes.
   */
  async search(options: RegistrySearchOptions = {}): Promise<Lighthouse[]> {
    await this.ensureFresh()

    let results = this.cache.map((e) => e.lighthouse)

    if (options.category) {
      results = results.filter((l) => l.category === options.category)
    }

    if (options.tags && options.tags.length > 0) {
      results = results.filter((l) =>
        options.tags!.some((tag) => l.tags.includes(tag)),
      )
    }

    if (options.maxPrice !== undefined) {
      results = results.filter((l) => l.price <= options.maxPrice!)
    }

    if (options.minPrice !== undefined) {
      results = results.filter((l) => l.price >= options.minPrice!)
    }

    if (options.beaconId) {
      results = results.filter(
        (l) => (l.toJSON() as LighthouseMetadata).beaconId === options.beaconId,
      )
    }

    const offset = options.offset ?? 0
    const limit  = options.limit  ?? 20

    return results.slice(offset, offset + limit)
  }

  /** Get a single lighthouse by cast ID */
  async get(castId: string): Promise<Lighthouse | null> {
    await this.ensureFresh()
    const entry = this.cache.find((e) => e.lighthouse.castId === castId)
    return entry?.lighthouse ?? null
  }

  /** List all available categories in the registry */
  async categories(): Promise<LighthouseCategory[]> {
    await this.ensureFresh()
    const cats = new Set(this.cache.map((e) => e.lighthouse.category))
    return Array.from(cats) as LighthouseCategory[]
  }

  /** List all tags in the registry */
  async tags(): Promise<string[]> {
    await this.ensureFresh()
    const tags = new Set(this.cache.flatMap((e) => e.lighthouse.tags))
    return Array.from(tags)
  }

  // ─── Registry population (for beacon operators) ───────────────────────────

  /**
   * Add a lighthouse to the local registry cache.
   * Full on-chain registry indexing is handled by the CONK indexer —
   * this method is for local/private registries.
   */
  addToCache(lighthouse: Lighthouse): void {
    const existing = this.cache.findIndex(
      (e) => e.lighthouse.castId === lighthouse.castId,
    )

    const entry: RegistryEntry = {
      lighthouse,
      beaconId:  (lighthouse.toJSON() as LighthouseMetadata).beaconId,
      indexedAt: Date.now(),
    }

    if (existing >= 0) {
      this.cache[existing] = entry
    } else {
      this.cache.push(entry)
    }
  }

  removeFromCache(castId: string): void {
    this.cache = this.cache.filter((e) => e.lighthouse.castId !== castId)
  }

  // ─── Cache management ─────────────────────────────────────────────────────

  private async ensureFresh(): Promise<void> {
    const age = Date.now() - this.lastFetchedAt
    if (age < this.cacheTtlMs && this.cache.length > 0) return
    await this.fetchFromChain()
  }

  /**
   * Fetch the on-chain registry.
   *
   * The registry is a CONK cast whose body is a JSON array of
   * LighthouseMetadata objects. The CONK indexer maintains this cast.
   *
   * TODO: wire to actual registry cast ID once the CONK indexer is live.
   * For now, returns local cache only.
   */
  private async fetchFromChain(): Promise<void> {
    if (!this.registryCastId) {
      // No on-chain registry configured — local cache only
      this.lastFetchedAt = Date.now()
      return
    }

    try {
      const events = await withRpcRetry(() =>
        this.conk.suiClient.queryEvents({
          query: {
            MoveEventType: `${this.registryCastId}::registry::LighthouseIndexed`,
          },
          limit: 100,
          order: 'descending',
        }),
      )

      for (const event of events.data) {
        const parsed = event.parsedJson as LighthouseMetadata | undefined
        if (!parsed?.castId) continue
        const lighthouse = Lighthouse.fromJSON(parsed)
        this.addToCache(lighthouse)
      }

      this.lastFetchedAt = Date.now()
    } catch {
      // Registry fetch failing should not crash the SDK — use local cache
      this.lastFetchedAt = Date.now()
    }
  }

  /** Force a refresh on next search */
  invalidate(): void {
    this.lastFetchedAt = 0
  }

  get size(): number {
    return this.cache.length
  }
}
