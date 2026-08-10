import { describe, it, expect, vi } from 'vitest';
import { fetchCountryAlerts } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = new Date('2024-01-01T12:00:00Z').getTime();

const country = { name: 'Lebanon', flag: '🇱🇧', query: 'Lebanon conflict' };

function rssFeed(items: string[]): string {
  return `<?xml version="1.0"?>
<rss version="2.0"><channel>
${items.join('\n')}
</channel></rss>`;
}

function rssItem(title: string, link: string, pubDate: string): string {
  return `<item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate></item>`;
}

function fakeResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

describe('fetchCountryAlerts', () => {
  it('scores severity from title content and computes hoursAgo, reporting healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, rssFeed([
        rssItem('Airstrike reported near border - Reuters', 'https://example.com/a', 'Mon, 01 Jan 2024 06:00:00 GMT'),
      ]))
    );

    const result = await fetchCountryAlerts(country, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events).toEqual([{
      title: 'Airstrike reported near border',
      source: 'Reuters',
      time: 'Mon, 01 Jan 2024 06:00:00 GMT',
      url: 'https://example.com/a',
      severity: 'high', // "airstrike" is a HIGH_TERM
      hoursAgo: 6,
    }]);
    expect(result.health).toEqual({
      sourceId: 'regional-alerts:Lebanon',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('falls back to Google News as the source when there is no " - Suffix"', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, rssFeed([rssItem('Ceasefire talks continue', 'https://example.com/b', 'Mon, 01 Jan 2024 12:00:00 GMT')]))
    );

    const result = await fetchCountryAlerts(country, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events[0].source).toBe('Google News');
    expect(result.events[0].severity).toBe('medium'); // "ceasefire" is a MEDIUM_TERM
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, ''));

    const result = await fetchCountryAlerts(country, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchCountryAlerts(country, { fetchImpl, now: () => MOCK_NOW });

    expect(result.events).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });
});
