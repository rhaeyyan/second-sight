import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useUnifiedFeed } from '@/lib/events/useUnifiedFeed';
import { ConflictProvider } from '@/lib/conflicts/context';
import type { IronsightEvent } from '@/lib/events/schema';

// Fixed epoch rather than Date.now(), so fixtures don't depend on when the test runs
// (mirrors eventStore.test.ts's convention).
const MOCK_NOW = 1_760_000_000_000;

// Real (small) interval rather than faked timers: the hook has no manual `refetch`,
// so subsequent polls can only be observed by letting the interval actually fire.
// Kept short so the suite stays fast; waitFor's timeout below gives it generous room.
const INTERVAL = 80;
const WAIT_OPTS = { timeout: 3000 };

/** Builds a realistic, schema-valid IronsightEvent with sensible overridable defaults. */
function makeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'a',
    source: {
      id: 'google-news',
      name: 'Reuters',
      url: 'https://reuters.com/some-article',
      sourceType: 'media',
    },
    type: 'STRIKE',
    theater: 'iran-israel',
    region: 'Tehran',
    reportedAt: MOCK_NOW - 60_000,
    ingestedAt: MOCK_NOW,
    severity: 'high',
    confidence: 'medium',
    verificationStatus: 'single-source',
    title: 'Strike reported near Tehran',
    tags: ['strike'],
    ...overrides,
  };
}

function jsonResponse(events: IronsightEvent[]) {
  return { ok: true, json: async () => events, headers: { get: () => null } };
}

/**
 * Queues a sequence of poll responses; once exhausted, every subsequent call keeps
 * returning the last one. This makes assertions robust to the exact number of extra
 * background polls a real (if short) interval fires between a test's checkpoints —
 * re-applying the same response is a no-op against the store's idempotent `add`.
 */
function queueResponses(fetchMock: ReturnType<typeof vi.fn>, ...batches: IronsightEvent[][]) {
  const queue = [...batches];
  fetchMock.mockImplementation(async () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return jsonResponse(next);
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ConflictProvider, null, children);
}

describe('useUnifiedFeed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('populates events from the store after the initial poll', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    queueResponses(fetchMock, [makeEvent({ id: 'a' })]);

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false), WAIT_OPTS);
    expect(result.current.events.map((e) => e.id)).toEqual(['a']);
    expect(result.current.error).toBeNull();
  });

  it('updates events with newly seen ids on a later poll when not paused', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    queueResponses(
      fetchMock,
      [makeEvent({ id: 'a' })],
      [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]
    );

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });

    await waitFor(
      () => expect(result.current.events.map((e) => e.id).sort()).toEqual(['a', 'b']),
      WAIT_OPTS
    );
  });

  it('updates an event sharing an id in place rather than duplicating it', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    queueResponses(
      fetchMock,
      [makeEvent({ id: 'a', title: 'Initial report' })],
      [makeEvent({ id: 'a', title: 'Updated: corroborated by second outlet' })]
    );

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });

    await waitFor(
      () => expect(result.current.events[0]?.title).toBe('Updated: corroborated by second outlet'),
      WAIT_OPTS
    );
    expect(result.current.events).toHaveLength(1);
  });

  it('freezes events at the pause snapshot while polling continues in the background, and reveals new events on resume', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    queueResponses(
      fetchMock,
      [makeEvent({ id: 'a' })],
      [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]
    );

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });

    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['a']), WAIT_OPTS);

    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(true);

    // Let the background poll (which delivers event 'b') actually happen.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2), WAIT_OPTS);

    // Give any pending state updates a tick to flush, then confirm the frozen snapshot
    // still doesn't include 'b' even though the store has moved on.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.events.map((e) => e.id)).toEqual(['a']);

    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(false);

    await waitFor(
      () => expect(result.current.events.map((e) => e.id).sort()).toEqual(['a', 'b']),
      WAIT_OPTS
    );
  });

  it('tracks newSinceCount for genuinely new ids while paused, ignoring re-delivered already-seen ids', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    queueResponses(fetchMock, [makeEvent({ id: 'a' })]);

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });

    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['a']), WAIT_OPTS);

    act(() => result.current.togglePause());
    expect(result.current.newSinceCount).toBe(0);

    // Next poll only re-delivers 'a' (idempotent update) — must not inflate the count.
    queueResponses(fetchMock, [makeEvent({ id: 'a', title: 'Updated in place' })]);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL + 40));
    expect(result.current.newSinceCount).toBe(0);

    // Now a genuinely new id arrives.
    queueResponses(fetchMock, [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]);
    await waitFor(() => expect(result.current.newSinceCount).toBe(1), WAIT_OPTS);

    // And another new id, alongside a re-delivery of 'b' — only 'c' should add to the count.
    queueResponses(
      fetchMock,
      [makeEvent({ id: 'b' }), makeEvent({ id: 'c' })]
    );
    await waitFor(() => expect(result.current.newSinceCount).toBe(2), WAIT_OPTS);

    // events must have stayed frozen throughout.
    expect(result.current.events.map((e) => e.id)).toEqual(['a']);
  });

  it('resets newSinceCount to 0 and updates events to the latest store state on resume', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    queueResponses(fetchMock, [makeEvent({ id: 'a' })]);

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['a']), WAIT_OPTS);

    act(() => result.current.togglePause());

    queueResponses(fetchMock, [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]);
    await waitFor(() => expect(result.current.newSinceCount).toBe(1), WAIT_OPTS);

    act(() => result.current.togglePause());

    expect(result.current.paused).toBe(false);
    expect(result.current.newSinceCount).toBe(0);
    expect(result.current.events.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('exposes a store whose getByIds sees events added after pause, even though events stays frozen', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    queueResponses(
      fetchMock,
      [makeEvent({ id: 'a' })],
      [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]
    );

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });

    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['a']), WAIT_OPTS);

    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(true);

    await waitFor(
      () => expect(result.current.store.getByIds(['a', 'b']).map((e) => e.id)).toEqual(['a', 'b']),
      WAIT_OPTS
    );
    // The hook's own `events` is still pinned to the pre-pause snapshot.
    expect(result.current.events.map((e) => e.id)).toEqual(['a']);
  });

  it('does not crash and keeps previously accumulated events when a poll rejects', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse([makeEvent({ id: 'a' })]))
      .mockRejectedValue(new Error('network unreachable'));

    const { result } = renderHook(() => useUnifiedFeed(INTERVAL), { wrapper });

    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['a']), WAIT_OPTS);

    await waitFor(() => expect(result.current.error).toBe('network unreachable'), WAIT_OPTS);
    expect(result.current.events.map((e) => e.id)).toEqual(['a']);
  });
});
