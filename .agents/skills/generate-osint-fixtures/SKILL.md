---
name: generate-osint-fixtures
description: Instructions for creating realistic mock JSON payloads for IRONSIGHT external feeds to test the correlation engine offline.
---

# Generate OSINT Fixtures

Activate this skill when you need to write tests for the correlation engine, Zod validators, or Incident Clustering logic without hitting live APIs.

## Core Directives

### 1. Structural Realism
Mock payloads must accurately mimic the real API's structure. 
*   Example: USGS mock data must be a valid GeoJSON `FeatureCollection`.
*   Example: Telegram mock data must include realistic HTML/text mixes and metadata.

### 2. Edge Case Generation
A test suite is useless if it only tests the happy path. You must generate:
*   **Malformed Fixtures:** Missing coordinates, null timestamps, or altered enum values to prove the Zod validator catches them.
*   **Stale Fixtures:** Events from days or weeks ago to prove the engine correctly expires them.

### 3. Scenario Syncing (The Correlation Test)
To test the deterministic rules, you must generate *coordinated sets* of fixtures. 
*   Example: Create an IODA telecom outage fixture, and precisely 15 minutes later in the mock timeline, create a Telegram explosion report in the exact same region.

### 4. Deterministic Clocks
Never use `Date.now()` for timestamps in mock data. Always use a fixed `mockNow` epoch so the tests remain deterministic and do not randomly fail depending on what day they are run.
