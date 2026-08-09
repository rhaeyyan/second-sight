import { describe, it, expect } from 'vitest';
import { timeAgo, formatChange, formatPrice } from '@/lib/hooks';

// Offsets deliberately sit away from bucket boundaries (x.5 rather than x.0) so the
// clock advancing between the test's Date.now() and the one inside timeAgo can't flip
// a floor() and make these flake.
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('returns an empty string for missing or unparseable dates', () => {
    expect(timeAgo('')).toBe('');
    expect(timeAgo('not a date')).toBe('');
  });

  it('buckets elapsed time by magnitude', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 30 * SECOND))).toBe('just now');
    expect(timeAgo(new Date(now - 5.5 * MINUTE))).toBe('5m ago');
    expect(timeAgo(new Date(now - 3.5 * HOUR))).toBe('3h ago');
    expect(timeAgo(new Date(now - 2.5 * DAY))).toBe('2d ago');
  });

  it('treats future timestamps as elapsed, since RSS feeds publish skewed dates', () => {
    expect(timeAgo(new Date(Date.now() + 5.5 * MINUTE))).toBe('5m ago');
  });
});

describe('formatChange', () => {
  it('prefixes gains with an explicit plus', () => {
    expect(formatChange(1.5, 2.5)).toBe('+1.50 (+2.50%)');
  });

  it('leaves the minus sign to toFixed for losses', () => {
    expect(formatChange(-1.5, -2.5)).toBe('-1.50 (-2.50%)');
  });

  it('coerces absent values to zero rather than rendering NaN', () => {
    // Market feeds drop fields without warning; the ?? guard is load-bearing.
    const absent = undefined as unknown as number;
    expect(formatChange(absent, absent)).toBe('+0.00 (+0.00%)');
  });
});

describe('formatPrice', () => {
  it('groups thousands and pads to the requested precision', () => {
    expect(formatPrice(1234.5)).toBe('1,234.50');
    expect(formatPrice(1234.5678, 3)).toBe('1,234.568');
  });
});
