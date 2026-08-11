import { describe, it, expect } from 'vitest';
import { expiresIn, RULE_LABELS } from './utils';

describe('expiresIn', () => {
  const now = 1_760_000_000_000;

  it('formats a sub-hour remainder in minutes', () => {
    expect(expiresIn(now + 5 * 60_000, now)).toBe('Expires in ~5m');
  });

  it('rounds down to at least 1 minute rather than showing 0m', () => {
    expect(expiresIn(now + 10_000, now)).toBe('Expires in ~1m');
  });

  it('formats a sub-day remainder in hours', () => {
    expect(expiresIn(now + 5 * 60 * 60_000, now)).toBe('Expires in ~5h');
  });

  it('formats a multi-day remainder in days', () => {
    expect(expiresIn(now + 2 * 24 * 60 * 60_000, now)).toBe('Expires in ~2d');
  });

  it('reports already-passed timestamps as expired', () => {
    expect(expiresIn(now - 1000, now)).toBe('expired');
  });
});

describe('RULE_LABELS', () => {
  it('has a label for every known rule id', () => {
    expect(RULE_LABELS['corroboration']).toBe('CORROBORATION');
    expect(RULE_LABELS['sensor-narrative-correlation']).toBe('SENSOR ↔ NARRATIVE');
    expect(RULE_LABELS['escalation-pattern']).toBe('ESCALATION PATTERN');
  });
});
