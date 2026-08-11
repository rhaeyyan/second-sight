import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ConflictFeed from './ConflictFeed';
import { ConflictProvider } from '@/lib/conflicts/context';
import type { IronsightEvent } from '@/lib/events/schema';

const MOCK_NOW = 1_760_000_000_000;

function event(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'evt-1',
    source: { id: 'google-news-conflict', name: 'Google News', sourceType: 'media' },
    type: 'STRIKE',
    theater: 'iran-israel',
    region: 'Tel Aviv',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'high',
    confidence: 'medium',
    verificationStatus: 'single-source',
    title: 'Missile strike reported near Tel Aviv',
    tags: ['strike'],
    ...overrides,
  };
}

describe('ConflictFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a fetched IronsightEvent through the field mapping (title, region, source name)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [event()],
        headers: new Headers(),
      }),
    );

    render(
      <ConflictProvider>
        <ConflictFeed />
      </ConflictProvider>
    );

    await waitFor(() => expect(screen.getByText('1 events')).toBeInTheDocument());
    expect(screen.getByText('Missile strike reported near Tel Aviv')).toBeInTheDocument();
    expect(screen.getByText('Tel Aviv')).toBeInTheDocument();
    expect(screen.getByText('via Google News')).toBeInTheDocument();
    expect(screen.getByText('STRIKE')).toBeInTheDocument();
  });
});

// Phase 1 exit criteria: "source failures degrade gracefully without crashing the
// dashboard." These don't test the fetch/adapter layer (covered elsewhere) — they
// render the actual panel against a failing /api/conflicts and prove the failure
// surfaces as an empty state, not a thrown error or an infinite loading spinner.
describe('ConflictFeed — graceful degradation on source failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders an empty state instead of crashing when the fetch throws (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    render(
      <ConflictProvider>
        <ConflictFeed />
      </ConflictProvider>
    );

    expect(screen.getByText('CONFLICT MONITOR')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('0 events')).toBeInTheDocument());
  });

  it('renders an empty state instead of crashing when the API returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    render(
      <ConflictProvider>
        <ConflictFeed />
      </ConflictProvider>
    );

    await waitFor(() => expect(screen.getByText('0 events')).toBeInTheDocument());
  });
});
