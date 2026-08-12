import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedPage from './page';
import { ConflictProvider } from '@/lib/conflicts/context';
import type { IronsightEvent } from '@/lib/events/schema';
import type { AnalysisFinding } from '@/lib/analysis/finding';

const { FIXTURE_EVENTS, FIXTURE_FINDINGS } = vi.hoisted(() => {
  const now = Date.now();
  return {
    FIXTURE_EVENTS: [
      {
        id: 'evt-strike-1',
        source: { id: 'google-news', name: 'Google News', sourceType: 'media' },
        type: 'strike',
        theater: 'iran-israel',
        reportedAt: now - 60_000,
        ingestedAt: now - 55_000,
        severity: 'critical',
        confidence: 'high',
        verificationStatus: 'corroborated',
        title: 'Missile strike reported',
        tags: ['strike'],
      } as IronsightEvent
    ],
    FIXTURE_FINDINGS: [
      {
        id: 'fnd-1',
        ruleId: 'corroboration',
        severity: 'high',
        title: 'Multiple reports of missile strike',
        explanation: 'Test explanation',
        limitations: ['test limit'],
        generatedAt: now - 1000,
        evidenceEventIds: ['evt-strike-1'],
      } as AnalysisFinding
    ]
  };
});

vi.mock('@/lib/analysis/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analysis/engine')>();
  return {
    ...actual,
    runCorrelationEngine: vi.fn().mockImplementation(() => ({
      findings: FIXTURE_FINDINGS,
      clusters: []
    }))
  };
});

// We need to mock the feed fetch and the findings logic since the page mounts both
function stubFetchAndFindings() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_EVENTS,
      headers: new Headers(),
    })
  );
}

describe('FeedPage Cross-Panel Highlighting', () => {
  let originalScrollIntoView: typeof window.HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('highlights the corresponding FeedTable row when an evidence event is clicked in FindingsPanel', async () => {
    stubFetchAndFindings();
    const user = userEvent.setup();

    render(
      <ConflictProvider>
        <FeedPage />
      </ConflictProvider>
    );

    // Wait for feed to load and display the event
    await waitFor(() => {
      expect(screen.getByText('Missile strike reported')).toBeInTheDocument();
    });

    // Expand the finding to reveal evidence events
    const findingRow = await screen.findByRole('button', { name: /Multiple reports of missile strike/i });
    await user.click(findingRow);

    // Find the clickable evidence event source in the expanded finding details
    const evidenceButton = await screen.findByRole('button', { name: 'Google News' });
    
    // Click it to trigger the highlight
    await user.click(evidenceButton);

    const tableCell = screen.getAllByText('Missile strike reported')[0];
    const tableRow = tableCell.closest('tr');
    expect(tableRow).toHaveAttribute('data-highlighted', 'true');
  });
});

// Mock matchMedia for FeedTable
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock scrollIntoView for FeedTable
Element.prototype.scrollIntoView = vi.fn();
