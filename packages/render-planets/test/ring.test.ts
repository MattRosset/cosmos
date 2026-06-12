import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildRingGeometry } from '../src/ring.js';

const INNER = 0.5;
const OUTER = 1.0;

describe('buildRingGeometry', () => {
  it('returns a RingGeometry', () => {
    const geom = buildRingGeometry(INNER, OUTER);
    expect(geom).toBeInstanceOf(THREE.RingGeometry);
  });

  it('UV u ≈ 0 at inner radius vertices', () => {
    const geom = buildRingGeometry(INNER, OUTER);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const uv = geom.getAttribute('uv') as THREE.BufferAttribute;

    let found = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.sqrt(x * x + y * y);
      if (Math.abs(r - INNER) < 1e-4) {
        expect(uv.getX(i)).toBeCloseTo(0, 3);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('UV u ≈ 1 at outer radius vertices', () => {
    const geom = buildRingGeometry(INNER, OUTER);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const uv = geom.getAttribute('uv') as THREE.BufferAttribute;

    let found = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.sqrt(x * x + y * y);
      if (Math.abs(r - OUTER) < 1e-4) {
        expect(uv.getX(i)).toBeCloseTo(1, 3);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('v coordinate is always 0.5', () => {
    const geom = buildRingGeometry(INNER, OUTER);
    const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getY(i)).toBeCloseTo(0.5, 10);
    }
  });

  it('works with custom thetaSegments', () => {
    const geom = buildRingGeometry(INNER, OUTER, 32);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.count).toBeGreaterThan(0);
  });
});
