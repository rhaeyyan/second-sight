import { NextResponse } from 'next/server';

import { fetchWithTimeout } from '@/lib/fetcher';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

// CoinGecko free API — no API key required
const COINS = ['bitcoin', 'ethereum', 'solana', 'binancecoin'];
const CRYPTO_SOURCE_ID = 'coingecko';

const COIN_META: Record<string, { name: string; symbol: string }> = {
  bitcoin: { name: 'Bitcoin', symbol: 'BTC' },
  ethereum: { name: 'Ethereum', symbol: 'ETH' },
  solana: { name: 'Solana', symbol: 'SOL' },
  binancecoin: { name: 'BNB', symbol: 'BNB' },
};

export interface CryptoPrice {
  name: string;
  symbol: string;
  price: number;
  changePercent: number;
  error?: boolean;
}

interface CryptoFetchResult {
  prices: CryptoPrice[];
  health: SourceHealth;
}

export async function fetchCryptoPrices(
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<CryptoFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const lastAttemptAt = now();

  try {
    const ids = COINS.join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

    const res = await fetchImpl(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'IronSight/1.0', Accept: 'application/json' },
    });

    if (!res.ok) {
      return {
        prices: [],
        health: {
          sourceId: CRYPTO_SOURCE_ID,
          status: res.status === 429 ? 'rate-limited' : 'unavailable',
          lastAttemptAt,
        },
      };
    }
    const data = await res.json();

    const prices: CryptoPrice[] = COINS.map(id => {
      const coin = data[id];
      const meta = COIN_META[id];
      if (!coin) return { name: meta.name, symbol: meta.symbol, price: 0, changePercent: 0, error: true };

      return {
        name: meta.name,
        symbol: meta.symbol,
        price: coin.usd,
        changePercent: Math.round((coin.usd_24h_change || 0) * 100) / 100,
      };
    });

    return {
      prices,
      health: { sourceId: CRYPTO_SOURCE_ID, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
    };
  } catch {
    return { prices: [], health: { sourceId: CRYPTO_SOURCE_ID, status: 'unavailable', lastAttemptAt } };
  }
}

export async function GET() {
  const { prices, health } = await fetchCryptoPrices();

  if (health.status !== 'healthy') {
    return NextResponse.json({ error: 'Failed to fetch crypto prices' }, {
      status: 500,
      headers: { 'X-Source-Health': JSON.stringify(health) },
    });
  }

  return NextResponse.json(prices, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
