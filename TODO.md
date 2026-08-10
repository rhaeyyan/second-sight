# TODO

Working task list for **IRONSIGHT**. Read this at the start of a work session and keep it current as work completes - check items off with a date, add follow-ups as they surface. Stale TODOs are worse than none. Security debt (if any) is tracked separately in `SECURITY-DEBT.md`.

---

## Open

### Phase 0 — before the roadmap starts
- [x] ~~Add `zod` and wire runtime validation into one API route as a reference implementation~~ ✅ done 2026-08-09 — `src/lib/events/{schema,sourceAdapter}.ts` + `src/lib/events/adapters/googleNewsConflict.ts`, wired into `/api/conflicts`
- [x] ~~Pin down where `SourceAdapter` and Zod validation live: the API route handlers (server) or a client store~~ ✅ done 2026-08-09 — server-side, in the route handlers, where fetching already happens. `draft-implementation-plan.md` §1's "in-browser" language describes the product boundary (no persistent server, no DB), not literally where validation code runs
- [x] ~~Decide which of the ~12 types in `src/types/index.ts` become `IronsightEvent` vs. stay bespoke~~ ✅ done 2026-08-09 — see the doc comment at the top of `src/types/index.ts`. 10 of the 12 turned out to be dead code (never imported; every route already defines its own local type) and were deleted. Of the two still in use, `ConflictEvent` and `NewsItem` are the `IronsightEvent` migration candidates; everything else (market/oil/ship/flight snapshots, static registries) stays bespoke by design, not by omission
- [ ] `/api/conflicts`'s `toConflictEvent()` mapping in `route.ts` is a deliberate, commented compatibility shim — it exists so `ConflictFeed`/`ConflictMap` don't need touching yet. Remove it once Phase 2 migrates those panels to consume `IronsightEvent` directly; until then it's a second shape for the same data and should not be copied to other routes without a reason

### Correctness
- [ ] `src/lib/hooks.ts:30` — `useCallback` omits `data` from its deps, so the "keep previous data if the response is empty" guard closes over a stale `data`. The guard silently stops working after the first render. Lint warns about this
- [ ] Replace bare `catch { return [] }` in the API routes (e.g. `src/app/api/news/route.ts:68`) with explicit `SourceHealthStatus`. Right now "no events" and "the feed is broken" are indistinguishable in the UI

### Tooling
- [ ] Axe assertions are wired up (`vitest-axe`) but unused — add them with the Phase 2 feed work
- [ ] `vitest-axe` is on 0.1.0 and unmaintained; if it breaks against a future Vitest major, switch to `axe-core` directly
- [ ] 14 pre-existing lint warnings, mostly `react-hooks/exhaustive-deps` in `ConflictMap.tsx`. Not blocking the gate. Worth a pass when that file is next touched

_Mark done inline: `- [x] ~~task~~ ✅ done YYYY-MM-DD`._
