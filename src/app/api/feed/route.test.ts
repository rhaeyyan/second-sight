import { describe, it, expect, vi } from 'vitest';
import type { IronsightEvent } from '@/lib/events/schema';
import type { SourceAdapter, SourceAdapterResult } from '@/lib/events/sourceAdapter';
import { GET } from './route';

const MOCK_NOW = 1_760_000_000_000;

// Minimal, schema-valid IronsightEvent, with per-test overrides — same helper pattern as
// src/app/api/news/route.test.ts's newsEvent().
function event(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'evt-1',
    source: { id: 'src', name: 'Example Source', sourceType: 'media' },
    type: 'REPORT',
    theater: 'iran-israel',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'info',
    confidence: 'low',
    verificationStatus: 'single-source',
    title: 'Example headline',
    tags: [],
    ...overrides,
  };
}

function result(events: IronsightEvent[], sourceId: string): SourceAdapterResult {
  return {
    events,
    rejected: [],
    health: { sourceId, status: 'healthy', lastAttemptAt: MOCK_NOW, lastSuccessAt: MOCK_NOW },
  };
}

// Each adapter factory is mocked wholesale to return a fake SourceAdapter with a
// controllable fetch(). The route builds real adapters via createXAdapter(theater,
// server) and calls .fetch() with no injectable options of its own (unlike the
// adapters themselves, which take fetchImpl/now) — mocking three levels of HTTP/XML
// per adapter just to exercise the route's merge/translate/sort logic would test the
// adapters again, not the route. Mocking the factories is the seam that isolates
// "does /api/feed merge, translate, and sort correctly" from "does each adapter parse
// its upstream feed correctly" (already covered by each adapter's own *.test.ts).
const conflictsFetch = vi.fn<() => Promise<SourceAdapterResult>>();
const newsFetch = vi.fn<() => Promise<SourceAdapterResult>>();
const firmsFetch = vi.fn<() => Promise<SourceAdapterResult>>();
const weatherFetch = vi.fn<() => Promise<SourceAdapterResult>>();

vi.mock('@/lib/events/adapters/googleNewsConflict', () => ({
  createGoogleNewsConflictAdapter: (): SourceAdapter => ({
    sourceId: 'google-news-conflict-iran-israel',
    fetch: conflictsFetch,
  }),
}));

vi.mock('@/lib/events/adapters/newsRss', () => ({
  createNewsRssAdapter: (): SourceAdapter => ({
    sourceId: 'news-rss-iran-israel',
    fetch: newsFetch,
  }),
}));

vi.mock('@/lib/events/adapters/firmsFires', () => ({
  createFirmsFiresAdapter: (): SourceAdapter => ({
    sourceId: 'nasa-firms',
    fetch: firmsFetch,
  }),
}));

vi.mock('@/lib/events/adapters/openMeteoWeather', () => ({
  createOpenMeteoWeatherAdapter: (): SourceAdapter => ({
    sourceId: 'open-meteo-weather-iran-israel',
    fetch: weatherFetch,
  }),
}));

// translateFreeText hits a real network endpoint (translate.googleapis.com) — mocked
// so tests are deterministic and offline. isHebrew is left as the real implementation
// (plain regex, no I/O) since mocking it would just be re-describing its own logic.
vi.mock('@/lib/hebrew', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hebrew')>('@/lib/hebrew');
  return {
    ...actual,
    translateFreeText: vi.fn(async (text: string) => `[EN] ${text}`),
  };
});

