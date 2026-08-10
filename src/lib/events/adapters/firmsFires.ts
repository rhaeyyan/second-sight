import { fetchWithTimeout } from '@/lib/fetcher';
import type { ConflictKey, BBox } from '@/lib/conflicts/types';
import { IronsightEventSchema, type EventSeverity, type IronsightEvent } from '@/lib/events/schema';
import type {
  SourceAdapter,
  SourceAdapterResult,
  RejectedPayload,
} from '@/lib/events/sourceAdapter';

const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv';

// Matches the cap already in src/app/api/fires/route.ts's fetchFiresData.
const MAX_EVENTS = 100;

export type FireIntensity = 'low' | 'medium' | 'high' | 'extreme';

/**
 * Thresholds unchanged from the original src/app/api/fires/route.ts classification —
 * kept identical so this adapter and the existing /api/fires response agree on what
 * counts as "extreme" for the same underlying detection.
 */
export function classifyIntensity(brightness: number, frp: number): FireIntensity {
  if (frp > 100 || brightness > 400) return 'extreme';
  if (frp > 50 || brightness > 350) return 'high';
  if (frp > 20 || brightness > 320) return 'medium';
  return 'low';
}

/** Very high FRP at night-level brightness could be an explosion rather than a wildfire. */
export function isPossibleExplosion(brightness: number, frp: number): boolean {
  return frp > 80 && brightness > 380;
}

/**
 * Conservative intensity -> severity mapping. A thermal anomaly is never asserted as a
 * strike outright — brightness/FRP alone can't distinguish a gas flare or wildfire from
 * ordnance. 'critical' is reserved for the one case where both signals agree (extreme
 * intensity AND the possible-explosion heuristic), never from intensity alone.
 */
export function severityForIntensity(intensity: FireIntensity, possibleExplosion: boolean): EventSeverity {
  if (intensity === 'extreme' && possibleExplosion) return 'critical';
  switch (intensity) {
    case 'extreme':
      return 'high';
    case 'high':
      return 'medium';
    case 'medium':
      return 'low';
    default:
      return 'info';
  }
}

export interface FirmsFiresAdapterOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable fetch for tests — swaps out network I/O without touching global fetch. */
  fetchImpl?: typeof fetchWithTimeout;
}

/**
 * SourceAdapter over NASA FIRMS' global 24h VIIRS thermal-anomaly CSV, scoped to one
 * theater's bounding box. Deliberately NOT wired into src/app/api/fires/route.ts — that
 * route already reports SourceHealth via its own FireEvent shape, and FireEvent's raw
 * sensor fields (brightness, frp, NASA's own confidence string) have no typed home in
 * IronsightEvent, which is built for narrated OSINT events rather than sensor telemetry.
 * This adapter exists standalone to prove IronsightEvent normalization generalizes beyond
 * text feeds, and to feed Phase 3's correlation engine (thermal detections vs. reported
 * strikes) — see draft-implementation-plan.md.
 *
 * First adapter in the repo to populate both `location` (FIRMS gives real coordinates)
 * and `occurredAt` (a genuine detection time, not just a publish time).
 */
