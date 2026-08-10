import { describe, it, expect, vi } from 'vitest';
import { fetchFiresData } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';
import type { BBox } from '@/lib/conflicts/types';

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
  return CSV_HEADER.split(',').map(k => cols[k]).join(',');
}

function fakeResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

describe('fetchFiresData', () => {
  it('parses in-bbox rows, filters out-of-bbox ones, and reports healthy', async () => {
    const inBbox = csvRow({ latitude: '32.5', longitude: '35.1', frp: '10', bright_ti4: '300' });
    const outOfBbox = csvRow({ latitude: '55.0', longitude: '35.1' }); // above latMax
    const csv = [CSV_HEADER, inBbox, outOfBbox].join('\n');
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, csv));

    const result = await fetchFiresData(bbox, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ lat: 32.5, lon: 35.1, intensity: 'low', possibleExplosion: false });
    expect(result.health).toEqual({
      sourceId: 'nasa-firms',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('classifies a high-FRP night detection as a possible explosion', async () => {
    const hot = csvRow({ latitude: '32.5', longitude: '35.1', frp: '90', bright_ti4: '410', daynight: 'N' });
    const csv = [CSV_HEADER, hot].join('\n');
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(200, csv));

    const result = await fetchFiresData(bbox, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events[0]).toMatchObject({ intensity: 'extreme', possibleExplosion: true });
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, ''));

    const result = await fetchFiresData(bbox, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, ''));

    const result = await fetchFiresData(bbox, { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchFiresData(bbox, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when FIRMS serves a page missing the expected columns', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, '<html><body>Service temporarily unavailable</body></html>')
    );

    const result = await fetchFiresData(bbox, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('invalid-response');
  });
});
