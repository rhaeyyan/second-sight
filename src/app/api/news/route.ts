import { NextResponse } from 'next/server';
import { fetchWithTimeout, parseXML, getTextContent } from '@/lib/fetcher';
import { isHebrew, translateFreeText } from '@/lib/hebrew';
import { getConflictFromRequest } from '@/lib/conflicts';
import type { NewsItem } from '@/types';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

export const revalidate = 0;

interface FeedFetchResult {
  items: NewsItem[];
  health: SourceHealth;
}

/**
 * Fetches and parses a single RSS/Atom feed. Returns per-feed health rather than
 * swallowing every failure into an empty array — with 20+ feeds aggregated via
 * Promise.allSettled below, "this one feed is down" and "this one feed just has
 * nothing new" used to be indistinguishable from the response alone.
 */
export async function fetchRSS(
  feedUrl: string,
  source: string,
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<FeedFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const lastAttemptAt = now();

  try {
    const res = await fetchImpl(feedUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'IronSight/1.0 RSS Reader',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return {
        items: [],
        health: {
          sourceId: source,
          status: res.status === 429 ? 'rate-limited' : 'unavailable',
          lastAttemptAt,
        },
      };
    }
    const text = await res.text();

    // Skip if response is HTML (not RSS) — some feeds serve an error/maintenance
    // page with a 200 status instead of the expected XML.
    if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
      return { items: [], health: { sourceId: source, status: 'invalid-response', lastAttemptAt } };
    }

    const doc = parseXML(text);
    const items = doc.getElementsByTagName('item');

    // Also check for Atom feeds
    const entries = doc.getElementsByTagName('entry');
    const elements = items.length > 0 ? items : entries;

    const results: NewsItem[] = [];

    for (let i = 0; i < Math.min(elements.length, 15); i++) {
      const item = elements[i];

      let title = getTextContent(item, 'title');
      let link = getTextContent(item, 'link');
      let pubDate = getTextContent(item, 'pubDate') || getTextContent(item, 'published') || getTextContent(item, 'updated');

      // For Atom feeds, link is in href attribute
      if (!link) {
        const linkEl = item.getElementsByTagName('link')[0];
        if (linkEl) link = linkEl.getAttribute('href') || '';
      }

      if (!title) continue;

      // Dedupe Google News titles that include " - Source" suffix
      if (source === 'Google News') {
        const dashIdx = title.lastIndexOf(' - ');
        if (dashIdx > 0) {
          title = title.substring(0, dashIdx);
        }
      }

      results.push({
        title,
        link,
        source,
        pubDate,
        category: getTextContent(item, 'category') || undefined,
      });
    }
    return {
      items: results,
      health: { sourceId: source, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
    };
  } catch {
    return { items: [], health: { sourceId: source, status: 'unavailable', lastAttemptAt } };
  }
}

export async function GET(req: Request) {
  const { server } = getConflictFromRequest(req);
  const feeds = server.newsFeeds;
  const relevanceKeywords = server.newsRelevanceKeywords;
  const unfilteredSources = new Set(feeds.filter(f => f.unfiltered).map(f => f.name));

  // Drop obvious sports/entertainment noise from broad wires (e.g. "IOC lifts
  // Russia suspension" mentions a belligerent but isn't conflict news).
  const NOISE = /world.?cup|\bfifa\b|\bioc\b|olympic|premier.?league|champions.?league|super.?bowl|\bnba\b|\bnfl\b|\bnhl\b|\bmlb\b|grammy|oscar|\bemmy|box.?office|celebrity|eurovision/i;

  const isRelevant = (item: NewsItem): boolean => {
    if (NOISE.test(item.title)) return false; // hard exclude — sports/entertainment is never conflict news
    if (unfilteredSources.has(item.source)) return true;
    return relevanceKeywords.test(item.title) || relevanceKeywords.test(item.category || '');
  };

  const results = await Promise.all(
    feeds.map(feed => fetchRSS(feed.url, feed.name))
  );

  const allNews: NewsItem[] = results.flatMap(r => r.items).filter(isRelevant);
  const health = results.map(r => r.health);

  // Translate Hebrew titles to English
  const hebrewItems = allNews.filter(item => isHebrew(item.title));
  if (hebrewItems.length > 0) {
    const translations = await Promise.allSettled(
      hebrewItems.map(item => translateFreeText(item.title))
    );
    translations.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value !== hebrewItems[i].title) {
        hebrewItems[i].title = result.value;
      }
    });
  }

  // Deduplicate by title similarity (exact match after lowercasing)
  const seen = new Set<string>();
  const deduped = allNews.filter(item => {
    const key = item.title.toLowerCase().trim().substring(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by closest to now first (handles RSS feeds with future timestamps)
  const now = Date.now();
  deduped.sort((a, b) => {
    const distA = Math.abs(now - new Date(a.pubDate || 0).getTime());
    const distB = Math.abs(now - new Date(b.pubDate || 0).getTime());
    return distA - distB;
  });

  return NextResponse.json(deduped.slice(0, 100), {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // One SourceHealth per feed queried. Not consumed by the UI yet (Phase 2), same
      // as /api/conflicts's X-Source-Health — inspectable via devtools in the meantime.
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
