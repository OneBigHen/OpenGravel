/**
 * The cache contract of §10–§11: an answer is fresh inside its TTL, may be
 * served marked stale for a bounded while after, and is gone after that. A
 * stale closure never stays current indefinitely.
 */

export type CacheRead<V> =
  | { readonly state: "fresh"; readonly value: V; readonly storedAt: number }
  | { readonly state: "stale"; readonly value: V; readonly storedAt: number }
  | { readonly state: "miss" };

export interface TtlCache<K, V> {
  read(key: K): CacheRead<V>;
  write(key: K, value: V): void;
  /** Loads through the cache, sharing one in-flight load per key. */
  load(key: K, loader: () => Promise<V>): Promise<V>;
}

export function createTtlCache<K, V>(options: {
  readonly ttlMs: number;
  readonly serveStaleMs: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}): TtlCache<K, V> {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 256;
  const entries = new Map<K, { readonly value: V; readonly storedAt: number }>();
  const inflight = new Map<K, Promise<V>>();

  const cache: TtlCache<K, V> = {
    read(key) {
      const entry = entries.get(key);
      if (entry === undefined) return { state: "miss" };
      const age = now() - entry.storedAt;
      if (age <= options.ttlMs) return { state: "fresh", value: entry.value, storedAt: entry.storedAt };
      if (age <= options.ttlMs + options.serveStaleMs) {
        return { state: "stale", value: entry.value, storedAt: entry.storedAt };
      }
      entries.delete(key);
      return { state: "miss" };
    },
    write(key, value) {
      entries.delete(key);
      entries.set(key, { value, storedAt: now() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    load(key, loader) {
      const pending = inflight.get(key);
      if (pending !== undefined) return pending;
      const started = loader().then(
        (value) => {
          inflight.delete(key);
          cache.write(key, value);
          return value;
        },
        (error: unknown) => {
          inflight.delete(key);
          throw error;
        },
      );
      inflight.set(key, started);
      return started;
    },
  };
  return cache;
}
