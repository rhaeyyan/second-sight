import { fetchWithTimeout, parseXML, getTextContent } from '@/lib/fetcher';
import type { ConflictKey, ServerConfig } from '@/lib/conflicts/types';
import { IronsightEventSchema, type IronsightEvent } from '@/lib/events/schema';
import type {
  SourceAdapter,
  SourceAdapterResult,
  SourceHealthStatus,
  RejectedPayload,
} from '@/lib/events/sourceAdapter';

/**
 * This adapter only needs newsFeeds out of ServerConfig's ~18 fields, same narrow-slice
 * pattern as googleNewsConflict.ts's ConflictFeedConfig.
 */
type NewsFeedConfig = Pick<ServerConfig, 'newsFeeds'>;

export interface NewsRssAdapterOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable fetch for tests — swaps out network I/O without touching global fetch. */
  fetchImpl?: typeof fetchWithTimeout;
}

/**
 * SourceAdapter for the general news aggregation feeds (src/app/api/news/route.ts's
 * former fetchRSS). Unlike googleNewsConflict.ts, this adapter does no keyword
 * classification of its own — every item normalizes to type 'REPORT', severity 'info',
 * and confidence 'low' (lower than the conflicts adapter's 'medium' because nothing here
 * has looked at the headline yet). Relevance filtering, noise suppression, and
 * translation are display-layer concerns and deliberately stay in the route, operating
 * on this adapter's output, not inside fetch+validate+normalize.
 */
export function createNewsRssAdapter(
  theater: ConflictKey,
  config: NewsFeedConfig,
  options: NewsRssAdapterOptions = {}
): SourceAdapter {
  const now = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetchWithTimeout;
  const sourceId = `news-rss-${theater}`;

  return {
    sourceId,

    async fetch(): Promise<SourceAdapterResult> {
      const lastAttemptAt = now();
      const seenTitles = new Set<string>();
      const events: IronsightEvent[] = [];
      const rejected: RejectedPayload[] = [];
      let rateLimited = false;

      const results = await Promise.allSettled(
        config.newsFeeds.map(async (feed) => {
          const res = await doFetch(feed.url, {
            timeout: 8000,
            headers: {
              'User-Agent': 'IronSight/1.0 RSS Reader',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            },
            redirect: 'follow',
          });

          if (res.status === 429) {
            rateLimited = true;
            return;
          }
          if (!res.ok) return;

          const text = await res.text();

          // Some feeds serve an HTML error/maintenance page with a 200 status instead
          // of the expected XML. Treated as "this feed had nothing usable" for this
          // fetch — not a crash — same as any other non-ok/empty response below.
          if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
            return;
          }

          const doc = parseXML(text);
          const items = doc.getElementsByTagName('item');
          // Also check for Atom feeds.
          const entries = doc.getElementsByTagName('entry');
          const elements = items.length > 0 ? items : entries;

          for (let i = 0; i < Math.min(elements.length, 15); i++) {
            const item = elements[i];

            let title = getTextContent(item, 'title');
            let link = getTextContent(item, 'link');
            const pubDateRaw =
              getTextContent(item, 'pubDate') ||
              getTextContent(item, 'published') ||
              getTextContent(item, 'updated');
            const category = getTextContent(item, 'category') || undefined;

            // For Atom feeds, link is in the href attribute rather than text content.
            if (!link) {
              const linkEl = item.getElementsByTagName('link')[0];
              if (linkEl) link = linkEl.getAttribute('href') || '';
            }

            // Strip the " - SourceName" suffix Google News appends to titles, same
            // condition as the pre-migration route: only for feeds literally named
            // 'Google News', not a generic heuristic applied to every feed.
            if (feed.name === 'Google News') {
              const dashIdx = title.lastIndexOf(' - ');
              if (dashIdx > 0) title = title.substring(0, dashIdx);
            }

            const key = title.toLowerCase().trim().substring(0, 50);
            if (seenTitles.has(key)) continue;
            seenTitles.add(key);

            // pubDate/published/updated missing or unparseable degrades gracefully to
            // ingestedAt rather than failing validation — we still know roughly when
            // we saw it, same trade-off as googleNewsConflict.
            const parsedPubDate = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
            const reportedAt = Number.isFinite(parsedPubDate) ? parsedPubDate : lastAttemptAt;

            const tags: string[] = [];
            if (feed.section) tags.push(feed.section);
            if (category) tags.push(category);

            const candidate = {
              id: `news-${theater}-${key}`,
              source: { id: sourceId, name: feed.name, sourceType: 'media' as const },
              type: 'REPORT',
              theater,
              reportedAt,
              ingestedAt: lastAttemptAt,
              severity: 'info' as const,
              confidence: 'low' as const,
              verificationStatus: 'single-source' as const,
              title,
              // The item's own permalink, distinct from source.url (which would
              // describe the feed itself). Omitted rather than set to '' when the
              // item genuinely has no link, so an empty string never masquerades
              // as a real URL downstream.
              url: link || undefined,
              tags,
              rawPayload: { title, pubDate: pubDateRaw, link, source: feed.name },
            };

            // Zod is the sole gatekeeper here — no manual `if (!title) continue` guard.
            // An empty title (missing <title> tag) is rejected by the schema, not
            // hand-rolled logic, so validation stays the single source of truth.
            const parsed = IronsightEventSchema.safeParse(candidate);
            if (parsed.success) {
              events.push(parsed.data);
            } else {
              rejected.push({
                payload: candidate,
                issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
              });
            }
          }
        })
      );

      const allFailed = results.every((r) => r.status === 'rejected');

      let status: SourceHealthStatus;
      if (allFailed) status = 'unavailable';
      else if (rateLimited) status = 'rate-limited';
      else if (events.length === 0 && rejected.length > 0) status = 'invalid-response';
      else status = 'healthy';

      events.sort((a, b) => b.reportedAt - a.reportedAt);

      return {
        events,
        rejected,
        health: {
          sourceId,
          status,
          lastAttemptAt,
          lastSuccessAt: status === 'unavailable' ? undefined : lastAttemptAt,
        },
      };
    },
  };
}
