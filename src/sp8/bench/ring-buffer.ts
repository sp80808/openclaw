/**
 * Generic fixed-capacity ring buffer.
 * Overwrites oldest entries when full — ideal for bounded trajectory storage.
 * Memory: O(capacity) with zero allocation after initialization.
 */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = Array.from<T | undefined>({ length: capacity });
  }

  /** Push an item, overwriting the oldest if at capacity. */
  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count += 1;
    }
  }

  /** Number of items currently stored. */
  get size(): number {
    return this.count;
  }

  /** Return all stored items in insertion order (oldest first). */
  toArray(): T[] {
    if (this.count === 0) {
      return [];
    }
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let idx = 0; idx < this.count; idx += 1) {
      const pos = (start + idx) % this.capacity;
      const item = this.items[pos];
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }

  /** Get the most recent N items (newest first). */
  recent(n: number): T[] {
    const all = this.toArray();
    return all.slice(Math.max(0, all.length - n)).toReversed();
  }

  /** Clear all entries. */
  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /** Restore from a serialized array + head pointer. */
  static fromSnapshot<T>(items: T[], head: number, capacity: number): RingBuffer<T> {
    const buf = new RingBuffer<T>(capacity);
    const effective = items.slice(0, capacity);
    for (let idx = 0; idx < effective.length; idx += 1) {
      buf.items[idx] = effective[idx];
    }
    buf.head = head % capacity;
    buf.count = effective.length;
    return buf;
  }

  /** Serialize to a plain snapshot for JSON persistence. */
  snapshot(): { items: T[]; head: number } {
    return {
      items: this.toArray(),
      head: this.head,
    };
  }
}
