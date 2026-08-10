import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { timeAgo, formatChange, formatPrice, useDataFeed } from '@/lib/hooks';

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

describe('useDataFeed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the previous data when a later poll comes back empty, past the first render', async () => {
    // Regression test: fetchData used to close over `data` with only `url` in its
    // useCallback deps, so the "keep stale data on an empty response" guard always
    // compared against the initial (null) data, silently disabling itself after the
    // first render.
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 1 }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    const { result } = renderHook(() => useDataFeed<{ id: number }[]>('/api/test', 60000));

    await waitFor(() => expect(result.current.data).toEqual([{ id: 1 }]));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual([{ id: 1 }]);
  });
});
