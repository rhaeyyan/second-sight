import { describe, it, expect, vi } from 'vitest';
import {
  createGoogleNewsConflictAdapter,
  classifyConflictType,
  severityForConflictType,
  resolveRegion,
} from '@/lib/events/adapters/googleNewsConflict';
import type { fetchWithTimeout } from '@/lib/fetcher';

// Fixed epoch, not Date.now() — per the generate-osint-fixtures skill, mock data must
// use a deterministic clock so these tests don't depend on when they're run.
const MOCK_NOW = 1_760_000_000_000;

const conflictFeedConfig = {
  conflictQueries: ['Iran Israel conflict', 'Tehran strike'],
  conflictLocations: [{ match: ['tehran'], location: 'Tehran' }],
  defaultCountry: 'Iran',
};

// Structurally realistic Google News RSS, matching what the live feed actually returns.
function rssFeed(items: string[]): string {
  return `<?xml version="1.0"?>
<rss version="2.0"><channel>
${items.join('\n')}
</channel></rss>`;
}

function rssItem(title: string, pubDate: string): string {
  return `<item><title>${title}</title><link>https://news.example.com/a</link><pubDate>${pubDate}</pubDate></item>`;
}

function fakeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

describe('classifyConflictType', () => {
  it('classifies kinetic keywords as STRIKE', () => {
    expect(classifyConflictType('Missile strike hits Tehran suburb')).toBe('STRIKE');
  });

  it('falls back to REPORT for unclassified headlines', () => {
    expect(classifyConflictType('Officials meet to discuss trade')).toBe('REPORT');
  });
});

describe('severityForConflictType', () => {
  it('rates STRIKE and NUCLEAR as high, never higher than that from keyword classification alone', () => {
    expect(severityForConflictType('STRIKE')).toBe('high');
    expect(severityForConflictType('NUCLEAR')).toBe('high');
  });

  it('rates unclassified REPORT as info', () => {
    expect(severityForConflictType('REPORT')).toBe('info');
  });
});

describe('resolveRegion', () => {
  it('matches a configured location keyword', () => {
    expect(resolveRegion('Strike reported near Tehran', conflictFeedConfig)).toBe('Tehran');
  });

  it('falls back to the default country when nothing matches', () => {
    expect(resolveRegion('Officials issue statement', conflictFeedConfig)).toBe('Iran');
  });
});

describe('createGoogleNewsConflictAdapter', () => {
  it('normalizes valid items, drops a malformed one via schema validation, and reports rate-limited health', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      // First query: one clean item, one with a missing title (malformed — empty string
      // after extraction, rejected by IronsightEventSchema's title.min(1)).
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          rssFeed([
            rssItem('Missile strike hits Tehran - Reuters', 'Mon, 01 Jan 2024 00:00:00 GMT'),
            '<item><link>https://news.example.com/b</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>',
          ])
        )
      )
      // Second query: rate-limited.
      .mockResolvedValueOnce(fakeResponse(429, ''));

    const adapter = createGoogleNewsConflictAdapter('iran-israel', conflictFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      title: 'Missile strike hits Tehran',
      type: 'STRIKE',
      theater: 'iran-israel',
      region: 'Tehran',
      severity: 'high',
      confidence: 'medium',
      verificationStatus: 'single-source',
      ingestedAt: MOCK_NOW,
    });
    expect(result.events[0].location).toBeUndefined();

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].issues.some((i) => i.startsWith('title'))).toBe(true);

    expect(result.health.status).toBe('rate-limited');
    expect(result.health.lastAttemptAt).toBe(MOCK_NOW);
  });

  it('degrades a missing pubDate to ingestedAt rather than rejecting the event', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(
        fakeResponse(200, rssFeed([rssItem('Ceasefire talks resume - AP', '')]))
      )
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([])));

    const adapter = createGoogleNewsConflictAdapter('iran-israel', conflictFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(1);
    expect(result.events[0].reportedAt).toBe(MOCK_NOW);
    expect(result.health.status).toBe('healthy');
  });

  it('dedupes items with the same title across queries', async () => {
    const sameItem = rssItem('Strike reported near Tehran - Wire', 'Mon, 01 Jan 2024 00:00:00 GMT');
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([sameItem])))
      .mockResolvedValueOnce(fakeResponse(200, rssFeed([sameItem])));

    const adapter = createGoogleNewsConflictAdapter('iran-israel', conflictFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();
    expect(result.events).toHaveLength(1);
  });

  it('reports unavailable when every query fails outright', async () => {
    const fetchImpl = vi
      .fn<typeof fetchWithTimeout>()
      .mockRejectedValue(new Error('network unreachable'));

    const adapter = createGoogleNewsConflictAdapter('iran-israel', conflictFeedConfig, {
      now: () => MOCK_NOW,
      fetchImpl,
    });

    const result = await adapter.fetch();

    expect(result.events).toHaveLength(0);
    expect(result.health.status).toBe('unavailable');
    expect(result.health.lastSuccessAt).toBeUndefined();
  });
});
