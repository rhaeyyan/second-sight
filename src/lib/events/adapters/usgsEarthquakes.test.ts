import { describe, it, expect, vi } from 'vitest';
import { createUsgsEarthquakesAdapter, severityForMagnitude } from '@/lib/events/adapters/usgsEarthquakes';
import type { fetchWithTimeout } from '@/lib/fetcher';
import type { BBox } from '@/lib/conflicts/types';

// Fixed epoch, not Date.now() — deterministic clock per the generate-osint-fixtures skill
// (mirrors firmsFires.test.ts's convention).
const MOCK_NOW = 1_760_000_000_000;

const bbox: BBox = { latMin: 20, latMax: 60, lonMin: 0, lonMax: 65 };

interface FeatureOverrides {
  id?: string;
  mag?: number;
  place?: string;
  time?: number;
  type?: string;
  status?: string;
  coordinates?: [number, number, number]; // [lon, lat, depth]
}

function feature(overrides: FeatureOverrides = {}): Record<string, unknown> {
  const {
    id = 'us7000abcd',
    mag = 4.6,
    place = '12km SE of Somewhere',
    time = MOCK_NOW - 60_000,
    type = 'earthquake',
    status = 'reviewed',
    coordinates = [35.1, 32.5, 10],
  } = overrides;

  return {
    type: 'Feature',
    id,
    properties: { mag, place, time, type, status },
    geometry: { type: 'Point', coordinates },
  };
}

function geoJson(features: Record<string, unknown>[]): Record<string, unknown> {
  return { type: 'FeatureCollection', features };
}

function fakeJsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('severityForMagnitude', () => {
  it('maps sub-4.0 magnitudes to info', () => {
    expect(severityForMagnitude(3.9)).toBe('info');
  });

  it('maps 4.0-4.9 to low, at the lower boundary', () => {
    expect(severityForMagnitude(4.0)).toBe('low');
  });

  it('maps 5.0-5.9 to medium, at the lower boundary', () => {
    expect(severityForMagnitude(5.0)).toBe('medium');
  });

  it('maps 6.0-6.9 to high, at the lower boundary', () => {
    expect(severityForMagnitude(6.0)).toBe('high');
  });

  it('maps 7.0+ to critical, at the lower boundary', () => {
    expect(severityForMagnitude(7.0)).toBe('critical');
  });
});

describe('createUsgsEarthquakesAdapter', () => {
  it('normalizes a healthy response into a fully populated IronsightEvent', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, geoJson([feature()])),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    const event = result.events[0];

    expect(event.id).toBe('usgs-us7000abcd');
    expect(event.source).toEqual({ id: 'usgs-earthquakes', name: 'USGS Earthquake Hazards Program', sourceType: 'sensor' });
    expect(event.type).toBe('SEISMIC_ACTIVITY');
    expect(event.theater).toBe('iran-israel');
    expect(event.occurredAt).toBe(MOCK_NOW - 60_000);
    expect(event.reportedAt).toBe(MOCK_NOW - 60_000);
    expect(event.ingestedAt).toBe(MOCK_NOW);
    expect(event.location).toEqual({ latitude: 32.5, longitude: 35.1, precision: 'exact' });
    expect(event.severity).toBe('low');
    expect(event.confidence).toBe('high');
    expect(event.verificationStatus).toBe('official');
    expect(event.title).toBe('Seismic Activity: M4.6 — 12km SE of Somewhere');
    expect(event.tags).toEqual(['seismic', 'earthquake']);
    expect(event.rawPayload).toEqual({ mag: 4.6, place: '12km SE of Somewhere', status: 'reviewed', depthKm: 10 });

    expect(result.health).toEqual({
      sourceId: 'usgs-earthquakes',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
    expect(result.rejected).toHaveLength(0);
  });

  it('maps GeoJSON [lon, lat, depth] coordinates to location.{latitude,longitude} without swapping them', async () => {
    // lon=10, lat=50 — deliberately distinct values so a swap bug would be caught, not
    // masked by a fixture where lon happens to equal lat.
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, geoJson([feature({ coordinates: [10, 50, 5] })])),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].location).toEqual({ latitude: 50, longitude: 10, precision: 'exact' });
  });

  it('reports confidence "medium" for an automatic (not yet human-reviewed) detection', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, geoJson([feature({ status: 'automatic' })])),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events[0].confidence).toBe('medium');
  });

  it('silently excludes non-earthquake feature types (e.g. quarry blasts) without rejecting them', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, geoJson([feature({ type: 'quarry blast' })])),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('filters out features outside the theater bounding box without rejecting them', async () => {
    const inBbox = feature({ id: 'in', coordinates: [35.1, 32.5, 10] });
    const outOfBbox = feature({ id: 'out', coordinates: [35.1, 90, 10] }); // above latMax, still a valid coordinate
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, geoJson([inBbox, outOfBbox])),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('usgs-in');
    expect(result.rejected).toHaveLength(0);
  });

  it('lets Zod reject a feature with an out-of-range coordinate instead of silently dropping it', async () => {
    const corrupted = feature({ coordinates: [35.1, 95, 10] }); // 95 > schema's max latitude of 90
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, geoJson([corrupted])),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].issues.some((i) => i.startsWith('location.latitude'))).toBe(true);
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(429, {}));

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeJsonResponse(503, {}));

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when the payload has no features array at all', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, { type: 'FeatureCollection' }),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('invalid-response');
  });

  it('caps events at the top 50 by magnitude when a bbox+day has more than that', async () => {
    const features = Array.from({ length: 60 }, (_, i) =>
      feature({ id: `us${i}`, mag: i + 1, coordinates: [35.1, 32.5, 10] }),
    );
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeJsonResponse(200, geoJson(features)),
    );

    const adapter = createUsgsEarthquakesAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(50);
    const mags = result.events.map((e) => (e.rawPayload as { mag: number }).mag);
    expect(Math.min(...mags)).toBe(11);
    expect(Math.max(...mags)).toBe(60);
  });
});
