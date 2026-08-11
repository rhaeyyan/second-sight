import { NextResponse } from 'next/server';
import { getConflictFromRequest } from '@/lib/conflicts';
import { createGoogleNewsConflictAdapter } from '@/lib/events/adapters/googleNewsConflict';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { key, server } = getConflictFromRequest(req);
  const adapter = createGoogleNewsConflictAdapter(key, server);
  const { events, health } = await adapter.fetch();

  return NextResponse.json(events, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Source-Health': JSON.stringify(health),
    },
  });
}
