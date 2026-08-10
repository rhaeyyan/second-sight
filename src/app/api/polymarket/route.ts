import { NextResponse } from 'next/server';
import { getConflictFromRequest } from '@/lib/conflicts';
import { fetchWithTimeout } from '@/lib/fetcher';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

const POLYMARKET_SOURCE_ID = 'polymarket';
const POLYMARKET_URL = 'https://gamma-api.polymarket.com/markets?limit=500&closed=false&active=true&order=volume24hr&ascending=false';

interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  volume24hr: number;
  liquidity: string;
  active: boolean;
  closed: boolean;
  endDate: string;
  oneDayPriceChange: number;
  image: string;
}

interface FilteredMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: { label: string; price: number }[];
  volume24hr: number;
  volumeTotal: number;
  liquidity: number;
  endDate: string;
  oneDayPriceChange: number;
  image: string;
}

interface PolymarketFetchResult {
  markets: FilteredMarket[];
  health: SourceHealth;
}

export async function fetchPolymarketMarkets(
  keywords: RegExp,
  exclude: RegExp,
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<PolymarketFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const lastAttemptAt = now();

  let res: Response;
  try {
    res = await fetchImpl(POLYMARKET_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'IronSight/1.0' },
    });
  } catch {
    return { markets: [], health: { sourceId: POLYMARKET_SOURCE_ID, status: 'unavailable', lastAttemptAt } };
  }

  if (!res.ok) {
    return {
      markets: [],
      health: {
        sourceId: POLYMARKET_SOURCE_ID,
        status: res.status === 429 ? 'rate-limited' : 'unavailable',
        lastAttemptAt,
      },
    };
  }

  try {
    const data: PolymarketMarket[] = await res.json();

    const filtered = data
      .filter(m => keywords.test(m.question) && !exclude.test(m.question))
      .map(m => {
        const outcomes = JSON.parse(m.outcomes) as string[];
        const prices = JSON.parse(m.outcomePrices) as string[];

        return {
          id: m.id,
          question: m.question,
          slug: m.slug,
          outcomes: outcomes.map((o, i) => ({
            label: o,
            price: Math.round(parseFloat(prices[i]) * 100),
          })),
          volume24hr: m.volume24hr,
          volumeTotal: parseFloat(m.volume),
          liquidity: parseFloat(m.liquidity),
          endDate: m.endDate,
          oneDayPriceChange: m.oneDayPriceChange,
          image: m.image,
        };
      })
      .sort((a, b) => {
        const aYes = a.outcomes.find(o => o.label === 'Yes')?.price ?? a.outcomes[0]?.price ?? 0;
        const bYes = b.outcomes.find(o => o.label === 'Yes')?.price ?? b.outcomes[0]?.price ?? 0;
        return bYes - aYes;
      })
      .slice(0, 20);

    return {
      markets: filtered,
      health: { sourceId: POLYMARKET_SOURCE_ID, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
    };
  } catch {
    // Response wasn't the expected shape (e.g. outcomes/outcomePrices isn't valid JSON) —
    // the fetch itself succeeded, so this is a parsing problem, not an availability one.
    return { markets: [], health: { sourceId: POLYMARKET_SOURCE_ID, status: 'invalid-response', lastAttemptAt } };
  }
}

export async function GET(req: Request) {
  const { server } = getConflictFromRequest(req);
  const { markets, health } = await fetchPolymarketMarkets(server.polymarketKeywords, server.polymarketExclude);

  return NextResponse.json({
    markets,
    count: markets.length,
    updated: new Date().toISOString(),
    ...(health.status !== 'healthy' ? { error: 'Failed to fetch prediction markets' } : {}),
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
