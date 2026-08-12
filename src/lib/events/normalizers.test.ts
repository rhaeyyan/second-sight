import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  normalizeAlerts,
  normalizeTelegram,
  normalizeStrikes,
  normalizeFlights,
  normalizeDrones,
} from './normalizers';
import type { ConflictKey } from '../conflicts/types';

const THEATER: ConflictKey = 'iran-israel';

describe('Feed Normalizers', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('normalizes alerts', () => {
    const data = {
      status: 'ACTIVE',
      activeCount: 1,
      source: 'alertsua',
      lastChecked: '2024-01-01T12:00:00Z',
      alerts: [
        {
          id: 'test-1',
          time: '2024-01-01T11:59:00Z',
          type: 'MISSILE',
          threat: 'Missile Threat',
          threatOriginal: 'Missile',
          locations: ['Kyiv'],
          locationsOriginal: ['Kyiv'],
          source: 'Alerts Ukraine',
          active: true,
        },
      ],
    };

    const events = normalizeAlerts(data, THEATER);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('alert-iran-israel-test-1');
    expect(events[0].type).toBe('MISSILE_ALERT');
    expect(events[0].severity).toBe('critical');
    expect(events[0].verificationStatus).toBe('official');
  });

  it('normalizes telegram posts', () => {
    const data = {
      channels: ['Test Channel'],
      updated: '2024-01-01T12:00:00Z',
      posts: [
        {
          channel: 'testchannel',
          channelLabel: 'Test Channel',
          color: '#000',
          postId: 123,
          text: 'Something happened',
          date: '2024-01-01T11:00:00Z',
          url: 'https://t.me/testchannel/123',
        },
      ],
    };

    const events = normalizeTelegram(data, THEATER);
    expect(events).toHaveLength(1);
    expect(events[0].source.sourceType).toBe('social');
    expect(events[0].confidence).toBe('low');
  });

  it('normalizes strikes', () => {
    const data = [
      {
        id: 'strike-1',
        date: '2024-01-01T10:00:00Z',
        category: 'AIRSTRIKE',
        severity: 'critical' as const,
        title: 'Explosions heard',
        source: 'News Agency',
        url: 'https://example.com/news',
        country: 'Lebanon',
      },
    ];

    const events = normalizeStrikes(data, THEATER);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('CONFIRMED_STRIKE');
    expect(events[0].severity).toBe('critical');
    expect(events[0].region).toBe('Lebanon');
  });

  it('normalizes flights', () => {
    const data = {
      total: 10,
      military: 1,
      source: 'adsb.lol',
      updated: '2024-01-01T12:00:00Z',
      flights: [
        {
          icao24: 'abc1234',
          callsign: 'FORTE11',
          origin: 'United States',
          lat: 34.0,
          lon: 35.0,
          altitude: 40000,
          heading: 90,
          speed: 400,
          type: 'ISR Drone',
          aircraftType: 'RQ4',
          registration: '00-0000',
          description: 'Global Hawk',
          squawk: '1234',
          isMilitary: true,
          isInteresting: true,
        },
      ],
    };

    const events = normalizeFlights(data, THEATER);
    expect(events).toHaveLength(1);
    expect(events[0].location?.latitude).toBe(34.0);
    expect(events[0].location?.longitude).toBe(35.0);
    expect(events[0].severity).toBe('info');
  });

  it('normalizes drones', () => {
    const data = {
      count: 1,
      ballisticThreat: false,
      source: 'Neptun',
      updated: '2024-01-01T12:00:00Z',
      drones: [
        {
          id: 'drone-1',
          type: 'shahed',
          label: 'Shahed Drone',
          color: '#f00',
          lat: 50.0,
          lng: 30.0,
          heading: 180,
          count: 1,
          place: 'Kyiv',
          text: 'Flying south',
          time: '2024-01-01T11:30:00Z',
          confidence: 90,
          trail: [],
        },
      ],
    };

    const events = normalizeDrones(data, THEATER);
    expect(events).toHaveLength(1);
    expect(events[0].location?.latitude).toBe(50.0);
    expect(events[0].type).toBe('DRONE_TRACK');
    expect(events[0].confidence).toBe('high');
    expect(events[0].summary).toContain('Flying south');
    expect(events[0].summary).toContain('Heading: 180');
  });
});
