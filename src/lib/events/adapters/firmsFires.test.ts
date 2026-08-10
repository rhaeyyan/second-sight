import { describe, it, expect, vi } from 'vitest';
import {
  createFirmsFiresAdapter,
  classifyIntensity,
  isPossibleExplosion,
  severityForIntensity,
} from '@/lib/events/adapters/firmsFires';
import type { fetchWithTimeout } from '@/lib/fetcher';
import type { BBox } from '@/lib/conflicts/types';

// Fixed epoch, not Date.now() — deterministic clock per the generate-osint-fixtures skill.
const MOCK_NOW = 1_760_000_000_000;

const bbox: BBox = { latMin: 20, latMax: 42, lonMin: 25, lonMax: 65 };

const CSV_HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';

function csvRow(overrides: Partial<Record<string, string>> = {}): string {
  const cols: Record<string, string> = {
    latitude: '32.5', longitude: '35.1', bright_ti4: '330', scan: '0.4', track: '0.4',
    acq_date: '2024-01-01', acq_time: '1230', satellite: 'N', confidence: 'nominal',
    version: '2.0NRT', bright_ti5: '300', frp: '15', daynight: 'D',
    ...overrides,
  };
  return CSV_HEADER.split(',').map((k) => cols[k]).join(',');
}

function fakeResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

describe('classifyIntensity', () => {
  it('classifies below all thresholds as low', () => {
    expect(classifyIntensity(300, 10)).toBe('low');
  });

  it('classifies a high FRP/brightness reading as extreme', () => {
    expect(classifyIntensity(410, 110)).toBe('extreme');
  });
});

describe('isPossibleExplosion', () => {
  it('flags high FRP + high brightness at night as a possible explosion', () => {
    expect(isPossibleExplosion(410, 90)).toBe(true);
  });

  it('does not flag a moderate reading', () => {
    expect(isPossibleExplosion(330, 15)).toBe(false);
  });
});

describe('severityForIntensity', () => {
  it('maps intensity conservatively when there is no possible-explosion signal', () => {
    expect(severityForIntensity('low', false)).toBe('info');
    expect(severityForIntensity('medium', false)).toBe('low');
    expect(severityForIntensity('high', false)).toBe('medium');
    expect(severityForIntensity('extreme', false)).toBe('high');
  });

  it('only bumps to critical when extreme intensity and possible-explosion agree', () => {
    expect(severityForIntensity('extreme', true)).toBe('critical');
    // High intensity + possible-explosion should NOT bump — the mapping stays 'medium'.
    expect(severityForIntensity('high', true)).toBe('medium');
  });
});

describe('createFirmsFiresAdapter', () => {
  it('normalizes an in-bbox row into a fully populated IronsightEvent', async () => {
    const row = csvRow({ latitude: '32.5', longitude: '35.1', bright_ti4: '300', frp: '10', daynight: 'D' });
    const csv = [CSV_HEADER, row].join('\n');
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, csv));

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    const event = result.events[0];

    const expectedTs = Date.parse('2024-01-01T12:30:00Z');
    expect(event.location).toEqual({ latitude: 32.5, longitude: 35.1, precision: 'exact' });
    expect(event.occurredAt).toBe(expectedTs);
    expect(event.reportedAt).toBe(expectedTs);
    expect(event.ingestedAt).toBe(MOCK_NOW);
    expect(event.type).toBe('THERMAL_ANOMALY');
    expect(event.severity).toBe('info');
    expect(event.confidence).toBe('low');
    expect(event.verificationStatus).toBe('unverified');
    expect(event.title).toBe('Thermal anomaly detected (low intensity)');
    expect(event.tags).toEqual(['low', 'daytime']);
    expect(event.source).toEqual({ id: 'nasa-firms', name: 'NASA FIRMS VIIRS', sourceType: 'sensor' });
    expect(event.rawPayload).toMatchObject({ brightness: 300, frp: 10, confidence: 'nominal', daynight: 'D' });

    expect(result.health).toEqual({
      sourceId: 'nasa-firms',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('flags an extreme, possible-explosion detection as critical severity with the possible-explosion tag', async () => {
    const row = csvRow({ latitude: '32.5', longitude: '35.1', bright_ti4: '410', frp: '90', daynight: 'N' });
    const csv = [CSV_HEADER, row].join('\n');
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, csv));

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.type).toBe('POSSIBLE_EXPLOSION');
    expect(event.severity).toBe('critical');
    expect(event.title).toBe('Possible explosion detected (thermal anomaly, extreme intensity)');
    expect(event.tags).toEqual(['extreme', 'nighttime', 'possible-explosion']);
  });

  it('filters out rows outside the theater bounding box without rejecting them', async () => {
    const inBbox = csvRow({ latitude: '32.5', longitude: '35.1' });
    const outOfBbox = csvRow({ latitude: '55.0', longitude: '35.1' }); // above latMax, still a valid coordinate
    const csv = [CSV_HEADER, inBbox, outOfBbox].join('\n');
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, csv));

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('lets Zod reject a row with an out-of-range coordinate instead of silently dropping it', async () => {
    const corrupted = csvRow({ latitude: '95', longitude: '35.1' }); // outside schema's -90..90 range
    const csv = [CSV_HEADER, corrupted].join('\n');
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, csv));

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].issues.some((i) => i.startsWith('location.latitude'))).toBe(true);
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, ''));

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, ''));

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when FIRMS serves a page missing the expected columns', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, '<html><body>Service temporarily unavailable</body></html>')
    );

    const adapter = createFirmsFiresAdapter('iran-israel', bbox, { now: () => MOCK_NOW, fetchImpl });
    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('invalid-response');
  });
});
