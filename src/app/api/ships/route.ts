import { NextResponse } from 'next/server';

import { getConflictFromRequest } from '@/lib/conflicts';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { server } = getConflictFromRequest(req);
  try {
    // Curated known naval positions from public OSINT / Navy reports.
    // No live AIS feed — warships routinely disable AIS in conflict zones. There's no
    // external fetch here (server.ships is static config), so unlike the other routes
    // this can't actually go unavailable/rate-limited — health is always 'healthy'. Reported
    // anyway so a health-consuming UI doesn't need a special case for this one route.
    const lastAttemptAt = Date.now();
    const now = new Date(lastAttemptAt).toISOString();
    const ships: NavalVessel[] = server.ships.map(s => ({ ...s, lastReported: now }));
    const regions = server.shipRegions.map(name => ({ name }));
    const health: SourceHealth = { sourceId: 'naval-osint', status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt };

    return NextResponse.json({
      regions,
      totalTracked: ships.length,
      ships,
      source: 'OSINT / Public Naval Reports',
      updated: now,
      note: 'Positions approximate - based on last known public reports',
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
        'X-Source-Health': JSON.stringify(health),
      },
    });
  } catch (err) {
    console.error('Naval tracking error:', err);
    return NextResponse.json({ totalTracked: 0, ships: [], updated: new Date().toISOString() }, { status: 200 });
  }
}

interface NavalVessel {
  name: string;
  hull: string;
  type: string;
  class: string;
  navy: string;
  lat: number;
  lon: number;
  status: string;
  region: string;
  lastReported: string;
  group?: string;
}
