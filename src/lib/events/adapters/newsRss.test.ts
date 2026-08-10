import { describe, it, expect, vi } from 'vitest';
import { createNewsRssAdapter } from '@/lib/events/adapters/newsRss';
import type { fetchWithTimeout } from '@/lib/fetcher';

// Fixed epoch, not Date.now() — per the generate-osint-fixtures skill, mock data must
// use a deterministic clock so these tests don't depend on when they're run.
const MOCK_NOW = 1_760_000_000_000;

const newsFeedConfig = {
  newsFeeds: [
    { url: 'https://feed.example.com/a', name: 'Example Wire' },
    { url: 'https://feed.example.com/b', name: 'Second Wire' },
  ],
};

function rssFeed(items: string[]): string {
  return `<?xml version="1.0"?>
<rss version="2.0"><channel>
${items.join('\n')}
</channel></rss>`;
}

function rssItem(title: string, pubDate: string, opts: { link?: string; category?: string } = {}): string {
  const link = opts.link ?? 'https://news.example.com/a';
  const category = opts.category ? `<category>${opts.category}</category>` : '';
  return `<item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate>${category}</item>`;
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
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

describe('createNewsRssAdapter', () => {
  it('normalizes valid items into unclassified REPORT events with low confidence', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          rssFeed([
            rssItem('Ceasefire talks resume', 'Mon, 01 Jan 2024 00:00:00 GMT', {
              category: 'diplomacy',
              link: 'https://news.example.com/ceasefire-talks',
            }),
          ])
        )
      )
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([])));

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      title: 'Ceasefire talks resume',
      type: 'REPORT',
      theater: 'iran-israel',
      severity: 'info',
      confidence: 'low',
      verificationStatus: 'single-source',
      ingestedAt: MOCK_NOW,
      tags: ['diplomacy'],
      source: { name: 'Example Wire', sourceType: 'media' },
      url: 'https://news.example.com/ceasefire-talks',
    });
    expect(result.events[0].region).toBeUndefined();
    expect(result.health.status).toBe('healthy');
  });

  it('drops a malformed item (missing title) via schema validation, counting it in rejected', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          rssFeed([
            rssItem('Valid headline', 'Mon, 01 Jan 2024 00:00:00 GMT'),
            '<item><link>https://news.example.com/b</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
          ])
        )
      )
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([])));

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Valid headline');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].issues.some((i) => i.startsWith('title'))).toBe(true);
    expect(result.health.status).toBe('healthy');
  });

  it('parses Atom entries, reading the link from the href attribute and the timestamp from updated', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(
        fakeResponse(200, atomFeed([atomEntry('Drone intercepted over border', 'https://example.com/atom-1', '2024-01-01T00:00:00Z')]))
      )
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([])));

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Drone intercepted over border');
    expect(result.events[0].reportedAt).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(result.events[0].url).toBe('https://example.com/atom-1');
  });

  it('strips the " - SourceName" suffix only for a feed named Google News', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(
        fakeResponse(200, rssFeed([rssItem('Missile strike hits Tehran - Reuters', 'Mon, 01 Jan 2024 00:00:00 GMT')]))
      )
      .mockResolvedValueOnce(
        fakeResponse(200, rssFeed([rssItem('Border clash reported - Wire', 'Mon, 01 Jan 2024 00:00:00 GMT')]))
      );

    const googleFeedConfig = {
      newsFeeds: [
        { url: 'https://news.google.com/rss', name: 'Google News' },
        { url: 'https://feed.example.com/b', name: 'Second Wire' },
      ],
    };

    const adapter = createNewsRssAdapter('iran-israel', googleFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    const fromGoogle = result.events.find((e) => e.source.name === 'Google News');
    const fromWire = result.events.find((e) => e.source.name === 'Second Wire');
    expect(fromGoogle?.title).toBe('Missile strike hits Tehran');
    expect(fromWire?.title).toBe('Border clash reported - Wire');
  });

  it('dedupes items with the same title-prefix key across feeds', async () => {
    const sameItem = rssItem('Strike reported near Tehran', 'Mon, 01 Jan 2024 00:00:00 GMT');
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([sameItem])))
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([sameItem])));

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();
    expect(result.events).toHaveLength(1);
  });

  it('reports rate-limited health when one feed 429s', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(
        fakeResponse(200, rssFeed([rssItem('Officials issue statement', 'Mon, 01 Jan 2024 00:00:00 GMT')]))
      )
      .mockResolvedValueOnce(fakeResponse(429, ''));

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();
    expect(result.health.status).toBe('rate-limited');
    expect(result.health.lastAttemptAt).toBe(MOCK_NOW);
  });

  it('reports unavailable when every feed fetch throws', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
    expect(result.health.lastSuccessAt).toBeUndefined();
  });

  it('reports healthy with zero events when every feed returns a valid, empty response', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([])))
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([])));

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.health.status).toBe('healthy');
  });

  it('treats a feed serving an HTML page instead of XML as a failed fetch for that feed, not a crash', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeResponse(200, '<!DOCTYPE html><html><body>Service unavailable</body></html>'))
      .mockResolvedValueOnce(
        fakeResponse(200, rssFeed([rssItem('Valid headline', 'Mon, 01 Jan 2024 00:00:00 GMT')]))
      );

    const adapter = createNewsRssAdapter('iran-israel', newsFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Valid headline');
    expect(result.health.status).toBe('healthy');
  });
});
