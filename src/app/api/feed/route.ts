import { NextResponse } from 'next/server';
import { getConflictFromRequest } from '@/lib/conflicts';
import { isHebrew, translateFreeText } from '@/lib/hebrew';
import { createGoogleNewsConflictAdapter } from '@/lib/events/adapters/googleNewsConflict';
import { createNewsRssAdapter } from '@/lib/events/adapters/newsRss';
import { createFirmsFiresAdapter } from '@/lib/events/adapters/firmsFires';
import { createOpenMeteoWeatherAdapter } from '@/lib/events/adapters/openMeteoWeather';
import { createUsgsEarthquakesAdapter } from '@/lib/events/adapters/usgsEarthquakes';
import { createIodaOutagesAdapter } from '@/lib/events/adapters/iodaOutages';
import type { SourceAdapterResult } from '@/lib/events/sourceAdapter';

export const dynamic = 'force-dynamic';

/**
 * Every adapter already swallows its own fetch/parse failures into an 'unavailable'
 * SourceAdapterResult rather than throwing (see googleNewsConflict/newsRss's internal
 * Promise.allSettled and firmsFires's try/catch) — so in practice this fallback is a
 * belt-and-braces guard against a future adapter that doesn't hold that contract, not a
 * path exercised by today's three. It's what lets one settled 'rejected' promise here
 * degrade to that source's events being empty rather than taking the whole route down.
 */
function resolveResult(
  sourceId: string,
  settled: PromiseSettledResult<SourceAdapterResult>
): SourceAdapterResult {
  if (settled.status === 'fulfilled') return settled.value;
  return {
    events: [],
    rejected: [],
    health: { sourceId, status: 'unavailable', lastAttemptAt: Date.now() },
  };
}

export async function GET(req: Request) {
  const { key, client, server } = getConflictFromRequest(req);

  const conflictsAdapter = createGoogleNewsConflictAdapter(key, server);
  const newsAdapter = createNewsRssAdapter(key, server);
  const firmsAdapter = createFirmsFiresAdapter(key, server.firesBBox);
  const weatherAdapter = createOpenMeteoWeatherAdapter(key, client.mapCenter);
  const usgsAdapter = createUsgsEarthquakesAdapter(key, server.firesBBox);
  const iodaAdapter = createIodaOutagesAdapter(key, server.iodaCountries);

  // This route intentionally re-fetches the same upstream feeds /api/conflicts and
  // /api/news already poll independently — there is no shared cache between routes.
  // A known, accepted trade-off (duplicate upstream requests), not a bug.
  //
  // Promise.allSettled rather than Promise.all: one source failing must not take the
  // merged feed down with it. Each adapter is scoped independently below via
  // resolveResult, so a rejection on one leaves the other five sources' events intact.
  const [conflictsSettled, newsSettled, firmsSettled, weatherSettled, usgsSettled, iodaSettled] =
    await Promise.allSettled([
      conflictsAdapter.fetch(),
      newsAdapter.fetch(),
      firmsAdapter.fetch(),
      weatherAdapter.fetch(),
      usgsAdapter.fetch(),
      iodaAdapter.fetch(),
    ]);

  const conflictsResult = resolveResult(conflictsAdapter.sourceId, conflictsSettled);
  const newsResult = resolveResult(newsAdapter.sourceId, newsSettled);
  const firmsResult = resolveResult(firmsAdapter.sourceId, firmsSettled);
  const weatherResult = resolveResult(weatherAdapter.sourceId, weatherSettled);
  const usgsResult = resolveResult(usgsAdapter.sourceId, usgsSettled);
  const iodaResult = resolveResult(iodaAdapter.sourceId, iodaSettled);

  // Preserve untranslated Hebrew news titles before overwriting `title` — same
  // originalTitle/title ordering as threatOriginal/threat in src/app/api/alerts/route.ts.
  // Scoped to newsResult.events only: that's the sole adapter of the three that can
  // surface Hebrew-language source text.
  const hebrewNewsEvents = newsResult.events.filter((event) => isHebrew(event.title));
  if (hebrewNewsEvents.length > 0) {
    const translations = await Promise.allSettled(
      hebrewNewsEvents.map((event) => translateFreeText(event.title))
    );
    translations.forEach((result, i) => {
      const event = hebrewNewsEvents[i];
      if (result.status === 'fulfilled' && result.value !== event.title) {
        event.originalTitle = event.title;
        event.originalLanguage = 'he';
        event.title = result.value;
      }
    });
  }

  const events = [
    ...conflictsResult.events,
    ...newsResult.events,
    ...firmsResult.events,
    ...weatherResult.events,
    ...usgsResult.events,
    ...iodaResult.events,
  ].sort((a, b) => b.reportedAt - a.reportedAt);

  return NextResponse.json(events, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Source-Health': JSON.stringify([
        conflictsResult.health,
        newsResult.health,
        firmsResult.health,
        weatherResult.health,
        usgsResult.health,
        iodaResult.health,
      ]),
    },
  });
}
