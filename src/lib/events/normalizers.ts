import type { IronsightEvent } from './schema';
import type { ConflictKey } from '../conflicts/types';

// ==========================================
// TYPES INLINED FROM API ROUTES
// ==========================================

export interface AlertEvent {
  id: string;
  time: string;
  type: string;
  threat: string;
  threatOriginal: string;
  locations: string[];
  locationsOriginal: string[];
  originalLanguage?: string;
  source: string;
  active: boolean;
}

export interface AlertData {
  status: string;
  activeCount: number;
  alerts: AlertEvent[];
  lastChecked: string;
  source: string;
}

export interface TelegramPost {
  channel: string;
  channelLabel: string;
  color: string;
  postId: number;
  text: string;
  date: string;
  url: string;
}

export interface TelegramData {
  posts: TelegramPost[];
  channels: string[];
  updated: string;
}

export interface StrikeEvent {
  id: string;
  date: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  source: string;
  url: string;
  country: string;
}

export interface FlightEvent {
  icao24: string;
  callsign: string;
  origin: string;
  lat: number;
  lon: number;
  altitude: number;
  heading: number;
  speed: number;
  type: string;
  aircraftType: string;
  registration: string;
  description: string;
  squawk: string;
  isMilitary: boolean;
  isInteresting: boolean;
}

export interface FlightData {
  total: number;
  military: number;
  flights: FlightEvent[];
  source: string;
  updated: string;
}

export interface DroneEvent {
  id: string;
  type: string;
  label: string;
  color: string;
  lat: number;
  lng: number;
  heading: number;
  count: number;
  place: string;
  text: string;
  time: string;
  confidence: number;
  trail: [number, number][];
}

export interface DroneData {
  drones: DroneEvent[];
  count: number;
  ballisticThreat: boolean;
  source: string | null;
  updated: string;
}

// ==========================================
// NORMALIZERS
// ==========================================

export function normalizeAlerts(data: AlertData, theater: ConflictKey): IronsightEvent[] {
  return (data.alerts || []).map((alert) => {
    const reportedAt = new Date(alert.time).getTime() || Date.now();
    return {
      id: `alert-${theater}-${alert.id}`,
      type: `${alert.type}_ALERT`,
      theater,
      reportedAt,
      ingestedAt: Date.now(),
      region: alert.locations.join(', '),
      severity: alert.active ? 'critical' : 'info',
      confidence: 'high',
      verificationStatus: 'official',
      source: {
        id: `alert-src-${alert.source.toLowerCase()}`,
        name: alert.source,
        sourceType: 'official',
      },
      title: alert.threat,
      summary: `Alert in ${alert.locations.join(', ')}`,
      originalLanguage: alert.originalLanguage,
      originalTitle: alert.threatOriginal,
      tags: ['alert', alert.type.toLowerCase()],
    };
  });
}

export function normalizeTelegram(data: TelegramData, theater: ConflictKey): IronsightEvent[] {
  return (data.posts || []).map((post) => {
    const reportedAt = new Date(post.date).getTime() || Date.now();
    return {
      id: `tg-${post.channel}-${post.postId}`,
      type: 'TELEGRAM_OSINT',
      theater,
      reportedAt,
      ingestedAt: Date.now(),
      severity: 'info',
      confidence: 'low',
      verificationStatus: 'single-source',
      source: {
        id: `tg-src-${post.channel}`,
        name: post.channelLabel || post.channel,
        url: `https://t.me/${post.channel}`,
        sourceType: 'social',
      },
      title: `Telegram update from ${post.channelLabel || post.channel}`,
      summary: post.text,
      url: post.url,
      tags: ['telegram', 'osint', post.channel],
    };
  });
}

export function normalizeStrikes(data: StrikeEvent[], theater: ConflictKey): IronsightEvent[] {
  return (data || []).map((strike) => {
    const reportedAt = new Date(strike.date).getTime() || Date.now();
    // Validate strike severity just in case
    const validSeverities = ['info', 'low', 'medium', 'high', 'critical'];
    const severity = validSeverities.includes(strike.severity) ? (strike.severity as 'info' | 'low' | 'medium' | 'high' | 'critical') : 'medium';
    
    return {
      id: `strike-${theater}-${strike.id}`,
      type: 'CONFIRMED_STRIKE',
      theater,
      reportedAt,
      ingestedAt: Date.now(),
      region: strike.country,
      severity,
      confidence: 'medium',
      verificationStatus: 'corroborated',
      source: {
        id: 'google-news-strikes',
        name: strike.source || 'Google News',
        sourceType: 'media',
      },
      title: strike.title,
      url: strike.url,
      tags: ['strike', strike.category.toLowerCase()],
    };
  });
}

export function normalizeFlights(data: FlightData, theater: ConflictKey): IronsightEvent[] {
  return (data.flights || []).map((flight) => {
    return {
      id: `flight-${theater}-${flight.icao24}-${Date.now()}`,
      type: 'MILITARY_FLIGHT',
      theater,
      reportedAt: Date.now(),
      ingestedAt: Date.now(),
      location: {
        latitude: flight.lat,
        longitude: flight.lon,
        precision: 'exact',
      },
      severity: 'info',
      confidence: 'high',
      verificationStatus: 'official',
      source: {
        id: 'adsb-lol',
        name: data.source || 'adsb.lol',
        sourceType: 'sensor',
      },
      title: `${flight.callsign || flight.aircraftType || 'Military Aircraft'} (${flight.type})`,
      summary: `Altitude: ${flight.altitude}ft | Speed: ${flight.speed}kts | Heading: ${flight.heading}°`,
      tags: ['flight', flight.origin, flight.aircraftType].filter(Boolean),
    };
  });
}

export function normalizeDrones(data: DroneData, theater: ConflictKey): IronsightEvent[] {
  return (data.drones || []).map((drone) => {
    const reportedAt = new Date(drone.time).getTime() || Date.now();
    return {
      id: `drone-${theater}-${drone.id}`,
      type: 'DRONE_TRACK',
      theater,
      reportedAt,
      ingestedAt: Date.now(),
      location: {
        latitude: drone.lat,
        longitude: drone.lng,
        precision: 'exact',
      },
      severity: drone.label.toLowerCase().includes('ballistic') ? 'critical' : 'high',
      confidence: drone.confidence > 80 ? 'high' : 'medium',
      verificationStatus: 'corroborated',
      source: {
        id: 'neptun-drones',
        name: data.source || 'Neptun',
        sourceType: 'sensor',
      },
      title: `${drone.label} Tracked`,
      summary: `${drone.text ? drone.text + '. ' : ''}Heading: ${drone.heading}°${drone.place ? ` toward ${drone.place}` : ''}`,
      tags: ['drone', drone.type],
    };
  });
}
