/**
 * IronsightEvent classification (Phase 0 decision, 2026-08-09):
 *
 * Of the ~12 types this file used to hold, only the two below are actually imported
 * anywhere (`NewsItem` by /api/news + NewsFeed, `ConflictEvent` by /api/conflicts +
 * ConflictFeed/ConflictMap) — the rest (OilPrice, MarketData, CurrencyRate, FlightData,
 * ShipData, SeismicEvent, GasPrice, CyberEvent, HumanitarianReport, NuclearFacility,
 * ThreatLevel, DashboardMetrics) were dead: every route that handles that domain
 * (markets, oil, crypto, ships, flights, ...) already defines its own local,
 * route-specific interface instead (e.g. `NavalVessel` in ships/route.ts,
 * `AircraftState` in flights/route.ts). They've been deleted rather than migrated.
 *
 * That dead-vs-live split also answers the "IronsightEvent vs. bespoke" question:
 * - `NewsItem` and `ConflictEvent` are discrete, narrated happenings (a headline, a
 *   strike report) — they belong on the `IronsightEvent` migration path. `ConflictEvent`
 *   is already mid-migration behind the `toConflictEvent()` compatibility shim in
 *   /api/conflicts/route.ts; `NewsItem` is the next candidate, same adapter pattern as
 *   `src/lib/events/adapters/googleNewsConflict.ts`.
 * - Continuously-updating snapshots (market/oil/crypto prices, ship/aircraft positions)
 *   and static registries (nuclear facilities, the ThreatClock timezone table) are not
 *   events and are not going to become `IronsightEvent`s — there's no "occurred at"
 *   moment to report, just a current value. They stay bespoke, defined locally in the
 *   route or config file that owns them, per `draft-implementation-plan.md` §1.
 */
export interface NewsItem {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  category?: string;
}

export interface ConflictEvent {
  id: string;
  date: string;
  type: string;
  location: string;
  lat: number;
  lon: number;
  description: string;
  source: string;
  fatalities?: number;
}
