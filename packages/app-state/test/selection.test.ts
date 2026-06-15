import { afterEach, describe, expect, it } from 'vitest';
import { useSelectionStore } from '../src/selection';
import { useSettingsStore, EXPOSURE_DEFAULT } from '../src/settings';

afterEach(() => {
  useSelectionStore.setState({ selectedId: null });
  useSettingsStore.setState({ exposure: EXPOSURE_DEFAULT });
});

describe('useSelectionStore', () => {
  it('starts with null selection', () => {
    expect(useSelectionStore.getState().selectedId).toBeNull();
  });

  it('select/read round-trip', () => {
    useSelectionStore.getState().select('hyg:32263');
    expect(useSelectionStore.getState().selectedId).toBe('hyg:32263');
  });

  it('select(null) clears', () => {
    useSelectionStore.getState().select('hyg:32263');
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().selectedId).toBeNull();
  });
});

describe('useSettingsStore', () => {
  it('starts at the default exposure (rich local field)', () => {
    expect(useSettingsStore.getState().exposure).toBe(EXPOSURE_DEFAULT);
  });

  it('setExposure clamps low (0.01 → 0.1)', () => {
    useSettingsStore.getState().setExposure(0.01);
    expect(useSettingsStore.getState().exposure).toBe(0.1);
  });

  it('setExposure clamps high (1000 → 200)', () => {
    useSettingsStore.getState().setExposure(1000);
    expect(useSettingsStore.getState().exposure).toBe(200);
  });

  it('setExposure accepts valid value', () => {
    useSettingsStore.getState().setExposure(3.5);
    expect(useSettingsStore.getState().exposure).toBe(3.5);
  });
});
