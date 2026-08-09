import next from 'eslint-config-next';

// Rules below are scoped to match the globs eslint-config-next registers each plugin
// under — in flat config a plugin is only resolvable for files its config object covers.
const config = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...next,
  {
    // `@typescript-eslint` is registered for TS files only.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // External payloads are validated at the boundary, so `any` is never the answer.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    rules: {
      // IRONSIGHT renders untrusted third-party text (RSS, Telegram, external APIs).
      // Raw HTML injection is banned outright — there are zero usages today. If it ever
      // becomes unavoidable, sanitize with DOMPurify and disable this rule at that one
      // call site with a comment explaining why.
      'react/no-danger': 'error',
    },
  },
];

export default config;
