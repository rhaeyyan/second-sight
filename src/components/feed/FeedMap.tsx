'use client';

import { useEffect, useRef, useState } from 'react';
import type { IronsightEvent } from '@/lib/events/schema';
import { timeAgo } from '@/lib/hooks';
import { escapeHtml } from './utils';

// Same dynamic-Leaflet-import pattern as ConflictMap.tsx: a module-scope binding populated
// once the browser-only `leaflet` package resolves, plus a `mounted` flag components key
// their rendering off of. This map is intentionally much smaller than ConflictMap — it only
// plots this feed's own events with a `location`, nothing else.
let L: typeof import('leaflet') | null = null;

interface FeedMapProps {
  events: readonly IronsightEvent[];
  center: [number, number];
  zoom: number;
}

export default function FeedMap({ events, center, zoom }: FeedMapProps) {
  const [mounted, setMounted] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    import('leaflet').then((leaflet) => {
      L = leaflet;
      setMounted(true);
    });
  }, []);

  useEffect(() => {
    if (!mounted || !L) return;
    const container = document.getElementById('feed-map');
    if (!container || mapRef.current) return;

    const map = L.map('feed-map', { center, zoom, zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // center/zoom seed the initial view only; this effect is guarded to run once per mount
    // (bails if mapRef.current is already set) — same convention as ConflictMap.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    if (!L || !layerRef.current) return;
    layerRef.current.clearLayers();

    events.forEach((event) => {
      if (!event.location) return;
      const marker = L!.circleMarker([event.location.latitude, event.location.longitude], {
        radius: 6,
        color: '#ff6600',
        fillColor: '#ff6600',
        fillOpacity: 0.6,
        weight: 1,
      });
      marker.bindPopup(`
        <div style="font-family:monospace;font-size:11px;color:#000;min-width:180px;max-width:260px;">
          <strong>${escapeHtml(event.title)}</strong><br/>
          Severity: ${escapeHtml(event.severity)}<br/>
          <em style="color:#666;font-size:9px;">${escapeHtml(timeAgo(new Date(event.reportedAt).toISOString()))}</em>
        </div>
      `);
      layerRef.current!.addLayer(marker);
    });
  }, [events]);

  const withLocation = events.filter((event) => event.location).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <p className="px-2 py-1 text-[9px] text-[var(--text-secondary)]">
        {withLocation} of {events.length} events have map coordinates
      </p>
      <div className="relative flex-1 min-h-0">
        {!mounted ? (
          <div className="loading-shimmer w-full h-full" />
        ) : (
          <div id="feed-map" className="w-full h-full" />
        )}
      </div>
    </div>
  );
}
