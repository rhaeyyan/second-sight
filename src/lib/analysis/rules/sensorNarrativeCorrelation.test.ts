import { describe, it, expect } from 'vitest';
import {
  SENSOR_NARRATIVE_CORRELATION_RULE_ID,
  applySensorNarrativeCorrelationRule,
} from './sensorNarrativeCorrelation';
import { AnalysisFindingSchema } from '../finding';
import type { IronsightEvent } from '@/lib/events/schema';

// Fixed epoch rather than Date.now() — deterministic fixtures, same pattern as
// incident.test.ts, finding.test.ts, and corroboration.test.ts.
const MOCK_NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

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

function makeSensorEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return makeEvent({
    id: 'sensor-1',
    source: { id: 'nasa-firms', name: 'NASA FIRMS VIIRS', sourceType: 'sensor' },
    type: 'THERMAL_ANOMALY',
    severity: 'medium',
    confidence: 'low',
    verificationStatus: 'unverified',
    title: 'Thermal anomaly detected (medium intensity)',
    location: { latitude: 32.1, longitude: 34.8, precision: 'exact' },
    ...overrides,
  });
}

function makeNarrativeEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return makeEvent({
    id: 'narrative-1',
    source: { id: 'google-news-conflict-iran-israel', name: 'Google News', sourceType: 'media' },
    type: 'STRIKE',
    severity: 'high',
    confidence: 'medium',
    verificationStatus: 'single-source',
    title: 'Airstrike reported near border town',
    region: 'Tel Aviv',
    ...overrides,
  });
}

describe('applySensorNarrativeCorrelationRule — true positives', () => {
  it('correlates a thermal sensor detection and a reported strike in the same theater within the window', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ reportedAt: MOCK_NOW + 20 * MINUTE });

    const findings = applySensorNarrativeCorrelationRule([sensor, narrative], {}, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.ruleId).toBe(SENSOR_NARRATIVE_CORRELATION_RULE_ID);
    expect(finding.evidenceEventIds.sort()).toEqual(['narrative-1', 'sensor-1'].sort());
    expect(finding.limitations.length).toBeGreaterThanOrEqual(3);
    // Higher of medium (sensor) and high (narrative) is high.
    expect(finding.severity).toBe('high');
    expect(finding.generatedAt).toBe(MOCK_NOW);
    expect(finding.expiresAt).toBe(MOCK_NOW + 6 * HOUR);
  });

  it('picks the sensor event severity when it is higher than the narrative event severity', () => {
    const sensor = makeSensorEvent({ severity: 'critical', reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ severity: 'medium', reportedAt: MOCK_NOW + 10 * MINUTE });

    const findings = applySensorNarrativeCorrelationRule([sensor, narrative], {}, () => MOCK_NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });
});

describe('applySensorNarrativeCorrelationRule — near misses', () => {
  it('does not correlate a sensor and narrative event in different theaters', () => {
    const sensor = makeSensorEvent({ theater: 'iran-israel', reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ theater: 'russia-ukraine', reportedAt: MOCK_NOW + 10 * MINUTE });

    expect(applySensorNarrativeCorrelationRule([sensor, narrative], {}, () => MOCK_NOW)).toEqual([]);
  });

  it('does not correlate a sensor event against a non-kinetic narrative event (REPORT)', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const nonKinetic = makeEvent({
      id: 'report-1',
      type: 'REPORT',
      reportedAt: MOCK_NOW + 10 * MINUTE,
      source: { id: 'google-news-conflict-iran-israel', name: 'Google News', sourceType: 'media' },
    });

    expect(applySensorNarrativeCorrelationRule([sensor, nonKinetic], {}, () => MOCK_NOW)).toEqual([]);
  });

  it('does not correlate a sensor event against a non-kinetic narrative event (DIPLOMATIC)', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const diplomatic = makeNarrativeEvent({ id: 'diplomatic-1', type: 'DIPLOMATIC', reportedAt: MOCK_NOW + 10 * MINUTE });

    expect(applySensorNarrativeCorrelationRule([sensor, diplomatic], {}, () => MOCK_NOW)).toEqual([]);
  });

  it('does not correlate two sensor events, or two narrative events, with each other', () => {
    const sensorA = makeSensorEvent({ id: 'sensor-a', reportedAt: MOCK_NOW });
    const sensorB = makeSensorEvent({ id: 'sensor-b', reportedAt: MOCK_NOW + 5 * MINUTE });
    const narrativeA = makeNarrativeEvent({ id: 'narrative-a', reportedAt: MOCK_NOW });
    const narrativeB = makeNarrativeEvent({ id: 'narrative-b', reportedAt: MOCK_NOW + 5 * MINUTE });

    const findings = applySensorNarrativeCorrelationRule(
      [sensorA, sensorB, narrativeA, narrativeB],
      {},
      () => MOCK_NOW
    );

    // Only cross sensor<->narrative pairs should correlate: 2 sensors x 2 narratives = 4 pairs.
    expect(findings).toHaveLength(4);
    for (const f of findings) {
      const sensorIds = new Set(['sensor-a', 'sensor-b']);
      const narrativeIds = new Set(['narrative-a', 'narrative-b']);
      const hasSensor = f.evidenceEventIds.some((id) => sensorIds.has(id));
      const hasNarrative = f.evidenceEventIds.some((id) => narrativeIds.has(id));
      expect(hasSensor).toBe(true);
      expect(hasNarrative).toBe(true);
    }
  });
});

