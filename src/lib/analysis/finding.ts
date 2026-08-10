import { z } from 'zod';
import { EventSeveritySchema } from '@/lib/events/schema';

/**
 * The correlation engine's output shape (draft-implementation-plan.md §4). Rules must
 * generate hedged *assessments* ("Possible association"), never asserted facts
 * ("Coordinated Strike") — `evidenceEventIds` and `limitations` are schema-enforced
 * non-empty arrays specifically so "every finding exposes its evidence and
 * limitations" (the Phase 3 exit criterion) is a structural guarantee any rule's
 * output can be checked against via `.safeParse`, not just a hoped-for convention.
 */
export const AnalysisFindingSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  title: z.string().min(1),
  severity: EventSeveritySchema,
  evidenceEventIds: z.array(z.string()).min(1),
  explanation: z.string().min(1),
  limitations: z.array(z.string()).min(1),
  generatedAt: z.number().positive(),
  // Optional in the type (a rule could theoretically produce a non-expiring finding),
  // but every rule in src/lib/analysis/rules/ sets one — "findings must age out" per
  // the plan. See pruneExpiredFindings in engine.ts.
  expiresAt: z.number().positive().optional(),
});

export type AnalysisFinding = z.infer<typeof AnalysisFindingSchema>;
