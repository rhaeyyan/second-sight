import { describe, it, expect } from 'vitest';
import { AnalysisFindingSchema } from './finding';

const MOCK_NOW = 1_760_000_000_000;

const validFinding = {
  id: 'finding-1',
  ruleId: 'corroboration',
  title: 'Possible corroborated event near Tehran',
  severity: 'high',
  evidenceEventIds: ['a', 'b'],
  explanation: 'Two independent sources reported similar content within a short window.',
  limitations: ['Based on textual and temporal similarity, not confirmed shared ground truth.'],
  generatedAt: MOCK_NOW,
};

describe('AnalysisFindingSchema — valid payloads', () => {
  it('accepts a well-formed finding', () => {
    expect(AnalysisFindingSchema.safeParse(validFinding).success).toBe(true);
  });

  it('accepts a finding with expiresAt set', () => {
    const result = AnalysisFindingSchema.safeParse({ ...validFinding, expiresAt: MOCK_NOW + 60_000 });
    expect(result.success).toBe(true);
  });

  it('accepts a finding with no expiresAt — findings may legitimately not set one', () => {
    const result = AnalysisFindingSchema.safeParse(validFinding);
    expect(result.success).toBe(true);
    expect(result.data?.expiresAt).toBeUndefined();
  });
});

describe('AnalysisFindingSchema — malformed payloads', () => {
  it('rejects an empty evidenceEventIds array — every finding must expose its evidence', () => {
    const result = AnalysisFindingSchema.safeParse({ ...validFinding, evidenceEventIds: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an empty limitations array — every finding must expose its limitations', () => {
    const result = AnalysisFindingSchema.safeParse({ ...validFinding, limitations: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid severity enum value', () => {
    const result = AnalysisFindingSchema.safeParse({ ...validFinding, severity: 'catastrophic' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required explanation', () => {
    const { explanation: _explanation, ...withoutExplanation } = validFinding;
    const result = AnalysisFindingSchema.safeParse(withoutExplanation);
    expect(result.success).toBe(false);
  });

  it('rejects an empty title', () => {
    const result = AnalysisFindingSchema.safeParse({ ...validFinding, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required generatedAt timestamp', () => {
    const { generatedAt: _generatedAt, ...withoutGeneratedAt } = validFinding;
    const result = AnalysisFindingSchema.safeParse(withoutGeneratedAt);
    expect(result.success).toBe(false);
  });
});
