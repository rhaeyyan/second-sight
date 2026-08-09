# IRONSIGHT: Implementation Plan

This document outlines the architectural roadmap for evolving IRONSIGHT into a professional-grade OSINT dashboard. It prioritizes operational safety, robust data ingestion, and rigorous analytical uncertainty over naive correlation, while treating client-side browser limits as strict design boundaries.

---

## 1. The Client-Only Product Boundary
IRONSIGHT operates strictly as a live, in-browser analysis tool. It analyzes currently available data **only while the dashboard is open**. It is not a continuous monitoring service, does not collect data while closed, and relies entirely on client-side state (e.g., IndexedDB, Zustand). Any historical analysis is strictly limited to what can be fetched and retained within the active browser session.

---

## 2. The Core Architecture: The Ingestion Pipeline

IRONSIGHT must normalize source data at the boundary, not inside individual UI components. To prevent hallucinated analysis and memory leaks, data must flow through a strict pipeline before rendering:

**Source Adapters → Validation (Zod) → Incident Clustering → Event Store → Correlation Engine → Findings → UI Presentation**

### Incident Clustering (Non-Destructive)
Rather than destructively discarding duplicate reports (e.g., three news articles reporting the same explosion), the pipeline uses **Incident Clustering**. Related events are grouped together under a single "Incident", preserving the provenance of all corroborating sources while preventing the UI and correlation engine from treating them as multiple, separate kinetic events.

### The Expanded `IronsightEvent` Model
A single timestamp and simple threat score are insufficient for intelligence work. The core data model must capture provenance and uncertainty.

```typescript
type EventConfidence = "low" | "medium" | "high";
type VerificationStatus = "unverified" | "single-source" | "corroborated" | "official" | "disputed";

export interface IronsightEvent {
  id: string;
  source: {
    id: string;
    name: string;
    url?: string;
    sourceType: "official" | "media" | "social" | "sensor" | "market";
  };

  type: string;
  theater: "middle-east" | "ukraine";
  region?: string;

  // The Three Timestamps (Critical for Correlation)
  occurredAt?: number;     // When the event allegedly happened
  reportedAt: number;      // When the source published it
  ingestedAt: number;      // When IRONSIGHT received it

  location?: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    precision: "exact" | "approximate" | "regional" | "unknown";
  };

  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: EventConfidence;
  verificationStatus: VerificationStatus;

  title: string;
  summary?: string;
  originalLanguage?: string;

  tags: string[];
  relatedEventIds?: string[];
  rawPayload?: unknown;
}
```

---

## 3. Source Adapters & Runtime Validation

External APIs are unpredictable. Every data source must implement a strict `SourceAdapter` contract and use runtime validation (e.g., Zod) to prevent malformed payloads from crashing the engine.

### Explicit Source Health
The dashboard must distinguish between "no recent events" and "the API is broken."

```typescript
type SourceHealthStatus = "healthy" | "loading" | "stale" | "rate-limited" | "unavailable" | "invalid-response" | "paused";

interface SourceHealth {
  sourceId: string;
  status: SourceHealthStatus;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  nextAttemptAt?: number;
}
```

---

## 4. The Deterministic Correlation Engine

The analysis engine must favor transparent, inspectable rules over opaque AI conclusions. 

### Uncertainty and Limitations
Rules must generate *Assessments* (e.g., "Possible association"), not state definitive facts ("Coordinated Strike"). 

```typescript
interface AnalysisFinding {
  id: string;
  ruleId: string;
  title: string;
  severity: IronsightEvent["severity"];
  evidenceEventIds: string[]; // Links to underlying events
  explanation: string;
  limitations: string[];      // Why this might be wrong
  generatedAt: number;
  expiresAt?: number;         // Findings must age out
}
```

---

## 5. Accessibility (a11y) & UX Guardrails

A flashing, real-time warzone dashboard can easily become inaccessible. 

*   **Global Pause Controls:** "Pause" must queue incoming events and stop auto-scrolling, giving users control over the data flow.
*   **Polite Live Regions:** Do not use `aria-live="assertive"` for everything. Use `polite` to prevent screen reader interruption spam. Assertive is reserved for critical, life-safety alerts.
*   **Map / Table Parity:** A hidden `sr-only` table is insufficient. Provide a fully operable, visible Map/Table toggle for sighted keyboard users and those with cognitive disabilities.
*   **Original Language Preservation:** Do not silently overwrite foreign languages. Keep the original text with correct `lang` and `dir` HTML attributes, alongside the translated text.

---

## 6. Implementation Phases (The Roadmap)

Do not attempt to add all features at once. Implement in this order:

### Phase 1: Architecture & Observability
1. Implement the `IronsightEvent` schema and Zod validation.
2. Build the `SourceAdapter` interface for *existing* feeds only.
3. Establish bounded event storage (to prevent browser memory crashes) and explicit source health monitoring.
*Exit Criteria:* 3 existing feeds normalize correctly; Zod validation catches 100% of malformed fixture payloads in unit tests; source failures degrade gracefully without crashing the dashboard, verified via integration tests.

### Phase 2: Accessible Unified Feed
1. Build the chronological feed, theater filters, and Map/Table parity views.
2. Implement robust Pause/Resume behavior.
*Exit Criteria:* Feed is fully operable via keyboard-only navigation; automated Axe accessibility tests pass with zero critical violations; manual verification confirms pause controls successfully halt map and feed animations.

### Phase 3: Correlation Engine
1. Implement Incident Clustering logic.
2. Write 2-3 conservative rules (e.g., temporally related events).
3. Ensure every finding exposes its `limitations` and `evidenceEventIds`.
*Exit Criteria:* Rules are covered by unit tests validating true positives, near misses, and stale events; 100% of generated findings successfully expose their underlying evidence IDs and documented limitations.

### Phase 4: Gradual API Expansion
Integrate new APIs one by one.
*   **Open-Meteo:** Low-risk contextual data (cloud cover).
*   **USGS:** Conservatively labeled as "Seismic Activity".
*   **IODA:** Pending strict geographic validation.
*Exit Criteria:* Each new API passes strict CORS, rate-limit, and geographic precision gates before merging; performance budgets are met, verifying no UI long-tasks (>100ms) occur when bursting 100+ events per second.
