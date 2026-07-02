import { describe, expect, it } from 'vitest';
import { createFlightController } from '../src/index';

describe('@cosmos/nav public API', () => {
  it('re-exports the frozen surface', () => {
    expect(createFlightController).toBeTypeOf('function');
  });
});
