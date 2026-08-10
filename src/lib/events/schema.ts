import { z } from 'zod';
import { CONFLICT_KEYS } from '@/lib/conflicts';

/**
 * `confidence` and `verificationStatus` are kept as separate axes deliberately.
 * `confidence` is IRONSIGHT's trust in its own classification of the event (e.g. how a
 * keyword regex tagged a headline as STRIKE vs REPORT). `verificationStatus` is how well
 * the underlying report itself is corroborated, independent of how we classified it.
 * Collapsing them into one field would hide which kind of uncertainty a consumer is
 * looking at — "we're not sure what this is" vs "we're not sure this happened."
 */
export const EventConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type EventConfidence = z.infer<typeof EventConfidenceSchema>;

export const VerificationStatusSchema = z.enum([
  'unverified',
  'single-source',
  'corroborated',
  'official',
  'disputed',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const EventSeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type EventSeverity = z.infer<typeof EventSeveritySchema>;

// draft-implementation-plan.md's IronsightEvent sketch uses illustrative theater values
// ("middle-east" | "ukraine"). This schema uses the conflict keys IRONSIGHT actually has
// a registry for (src/lib/conflicts), read at module-load time, so the two can't drift.
export const EventTheaterSchema = z.enum(CONFLICT_KEYS as [string, ...string[]]);

/**
 * The canonical shape every Source Adapter normalizes into before an event reaches the
 * Event Store. See draft-implementation-plan.md §2 for the pipeline this sits in, and the
 * build-source-adapter skill for the three-timestamp rule this schema enforces.
 */
export const IronsightEventSchema = z.object({
  id: z.string().min(1),
  source: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.url().optional(),
    sourceType: z.enum(['official', 'media', 'social', 'sensor', 'market']),
  }),

  type: z.string().min(1),
  theater: EventTheaterSchema,
  region: z.string().optional(),

  // occurredAt is intentionally optional — most feeds only give us when they published,
  // not when the event actually happened. reportedAt and ingestedAt are always known.
  occurredAt: z.number().positive().optional(),
  reportedAt: z.number().positive(),
  ingestedAt: z.number().positive(),

  // Optional, not defaulted to {0, 0}: an adapter with no real coordinates for an event
  // must omit location rather than fabricate a null-island placeholder that looks like data.
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radiusKm: z.number().positive().optional(),
      precision: z.enum(['exact', 'approximate', 'regional', 'unknown']),
    })
    .optional(),

  severity: EventSeveritySchema,
  confidence: EventConfidenceSchema,
  verificationStatus: VerificationStatusSchema,

  title: z.string().min(1),
  summary: z.string().optional(),
  // `title` is always the display text (translated to English when the source wasn't).
  // originalTitle preserves the untranslated source text when translation happened —
  // captured before title is overwritten, same pattern as AlertEvent's threat/
  // threatOriginal in src/app/api/alerts/route.ts. Paired with originalLanguage so a
  // consumer can render both with correct lang/dir attributes (draft-implementation-
  // plan.md §5's "Original Language Preservation" guardrail).
  originalLanguage: z.string().optional(),
  originalTitle: z.string().optional(),
  // Permalink to this specific report — distinct from source.url, which identifies the
  // feed/outlet itself. Optional because not every adapter's source has per-item links
  // (e.g. a sensor feed like NASA FIRMS has nothing here to link to).
  url: z.url().optional(),

  tags: z.array(z.string()),
  relatedEventIds: z.array(z.string()).optional(),
  // Preserves the adapter's raw source payload for debugging/audit. Never rendered
  // directly — anything shown to the user goes through the typed fields above.
  rawPayload: z.unknown().optional(),
});

export type IronsightEvent = z.infer<typeof IronsightEventSchema>;
