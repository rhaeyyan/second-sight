'use client';

import type { IronsightEvent } from '@/lib/events/schema';
import { timeAgo } from '@/lib/hooks';
import { SEVERITY_COLORS, isRtlLanguage } from './utils';

interface FeedTableProps {
  events: readonly IronsightEvent[];
  /** Adds a Theater column. Off by default — meaningless (and just noise) when only one
   *  theater's events are ever shown, so callers only pass this when cross-theater
   *  viewing is active. */
  showTheater?: boolean;
}

/**
 * Real `<table>` markup (caption/thead/th scope="col") rather than a div-grid — the plan's
 * Map/Table parity requirement means this needs to be a genuinely usable table for screen
 * reader and keyboard users, not a visual approximation of one.
 */
export default function FeedTable({ events, showTheater = false }: FeedTableProps) {
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
            return (
              <tr key={event.id} className="data-row align-top">
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
