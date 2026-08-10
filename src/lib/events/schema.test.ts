import { describe, it, expect } from 'vitest';
import { IronsightEventSchema } from '@/lib/events/schema';

// A fixed epoch rather than Date.now(), so these fixtures never depend on when the
// test runs (per the generate-osint-fixtures skill's deterministic-clock rule).
const MOCK_NOW = 1_760_000_000_000;

const validEvent = {
  id: 'gn-0-1760000000000',
  source: {
    id: 'google-news',
    name: 'Reuters',
    url: 'https://reuters.com/some-article',
    sourceType: 'media',
  },
  type: 'STRIKE',
  theater: 'iran-israel',
  region: 'Tehran',
  reportedAt: MOCK_NOW - 60_000,
  ingestedAt: MOCK_NOW,
  severity: 'high',
  confidence: 'medium',
  verificationStatus: 'single-source',
  title: 'Strike reported near Tehran',
  tags: ['strike'],
};

describe('IronsightEventSchema — valid payloads', () => {
  it('accepts a well-formed event', () => {
    const result = IronsightEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('accepts an event with no location, rather than requiring fabricated coordinates', () => {
    const result = IronsightEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    expect(result.data?.location).toBeUndefined();
  });

  it('accepts a fully-populated event including optional fields', () => {
    const result = IronsightEventSchema.safeParse({
      ...validEvent,
      occurredAt: MOCK_NOW - 120_000,
      location: { latitude: 35.6892, longitude: 51.389, precision: 'regional' },
      summary: 'Multiple outlets reporting an explosion.',
      originalLanguage: 'fa',
      originalTitle: 'حمله موشکی نزدیک تهران گزارش شد',
      url: 'https://reuters.com/world/middle-east/some-article',
      relatedEventIds: ['gn-1-1760000000000'],
      rawPayload: { raw: 'unmodified feed item' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an event with no per-report url — not every source has per-item links (e.g. sensors)', () => {
    const result = IronsightEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    expect(result.data?.url).toBeUndefined();
  });

  it('accepts an event with no originalTitle — most events are never translated', () => {
    const result = IronsightEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    expect(result.data?.originalTitle).toBeUndefined();
  });
});

describe('IronsightEventSchema — malformed payloads', () => {
  it('rejects an unknown theater not in the conflict registry', () => {
    const result = IronsightEventSchema.safeParse({ ...validEvent, theater: 'atlantis' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid severity enum value', () => {
    const result = IronsightEventSchema.safeParse({ ...validEvent, severity: 'catastrophic' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required reportedAt timestamp', () => {
    const { reportedAt: _reportedAt, ...withoutReportedAt } = validEvent;
    const result = IronsightEventSchema.safeParse(withoutReportedAt);
    expect(result.success).toBe(false);
  });

  it('rejects an empty title', () => {
    const result = IronsightEventSchema.safeParse({ ...validEvent, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range latitude/longitude', () => {
    const result = IronsightEventSchema.safeParse({
      ...validEvent,
      location: { latitude: 200, longitude: 51.389, precision: 'exact' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed source url', () => {
    const result = IronsightEventSchema.safeParse({
      ...validEvent,
      source: { ...validEvent.source, url: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed per-report url', () => {
    const result = IronsightEventSchema.safeParse({ ...validEvent, url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-array tags field', () => {
    const result = IronsightEventSchema.safeParse({ ...validEvent, tags: 'strike' });
    expect(result.success).toBe(false);
  });
});
