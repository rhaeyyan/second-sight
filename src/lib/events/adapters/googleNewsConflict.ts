import { fetchWithTimeout, parseXML, getTextContent } from '@/lib/fetcher';
import type { ConflictKey, ServerConfig } from '@/lib/conflicts/types';
import { IronsightEventSchema, type EventSeverity, type IronsightEvent } from '@/lib/events/schema';
import type {
  SourceAdapter,
  SourceAdapterResult,
  SourceHealthStatus,
  RejectedPayload,
} from '@/lib/events/sourceAdapter';

/**
 * This adapter only needs three of ServerConfig's ~18 fields. Depending on the narrow
 * slice rather than the whole config keeps the adapter (and its tests) decoupled from
 * unrelated theater config — a ServerConfig satisfies this structurally, so callers
 * don't need to change.
 */
type ConflictFeedConfig = Pick<ServerConfig, 'conflictQueries' | 'conflictLocations' | 'defaultCountry'>;

/** Keyword classification, unchanged from the original /api/conflicts route. */
export function classifyConflictType(title: string): string {
  const t = title.toLowerCase();
  if (/missile|strike|attack|bomb|airstrike|struck|hit|shell|rocket fire/.test(t)) return 'STRIKE';
  if (/intercept|iron dome|defense|defend|shoot down/.test(t)) return 'DEFENSE';
  if (/troop|deploy|military|soldier|force/.test(t)) return 'MILITARY';
  if (/sanction|diplomacy|negotiat|ceasefire|talk/.test(t)) return 'DIPLOMATIC';
  if (/nuclear|enrichment|iaea|uranium/.test(t)) return 'NUCLEAR';
  if (/drone|uav|shahed/.test(t)) return 'DRONE';
  return 'REPORT';
}

/**
 * Kinetic/nuclear news outranks diplomatic or unclassified reports. A crude proxy —
 * headline keyword classification, not confirmed damage assessment — hence 'medium'
 * confidence on every event this adapter produces, never 'high'.
 */
export function severityForConflictType(type: string): EventSeverity {
  switch (type) {
    case 'STRIKE':
    case 'NUCLEAR':
      return 'high';
    case 'DRONE':
    case 'DEFENSE':
    case 'MILITARY':
      return 'medium';
    case 'DIPLOMATIC':
      return 'low';
    default:
      return 'info';
  }
}

export function resolveRegion(title: string, server: ConflictFeedConfig): string {
  const t = title.toLowerCase();
  for (const rule of server.conflictLocations) {
    if (rule.match.some((m) => t.includes(m))) return rule.location;
  }
  return server.defaultCountry;
}

export interface GoogleNewsConflictAdapterOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable fetch for tests — swaps out network I/O without touching global fetch. */
  fetchImpl?: typeof fetchWithTimeout;
}

/**
 * Reference implementation of the SourceAdapter contract (draft-implementation-plan.md
 * §3), built from the Google News RSS feed that previously lived inline in
 * src/app/api/conflicts/route.ts. One adapter instance is scoped to a single theater,
 * since query terms and region resolution are conflict-specific (ServerConfig).
 */
export function createGoogleNewsConflictAdapter(
  theater: ConflictKey,
  server: ConflictFeedConfig,
  options: GoogleNewsConflictAdapterOptions = {}
): SourceAdapter {
  const now = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetchWithTimeout;
  const sourceId = `google-news-conflict-${theater}`;

  return {
    sourceId,

    async fetch(): Promise<SourceAdapterResult> {
      const lastAttemptAt = now();
      const seenTitles = new Set<string>();
      const events: IronsightEvent[] = [];
      const rejected: RejectedPayload[] = [];
      let rateLimited = false;

      const results = await Promise.allSettled(
        server.conflictQueries.map(async (query) => {
          const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
          const res = await doFetch(url, { timeout: 8000 });

          if (res.status === 429) {
            rateLimited = true;
            return;
          }
          if (!res.ok) return;

          const text = await res.text();
          const doc = parseXML(text);
          const items = doc.getElementsByTagName('item');

          for (let i = 0; i < Math.min(items.length, 25); i++) {
            const item = items[i];
            let title = getTextContent(item, 'title');
            const pubDateRaw = getTextContent(item, 'pubDate');

            const dashIdx = title.lastIndexOf(' - ');
            const sourceName = dashIdx > 0 ? title.substring(dashIdx + 3) : 'Google News';
            if (dashIdx > 0) title = title.substring(0, dashIdx);

            const key = title.toLowerCase().trim().substring(0, 50);
            if (seenTitles.has(key)) continue;
            seenTitles.add(key);

            const type = classifyConflictType(title);
            // pubDate missing or unparseable degrades gracefully to ingestedAt rather
            // than failing validation — we still know roughly when we saw it.
            const parsedPubDate = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
            const reportedAt = Number.isFinite(parsedPubDate) ? parsedPubDate : lastAttemptAt;

            const candidate = {
              id: `gn-${theater}-${key}`,
              source: { id: sourceId, name: sourceName, sourceType: 'media' as const },
              type,
              theater,
              region: resolveRegion(title, server),
              reportedAt,
              ingestedAt: lastAttemptAt,
              severity: severityForConflictType(type),
              confidence: 'medium' as const,
              verificationStatus: 'single-source' as const,
              title,
              tags: [type.toLowerCase()],
              rawPayload: { title, pubDate: pubDateRaw, source: sourceName },
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
