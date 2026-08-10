import { NextResponse } from 'next/server';
import { translateFreeText } from '@/lib/hebrew';
import { getConflictFromRequest } from '@/lib/conflicts';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

// Detect non-Latin scripts (Hebrew, Arabic, Farsi, Cyrillic, etc.)
function hasNonLatinText(text: string): boolean {
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\u0400-\u04FF]/.test(text);
}

export const dynamic = 'force-dynamic';

// Scrape public Telegram channels via embed endpoint
// Completely free, no API key, no bot needed
// Channel list is per-conflict (see src/lib/conflicts/*).

interface TelegramPost {
  channel: string;
  channelLabel: string;
  color: string;
  postId: number;
  text: string;
  date: string;
  url: string;
}

// Persist latest known post IDs across requests (in-memory cache)
const latestKnownIds: Record<string, number> = {};
// Cache of fetched posts so we don't re-fetch
const postCache: Record<string, { text: string; date: string }> = {};

/**
 * The binary search below relies on "no post at this ID" as its termination signal, so
 * fetchPost can't just return null on any failure \u2014 that would make a rate-limit or a
 * network blip look identical to a genuinely empty slot and corrupt the search. `found`
 * and `not-found` are both legitimate probe outcomes; `rate-limited`/`unavailable` mean
 * the probe itself didn't get a trustworthy answer.
 */
export type PostFetchOutcome =
  | { status: 'found'; text: string; date: string }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'unavailable' };

export async function fetchPost(
  channel: string,
  postId: number,
  fetchImpl: typeof fetch = fetch
): Promise<PostFetchOutcome> {
  const cacheKey = `${channel}/${postId}`;
  const cached = postCache[cacheKey];
  if (cached) return { status: 'found', ...cached };

  let res: Response;
  try {
    res = await fetchImpl(`https://t.me/${channel}/${postId}?embed=1&mode=tme`, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
  } catch {
    return { status: 'unavailable' };
  }

  if (res.status === 404) return { status: 'not-found' };
  if (res.status === 429) return { status: 'rate-limited' };
  if (!res.ok) return { status: 'unavailable' };

  const html = await res.text();

  const textMatch = html.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>(.*?)<\/div>/s);
  if (!textMatch) return { status: 'not-found' };

  let text = textMatch[1]
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#036;/g, '$')
    .replace(/\s+/g, ' ')
    .trim();

  const dateMatch = html.match(/<time[^>]*datetime="([^"]+)"/);
  const date = dateMatch ? dateMatch[1] : new Date().toISOString();

  if (!text) return { status: 'not-found' };

  // Auto-translate non-Latin text (Hebrew, Farsi, Arabic, etc.)
  if (hasNonLatinText(text)) {
    text = await translateFreeText(text);
  }

  postCache[cacheKey] = { text, date };
  return { status: 'found', text, date };
}

/**
 * Derives one channel's health from its final "fetch the latest 3 posts" outcomes (not
 * from the binary-search probes, which are expected to hit `not-found` constantly by
 * design). A rate-limit on any of the three wins; all three unavailable means the channel
 * couldn't be reached at all; anything else \u2014 including zero posts found \u2014 is healthy,
 * since a channel with nothing new is a normal outcome, not a failure.
 */
export function summarizeChannelHealth(
  outcomes: PostFetchOutcome['status'][],
  sourceId: string,
  lastAttemptAt: number
): SourceHealth {
  if (outcomes.includes('rate-limited')) {
    return { sourceId, status: 'rate-limited', lastAttemptAt };
  }
  if (outcomes.length > 0 && outcomes.every(o => o === 'unavailable')) {
    return { sourceId, status: 'unavailable', lastAttemptAt };
  }
  return { sourceId, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt };
}

// On first call, find latest post via binary search. After that, just check ahead.
async function findLatestPostId(channel: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const known = latestKnownIds[channel];

  if (known) {
    // Check up to 20 ahead in parallel for new posts
    const checks = Array.from({ length: 20 }, (_, i) => known + 20 - i);
    const results = await Promise.allSettled(
      checks.map(id => fetchPost(channel, id, fetchImpl).then(r => r.status === 'found' ? id : null))
    );

    let highest = known;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value > highest) {
        highest = r.value;
      }
    }
    latestKnownIds[channel] = highest;
    return highest;
  }

  // First time: binary search (sequential but fast with big jumps)
  let low = 1;
  let high = 200000;

  // Quick probe to find rough range
  for (const probe of [500, 5000, 15000, 30000, 50000, 80000, 120000, 180000]) {
    if (probe >= high) break;
    const result = await fetchPost(channel, probe, fetchImpl);
    if (result.status === 'found') {
      low = probe;
    } else {
      high = probe;
      break;
    }
  }

  // Binary search
  while (high - low > 10) {
    const mid = Math.floor((low + high) / 2);
    const result = await fetchPost(channel, mid, fetchImpl);
    if (result.status === 'found') {
      low = mid;
    } else {
      high = mid;
    }
  }

  // Fine scan the last few
  for (let i = high; i >= low; i--) {
    const result = await fetchPost(channel, i, fetchImpl);
    if (result.status === 'found') {
      latestKnownIds[channel] = i;
      return i;
    }
  }

  latestKnownIds[channel] = low;
  return low;
}

export async function GET(req: Request) {
  const { server } = getConflictFromRequest(req);
  const channels = server.telegramChannels;
  const lastAttemptAt = Date.now();

  // Process ALL channels in parallel — each finds latest + fetches 3 posts
  const channelResults = await Promise.allSettled(
    channels.map(async (channel) => {
      const latestId = await findLatestPostId(channel.name);
      const posts: TelegramPost[] = [];

      // Fetch only latest 3 posts in parallel
      const ids = [latestId, latestId - 1, latestId - 2].filter(id => id > 0);
      const results = await Promise.allSettled(
        ids.map(id => fetchPost(channel.name, id))
      );

      const outcomes: PostFetchOutcome['status'][] = [];
      results.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        outcomes.push(r.value.status);
        if (r.value.status === 'found') {
          posts.push({
            channel: channel.name,
            channelLabel: channel.label,
            color: channel.color,
            postId: ids[i],
            text: r.value.text,
            date: r.value.date,
            url: `https://t.me/${channel.name}/${ids[i]}`,
          });
        }
      });

      return {
        posts,
        health: summarizeChannelHealth(outcomes, `telegram:${channel.name}`, lastAttemptAt),
      };
    })
  );

  const allPosts: TelegramPost[] = [];
  const health: SourceHealth[] = [];
  for (const result of channelResults) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value.posts);
      health.push(result.value.health);
    }
  }

  // Sort newest first
  allPosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return NextResponse.json({
    posts: allPosts,
    channels: channels.map(c => c.label),
    updated: new Date().toISOString(),
  }, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
