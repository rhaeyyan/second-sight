# IRONSIGHT

## Overview
Real-time OSINT command center for monitoring the Middle East conflict. Aggregates open-source intelligence from 50+ sources across news, Telegram, military tracking, financial markets, and more into a single dashboard.

## Environment
- **Status**: Open Source / Development
- **Live URL**: Local only (no hosted version)
- **Cloud**: None (client-side only)

## Tech Stack
- Frontend: Next.js + TypeScript + Tailwind CSS
- Maps: Leaflet
- Data: RSS feeds, Telegram scraping, Yahoo Finance, NASA FIRMS
- No backend - all client-side

## Common Commands
```bash
# Install dependencies
npm install

# Development
npm run dev

# Build
npm run build

# Start production
npm start
```

## Project Structure
```
IRONSIGHT/
├── src/
│   ├── app/           # Next.js app router
│   ├── components/    # React components
│   └── lib/           # Data fetching utilities
└── public/            # Static assets
```

## Features
- Live Intel Feed (20+ RSS sources)
- Telegram OSINT (27 channels with auto-translation)
- Interactive Theater Map (aircraft, naval, strikes)
- Israel Alert Status (Pikud HaOref missile alerts)
- Conflict Monitor (strikes, defense, diplomatic)
- Military Airspace Tracking (adsb.lol)
- Naval Tracker (Persian Gulf, Eastern Med)
- Defense & Crypto Markets
- Prediction Markets (Polymarket)
- Satellite Thermal Detection (NASA FIRMS)

## Notes
- No API keys required - all free data sources
- Client-side only - no backend needed
- Open source under MIT license

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Multi-Agent Implementation Pipeline

IRONSIGHT uses a specialized multi-agent pipeline to safely implement the architectural roadmap defined in `draft-implementation-plan.md`. The main agent orchestrates the workflow by invoking the following specialized subagents:

1. **`data_architect`**: Owns Phase 1 (Data Ingestion). Responsible for `IronsightEvent` TypeScript interfaces, strict Zod validation schemas, the `SourceAdapter` contract, and bounded event storage.
2. **`a11y_ui_engineer`**: Owns Phase 2 (UI & Accessibility). Responsible for accessible feeds, Map/Table parity views, global Pause/Resume state, dynamic i18n tagging, and polite ARIA live regions.
3. **`osint_rules_analyst`**: Owns Phase 3 (Correlation Engine). Responsible for non-destructive Incident Clustering, deterministic correlation rules, and exposing evidentiary limitations.
4. **`api_integration_specialist`**: Owns Phase 4 (API Expansion). Responsible for integrating Open-Meteo, USGS, etc., while strictly enforcing CORS compatibility, exponential backoff, and client-side rate limits.
5. **`ui_refactoring_engineer`**: Auxiliary agent. Responsible for the mechanical, tedious work of applying the Architect's data-fetching patterns across the entire UI component tree.

**Workflow:**
When executing tasks against the implementation plan, the orchestrator should decompose the work and spawn the relevant subagent using the `invoke_subagent` tool to write the actual code and tests for their respective domain.

## TDD & Spec-Driven Development (SDD)

All subagents and the orchestrator must strictly adhere to the following development lifecycle:

1. **Plan Before Building (Definition of Ready):** Before any code is written for a phase or feature, the orchestrator must generate a clear `[SPEC]`. Ambiguous goals must be clarified with the human (e.g., via the `/grill-me` command) before generating the spec. The human must approve the plan before implementation begins (HITL checkpoint).
2. **TDD and Black-Box Testing:** Subagents must write failing tests from the `[SPEC]` *before* writing the implementation code. 
    *   Prioritize **Behavioral / Integration tests**, treating the underlying code as a black box (testing public APIs and inputs/outputs) to avoid brittle unit tests that lock the project into a specific internal implementation.
    *   Tests act as a ruthless gatekeeper against unscalable complexity. **Tests define Done.**
3. **Exploratory Work (`[SPIKE]`):** For prototyping or exploratory tasks where TDD is not feasible, the agent operates under a `[SPIKE]`. In this scenario, characterization tests must be written *after* the implementation is proven.

## Contextual Design Patterns

*   **Domain & Engine Logic:** Strictly adhere to SOLID principles. Rely on interfaces (e.g., `SourceAdapter`), Dependency Inversion, and the Open/Closed principle to ensure the correlation engine remains entirely decoupled from specific data sources.
*   **React UI Layer:** Favor functional composition, custom hooks, and pure functions. Do not over-engineer the UI with strict OOP hierarchies. Simplicity and composability beat pattern purity.
