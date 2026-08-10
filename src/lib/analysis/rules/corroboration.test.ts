import { describe, it, expect } from 'vitest';
import { CORROBORATION_RULE_ID, applyCorroborationRule } from './corroboration';
import { AnalysisFindingSchema } from '../finding';
import type { Incident } from '../incident';
import type { IronsightEvent } from '@/lib/events/schema';

// Fixed epoch rather than Date.now() — deterministic fixtures, same pattern as
// incident.test.ts and finding.test.ts.
const MOCK_NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;

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

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'incident-1',
    theater: 'iran-israel',
    eventIds: ['a', 'b'],
    sourceIds: ['source-a', 'source-b'],
    firstReportedAt: MOCK_NOW,
    lastReportedAt: MOCK_NOW + HOUR,
    ...overrides,
  };
}

describe('applyCorroborationRule — true positives', () => {
  it('produces exactly one finding for an incident with two distinct sourceIds', () => {
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'source-b', name: 'Source B', sourceType: 'media' } }),
    ];
    const incident = makeIncident();

    const findings = applyCorroborationRule([incident], events, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0].evidenceEventIds).toEqual(incident.eventIds);
    expect(findings[0].evidenceEventIds.sort()).toEqual(['a', 'b']);
    expect(findings[0].limitations.length).toBeGreaterThan(0);
    expect(findings[0].ruleId).toBe(CORROBORATION_RULE_ID);
  });

  it('sets severity to the max severity among member events, not the first event encountered', () => {
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' }, severity: 'low' }),
      makeEvent({ id: 'b', source: { id: 'source-b', name: 'Source B', sourceType: 'media' }, severity: 'critical' }),
    ];
    const incident = makeIncident({ eventIds: ['a', 'b'] });

    const findings = applyCorroborationRule([incident], events, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('picks the max severity regardless of member ordering in eventIds', () => {
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' }, severity: 'high' }),
      makeEvent({ id: 'b', source: { id: 'source-b', name: 'Source B', sourceType: 'media' }, severity: 'medium' }),
      makeEvent({ id: 'c', source: { id: 'source-c', name: 'Source C', sourceType: 'media' }, severity: 'info' }),
    ];
    const incident = makeIncident({ eventIds: ['c', 'a', 'b'], sourceIds: ['source-a', 'source-b', 'source-c'] });

    const findings = applyCorroborationRule([incident], events, () => MOCK_NOW);

    expect(findings[0].severity).toBe('high');
  });
});

describe('applyCorroborationRule — near misses', () => {
  it('produces no finding when an incident has only one distinct sourceId', () => {
    // Two events, same outlet posting two updates — clustered but not corroborated.
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
    ];
    const incident = makeIncident({ eventIds: ['a', 'b'], sourceIds: ['source-a'] });

    const findings = applyCorroborationRule([incident], events, () => MOCK_NOW);

    expect(findings).toEqual([]);
  });

  it('re-derives distinct source count from member events rather than trusting sourceIds.length', () => {
    // A manually constructed Incident claims 2 sourceIds, but the actual member events
    // only carry one distinct source.id between them — the rule should not be fooled by
    // a mismatched/malformed Incident.
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
    ];
    const incident = makeIncident({ eventIds: ['a', 'b'], sourceIds: ['source-a', 'source-b'] });

    const findings = applyCorroborationRule([incident], events, () => MOCK_NOW);

    expect(findings).toEqual([]);
  });

  it('skips an incident that references an event id not present in the events array, without throwing', () => {
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
    ];
    const incident = makeIncident({ eventIds: ['a', 'missing-event'], sourceIds: ['source-a', 'source-b'] });

    expect(() => applyCorroborationRule([incident], events, () => MOCK_NOW)).not.toThrow();
    expect(applyCorroborationRule([incident], events, () => MOCK_NOW)).toEqual([]);
  });
});

describe('applyCorroborationRule — multiple incidents', () => {
  it('produces exactly one finding per corroborated incident, skipping non-corroborated ones', () => {
    const events = [
      makeEvent({ id: 'a1', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
      makeEvent({ id: 'a2', source: { id: 'source-b', name: 'Source B', sourceType: 'media' } }),
      makeEvent({ id: 'b1', source: { id: 'source-c', name: 'Source C', sourceType: 'media' } }),
      makeEvent({ id: 'b2', source: { id: 'source-d', name: 'Source D', sourceType: 'media' } }),
      makeEvent({ id: 'c1', source: { id: 'source-e', name: 'Source E', sourceType: 'media' } }),
      makeEvent({ id: 'c2', source: { id: 'source-e', name: 'Source E', sourceType: 'media' } }),
    ];
    const incidents = [
      makeIncident({ id: 'incident-a', eventIds: ['a1', 'a2'], sourceIds: ['source-a', 'source-b'] }),
      makeIncident({ id: 'incident-b', eventIds: ['b1', 'b2'], sourceIds: ['source-c', 'source-d'] }),
      makeIncident({ id: 'incident-c', eventIds: ['c1', 'c2'], sourceIds: ['source-e'] }),
    ];

    const findings = applyCorroborationRule(incidents, events, () => MOCK_NOW);

    expect(findings).toHaveLength(2);
    const findingIncidentIds = findings.map((f) => f.id).sort();
    expect(findingIncidentIds).toEqual(['finding-corroboration-incident-a', 'finding-corroboration-incident-b']);
  });
});

describe('applyCorroborationRule — schema conformance', () => {
  it('every produced finding validates against AnalysisFindingSchema', () => {
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' }, severity: 'medium' }),
      makeEvent({ id: 'b', source: { id: 'source-b', name: 'Source B', sourceType: 'media' }, severity: 'high' }),
      makeEvent({ id: 'c', source: { id: 'source-c', name: 'Source C', sourceType: 'media' }, severity: 'critical' }),
      makeEvent({ id: 'd', source: { id: 'source-d', name: 'Source D', sourceType: 'media' }, severity: 'critical' }),
    ];
    const incidents = [
      makeIncident({ id: 'incident-1', eventIds: ['a', 'b'], sourceIds: ['source-a', 'source-b'] }),
      makeIncident({ id: 'incident-2', eventIds: ['c', 'd'], sourceIds: ['source-c', 'source-d'] }),
    ];

    const findings = applyCorroborationRule(incidents, events, () => MOCK_NOW);

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      const result = AnalysisFindingSchema.safeParse(finding);
      expect(result.success).toBe(true);
    }
  });
});

describe('applyCorroborationRule — expiresAt', () => {
  it('sets expiresAt after generatedAt', () => {
    const events = [
      makeEvent({ id: 'a', source: { id: 'source-a', name: 'Source A', sourceType: 'media' } }),
      makeEvent({ id: 'b', source: { id: 'source-b', name: 'Source B', sourceType: 'media' } }),
    ];
    const incident = makeIncident();

    const findings = applyCorroborationRule([incident], events, () => MOCK_NOW);

    expect(findings[0].generatedAt).toBe(MOCK_NOW);
    expect(findings[0].expiresAt).toBeDefined();
    expect(findings[0].expiresAt! > findings[0].generatedAt).toBe(true);
  });
});

describe('applyCorroborationRule — empty input', () => {
  it('returns an empty array and does not throw when there are no incidents', () => {
    expect(() => applyCorroborationRule([], [], () => MOCK_NOW)).not.toThrow();
    expect(applyCorroborationRule([], [], () => MOCK_NOW)).toEqual([]);
  });
});
