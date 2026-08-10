import { expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';

// vitest-axe@0.1.0's own 'vitest-axe/extend-expect' entry point doesn't work against
// this repo's vitest/@testing-library versions: its runtime half
// (dist/extend-expect.js) ships as a literal 0-byte file, registering nothing on
// `expect` at runtime, and its type half augments a pre-4.x `Vi` namespace that modern
// vitest's `Assertion<T>` (re-exported through the `vitest` module, see how
// @testing-library/jest-dom/types/vitest.d.ts does this same merge for
// `toBeInTheDocument`) never reaches. Both halves are reimplemented here instead of
// relying on the package's own (broken) entry point.
declare module 'vitest' {
  // Must match @vitest/expect's own `Assertion<T = any>` signature — declaration
  // merging requires identical type parameter defaults.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends AxeMatchers {}
}
expect.extend(axeMatchers);
