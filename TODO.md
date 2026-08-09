# TODO

Working task list for **IRONSIGHT**. Read this at the start of a work session and keep it current as work completes - check items off with a date, add follow-ups as they surface. Stale TODOs are worse than none. Security debt (if any) is tracked separately in `SECURITY-DEBT.md`.

---

## Open

### Phase 0 — before the roadmap starts
- [ ] Add `zod` and wire runtime validation into one API route as a reference implementation
- [ ] Decide which of the ~12 types in `src/types/index.ts` become `IronsightEvent` vs. stay bespoke. `MarketData`, `StaticShip`, and the `ThreatClock` timezone table are not events — say so explicitly before Phase 1 starts, not mid-refactor
- [ ] Pin down where `SourceAdapter` and Zod validation live: the API route handlers (server) or a client store. `draft-implementation-plan.md` §1 says "in-browser", but all fetching/parsing currently happens server-side in `src/app/api/*/route.ts`

### Correctness
- [ ] `src/lib/hooks.ts:30` — `useCallback` omits `data` from its deps, so the "keep previous data if the response is empty" guard closes over a stale `data`. The guard silently stops working after the first render. Lint warns about this
- [ ] Replace bare `catch { return [] }` in the API routes (e.g. `src/app/api/news/route.ts:68`) with explicit `SourceHealthStatus`. Right now "no events" and "the feed is broken" are indistinguishable in the UI

### Tooling
- [ ] Axe assertions are wired up (`vitest-axe`) but unused — add them with the Phase 2 feed work
- [ ] `vitest-axe` is on 0.1.0 and unmaintained; if it breaks against a future Vitest major, switch to `axe-core` directly
- [ ] 14 pre-existing lint warnings, mostly `react-hooks/exhaustive-deps` in `ConflictMap.tsx`. Not blocking the gate. Worth a pass when that file is next touched

_Mark done inline: `- [x] ~~task~~ ✅ done YYYY-MM-DD`._
