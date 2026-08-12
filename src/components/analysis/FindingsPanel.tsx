'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventStore } from '@/lib/events/eventStore';
import { useFindings } from '@/lib/analysis/useFindings';
import { CORROBORATION_RULE_ID } from '@/lib/analysis/rules/corroboration';
import { SENSOR_NARRATIVE_CORRELATION_RULE_ID } from '@/lib/analysis/rules/sensorNarrativeCorrelation';
import { ESCALATION_PATTERN_RULE_ID } from '@/lib/analysis/rules/escalationPattern';
import FindingRow from './FindingRow';

interface FindingsPanelProps {
  /** The live EventStore backing useUnifiedFeed — findings resolve their evidence
   *  against this directly, independent of UnifiedFeed's own paused display snapshot. */
  store: EventStore;
  /** Forwarded to useFindings; only overridden in tests. */
  interval?: number;
  /** Callback fired when an evidence event is clicked to cross-link to the feed */
  onEvidenceClick?: (eventId: string) => void;
}

const ANNOUNCEMENT_CLEAR_MS = 1000;

export default function FindingsPanel({ store, interval, onEvidenceClick }: FindingsPanelProps) {
  const { findings } = useFindings({ store, interval });

  // Tracks the id set as of the last render, so the panel's first render (the initial
  // synchronous computation — see useFindings) establishes a silent baseline instead of
  // announcing every pre-existing finding as "new"; only genuine arrivals after that do.
  const previousIdsRef = useRef<Set<string> | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const currentIds = new Set(findings.map((finding) => finding.id));

    if (previousIdsRef.current === null) {
      previousIdsRef.current = currentIds;
      return;
    }

    const newCount = [...currentIds].filter((id) => !previousIdsRef.current!.has(id)).length;
    previousIdsRef.current = currentIds;
    if (newCount === 0) return;

    setAnnouncement(`${newCount} new finding${newCount === 1 ? '' : 's'}`);
    const timeoutId = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_CLEAR_MS);
    return () => clearTimeout(timeoutId);
  }, [findings]);

  const counts = useMemo(() => {
    let corroboration = 0;
    let sensorNarrative = 0;
    let escalation = 0;
    for (const finding of findings) {
      if (finding.ruleId === CORROBORATION_RULE_ID) corroboration++;
      else if (finding.ruleId === SENSOR_NARRATIVE_CORRELATION_RULE_ID) sensorNarrative++;
      else if (finding.ruleId === ESCALATION_PATTERN_RULE_ID) escalation++;
    }
    return { corroboration, sensorNarrative, escalation };
  }, [findings]);

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header">
        <span className="status-dot" />
        <span className="shrink-0">ANALYSIS FINDINGS</span>
        <span className="ml-auto text-[9px] text-[var(--text-secondary)] font-normal normal-case tracking-normal">
          {findings.length} active
        </span>
      </div>

      {/* Live region: summarized counts only, never per-item text, never assertive —
          assertive is reserved for the dedicated air-raid alert feed. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-panel-header)]">
        <div className="text-center">
          <div className="text-sm font-bold text-[var(--text-primary)]">{counts.corroboration}</div>
          <div className="text-[8px] text-[var(--text-secondary)]">CORROBORATED</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-[var(--text-primary)]">{counts.sensorNarrative}</div>
          <div className="text-[8px] text-[var(--text-secondary)]">SENSOR-NARR</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-[var(--text-primary)]">{counts.escalation}</div>
          <div className="text-[8px] text-[var(--text-secondary)]">ESCALATION</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {findings.length === 0 ? (
          <div className="p-4 text-center text-[var(--text-secondary)] text-xs">
            No correlated findings in the current buffer.
          </div>
        ) : (
          findings.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              evidenceEvents={store.getByIds(finding.evidenceEventIds)}
              onEvidenceClick={onEvidenceClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
