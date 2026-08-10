import { describe, it, expect } from 'vitest';
import { ESCALATION_PATTERN_RULE_ID, applyEscalationPatternRule } from './escalationPattern';
import { AnalysisFindingSchema } from '../finding';
import type { IronsightEvent } from '@/lib/events/schema';

// Fixed epoch rather than Date.now() — deterministic fixtures, same pattern as
// incident.test.ts / finding.test.ts / corroboration.test.ts.
const MOCK_NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;

function makeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'evt-1',
    source: { id: 'source-a', name: 'Source A', sourceType: 'media' },
    type: 'STRIKE',
    theater: 'iran-israel',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'high',
    confidence: 'medium',
    verificationStatus: 'single-source',
    title: 'Strike reported',
    tags: [],
    ...overrides,
  };
}

describe('applyEscalationPatternRule — true positives', () => {
  it('produces one finding for 3 high/critical kinetic events in the same theater within the window', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 30 * 60 * 1000 }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 60 * 60 * 1000 }),
    ];

    const findings = applyEscalationPatternRule(events, undefined, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0].evidenceEventIds.sort()).toEqual(['a', 'b', 'c']);
    expect(findings[0].ruleId).toBe(ESCALATION_PATTERN_RULE_ID);
  });
});

describe('applyEscalationPatternRule — near misses', () => {
  it('produces no finding for only 2 qualifying events (below minEventCount)', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 30 * 60 * 1000 }),
    ];

    expect(applyEscalationPatternRule(events, undefined, () => MOCK_NOW)).toEqual([]);
  });

  it('produces no finding when severity is medium or lower despite kinetic type', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW, severity: 'medium' }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 30 * 60 * 1000, severity: 'medium' }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 60 * 60 * 1000, severity: 'low' }),
    ];

    expect(applyEscalationPatternRule(events, undefined, () => MOCK_NOW)).toEqual([]);
  });

  it('produces no finding for non-kinetic types despite high severity', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW, type: 'DIPLOMATIC' }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 30 * 60 * 1000, type: 'REPORT' }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 60 * 60 * 1000, type: 'DIPLOMATIC' }),
    ];

    expect(applyEscalationPatternRule(events, undefined, () => MOCK_NOW)).toEqual([]);
  });

  it('produces no finding when qualifying events are split across two theaters', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW, theater: 'iran-israel' }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 30 * 60 * 1000, theater: 'iran-israel' }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 60 * 60 * 1000, theater: 'russia-ukraine' }),
    ];

    expect(applyEscalationPatternRule(events, undefined, () => MOCK_NOW)).toEqual([]);
  });
});

describe('applyEscalationPatternRule — stale events (outside the window)', () => {
  it('produces no finding when 3 qualifying events are spread beyond the default 3h window', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 2.5 * HOUR }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 5 * HOUR }),
    ];

    expect(applyEscalationPatternRule(events, undefined, () => MOCK_NOW)).toEqual([]);
  });

  it('a custom windowMs wide enough to cover the same spread produces a finding', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 2.5 * HOUR }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 5 * HOUR }),
    ];

    const findings = applyEscalationPatternRule(events, { windowMs: 6 * HOUR }, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0].evidenceEventIds.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('applyEscalationPatternRule — burst deduplication', () => {
  it('produces exactly one finding covering all 5 events in a larger burst, not overlapping findings', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 10 * 60 * 1000 }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 20 * 60 * 1000 }),
      makeEvent({ id: 'd', reportedAt: MOCK_NOW + 30 * 60 * 1000 }),
      makeEvent({ id: 'e', reportedAt: MOCK_NOW + 40 * 60 * 1000 }),
    ];

    const findings = applyEscalationPatternRule(events, undefined, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0].evidenceEventIds.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('applyEscalationPatternRule — custom minEventCount', () => {
  it('fires on just 2 events when minEventCount is lowered to 2', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 30 * 60 * 1000 }),
    ];

    const findings = applyEscalationPatternRule(events, { minEventCount: 2 }, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0].evidenceEventIds.sort()).toEqual(['a', 'b']);
  });
});

describe('applyEscalationPatternRule — severity computation', () => {
  it('sets finding severity to the max severity among the group, not the first event encountered', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW, severity: 'high' }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 20 * 60 * 1000, severity: 'critical' }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 40 * 60 * 1000, severity: 'high' }),
    ];

    const findings = applyEscalationPatternRule(events, undefined, () => MOCK_NOW);

    expect(findings[0].severity).toBe('critical');
  });
});

describe('applyEscalationPatternRule — schema conformance', () => {
  it('every produced finding validates against AnalysisFindingSchema', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW, type: 'STRIKE', severity: 'high', theater: 'iran-israel' }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 20 * 60 * 1000, type: 'DRONE', severity: 'critical', theater: 'iran-israel' }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 40 * 60 * 1000, type: 'POSSIBLE_EXPLOSION', severity: 'high', theater: 'iran-israel' }),
      makeEvent({ id: 'd', reportedAt: MOCK_NOW, type: 'MISSILE', severity: 'critical', theater: 'russia-ukraine' }),
      makeEvent({ id: 'e', reportedAt: MOCK_NOW + 10 * 60 * 1000, type: 'STRIKE', severity: 'high', theater: 'russia-ukraine' }),
      makeEvent({ id: 'f', reportedAt: MOCK_NOW + 20 * 60 * 1000, type: 'STRIKE', severity: 'critical', theater: 'russia-ukraine' }),
    ];

    const findings = applyEscalationPatternRule(events, undefined, () => MOCK_NOW);

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      const result = AnalysisFindingSchema.safeParse(finding);
      expect(result.success).toBe(true);
    }
  });

  it('sets expiresAt after generatedAt', () => {
    const events = [
      makeEvent({ id: 'a', reportedAt: MOCK_NOW }),
      makeEvent({ id: 'b', reportedAt: MOCK_NOW + 30 * 60 * 1000 }),
      makeEvent({ id: 'c', reportedAt: MOCK_NOW + 60 * 60 * 1000 }),
    ];

    const findings = applyEscalationPatternRule(events, undefined, () => MOCK_NOW);

    expect(findings[0].generatedAt).toBe(MOCK_NOW);
    expect(findings[0].expiresAt).toBeDefined();
    expect(findings[0].expiresAt! > findings[0].generatedAt).toBe(true);
  });
});

describe('applyEscalationPatternRule — empty input', () => {
  it('returns an empty array and does not throw for no events', () => {
    expect(() => applyEscalationPatternRule([], undefined, () => MOCK_NOW)).not.toThrow();
    expect(applyEscalationPatternRule([], undefined, () => MOCK_NOW)).toEqual([]);
  });
});
