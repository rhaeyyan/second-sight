import { describe, it, expect, vi } from 'vitest';
import { fetchCommodity, fetchOilPrices } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;
const WTI = { symbol: 'CL=F', name: 'WTI Crude Oil', type: 'crude_wti' };

function yahooResponse(status: number, meta: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ chart: { result: meta ? [{ meta }] : [] } }),
  } as Response;
}

describe('fetchCommodity', () => {
  it('computes price/change/changePercent and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      yahooResponse(200, { regularMarketPrice: 82.5, chartPreviousClose: 80 })
    );

    const result = await fetchCommodity(WTI, { fetchImpl, now: () => MOCK_NOW });

    expect(result.price).toMatchObject({ type: 'crude_wti', name: 'WTI Crude Oil', price: 82.5, change: 2.5 });
    expect(result.health).toEqual({
      sourceId: 'yahoo-finance:CL=F',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('reports rate-limited on a 429', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(yahooResponse(429, null));

    const result = await fetchCommodity(WTI, { fetchImpl, now: () => MOCK_NOW });

    expect(result.price.price).toBe(0);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(yahooResponse(503, null));

    const result = await fetchCommodity(WTI, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when the response has no meta block', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(yahooResponse(200, null));

    const result = await fetchCommodity(WTI, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('invalid-response');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchCommodity(WTI, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });
});

describe('fetchOilPrices', () => {
  it('fetches every configured commodity independently and keeps their health separate', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(yahooResponse(200, { regularMarketPrice: 82.5, chartPreviousClose: 80 })) // CL=F
      .mockResolvedValue(yahooResponse(503, null)); // everything else fails

    const result = await fetchOilPrices({ fetchImpl, now: () => MOCK_NOW });

    expect(result.prices).toHaveLength(5);
    expect(result.health).toHaveLength(5);
    expect(result.health[0]).toMatchObject({ sourceId: 'yahoo-finance:CL=F', status: 'healthy' });
    expect(result.health[1]).toMatchObject({ status: 'unavailable' });
  });
});