export function createFirmsFiresAdapter(
  theater: ConflictKey,
  bbox: BBox,
  options: FirmsFiresAdapterOptions = {}
): SourceAdapter {
  const now = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetchWithTimeout;
  const sourceId = 'nasa-firms';

  return {
    sourceId,

    async fetch(): Promise<SourceAdapterResult> {
      const lastAttemptAt = now();

      try {
        const res = await doFetch(FIRMS_URL, { timeout: 30000 });
        if (!res.ok) {
          return {
            events: [],
            rejected: [],
            health: {
              sourceId,
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
        const frpIdx = header.indexOf('frp');
        const dayIdx = header.indexOf('daynight');

        // FIRMS occasionally serves an HTML error/maintenance page with a 200 status
        // instead of the CSV — a missing required column is the tell.
        if ([latIdx, lonIdx, brightIdx, dateIdx, timeIdx, frpIdx, dayIdx].includes(-1)) {
          return {
            events: [],
            rejected: [],
            health: { sourceId, status: 'invalid-response', lastAttemptAt },
          };
        }

        // FIRMS' global 24h feed routinely yields thousands of in-bbox detections (most
        // low-signal — agricultural burning, flares) once filtered to even a large
        // theater bbox. src/app/api/fires/route.ts already caps at the top 100 by FRP
        // for exactly this reason; this adapter didn't replicate that cap and would
        // otherwise flood a consumer (e.g. the unified feed's bounded EventStore) with
        // thousands of thermal detections in a single poll, potentially evicting
        // higher-priority conflict/news events. Tracked as { event, frp } pairs so the
        // cap can rank by FRP without reaching back into rawPayload after the fact.
        const candidates: { event: IronsightEvent; frp: number }[] = [];
        const rejected: RejectedPayload[] = [];

        for (const line of lines.slice(1)) {
          if (line.trim() === '') continue;

          const cols = line.split(',');
          const lat = parseFloat(cols[latIdx]);
          const lon = parseFloat(cols[lonIdx]);
          const brightness = parseFloat(cols[brightIdx]);
          const frp = parseFloat(cols[frpIdx]);
          const rawConfidence = cols[confIdx];
          const acqDate = cols[dateIdx];
          const acqTime = cols[timeIdx];
          const daynight = cols[dayIdx];

          const intensity = classifyIntensity(brightness, frp);
          const possibleExplosion = isPossibleExplosion(brightness, frp);
          const type = possibleExplosion ? 'POSSIBLE_EXPLOSION' : 'THERMAL_ANOMALY';

          const detectedAtMs = acqTime && acqTime.length >= 4
            ? Date.parse(`${acqDate}T${acqTime.substring(0, 2)}:${acqTime.substring(2, 4)}:00Z`)
            : NaN;

          const title = possibleExplosion
            ? `Possible explosion detected (thermal anomaly, ${intensity} intensity)`
            : `Thermal anomaly detected (${intensity} intensity)`;

          const candidate = {
            id: `firms-${theater}-${lat}-${lon}-${acqDate}T${acqTime}`,
            source: { id: sourceId, name: 'NASA FIRMS VIIRS', sourceType: 'sensor' as const },
            type,
            theater,
            occurredAt: detectedAtMs,
            reportedAt: detectedAtMs,
            ingestedAt: lastAttemptAt,
            location: { latitude: lat, longitude: lon, precision: 'exact' as const },
            severity: severityForIntensity(intensity, possibleExplosion),
            confidence: 'low' as const,
            verificationStatus: 'unverified' as const,
            title,
            tags: [intensity, daynight === 'D' ? 'daytime' : 'nighttime', ...(possibleExplosion ? ['possible-explosion'] : [])],
            rawPayload: { brightness, frp, confidence: rawConfidence, daynight },
          };

          // Zod is the sole gatekeeper: unparseable numbers (NaN), out-of-range
          // coordinates, and unparseable timestamps all fail schema validation here
          // rather than being pre-filtered by manual guards.
          const parsed = IronsightEventSchema.safeParse(candidate);
          if (!parsed.success) {
            rejected.push({
              payload: candidate,
              issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
            });
            continue;
          }

          // Bounding-box scoping happens after validation succeeds, so a corrupted
          // coordinate is Zod-rejected (and counted in `rejected`) rather than silently
          // vanishing into the "out of bbox" filter below.
          if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) {
            continue;
          }

          candidates.push({ event: parsed.data, frp });
        }

        const events = candidates
          .sort((a, b) => b.frp - a.frp)
          .slice(0, MAX_EVENTS)
          .map((c) => c.event);

        return {
          events,
          rejected,
          health: {
            sourceId,
            status: 'healthy',
            lastAttemptAt,
            lastSuccessAt: lastAttemptAt,
          },
        };
      } catch {
        return {
          events: [],
          rejected: [],
          health: { sourceId, status: 'unavailable', lastAttemptAt },
        };
      }
    },
  };
}
