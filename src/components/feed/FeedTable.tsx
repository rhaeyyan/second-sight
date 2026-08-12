'use client';

import type { IronsightEvent } from '@/lib/events/schema';
import { timeAgo, useTick } from '@/lib/hooks';
import { SEVERITY_COLORS, isRtlLanguage } from './utils';

interface FeedTableProps {
  events: readonly IronsightEvent[];
  /** Adds a Theater column. Off by default — meaningless (and just noise) when only one
   *  theater's events are ever shown, so callers only pass this when cross-theater
   *  viewing is active. */
  showTheater?: boolean;
  /** Set of event IDs that should be briefly highlighted (e.g. when clicked in FindingsPanel) */
  highlightedIds?: Set<string>;
  loading?: boolean;
}

import { useEffect, useState } from 'react';

/**
 * Real `<table>` markup (caption/thead/th scope="col") rather than a div-grid — the plan's
 * Map/Table parity requirement means this needs to be a genuinely usable table for screen
 * reader and keyboard users, not a visual approximation of one.
 */
export default function FeedTable({ events, showTheater = false, highlightedIds, loading = false }: FeedTableProps) {
  useTick(15000);
  
  const [prevEvents, setPrevEvents] = useState(events);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  if (events !== prevEvents) {
    const prevIds = new Set(prevEvents.map(e => e.id));
    const currentNew = new Set(events.filter(e => !prevIds.has(e.id)).map(e => e.id));
    setPrevEvents(events);
    if (prevEvents.length > 0) {
      setNewIds(currentNew);
    }
  }

  useEffect(() => {
    if (!highlightedIds || highlightedIds.size === 0) return;
    
    // Slight delay to ensure DOM has updated with the data-highlighted attributes
    const timeout = setTimeout(() => {
      const firstHighlighted = document.querySelector('tr[data-highlighted="true"]');
      if (firstHighlighted) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        firstHighlighted.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      }
    }, 0);
    
    return () => clearTimeout(timeout);
  }, [highlightedIds]);

  if (loading && events.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-left border-collapse">
          <caption className="sr-only">Loading unified feed events</caption>
          <thead>
            <tr className="sticky top-0 z-10 bg-[var(--bg-panel-header)] text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
              <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Time</th>
              <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Severity</th>
              <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Type</th>
              <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Source</th>
              {showTheater && <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Theater</th>}
              <th scope="col" className="px-2 py-1.5 font-normal">Title</th>
            </tr>
          </thead>
          <tbody>
            {[...Array(8)].map((_, i) => (
              <tr key={i} className="data-row align-top">
                <td className="px-2 py-1.5"><div className="loading-shimmer h-3 w-12 rounded" /></td>
                <td className="px-2 py-1.5"><div className="loading-shimmer h-4 w-16 rounded" /></td>
                <td className="px-2 py-1.5"><div className="loading-shimmer h-3 w-20 rounded" /></td>
                <td className="px-2 py-1.5"><div className="loading-shimmer h-3 w-16 rounded" /></td>
                {showTheater && <td className="px-2 py-1.5"><div className="loading-shimmer h-3 w-14 rounded" /></td>}
                <td className="px-2 py-1.5"><div className="loading-shimmer h-3 w-3/4 rounded" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-4 text-center text-[var(--text-secondary)] text-xs">
        No events match the current filters
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-left border-collapse">
        <caption className="sr-only">Unified intelligence feed events, most recent first</caption>
        <thead>
          <tr className="sticky top-0 z-10 bg-[var(--bg-panel-header)] text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
            <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Time</th>
            <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Severity</th>
            <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Type</th>
            <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Source</th>
            {showTheater && <th scope="col" className="px-2 py-1.5 font-normal whitespace-nowrap">Theater</th>}
            <th scope="col" className="px-2 py-1.5 font-normal">Title</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const color = SEVERITY_COLORS[event.severity];
            const isHighlighted = highlightedIds?.has(event.id) ?? false;
            const isNew = newIds.has(event.id);
            return (
              <tr 
                key={event.id} 
                className={`data-row align-top ${isNew ? 'feed-row-enter' : ''}`}
                data-highlighted={isHighlighted}
              >
                <td className="px-2 py-1.5 text-[9px] text-[var(--text-secondary)] whitespace-nowrap">
                  {timeAgo(new Date(event.reportedAt).toISOString())}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ color, backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
                  >
                    {event.severity.toUpperCase()}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-[10px] text-[var(--text-primary)] whitespace-nowrap">
                  {event.type}
                </td>
                <td className="px-2 py-1.5 text-[10px] text-[var(--text-secondary)] whitespace-nowrap">
                  {event.source.name}
                </td>
                {showTheater && (
                  <td className="px-2 py-1.5 text-[9px] text-[var(--text-secondary)] whitespace-nowrap">
                    {event.theater}
                  </td>
                )}
                <td className="px-2 py-1.5 text-[11px] text-[var(--text-primary)]">
                  {event.url ? (
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline hover:text-[var(--cyan)]"
                    >
                      {event.title}
                    </a>
                  ) : (
                    event.title
                  )}
                  {event.originalTitle && (
                    <div
                      lang={event.originalLanguage}
                      dir={isRtlLanguage(event.originalLanguage) ? 'rtl' : 'ltr'}
                      className="text-[9px] text-[var(--text-secondary)] mt-0.5"
                    >
                      {event.originalTitle}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
