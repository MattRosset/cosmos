import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JumpHud } from '../src/JumpHud';
import { JUMP_HUD_IDLE, beginJump, endJump } from '../src/jump-hud-model';

afterEach(cleanup);

const noop = (): void => {};
const JUMPING = beginJump(49_000, { largeJumpCount: 0, letterboxShown: false })!;

describe('JumpHud', () => {
  it('renders nothing while idle', () => {
    const { container } = render(
      <JumpHud model={JUMP_HUD_IDLE} durationS={null} fieldOfViewLy={null} onDismiss={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('while jumping: live ly remaining + the @ c equivalent', () => {
    render(<JumpHud model={JUMPING} durationS={null} fieldOfViewLy={null} onDismiss={noop} />);
    const hud = screen.getByRole('status');
    expect(hud.className).toContain('cosmos-ui-jump--jumping');
    expect(hud.textContent).toContain('ly remaining');
    expect(hud.textContent).toContain('at c');
  });

  it('full arrival card: jumped ly + duration, @ c line, field-of-view line, dismiss', async () => {
    const onDismiss = vi.fn();
    render(
      <JumpHud
        model={endJump(JUMPING, true)}
        durationS={5.04}
        fieldOfViewLy={320_000}
        onDismiss={onDismiss}
      />,
    );
    const card = screen.getByRole('status');
    expect(card.className).toContain('cosmos-ui-jump--full');
    expect(card.textContent).toMatch(/Jumped ~[\d,]+ ly in 5 s/);
    expect(card.textContent).toContain('at c');
    expect(card.textContent).toMatch(/years/);
    expect(card.textContent).toContain('Field of view');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dampened arrival: single-line variant without duration/fov/dismiss', () => {
    const damped = beginJump(49_000, { largeJumpCount: 3, letterboxShown: true })!;
    render(
      <JumpHud model={endJump(damped, true)} durationS={5} fieldOfViewLy={1} onDismiss={noop} />,
    );
    const card = screen.getByRole('status');
    expect(card.className).toContain('cosmos-ui-jump--brief');
    expect(card.textContent).toMatch(/Jumped ~[\d,]+ ly — at c:/);
    expect(card.textContent).not.toContain('Field of view');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
