import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import UnifiedFeed from './UnifiedFeed';
import { ConflictProvider } from '@/lib/conflicts/context';
import type { IronsightEvent } from '@/lib/events/schema';

// toHaveNoViolations() is registered globally in vitest.setup.ts (working around
// vitest-axe@0.1.0's own broken 'vitest-axe/extend-expect' entry point).

// Fixture spans the fields the a11y/keyboard tests below need to exercise:
// - evt-strike: has `location` and `url` (renders as a table link, and would plot on
//   the map view).
// - evt-ceasefire: has `originalTitle`/`originalLanguage` (Hebrew, rtl rendering).
// - evt-convoy / evt-thermal / evt-oil: round out the type/severity/sourceType spread
//   so the filter fieldsets have more than one option each to toggle between.
const now = Date.now();

const FIXTURE_EVENTS: IronsightEvent[] = [
  {
    id: 'evt-strike',
    source: { id: 'google-news-conflict', name: 'Google News', url: 'https://news.google.com', sourceType: 'media' },
    type: 'strike',
    theater: 'iran-israel',
    region: 'Tel Aviv',
    reportedAt: now - 60_000,
    ingestedAt: now - 55_000,
    location: { latitude: 32.0853, longitude: 34.7818, precision: 'approximate' },
    severity: 'critical',
    confidence: 'high',
    verificationStatus: 'corroborated',
    title: 'Missile strike reported near Tel Aviv',
    url: 'https://example.com/strike-report',
    tags: ['strike'],
  },
  {
    id: 'evt-ceasefire',
    source: { id: 'telegram-idf', name: 'IDF Telegram', sourceType: 'official' },
    type: 'diplomatic',
    theater: 'iran-israel',
    reportedAt: now - 120_000,
    ingestedAt: now - 118_000,
    severity: 'medium',
    confidence: 'medium',
    verificationStatus: 'official',
    title: 'Ceasefire talks announced',
    originalTitle: 'הודעה על שיחות הפסקת אש',
    originalLanguage: 'he',
    tags: ['diplomatic'],
  },
  {
    id: 'evt-convoy',
    source: { id: 'social-x', name: 'OSINT Twitter', sourceType: 'social' },
    type: 'report',
    theater: 'iran-israel',
    reportedAt: now - 180_000,
    ingestedAt: now - 175_000,
    severity: 'low',
    confidence: 'low',
    verificationStatus: 'unverified',
    title: 'Unconfirmed sighting of military convoy',
    tags: ['convoy'],
  },
  {
    id: 'evt-thermal',
    source: { id: 'nasa-firms', name: 'NASA FIRMS', sourceType: 'sensor' },
    type: 'thermal-anomaly',
    theater: 'iran-israel',
    reportedAt: now - 240_000,
    ingestedAt: now - 235_000,
    severity: 'info',
    confidence: 'medium',
    verificationStatus: 'unverified',
    title: 'Thermal anomaly detected',
    tags: ['thermal'],
  },
  {
    id: 'evt-oil',
    source: { id: 'market-feed', name: 'Yahoo Finance', sourceType: 'market' },
    type: 'market-move',
    theater: 'iran-israel',
    reportedAt: now - 300_000,
    ingestedAt: now - 295_000,
    severity: 'high',
    confidence: 'high',
    verificationStatus: 'single-source',
    title: 'Oil futures spike amid conflict fears',
    tags: ['market'],
  },
];

function stubFeedFetch(events: IronsightEvent[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => events,
      headers: new Headers({
        'X-Source-Health': JSON.stringify([
          { sourceId: 'google-news-conflict', status: 'ok', lastAttemptAt: now },
        ]),
      }),
    }),
  );
}

async function renderFeed() {
  const utils = render(
    <ConflictProvider>
      <UnifiedFeed />
    </ConflictProvider>,
  );
  // Wait for the initial fetch to resolve and the loading skeleton to be replaced by
  // the real table.
  await waitFor(() => expect(screen.getByText(`${FIXTURE_EVENTS.length} of ${FIXTURE_EVENTS.length} events`)).toBeInTheDocument());
  return utils;
}

