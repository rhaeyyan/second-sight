import type { Incident } from '../incident';
import type { AnalysisFinding } from '../finding';
import type { EventSeverity, IronsightEvent } from '@/lib/events/schema';

export const CORROBORATION_RULE_ID = 'corroboration';

// Findings age out (draft-implementation-plan.md §4 — "findings must age out"). 24h is a
// deliberate default, not a measured one: corroboration is a signal about a *cluster of
// reports*, and the underlying story keeps developing (more sources join, or the initial
// read turns out wrong) well within a day. Past that window the finding is stale enough
// that re-running the rule against fresh events is more trustworthy than the cached one.
const FINDING_TTL_MS = 24 * 60 * 60 * 1000;

// Mirrors EventSeveritySchema's enum order (src/lib/events/schema.ts) — kept local rather
// than derived, since severity ranking is a rule-specific interpretation of the schema,
// not a property the schema itself asserts.
const SEVERITY_RANK: Record<EventSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxSeverity(events: IronsightEvent[]): EventSeverity {
  let max: EventSeverity = 'info';
  for (const event of events) {
    if (SEVERITY_RANK[event.severity] > SEVERITY_RANK[max]) max = event.severity;
  }
  return max;
}

/**
 * Corroboration rule (draft-implementation-plan.md §4, Phase 3): flags incidents where
 * clustering grouped reports from at least two *distinct* sources. clusterEvents already
 * groups by textual/temporal similarity (see incident.ts), and Incident.sourceIds is
 * derived from that clustering — but this rule re-derives distinct source count from the
 * member events themselves rather than trusting `incident.sourceIds` at face value, since
 * a caller could hand-construct (or a future refactor could desync) an Incident whose
 * `sourceIds` doesn't match its `eventIds`. A single outlet posting two updates about the
 * same thing is a near miss, not corroboration — clustering alone isn't independent
 * confirmation, distinct sources are what makes it that.
 *
 * Deliberately hedged, per the plan's "analysis output is hedged, never asserted": this
 * rule never claims two sources reported the *same* event, only that they reported
 * similar-enough content close together in time — the same conservatism incident.ts's
 * clustering already leans on (false negatives over false positives).
 */
export function applyCorroborationRule(
  incidents: Incident[],
  events: IronsightEvent[],
  now: () => number = Date.now
): AnalysisFinding[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const findings: AnalysisFinding[] = [];
  const generatedAt = now();

  for (const incident of incidents) {
    const members: IronsightEvent[] = [];
    let missingEvent = false;
    for (const eventId of incident.eventIds) {
      const event = eventsById.get(eventId);
      if (!event) {
        missingEvent = true;
        break;
      }
      members.push(event);
    }
    // Can't compute severity (or trust the incident) without every member event —
    // skip rather than throw, since this "shouldn't normally happen" but bad input
    // from a hand-built Incident must never crash the correlation engine.
    if (missingEvent) continue;

    const distinctSourceIds = new Set(members.map((event) => event.source.id));
    if (distinctSourceIds.size < 2) continue;

    findings.push({
      id: `finding-corroboration-${incident.id}`,
      ruleId: CORROBORATION_RULE_ID,
      title: `Possible corroborated event (${distinctSourceIds.size} independent sources)`,
      severity: maxSeverity(members),
      evidenceEventIds: incident.eventIds,
      explanation:
        `${distinctSourceIds.size} independent sources reported similar content in the ` +
        `${incident.theater} theater between ${new Date(incident.firstReportedAt).toISOString()} ` +
        `and ${new Date(incident.lastReportedAt).toISOString()}, close enough in time and wording ` +
        'to be automatically clustered as the same underlying story.',
      limitations: [
        'Corroboration here is based on textual and temporal similarity from clustering, not ' +
          'confirmed shared ground truth — independent sources can coincidentally cover unrelated ' +
          'events that happen to read similarly.',
        'Clustering itself is deliberately conservative but not infallible: it can over-group ' +
          'distinct real-world incidents that happen to share timing and phrasing, or under-group ' +
          'reports of the same incident that are worded differently (see incident.ts).',
      ],
      generatedAt,
      expiresAt: generatedAt + FINDING_TTL_MS,
    });
  }

  return findings;
}
