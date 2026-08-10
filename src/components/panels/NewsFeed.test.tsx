import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import NewsFeed from './NewsFeed';
import { ConflictProvider } from '@/lib/conflicts/context';

// Phase 1 exit criteria: "source failures degrade gracefully without crashing the
// dashboard." These render the actual panel against a failing /api/news and prove the
// failure surfaces as an empty state, not a thrown error or an infinite loading spinner.
describe('NewsFeed — graceful degradation on source failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders an empty state instead of crashing when the fetch throws (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    render(
      <ConflictProvider>
        <NewsFeed />
      </ConflictProvider>
    );

    expect(screen.getByText('LIVE INTEL FEED')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/0 items/)).toBeInTheDocument());
  });

  it('renders an empty state instead of crashing when the API returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    render(
      <ConflictProvider>
        <NewsFeed />
      </ConflictProvider>
    );

    await waitFor(() => expect(screen.getByText(/0 items/)).toBeInTheDocument());
  });
});
