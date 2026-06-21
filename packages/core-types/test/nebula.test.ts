import { describe, expect, it } from 'vitest';
import { MAX_NEBULA_LAYERS } from '../src/nebula';
import type { NebulaField, NebulaLayer } from '../src/nebula';

describe('MAX_NEBULA_LAYERS (§5.11 overdraw cap)', () => {
  it('is 32', () => {
    expect(MAX_NEBULA_LAYERS).toBe(32);
  });
});

describe('NebulaField / NebulaLayer shape', () => {
  it('type-checks a valid field with one layer', () => {
    const layer: NebulaLayer = {
      centerUnits: [120, 40, -10],
      radiusUnits: 300,
      colorLinear: [0.4, 0.2, 0.5],
      opacity: 0.3,
      seed: 7,
    };
    const field: NebulaField = {
      id: 'orion-neb',
      originPc: [0, 0, 0],
      layers: [layer],
    };
    expect(field.layers).toHaveLength(1);
    expect(field.layers[0]?.seed).toBe(7);
  });

  it('rejects a NebulaField missing layers (compile-time only)', () => {
    // @ts-expect-error — layers is required
    const field: NebulaField = { id: 'x', originPc: [0, 0, 0] };
    expect(field).toBeDefined();
  });

  it('rejects mutation of readonly fields (compile-time only)', () => {
    const layer: NebulaLayer = {
      centerUnits: [0, 0, 0],
      radiusUnits: 1,
      colorLinear: [0, 0, 0],
      opacity: 1,
      seed: 0,
    };
    // @ts-expect-error — readonly field cannot be reassigned
    layer.opacity = 0.5;
    expect(layer).toBeDefined();
  });
});
