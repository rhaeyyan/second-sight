import type { IronsightEvent } from '@/lib/events/schema';

/**
 * Non-destructive grouping (draft-implementation-plan.md §2): three articles about the
 * same explosion shouldn't be treated as three separate kinetic events by the UI or the
 * correlation engine, but they also shouldn't be merged/discarded — an Incident is a
 * list of event ids, never a synthesized merged event, so provenance of every
 * corroborating source is preserved. Consumers look up the actual events by id.
 */
export interface Incident {
  id: string;
  theater: IronsightEvent['theater'];
  eventIds: string[];
  /** Distinct source.id values represented — the corroboration signal rules key off. */
  sourceIds: string[];
  firstReportedAt: number;
  lastReportedAt: number;
}

export interface ClusterOptions {
  /** Max gap between two events' reportedAt for them to be cluster candidates. Default 2h. */
  windowMs?: number;
  /** Min title-token Jaccard similarity to cluster. Default 0.4. */
  similarityThreshold?: number;
  /** Previous run's clusters to memoize against. */
  previousClusters?: Incident[];
  /** Callback fired for every jaccard similarity comparison (for tests). */
  onCompare?: () => void;
}

const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SIMILARITY_THRESHOLD = 0.4;

// Common words that carry no topical signal — excluding them keeps similarity scoring
// from being dominated by grammatical glue rather than what the report is actually about.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'of', 'and', 'or', 'for', 'with',
  'near', 'after', 'amid', 'over', 'is', 'are', 'was', 'were', 'has', 'have',
  'today', 'reported', 'reports', 'report',
]);

function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Union-find with path compression, keyed by event id. */
class DisjointSet {
  private parent = new Map<string, string>();

  private ensure(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: string): string {
    this.ensure(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(x: string, y: string): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX !== rootY) this.parent.set(rootX, rootY);
  }
}

/**
 * Groups related events into Incidents. Clustering is transitive: if A and B cluster,
 * and B and C cluster, all three land in one Incident even if A and C alone aren't
 * similar enough to cluster directly — this is why union-find rather than a simple
 * pairwise grouping. Two events are cluster candidates only when they share a theater
 * and fall within `windowMs` of each other's `reportedAt`; among candidates, they
 * actually cluster when normalized-title Jaccard similarity meets `similarityThreshold`.
 *
 * Singleton "clusters" (an event unrelated to anything else) are not returned — an
 * Incident exists to group reports of the same real-world thing, so a lone report isn't
 * one. Deliberately conservative thresholds: false negatives (missing a real cluster)
 * are safer than false positives (falsely linking unrelated events) for an engine whose
 * whole job is not overstating certainty.
 */
export function clusterEvents(events: IronsightEvent[], options: ClusterOptions = {}): Incident[] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const ds = new DisjointSet();
  const tokensById = new Map<string, Set<string>>();
  for (const event of events) {
    ds.find(event.id);
    tokensById.set(event.id, tokenize(event.title));
  }

  const clusteredEventIds = new Set<string>();
  if (options.previousClusters) {
    for (const cluster of options.previousClusters) {
      if (cluster.eventIds.length === 0) continue;
      const firstId = cluster.eventIds[0];
      clusteredEventIds.add(firstId);
      for (let i = 1; i < cluster.eventIds.length; i++) {
        clusteredEventIds.add(cluster.eventIds[i]);
        ds.union(firstId, cluster.eventIds[i]);
      }
    }
  }

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      
      // Skip stable-vs-stable comparisons
      if (clusteredEventIds.has(a.id) && clusteredEventIds.has(b.id)) {
        continue;
      }
      
      if (a.theater !== b.theater) continue;
      if (Math.abs(a.reportedAt - b.reportedAt) > windowMs) continue;
      
      options.onCompare?.();
      const similarity = jaccardSimilarity(tokensById.get(a.id)!, tokensById.get(b.id)!);
      if (similarity >= threshold) ds.union(a.id, b.id);
    }
  }

  const groups = new Map<string, IronsightEvent[]>();
  for (const event of events) {
    const root = ds.find(event.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(event);
  }

  const incidents: Incident[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const reportedAts = members.map((m) => m.reportedAt);
    incidents.push({
      id: `incident-${root}`,
      theater: members[0].theater,
      eventIds: members.map((m) => m.id).sort(),
      sourceIds: Array.from(new Set(members.map((m) => m.source.id))).sort(),
      firstReportedAt: Math.min(...reportedAts),
      lastReportedAt: Math.max(...reportedAts),
    });
  }

  return incidents.sort((a, b) => b.lastReportedAt - a.lastReportedAt);
}
