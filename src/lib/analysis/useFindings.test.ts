import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFindings } from './useFindings';
import { createEventStore, type EventStore } from '@/lib/events/eventStore';
import type { IronsightEvent } from '@/lib/events/schema';

const MOCK_NOW = 1_760_000_000_000;
const INTERVAL = 50;
const WAIT_OPTS = { timeout: 3000 };

/** Builds a realistic, schema-valid IronsightEvent with sensible overridable defaults. */
function makeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'a',
    source: { id: 'google-news', name: 'Reuters', sourceType: 'media' },
    type: 'STRIKE',
    theater: 'iran-israel',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'low',
    confidence: 'medium',
    verificationStatus: 'single-source',
    title: 'Missile strike reported near Tehran',
    tags: ['strike'],
    ...overrides,
  };
}

describe('useFindings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('computes findings from the store synchronously, on the very first render', () => {
    const store = createEventStore();
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' } }),
    ]);

    const { result } = renderHook(() => useFindings({ store, interval: INTERVAL }));

    expect(result.current.findings).toHaveLength(1);
    expect(result.current.findings[0].ruleId).toBe('corroboration');
    expect(result.current.lastComputedAt).not.toBeNull();
  });

  it('skips recomputing on a tick where store.size is unchanged (idempotent update), and recomputes once a genuinely new event changes the size', async () => {
    const store = createEventStore();
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' }, severity: 'low' }),
      makeEvent({ id: 'b', source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' }, severity: 'low' }),
    ]);

    const { result } = renderHook(() => useFindings({ store, interval: INTERVAL }));
    await waitFor(() => expect(result.current.findings).toHaveLength(1), WAIT_OPTS);
    expect(result.current.findings[0].severity).toBe('low');

    // Idempotent re-ingestion: same id 'a', size stays 2. If this were picked up (i.e.
    // the throttle failed to skip), the corroboration finding's severity (max of
    // members) would jump to 'critical' on the very next tick.
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' }, severity: 'critical' }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL * 3));
    expect(result.current.findings[0].severity).toBe('low');

    // A genuinely new id changes store.size, forcing a real recompute — which now picks
    // up 'a's updated severity from the live store.
    store.add([
      makeEvent({
        id: 'c',
        source: { id: 'other-outlet', name: 'AP', sourceType: 'media' },
        title: 'Unrelated report about oil markets',
      }),
    ]);
    await waitFor(() => expect(result.current.findings[0].severity).toBe('critical'), WAIT_OPTS);
  });

  it('re-prunes expired findings on every tick, even ticks where the engine recompute was skipped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_NOW);

    const store: EventStore = createEventStore();
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' } }),
    ]);

    const { result } = renderHook(() => useFindings({ store, interval: 1000 }));
    expect(result.current.findings).toHaveLength(1);
    const expiresAt = result.current.findings[0].expiresAt!;
    expect(expiresAt).toBeGreaterThan(MOCK_NOW);

    // Advance past expiry without adding any events — store.size never changes, so the
    // engine recompute branch is skipped on every subsequent tick; only the per-tick
    // pruneExpiredFindings call can be responsible for the finding disappearing.
    vi.setSystemTime(expiresAt + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.findings).toHaveLength(0);
  });

  it('keeps last-known-good findings and does not crash when the engine throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingStore: EventStore = {
      get size() {
        return 1;
      },
      add: () => {},
      getAll: () => {
        throw new Error('boom');
      },
      getBySourceId: () => [],
      getByIds: () => [],
      clear: () => {},
    };

    const { result } = renderHook(() => useFindings({ store: throwingStore, interval: INTERVAL }));

    expect(result.current.findings).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
