# TODO

Working task list for **IRONSIGHT**. Read this at the start of a work session and keep it current as work completes - check items off with a date, add follow-ups as they surface. Stale TODOs are worse than none. Security debt (if any) is tracked separately in `SECURITY-DEBT.md`.

---

## Open

### Phase 0 — before the roadmap starts
- [x] ~~Add `zod` and wire runtime validation into one API route as a reference implementation~~ ✅ done 2026-08-09 — `src/lib/events/{schema,sourceAdapter}.ts` + `src/lib/events/adapters/googleNewsConflict.ts`, wired into `/api/conflicts`
- [x] ~~Pin down where `SourceAdapter` and Zod validation live: the API route handlers (server) or a client store~~ ✅ done 2026-08-09 — server-side, in the route handlers, where fetching already happens. `draft-implementation-plan.md` §1's "in-browser" language describes the product boundary (no persistent server, no DB), not literally where validation code runs
- [x] ~~Decide which of the ~12 types in `src/types/index.ts` become `IronsightEvent` vs. stay bespoke~~ ✅ done 2026-08-09 — see the doc comment at the top of `src/types/index.ts`. 10 of the 12 turned out to be dead code (never imported; every route already defines its own local type) and were deleted. Of the two still in use, `ConflictEvent` and `NewsItem` are the `IronsightEvent` migration candidates; everything else (market/oil/ship/flight snapshots, static registries) stays bespoke by design, not by omission
- [ ] `/api/conflicts`'s `toConflictEvent()` mapping in `route.ts` is a deliberate, commented compatibility shim — it exists so `ConflictFeed`/`ConflictMap` don't need touching yet. Remove it once Phase 2 migrates those panels to consume `IronsightEvent` directly; until then it's a second shape for the same data and should not be copied to other routes without a reason

### Phase 1 — Architecture & Observability
✅ done 2026-08-09. Exit criteria from `draft-implementation-plan.md`: 3 feeds normalize correctly (conflicts, news, NASA FIRMS all have real `SourceAdapter`s with fixture tests); Zod validation catches malformed fixture payloads in unit tests (all three, including an out-of-range-coordinate fixture for FIRMS); source failures degrade gracefully without crashing, verified via integration tests (first component-level tests in the repo — `ConflictFeed`/`NewsFeed`/`SatellitePanel` rendered against a failing/rejecting fetch).
- [x] ~~`src/app/api/news/route.ts` migrated onto a real `SourceAdapter`~~ (`src/lib/events/adapters/newsRss.ts`), via the same `toX()` compatibility-shim pattern as conflicts — `NewsFeed.tsx` needed no changes
- [x] ~~`IronsightEventSchema` gained a per-report `url` field~~ — a gap found while migrating news; `source.url` identifies the feed, not the individual article, and `NewsItem.link` is real user-clicked data. Optional and additive
- [x] ~~NASA FIRMS `SourceAdapter`~~ (`src/lib/events/adapters/firmsFires.ts`) — deliberately **not** wired into `/api/fires/route.ts`. `FireEvent`'s raw sensor fields (brightness, frp, NASA's own confidence string) have no typed home in `IronsightEvent`, which models narrated OSINT events, not sensor telemetry, and `rawPayload` is explicitly off-limits for anything user-facing. The route keeps its existing, already health-instrumented response shape; this adapter exists standalone to prove the schema generalizes beyond text feeds (first adapter to populate `location` and `occurredAt`) and to feed Phase 3's correlation engine
- [x] ~~Bounded event store~~ (`src/lib/events/eventStore.ts`) — plain TS module, no new dependency (Zustand/IndexedDB deferred to whenever Phase 2/3 UI actually consumes it). Caps at 5000 events by default, evicts oldest by `ingestedAt`, idempotent on `event.id`
- [x] ~~Integration tests proving graceful degradation~~ — `ConflictFeed.test.tsx`, `NewsFeed.test.tsx`, `SatellitePanel.test.tsx`

### Correctness
- [x] ~~`src/lib/hooks.ts:30` — `useCallback` omits `data` from its deps, so the "keep previous data if the response is empty" guard closes over a stale `data`~~ ✅ done 2026-08-09 — switched to the `setData(prev => ...)` functional form so the guard reads live state instead of the closure; regression test in `src/lib/hooks.test.ts`
- [x] ~~Replace bare `catch { return [] }` in the API routes (e.g. `src/app/api/news/route.ts:68`) with explicit `SourceHealthStatus`~~ ✅ done 2026-08-09 — every route now reports `SourceHealth` via the `X-Source-Health` header (single value for single-source routes, an array for aggregators — one entry per feed/query/symbol/channel). Not consumed by the UI yet (Phase 2); inspectable via devtools in the meantime. `ships/route.ts` reports a nominal always-healthy status since it has no real external fetch to fail. Fixture-tested throughout except `ships`, which is Config-tier (static registry, typecheck only)

### Tooling
- [ ] Axe assertions are wired up (`vitest-axe`) but unused — add them with the Phase 2 feed work
- [ ] `vitest-axe` is on 0.1.0 and unmaintained; if it breaks against a future Vitest major, switch to `axe-core` directly
- [x] ~~14 pre-existing lint warnings, mostly `react-hooks/exhaustive-deps` in `ConflictMap.tsx`~~ ✅ done 2026-08-09 — two root causes: (1) 5 warnings about reading `ref.current` inside a cleanup closure, fixed by capturing the ref values in local consts before the closure (the underlying `Map`s are never reassigned, so behavior is unchanged); (2) 6 warnings about effects missing `cfg.*` deps, resolved with justified `eslint-disable` rather than adding them — `page.tsx` remounts `ConflictMap` via `key={conflictKey}` on every theater switch, so `cfg` is stable for a given instance's whole lifetime and adding it to deps arrays would misleadingly imply the effects react to `cfg` changes they structurally can't observe

_Mark done inline: `- [x] ~~task~~ ✅ done YYYY-MM-DD`._
