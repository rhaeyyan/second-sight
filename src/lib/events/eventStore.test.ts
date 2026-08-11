import { describe, it, expect } from 'vitest';
import { createEventStore } from '@/lib/events/eventStore';
import type { IronsightEvent } from '@/lib/events/schema';

// Fixed epoch rather than Date.now(), so these fixtures never depend on when the
// test runs (per the generate-osint-fixtures skill's deterministic-clock rule).
const MOCK_NOW = 1_760_000_000_000;

/** Builds a realistic, schema-valid IronsightEvent with sensible overridable defaults. */
function makeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'gn-0-1760000000000',
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

describe('createEventStore — under-cap ingestion', () => {
  it('keeps all events when adding fewer than maxSize', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([
      makeEvent({ id: 'a', ingestedAt: MOCK_NOW }),
      makeEvent({ id: 'b', ingestedAt: MOCK_NOW + 1 }),
      makeEvent({ id: 'c', ingestedAt: MOCK_NOW + 2 }),
    ]);

    expect(store.size).toBe(3);
    expect(store.getAll().map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('createEventStore — eviction over cap', () => {
  it('evicts the oldest events by ingestedAt once maxSize is exceeded', () => {
    const store = createEventStore({ maxSize: 3 });
    store.add([
      makeEvent({ id: 'oldest', ingestedAt: MOCK_NOW }),
      makeEvent({ id: 'middle', ingestedAt: MOCK_NOW + 1_000 }),
      makeEvent({ id: 'newer', ingestedAt: MOCK_NOW + 2_000 }),
    ]);
    store.add([makeEvent({ id: 'newest', ingestedAt: MOCK_NOW + 3_000 })]);

    expect(store.size).toBe(3);
    const ids = store.getAll().map((e) => e.id);
    expect(ids).not.toContain('oldest');
    expect(ids).toEqual(expect.arrayContaining(['middle', 'newer', 'newest']));
  });

  it('evicts multiple oldest events when a large batch pushes well past maxSize', () => {
    const store = createEventStore({ maxSize: 2 });
    store.add([
      makeEvent({ id: 'a', ingestedAt: MOCK_NOW }),
      makeEvent({ id: 'b', ingestedAt: MOCK_NOW + 1 }),
      makeEvent({ id: 'c', ingestedAt: MOCK_NOW + 2 }),
      makeEvent({ id: 'd', ingestedAt: MOCK_NOW + 3 }),
    ]);

    expect(store.size).toBe(2);
    expect(store.getAll().map((e) => e.id).sort()).toEqual(['c', 'd']);
  });
});

describe('createEventStore — idempotent re-ingestion', () => {
  it('updates an event with an existing id in place rather than duplicating it', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([
      makeEvent({ id: 'a', title: 'Initial report', verificationStatus: 'unverified' }),
    ]);
    store.add([
      makeEvent({ id: 'a', title: 'Updated: corroborated by second outlet', verificationStatus: 'corroborated' }),
    ]);

    expect(store.size).toBe(1);
    expect(store.getAll()[0]).toMatchObject({
      id: 'a',
      title: 'Updated: corroborated by second outlet',
      verificationStatus: 'corroborated',
    });
  });
});

describe('createEventStore — getAll ordering', () => {
  it('returns events newest-first by reportedAt, independent of insertion or ingestedAt order', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([
      makeEvent({ id: 'middle-reported', reportedAt: MOCK_NOW - 1_000, ingestedAt: MOCK_NOW + 5_000 }),
      makeEvent({ id: 'oldest-reported', reportedAt: MOCK_NOW - 10_000, ingestedAt: MOCK_NOW }),
      makeEvent({ id: 'newest-reported', reportedAt: MOCK_NOW, ingestedAt: MOCK_NOW + 1 }),
    ]);

    expect(store.getAll().map((e) => e.id)).toEqual([
      'newest-reported',
      'middle-reported',
      'oldest-reported',
    ]);
  });
});

describe('createEventStore — getBySourceId', () => {
  it('filters to events whose source.id matches', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' } }),
      makeEvent({ id: 'c', source: { id: 'google-news', name: 'AP', sourceType: 'media' } }),
    ]);

    const results = store.getBySourceId('google-news');
    expect(results.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });

  it('returns an empty array when no events match the given source id', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([makeEvent({ id: 'a' })]);

    expect(store.getBySourceId('nonexistent-source')).toEqual([]);
  });
});

describe('createEventStore — getByIds', () => {
  it('resolves ids to events, in the order the ids were given', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' })]);

    expect(store.getByIds(['c', 'a']).map((e) => e.id)).toEqual(['c', 'a']);
  });

  it('silently skips ids with no match rather than throwing', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([makeEvent({ id: 'a' })]);

    expect(store.getByIds(['a', 'missing', 'also-missing']).map((e) => e.id)).toEqual(['a']);
  });

  it('returns an empty array when none of the ids match', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([makeEvent({ id: 'a' })]);

    expect(store.getByIds(['missing'])).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([makeEvent({ id: 'a' })]);

    expect(store.getByIds([])).toEqual([]);
  });
});

describe('createEventStore — clear', () => {
  it('empties the store and resets size to 0', () => {
    const store = createEventStore({ maxSize: 10 });
    store.add([makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]);
    expect(store.size).toBe(2);

    store.clear();

    expect(store.size).toBe(0);
    expect(store.getAll()).toEqual([]);
  });
});

describe('createEventStore — maxSize defaults', () => {
  it('defaults maxSize to 5000 when no options are given', () => {
    const store = createEventStore();
    const events = Array.from({ length: 5001 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, ingestedAt: MOCK_NOW + i })
    );
    store.add(events);

    expect(store.size).toBe(5000);
    // The very first-ingested event should have been evicted.
    expect(store.getAll().find((e) => e.id === 'evt-0')).toBeUndefined();
  });

  it('respects a small custom maxSize', () => {
    const store = createEventStore({ maxSize: 3 });
    store.add([
      makeEvent({ id: 'a', ingestedAt: MOCK_NOW }),
      makeEvent({ id: 'b', ingestedAt: MOCK_NOW + 1 }),
      makeEvent({ id: 'c', ingestedAt: MOCK_NOW + 2 }),
      makeEvent({ id: 'd', ingestedAt: MOCK_NOW + 3 }),
    ]);

    expect(store.size).toBe(3);
  });
});
