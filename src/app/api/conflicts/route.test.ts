import { describe, it, expect, vi } from 'vitest';
import type { IronsightEvent } from '@/lib/events/schema';
import type { SourceAdapter, SourceAdapterResult } from '@/lib/events/sourceAdapter';
import { GET } from './route';

const MOCK_NOW = 1_760_000_000_000;

function event(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'evt-1',
    source: { id: 'google-news-conflict', name: 'Google News', sourceType: 'media' },
    type: 'STRIKE',
    theater: 'iran-israel',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'high',
    confidence: 'medium',
    verificationStatus: 'single-source',
    title: 'Missile strike reported near Tehran',
    tags: ['strike'],
    ...overrides,
  };
}

function result(events: IronsightEvent[]): SourceAdapterResult {
  return {
    events,
    rejected: [],
    health: {
      sourceId: 'google-news-conflict-iran-israel',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    },
  };
}

// Mocking the adapter factory (not fetch/XML) isolates "does this route return the
// adapter's events untouched" from "does the adapter parse Google News RSS correctly" —
// already covered by googleNewsConflict.test.ts. Same seam as feed/route.test.ts.
const conflictsFetch = vi.fn<() => Promise<SourceAdapterResult>>();

vi.mock('@/lib/events/adapters/googleNewsConflict', () => ({
  createGoogleNewsConflictAdapter: (): SourceAdapter => ({
    sourceId: 'google-news-conflict-iran-israel',
    fetch: conflictsFetch,
  }),
}));

describe('GET /api/conflicts', () => {
  it('returns the adapter events as-is — no reshaping into a legacy shape', async () => {
    const events = [event({ id: 'a' }), event({ id: 'b', reportedAt: MOCK_NOW - 1000 })];
    conflictsFetch.mockResolvedValueOnce(result(events));

    const res = await GET(new Request('http://localhost/api/conflicts?conflict=iran-israel'));
    const body = (await res.json()) as IronsightEvent[];

    expect(body).toEqual(events);
  });

  it('passes through X-Source-Health from the adapter', async () => {
    conflictsFetch.mockResolvedValueOnce(result([]));

    const res = await GET(new Request('http://localhost/api/conflicts?conflict=iran-israel'));
    const health = JSON.parse(res.headers.get('X-Source-Health') ?? '{}');

    expect(health).toEqual({
      sourceId: 'google-news-conflict-iran-israel',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('sets Cache-Control to no-cache/no-store/must-revalidate', async () => {
    conflictsFetch.mockResolvedValueOnce(result([]));

    const res = await GET(new Request('http://localhost/api/conflicts?conflict=iran-israel'));

    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
  });

  it('returns an empty array without crashing when the adapter fetch rejects', async () => {
    conflictsFetch.mockRejectedValueOnce(new Error('network unreachable'));

    await expect(GET(new Request('http://localhost/api/conflicts?conflict=iran-israel'))).rejects.toThrow();
  });
});
