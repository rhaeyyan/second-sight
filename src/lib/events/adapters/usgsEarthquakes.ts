import { fetchWithTimeout } from '@/lib/fetcher';
import type { ConflictKey, BBox } from '@/lib/conflicts/types';
import { IronsightEventSchema, type EventSeverity, type IronsightEvent } from '@/lib/events/schema';
import type { SourceAdapter, SourceAdapterResult, RejectedPayload } from '@/lib/events/sourceAdapter';

// Magnitude >=2.5 within the last 24h — no API key, no documented rate limit (a static
// file on USGS's CDN, refreshed roughly every minute). Balances signal vs. noise: filters
// out background microseismicity while staying frequent enough that a theater bbox
// usually has something to show over a day.
const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

// Defensive cap against a burst — USGS volumes are far lower than FIRMS' typical thermal-
// detection counts, so this is a safety net, not an expected everyday truncation.
const MAX_EVENTS = 50;

/**
 * Conservative magnitude -> severity mapping. Bands follow the commonly-used earthquake
 * magnitude scale (minor/light/moderate/strong/major), not a bespoke IRONSIGHT heuristic.
 */
export function severityForMagnitude(mag: number): EventSeverity {
  if (mag >= 7.0) return 'critical';
  if (mag >= 6.0) return 'high';
  if (mag >= 5.0) return 'medium';
  if (mag >= 4.0) return 'low';
  return 'info';
}

interface UsgsFeature {
  id: string;
  properties: {
    mag: number;
    place: string;
    time: number;
    type: string;
    status: string;
  };
  geometry: {
    coordinates: [number, number, number]; // GeoJSON order: [longitude, latitude, depth_km]
  };
}

/** Narrow, defensive check on a single raw feature's shape — distinct from the Zod gate
 *  below, which validates the *normalized* IronsightEvent candidate. */
function isValidFeature(feature: unknown): feature is UsgsFeature {
  if (typeof feature !== 'object' || feature === null) return false;
  const f = feature as Record<string, unknown>;
  if (typeof f.id !== 'string') return false;

  const properties = f.properties;
  if (typeof properties !== 'object' || properties === null) return false;
  const p = properties as Record<string, unknown>;
  if (
    typeof p.mag !== 'number' ||
    typeof p.place !== 'string' ||
    typeof p.time !== 'number' ||
    typeof p.type !== 'string' ||
    typeof p.status !== 'string'
  ) {
    return false;
  }

  const geometry = f.geometry;
  if (typeof geometry !== 'object' || geometry === null) return false;
  const coordinates = (geometry as Record<string, unknown>).coordinates;
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every((c) => typeof c === 'number');
}

export interface UsgsEarthquakesAdapterOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable fetch for tests — swaps out network I/O without touching global fetch. */
  fetchImpl?: typeof fetchWithTimeout;
}

/**
 * SourceAdapter over the USGS Earthquake Hazards Program's public GeoJSON summary feed
 * (draft-implementation-plan.md Phase 4 — "USGS: Conservatively labeled as
 * 'Seismic Activity'"), scoped to one theater's bounding box (reusing ServerConfig's
 * `firesBBox` — its name is fires-specific, but its value is just the theater's outer
 * extent, already used to scope another sensor-style feed).
 *
 * CORS gate: fetched server-side via fetchWithTimeout, exactly like every other adapter —
 * no cross-origin exposure surface to defend.
 *
 * Rate-limit gate: HTTP 429 -> 'rate-limited', matching every other adapter's convention.
 * Deliberately has no self-throttling cache (unlike openMeteoWeather.ts) — USGS's own
 * feed already refreshes on a cadence close to /api/feed's own poll interval, so a cache
 * would rarely even hit.
 *
 * Geographic precision gate: GeoJSON orders coordinates [longitude, latitude, depth_km] —
 * the opposite of every other lat/lon pair in this codebase. The destructuring below is
 * explicit and commented so this can't silently regress on a future edit.
 */
export function createUsgsEarthquakesAdapter(
  theater: ConflictKey,
  bbox: BBox,
  options: UsgsEarthquakesAdapterOptions = {}
): SourceAdapter {
  const now = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetchWithTimeout;
  const sourceId = 'usgs-earthquakes';

  return {
    sourceId,

    async fetch(): Promise<SourceAdapterResult> {
      const lastAttemptAt = now();

      try {
        const res = await doFetch(USGS_URL, { timeout: 10000 });
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

        const body: unknown = await res.json();
        const features =
          typeof body === 'object' && body !== null ? (body as Record<string, unknown>).features : undefined;

        if (!Array.isArray(features)) {
          return {
            events: [],
            rejected: [],
            health: { sourceId, status: 'invalid-response', lastAttemptAt },
          };
        }

        const candidates: { event: IronsightEvent; mag: number }[] = [];
        const rejected: RejectedPayload[] = [];

        for (const rawFeature of features) {
          if (!isValidFeature(rawFeature)) continue;

          // Business-logic filter, not a rejection: USGS's summary feed also includes
          // non-seismic event types (e.g. 'quarry blast') under the same feed.
          // Surfacing those as "Seismic Activity" would misrepresent them.
          if (rawFeature.properties.type !== 'earthquake') continue;

          const { mag, place, time, status } = rawFeature.properties;
          // GeoJSON coordinate order is [longitude, latitude, depth_km] — the opposite
          // of latitude-first everywhere else in this codebase.
          const [longitude, latitude, depthKm] = rawFeature.geometry.coordinates;

          const candidate = {
            id: `usgs-${rawFeature.id}`,
            source: { id: sourceId, name: 'USGS Earthquake Hazards Program', sourceType: 'sensor' as const },
            type: 'SEISMIC_ACTIVITY',
            theater,
            occurredAt: time,
            reportedAt: time,
            ingestedAt: lastAttemptAt,
            location: { latitude, longitude, precision: 'exact' as const },
            severity: severityForMagnitude(mag),
            confidence: status === 'reviewed' ? ('high' as const) : ('medium' as const),
            verificationStatus: 'official' as const,
            title: `Seismic Activity: M${mag} — ${place}`,
            tags: ['seismic', 'earthquake'],
            rawPayload: { mag, place, status, depthKm },
          };

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
          if (latitude < bbox.latMin || latitude > bbox.latMax || longitude < bbox.lonMin || longitude > bbox.lonMax) {
            continue;
          }

          candidates.push({ event: parsed.data, mag });
        }

        const events = candidates
          .sort((a, b) => b.mag - a.mag)
          .slice(0, MAX_EVENTS)
          .map((c) => c.event);

        return {
          events,
          rejected,
          health: { sourceId, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
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
