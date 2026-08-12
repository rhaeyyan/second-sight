import { clusterEvents, type Incident } from './incident';
import { applyCorroborationRule } from './rules/corroboration';
import { applySensorNarrativeCorrelationRule } from './rules/sensorNarrativeCorrelation';
import { applyEscalationPatternRule } from './rules/escalationPattern';
import type { AnalysisFinding } from './finding';
import type { IronsightEvent } from '@/lib/events/schema';

export interface CorrelationEngineOptions {
  previousClusters?: Incident[];
}

export interface CorrelationEngineResult {
  findings: AnalysisFinding[];
  clusters: Incident[];
}

/**
 * Runs the Phase 3 correlation engine (draft-implementation-plan.md §4) over a batch of
 * events: clusters once, then runs all three rules — corroboration consumes the
 * resulting Incidents, sensor-narrative correlation and escalation pattern consume the
 * raw events directly (not every rule needs clustering; see their own doc comments).
 * Findings are simply concatenated — the rules target different signals and are not
 * expected to conflict or need deduplication against each other.
 */
export function runCorrelationEngine(
  events: IronsightEvent[],
  now: () => number = Date.now,
  options?: CorrelationEngineOptions
): CorrelationEngineResult {
  const clusters = clusterEvents(events, { previousClusters: options?.previousClusters });

  const findings = [
    ...applyCorroborationRule(clusters, events, now),
    ...applySensorNarrativeCorrelationRule(events, undefined, now),
    ...applyEscalationPatternRule(events, undefined, now),
  ];

  return { findings, clusters };
}

/**
 * "Findings must age out" (draft-implementation-plan.md §4). Kept separate from
 * runCorrelationEngine rather than fused into it, so aging-out logic is testable and
 * usable without needing a fresh correlation pass — a caller holding findings from an
 * earlier run can prune them against the current time on its own schedule. A finding
 * with no `expiresAt` at all is treated as never-expiring (kept) — every rule in
 * src/lib/analysis/rules/ always sets one, but the schema itself allows omitting it,
 * so pruning must handle that case rather than assume every finding has one.
 */
export function pruneExpiredFindings(findings: AnalysisFinding[], now: number): AnalysisFinding[] {
  return findings.filter((finding) => finding.expiresAt === undefined || finding.expiresAt > now);
}
