import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ConflictFeed from './ConflictFeed';
import { ConflictProvider } from '@/lib/conflicts/context';

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
