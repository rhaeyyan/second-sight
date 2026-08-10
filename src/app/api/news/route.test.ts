import { describe, it, expect } from 'vitest';
import { isNewsRelevant, dedupeByTitle, toNewsItem } from './route';
import type { IronsightEvent } from '@/lib/events/schema';

const MOCK_NOW = 1_760_000_000_000;

// Minimal, schema-valid IronsightEvent, with per-test overrides for the fields under
// test — avoids re-deriving every required field in each test case.
function newsEvent(overrides: Partial<IronsightEvent> = {}): IronsightEvent {
  return {
    id: 'news-iran-israel-test',
    source: { id: 'news-rss-iran-israel', name: 'Example Wire', sourceType: 'media' },
    type: 'REPORT',
    theater: 'iran-israel',
    reportedAt: MOCK_NOW,
    ingestedAt: MOCK_NOW,
    severity: 'info',
    confidence: 'low',
    verificationStatus: 'single-source',
    title: 'Missile strike hits border town',
    tags: [],
    url: 'https://news.example.com/a',
    ...overrides,
  };
}

describe('isNewsRelevant', () => {
  const relevanceKeywords = /missile|strike|iran|israel/i;
  const unfilteredSources = new Set(['Times of Israel']);

  it('hard-excludes sports/entertainment noise even if it matches relevance keywords', () => {
    const event = newsEvent({ title: 'Iran wins world cup qualifier in dramatic strike of the ball' });
    expect(isNewsRelevant(event, relevanceKeywords, unfilteredSources)).toBe(false);
  });

  it('passes an item from an unfiltered source regardless of keyword match', () => {
    const event = newsEvent({ title: 'Local bakery wins award', source: { id: 'x', name: 'Times of Israel', sourceType: 'media' } });
    expect(isNewsRelevant(event, relevanceKeywords, unfilteredSources)).toBe(true);
  });

  it('passes an item whose title matches the relevance keywords', () => {
    const event = newsEvent({ title: 'Missile strike reported near border' });
    expect(isNewsRelevant(event, relevanceKeywords, unfilteredSources)).toBe(true);
  });

  it('checks the relevance keywords against the tag when the title does not match', () => {
    const event = newsEvent({ title: 'Officials issue statement', tags: ['israel'] });
    expect(isNewsRelevant(event, relevanceKeywords, unfilteredSources)).toBe(true);
  });

  it('rejects an item that matches neither noise nor relevance keywords', () => {
    const event = newsEvent({ title: 'Local weather forecast for the weekend' });
    expect(isNewsRelevant(event, relevanceKeywords, unfilteredSources)).toBe(false);
  });
});

describe('dedupeByTitle', () => {
  it('drops a later event whose title matches an earlier one after lowercasing', () => {
    const events = [
      newsEvent({ id: 'a', title: 'Missile Strike Hits Border Town' }),
      newsEvent({ id: 'b', title: 'missile strike hits border town' }),
    ];
    const result = dedupeByTitle(events);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('keeps events with distinct titles', () => {
    const events = [
      newsEvent({ id: 'a', title: 'Missile strike hits border town' }),
      newsEvent({ id: 'b', title: 'Ceasefire talks resume in Cairo' }),
    ];
    expect(dedupeByTitle(events)).toHaveLength(2);
  });
});

describe('toNewsItem', () => {
  it('maps an IronsightEvent to the legacy NewsItem shape, including the link from url', () => {
    const event = newsEvent({
      title: 'Missile strike hits border town',
      source: { id: 'x', name: 'Example Wire', sourceType: 'media' },
      reportedAt: MOCK_NOW,
      tags: ['diplomacy'],
      url: 'https://news.example.com/strike-report',
    });

    expect(toNewsItem(event)).toEqual({
      title: 'Missile strike hits border town',
      link: 'https://news.example.com/strike-report',
      source: 'Example Wire',
      pubDate: new Date(MOCK_NOW).toISOString(),
      category: 'diplomacy',
    });
  });

  it('falls back to an empty string link when the event has no url', () => {
    const event = newsEvent({ url: undefined });
    expect(toNewsItem(event).link).toBe('');
  });

  it('leaves category undefined when the event has no tags', () => {
    const event = newsEvent({ tags: [] });
    expect(toNewsItem(event).category).toBeUndefined();
  });
});
