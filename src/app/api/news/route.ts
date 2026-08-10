import { NextResponse } from 'next/server';
import { isHebrew, translateFreeText } from '@/lib/hebrew';
import { getConflictFromRequest } from '@/lib/conflicts';
import { createNewsRssAdapter } from '@/lib/events/adapters/newsRss';
import type { IronsightEvent } from '@/lib/events/schema';
import type { NewsItem } from '@/types';

export const dynamic = 'force-dynamic';

export const revalidate = 0;

// Drop obvious sports/entertainment noise from broad wires (e.g. "IOC lifts
// Russia suspension" mentions a belligerent but isn't conflict news).
const NOISE = /world.?cup|\bfifa\b|\bioc\b|olympic|premier.?league|champions.?league|super.?bowl|\bnba\b|\bnfl\b|\bnhl\b|\bmlb\b|grammy|oscar|\bemmy|box.?office|celebrity|eurovision/i;

/**
 * Sports/entertainment noise is a hard exclude regardless of keyword relevance;
 * unfiltered sources (outlets inherently on-topic for this conflict) bypass the
 * keyword check entirely. Exported as a standalone function, parameterized on
 * config rather than closing over route-scoped state, so it's testable with plain
 * fixtures — same pattern as resolveRegion() in googleNewsConflict.ts.
 */
export function isNewsRelevant(
  event: IronsightEvent,
  relevanceKeywords: RegExp,
  unfilteredSources: Set<string>
): boolean {
  if (NOISE.test(event.title)) return false; // hard exclude — sports/entertainment is never conflict news
  if (unfilteredSources.has(event.source.name)) return true;
  return relevanceKeywords.test(event.title) || relevanceKeywords.test(event.tags[0] || '');
}

/** Drops events whose title (lowercased, first 60 chars) has already been seen. */
export function dedupeByTitle(events: IronsightEvent[]): IronsightEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const titleKey = event.title.toLowerCase().trim().substring(0, 60);
    if (seen.has(titleKey)) return false;
    seen.add(titleKey);
    return true;
  });
}

/**
 * Temporary compatibility shim. NewsFeed still consumes NewsItem, so the route maps
 * IronsightEvent down to that shape rather than migrating the UI here — that's Phase 2
 * scope, same pattern as toConflictEvent() in src/app/api/conflicts/route.ts. `link`
 * falls back to '' only when an item genuinely had no permalink (rare in practice —
 * every RSS/Atom item this route sees normally has one); IronsightEvent.url is left
 * undefined rather than faked in that case, this shim is the only place '' appears.
 */
export function toNewsItem(event: IronsightEvent): NewsItem {
  return {
    title: event.title,
    link: event.url ?? '',
    source: event.source.name,
    pubDate: new Date(event.reportedAt).toISOString(),
    category: event.tags[0],
  };
}

export async function GET(req: Request) {
  const { key, server } = getConflictFromRequest(req);
  const relevanceKeywords = server.newsRelevanceKeywords;
  const unfilteredSources = new Set(server.newsFeeds.filter((f) => f.unfiltered).map((f) => f.name));

  const adapter = createNewsRssAdapter(key, server);
  const { events, health } = await adapter.fetch();

  const relevant = events.filter((event) => isNewsRelevant(event, relevanceKeywords, unfilteredSources));

  // Translate Hebrew titles to English
  const hebrewEvents = relevant.filter((event) => isHebrew(event.title));
  if (hebrewEvents.length > 0) {
    const translations = await Promise.allSettled(
      hebrewEvents.map((event) => translateFreeText(event.title))
    );
    translations.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value !== hebrewEvents[i].title) {
        hebrewEvents[i].title = result.value;
      }
    });
  }

  // Deduplicate by title similarity (exact match after lowercasing)
  const deduped = dedupeByTitle(relevant);

  // Sort by closest to now first (handles RSS feeds with future timestamps)
  const now = Date.now();
  deduped.sort((a, b) => Math.abs(now - a.reportedAt) - Math.abs(now - b.reportedAt));

  return NextResponse.json(deduped.slice(0, 100).map(toNewsItem), {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // One aggregate SourceHealth for the whole adapter rather than one per feed —
      // intentionally collapses per-feed granularity, same trade-off /api/conflicts
      // already made when it adopted the SourceAdapter contract. Not consumed by the
      // UI yet (Phase 2); inspectable via devtools in the meantime.
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
