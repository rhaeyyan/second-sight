import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import FindingsPanel from './FindingsPanel';
import { createEventStore } from '@/lib/events/eventStore';
import type { IronsightEvent } from '@/lib/events/schema';

// toHaveNoViolations() is registered globally in vitest.setup.ts.

const NOW = 1_760_000_000_000;
const INTERVAL = 40;
const WAIT_OPTS = { timeout: 3000 };

// Severity is deliberately below 'high' by default: the escalation-pattern rule fires
// on 3+ high/critical kinetic events in one theater/window, and these tests accumulate
// several STRIKE events in the same theater/window across a single test — keeping
// severity at 'medium' means only the rule each test actually means to exercise
// (corroboration, via matching titles from distinct sources) fires.
function makeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'a',
    source: { id: 'google-news', name: 'Reuters', sourceType: 'media' },
    type: 'STRIKE',
    theater: 'iran-israel',
    reportedAt: NOW,
    ingestedAt: NOW,
    severity: 'medium',
    confidence: 'medium',
    verificationStatus: 'single-source',
    title: 'Missile strike reported near Tehran',
    tags: ['strike'],
    ...overrides,
  };
}

describe('FindingsPanel', () => {
  it('shows the empty state when the store has no correlated findings', async () => {
    const store = createEventStore();
    render(<FindingsPanel store={store} interval={INTERVAL} />);

    await waitFor(
      () => expect(screen.getByText('No correlated findings in the current buffer.')).toBeInTheDocument(),
      WAIT_OPTS,
    );
    expect(screen.getByText('0 active')).toBeInTheDocument();
  });

  it('renders a corroboration finding and reflects it in the summary strip', async () => {
    const store = createEventStore();
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' } }),
    ]);

    render(<FindingsPanel store={store} interval={INTERVAL} />);

    await waitFor(() => expect(screen.getByText('1 active')).toBeInTheDocument(), WAIT_OPTS);
    expect(screen.getByText('Possible corroborated event (2 independent sources)')).toBeInTheDocument();

    const summary = screen.getByText('CORROBORATED').previousElementSibling;
    expect(summary).toHaveTextContent('1');
  });

  it('has no Axe violations in the empty state', async () => {
    const store = createEventStore();
    const { container } = render(<FindingsPanel store={store} interval={INTERVAL} />);

    await waitFor(
      () => expect(screen.getByText('No correlated findings in the current buffer.')).toBeInTheDocument(),
      WAIT_OPTS,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no Axe violations with findings rendered', async () => {
    const store = createEventStore();
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' } }),
    ]);
    const { container } = render(<FindingsPanel store={store} interval={INTERVAL} />);

    await waitFor(() => expect(screen.getByText('1 active')).toBeInTheDocument(), WAIT_OPTS);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('does not announce the initial load, but announces genuinely new findings that arrive afterward', async () => {
    const store = createEventStore();
    store.add([
      makeEvent({ id: 'a', source: { id: 'google-news', name: 'Reuters', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' } }),
    ]);

    render(<FindingsPanel store={store} interval={INTERVAL} />);

    await waitFor(() => expect(screen.getByText('1 active')).toBeInTheDocument(), WAIT_OPTS);
    // Initial load must not itself be announced.
    expect(screen.queryByText(/new finding/)).not.toBeInTheDocument();

    // A second, unrelated corroborated pair triggers a genuinely new finding.
    store.add([
      makeEvent({
        id: 'c',
        source: { id: 'other-outlet', name: 'AP', sourceType: 'media' },
        title: 'Naval incident reported in the strait',
      }),
      makeEvent({
        id: 'd',
        source: { id: 'osint-x', name: 'OSINT X', sourceType: 'social' },
        title: 'Naval incident reported in the strait',
      }),
    ]);

    await waitFor(() => expect(screen.getByText('1 new finding')).toBeInTheDocument(), WAIT_OPTS);
  });
});