describe('UnifiedFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Phase 2 exit criteria: "automated Axe accessibility tests pass with zero critical
  // violations." Table view only — Map view's Leaflet internals aren't part of this
  // exit criteria and next/dynamic's ssr:false loader doesn't need exercising here.
  it('has no Axe violations in table view', async () => {
    stubFeedFetch(FIXTURE_EVENTS);
    const { container } = await renderFeed();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // Phase 2 exit criteria: "Feed is fully operable via keyboard-only navigation."
  // jsdom doesn't compute a real tab order on its own, so this drives actual Tab key
  // presses via user-event and asserts each control class is reachable within a bounded
  // number of tabs — proving there's no keyboard trap, without pinning an exact global
  // order (brittle, and not what the exit criteria asks for).
  it('reaches every interactive control via repeated Tab presses', async () => {
    stubFeedFetch(FIXTURE_EVENTS);
    await renderFeed();
    const user = userEvent.setup();

    const pauseButton = screen.getByRole('button', { name: 'Pause' });
    const tableButton = screen.getByRole('button', { name: 'Table' });
    const mapButton = screen.getByRole('button', { name: 'Map' });
    const strikeCheckbox = screen.getByRole('checkbox', { name: 'strike' });
    const criticalCheckbox = screen.getByRole('checkbox', { name: 'critical' });
    const officialCheckbox = screen.getByRole('checkbox', { name: 'official' });
    const titleLink = screen.getByRole('link', { name: 'Missile strike reported near Tel Aviv' });

    const mustReach = [
      pauseButton,
      tableButton,
      mapButton,
      strikeCheckbox,
      criticalCheckbox,
      officialCheckbox,
      titleLink,
    ];

    const seen = new Set<Element>();
    const MAX_TABS = 40;
    for (let i = 0; i < MAX_TABS && !mustReach.every((el) => seen.has(el)); i++) {
      await user.tab();
      if (document.activeElement) seen.add(document.activeElement);
    }

    for (const el of mustReach) {
      expect(seen.has(el)).toBe(true);
    }
  });

  // Proves controls are operable from the keyboard, not just focusable — Enter on the
  // Pause button (while it holds focus) must actually toggle pause, same as a click would.
  it('toggles Pause via Enter while the button is focused', async () => {
    stubFeedFetch(FIXTURE_EVENTS);
    await renderFeed();
    const user = userEvent.setup();

    const pauseButton = screen.getByRole('button', { name: 'Pause' });
    expect(pauseButton).toHaveAttribute('aria-pressed', 'false');

    pauseButton.focus();
    expect(pauseButton).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(pauseButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  // Filter checkboxes must be real, labelled form controls operable with Space — not
  // click-only divs — and toggling one must actually narrow the rendered event set.
  it('toggles a filter checkbox via Space and narrows the event count', async () => {
    stubFeedFetch(FIXTURE_EVENTS);
    await renderFeed();
    const user = userEvent.setup();

    const strikeCheckbox = screen.getByRole('checkbox', { name: 'strike' });
    expect(strikeCheckbox).not.toBeChecked();

    strikeCheckbox.focus();
    expect(strikeCheckbox).toHaveFocus();
    await user.keyboard(' ');

    expect(strikeCheckbox).toBeChecked();
    await waitFor(() =>
      expect(screen.getByText(`1 of ${FIXTURE_EVENTS.length} events`)).toBeInTheDocument(),
    );
  });

  // Phase 1's graceful-degradation pattern, mirrored for the merged /api/feed endpoint:
  // a failing fetch must not crash the panel or leave it stuck loading forever.
  describe('graceful degradation on source failure', () => {
    it('renders an empty state instead of crashing when the fetch throws (network/timeout)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

      render(
        <ConflictProvider>
          <UnifiedFeed />
        </ConflictProvider>,
      );

      expect(screen.getByText('UNIFIED FEED')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('0 of 0 events')).toBeInTheDocument());
      expect(screen.getByText(/Feed error:/)).toBeInTheDocument();
    });

    it('renders an empty state instead of crashing when the API returns a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      render(
        <ConflictProvider>
          <UnifiedFeed />
        </ConflictProvider>,
      );

      expect(screen.getByText('UNIFIED FEED')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('0 of 0 events')).toBeInTheDocument());
    });
  });
});
