import { NextResponse } from 'next/server';
import { getConflictFromRequest } from '@/lib/conflicts';
import { createGoogleNewsConflictAdapter } from '@/lib/events/adapters/googleNewsConflict';
import type { IronsightEvent } from '@/lib/events/schema';
import type { ConflictEvent } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Temporary compatibility shim. ConflictFeed and ConflictMap still consume ConflictEvent,
 * so the route maps IronsightEvent down to that shape rather than migrating the UI here —
 * that's Phase 2 scope. ConflictEvent.lat/lon are required numbers the old route always
 * faked as 0,0 for every event; this only fabricates them at this legacy boundary.
 * IronsightEvent itself never does — location stays omitted when we don't have real
 * coordinates, which is the whole point of making it optional.
 */
function toConflictEvent(event: IronsightEvent): ConflictEvent {
  return {
    id: event.id,
    date: new Date(event.reportedAt).toISOString(),
    type: event.type,
    location: event.region ?? '',
    lat: event.location?.latitude ?? 0,
    lon: event.location?.longitude ?? 0,
    description: event.title,
    source: event.source.name,
  };
}

export async function GET(req: Request) {
  const { key, server } = getConflictFromRequest(req);
  const adapter = createGoogleNewsConflictAdapter(key, server);
  const { events, health } = await adapter.fetch();

  return NextResponse.json(events.map(toConflictEvent), {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // Not consumed by the UI yet (Phase 2). Inspectable via devtools in the meantime,
      // and gives this route the "no data" vs "feed is broken" distinction the rest of
      // the API routes still lack.
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
