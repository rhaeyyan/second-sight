import { describe, it, expect, vi } from 'vitest';
import { fetchAdsbFeed } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;
const URL = 'https://api.adsb.lol/v2/mil';

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchAdsbFeed', () => {
  it('returns the aircraft list and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, { ac: [{ hex: 'ae1234', flight: 'RCH123', lat: 32, lon: 35 }] })
    );

    const result = await fetchAdsbFeed('adsb-mil', URL, { fetchImpl, now: () => MOCK_NOW });

    expect(result.ac).toHaveLength(1);
    expect(result.health).toEqual({
      sourceId: 'adsb-mil',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('treats a missing ac field as an empty list rather than throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, {}));

    const result = await fetchAdsbFeed('adsb-mil', URL, { fetchImpl, now: () => MOCK_NOW });

    expect(result.ac).toEqual([]);
    expect(result.health.status).toBe('healthy');
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, {}));

    const result = await fetchAdsbFeed('adsb-mil', URL, { fetchImpl, now: () => MOCK_NOW });

    expect(result.ac).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, {}));

    const result = await fetchAdsbFeed('adsb-mil', URL, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchAdsbFeed('adsb-mil', URL, { fetchImpl, now: () => MOCK_NOW });

    expect(result.ac).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });
});
