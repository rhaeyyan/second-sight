import { NextResponse } from 'next/server';

import { fetchWithTimeout } from '@/lib/fetcher';
import { getConflictFromRequest } from '@/lib/conflicts';
import type { BBox } from '@/lib/conflicts/types';
import type { SourceHealth } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

const FIRMS_SOURCE_ID = 'nasa-firms';
const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv';

export interface FireEvent {
  lat: number;
  lon: number;
  brightness: number;
  frp: number;
  confidence: string;
  intensity: 'low' | 'medium' | 'high' | 'extreme';
  datetime: string;
  daynight: string;
  possibleExplosion: boolean;
}

interface FiresFetchResult {
  events: FireEvent[];
  health: SourceHealth;
}

/**
 * Downloads NASA FIRMS' global 24h thermal-anomaly CSV and filters it to the active
 * conflict's bounding box. Split out from GET so fixture tests can exercise the parser
 * against a captured CSV sample without going through Next's request machinery, and so
 * the route can distinguish "no fires right now" from "the download failed" via `health`
 * rather than folding both into an empty `events` array.
 */
export async function fetchFiresData(
  bbox: BBox,
  opts: { fetchImpl?: typeof fetchWithTimeout; now?: () => number } = {}
): Promise<FiresFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const lastAttemptAt = now();

  try {
    const res = await fetchImpl(FIRMS_URL, { timeout: 30000 });
    if (!res.ok) {
      return {
        events: [],
        health: {
          sourceId: FIRMS_SOURCE_ID,
          status: res.status === 429 ? 'rate-limited' : 'unavailable',
          lastAttemptAt,
        },
      };
    }

    const text = await res.text();
    const lines = text.split('\n');
    const header = lines[0].split(',');

    const latIdx = header.indexOf('latitude');
    const lonIdx = header.indexOf('longitude');
    const brightIdx = header.indexOf('bright_ti4');
    const dateIdx = header.indexOf('acq_date');
    const timeIdx = header.indexOf('acq_time');
    const confIdx = header.indexOf('confidence');
    const frpIdx = header.indexOf('frp'); // Fire Radiative Power - higher = bigger
    const dayIdx = header.indexOf('daynight');

    // FIRMS occasionally serves an HTML error/maintenance page with a 200 status
    // instead of the CSV — a missing required column is the tell.
    if ([latIdx, lonIdx, brightIdx, dateIdx, timeIdx, frpIdx, dayIdx].includes(-1)) {
      return {
        events: [],
        health: { sourceId: FIRMS_SOURCE_ID, status: 'invalid-response', lastAttemptAt },
      };
    }

    // Filter to the active conflict's bounding box
    const events: FireEvent[] = lines.slice(1)
      .map((line): FireEvent | null => {
        const cols = line.split(',');
        if (cols.length < header.length) return null;

        const lat = parseFloat(cols[latIdx]);
        const lon = parseFloat(cols[lonIdx]);

        // Region filter
        if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) return null;

        const brightness = parseFloat(cols[brightIdx]);
        const frp = parseFloat(cols[frpIdx]);
        const confidence = cols[confIdx];
        const date = cols[dateIdx];
        const time = cols[timeIdx];

        // Classify intensity
        let intensity: 'low' | 'medium' | 'high' | 'extreme' = 'low';
        if (frp > 100 || brightness > 400) intensity = 'extreme';
        else if (frp > 50 || brightness > 350) intensity = 'high';
        else if (frp > 20 || brightness > 320) intensity = 'medium';

        return {
          lat,
          lon,
          brightness: Math.round(brightness * 10) / 10,
          frp: Math.round(frp * 10) / 10,
          confidence,
          intensity,
          datetime: `${date}T${time.substring(0, 2)}:${time.substring(2, 4)}:00Z`,
          daynight: cols[dayIdx],
          // Flag potential non-fire events (very high FRP at night in non-forest areas could be explosions)
          possibleExplosion: frp > 80 && brightness > 380,
        };
      })
      .filter((e): e is FireEvent => e !== null)
      .sort((a, b) => (b.frp || 0) - (a.frp || 0))
      .slice(0, 100);

    return {
      events,
      health: { sourceId: FIRMS_SOURCE_ID, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
    };
  } catch (err) {
    console.error('FIRMS fetch error:', err);
    return {
      events: [],
      health: { sourceId: FIRMS_SOURCE_ID, status: 'unavailable', lastAttemptAt },
    };
  }
}

// NASA FIRMS (Fire Information for Resource Management System)
// Detects thermal anomalies from satellites - includes fires AND large explosions
// Free, no API key needed for the open data CSV
export async function GET(req: Request) {
  const { server } = getConflictFromRequest(req);
  const { events, health } = await fetchFiresData(server.firesBBox);

  const total = events.length;
  const highIntensity = events.filter(e => e.intensity === 'high' || e.intensity === 'extreme').length;
  const possibleExplosions = events.filter(e => e.possibleExplosion).length;

  return NextResponse.json({
    total,
    highIntensity,
    possibleExplosions,
    events,
    source: 'NASA FIRMS VIIRS',
    updated: new Date().toISOString(),
    ...(health.status !== 'healthy' ? { error: 'Failed to fetch satellite data' } : {}),
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
