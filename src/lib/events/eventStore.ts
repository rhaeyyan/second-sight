import type { IronsightEvent } from './schema';

/**
 * IRONSIGHT polls 50+ sources continuously with no backend and no persistence — every
 * event lives in browser memory for the lifetime of the tab. Without a cap, a long-running
 * session (this is meant to stay open during a live conflict) accumulates events until the
 * tab crashes. This store is the fix: a fixed-capacity ring that evicts the oldest events
 * once full, so memory is bounded regardless of how long the dashboard has been open.
 *
 * Eviction is keyed on `ingestedAt` rather than `reportedAt` or `occurredAt` because those
 * are attacker/source-controlled (a feed can backdate a pubDate) and because eviction exists
 * to bound *our* memory growth, which tracks when *we* pulled the event in, not when the
 * source claims it happened. `getAll()` still sorts newest-first by `reportedAt` for display,
 * since that's the timeline users care about — the two orderings serve different concerns.
 *
 * Re-ingestion is idempotent on `event.id`: the same adapter polls the same source on an
 * interval, so the same event routinely arrives again on a later poll (e.g. a headline gets
 * corroborated and its verificationStatus changes). Keying on id lets a later poll update a
 * previously-seen event's fields in place instead of silently duplicating it and burning a
 * slot in the capacity budget on a story already held.
 */
export interface EventStoreOptions {
  /** Max events retained. Oldest (by ingestedAt) are evicted once exceeded. Default 5000. */
  maxSize?: number;
}

export interface EventStore {
  /** Adds events. An event whose id already exists is replaced in place (idempotent
   *  re-ingestion — the same event.id can arrive again on a later poll of the same
   *  source), not duplicated. */
  add(events: IronsightEvent[]): void;
  /** All retained events, newest-first by reportedAt. */
  getAll(): readonly IronsightEvent[];
  getBySourceId(sourceId: string): readonly IronsightEvent[];
  clear(): void;
  readonly size: number;
}

const DEFAULT_MAX_SIZE = 5000;

export function createEventStore(options?: EventStoreOptions): EventStore {
  const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
  const events = new Map<string, IronsightEvent>();

  function evictOverCapacity(): void {
    if (events.size <= maxSize) return;

    const oldestFirst = [...events.values()].sort((a, b) => a.ingestedAt - b.ingestedAt);
    const overflow = events.size - maxSize;
    for (let i = 0; i < overflow; i++) {
      events.delete(oldestFirst[i].id);
    }
  }

  return {
    add(newEvents: IronsightEvent[]): void {
      for (const event of newEvents) {
        events.set(event.id, event);
      }
      evictOverCapacity();
    },

    getAll(): readonly IronsightEvent[] {
      return [...events.values()].sort((a, b) => b.reportedAt - a.reportedAt);
    },

    getBySourceId(sourceId: string): readonly IronsightEvent[] {
      return [...events.values()].filter((event) => event.source.id === sourceId);
    },

    clear(): void {
      events.clear();
    },

    get size(): number {
      return events.size;
    },
  };
}
