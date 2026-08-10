import { NextResponse } from 'next/server';

import { fetchWithTimeout } from '@/lib/fetcher';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

const COMMODITIES = [
  { symbol: 'CL=F', name: 'WTI Crude Oil', type: 'crude_wti' },
  { symbol: 'BZ=F', name: 'Brent Crude', type: 'crude_brent' },
  { symbol: 'NG=F', name: 'Natural Gas', type: 'natural_gas' },
  { symbol: 'HO=F', name: 'Heating Oil', type: 'heating_oil' },
  { symbol: 'RB=F', name: 'RBOB Gasoline', type: 'gasoline' },
];

export interface CommodityPrice {
  type: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  updated: string;
}

interface CommodityFetchResult {
  price: CommodityPrice;
  health: SourceHealth;
}

/**
 * Fetches one Yahoo Finance commodity. Returns per-commodity health rather than
 * collapsing every failure into a zeroed-out price row indistinguishable from "flat".
 */
export async function fetchCommodity(
  c: { symbol: string; name: string; type: string },
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<CommodityFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const lastAttemptAt = now();
  const sourceId = `yahoo-finance:${c.symbol}`;
  const zeroed: CommodityPrice = {
    type: c.type, name: c.name, price: 0, change: 0, changePercent: 0,
    currency: 'USD', updated: new Date(lastAttemptAt).toISOString(),
  };

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${c.symbol}?interval=1d&range=5d`;
    const res = await fetchImpl(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      return {
        price: zeroed,
        health: { sourceId, status: res.status === 429 ? 'rate-limited' : 'unavailable', lastAttemptAt },
      };
    }

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) {
      return { price: zeroed, health: { sourceId, status: 'invalid-response', lastAttemptAt } };
    }

    const price = meta.regularMarketPrice ?? 0;
    const prev = meta.chartPreviousClose ?? price;
    const change = Math.round((price - prev) * 100) / 100;
    const pct = prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0;

    return {
      price: {
        type: c.type,
        name: c.name,
        price: Math.round(price * 100) / 100,
        change,
        changePercent: pct,
        currency: 'USD',
        updated: new Date(lastAttemptAt).toISOString(),
      },
      health: { sourceId, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
    };
  } catch {
    return { price: zeroed, health: { sourceId, status: 'unavailable', lastAttemptAt } };
  }
}

export async function fetchOilPrices(
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<{ prices: CommodityPrice[]; health: SourceHealth[] }> {
  const results = await Promise.all(COMMODITIES.map(c => fetchCommodity(c, opts)));
  return { prices: results.map(r => r.price), health: results.map(r => r.health) };
}

export async function GET() {
  const { prices, health } = await fetchOilPrices();

  return NextResponse.json(prices, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
