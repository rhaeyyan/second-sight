import { CORROBORATION_RULE_ID } from '@/lib/analysis/rules/corroboration';
import { SENSOR_NARRATIVE_CORRELATION_RULE_ID } from '@/lib/analysis/rules/sensorNarrativeCorrelation';
import { ESCALATION_PATTERN_RULE_ID } from '@/lib/analysis/rules/escalationPattern';

/**
 * ruleId -> human-readable label, imported from each rule's own exported constant rather
 * than hardcoded strings so this can never silently drift from the ids the engine
 * actually produces.
 */
export const RULE_LABELS: Record<string, string> = {
  [CORROBORATION_RULE_ID]: 'CORROBORATION',
  [SENSOR_NARRATIVE_CORRELATION_RULE_ID]: 'SENSOR ↔ NARRATIVE',
  [ESCALATION_PATTERN_RULE_ID]: 'ESCALATION PATTERN',
};

/**
 * Formats a future timestamp as a countdown-style caveat ("Expires in ~2h"). timeAgo()
 * (src/lib/hooks.ts) only formats past-relative text, so this is a small sibling rather
 * than an overload of it — a finding's expiresAt is the one future-relative timestamp
 * anywhere in the UI today.
 */
export function expiresIn(expiresAt: number, now: number = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';

  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `Expires in ~${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Expires in ~${hours}h`;
  const days = Math.floor(hours / 24);
  return `Expires in ~${days}d`;
}
