import { NextResponse } from 'next/server';
import { fetchWithTimeout, parseXML, getTextContent } from '@/lib/fetcher';
import { getConflictFromRequest } from '@/lib/conflicts';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

export interface StrikeEvent {
  id: string;
  date: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  source: string;
  url: string;
  country: string;
}

export function classifyStrike(title: string): { category: string; severity: StrikeEvent['severity'] } {
  const t = title.toLowerCase();
  if (t.match(/intercept|iron dome|shoot down|arrow|david.s sling/)) return { category: 'INTERCEPTION', severity: 'high' };
  if (t.match(/missile|ballistic/)) return { category: 'MISSILE', severity: 'critical' };
  if (t.match(/drone|uav|shahed/)) return { category: 'DRONE', severity: 'high' };
  if (t.match(/airstrike|air strike|bombing|bomb/)) return { category: 'AIRSTRIKE', severity: 'critical' };
  if (t.match(/rocket/)) return { category: 'ROCKET', severity: 'high' };
  if (t.match(/strike|attack/)) return { category: 'STRIKE', severity: 'medium' };
  return { category: 'REPORT', severity: 'low' };
}

export function resolveStrikeCountry(
  title: string,
  defaultCountry: string,
  countryAttribution: { match: string[]; country: string }[]
): string {
  const t = title.toLowerCase();
  for (const rule of countryAttribution) {
    if (rule.match.some(m => t.includes(m))) return rule.country;
  }
  return defaultCountry;
}

interface StrikeQueryConfig {
  defaultCountry: string;
  countryAttribution: { match: string[]; country: string }[];
}

interface StrikeQueryResult {
  items: Omit<StrikeEvent, 'id'>[];
  health: SourceHealth;
}

/** Fetches and classifies one Google News RSS query. Health is per-query since GET loops over several. */
export async function fetchStrikeQuery(
  query: string,
  config: StrikeQueryConfig,
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<StrikeQueryResult> {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const lastAttemptAt = now();
  const sourceId = `google-news-strikes:${query}`;

  try {
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetchImpl(url, { timeout: 8000 });
    if (!res.ok) {
      return {
        items: [],
        health: { sourceId, status: res.status === 429 ? 'rate-limited' : 'unavailable', lastAttemptAt },
      };
    }

    const text = await res.text();
    const doc = parseXML(text);
    const items = doc.getElementsByTagName('item');

    const results: Omit<StrikeEvent, 'id'>[] = [];
    for (let i = 0; i < Math.min(items.length, 15); i++) {
      const item = items[i];
      let title = getTextContent(item, 'title');
      const pubDate = getTextContent(item, 'pubDate');
      const link = getTextContent(item, 'link');

      const dashIdx = title.lastIndexOf(' - ');
      const source = dashIdx > 0 ? title.substring(dashIdx + 3) : '';
      if (dashIdx > 0) title = title.substring(0, dashIdx);

      const { category, severity } = classifyStrike(title);
      const country = resolveStrikeCountry(title, config.defaultCountry, config.countryAttribution);

      results.push({
        date: pubDate || new Date(lastAttemptAt).toISOString(),
        category, severity, title, source, url: link, country,
      });
    }
    return {
      items: results,
      health: { sourceId, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
    };
  } catch {
    return { items: [], health: { sourceId, status: 'unavailable', lastAttemptAt } };
  }
}

// Strike tracker using Google News RSS
export async function GET(req: Request) {
  const { server } = getConflictFromRequest(req);
  const config: StrikeQueryConfig = { defaultCountry: server.defaultCountry, countryAttribution: server.countryAttribution };

  const strikes: StrikeEvent[] = [];
  const health: SourceHealth[] = [];

  // Sequential, not Promise.all — spreads requests to news.google.com out over time
  // rather than bursting them, since strikeQueries can be a dozen-plus queries.
  for (const q of server.strikeQueries) {
    const result = await fetchStrikeQuery(q, config);
    health.push(result.health);
    for (const item of result.items) {
      strikes.push({ id: `strike-${strikes.length}-${Date.now()}`, ...item });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = strikes.filter(s => {
    const key = s.title.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return NextResponse.json(deduped.slice(0, 25), {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
