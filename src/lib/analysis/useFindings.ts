import { useEffect, useRef, useState } from 'react';
import type { EventStore } from '@/lib/events/eventStore';
import { runCorrelationEngine, pruneExpiredFindings, type CorrelationEngineResult } from './engine';
import type { AnalysisFinding } from './finding';
import type { Incident } from './incident';

export interface UseFindingsOptions {
  /** The live EventStore to correlate against — pass the same store instance
   *  useUnifiedFeed() already owns, so no second poll/store is created. */
  store: EventStore;
  /** Recompute cadence. Deliberately independent of both the feed's poll interval and
   *  its pause state — see the module doc comment. Default 60000ms. */
  interval?: number;
}

export interface UseFindingsState {
  /** Pruned (already expired findings dropped), newest generatedAt first. */
  findings: readonly AnalysisFinding[];
  lastComputedAt: number;
}

const DEFAULT_INTERVAL = 60000;

function runEngine(store: EventStore, now: number, fallback: CorrelationEngineResult): CorrelationEngineResult {
  try {
    return runCorrelationEngine([...store.getAll()], () => now, { previousClusters: fallback.clusters });
  } catch (err) {
    // A thrown engine call is a bug, not an expected runtime condition (the engine is
    // pure/synchronous over data already validated at ingestion) — log and keep serving
    // the last-known-good findings rather than crash or blank the panel.
    console.error('runCorrelationEngine failed; keeping last-known-good findings', err);
    return fallback;
  }
}

function computeInitial(store: EventStore): { raw: CorrelationEngineResult; size: number; now: number } {
  const now = Date.now();
  return { raw: runEngine(store, now, { findings: [], clusters: [] }), size: store.size, now };
}

/**
 * Runs the Phase 3 correlation engine on its own clock, decoupled from useUnifiedFeed's
 * poll interval and pause state:
 *
 * - Pause only means "freeze what's displayed" (useUnifiedFeed's own doc comment) —
 *   polling and store.add() keep running underneath. Coupling findings to that display
 *   freeze would silently also stop analysis with no visual cue why, so this hook never
 *   reads `paused`.
 * - runCorrelationEngine re-clusters and re-runs every rule from scratch on every call
 *   (O(n^2) pairwise clustering over up to 5000 events — see incident.ts). Recomputing on
 *   every feed poll tick would pay that cost far more often than useful. Instead this
 *   hook only re-runs the engine when store.size has changed since the last run; on
 *   every tick regardless (including cache-hit ticks) it still re-prunes expired
 *   findings against the current time, since expiry must stay accurate even when
 *   clustering was skipped.
 *
 * The first pass runs during the initial render itself, computed once inside a useState
 * lazy initializer (the one sanctioned spot for a one-time impure read like Date.now() —
 * it runs exactly once, on mount, same as a constructor), not inside a useEffect:
 * `store`'s data is already resident in memory (not fetched), so there's no async gap to
 * bridge with a loading flag, and calling setState synchronously inside an effect body
 * only to reflect data already available at render time is exactly the cascading-render
 * anti-pattern react-hooks/set-state-in-effect flags. The effect below exists solely to
 * schedule subsequent, genuinely-timer-driven recomputes.
 */
export function useFindings({ store, interval = DEFAULT_INTERVAL }: UseFindingsOptions): UseFindingsState {
  const [initial] = useState(() => computeInitial(store));

  const rawFindingsRef = useRef(initial.raw);
  const lastSeenSizeRef = useRef(initial.size);

  const [findings, setFindings] = useState<readonly AnalysisFinding[]>(() =>
    pruneExpiredFindings(initial.raw.findings, initial.now),
  );
  const [lastComputedAt, setLastComputedAt] = useState(initial.now);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      if (store.size !== lastSeenSizeRef.current) {
        rawFindingsRef.current = runEngine(store, now, rawFindingsRef.current);
        lastSeenSizeRef.current = store.size;
        setLastComputedAt(now);
      }
      setFindings(pruneExpiredFindings(rawFindingsRef.current.findings, now));
    }, interval);
    return () => clearInterval(id);
  }, [store, interval]);

  return { findings, lastComputedAt };
}
