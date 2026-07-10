import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ModeBadge } from '../src/ModeBadge';

afterEach(cleanup);

describe('ModeBadge', () => {
  it('renders nothing when the label is null', () => {
    const { container } = render(<ModeBadge label={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the label as a status region when provided', () => {
    render(<ModeBadge label="Scale jump" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Scale jump');
  });
});
