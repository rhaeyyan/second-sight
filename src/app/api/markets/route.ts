import { NextResponse } from 'next/server';

import { fetchWithTimeout } from '@/lib/fetcher';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

const SYMBOLS = [
  { symbol: 'LMT', name: 'Lockheed Martin' },
  { symbol: 'RTX', name: 'Raytheon' },
  { symbol: 'NOC', name: 'Northrop Grumman' },
  { symbol: 'BA', name: 'Boeing' },
  { symbol: 'GD', name: 'General Dynamics' },
  { symbol: 'LHX', name: 'L3Harris' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^DJI', name: 'Dow Jones' },
  { symbol: '^VIX', name: 'VIX (Fear Index)' },
  { symbol: 'GC=F', name: 'Gold' },
  { symbol: 'DX-Y.NYB', name: 'US Dollar Index' },
];

export interface MarketPrice {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  error?: boolean;
}

interface SymbolFetchResult {
  price: MarketPrice;
  health: SourceHealth;
}

/**
 * Fetches one Yahoo Finance symbol. Returns per-symbol health rather than collapsing
 * every failure into `{ error: true }` — with 11 symbols fetched independently, a single
 * rate-limited or malformed response used to be indistinguishable from the rest.
 */
export async function fetchYahooSymbol(
  s: { symbol: string; name: string },
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<SymbolFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const lastAttemptAt = now();
  const sourceId = `yahoo-finance:${s.symbol}`;
  const errored: MarketPrice = { symbol: s.symbol, name: s.name, price: 0, change: 0, changePercent: 0, error: true };

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.symbol)}?interval=1d&range=5d`;
    const res = await fetchImpl(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      return {
        price: errored,
        health: { sourceId, status: res.status === 429 ? 'rate-limited' : 'unavailable', lastAttemptAt },
      };
    }

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) {
      return { price: errored, health: { sourceId, status: 'invalid-response', lastAttemptAt } };
    }

    const price = meta.regularMarketPrice ?? 0;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = Math.round((price - prev) * 100) / 100;
    const pct = prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0;

    return {
      price: {
        symbol: s.symbol,
        name: s.name,
        price: Math.round(price * 100) / 100,
        change,
        changePercent: pct,
      },
      health: { sourceId, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
    };
  } catch {
    return { price: errored, health: { sourceId, status: 'unavailable', lastAttemptAt } };
  }
}

export async function fetchMarketPrices(
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<{ prices: MarketPrice[]; health: SourceHealth[] }> {
  const results = await Promise.all(SYMBOLS.map(s => fetchYahooSymbol(s, opts)));
  return { prices: results.map(r => r.price), health: results.map(r => r.health) };
}

export async function GET() {
  const { prices, health } = await fetchMarketPrices();

  return NextResponse.json(prices, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
