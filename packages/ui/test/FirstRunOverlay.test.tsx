import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstRunOverlay } from '../src/FirstRunOverlay';
import { STRINGS } from '../src/strings';

afterEach(cleanup);

describe('FirstRunOverlay', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<FirstRunOverlay open={false} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('teaches the three movement modes in a modal dialog', () => {
    render(<FirstRunOverlay open onDismiss={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The whole thesis (research §5.1): reveal all three modes exist.
    expect(dialog.textContent).toContain(STRINGS.firstRunJumpTitle);
    expect(dialog.textContent).toContain(STRINGS.firstRunExploreTitle);
    expect(dialog.textContent).toContain(STRINGS.firstRunTourTitle);
  });

  it('dismisses via the button', () => {
    const onDismiss = vi.fn();
    render(<FirstRunOverlay open onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText(STRINGS.firstRunDismiss));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dismisses on Escape while open', () => {
    const onDismiss = vi.fn();
    render(<FirstRunOverlay open onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
