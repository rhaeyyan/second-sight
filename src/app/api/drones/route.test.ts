import { describe, it, expect, vi } from 'vitest';
import { fetchNeptunDrones } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchNeptunDrones', () => {
  it('maps markers with coordinates and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, {
      markers: [
        { id: 'a1', lat: 49.5, lng: 30.2, threat_type: 'shahed', text: 'shahed over region', count: 2, course_bearing: 90 },
        { lat: null, lng: 30.2 }, // missing coordinates — filtered out
      ],
      ballistic_threat: true,
    }));

    const result = await fetchNeptunDrones({ fetchImpl, now: () => MOCK_NOW });

    expect(result.drones).toHaveLength(1);
    expect(result.drones[0]).toMatchObject({ id: 'a1', label: 'Shahed Drone', lat: 49.5, lng: 30.2, count: 2, heading: 90 });
    expect(result.ballisticThreat).toBe(true);
    expect(result.health).toEqual({
      sourceId: 'neptun',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('falls back to the tracks field when markers is absent', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, {
      tracks: [{ id: 'b1', lat: 50, lng: 31, threat_type: 'raketa' }],
    }));

    const result = await fetchNeptunDrones({ fetchImpl, now: () => MOCK_NOW });

    expect(result.drones).toHaveLength(1);
    expect(result.drones[0].label).toBe('Cruise Missile');
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, {}));

    const result = await fetchNeptunDrones({ fetchImpl, now: () => MOCK_NOW });

    expect(result.drones).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, {}));

    const result = await fetchNeptunDrones({ fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchNeptunDrones({ fetchImpl, now: () => MOCK_NOW });

    expect(result.drones).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });
});
