import { describe, it, expect, vi } from 'vitest';
import { fetchTzevaAdomAlerts, fetchUkraineAlerts } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchTzevaAdomAlerts', () => {
  it('translates a Hebrew threat/city and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, [
      { threat: 'ירי רקטות וטילים', cities: ['תל אביב - מרכז העיר'], date: '2024-01-01T00:00:00Z' },
    ]));

    const result = await fetchTzevaAdomAlerts('Pikud HaOref', { fetchImpl, now: () => MOCK_NOW });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      id: `tzeva-0-${MOCK_NOW}`,
      time: '2024-01-01T00:00:00Z',
      type: 'MISSILE', // categorizeAlert checks the missile keyword ('טיל') before rocket ('רקט')
      threatOriginal: 'ירי רקטות וטילים',
      source: 'Pikud HaOref',
      active: true,
    });
    expect(result.health).toEqual({
      sourceId: 'tzevaadom',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('reports healthy with no alerts when the API returns an empty array', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, []));

    const result = await fetchTzevaAdomAlerts('Pikud HaOref', { fetchImpl, now: () => MOCK_NOW });

    expect(result.alerts).toEqual([]);
    expect(result.health.status).toBe('healthy');
  });

  it('reports rate-limited on a 429 rather than treating it as "no alerts"', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, {}));

    const result = await fetchTzevaAdomAlerts('Pikud HaOref', { fetchImpl, now: () => MOCK_NOW });

    expect(result.alerts).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses rather than treating it as "no alerts"', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, {}));

    const result = await fetchTzevaAdomAlerts('Pikud HaOref', { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchTzevaAdomAlerts('Pikud HaOref', { fetchImpl, now: () => MOCK_NOW });

    expect(result.alerts).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });
});

describe('fetchUkraineAlerts', () => {
  it('maps active oblast states and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, {
      states: [
        { id: 1, name_en: 'Kyiv Oblast', alert: true, changed: '2024-01-01T00:00:00Z' },
        { id: 2, name_en: 'Lviv Oblast', alert: false },
      ],
    }));

    const result = await fetchUkraineAlerts('alerts.com.ua', { fetchImpl, now: () => MOCK_NOW });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      id: `ua-1-${MOCK_NOW}`,
      type: 'ALERT',
      threat: 'Air Raid Alert',
      locations: ['Kyiv Oblast'],
      active: true,
    });
    expect(result.health.status).toBe('healthy');
  });

  it('reports rate-limited on a 429 rather than treating it as "no alerts"', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, {}));

    const result = await fetchUkraineAlerts('alerts.com.ua', { fetchImpl, now: () => MOCK_NOW });

    expect(result.alerts).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchUkraineAlerts('alerts.com.ua', { fetchImpl, now: () => MOCK_NOW });

    expect(result.alerts).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });
});
