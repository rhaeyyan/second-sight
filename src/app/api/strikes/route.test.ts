import { describe, it, expect, vi } from 'vitest';
import { fetchStrikeQuery, classifyStrike, resolveStrikeCountry } from './route';
import type { fetchWithTimeout } from '@/lib/fetcher';

const MOCK_NOW = 1_760_000_000_000;

const config = {
  defaultCountry: 'Iran',
  countryAttribution: [{ match: ['israel', 'idf'], country: 'Israel' }],
};

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

describe('classifyStrike', () => {
  it('classifies interception keywords as INTERCEPTION/high', () => {
    expect(classifyStrike('Iron Dome intercepts rocket over Tel Aviv')).toEqual({ category: 'INTERCEPTION', severity: 'high' });
  });

  it('classifies missile keywords as MISSILE/critical', () => {
    expect(classifyStrike('Ballistic missile fired at border town')).toEqual({ category: 'MISSILE', severity: 'critical' });
  });

  it('falls back to REPORT/low for unclassified headlines', () => {
    expect(classifyStrike('Officials meet to discuss ceasefire')).toEqual({ category: 'REPORT', severity: 'low' });
  });
});

describe('resolveStrikeCountry', () => {
  it('matches a configured attribution rule', () => {
    expect(resolveStrikeCountry('IDF confirms strike', config.defaultCountry, config.countryAttribution)).toBe('Israel');
  });

  it('falls back to the default country', () => {
    expect(resolveStrikeCountry('Unattributed explosion reported', config.defaultCountry, config.countryAttribution)).toBe('Iran');
  });
});

describe('fetchStrikeQuery', () => {
  it('parses items, strips the source suffix, and reports healthy', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(
      fakeResponse(200, rssFeed([rssItem('Missile strike hits border - Reuters', 'https://example.com/a', 'Mon, 01 Jan 2024 00:00:00 GMT')]))
    );

    const result = await fetchStrikeQuery('missile strike', config, { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([{
      date: 'Mon, 01 Jan 2024 00:00:00 GMT',
      category: 'MISSILE',
      severity: 'critical',
      title: 'Missile strike hits border',
      source: 'Reuters',
      url: 'https://example.com/a',
      country: 'Iran',
    }]);
    expect(result.health).toEqual({
      sourceId: 'google-news-strikes:missile strike',
      status: 'healthy',
      lastAttemptAt: MOCK_NOW,
      lastSuccessAt: MOCK_NOW,
    });
  });

  it('reports rate-limited on a 429 without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockResolvedValueOnce(fakeResponse(429, ''));

    const result = await fetchStrikeQuery('missile strike', config, { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([]);
    expect(result.health.status).toBe('rate-limited');
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn<typeof fetchWithTimeout>().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchStrikeQuery('missile strike', config, { fetchImpl, now: () => MOCK_NOW });

    expect(result.items).toEqual([]);
    expect(result.health.status).toBe('unavailable');
  });
});
