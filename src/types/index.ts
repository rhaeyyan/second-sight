/**
 * IronsightEvent classification (Phase 0 decision, 2026-08-09):
 *
 * Of the ~12 types this file used to hold, only `NewsItem` below is still imported
 * anywhere (by /api/news + NewsFeed) — the rest (OilPrice, MarketData, CurrencyRate,
 * FlightData, ShipData, SeismicEvent, GasPrice, CyberEvent, HumanitarianReport,
 * NuclearFacility, ThreatLevel, DashboardMetrics) were dead: every route that handles
 * that domain (markets, oil, crypto, ships, flights, ...) already defines its own local,
 * route-specific interface instead (e.g. `NavalVessel` in ships/route.ts,
 * `AircraftState` in flights/route.ts). They've been deleted rather than migrated.
 * `ConflictEvent` completed its own migration (2026-08-11): `/api/conflicts`,
 * `ConflictFeed`, and `ConflictMap` all consume `IronsightEvent` directly now, and the
 * `toConflictEvent()` compatibility shim that used to bridge them is gone — so this
 * interface had zero importers left and was deleted rather than kept around unused.
 *
 * That dead-vs-live split also answers the "IronsightEvent vs. bespoke" question:
 * - `NewsItem` is a discrete, narrated happening (a headline) — it belongs on the
 *   `IronsightEvent` migration path, same as `ConflictEvent` already was: same adapter
 *   pattern as `src/lib/events/adapters/googleNewsConflict.ts`.
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
  originalTitle?: string;
  originalLanguage?: string;
}
