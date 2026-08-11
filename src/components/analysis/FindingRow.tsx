'use client';

import { useId, useState } from 'react';
import type { AnalysisFinding } from '@/lib/analysis/finding';
import type { IronsightEvent } from '@/lib/events/schema';
import { timeAgo } from '@/lib/hooks';
import { SEVERITY_COLORS } from '@/components/feed/utils';
import { RULE_LABELS, expiresIn } from './utils';

interface FindingRowProps {
  finding: AnalysisFinding;
  /** Evidence events resolved from the live store — may be a subset of
   *  finding.evidenceEventIds if some have aged out of the bounded ring buffer. */
  evidenceEvents: readonly IronsightEvent[];
}

/**
 * Deliberately quieter than FeedTable's severity treatment: a small unfilled swatch and
 * plain-weight text, not a bordered/filled pill — findings are hedged assessments, not
 * confirmed alerts (CLAUDE.md: "false certainty is a real harm"), so the visual weight
 * stays below AlertsPanel's actually-confirmed threat styling.
 */
export default function FindingRow({ finding, evidenceEvents }: FindingRowProps) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const color = SEVERITY_COLORS[finding.severity];
  const foundCount = evidenceEvents.length;
  const totalCount = finding.evidenceEventIds.length;

  return (
    <div className="data-row">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full text-left flex items-start gap-2"
      >
        <span
          className="w-2 h-2 rounded-sm shrink-0 mt-1"
          style={{ background: color }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] text-[var(--text-secondary)]">
              ASSESSED: {finding.severity.toUpperCase()}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)]">
              {RULE_LABELS[finding.ruleId] ?? finding.ruleId}
            </span>
          </div>
          <div className="text-[11px] text-[var(--text-primary)] mt-0.5">{finding.title}</div>
          <div className="text-[9px] text-[var(--text-secondary)] mt-0.5">
            {totalCount} evidence event{totalCount === 1 ? '' : 's'}
            {foundCount < totalCount ? ` (${foundCount} in current buffer)` : ''}
            {' · '}
            {timeAgo(new Date(finding.generatedAt).toISOString())}
          </div>
        </div>
      </button>

      {expanded && (
        <div id={detailId} className="mt-2 pl-4 space-y-2">
          <p className="text-[10px] text-[var(--text-primary)]">{finding.explanation}</p>

          <ul className="list-disc pl-4 space-y-0.5">
            {finding.limitations.map((limitation) => (
              <li key={limitation} className="text-[9px] text-[var(--text-secondary)]">
                {limitation}
              </li>
            ))}
          </ul>

          {finding.expiresAt !== undefined && (
            <div className="text-[9px] text-[var(--text-secondary)]">{expiresIn(finding.expiresAt)}</div>
          )}

          <div className="space-y-1">
            {evidenceEvents.map((event) => {
              const evidenceColor = SEVERITY_COLORS[event.severity];
              return (
                <div key={event.id} className="flex items-center gap-2 text-[9px]">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: evidenceColor }}
                    aria-hidden="true"
                  />
                  <span className="text-[var(--text-secondary)] whitespace-nowrap">
                    {timeAgo(new Date(event.reportedAt).toISOString())}
                  </span>
                  <span className="text-[var(--text-secondary)] whitespace-nowrap">{event.source.name}</span>
                  {event.url ? (
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--text-primary)] hover:underline hover:text-[var(--cyan)] truncate"
                    >
                      {event.title}
                    </a>
                  ) : (
                    <span className="text-[var(--text-primary)] truncate">{event.title}</span>
                  )}
                </div>
              );
            })}
            {foundCount < totalCount && (
              <div className="text-[9px] text-[var(--text-secondary)] italic">
                {totalCount - foundCount} evidence event{totalCount - foundCount === 1 ? '' : 's'} no longer in
                buffer
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
