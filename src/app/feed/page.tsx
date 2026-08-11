'use client';

import { useUnifiedFeed } from '@/lib/events/useUnifiedFeed';
import UnifiedFeed from '@/components/feed/UnifiedFeed';
import FindingsPanel from '@/components/analysis/FindingsPanel';

// ConflictProvider already wraps the whole app in src/app/layout.tsx, so useConflict()/
// useUnifiedFeed() work here with no extra wrapping.
//
// useUnifiedFeed() is called once here (not inside UnifiedFeed itself) so FindingsPanel
// can share the same fetch/store rather than polling /api/feed a second time —
// FindingsPanel resolves each finding's evidenceEventIds against feedState.store, which
// stays live even while UnifiedFeed's own displayed `events` are frozen by pause.
export default function FeedPage() {
  const feedState = useUnifiedFeed();

  return (
    <div className="h-screen flex flex-col lg:flex-row gap-1 overflow-hidden p-1">
      <div className="flex-[2] min-h-0">
        <UnifiedFeed feedState={feedState} />
      </div>
      <div className="flex-1 min-h-0">
        <FindingsPanel store={feedState.store} />
      </div>
    </div>
  );
}
