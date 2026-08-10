import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SatellitePanel from './SatellitePanel';
import { ConflictProvider } from '@/lib/conflicts/context';

// Phase 1 exit criteria: "source failures degrade gracefully without crashing the
// dashboard." These render the actual panel against a failing /api/fires and prove the
// failure surfaces as a zeroed-out summary, not a thrown error or an infinite spinner.
// (This is the third of the three Phase 1 feeds — the NASA FIRMS SourceAdapter itself
// is standalone/not wired into this route's response shape; see firmsFires.ts's doc
// comment. This test is about the route's existing resilience, independent of that.)
describe('SatellitePanel — graceful degradation on source failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a zeroed-out summary instead of crashing when the fetch throws (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    render(
      <ConflictProvider>
        <SatellitePanel />
      </ConflictProvider>
    );

    expect(screen.getByText('SAT THERMAL DETECT')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('HOTSPOTS')).toBeInTheDocument());
    expect(screen.getAllByText('0')).not.toHaveLength(0);
  });

  it('renders a zeroed-out summary instead of crashing when the API returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    render(
      <ConflictProvider>
        <SatellitePanel />
      </ConflictProvider>
    );

    await waitFor(() => expect(screen.getAllByText('0').length).toBeGreaterThan(0));
  });
});
