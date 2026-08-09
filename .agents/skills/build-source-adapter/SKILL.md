---
name: build-source-adapter
description: Blueprint for integrating external APIs into IRONSIGHT. Enforces Zod validation, the 3-timestamp rule, and strict error handling.
---

# Build Source Adapter

Activate this skill when integrating a new external data feed (API, RSS, WebSocket) into the IRONSIGHT pipeline.

## Core Directives

### 1. The Adapter Contract
Every data source must implement the standard `SourceAdapter` interface. Do not write custom, one-off fetch logic in UI components. The adapter is responsible for fetching, validating, and normalizing the payload into the `IronsightEvent` schema.

### 2. Strict Runtime Validation
You **MUST** use Zod to validate the raw incoming payload before attempting to normalize it. 
*   Never blindly cast types using `as MyType`.
*   APIs change schemas without warning; Zod ensures bad payloads are dropped rather than crashing the dashboard.

### 3. The Three-Timestamp Rule
When normalizing to `IronsightEvent`, you must accurately assign:
*   `occurredAt`: When the physical event happened (if provided by the API).
*   `reportedAt`: When the API/feed published the report.
*   `ingestedAt`: Must be generated at runtime (e.g., `Date.now()`).

### 4. Operational Resilience
*   Implement explicit try/catch blocks.
*   If the API rate limits (HTTP 429), implement an exponential backoff.
*   Ensure the adapter emits clear `SourceHealthStatus` updates (e.g., `rate-limited`, `invalid-response`) so the UI can accurately reflect the feed's status.
