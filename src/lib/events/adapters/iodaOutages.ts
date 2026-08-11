import { fetchWithTimeout } from '@/lib/fetcher';
import type { ConflictKey } from '@/lib/conflicts/types';
import { IronsightEventSchema, type IronsightEvent } from '@/lib/events/schema';
import type {
  SourceAdapter,
  SourceAdapterResult,
  SourceHealthStatus,
  RejectedPayload,
} from '@/lib/events/sourceAdapter';

// draft-implementation-plan.md Phase 4 — "IODA: pending strict geographic validation."
// Base URL and shape per CAIDA's own API spec (github.com/CAIDA/ioda-api/wiki/API-
// Specification) — NOT independently verified against live JSON in this codebase (see
// this adapter's own TODO.md entry): this sandbox's network egress could reach
// open-meteo.com and earthquake.usgs.gov but not api.ioda.caida.org. Built defensively
// against the documented spec so a live-shape mismatch degrades to 'invalid-response'
// rather than crashing — same "treat external data as hostile" posture as every other
// adapter, just leaned on more heavily here given the unverified starting point.
const IODA_BASE_URL = 'https://api.ioda.caida.org/dev';

const WINDOW_SECONDS = 24 * 60 * 60;

// Defensive cap — outage *episodes* (as opposed to continuous readings) are expected to
// be low-volume, but every adapter this phase caps defensively regardless.
const MAX_EVENTS = 30;

// Fixed fact about geography, not per-theater config (ServerConfig.iodaCountries is the
// per-theater country *list*; this is the universal code -> {name, coordinates} lookup),
// scoped to exactly the countries any theater's iodaCountries can name today. A country
// code with no entry here gets its event's location omitted, never fabricated.
const COUNTRY_INFO: Record<string, { name: string; lat: number; lon: number }> = {
  IR: { name: 'Iran', lat: 32.4279, lon: 53.688 },
  IL: { name: 'Israel', lat: 31.0461, lon: 34.8516 },
  LB: { name: 'Lebanon', lat: 33.8547, lon: 35.8623 },
  SY: { name: 'Syria', lat: 34.8021, lon: 38.9968 },
  YE: { name: 'Yemen', lat: 15.5527, lon: 48.5164 },
  UA: { name: 'Ukraine', lat: 48.3794, lon: 31.1656 },
  RU: { name: 'Russia', lat: 61.524, lon: 105.3188 },
  BY: { name: 'Belarus', lat: 53.7098, lon: 27.9534 },
};

interface IodaOutageItem {
  datasource: string;
  entityType: string;
  entityCode: string;
  from: number; // unix seconds
  until: number; // unix seconds
  score: number;
}

/** Raw-shape check on a single outage-event item — distinct from the Zod gate below,
 *  which validates the *normalized* IronsightEvent candidate. */
function isValidOutageItem(item: unknown): item is IodaOutageItem {
  if (typeof item !== 'object' || item === null) return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.datasource === 'string' &&
    typeof i.entityType === 'string' &&
    typeof i.entityCode === 'string' &&
    typeof i.from === 'number' &&
    typeof i.until === 'number' &&
    typeof i.score === 'number'
  );
}

/** Raw-shape check on a country's whole response body — IODA wraps every endpoint as
 *  { type, error, pagination, queryParameters, data } per the documented spec. */
function extractDataArray(body: unknown): unknown[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.error) return null;
  return Array.isArray(b.data) ? b.data : null;
}

export interface CacheEntry {
  result: SourceAdapterResult;
  cachedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const defaultCache = new Map<string, CacheEntry>();

export interface IodaOutagesAdapterOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable fetch for tests — swaps out network I/O without touching global fetch. */
  fetchImpl?: typeof fetchWithTimeout;
  /** Minimum time between real upstream rounds. Default 15 minutes — justified more
   *  here than for any other adapter, since this one makes N outbound calls (one per
   *  country) per fetch and this codebase has no confirmed sense of IODA's real
   *  rate-limit posture. */
  cacheTtlMs?: number;
  /** Injectable cache store. Tests pass a fresh Map for isolation between cases. */
  cache?: Map<string, CacheEntry>;
}