describe('applySensorNarrativeCorrelationRule — stale events', () => {
  it('does not correlate events 3 hours apart using the default 1h window', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ reportedAt: MOCK_NOW + 3 * HOUR });

    expect(applySensorNarrativeCorrelationRule([sensor, narrative], {}, () => MOCK_NOW)).toEqual([]);
  });

  it('respects a custom windowMs option', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ reportedAt: MOCK_NOW + 3 * HOUR });

    expect(
      applySensorNarrativeCorrelationRule([sensor, narrative], { windowMs: 1 * HOUR }, () => MOCK_NOW)
    ).toEqual([]);
    expect(
      applySensorNarrativeCorrelationRule([sensor, narrative], { windowMs: 4 * HOUR }, () => MOCK_NOW)
    ).toHaveLength(1);
  });
});

describe('applySensorNarrativeCorrelationRule — sensor and narrative type coverage', () => {
  it('correlates a POSSIBLE_EXPLOSION sensor event, not just THERMAL_ANOMALY', () => {
    const sensor = makeSensorEvent({ type: 'POSSIBLE_EXPLOSION', reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ reportedAt: MOCK_NOW + 10 * MINUTE });

    const findings = applySensorNarrativeCorrelationRule([sensor, narrative], {}, () => MOCK_NOW);
    expect(findings).toHaveLength(1);
  });

  it('correlates a DRONE narrative event, not just STRIKE', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ type: 'DRONE', reportedAt: MOCK_NOW + 10 * MINUTE });

    const findings = applySensorNarrativeCorrelationRule([sensor, narrative], {}, () => MOCK_NOW);
    expect(findings).toHaveLength(1);
  });
});

describe('applySensorNarrativeCorrelationRule — deduplication', () => {
  it('produces exactly one finding per distinct qualifying pair, no doubles', () => {
    const sensor = makeSensorEvent({ id: 'sensor-1', reportedAt: MOCK_NOW });
    const narrativeA = makeNarrativeEvent({ id: 'narrative-a', reportedAt: MOCK_NOW + 5 * MINUTE });
    const narrativeB = makeNarrativeEvent({ id: 'narrative-b', type: 'DRONE', reportedAt: MOCK_NOW + 10 * MINUTE });

    const findings = applySensorNarrativeCorrelationRule(
      [sensor, narrativeA, narrativeB],
      {},
      () => MOCK_NOW
    );

    // sensor-1 qualifies against both narrative-a and narrative-b: 2 distinct pairs.
    expect(findings).toHaveLength(2);
    const pairKeys = findings.map((f) => f.evidenceEventIds.sort().join('|'));
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });

  it('does not double-count the same pair regardless of array order', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ reportedAt: MOCK_NOW + 10 * MINUTE });

    // Narrative listed before sensor — order in the input array must not matter.
    const findings = applySensorNarrativeCorrelationRule([narrative, sensor], {}, () => MOCK_NOW);
    expect(findings).toHaveLength(1);
  });
});

describe('applySensorNarrativeCorrelationRule — schema conformance', () => {
  it('every produced finding validates against AnalysisFindingSchema', () => {
    const sensor = makeSensorEvent({ reportedAt: MOCK_NOW });
    const narrative = makeNarrativeEvent({ reportedAt: MOCK_NOW + 10 * MINUTE });

    const findings = applySensorNarrativeCorrelationRule([sensor, narrative], {}, () => MOCK_NOW);

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      const result = AnalysisFindingSchema.safeParse(finding);
      expect(result.success).toBe(true);
    }
  });
});

describe('applySensorNarrativeCorrelationRule — empty input', () => {
  it('returns an empty array for no events, and does not throw', () => {
    expect(() => applySensorNarrativeCorrelationRule([], {}, () => MOCK_NOW)).not.toThrow();
    expect(applySensorNarrativeCorrelationRule([], {}, () => MOCK_NOW)).toEqual([]);
  });

  it('defaults the clock to Date.now when no now function is provided', () => {
    expect(applySensorNarrativeCorrelationRule([])).toEqual([]);
  });
});
