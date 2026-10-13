// ESLint — here for one rule: `no-undef`.
//
// Run: npm run lint
//
// ── Why ─────────────────────────────────────────────────────────────────────
//
// Two bugs reached the deployed bundle in one week, both the same shape: a
// bare identifier with nothing in scope binding it.
//
//   PetSharing.jsx   getMembers() said `await supabase` after the lazy-client
//                    conversion renamed the import to `getSupabase`. Opening
//                    the share panel threw "Can't find variable: supabase".
//                    A customer reported it. (#69)
//   AddPetModal.jsx  handleChange referenced RECOMMENDATIONS after that
//                    constant moved to src/lib/careSuggestions.js, so changing
//                    the species dropdown threw a ReferenceError. (#101/#104)
//
// Neither was caught by anything. Vite/Rollup do not error on undefined
// globals — an unbound identifier is valid JavaScript right up to the moment
// the line runs — and no test opened those code paths.
//
// So `no-undef` is the point of this file, with `no-unused-vars` beside it
// because a half-finished rename usually leaves one of each. Everything else
// here exists to keep those two honest: the globals lists are what stop them
// crying wolf, and every rule switched off below says why in a line.

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

// Injected by Vite's `define` (see vite.config.js). Real at runtime, invisible
// to a static read of the source, so they have to be declared or every use of
// the build banner is a false no-undef.
const viteDefines = {
  __BUILD_ID__: 'readonly',
  __BUILD_TIME__: 'readonly',
}

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'data/**', '.claude/**', 'supabase/**'],
  },

  js.configs.recommended,

  // Shared rule intent, whatever the environment.
  {
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', {
        args: 'after-used',
        // A named-but-unused catch binding (`catch (e) {}`) is a style
        // preference, not a bug, and the codebase has plenty. Unused
        // variables and imports — the ones that mark a half-finished rename —
        // are still errors.
        caughtErrors: 'none',
        // An underscore prefix is the explicit "yes, unused" marker.
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
      }],
      // `catch {}` is how this codebase says "best effort, never break the
      // page over this", and it says it deliberately in a dozen places. The
      // rule still catches an empty `if` or `for` body.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── The app: browser ──────────────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...viteDefines },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules, // no `import React` needed

      // The two classic hook rules, named rather than taken from the plugin's
      // `recommended` preset. That preset is now the React Compiler rule set
      // (set-state-in-effect, purity, immutability, static-components and
      // friends) — 47 findings on this tree, none of them a crash, and this
      // build has no compiler to enforce them for. Worth adopting one rule at
      // a time, on purpose; not worth bundling with the rule that catches
      // ReferenceErrors.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Off: this is plain JSX with no TypeScript, so prop-types would demand
      // a hand-written shape declaration for every component in the app —
      // hundreds of findings, none of them a bug. Declining to document props
      // is not the class of mistake this config is here to catch.
      'react/prop-types': 'off',

      // Off: 74 findings, every one an apostrophe or quote in ordinary English
      // prose inside JSX ("Pippy's", "don't"). React renders them correctly.
      // Rewriting them as &apos; would make the copy harder to read.
      'react/no-unescaped-entities': 'off',
    },
  },

  // ── The service worker: its own globals ───────────────────────────────────
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  // ── Scripts, serverless functions, build config: node ─────────────────────
  {
    files: ['scripts/**/*.{js,mjs}', 'api/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // ── The walk scripts: node, plus the page they drive ──────────────────────
  //
  // These drive a real browser with Playwright. The body of a
  // `page.evaluate(() => ...)` is serialised and run inside the page, so
  // `document`, `window` and `sessionStorage` in those callbacks are real —
  // but they are lexically inside a Node file, and no amount of static
  // reading can tell ESLint which side of that boundary a line is on.
  //
  // Listed by name rather than by glob: the other ~45 `scripts/test-*.mjs`
  // are pure Node unit tests, and in those a bare `document` really is a
  // mistake worth being told about.
  {
    files: [
      'scripts/test-admin-claim-approve.mjs',
      'scripts/test-inform-provider.mjs',
      'scripts/test-provider-book-ui.mjs',
      'scripts/test-provider-book-vet.mjs',
      'scripts/test-provider-details.mjs',
      'scripts/test-provider-inbox-ui.mjs',
      'scripts/test-provider-landing.mjs',
      'scripts/test-provider-switch.mjs',
      'scripts/test-provider-voice.mjs',
      'scripts/test-register-duplicate.mjs',
      'scripts/test-walk-customer.mjs',
      'scripts/test-walk-provider.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
]
