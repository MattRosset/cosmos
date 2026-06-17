import { QUALITY_TIERS } from '@cosmos/core-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QualityControllerImpl } from '../src/quality';

describe('QualityControllerImpl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initialises to the given tier', () => {
    const qc = new QualityControllerImpl('high');
    expect(qc.tier).toBe('high');
    expect(qc.settings).toEqual(QUALITY_TIERS.high);
  });

  it('defaults to high when no tier given', () => {
    const qc = new QualityControllerImpl();
    expect(qc.tier).toBe('high');
  });

  it('can be initialised at medium or low', () => {
    expect(new QualityControllerImpl('medium').tier).toBe('medium');
    expect(new QualityControllerImpl('low').tier).toBe('low');
  });

  describe('stepDown / stepUp (automatic control)', () => {
    it('steps high → medium on decline, then medium → low', () => {
      const qc = new QualityControllerImpl('high');
      qc.stepDown();
      vi.runAllTimers();
      expect(qc.tier).toBe('medium');

      qc.stepDown();
      vi.runAllTimers();
      expect(qc.tier).toBe('low');
    });

    it('does not go below low', () => {
      const qc = new QualityControllerImpl('low');
      qc.stepDown();
      vi.runAllTimers();
      expect(qc.tier).toBe('low');
    });

    it('steps low → medium on incline, then medium → high', () => {
      const qc = new QualityControllerImpl('low');
      qc.stepUp();
      vi.runAllTimers();
      expect(qc.tier).toBe('medium');

      qc.stepUp();
      vi.runAllTimers();
      expect(qc.tier).toBe('high');
    });

    it('does not go above high', () => {
      const qc = new QualityControllerImpl('high');
      qc.stepUp();
      vi.runAllTimers();
      expect(qc.tier).toBe('high');
    });

    it('debounces: multiple rapid declines count as one step', () => {
      const qc = new QualityControllerImpl('high');
      qc.stepDown();
      qc.stepDown();
      qc.stepDown();
      vi.runAllTimers();
      // Only one step should have fired within the debounce window
      expect(qc.tier).toBe('medium');
    });

    it('debounces: changes do not fire until the debounce window elapses', () => {
      const qc = new QualityControllerImpl('high');
      const spy = vi.fn();
      qc.onChange(spy);

      qc.stepDown();
      expect(spy).not.toHaveBeenCalled(); // not yet fired
      expect(qc.tier).toBe('high'); // tier not yet applied

      vi.runAllTimers();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(qc.tier).toBe('medium');
    });
  });

  describe('setTier (manual override)', () => {
    it('applies immediately and freezes automatic control', () => {
      const qc = new QualityControllerImpl('high');
      qc.setTier('low');
      expect(qc.tier).toBe('low');

      // Automatic step-up should be ignored
      qc.stepUp();
      vi.runAllTimers();
      expect(qc.tier).toBe('low');
    });

    it('setTier(null) resumes automatic control', () => {
      const qc = new QualityControllerImpl('high');
      qc.setTier('low');
      qc.setTier(null);

      qc.stepUp();
      vi.runAllTimers();
      expect(qc.tier).toBe('medium');
    });

    it('cancels any pending debounced change', () => {
      const qc = new QualityControllerImpl('high');
      const spy = vi.fn();
      qc.onChange(spy);

      qc.stepDown(); // schedules debounced change to medium
      qc.setTier('low'); // cancels the pending change, applies low immediately
      vi.runAllTimers(); // pending timer is gone — no further change fires

      expect(qc.tier).toBe('low');
      // onChange fired once for the setTier('low') call
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(QUALITY_TIERS.low);
    });
  });

  describe('onChange subscriptions', () => {
    it('fires once per actual tier change', () => {
      const qc = new QualityControllerImpl('high');
      const spy = vi.fn();
      qc.onChange(spy);

      qc.stepDown();
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(QUALITY_TIERS.medium);
    });

    it('does not fire when tier does not change', () => {
      const qc = new QualityControllerImpl('low');
      const spy = vi.fn();
      qc.onChange(spy);

      qc.stepDown(); // already at low — no change
      vi.runAllTimers();
      expect(spy).not.toHaveBeenCalled();
    });

    it('unsubscribe stops future notifications', () => {
      const qc = new QualityControllerImpl('high');
      const spy = vi.fn();
      const unsub = qc.onChange(spy);
      unsub();

      qc.stepDown();
      vi.runAllTimers();
      expect(spy).not.toHaveBeenCalled();
    });

    it('a throwing handler does not block subsequent handlers', () => {
      const qc = new QualityControllerImpl('high');
      const throwing = vi.fn(() => { throw new Error('boom'); });
      const safe = vi.fn();

      qc.onChange(throwing);
      qc.onChange(safe);

      qc.stepDown();
      vi.runAllTimers();

      expect(throwing).toHaveBeenCalled();
      expect(safe).toHaveBeenCalled();
    });

    it('deduplicates: same-tier setTier does not fire onChange', () => {
      const qc = new QualityControllerImpl('high');
      const spy = vi.fn();
      qc.onChange(spy);

      qc.setTier('high'); // tier stays 'high'
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('disableAutoQuality semantics (controller-level)', () => {
    it('stepDown/stepUp are no-ops while override is active', () => {
      const qc = new QualityControllerImpl('high');
      qc.setTier('medium'); // override active
      qc.stepDown();
      vi.runAllTimers();
      expect(qc.tier).toBe('medium');
    });
  });
});