/**
 * SourceAdapter over IODA's outage-events endpoint, one call per country of interest
 * (draft-implementation-plan.md Phase 4's "IODA" entry). Unlike firmsFires/
 * usgsEarthquakes (one call scoped by a theater bbox), IODA reports at country
 * granularity with no native lat/lon — so this is scoped by a list of ISO country codes
 * and fires one request per code, mirroring googleNewsConflict.ts's multi-query
 * Promise.allSettled shape rather than firmsFires.ts's single-call shape.
 *
 * Severity is deliberately never banded from IODA's own `score` field (unbounded,
 * uncalibrated — see the module's own doc note in draft-implementation-plan.md and
 * TODO.md): every event gets a fixed 'medium' severity and 'low' confidence rather than
 * fabricated precision this codebase's rules elsewhere are careful to avoid.
 */
export function createIodaOutagesAdapter(
  theater: ConflictKey,
  countryCodes: string[],
  options: IodaOutagesAdapterOptions = {}
): SourceAdapter {
  const now = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? fetchWithTimeout;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = options.cache ?? defaultCache;
  const sourceId = `ioda-outages-${theater}`;

  return {
    sourceId,

    async fetch(): Promise<SourceAdapterResult> {
      const lastAttemptAt = now();

      const cached = cache.get(sourceId);
      if (cached && lastAttemptAt - cached.cachedAt < cacheTtlMs) {
        return cached.result;
      }

      const untilSec = Math.floor(lastAttemptAt / 1000);
      const fromSec = untilSec - WINDOW_SECONDS;

      const candidates: { event: IronsightEvent; score: number }[] = [];
      const rejected: RejectedPayload[] = [];
      let rateLimited = false;
      let malformedWrapper = false;

      const results = await Promise.allSettled(
        countryCodes.map(async (code) => {
          const url = `${IODA_BASE_URL}/outages/events/country/${code}?from=${fromSec}&until=${untilSec}&format=ioda`;
          const res = await doFetch(url, { timeout: 10000 });

          if (res.status === 429) {
            rateLimited = true;
            return;
          }
          if (!res.ok) {
            malformedWrapper = true;
            return;
          }

          const body: unknown = await res.json();
          const items = extractDataArray(body);
          if (items === null) {
            malformedWrapper = true;
            return;
          }

          for (const rawItem of items) {
            if (!isValidOutageItem(rawItem)) continue;

            const { datasource, entityCode, from, score } = rawItem;
            const info = COUNTRY_INFO[entityCode];

            const candidate = {
              id: `ioda-${entityCode}-${from}-${datasource}`,
              source: {
                id: sourceId,
                name: 'IODA (Internet Outage Detection and Analysis)',
                sourceType: 'sensor' as const,
              },
              type: 'CONNECTIVITY_OUTAGE',
              theater,
              occurredAt: from * 1000,
              reportedAt: from * 1000,
              ingestedAt: lastAttemptAt,
              ...(info ? { location: { latitude: info.lat, longitude: info.lon, precision: 'regional' as const } } : {}),
              severity: 'medium' as const,
              confidence: 'low' as const,
              verificationStatus: 'unverified' as const,
              title: `Possible connectivity outage detected: ${info?.name ?? entityCode}`,
              tags: ['connectivity', 'outage'],
              rawPayload: { score, datasource, from: rawItem.from, until: rawItem.until },
            };

            const parsed = IronsightEventSchema.safeParse(candidate);
            if (!parsed.success) {
              rejected.push({
                payload: candidate,
                issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
              });
              continue;
            }

            candidates.push({ event: parsed.data, score });
          }
        })
      );

      const allFailed = results.every((r) => r.status === 'rejected');

      let status: SourceHealthStatus;
      if (allFailed) status = 'unavailable';
      else if (rateLimited) status = 'rate-limited';
      else if (candidates.length === 0 && (rejected.length > 0 || malformedWrapper)) status = 'invalid-response';
      else status = 'healthy';

      const events = candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_EVENTS)
        .map((c) => c.event);

      const result: SourceAdapterResult = {
        events,
        rejected,
        health: {
          sourceId,
          status,
          lastAttemptAt,
          lastSuccessAt: status === 'unavailable' ? undefined : lastAttemptAt,
        },
      };

      if (status !== 'unavailable') {
        cache.set(sourceId, { result, cachedAt: lastAttemptAt });
      }
      return result;
    },
  };
}
