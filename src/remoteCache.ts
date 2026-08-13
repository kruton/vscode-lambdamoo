export interface CacheOptions<V> {
  readonly maxEntries: number;
  readonly maxWeight?: number;
  readonly weight?: (value: V) => number;
  readonly now?: () => number;
}

interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
  readonly weight: number;
}

export class BoundedTtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly maxWeight: number;
  private readonly weight: (value: V) => number;
  private readonly now: () => number;
  private totalWeight = 0;

  public constructor(private readonly options: CacheOptions<V>) {
    this.maxWeight = options.maxWeight ?? Number.POSITIVE_INFINITY;
    this.weight = options.weight ?? (() => 1);
    this.now = options.now ?? Date.now;
  }

  public getFresh(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      return undefined;
    }
    this.touch(key, entry);
    return entry.value;
  }

  public peek(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.touch(key, entry);
    return entry.value;
  }

  public set(key: K, value: V, ttlMs: number): boolean {
    const weight = this.weight(value);
    if (ttlMs <= 0 || weight > this.maxWeight || this.options.maxEntries <= 0) {
      this.delete(key);
      return false;
    }
    this.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs, weight });
    this.totalWeight += weight;
    while (this.entries.size > this.options.maxEntries || this.totalWeight > this.maxWeight) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) {
        break;
      }
      this.delete(oldest);
    }
    return this.entries.has(key);
  }

  public delete(key: K): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.totalWeight -= entry.weight;
      this.entries.delete(key);
    }
  }

  public deleteWhere(predicate: (key: K) => boolean): void {
    for (const key of this.entries.keys()) {
      if (predicate(key)) {
        this.delete(key);
      }
    }
  }

  public clear(): void {
    this.entries.clear();
    this.totalWeight = 0;
  }

  private touch(key: K, entry: CacheEntry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}

export class RequestCoalescer {
  private readonly requests = new Map<string, Promise<unknown>>();

  public run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const request = operation().finally(() => {
      if (this.requests.get(key) === request) {
        this.requests.delete(key);
      }
    });
    this.requests.set(key, request);
    return request;
  }

  public clear(): void {
    this.requests.clear();
  }

  public deleteWhere(predicate: (key: string) => boolean): void {
    for (const key of this.requests.keys()) {
      if (predicate(key)) {
        this.requests.delete(key);
      }
    }
  }
}
