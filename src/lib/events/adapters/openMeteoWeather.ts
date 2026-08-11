import { fetchWithTimeout } from '@/lib/fetcher';
import type { ConflictKey } from '@/lib/conflicts/types';
import { IronsightEventSchema, type IronsightEvent } from '@/lib/events/schema';
import type { SourceAdapter, SourceAdapterResult, RejectedPayload } from '@/lib/events/sourceAdapter';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// Weather changes slowly, and /api/feed has no per-adapter poll-interval control — every
// adapter refetches on every single GET. Without this, the feed's own ~120s poll cadence
// would hit Open-Meteo far more often than the data ever changes, eating into its free-tier
// daily call budget for no benefit. 15 minutes is a conservative, deliberately arbitrary
// throttle, not a measured one.
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  result: SourceAdapterResult;
  cachedAt: number;
}

// Module-level default so repeated createOpenMeteoWeatherAdapter() calls within the same
// server process (a fresh adapter instance is constructed on every /api/feed GET) still
// share one throttling cache, keyed by sourceId (one entry per theater).
const defaultCache = new Map<string, CacheEntry>();

interface OpenMeteoCurrentResponse {
  latitude: number;
  longitude: number;
  current: {
    time: string;
    cloud_cover: number;
  };
}

/** Narrow, defensive check on the *raw upstream JSON shape* — distinct from the Zod gate
 *  below, which validates the *normalized* IronsightEvent candidate. Open-Meteo has no
 *  documented case of serving a malformed 200 the way FIRMS' CSV feed occasionally does,
 *  but every adapter in this codebase treats an external API's shape as untrusted rather
 *  than assuming today's contract holds forever. */
function isValidOpenMeteoResponse(body: unknown): body is OpenMeteoCurrentResponse {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.latitude !== 'number' || typeof candidate.longitude !== 'number') return false;
  const current = candidate.current;
  if (typeof current !== 'object' || current === null) return false;
  const currentRecord = current as Record<string, unknown>;
  return typeof currentRecord.time === 'string' && typeof currentRecord.cloud_cover === 'number';
}

export interface OpenMeteoWeatherAdapterOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable fetch for tests — swaps out network I/O without touching global fetch. */
  fetchImpl?: typeof fetchWithTimeout;
  /** Minimum time between real upstream calls. Default 15 minutes — see the module doc
   *  comment on DEFAULT_CACHE_TTL_MS. */
  cacheTtlMs?: number;
  /** Injectable cache store. Tests pass a fresh Map for isolation between cases;
   *  production callers rely on the module-level default. */
  cache?: Map<string, CacheEntry>;
}

/**
 * SourceAdapter over Open-Meteo's free, keyless current-conditions endpoint
 * (draft-implementation-plan.md Phase 4 — "low-risk contextual data (cloud cover)").
 * Deliberately samples one point per theater (ConflictConfig.client.mapCenter) rather
 * than every city in the theater's config — this is meant to be low-volume ambient
 * context, not a new incident feed, so `location.precision` is always 'regional' (one
 * sampled point standing in for a broad area) and `severity` is always 'info'.
 *
 * CORS gate: fetched server-side via fetchWithTimeout, exactly like every other adapter
 * — CORS is a browser-enforced, cross-origin concept that never applies to a server-to-
 * server fetch, so there is no cross-origin exposure surface to defend here.
 *
 * Rate-limit gate: HTTP 429 is reported as SourceHealthStatus 'rate-limited', matching
 * every other adapter's convention. On top of that, this adapter is the first in the
 * repo to self-throttle via an in-memory TTL cache (see DEFAULT_CACHE_TTL_MS) — no other
 * adapter needs one, since none of them are polled far more often than their data
 * actually changes the way weather is.
 */
export function createOpenMeteoWeatherAdapter(
  theater: ConflictKey,
  mapCenter: [number, number],
  options: OpenMeteoWeatherAdapterOptions = {}
): SourceAdapter {
  const now = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetchWithTimeout;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = options.cache ?? defaultCache;
  const sourceId = `open-meteo-weather-${theater}`;
  const [lat, lon] = mapCenter;

  return {
    sourceId,

    async fetch(): Promise<SourceAdapterResult> {
      const lastAttemptAt = now();

      const cached = cache.get(sourceId);
      if (cached && lastAttemptAt - cached.cachedAt < cacheTtlMs) {
        return cached.result;
      }

      try {
        const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}&current=cloud_cover&timezone=UTC`;
        const res = await doFetch(url, { timeout: 10000 });

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
        if (!isValidOpenMeteoResponse(body)) {
          return {
            events: [],
            rejected: [],
            health: { sourceId, status: 'invalid-response', lastAttemptAt },
          };
        }

        // Geographic-precision gate: use the response's own echoed coordinates, not the
        // query input — Open-Meteo grid-snaps to its model resolution, so the point it
        // actually reported on can genuinely differ from what was asked for.
        const detectedAtMs = Date.parse(`${body.current.time}Z`);
        const cloudCover = body.current.cloud_cover;

        const candidate = {
          id: `openmeteo-${theater}-${body.current.time}`,
          source: { id: sourceId, name: 'Open-Meteo', sourceType: 'sensor' as const },
          type: 'WEATHER_CONTEXT',
          theater,
          occurredAt: detectedAtMs,
          reportedAt: detectedAtMs,
          ingestedAt: lastAttemptAt,
          location: { latitude: body.latitude, longitude: body.longitude, precision: 'regional' as const },
          severity: 'info' as const,
          confidence: 'high' as const,
          verificationStatus: 'official' as const,
          title: `Cloud cover: ${cloudCover}% near theater center`,
          tags: ['weather', 'cloud-cover'],
          rawPayload: { time: body.current.time, cloud_cover: cloudCover },
        };

        const parsed = IronsightEventSchema.safeParse(candidate);
        const events: IronsightEvent[] = [];
        const rejected: RejectedPayload[] = [];
        if (parsed.success) {
          events.push(parsed.data);
        } else {
          rejected.push({
            payload: candidate,
            issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          });
        }

        const result: SourceAdapterResult = {
          events,
          rejected,
          health: { sourceId, status: 'healthy', lastAttemptAt, lastSuccessAt: lastAttemptAt },
        };

        // Only successful fetches are cached — a transient outage must not block
        // retries for the full TTL window; the next call should retry, not repeat it.
        cache.set(sourceId, { result, cachedAt: lastAttemptAt });
        return result;
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
