import { useCallback, useEffect, useRef, useState } from 'react';
import { useConflict } from '@/lib/conflicts/context';
import { createEventStore, type EventStore } from './eventStore';
import type { IronsightEvent } from './schema';
import type { SourceHealth } from './sourceAdapter';

export interface UnifiedFeedState {
  /** The events to render right now — see pause semantics below. */
  events: readonly IronsightEvent[];
  health: SourceHealth[];
  loading: boolean;
  error: string | null;
  paused: boolean;
  togglePause: () => void;
  /** Count of events added to the store since pause was activated. 0 when not paused. */
  newSinceCount: number;
}

const DEFAULT_INTERVAL = 120000;

/**
 * Polls `/api/feed` and accumulates results into a bounded EventStore (Phase 1's ring
 * buffer, finally wired to a consumer) that persists for the component's lifetime via a
 * ref. Two concerns layer on top of plain polling:
 *
 * 1. Multiple panels can share one feed instead of each re-fetching and re-parsing the
 *    same 50+ sources independently — the store is the single accumulation point.
 * 2. Global Pause (draft-implementation-plan.md §5) freezes what's *displayed* without
 *    stopping what's *fetched*. Polling and store.add() keep running in the background
 *    while paused so nothing is lost, but the `events` this hook returns stay pinned to
 *    a snapshot taken at the moment of pausing. `newSinceCount` is derived by diffing the
 *    live store's id set against the snapshot's id set on every poll — not by watching
 *    store.size — because store.add() is idempotent by id: a poll that only re-delivers
 *    already-seen events (e.g. a corroboration update) changes fields in place without
 *    changing size *or* introducing an id absent from the snapshot, so it correctly
 *    contributes 0 to the count. Only ids the snapshot has never seen count as "new".
 */
export function useUnifiedFeed(interval: number = DEFAULT_INTERVAL): UnifiedFeedState {
  const { key } = useConflict();

  const storeRef = useRef<EventStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createEventStore();
  }

  // Mirrors `paused` state for synchronous reads inside fetchData, so fetchData doesn't
  // need `paused` in its dependency array (which would tear down and restart the poll
  // interval on every pause toggle).
  const pausedRef = useRef(false);
  // The id set captured at the moment pausing began. null while not paused.
  const snapshotIdsRef = useRef<Set<string> | null>(null);

  const [events, setEvents] = useState<readonly IronsightEvent[]>(() => storeRef.current!.getAll());
  const [health, setHealth] = useState<SourceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [newSinceCount, setNewSinceCount] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const url = `/api/feed?conflict=${key}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const incoming: IronsightEvent[] = Array.isArray(json) ? json : [];
      storeRef.current!.add(incoming);

      const healthHeader = res.headers.get('X-Source-Health');
      if (healthHeader) {
        try {
          const parsedHealth = JSON.parse(healthHeader);
          if (Array.isArray(parsedHealth)) setHealth(parsedHealth);
        } catch {
          // Malformed header — keep whatever health we had rather than discarding it.
        }
      }

      const all = storeRef.current!.getAll();
      if (pausedRef.current) {
        const snapshotIds = snapshotIdsRef.current;
        if (snapshotIds) {
          setNewSinceCount(all.filter((event) => !snapshotIds.has(event.id)).length);
        }
      } else {
        setEvents(all);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, interval);
    return () => clearInterval(id);
  }, [fetchData, interval]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      const current = storeRef.current!.getAll();
      if (next) {
        // Pausing: freeze the displayed events and start tracking arrivals against
        // this moment's id set.
        snapshotIdsRef.current = new Set(current.map((event) => event.id));
      } else {
        // Resuming: drop the snapshot and go back to live-updating mode.
        snapshotIdsRef.current = null;
      }
      setEvents(current);
      setNewSinceCount(0);
      return next;
    });
  }, []);

  return { events, health, loading, error, paused, togglePause, newSinceCount };
}
