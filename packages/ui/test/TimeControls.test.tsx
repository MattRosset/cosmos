import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimeStore } from '@cosmos/app-state';
import { TimeControls } from '../src/TimeControls';

const DEFAULT_STATE = { paused: false, accel: 1, epochJD: 2451545.0 };

afterEach(() => {
  useTimeStore.setState(DEFAULT_STATE);
  cleanup();
  vi.restoreAllMocks();
});

describe('TimeControls — pause/resume toggle', () => {
  it('⏸ button pauses when running', async () => {
    const user = userEvent.setup();
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /pause/i }));
    expect(useTimeStore.getState().paused).toBe(true);
  });

  it('▶ button resumes when paused', async () => {
    const user = userEvent.setup();
    useTimeStore.setState({ paused: true });
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /resume/i }));
    expect(useTimeStore.getState().paused).toBe(false);
  });
});

describe('TimeControls — forward stepper (⏩)', () => {
  it('steps through ACCEL_STEPS in order: 1 → 10 → 100 → …', async () => {
    const user = userEvent.setup();
    render(<TimeControls />);
    const fwd = screen.getByRole('button', { name: /forward faster/i });

    await user.click(fwd);
    expect(useTimeStore.getState().accel).toBe(10);
    await user.click(fwd);
    expect(useTimeStore.getState().accel).toBe(100);
    await user.click(fwd);
    expect(useTimeStore.getState().accel).toBe(1000);
  });

  it('saturates at 1e7', async () => {
    const user = userEvent.setup();
    useTimeStore.setState({ accel: 1e7 });
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /forward faster/i }));
    expect(useTimeStore.getState().accel).toBe(1e7);
  });

  it('resets to +1 when accel is negative', async () => {
    const user = userEvent.setup();
    useTimeStore.setState({ accel: -100 });
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /forward faster/i }));
    expect(useTimeStore.getState().accel).toBe(1);
  });
});

describe('TimeControls — reverse stepper (⏪)', () => {
  it('resets to -1 from positive accel', async () => {
    const user = userEvent.setup();
    useTimeStore.setState({ accel: 100 });
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /reverse faster/i }));
    expect(useTimeStore.getState().accel).toBe(-1);
  });

  it('steps deeper negative from negative accel', async () => {
    const user = userEvent.setup();
    useTimeStore.setState({ accel: -1 });
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /reverse faster/i }));
    expect(useTimeStore.getState().accel).toBe(-10);
  });

  it('saturates at -1e7', async () => {
    const user = userEvent.setup();
    useTimeStore.setState({ accel: -1e7 });
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /reverse faster/i }));
    expect(useTimeStore.getState().accel).toBe(-1e7);
  });
});

describe('TimeControls — 1× reset', () => {
  it('resets accel to 1', async () => {
    const user = userEvent.setup();
    useTimeStore.setState({ accel: 1e5 });
    render(<TimeControls />);
    await user.click(screen.getByRole('button', { name: /reset to.*speed/i }));
    expect(useTimeStore.getState().accel).toBe(1);
  });
});

describe('TimeControls — Now button', () => {
  it('hidden when onSyncToNow is not provided', () => {
    render(<TimeControls />);
    expect(screen.queryByRole('button', { name: /sync to now/i })).toBeNull();
  });

  it('visible and fires when provided', async () => {
    const user = userEvent.setup();
    const onSyncToNow = vi.fn();
    render(<TimeControls onSyncToNow={onSyncToNow} />);
    const btn = screen.getByRole('button', { name: /sync to now/i });
    expect(btn).not.toBeNull();
    await user.click(btn);
    expect(onSyncToNow).toHaveBeenCalledOnce();
  });
});

describe('TimeControls — epoch readout', () => {
  it('re-renders when syncEpochJD is called', () => {
    render(<TimeControls />);
    expect(screen.getByText(/2000-01-01/)).not.toBeNull();

    act(() => {
      useTimeStore.getState().syncEpochJD(2451546.0);
    });

    expect(screen.getByText(/2000-01-02/)).not.toBeNull();
  });
});