describe('GET /api/feed', () => {
  it('merges events from all four adapters into one newest-first list', async () => {
    conflictsFetch.mockResolvedValueOnce(
      result([event({ id: 'c1', reportedAt: MOCK_NOW - 1000, source: { id: 's', name: 'Conflicts', sourceType: 'media' } })], 'google-news-conflict-iran-israel')
    );
    newsFetch.mockResolvedValueOnce(
      result([event({ id: 'n1', reportedAt: MOCK_NOW, source: { id: 's', name: 'News', sourceType: 'media' } })], 'news-rss-iran-israel')
    );
    firmsFetch.mockResolvedValueOnce(
      result([event({ id: 'f1', reportedAt: MOCK_NOW - 2000, source: { id: 's', name: 'NASA FIRMS VIIRS', sourceType: 'sensor' } })], 'nasa-firms')
    );
    weatherFetch.mockResolvedValueOnce(
      result([event({ id: 'w1', reportedAt: MOCK_NOW - 3000, source: { id: 's', name: 'Open-Meteo', sourceType: 'sensor' } })], 'open-meteo-weather-iran-israel')
    );

    const res = await GET(new Request('http://localhost/api/feed?conflict=iran-israel'));
    const body = (await res.json()) as IronsightEvent[];

    expect(body.map((e) => e.id)).toEqual(['n1', 'c1', 'f1', 'w1']); // newest reportedAt first
  });

  it('populates originalTitle/originalLanguage and translates a Hebrew news title, leaving non-news events untouched', async () => {
    conflictsFetch.mockResolvedValueOnce(result([], 'google-news-conflict-iran-israel'));
    newsFetch.mockResolvedValueOnce(
      result(
        [event({ id: 'n1', title: 'טיל בליסטי נורה לעבר תל אביב', reportedAt: MOCK_NOW })],
        'news-rss-iran-israel'
      )
    );
    firmsFetch.mockResolvedValueOnce(result([], 'nasa-firms'));
    weatherFetch.mockResolvedValueOnce(result([], 'open-meteo-weather-iran-israel'));

    const res = await GET(new Request('http://localhost/api/feed?conflict=iran-israel'));
    const body = (await res.json()) as IronsightEvent[];

    expect(body).toHaveLength(1);
    expect(body[0].originalTitle).toBe('טיל בליסטי נורה לעבר תל אביב');
    expect(body[0].originalLanguage).toBe('he');
    expect(body[0].title).toBe('[EN] טיל בליסטי נורה לעבר תל אביב');
  });

  it('does not set originalTitle on a non-Hebrew news event', async () => {
    conflictsFetch.mockResolvedValueOnce(result([], 'google-news-conflict-iran-israel'));
    newsFetch.mockResolvedValueOnce(result([event({ id: 'n1', title: 'Ceasefire talks resume' })], 'news-rss-iran-israel'));
    firmsFetch.mockResolvedValueOnce(result([], 'nasa-firms'));
    weatherFetch.mockResolvedValueOnce(result([], 'open-meteo-weather-iran-israel'));

    const res = await GET(new Request('http://localhost/api/feed?conflict=iran-israel'));
    const body = (await res.json()) as IronsightEvent[];

    expect(body[0].originalTitle).toBeUndefined();
    expect(body[0].title).toBe('Ceasefire talks resume');
  });

  it('emits X-Source-Health with exactly 4 entries in [conflicts, news, firms, weather] order', async () => {
    conflictsFetch.mockResolvedValueOnce(result([], 'google-news-conflict-iran-israel'));
    newsFetch.mockResolvedValueOnce(result([], 'news-rss-iran-israel'));
    firmsFetch.mockResolvedValueOnce(result([], 'nasa-firms'));
    weatherFetch.mockResolvedValueOnce(result([], 'open-meteo-weather-iran-israel'));

    const res = await GET(new Request('http://localhost/api/feed?conflict=iran-israel'));
    const health = JSON.parse(res.headers.get('X-Source-Health') ?? '[]');

    expect(health).toHaveLength(4);
    expect(health.map((h: { sourceId: string }) => h.sourceId)).toEqual([
      'google-news-conflict-iran-israel',
      'news-rss-iran-israel',
      'nasa-firms',
      'open-meteo-weather-iran-israel',
    ]);
  });

  it('sets Cache-Control to no-cache/no-store/must-revalidate', async () => {
    conflictsFetch.mockResolvedValueOnce(result([], 'google-news-conflict-iran-israel'));
    newsFetch.mockResolvedValueOnce(result([], 'news-rss-iran-israel'));
    firmsFetch.mockResolvedValueOnce(result([], 'nasa-firms'));
    weatherFetch.mockResolvedValueOnce(result([], 'open-meteo-weather-iran-israel'));

    const res = await GET(new Request('http://localhost/api/feed?conflict=iran-israel'));

    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
  });

  it('does not crash if one adapter fetch() rejects — the other three sources still come through', async () => {
    conflictsFetch.mockRejectedValueOnce(new Error('network unreachable'));
    newsFetch.mockResolvedValueOnce(result([event({ id: 'n1' })], 'news-rss-iran-israel'));
    firmsFetch.mockResolvedValueOnce(result([event({ id: 'f1' })], 'nasa-firms'));
    weatherFetch.mockResolvedValueOnce(result([event({ id: 'w1' })], 'open-meteo-weather-iran-israel'));

    const res = await GET(new Request('http://localhost/api/feed?conflict=iran-israel'));
    const body = (await res.json()) as IronsightEvent[];

    expect(body.map((e) => e.id).sort()).toEqual(['f1', 'n1', 'w1']);

    const health = JSON.parse(res.headers.get('X-Source-Health') ?? '[]');
    expect(health[0].status).toBe('unavailable');
    expect(health[1].status).toBe('healthy');
    expect(health[2].status).toBe('healthy');
    expect(health[3].status).toBe('healthy');
  });
});
