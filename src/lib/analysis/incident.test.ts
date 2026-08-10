import { describe, it, expect } from 'vitest';
import { clusterEvents } from './incident';
import type { IronsightEvent } from '@/lib/events/schema';

// Fixed epoch rather than Date.now() — deterministic fixtures.
const MOCK_NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;

function makeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'evt-1',
    source: { id: 'source-a', name: 'Source A', sourceType: 'media' },
    type: 'REPORT',
    theater: 'iran-israel',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'info',
    confidence: 'low',
    verificationStatus: 'single-source',
    title: 'Missile strike reported near Tehran',
    tags: [],
    ...overrides,
  };
}

describe('clusterEvents — true positives', () => {
  it('clusters two similar events in the same theater within the time window', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', title: 'Missile strike hits Tehran suburb', reportedAt: MOCK_NOW + 10 * 60 * 1000, source: { id: 'source-b', name: 'Source B', sourceType: 'media' } }),
    ];

    const incidents = clusterEvents(events);

    expect(incidents).toHaveLength(1);
    expect(incidents[0].eventIds.sort()).toEqual(['a', 'b']);
    expect(incidents[0].sourceIds.sort()).toEqual(['source-a', 'source-b']);
    expect(incidents[0].theater).toBe('iran-israel');
    expect(incidents[0].firstReportedAt).toBe(MOCK_NOW);
    expect(incidents[0].lastReportedAt).toBe(MOCK_NOW + 10 * 60 * 1000);
  });

  it('clusters transitively — A~B and B~C group all three even if A and C alone are not similar enough', () => {
    // a~b share {missile,strike,tehran} (jaccard ~0.43); b~c share {tehran,overnight,
    // residents,blast} (jaccard ~0.44); a~c directly share only {tehran} (jaccard 0.125,
    // below the 0.4 default threshold) — so all three only end up in one incident via
    // the transitive a-b-c chain, not because every pair is independently similar.
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', title: 'Missile strike hits Tehran overnight residents report blast', reportedAt: MOCK_NOW + 5 * 60 * 1000 }),
      makeEvent({ id: 'c', title: 'Overnight blast heard near Tehran residents report explosion', reportedAt: MOCK_NOW + 10 * 60 * 1000 }),
    ];

    const incidents = clusterEvents(events);

    expect(incidents).toHaveLength(1);
    expect(incidents[0].eventIds.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('clusterEvents — near misses', () => {
  it('does not cluster events with dissimilar titles despite matching theater and time', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', title: 'Officials meet to discuss trade agreement', reportedAt: MOCK_NOW + 5 * 60 * 1000 }),
    ];

    expect(clusterEvents(events)).toEqual([]);
  });

  it('does not cluster events from different theaters despite similar titles and timing', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near border town', reportedAt: MOCK_NOW, theater: 'iran-israel' }),
      makeEvent({ id: 'b', title: 'Missile strike reported near border town', reportedAt: MOCK_NOW + 60 * 1000, theater: 'russia-ukraine' }),
    ];

    expect(clusterEvents(events)).toEqual([]);
  });
});

describe('clusterEvents — stale events', () => {
  it('does not cluster similar same-theater events far outside the time window', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW + 6 * HOUR }),
    ];

    // Default window is 2 hours — 6 hours apart must not cluster.
    expect(clusterEvents(events)).toEqual([]);
  });

  it('respects a custom windowMs option', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW + 3 * HOUR }),
    ];

    expect(clusterEvents(events, { windowMs: 1 * HOUR })).toEqual([]);
    expect(clusterEvents(events, { windowMs: 4 * HOUR })).toHaveLength(1);
  });
});

describe('clusterEvents — singleton events', () => {
  it('produces no incidents when no events are related to anything else', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near Tehran' }),
      makeEvent({ id: 'b', title: 'Ceasefire talks resume in Cairo', reportedAt: MOCK_NOW + 60_000 }),
      makeEvent({ id: 'c', title: 'Oil futures spike amid conflict fears', reportedAt: MOCK_NOW + 120_000 }),
    ];

    expect(clusterEvents(events)).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(clusterEvents([])).toEqual([]);
  });
});

describe('clusterEvents — multiple independent incidents', () => {
  it('groups events into separate incidents when there are two unrelated clusters', () => {
    const events = [
      makeEvent({ id: 'a1', title: 'Missile strike reported near Tehran', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'a2', title: 'Missile strike hits Tehran overnight', reportedAt: MOCK_NOW + 60_000 }),
      makeEvent({ id: 'b1', title: 'Ceasefire talks resume in Cairo', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b2', title: 'Ceasefire talks continue in Cairo today', reportedAt: MOCK_NOW + 60_000 }),
    ];

    const incidents = clusterEvents(events);

    expect(incidents).toHaveLength(2);
    const groupedIds = incidents.map((i) => i.eventIds.sort()).sort();
    expect(groupedIds).toEqual([['a1', 'a2'], ['b1', 'b2']]);
  });
});

describe('clusterEvents — respects a custom similarityThreshold', () => {
  it('a lower threshold clusters more loosely related titles', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Missile strike reported near border checkpoint', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', title: 'Rocket fire reported near border area today', reportedAt: MOCK_NOW + 60_000 }),
    ];

    // Shared tokens: {border} only — jaccard ~0.14 (1 of 7 total distinct tokens).
    expect(clusterEvents(events, { similarityThreshold: 0.9 })).toEqual([]);
    expect(clusterEvents(events, { similarityThreshold: 0.1 })).toHaveLength(1);
  });
});
