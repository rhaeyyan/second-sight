import { describe, it, expect, vi } from 'vitest';
import { fetchRSS } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;

function rssFeed(items: string[]): string {
  return `<?xml version="1.0"?>
<rss version="2.0"><channel>
${items.join('\n')}
</channel></rss>`;
}

function rssItem(title: string, link: string, pubDate: string): string {
  return `<item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate></item>`;
}

function atomFeed(entries: string[]): string {
  return `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${entries.join('\n')}
</feed>`;
}

function atomEntry(title: string, href: string, updated: string): string {
  return `<entry><title>${title}</title><link href="${href}"/><updated>${updated}</updated></entry>`;
}

function fakeResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

describe('fetchRSS', () => {
  it('parses RSS items and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, rssFeed([rssItem('Strike hits border town', 'https://example.com/a', 'Mon, 01 Jan 2024 00:00:00 GMT')]))
    );

    const result = await fetchRSS('https://feed.example.com/rss', 'Example Wire', { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([{
      title: 'Strike hits border town',
      link: 'https://example.com/a',
      source: 'Example Wire',
      pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
      category: undefined,
    }]);
    expect(result.health).toEqual({
      sourceId: 'Example Wire',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('parses Atom entries, reading the link from the href attribute', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, atomFeed([atomEntry('Ceasefire talks resume', 'https://example.com/b', '2024-01-01T00:00:00Z')]))
    );

    const result = await fetchRSS('https://feed.example.com/atom', 'Example Atom', { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([{
      title: 'Ceasefire talks resume',
      link: 'https://example.com/b',
      source: 'Example Atom',
      pubDate: '2024-01-01T00:00:00Z',
      category: undefined,
    }]);
    expect(result.health.status).toBe('healthy');
  });

  it('strips the " - Source" suffix only for Google News', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, rssFeed([rssItem('Missile strike hits Tehran - Reuters', 'https://example.com/c', 'Mon, 01 Jan 2024 00:00:00 GMT')]))
    );

    const result = await fetchRSS('https://news.google.com/rss', 'Google News', { fetchImpl, now: () => MOCK_NOW });

    expect(result.items[0].title).toBe('Missile strike hits Tehran');
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, ''));

    const result = await fetchRSS('https://feed.example.com/rss', 'Example Wire', { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(503, ''));

    const result = await fetchRSS('https://feed.example.com/rss', 'Example Wire', { fetchImpl, now: () => MOCK_NOW });

    expect(result.health.status).toBe('unavailable');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchRSS('https://feed.example.com/rss', 'Example Wire', { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });

  it('reports invalid-response when the feed serves an HTML page instead of XML', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, '<!DOCTYPE html><html><body>Service unavailable</body></html>')
    );

    const result = await fetchRSS('https://feed.example.com/rss', 'Example Wire', { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([]);
    expect(result.health.status).toBe('invalid-response');
  });

  it('drops items with no title but keeps parsing the rest', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, rssFeed([
        '<item><link>https://example.com/notitle</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
        rssItem('Valid item', 'https://example.com/d', 'Mon, 01 Jan 2024 00:00:00 GMT'),
      ]))
    );

    const result = await fetchRSS('https://feed.example.com/rss', 'Example Wire', { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Valid item');
    expect(result.health.status).toBe('healthy');
  });
});
