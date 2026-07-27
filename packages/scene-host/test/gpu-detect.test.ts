import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyRenderer, detectInitialTier } from '../src/gpu-detect';

describe('classifyRenderer', () => {
  it.each([
    ['Apple M1', 'integrated'],
    ['Apple M3 Pro', 'integrated'],
    ['Intel(R) Iris(R) Xe', 'integrated'],
    ['Intel HD Graphics 620', 'integrated'],
    ['ANGLE Metal Renderer: Apple M1', 'integrated'],
    ['NVIDIA GeForce RTX 4090', 'unknown'],
    ['AMD Radeon RX 9070 XT', 'unknown'],
    ['SwiftShader Device (LLVM 10.0.0)', 'unknown'],
    ['ANGLE/SwiftShader', 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
  ] as const)('classifies %s as %s', (renderer, expected) => {
    expect(classifyRenderer(renderer)).toBe(expected);
  });
});

describe('detectInitialTier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockGl(renderer: string | null): void {
    const ext = renderer !== null ? { UNMASKED_RENDERER_WEBGL: 1 } : null;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          getExtension: () => ext,
          getParameter: () => renderer,
        }) as unknown as WebGLRenderingContext,
    );
  }

  it('maps an integrated renderer to medium', () => {
    mockGl('Apple M1');
    expect(detectInitialTier()).toBe('medium');
  });

  it('maps an unknown/discrete renderer to high', () => {
    mockGl('NVIDIA GeForce RTX 4090');
    expect(detectInitialTier()).toBe('high');
  });

  it('maps a measured SwiftShader CI renderer to high', () => {
    mockGl('SwiftShader Device (LLVM 10.0.0)');
    expect(detectInitialTier()).toBe('high');
  });

  it('falls back to high when no WebGL context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(detectInitialTier()).toBe('high');
  });

  it('falls back to high when getContext throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('context creation failed');
    });
    expect(detectInitialTier()).toBe('high');
  });

  it('falls back to high when the debug-renderer-info extension is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          getExtension: () => null,
          getParameter: () => null,
        }) as unknown as WebGLRenderingContext,
    );
    expect(detectInitialTier()).toBe('high');
  });
});
