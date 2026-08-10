'use client';

import UnifiedFeed from '@/components/feed/UnifiedFeed';

// ConflictProvider already wraps the whole app in src/app/layout.tsx, so useConflict()/
// useUnifiedFeed() work here with no extra wrapping.
export default function FeedPage() {
  return (
    <div className="h-screen flex flex-col overflow-hidden p-1">
      <UnifiedFeed />
    </div>
  );
}
