import { describe, it, expect, vi } from 'vitest';
import { createOpenMeteoWeatherAdapter } from '@/lib/events/adapters/openMeteoWeather';
import type { fetchWithTimeout } from '@/lib/fetcher';

// Fixed epoch, not Date.now() — deterministic clock per the generate-osint-fixtures skill
// (mirrors firmsFires.test.ts's convention).
const MOCK_NOW = 1_760_000_000_000;

const MAP_CENTER: [number, number] = [30.0, 48.0];

function fakeJsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function weatherBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    latitude: 30.0,
    longitude: 48.0,
    current: { time: '2024-01-01T12:30', cloud_cover: 42 },
    ...overrides,
  };
}

describe('createOpenMeteoWeatherAdapter', () => {
  it('normalizes a healthy response into a fully populated, low-key contextual IronsightEvent', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(200, weatherBody()));

    const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    const event = result.events[0];

    const expectedTs = Date.parse('2024-01-01T12:30Z');
    expect(event.id).toBe('openmeteo-iran-israel-2024-01-01T12:30');
    expect(event.source).toEqual({ id: 'open-meteo-weather-iran-israel', name: 'Open-Meteo', sourceType: 'sensor' });
    expect(event.type).toBe('WEATHER_CONTEXT');
    expect(event.theater).toBe('iran-israel');
    expect(event.occurredAt).toBe(expectedTs);
    expect(event.reportedAt).toBe(expectedTs);
    expect(event.ingestedAt).toBe(MOCK_NOW);
    expect(event.location).toEqual({ latitude: 30.0, longitude: 48.0, precision: 'regional' });
    expect(event.severity).toBe('info');
    expect(event.confidence).toBe('high');
    expect(event.verificationStatus).toBe('official');
    expect(event.title).toBe('Cloud cover: 42% near theater center');
    expect(event.tags).toEqual(['weather', 'cloud-cover']);
    expect(event.rawPayload).toEqual({ time: '2024-01-01T12:30', cloud_cover: 42 });

    expect(result.health).toEqual({
      sourceId: 'open-meteo-weather-iran-israel',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
    expect(result.rejected).toHaveLength(0);
  });

  it('uses the response-echoed coordinates for location, not the query input, when Open-Meteo grid-snaps to a nearby point', async () => {
    // Query center is [30.0, 48.0]; the API echoes a slightly different (grid-snapped)
    // point — the event's location must reflect what Open-Meteo actually reported on,
    // not what was asked for (the geographic-precision-gate reasoning).
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, weatherBody({ latitude: 30.04, longitude: 47.96 })),
    );

    const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events[0].location).toEqual({ latitude: 30.04, longitude: 47.96, precision: 'regional' });
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(429, {}));

    const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(503, {}));

    const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when the payload is missing the expected current-conditions shape', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, { latitude: 30.0, longitude: 48.0 }), // no `current` at all
    );

    const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('invalid-response');
  });

  it('reports invalid-response when cloud_cover is present but not a number', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, weatherBody({ current: { time: '2024-01-01T12:30', cloud_cover: 'n/a' } })),
    );

    const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('invalid-response');
  });

  describe('self-throttling cache', () => {
    it('serves a cached result and makes no second network call within the TTL window', async () => {
      const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(200, weatherBody()));
      const cache = new Map();
      let currentNow = MOCK_NOW;

      const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
        now: () => currentNow,
        fetchImpl,
        cache,
        cacheTtlMs: 15 * 60 * 1000,
      });

      const first = await adapter.fetch();
      currentNow = MOCK_NOW + 5 * 60 * 1000; // 5 minutes later, still inside the 15-min TTL
      const second = await adapter.fetch();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('makes a fresh network call once the TTL has expired', async () => {
      const fetchImpl = vi
        .fn<typeof fetchWithTimeout>()
        .mockResolvedValueOnce(fakeJsonResponse(200, weatherBody({ current: { time: '2024-01-01T12:30', cloud_cover: 42 } })))
        .mockResolvedValueOnce(fakeJsonResponse(200, weatherBody({ current: { time: '2024-01-01T13:00', cloud_cover: 70 } })));
      const cache = new Map();
      let currentNow = MOCK_NOW;

      const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
        now: () => currentNow,
        fetchImpl,
        cache,
        cacheTtlMs: 15 * 60 * 1000,
      });

      const first = await adapter.fetch();
      currentNow = MOCK_NOW + 16 * 60 * 1000; // past the 15-min TTL
      const second = await adapter.fetch();

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(first.events[0].rawPayload).toMatchObject({ cloud_cover: 42 });
      expect(second.events[0].rawPayload).toMatchObject({ cloud_cover: 70 });
    });

    it('does not cache a failed fetch — the very next call retries the network rather than repeating the failure', async () => {
      const fetchImpl = vi
        .fn<typeof fetchWithTimeout>()
        .mockResolvedValueOnce(fakeJsonResponse(503, {}))
        .mockResolvedValueOnce(fakeJsonResponse(200, weatherBody()));
      const cache = new Map();

      const adapter = createOpenMeteoWeatherAdapter('iran-israel', MAP_CENTER, {
        now: () => MOCK_NOW,
        fetchImpl,
        cache,
        cacheTtlMs: 15 * 60 * 1000,
      });

      const first = await adapter.fetch();
      const second = await adapter.fetch();

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(first.health.status).toBe('unavailable');
      expect(second.health.status).toBe('healthy');
    });
  });
});
