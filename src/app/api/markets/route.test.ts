import { describe, it, expect, vi } from 'vitest';
import { fetchYahooSymbol, fetchMarketPrices } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;
const LMT = { symbol: 'LMT', name: 'Lockheed Martin' };

function yahooResponse(status: number, meta: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ chart: { result: meta ? [{ meta }] : [] } }),
  } as Response;
}

describe('fetchYahooSymbol', () => {
  it('computes price/change/changePercent and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      yahooResponse(200, { regularMarketPrice: 110, chartPreviousClose: 100 })
    );

    const result = await fetchYahooSymbol(LMT, { fetchImpl, now: () => MOCK_NOW });

    expect(result.price).toEqual({ symbol: 'LMT', name: 'Lockheed Martin', price: 110, change: 10, changePercent: 10 });
    expect(result.health).toEqual({
      sourceId: 'yahoo-finance:LMT',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('reports rate-limited on a 429 and returns an error placeholder', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(yahooResponse(429, null));

    const result = await fetchYahooSymbol(LMT, { fetchImpl, now: () => MOCK_NOW });

    expect(result.price).toEqual({ symbol: 'LMT', name: 'Lockheed Martin', price: 0, change: 0, changePercent: 0, error: true });
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(yahooResponse(503, null));

    const result = await fetchYahooSymbol(LMT, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when the response has no meta block', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(yahooResponse(200, null));

    const result = await fetchYahooSymbol(LMT, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('invalid-response');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchYahooSymbol(LMT, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });
});

describe('fetchMarketPrices', () => {
  it('fetches every configured symbol independently and keeps their health separate', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(yahooResponse(200, { regularMarketPrice: 110, chartPreviousClose: 100 })) // LMT
      .mockResolvedValue(yahooResponse(503, null)); // everything else fails

    const result = await fetchMarketPrices({ fetchImpl, now: () => MOCK_NOW });

    expect(result.prices).toHaveLength(11);
    expect(result.health).toHaveLength(11);
    expect(result.health[0]).toMatchObject({ sourceId: 'yahoo-finance:LMT', status: 'healthy' });
    expect(result.health[1]).toMatchObject({ status: 'unavailable' });
  });
});
