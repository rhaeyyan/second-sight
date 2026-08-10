import type { EventSeverity, IronsightEvent } from '@/lib/events/schema';
import type { AnalysisFinding } from '@/lib/analysis/finding';

export const SENSOR_NARRATIVE_CORRELATION_RULE_ID = 'sensor-narrative-correlation';

export interface SensorNarrativeCorrelationOptions {
  /** Max gap between a sensor detection and a narrative report's reportedAt. Default 1h. */
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

// Shorter-lived than corroboration findings (which live off multiple independent
// narrative sources agreeing). A sensor-narrative correlation is theater+time-only —
// no shared coordinates back it up — so it's a more speculative, more time-sensitive
// claim, and should age out of the feed faster rather than linger looking settled.
const FINDING_TTL_MS = 6 * 60 * 60 * 1000;

const SENSOR_EVENT_TYPES = new Set(['POSSIBLE_EXPLOSION', 'THERMAL_ANOMALY']);
const NARRATIVE_KINETIC_TYPES = new Set(['STRIKE', 'DRONE']);

const SEVERITY_RANK: Record<EventSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function higherSeverity(a: EventSeverity, b: EventSeverity): EventSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function isSensorEvent(event: IronsightEvent): boolean {
  return event.source.sourceType === 'sensor' && SENSOR_EVENT_TYPES.has(event.type);
}

function isNarrativeKineticEvent(event: IronsightEvent): boolean {
  return NARRATIVE_KINETIC_TYPES.has(event.type);
}

/**
 * Splits an unordered pair of events into (sensorEvent, narrativeEvent) roles when
 * exactly one of the two fills each role. Returns null for any pair that doesn't
 * qualify (both sensor, both narrative, or neither) — the caller doesn't need to
 * know which case failed, only whether the pair is eligible at all.
 */
function asSensorNarrativePair(
  a: IronsightEvent,
  b: IronsightEvent
): { sensorEvent: IronsightEvent; narrativeEvent: IronsightEvent } | null {
  if (isSensorEvent(a) && isNarrativeKineticEvent(b)) return { sensorEvent: a, narrativeEvent: b };
  if (isSensorEvent(b) && isNarrativeKineticEvent(a)) return { sensorEvent: b, narrativeEvent: a };
  return null;
}

/**
 * Cross-source correlation rule (draft-implementation-plan.md §4): flags when a
 * thermal/explosion sensor detection (NASA FIRMS) and an independently reported
 * strike/drone event (e.g. Google News) land in the same theater within a tight time
 * window. Unlike clusterEvents/Incident, this operates directly on the raw event
 * list — not every correlation rule needs the clustering step, and sensor events
 * (numeric telemetry, no headline) don't cluster meaningfully against narrative
 * events by title-similarity anyway.
 *
 * This is the most speculative of the analysis rules: sensor and narrative events
 * are matched on theater + time only, never on coordinates, because narrative events
 * carry a `region` name and sensor events carry a `location` — the two are never both
 * set on the same event (see src/lib/events/schema.ts), so there is no shared
 * spatial field to compare. See the limitations attached to each finding, and
 * firmsFires.ts's severityForIntensity doc comment for the same conservatism this
 * rule extends to a cross-source claim.
 */
export function applySensorNarrativeCorrelationRule(
  events: IronsightEvent[],
  options: SensorNarrativeCorrelationOptions = {},
  now: () => number = Date.now
): AnalysisFinding[] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const generatedAt = now();
  const findings: AnalysisFinding[] = [];

  // Iterate unordered pairs once (i < j) so the same (sensor, narrative) pair is
  // never considered twice regardless of which one appears first in `events`.
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const pair = asSensorNarrativePair(events[i], events[j]);
      if (!pair) continue;

      const { sensorEvent, narrativeEvent } = pair;
      if (sensorEvent.theater !== narrativeEvent.theater) continue;
      if (Math.abs(sensorEvent.reportedAt - narrativeEvent.reportedAt) > windowMs) continue;

      const sensorLabel = sensorEvent.type === 'POSSIBLE_EXPLOSION' ? 'possible-explosion' : 'thermal';
      const narrativeLabel = narrativeEvent.type.toLowerCase();

      findings.push({
        id: `finding-sensor-narrative-${sensorEvent.id}-${narrativeEvent.id}`,
        ruleId: SENSOR_NARRATIVE_CORRELATION_RULE_ID,
        title: `Possible correlation between reported ${narrativeLabel} and thermal detection`,
        severity: higherSeverity(sensorEvent.severity, narrativeEvent.severity),
        evidenceEventIds: [sensorEvent.id, narrativeEvent.id],
        explanation:
          `A ${sensorLabel} sensor detection and a reported ${narrativeLabel} event both occurred ` +
          `in the ${narrativeEvent.theater} theater within ${Math.round(windowMs / 60000)} minutes ` +
          'of each other. This is a temporal and theater-level association only, not a confirmed ' +
          'link between the two reports.',
        limitations: [
          'No shared coordinates confirm spatial proximity: narrative events carry only a region ' +
            'name and sensor events carry only coordinates, never both on the same report, so this ' +
            'correlation is theater-and-time only, not a verified spatial match.',
          'Thermal detections have many non-kinetic causes — wildfires, gas flares, agricultural ' +
            'burning — the same conservatism firmsFires.ts applies when mapping detection intensity ' +
            'to severity applies here: a thermal/explosion sensor reading is never asserted to be a ' +
            'strike outright.',
          "Temporal proximity alone doesn't establish causation — sensor and narrative sources poll " +
            'independently on their own schedules, so coincidental timing between an unrelated ' +
            'detection and an unrelated report is common.',
        ],
        generatedAt,
        expiresAt: generatedAt + FINDING_TTL_MS,
      });
    }
  }

  return findings;
}
