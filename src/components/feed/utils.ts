import type { EventSeverity } from '@/lib/events/schema';

/**
 * Severity -> design-system color token, following the INTENSITY_COLORS / TYPE_COLORS
 * pattern already used by SatellitePanel and ConflictFeed rather than inventing a new one.
 */
export const SEVERITY_COLORS: Record<EventSeverity, string> = {
  info: 'var(--text-secondary)',
  low: 'var(--green)',
  medium: 'var(--amber)',
  high: '#ff6600',
  critical: 'var(--red)',
};

const RTL_LANGUAGE_CODES = new Set(['he', 'ar', 'fa', 'ur']);

/**
 * Whether a BCP-47 language code is written right-to-left, so an event's untranslated
 * `originalTitle` can be rendered with the correct `dir` attribute (draft-implementation-
 * plan.md's Original Language Preservation guardrail).
 */
export function isRtlLanguage(code?: string): boolean {
  if (!code) return false;
  return RTL_LANGUAGE_CODES.has(code.toLowerCase().split('-')[0]);
}

/**
 * Escapes text before it's interpolated into a Leaflet popup's HTML string. Leaflet's
 * `bindPopup(string)` inserts the string as innerHTML, not via React, so react/no-danger
 * never sees it — but event titles come from untrusted feeds (RSS/Telegram/etc.), so this
 * is still an injection point that needs sanitizing before it reaches the DOM.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}
