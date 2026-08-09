# WCAG 2.2 Level AA — Accessibility Checklist

Target standard: **WCAG 2.2 Level AA** plus the **WAI-ARIA Authoring Practices Guide (APG)**
patterns for interactive widgets. (WCAG 3.0 is still a W3C working draft — do not claim
conformance to it.)

## 1. Semantic Hierarchy
- **Rule:** If a native HTML element exists for a role (e.g., `<button>`, `<nav>`, `<main>`), it MUST be used instead of `<div role="...">`.
- **Level:** Critical.

## 2. ARIA APG Patterns
- **Live Regions:** Use `aria-live="polite"` for dynamic content updates; `aria-live="assertive"` only for critical errors.
- **Forms:** All inputs must have associated `<label>` tags. `placeholder` is NOT a substitute for a label.
- **Widgets:** Follow the APG pattern (roles, states, keyboard interaction) for any custom component: https://www.w3.org/WAI/ARIA/apg/patterns/

## 3. Visual Inclusivity
- **Contrast:** Minimum 4.5:1 for normal text, 3:1 for large text and UI components (SC 1.4.3, 1.4.11).
- **Focus:** Never set `outline: none` without a high-visibility `:focus-visible` alternative; focused elements must not be fully obscured (SC 2.4.11, new in 2.2).
- **Target Size:** Interactive targets at least 24×24 CSS px (SC 2.5.8, new in 2.2).
- **Motion:** Respect `(prefers-reduced-motion: reduce)` by disabling non-functional animations.

## 4. Mechanical Verification (run these — don't eyeball)
- **Automated audit:** `axe-core` (or `@axe-core/playwright` / `jest-axe`) in the test suite.
- **Lint:** `eslint-plugin-jsx-a11y` for React, or the framework equivalent.
- **Keyboard only:** Full application functionality must be operable without a mouse.
- **Screen reader:** All interactive elements reachable and identifiable via NVDA/VoiceOver.
