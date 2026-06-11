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
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
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
);
