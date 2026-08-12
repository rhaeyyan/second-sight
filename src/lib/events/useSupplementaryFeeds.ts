import { useEffect } from 'react';
import type { EventStore } from './eventStore';
import type { ConflictKey } from '../conflicts/types';
import {
  normalizeAlerts,
  normalizeTelegram,
  normalizeStrikes,
  normalizeFlights,
  normalizeDrones,
} from './normalizers';

export function useSupplementaryFeeds(store: EventStore, conflictKey: ConflictKey): void {
  useEffect(() => {
    let isMounted = true;
    
    // Helper to safely fetch, normalize, and add to store
    const pollEndpoint = async <T,>(url: string, normalizer: (data: T, key: ConflictKey) => import('./schema').IronsightEvent[]) => {
      try {
        const res = await fetch(`${url}?conflict=${conflictKey}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        
        const events = normalizer(data, conflictKey);
        if (events.length > 0) {
          store.add(events);
        }
      } catch (err) {
        // Graceful degradation: ignore network errors during polling
      }
    };

    // Initial fetch for all endpoints
    pollEndpoint('/api/alerts', normalizeAlerts);
    pollEndpoint('/api/drones', normalizeDrones);
    pollEndpoint('/api/telegram', normalizeTelegram);
    pollEndpoint('/api/strikes', normalizeStrikes);
    pollEndpoint('/api/flights', normalizeFlights);

    // Set up polling intervals
    const intervals = [
      setInterval(() => pollEndpoint('/api/alerts', normalizeAlerts), 15_000), // 15s
      setInterval(() => pollEndpoint('/api/drones', normalizeDrones), 20_000), // 20s
      setInterval(() => pollEndpoint('/api/telegram', normalizeTelegram), 60_000), // 60s
      setInterval(() => pollEndpoint('/api/strikes', normalizeStrikes), 60_000), // 60s
      setInterval(() => pollEndpoint('/api/flights', normalizeFlights), 180_000), // 180s
    ];

    return () => {
      isMounted = false;
      intervals.forEach(clearInterval);
    };
  }, [store, conflictKey]);
}
