import { describe, it, expect } from 'vitest';
import { runCorrelationEngine, pruneExpiredFindings } from './engine';
import { CORROBORATION_RULE_ID } from './rules/corroboration';
import { SENSOR_NARRATIVE_CORRELATION_RULE_ID } from './rules/sensorNarrativeCorrelation';
import { ESCALATION_PATTERN_RULE_ID } from './rules/escalationPattern';
import { AnalysisFindingSchema, type AnalysisFinding } from './finding';
import type { IronsightEvent } from '@/lib/events/schema';

const MOCK_NOW = 1_760_000_000_000;

function makeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'evt-1',
    source: { id: 'source-a', name: 'Source A', sourceType: 'media' },
    type: 'REPORT',
    theater: 'iran-israel',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'info',
    confidence: 'low',
    verificationStatus: 'single-source',
    title: 'Missile strike reported near Tehran',
    tags: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
  return {
    id: 'finding-1',
    ruleId: 'test-rule',
    title: 'Test finding',
    severity: 'medium',
    evidenceEventIds: ['a'],
    explanation: 'Test explanation.',
    limitations: ['Test limitation.'],
    generatedAt: MOCK_NOW,
    ...overrides,
  };
}

describe('runCorrelationEngine', () => {
  it('runs all three rules and returns their combined findings', () => {
    const events: IronsightEvent[] = [
      // Corroboration: two distinct sources, similar titles, same theater/time.
      makeEvent({ id: 'c1', title: 'Missile strike reported near Tehran', source: { id: 'src-a', name: 'A', sourceType: 'media' } }),
      makeEvent({ id: 'c2', title: 'Missile strike hits Tehran overnight', source: { id: 'src-b', name: 'B', sourceType: 'media' }, reportedAt: MOCK_NOW + 5 * 60_000 }),
      // Sensor-narrative: a FIRMS thermal event near a reported strike.
      makeEvent({ id: 's1', type: 'THERMAL_ANOMALY', source: { id: 'nasa-firms', name: 'NASA FIRMS', sourceType: 'sensor' }, title: 'Thermal anomaly detected', reportedAt: MOCK_NOW }),
      makeEvent({ id: 's2', type: 'STRIKE', title: 'Strike reported in region', reportedAt: MOCK_NOW + 10 * 60_000, source: { id: 'src-c', name: 'C', sourceType: 'media' } }),
      // Escalation: three high/critical kinetic events in a short window.
      makeEvent({ id: 'e1', type: 'STRIKE', severity: 'high', reportedAt: MOCK_NOW, title: 'Escalation event one', source: { id: 'src-d', name: 'D', sourceType: 'media' } }),
      makeEvent({ id: 'e2', type: 'DRONE', severity: 'high', reportedAt: MOCK_NOW + 30 * 60_000, title: 'Escalation event two', source: { id: 'src-e', name: 'E', sourceType: 'media' } }),
      makeEvent({ id: 'e3', type: 'STRIKE', severity: 'critical', reportedAt: MOCK_NOW + 60 * 60_000, title: 'Escalation event three', source: { id: 'src-f', name: 'F', sourceType: 'media' } }),
    ];

    const { findings } = runCorrelationEngine(events, () => MOCK_NOW);

    const ruleIds = new Set(findings.map((f) => f.ruleId));
    expect(ruleIds.has(CORROBORATION_RULE_ID)).toBe(true);
    expect(ruleIds.has(SENSOR_NARRATIVE_CORRELATION_RULE_ID)).toBe(true);
    expect(ruleIds.has(ESCALATION_PATTERN_RULE_ID)).toBe(true);
  });

  it('every finding produced validates against AnalysisFindingSchema', () => {
    const events: IronsightEvent[] = [
      makeEvent({ id: 'c1', title: 'Missile strike reported near Tehran', source: { id: 'src-a', name: 'A', sourceType: 'media' } }),
      makeEvent({ id: 'c2', title: 'Missile strike hits Tehran overnight', source: { id: 'src-b', name: 'B', sourceType: 'media' }, reportedAt: MOCK_NOW + 5 * 60_000 }),
    ];

    const { findings } = runCorrelationEngine(events, () => MOCK_NOW);

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(AnalysisFindingSchema.safeParse(finding).success).toBe(true);
    }
  });

  it('returns an empty array for an empty event list, without throwing', () => {
    expect(() => runCorrelationEngine([], () => MOCK_NOW)).not.toThrow();
    expect(runCorrelationEngine([], () => MOCK_NOW).findings).toEqual([]);
  });

  it('returns an empty array when no events satisfy any rule', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Ceasefire talks resume in Cairo' }),
      makeEvent({ id: 'b', title: 'Oil futures spike amid conflict fears', reportedAt: MOCK_NOW + 60_000 }),
    ];

    expect(runCorrelationEngine(events, () => MOCK_NOW).findings).toEqual([]);
  });

  it('defaults the clock to Date.now when not provided', () => {
    const { findings } = runCorrelationEngine([]);
    expect(findings).toEqual([]);
  });
});

describe('pruneExpiredFindings', () => {
  it('keeps findings whose expiresAt is in the future', () => {
    const findings = [makeFinding({ expiresAt: MOCK_NOW + 1000 })];
    expect(pruneExpiredFindings(findings, MOCK_NOW)).toEqual(findings);
  });

  it('drops findings whose expiresAt is in the past', () => {
    const findings = [makeFinding({ expiresAt: MOCK_NOW - 1000 })];
    expect(pruneExpiredFindings(findings, MOCK_NOW)).toEqual([]);
  });

  it('treats a finding expiring at exactly `now` as already expired', () => {
    const findings = [makeFinding({ expiresAt: MOCK_NOW })];
    expect(pruneExpiredFindings(findings, MOCK_NOW)).toEqual([]);
  });

  it('keeps findings with no expiresAt at all — treated as never-expiring', () => {
    const findings = [makeFinding({ expiresAt: undefined })];
    expect(pruneExpiredFindings(findings, MOCK_NOW)).toEqual(findings);
  });

  it('filters a mixed batch correctly', () => {
    const keep1 = makeFinding({ id: 'keep-1', expiresAt: MOCK_NOW + 1000 });
    const keep2 = makeFinding({ id: 'keep-2', expiresAt: undefined });
    const drop1 = makeFinding({ id: 'drop-1', expiresAt: MOCK_NOW - 1000 });

    const result = pruneExpiredFindings([keep1, drop1, keep2], MOCK_NOW);

    expect(result.map((f) => f.id).sort()).toEqual(['keep-1', 'keep-2']);
  });

  it('returns an empty array for an empty input', () => {
    expect(pruneExpiredFindings([], MOCK_NOW)).toEqual([]);
  });
});
