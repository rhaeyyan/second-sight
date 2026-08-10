import { describe, it, expect, vi } from 'vitest';
import { fetchCryptoPrices } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchCryptoPrices', () => {
  it('maps CoinGecko prices to the four tracked coins and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, {
      bitcoin: { usd: 65000, usd_24h_change: 1.234 },
      ethereum: { usd: 3400, usd_24h_change: -2.5 },
      solana: { usd: 150, usd_24h_change: 0 },
      binancecoin: { usd: 600, usd_24h_change: 0.5 },
    }));

    const result = await fetchCryptoPrices({ fetchImpl, now: () => MOCK_NOW });

    expect(result.prices).toEqual([
      { name: 'Bitcoin', symbol: 'BTC', price: 65000, changePercent: 1.23 },
      { name: 'Ethereum', symbol: 'ETH', price: 3400, changePercent: -2.5 },
      { name: 'Solana', symbol: 'SOL', price: 150, changePercent: 0 },
      { name: 'BNB', symbol: 'BNB', price: 600, changePercent: 0.5 },
    ]);
    expect(result.health).toEqual({
      sourceId: 'coingecko',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('flags a coin missing from the response without failing the whole fetch', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, {
      bitcoin: { usd: 65000, usd_24h_change: 1 },
      ethereum: { usd: 3400, usd_24h_change: 1 },
      // solana and binancecoin omitted
    }));

    const result = await fetchCryptoPrices({ fetchImpl, now: () => MOCK_NOW });

    expect(result.prices.find(p => p.symbol === 'SOL')).toEqual({ name: 'Solana', symbol: 'SOL', price: 0, changePercent: 0, error: true });
    expect(result.health.status).toBe('healthy');
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, {}));

    const result = await fetchCryptoPrices({ fetchImpl, now: () => MOCK_NOW });

    expect(result.prices).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, {}));

    const result = await fetchCryptoPrices({ fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchCryptoPrices({ fetchImpl, now: () => MOCK_NOW });

    expect(result.prices).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });
});
