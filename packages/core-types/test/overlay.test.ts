import { describe, expect, it } from 'vitest';
import type { ConstellationLineSet, LabelRecord } from '../src/overlay';

describe('ConstellationLineSet shape', () => {
  it('type-checks Orion as HIP pairs', () => {
    const orion: ConstellationLineSet = {
      code: 'Ori',
      name: 'Orion',
      hipPairs: [27989, 26727, 26727, 25336],
    };
    expect(orion.code).toBe('Ori');
    expect(orion.hipPairs).toHaveLength(4);
  });

  it('hipPairs accepts number[] but not string[] (compile-time only)', () => {
    const ok: ConstellationLineSet = { code: 'Ori', name: 'Orion', hipPairs: [1, 2] };
    expect(ok.hipPairs[0]).toBe(1);
    const bad: ConstellationLineSet = {
      code: 'Ori',
      name: 'Orion',
      // @ts-expect-error — hipPairs is number[], not string[]
      hipPairs: ['1', '2'],
    };
    expect(bad).toBeDefined();
  });

  it('rejects mutation of readonly fields (compile-time only)', () => {
    const c: ConstellationLineSet = { code: 'Ori', name: 'Orion', hipPairs: [1, 2] };
    // @ts-expect-error — readonly field cannot be reassigned
    c.code = 'Tau';
    expect(c).toBeDefined();
  });
});

describe('LabelRecord shape', () => {
  it('type-checks a body-anchored label', () => {
    const label: LabelRecord = {
      id: 'sol',
      text: 'Sun',
      positionPc: [0, 0, 0],
      priority: 0,
    };
    expect(label.id).toBe('sol');
    expect(label.priority).toBe(0);
  });
});
