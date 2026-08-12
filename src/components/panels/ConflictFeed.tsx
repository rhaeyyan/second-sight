'use client';

import { useConflictFeed, timeAgo, useTick } from '@/lib/hooks';
import type { IronsightEvent } from '@/lib/events/schema';
import { isRtlLanguage } from '../feed/utils';

const TYPE_COLORS: Record<string, string> = {
  STRIKE: 'var(--red)',
  DEFENSE: 'var(--green)',
  MILITARY: 'var(--amber)',
  DIPLOMATIC: 'var(--blue)',
  NUCLEAR: 'var(--purple)',
  REPORT: 'var(--text-secondary)',
};

export default function ConflictFeed() {
  const { data: rawEvents, loading } = useConflictFeed<IronsightEvent[]>('/api/conflicts', 180000);
  useTick(15000);

  // Sort most recent first
  const events = rawEvents ? [...rawEvents].sort((a, b) => b.reportedAt - a.reportedAt) : null;

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header">
        <span className="status-dot" style={{ background: 'var(--red)' }} />
        CONFLICT MONITOR
        <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-normal normal-case tracking-normal">
          {events?.length || 0} events
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="loading-shimmer h-14 rounded" />
            ))}
          </div>
        ) : events?.length === 0 ? (
          <div className="p-4 text-center text-[var(--text-secondary)] text-xs">
            No recent conflict events reported
          </div>
        ) : (
          events?.map((event, i) => {
            const color = TYPE_COLORS[event.type] || TYPE_COLORS.REPORT;
            return (
              <div key={i} className="data-row">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      color,
                      backgroundColor: `${color}15`,
                      border: `1px solid ${color}30`,
                    }}
                  >
                    {event.type}
                  </span>
                  <span className="text-[9px] text-[var(--text-secondary)]">
                    {event.region}
                  </span>
                  <span className="text-[9px] text-[var(--text-secondary)] ml-auto">
                    {timeAgo(new Date(event.reportedAt))}
                  </span>
                </div>
                <p className="text-[11px] leading-tight text-[var(--text-primary)]">
                  {event.title}
                </p>
                {event.originalTitle && (
                  <div
                    lang={event.originalLanguage}
                    dir={isRtlLanguage(event.originalLanguage) ? 'rtl' : 'ltr'}
                    className="text-[9px] text-[var(--text-secondary)] mt-0.5"
                  >
                    {event.originalTitle}
                  </div>
                )}
                <span className="text-[8px] text-[var(--text-secondary)]">
                  via {event.source.name}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
