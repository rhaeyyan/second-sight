import type { IronsightEvent } from './schema';

/**
 * Distinguishes "the feed has nothing new right now" from "the feed is broken" — the gap
 * the dashboard currently can't see, since every API route swallows fetch/parse failures
 * into an empty array indistinguishable from a quiet feed.
 */
export type SourceHealthStatus =
  | 'healthy'
  | 'loading'
  | 'stale'
  | 'rate-limited'
  | 'unavailable'
  | 'invalid-response'
  | 'paused';

export interface SourceHealth {
  sourceId: string;
  status: SourceHealthStatus;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  nextAttemptAt?: number;
}

/** A payload an adapter fetched but could not normalize into a valid IronsightEvent. */
export interface RejectedPayload {
  payload: unknown;
  issues: string[];
}

export interface SourceAdapterResult {
  events: IronsightEvent[];
  health: SourceHealth;
  /**
   * Payloads that failed Zod validation. Kept for observability rather than silently
   * dropped, so a schema drift in an upstream feed shows up as a number instead of a
   * mysteriously shrinking event count.
   */
  rejected: RejectedPayload[];
}

/**
 * The contract every external feed integration implements. An adapter owns fetching,
 * runtime validation, and normalization into IronsightEvent — UI components and routes
 * never talk to a raw external API directly. See the build-source-adapter skill.
 */
export interface SourceAdapter {
  readonly sourceId: string;
  fetch(): Promise<SourceAdapterResult>;
}
