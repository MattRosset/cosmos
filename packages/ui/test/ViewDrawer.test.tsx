import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOverlayStore, useSettingsStore, EXPOSURE_DEFAULT } from '@cosmos/app-state';
import { ViewDrawer } from '../src/ViewDrawer';

afterEach(() => {
  useOverlayStore.setState({ constellations: false, labels: false, cinematic: false });
  useSettingsStore.setState({ exposure: EXPOSURE_DEFAULT });
  cleanup();
  vi.restoreAllMocks();
});

function renderDrawer(autoHide = true, onAutoHideChange = vi.fn()) {
  render(<ViewDrawer autoHide={autoHide} onAutoHideChange={onAutoHideChange} />);
  return onAutoHideChange;
}

describe('ViewDrawer — open/close', () => {
  it('starts closed; the toggle opens the unified surface', async () => {
    const user = userEvent.setup();
    renderDrawer();
    expect(screen.queryByRole('group', { name: 'View settings' })).toBeNull();

    const toggle = screen.getByRole('button', { name: 'View settings' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);

    expect(screen.getByRole('group', { name: 'View settings' })).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // The one surface holds ALL of it: exposure + overlays + auto-hide (V3).
    expect(screen.getByRole('group', { name: 'Star brightness' })).not.toBeNull();
    for (const name of ['Constellations', 'Labels', 'Cinematic', 'Auto-hide controls']) {
      expect(screen.getByRole('button', { name })).not.toBeNull();
    }
  });
});

describe('ViewDrawer — store wiring', () => {
  it('overlay toggles read/write useOverlayStore directly', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'View settings' }));

    await user.click(screen.getByRole('button', { name: 'Constellations' }));
    expect(useOverlayStore.getState().constellations).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cinematic' }));
    expect(useOverlayStore.getState().cinematic).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Constellations' }));
    expect(useOverlayStore.getState().constellations).toBe(false);
  });

  it('the exposure slider writes useSettingsStore', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'View settings' }));

    const slider = screen.getByRole('slider');
    const before = useSettingsStore.getState().exposure;
    fireEvent.change(slider, { target: { value: '900' } });
    expect(useSettingsStore.getState().exposure).not.toBe(before);
  });
});

describe('ViewDrawer — auto-hide controlled props (V2)', () => {
  it('reflects the prop and reports changes without owning state', async () => {
    const user = userEvent.setup();
    const onChange = renderDrawer(true);
    await user.click(screen.getByRole('button', { name: 'View settings' }));

    const autoHideBtn = screen.getByRole('button', { name: 'Auto-hide controls' });
    expect(autoHideBtn.getAttribute('aria-pressed')).toBe('true');
    await user.click(autoHideBtn);
    expect(onChange).toHaveBeenCalledWith(false);
    // Controlled: the pressed state only moves when the prop does.
    expect(autoHideBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('autoHide=false renders unpressed and requests true on click', async () => {
    const user = userEvent.setup();
    const onChange = renderDrawer(false);
    await user.click(screen.getByRole('button', { name: 'View settings' }));

    const autoHideBtn = screen.getByRole('button', { name: 'Auto-hide controls' });
    expect(autoHideBtn.getAttribute('aria-pressed')).toBe('false');
    await user.click(autoHideBtn);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
