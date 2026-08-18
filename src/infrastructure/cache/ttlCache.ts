import type { Coordinates } from "../../domain/entities/clinic.ts";

/**
 * Rounds to ~1.1km of precision so re-typing a location slightly differently,
 * or Nominatim returning a marginally different point for the same place,
 * still lands on the same cache entry — the point is caching a search area,
 * not a single exact coordinate.
 */
export function cacheKey(location: Coordinates, radius_km: number): string {
  return `${location.lat.toFixed(2)},${location.lon.toFixed(2)}@${radius_km.toFixed(1)}`;
}

/**
 * A small in-memory TTL cache. Good enough for a single long-running Node
 * process (`next dev` / `next start`) — there is no shared store across
 * serverless invocations, and this app doesn't run on one.
 *
 * `now` is injectable so freshness can be tested without real timers, the
 * same pattern domain/policies/openingHours.ts uses for its own clock dependency.
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  // Written out instead of constructor parameter properties: Node's
  // strip-only TypeScript execution (the raw `node --test` runner) can erase
  // type annotations but not this shorthand, since it also declares fields.
  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** The value if present and still fresh, else undefined. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry || this.now() > entry.expiresAt) return undefined;
    return entry.value;
  }

  /**
   * The last known value regardless of age, or undefined if this key was
   * never set. The fallback for "the upstream service failed and honestly
   * stale data beats no data at all."
   */
  getStale(key: string): T | undefined {
    return this.store.get(key)?.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
