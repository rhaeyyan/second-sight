import { describe, it, expect, vi } from 'vitest';
import { fetchPolymarketMarkets } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;
const KEYWORDS = /iran|israel/i;
const EXCLUDE = /sports/i;

function market(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    question: 'Will Iran strike Israel again?',
    slug: 'iran-strike',
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.65","0.35"]',
    volume: '1000000',
    volume24hr: 50000,
    liquidity: '200000',
    active: true,
    closed: false,
    endDate: '2026-12-31',
    oneDayPriceChange: 0.02,
    image: 'https://example.com/img.png',
    ...overrides,
  };
}

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchPolymarketMarkets', () => {
  it('filters by keyword, excludes matches, and converts prices to percentages', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, [
      market(),
      market({ id: '2', question: 'Will the Iran Israel sports league expand?' }), // excluded
      market({ id: '3', question: 'Unrelated election market' }), // no keyword match
    ]));

    const result = await fetchPolymarketMarkets(KEYWORDS, EXCLUDE, { fetchImpl, now: () => MOCK_NOW });

    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]).toMatchObject({
      id: '1',
      outcomes: [{ label: 'Yes', price: 65 }, { label: 'No', price: 35 }],
      volumeTotal: 1000000,
      liquidity: 200000,
    });
    expect(result.health).toEqual({
      sourceId: 'polymarket',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('sorts by the Yes-outcome price descending', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, [
      market({ id: 'low', outcomePrices: '["0.2","0.8"]' }),
      market({ id: 'high', outcomePrices: '["0.9","0.1"]' }),
    ]));

    const result = await fetchPolymarketMarkets(KEYWORDS, EXCLUDE, { fetchImpl, now: () => MOCK_NOW });

    expect(result.markets.map(m => m.id)).toEqual(['high', 'low']);
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, {}));

    const result = await fetchPolymarketMarkets(KEYWORDS, EXCLUDE, { fetchImpl, now: () => MOCK_NOW });

    expect(result.markets).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, {}));

    const result = await fetchPolymarketMarkets(KEYWORDS, EXCLUDE, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchPolymarketMarkets(KEYWORDS, EXCLUDE, { fetchImpl, now: () => MOCK_NOW });

    expect(result.markets).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when a market has malformed outcomes JSON', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, [
      market({ outcomes: 'not json' }),
    ]));

    const result = await fetchPolymarketMarkets(KEYWORDS, EXCLUDE, { fetchImpl, now: () => MOCK_NOW });

    expect(result.markets).toEqual([]);
    expect(result.health.status).toBe('invalid-response');
  });
});
