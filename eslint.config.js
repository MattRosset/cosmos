import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Dependency-boundary rules (architecture.md §4):
 * - core-types imports nothing.
 * - orbits / procgen / sim-time import only core-types (pure: no DOM, no Three).
 * - render-* packages import Three.js but never React.
 * - ui imports React but never Three.js.
 * - Deep imports across packages are banned (public API via index.ts only).
 * - Math.random() is banned in procgen/core-types (determinism doctrine).
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/public/**', 'tmpff/**'],
  },
  {
    // Node.js scripts (plain .mjs files — no bundler, no DOM)
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core-types/**', 'packages/procgen/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random() breaks determinism. Use createPrng from @cosmos/core-types.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'This package must stay pure (no Three.js).' },
            { name: 'react', message: 'This package must stay pure (no React).' },
          ],
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/render-*/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'react', message: 'render-* packages must not import React.' }],
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'three', message: 'ui must not import Three.js.' }],
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/app-state/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'three', message: 'app-state must not import Three.js.' }],
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    // §5.8: streaming orchestrates but does not render or use the DOM tree —
    // no Three.js, no React.
    files: ['packages/streaming/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'packages/streaming must not import Three.js (§5.8: it does not render).' },
            { name: 'react', message: 'packages/streaming must not import React.' },
          ],
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    // Hardening track: diagnostics is a framework-agnostic leaf (audit §4.1) —
    // it may be imported by anyone but itself imports only @cosmos/core-types.
    files: ['packages/diagnostics/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'diagnostics must stay framework-agnostic (no Three.js).' },
            { name: 'react', message: 'diagnostics must stay framework-agnostic (no React).' },
            { name: '@sentry/react', message: 'Sentry lives in apps/web (TASK-056), not in diagnostics.' },
          ],
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    // §5.13: workers must not import Three.js, React, procgen, or data
    files: ['packages/workers/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'packages/workers must not import Three.js (§5.13).' },
            { name: 'react', message: 'packages/workers must not import React.' },
            { name: '@cosmos/procgen', message: 'packages/workers must not import @cosmos/procgen (§5.13 cycle ban).' },
            { name: '@cosmos/data', message: 'packages/workers must not import @cosmos/data (§5.13 cycle ban).' },
          ],
          patterns: [
            {
              group: ['@cosmos/*/src/*'],
              message: 'Deep imports banned: use the package public API (index.ts).',
            },
          ],
        },
      ],
    },
  },
);
