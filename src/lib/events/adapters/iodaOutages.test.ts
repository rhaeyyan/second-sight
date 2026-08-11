import { describe, it, expect, vi } from 'vitest';
import { createIodaOutagesAdapter } from '@/lib/events/adapters/iodaOutages';
import type { fetchWithTimeout } from '@/lib/fetcher';

// Fixed epoch, not Date.now() — deterministic clock per the generate-osint-fixtures skill
// (mirrors firmsFires.test.ts/usgsEarthquakes.test.ts's convention).
const MOCK_NOW = 1_760_000_000_000;
const FROM_SEC = 1_759_999_000; // a plausible unix-seconds "from" a bit before MOCK_NOW

function outageItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasource: 'ping-slash24',
    entityType: 'country',
    entityCode: 'IR',
    from: FROM_SEC,
    until: FROM_SEC + 3600,
    score: 6119.2,
    ...overrides,
  };
}

function iodaBody(data: unknown, error: string | null = null): Record<string, unknown> {
  return { type: 'outages/events', error, pagination: null, queryParameters: {}, data };
}

function fakeJsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('createIodaOutagesAdapter', () => {
  it('normalizes a healthy multi-country response, converting seconds to ms', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([outageItem()]))) // IR
      .mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([]))); // IL

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR', 'IL'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    const event = result.events[0];

    expect(event.id).toBe(`ioda-IR-${FROM_SEC}-ping-slash24`);
    expect(event.source).toEqual({
      id: 'ioda-outages-iran-israel',
      name: 'IODA (Internet Outage Detection and Analysis)',
      sourceType: 'sensor',
    });
    expect(event.type).toBe('CONNECTIVITY_OUTAGE');
    expect(event.theater).toBe('iran-israel');
    expect(event.occurredAt).toBe(FROM_SEC * 1000);
    expect(event.reportedAt).toBe(FROM_SEC * 1000);
    expect(event.ingestedAt).toBe(MOCK_NOW);
    expect(event.location).toEqual({ latitude: 32.4279, longitude: 53.688, precision: 'regional' });
    expect(event.severity).toBe('medium');
    expect(event.confidence).toBe('low');
    expect(event.verificationStatus).toBe('unverified');
    expect(event.title).toBe('Possible connectivity outage detected: Iran');
    expect(event.tags).toEqual(['connectivity', 'outage']);
    expect(event.rawPayload).toEqual({ score: 6119.2, datasource: 'ping-slash24', from: FROM_SEC, until: FROM_SEC + 3600 });

    expect(result.health).toEqual({
      sourceId: 'ioda-outages-iran-israel',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
    expect(result.rejected).toHaveLength(0);
  });

  it('omits location rather than fabricating one for a country code absent from the static lookup table', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([outageItem({ entityCode: 'ZZ' })])));

    const adapter = createIodaOutagesAdapter('iran-israel', ['ZZ'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].location).toBeUndefined();
    expect(result.events[0].title).toBe('Possible connectivity outage detected: ZZ');
  });

  it('skips a malformed item (missing score) without counting it as rejected', async () => {
    const malformed = { datasource: 'bgp', entityType: 'country', entityCode: 'IR', from: FROM_SEC, until: FROM_SEC + 100 };
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([malformed])));

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("treats a response whose body isn't the expected {error, data} shape as that country contributing nothing", async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeJsonResponse(200, { unexpected: 'shape' })) // IR: malformed wrapper
      .mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([outageItem({ entityCode: 'IL' })]))); // IL: fine

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR', 'IL'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toContain('IL');
    expect(result.health.status).toBe('healthy');
  });

  it('lets Zod reject an item with a non-positive "from" instead of silently dropping it', async () => {
    const corrupted = outageItem({ from: -1 }); // typeof number passes the raw-shape check; Zod's .positive() catches it
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([corrupted])));

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].issues.some((i) => i.startsWith('occurredAt') || i.startsWith('reportedAt'))).toBe(true);
  });

  it('reports rate-limited when any country request returns 429', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([])))
      .mockResolvedValueOnce(fakeJsonResponse(429, {}));

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR', 'IL'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable when every country request rejects', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR', 'IL'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when every country returns a malformed wrapper', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeJsonResponse(200, { unexpected: 'shape' }))
      .mockResolvedValueOnce(fakeJsonResponse(200, { also: 'wrong' }));

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR', 'IL'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('invalid-response');
  });

  describe('self-throttling cache', () => {
    it('serves a cached result and makes no second round of network calls within the TTL window', async () => {
      const fetchImpl = vi
        .fn<typeof fetchWithTimeout>()
        .mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([outageItem()])))
        .mockResolvedValueOnce(fakeJsonResponse(200, iodaBody([])));
      const cache = new Map();
      let currentNow = MOCK_NOW;

      const adapter = createIodaOutagesAdapter('iran-israel', ['IR', 'IL'], {
        now: () => currentNow,
        fetchImpl,
        cache,
        cacheTtlMs: 15 * 60 * 1000,
      });

      const first = await adapter.fetch();
      currentNow = MOCK_NOW + 5 * 60 * 1000;
      const second = await adapter.fetch();

      expect(fetchImpl).toHaveBeenCalledTimes(2); // one round (2 countries), not two rounds
      expect(second).toEqual(first);
    });
  });

  it('caps events at the top 30 by score when a poll yields more than that', async () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      outageItem({ from: FROM_SEC + i, score: i + 1, datasource: `ds-${i}` }),
    );
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(200, iodaBody(items)));

    const adapter = createIodaOutagesAdapter('iran-israel', ['IR'], {
      now: () => MOCK_NOW,
      fetchImpl,
      cache: new Map(),
    });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(30);
    const scores = result.events.map((e) => (e.rawPayload as { score: number }).score);
    expect(Math.min(...scores)).toBe(11);
    expect(Math.max(...scores)).toBe(40);
  });
});
