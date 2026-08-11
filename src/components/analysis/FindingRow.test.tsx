import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import FindingRow from './FindingRow';
import type { AnalysisFinding } from '@/lib/analysis/finding';
import type { IronsightEvent } from '@/lib/events/schema';

// toHaveNoViolations() is registered globally in vitest.setup.ts.

const NOW = 1_760_000_000_000;

const FINDING: AnalysisFinding = {
  id: 'finding-corroboration-incident-1',
  ruleId: 'corroboration',
  title: 'Possible corroborated event (2 independent sources)',
  severity: 'high',
  evidenceEventIds: ['evt-a', 'evt-b'],
  explanation: '2 independent sources reported similar content in the iran-israel theater.',
  limitations: [
    'Corroboration here is based on textual and temporal similarity, not confirmed shared ground truth.',
    'Clustering can over- or under-group real-world incidents.',
  ],
  generatedAt: NOW - 60_000,
  expiresAt: NOW + 60 * 60_000,
};

const EVENT_A: IronsightEvent = {
  id: 'evt-a',
  source: { id: 'google-news', name: 'Reuters', url: 'https://reuters.com', sourceType: 'media' },
  type: 'STRIKE',
  theater: 'iran-israel',
  reportedAt: NOW - 90_000,
  ingestedAt: NOW - 85_000,
  severity: 'high',
  confidence: 'medium',
  verificationStatus: 'single-source',
  title: 'Missile strike reported near Tehran',
  url: 'https://example.com/strike-report',
  tags: ['strike'],
};

const EVENT_B: IronsightEvent = {
  id: 'evt-b',
  source: { id: 'telegram-x', name: 'Channel X', sourceType: 'social' },
  type: 'STRIKE',
  theater: 'iran-israel',
  reportedAt: NOW - 100_000,
  ingestedAt: NOW - 95_000,
  severity: 'medium',
  confidence: 'medium',
  verificationStatus: 'single-source',
  title: 'Strike reported near Tehran, unconfirmed',
  tags: ['strike'],
};

describe('FindingRow', () => {
  it('has no Axe violations when collapsed', async () => {
    const { container } = render(<FindingRow finding={FINDING} evidenceEvents={[EVENT_A, EVENT_B]} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no Axe violations when expanded', async () => {
    const { container } = render(<FindingRow finding={FINDING} evidenceEvents={[EVENT_A, EVENT_B]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { expanded: false }));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows the hedged title and severity/rule labels while collapsed, without revealing the explanation', () => {
    render(<FindingRow finding={FINDING} evidenceEvents={[EVENT_A, EVENT_B]} />);

    expect(screen.getByText('Possible corroborated event (2 independent sources)')).toBeInTheDocument();
    expect(screen.getByText('ASSESSED: HIGH')).toBeInTheDocument();
    expect(screen.getByText('CORROBORATION')).toBeInTheDocument();
    expect(screen.queryByText(FINDING.explanation)).not.toBeInTheDocument();
  });

  it('expands on click to reveal the explanation, limitations list, and evidence events', async () => {
    render(<FindingRow finding={FINDING} evidenceEvents={[EVENT_A, EVENT_B]} />);
    const user = userEvent.setup();

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(FINDING.explanation)).toBeInTheDocument();
    for (const limitation of FINDING.limitations) {
      expect(screen.getByText(limitation)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Missile strike reported near Tehran' })).toHaveAttribute(
      'href',
      'https://example.com/strike-report',
    );
    expect(screen.getByText('Strike reported near Tehran, unconfirmed')).toBeInTheDocument();
  });

  it('toggles expansion via keyboard (Enter) while the disclosure button holds focus', async () => {
    render(<FindingRow finding={FINDING} evidenceEvents={[EVENT_A, EVENT_B]} />);
    const user = userEvent.setup();

    const button = screen.getByRole('button');
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(FINDING.explanation)).toBeInTheDocument();
  });

  it('reports partially-resolved evidence when some evidence events have aged out of the buffer', async () => {
    render(<FindingRow finding={FINDING} evidenceEvents={[EVENT_A]} />);
    const user = userEvent.setup();

    // The count line also renders a trailing relative-time string, so match by
    // substring (against RTL's default direct-child-text content) rather than the
    // node's full, exact text.
    expect(
      screen.getByText((content) => content.includes('2 evidence events (1 in current buffer)')),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button'));
    expect(
      screen.getByText((content) => content.includes('1 evidence event no longer in buffer')),
    ).toBeInTheDocument();
  });
});
