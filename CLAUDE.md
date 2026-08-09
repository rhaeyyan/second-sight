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
- Tests: Vitest (+ React Testing Library for UI behaviour)
- No backend — data fetching/parsing happens in Next.js route handlers; no database, no persistence

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

# Typecheck + lint + tests. Must pass before any commit.
npm run check

# Tests in watch mode
npm test
```

## Project Structure
```
IRONSIGHT/
├── src/
│   ├── app/           # Next.js app router (pages + /api route handlers)
│   ├── components/    # React components
│   └── lib/           # Domain logic + data fetching utilities
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

---

# Working Agreements

The architectural roadmap lives in `draft-implementation-plan.md`. Phases 1–4 there are
sequential — finish a phase's exit criteria before starting the next.

## Rigor Tiers

Process scales with blast radius. Do not apply the same ceremony to a rules engine and a
presentational panel.

| Tier | Code | Process |
|---|---|---|
| **Engine** | correlation rules, incident clustering, Zod schemas, `SourceAdapter` | Full rigor. Write the failing test first — these are pure functions, fast to test, and expensive to get wrong |
| **Boundary** | `src/app/api/*/route.ts` | Validate at the boundary; emit `SourceHealthStatus`. Fixture-based parser tests. No spec needed |
| **UI** | `src/components/panels/*.tsx` | No spec, no test-first. Behavioural tests only where there's real logic; a11y covered by the Axe run |
| **Config** | `src/lib/conflicts/*.ts`, static registries | Typecheck only |

## Gates

`npm run check` runs typecheck, lint, and tests. It is the gate — not a self-assessment.
Policies are enforced mechanically rather than recited:

- **No `any`** → `@typescript-eslint/no-explicit-any` (error)
- **No unsanitized external HTML** → `react/no-danger` (error). The codebase renders zero raw
  HTML today; keep it that way. If raw HTML ever becomes unavoidable, sanitize with DOMPurify
  and disable the rule at that single call site with a comment explaining why.
- **Accessibility** → automated Axe assertions in the test suite (Phase 2 exit criteria)

If a rule needs an exception, disable it inline with a justification. Don't weaken the config.

## [SPEC] — Tier-1 (Engine) work only

Agree on this before writing engine code. Three fields, not eight:

```text
- Objective:  <what it must do>
- Contract:   <types in / types out>
- Done when:  <the test that proves it>
```

Boundary, UI, and config work does not need a spec.

## Conventions

- **Commits are the completion report.** Conventional Commits (`feat:`, `fix:`, `refactor:`,
  `test:`, `docs:`). No separate hand-off write-up — `git diff --stat` shows what changed, and
  unfinished work goes in `TODO.md` where it survives the session.
- **TypeScript is strict.** Validate external payloads at runtime (Zod); never cast with `as`.
- **JSDoc explains why, not what.** Core domain logic (`SourceAdapter`, `IronsightEvent`,
  clustering) gets a block comment covering intent and trade-offs. Simple components get nothing.
- **Treat all incoming data as hostile.** RSS, Telegram, and third-party APIs are untrusted input.
- **Analysis output is hedged, never asserted.** Findings carry `limitations` and
  `evidenceEventIds`. This tool reports on a live conflict; false certainty is a real harm.
- **Write plainly.** No filler, no boilerplate preamble, no self-congratulation. Say what changed
  and what's still broken.
