import type { AnalysisFinding } from '../finding';
import type { EventSeverity, IronsightEvent } from '@/lib/events/schema';

export const ESCALATION_PATTERN_RULE_ID = 'escalation-pattern';

// Kinetic types this rule watches for. 'MISSILE' doesn't appear in any current adapter's
// output (googleNewsConflict classifies missile-keyword headlines as 'STRIKE') but is kept
// here for forward-compatibility per draft-implementation-plan.md's example kinetic types.
// 'POSSIBLE_EXPLOSION' is FIRMS' thermal-anomaly classification (firmsFires.ts) — a burst
// of those alongside strikes/drones is itself an escalation-relevant pattern, not just
// news coverage.
const KINETIC_TYPES = new Set(['STRIKE', 'DRONE', 'MISSILE', 'POSSIBLE_EXPLOSION']);

const HOUR_MS = 60 * 60 * 1000;

// Findings age out (draft-implementation-plan.md §4). 12h sits between corroboration's 24h
// and sensor-narrative's 6h: shorter than corroboration because an escalation pattern is
// inherently about a specific, already-passed time window (re-running against fresh events
// is more trustworthy well before a day goes by), but longer than sensor-narrative because
// this rule triangulates multiple high/critical kinetic reports rather than a single
// speculative sensor-narrative link — higher signal-to-noise, so it's allowed to persist
// a bit longer.
const FINDING_TTL_MS = 12 * HOUR_MS;

export interface EscalationPatternOptions {
  /** Time span to look for a cluster of severe events in. Default 3h. */
  windowMs?: number;
  /** Minimum count of qualifying events within the window to fire. Default 3. */
  minEventCount?: number;
}

// Mirrors EventSeveritySchema's enum order (src/lib/events/schema.ts) — kept local rather
// than derived, since severity ranking is a rule-specific interpretation of the schema,
// not a property the schema itself asserts. Same approach as corroboration.ts.
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

function isQualifying(event: IronsightEvent): boolean {
  return (event.severity === 'high' || event.severity === 'critical') && KINETIC_TYPES.has(event.type);
}

/**
 * Escalation pattern rule (draft-implementation-plan.md §4, Phase 3): flags a burst of
 * high/critical-severity kinetic events (strikes, drones, missiles, possible explosions)
 * clustered in time within a single theater — a signal that something is actively
 * escalating, distinct from corroboration (which asks "do multiple sources agree on one
 * incident?") or sensor-narrative correlation (which links a sensor hit to a nearby
 * narrative report). This rule operates directly on the raw event list, not on
 * incident.ts's clustered Incidents — deliberately, since deduplicating near-identical
 * reports is corroboration/clustering's job, not this one's (see the limitations below).
 *
 * Grouped per theater, then scanned as a sorted sliding window: greedily walk forward, and
 * once a window of `minEventCount`+ qualifying events is found starting at some event, emit
 * ONE finding for the *maximal* set of qualifying events within `windowMs` of that starting
 * event (not just the minimum), then resume scanning after the end of that group. This
 * avoids the N-choose-`minEventCount` explosion of overlapping/duplicate findings that a
 * naive "test every window" approach would produce for a single real escalation.
 *
 * Deliberately hedged, per the plan's "analysis output is hedged, never asserted": this
 * rule never claims an escalation is confirmed, only that a burst of severe reports was
 * observed — see limitations for why report volume is not the same as real-world volume.
 */
export function applyEscalationPatternRule(
  events: IronsightEvent[],
  options?: EscalationPatternOptions,
  now: () => number = Date.now
): AnalysisFinding[] {
  const windowMs = options?.windowMs ?? 3 * HOUR_MS;
  const minEventCount = options?.minEventCount ?? 3;
  const generatedAt = now();

  const qualifyingByTheater = new Map<string, IronsightEvent[]>();
  for (const event of events) {
    if (!isQualifying(event)) continue;
    const bucket = qualifyingByTheater.get(event.theater);
    if (bucket) bucket.push(event);
    else qualifyingByTheater.set(event.theater, [event]);
  }

  const findings: AnalysisFinding[] = [];

  for (const [theater, theaterEvents] of qualifyingByTheater) {
    const sorted = [...theaterEvents].sort((a, b) => a.reportedAt - b.reportedAt);

    let i = 0;
    while (i < sorted.length) {
      const windowEnd = sorted[i].reportedAt + windowMs;
      let j = i;
      // sorted ascending by reportedAt, so the qualifying window starting at i is a
      // contiguous run — once an event falls outside windowEnd, every later one does too.
      while (j < sorted.length && sorted[j].reportedAt <= windowEnd) j++;
      const group = sorted.slice(i, j);

      if (group.length >= minEventCount) {
        const firstEvent = group[0];
        const lastEvent = group[group.length - 1];
        const hours = (windowMs / HOUR_MS).toFixed(1).replace(/\.0$/, '');

        findings.push({
          id: `finding-escalation-${theater}-${firstEvent.id}`,
          ruleId: ESCALATION_PATTERN_RULE_ID,
          title: `Possible escalation pattern (${group.length} severe events in ${theater})`,
          severity: maxSeverity(group),
          evidenceEventIds: group.map((event) => event.id),
          explanation:
            `${group.length} high or critical severity kinetic events (strikes, drone activity, ` +
            `missiles, or possible explosions) were reported in the ${theater} theater within a ` +
            `${hours}-hour span, between ${new Date(firstEvent.reportedAt).toISOString()} and ` +
            `${new Date(lastEvent.reportedAt).toISOString()}.`,
          limitations: [
            'Volume of reports is not the same as volume of real events: this rule does not ' +
              'deduplicate via clustering (see incident.ts / corroboration.ts), so multiple outlets ' +
              'heavily covering a single incident can inflate the count and be double-counted as ' +
              'several separate "events" rather than one.',
            `The ${hours}-hour window is an arbitrary cutoff, not a measured escalation threshold — ` +
              'a real escalation could plausibly unfold somewhat faster or slower than this and not ' +
              'be flagged, or unrelated events could coincidentally fall inside it.',
          ],
          generatedAt,
          expiresAt: generatedAt + FINDING_TTL_MS,
        });

        i = j;
      } else {
        i++;
      }
    }
  }

  return findings;
}
