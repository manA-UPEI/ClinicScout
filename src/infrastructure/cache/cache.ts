/**
 * Shared shape TtlCache and RedisCache both implement, so a call site written
 * against this interface doesn't change when which one backs it does.
 */
export interface Cache<T> {
  /** The value if present and still fresh, else undefined. */
  get(key: string): Promise<T | undefined>;
  /** The last known value regardless of age, or undefined if this key was never set. */
  getStale(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
}
