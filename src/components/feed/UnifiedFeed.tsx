'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { UnifiedFeedState } from '@/lib/events/useUnifiedFeed';
import { useConflict } from '@/lib/conflicts/context';
import { CONFLICT_KEYS } from '@/lib/conflicts';
import { EventSeveritySchema, type EventSeverity, type IronsightEvent } from '@/lib/events/schema';
import FeedTable from './FeedTable';

// Leaflet touches `window` at import time, so only this map component gets the
// dynamic/ssr:false treatment — same pattern as page.tsx wrapping ConflictMap. Everything
// else in this tree (table, filters, controls) is plain SSR-able React.
const FeedMap = dynamic(() => import('./FeedMap'), {
  ssr: false,
  loading: () => <div className="loading-shimmer flex-1" />,
});

type SourceType = IronsightEvent['source']['sourceType'];

// Mirrors the inline `sourceType` enum in IronsightEventSchema (src/lib/events/schema.ts).
// Not exported separately there (it's nested inside the `source` object schema), so this
// list is kept in sync by hand — it's a fixed, rarely-changing set.
const SOURCE_TYPES: SourceType[] = ['official', 'media', 'social', 'sensor', 'market'];

const SEVERITIES = EventSeveritySchema.options;

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

interface FilterFieldsetProps<T extends string> {
  legend: string;
  options: readonly T[];
  selected: Set<T>;
  onToggle: (value: T) => void;
}

