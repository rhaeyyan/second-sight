'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useUnifiedFeed } from '@/lib/events/useUnifiedFeed';
import { useSupplementaryFeeds } from '@/lib/events/useSupplementaryFeeds';
import { useConflict } from '@/lib/conflicts/context';
import UnifiedFeed from '@/components/feed/UnifiedFeed';
import FindingsPanel from '@/components/analysis/FindingsPanel';
import ThreatBar from '@/components/feed/ThreatBar';

const ConflictMap = dynamic(() => import('@/components/map/ConflictMap'), {
  ssr: false,
  loading: () => <div className="panel h-full loading-shimmer" />,
});

// ConflictProvider already wraps the whole app in src/app/layout.tsx, so useConflict()/
// useUnifiedFeed() work here with no extra wrapping.
//
// useUnifiedFeed() is called once here (not inside UnifiedFeed itself) so FindingsPanel
// can share the same fetch/store rather than polling /api/feed a second time —
// FindingsPanel resolves each finding's evidenceEventIds against feedState.store, which
// stays live even while UnifiedFeed's own displayed `events` are frozen by pause.
export default function FeedPage() {
  const { key: conflictKey } = useConflict();
  const feedState = useUnifiedFeed();
  const [highlightedEventIds, setHighlightedEventIds] = useState<Set<string>>(new Set());

  // Activate supplementary polling (alerts, drones, flights, telegram, strikes)
  useSupplementaryFeeds(feedState.store, conflictKey);

  const handleEvidenceClick = useCallback((eventId: string) => {
    setHighlightedEventIds(new Set([eventId]));
    // Clear highlight after 3 seconds
    setTimeout(() => {
      setHighlightedEventIds((prev) => {
        if (prev.has(eventId)) {
          const next = new Set(prev);
          next.delete(eventId);
          return next;
        }
        return prev;
      });
    }, 3000);
  }, []);

  return (
    <div className="h-screen flex flex-col gap-1 overflow-hidden p-1 bg-[var(--bg-primary)]">
      {/* Top: ThreatBar */}
      <div className="shrink-0">
        <ThreatBar />
      </div>
      
      {/* Main Grid: Responsive stack on <1024px, 4-panel grid on lg+ */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 lg:grid-rows-2 gap-1 overflow-hidden">
        
        {/* Left Panel: ConflictMap */}
        <div className="lg:col-span-7 lg:row-span-2 min-h-[50vh] lg:min-h-0">
          <ConflictMap key={conflictKey} className="h-full w-full" />
        </div>
        
        {/* Right Top: Intel Feed */}
        <div className="lg:col-span-5 lg:row-span-1 min-h-[40vh] lg:min-h-0 overflow-hidden flex flex-col">
          <UnifiedFeed feedState={feedState} highlightedIds={highlightedEventIds} />
        </div>
        
        {/* Right Bottom: Analysis Findings */}
        <div className="lg:col-span-5 lg:row-span-1 min-h-[40vh] lg:min-h-0 overflow-hidden flex flex-col">
          <FindingsPanel store={feedState.store} onEvidenceClick={handleEvidenceClick} />
        </div>
        
      </div>
    </div>
  );
}
