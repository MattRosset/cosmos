import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScaleRuler } from '../src/ScaleRuler';
import { SCALE_RULER_SEGMENTS } from '../src/scale-ruler';

afterEach(cleanup);

describe('ScaleRuler', () => {
  it('renders every segment with its data-segment id, in scale order', () => {
    const { container } = render(<ScaleRuler active={null} />);
    const segs = [...container.querySelectorAll('.cosmos-ui-ruler-seg')];
    expect(segs.map((el) => el.getAttribute('data-segment'))).toEqual([...SCALE_RULER_SEGMENTS]);
    expect(container.querySelector('.cosmos-ui-ruler-seg--active')).toBeNull();
  });

  it('highlights exactly the active segment', () => {
    const { container } = render(<ScaleRuler active="galactic-survey" />);
    const active = [...container.querySelectorAll('.cosmos-ui-ruler-seg--active')];
    expect(active).toHaveLength(1);
    expect(active[0]!.getAttribute('data-segment')).toBe('galactic-survey');
  });
});