function FilterFieldset<T extends string>({ legend, options, selected, onToggle }: FilterFieldsetProps<T>) {
  return (
    <fieldset className="border border-[var(--border-color)] rounded px-2 py-1.5 min-w-0">
      <legend className="text-[8px] uppercase tracking-wider text-[var(--text-secondary)] px-1">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-1 text-[9px] text-[var(--text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(option)}
              onChange={() => onToggle(option)}
              className="accent-[var(--cyan)]"
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface UnifiedFeedProps {
  /** Lifted up to src/app/feed/page.tsx, which is now the sole useUnifiedFeed() caller,
   *  so FindingsPanel can share the same fetch/store instead of polling independently. */
  feedState: UnifiedFeedState;
}

export default function UnifiedFeed({ feedState }: UnifiedFeedProps) {
  const { config } = useConflict();
  const { events, loading, error, paused, togglePause, newSinceCount, allTheaters, toggleAllTheaters } = feedState;

  const [view, setView] = useState<'table' | 'map'>('table');

  // Empty set = no constraint on that facet = show everything. This is deliberate rather
  // than defaulting to "all options checked": `type` is free-form and new values can show
  // up in a later poll, and an empty-set-means-all rule needs no effect to keep a
  // "checked" set in sync as the option list grows — a freshly-arrived type is visible by
  // default instead of silently hidden until the user notices and checks it.
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedSeverities, setSelectedSeverities] = useState<Set<EventSeverity>>(new Set());
  const [selectedSourceTypes, setSelectedSourceTypes] = useState<Set<SourceType>>(new Set());
  const [selectedTheaters, setSelectedTheaters] = useState<Set<string>>(new Set());

  const availableTypes = useMemo(
    () => Array.from(new Set(events.map((event) => event.type))).sort(),
    [events],
  );

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => selectedTypes.size === 0 || selectedTypes.has(event.type))
      .filter((event) => selectedSeverities.size === 0 || selectedSeverities.has(event.severity))
      .filter((event) => selectedSourceTypes.size === 0 || selectedSourceTypes.has(event.source.sourceType))
      .filter((event) => selectedTheaters.size === 0 || selectedTheaters.has(event.theater))
      .slice()
      .sort((a, b) => b.reportedAt - a.reportedAt);
  }, [events, selectedTypes, selectedSeverities, selectedSourceTypes, selectedTheaters]);

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header flex-wrap-reverse">
        <span className={`status-dot ${paused ? 'is-paused' : ''}`} />
        <span className="shrink-0">UNIFIED FEED</span>
        <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-normal normal-case tracking-normal">
          {filteredEvents.length} of {events.length} events
        </span>
      </div>

      {/* Live region: summarized counts only, never per-item text, never assertive —
          assertive is reserved for the dedicated air-raid alert feed. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {paused && newSinceCount > 0
          ? `${newSinceCount} new event${newSinceCount === 1 ? '' : 's'} received`
          : ''}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
        <button
          type="button"
          aria-pressed={paused}
          onClick={togglePause}
          className="text-[9px] px-2 py-1 rounded border transition-colors"
          style={{
            color: paused ? 'var(--amber)' : 'var(--text-secondary)',
            borderColor: paused ? 'var(--amber)' : 'var(--border-color)',
            background: paused ? 'rgba(255,170,0,0.1)' : 'transparent',
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        {paused && newSinceCount > 0 && (
          <button
            type="button"
            onClick={togglePause}
            className="text-[9px] px-2 py-1 rounded border transition-colors"
            style={{ color: 'var(--cyan)', borderColor: 'var(--cyan)', background: 'rgba(0,212,255,0.1)' }}
          >
            Show {newSinceCount} new
          </button>
        )}

        <button
          type="button"
          aria-pressed={allTheaters}
          onClick={toggleAllTheaters}
          className="text-[9px] px-2 py-1 rounded border transition-colors"
          style={{
            color: allTheaters ? 'var(--cyan)' : 'var(--text-secondary)',
            borderColor: allTheaters ? 'var(--cyan)' : 'var(--border-color)',
            background: allTheaters ? 'rgba(0,212,255,0.1)' : 'transparent',
          }}
        >
          {allTheaters ? 'All Theaters' : 'This Theater'}
        </button>

        <div role="group" aria-label="View" className="flex gap-1 ml-auto">
          <button
            type="button"
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
            className="text-[9px] px-2 py-1 rounded border transition-colors"
            style={{
              color: view === 'table' ? 'var(--cyan)' : 'var(--text-secondary)',
              borderColor: view === 'table' ? 'var(--cyan)' : 'var(--border-color)',
              background: view === 'table' ? 'rgba(0,212,255,0.1)' : 'transparent',
            }}
          >
            Table
          </button>
          <button
            type="button"
            aria-pressed={view === 'map'}
            onClick={() => setView('map')}
            className="text-[9px] px-2 py-1 rounded border transition-colors"
            style={{
              color: view === 'map' ? 'var(--cyan)' : 'var(--text-secondary)',
              borderColor: view === 'map' ? 'var(--cyan)' : 'var(--border-color)',
              background: view === 'map' ? 'rgba(0,212,255,0.1)' : 'transparent',
            }}
          >
            Map
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-[var(--border-color)]">
        <FilterFieldset legend="Type" options={availableTypes} selected={selectedTypes}
          onToggle={(value) => setSelectedTypes((prev) => toggleInSet(prev, value))} />
        <FilterFieldset legend="Severity" options={SEVERITIES} selected={selectedSeverities}
          onToggle={(value) => setSelectedSeverities((prev) => toggleInSet(prev, value))} />
        <FilterFieldset legend="Source Type" options={SOURCE_TYPES} selected={selectedSourceTypes}
          onToggle={(value) => setSelectedSourceTypes((prev) => toggleInSet(prev, value))} />
        {allTheaters && (
          <FilterFieldset legend="Theater" options={CONFLICT_KEYS} selected={selectedTheaters}
            onToggle={(value) => setSelectedTheaters((prev) => toggleInSet(prev, value))} />
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-[10px] text-[var(--red)] border-b border-[var(--border-color)]">
          Feed error: {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="space-y-2 p-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="loading-shimmer h-10 rounded" />
          ))}
        </div>
      ) : view === 'table' ? (
        <FeedTable events={filteredEvents} showTheater={allTheaters} />
      ) : (
        <FeedMap
          events={filteredEvents}
          center={config.client.mapCenter}
          zoom={config.client.mapZoom}
          autoFitBounds={allTheaters}
        />
      )}
    </div>
  );
}
