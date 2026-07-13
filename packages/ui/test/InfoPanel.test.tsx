import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSelectionStore } from '@cosmos/app-state';
import { InfoPanel } from '../src/InfoPanel';
import type { BodyLookupAdapter } from '../src/types';
import type { PlanetRecord, GalaxyRecord, StarRecord } from '@cosmos/core-types';

const SIRIUS: StarRecord = {
  id: 'hyg:32263',
  kind: 'star',
  name: 'Sirius',
  positionPc: [-1.8, -1.9, -0.4],
  absMag: 1.45,
  colorIndexBV: 0.009,
};

function makeAdapter(star: StarRecord | null = SIRIUS): BodyLookupAdapter {
  return {
    search: vi.fn().mockReturnValue([]),
    getBody: vi.fn().mockReturnValue(star),
  };
}

afterEach(() => {
  useSelectionStore.setState({ selectedId: null });
  cleanup();
  vi.restoreAllMocks();
});

describe('InfoPanel — hidden state', () => {
  it('renders nothing when selectedId is null', () => {
    render(<InfoPanel adapter={makeAdapter()} onGoTo={vi.fn()} />);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('InfoPanel — star data display', () => {
  it('shows name, hero ly metric, absMag, spectral class, HIP', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    const { container } = render(<InfoPanel adapter={makeAdapter(SIRIUS)} onGoTo={vi.fn()} />);

    // Name
    expect(screen.getByText('Sirius')).not.toBeNull();

    // C6 hero: ly + light-travel phrase, no pc in the primary block.
    // sqrt(1.8²+1.9²+0.4²) = sqrt(7.01) ≈ 2.648 → 2.65 pc, 8.64 ly
    const distEl = container.querySelector('.cosmos-ui-info-distance')!;
    expect(distEl.textContent).toContain('8.64 ly');
    expect(distEl.textContent).toContain('light takes');
    expect(distEl.textContent).not.toContain('pc'); // pc moved out of the primary line
    // @ c ETA line present
    expect(screen.getByText(/at c:/)).not.toBeNull();
    // pc still available as a secondary detail
    expect(screen.getByText(/2\.65 pc/)).not.toBeNull();

    // absMag
    expect(screen.getByText('1.45')).not.toBeNull();

    // Spectral class: bv=0.009 → A
    const spectralEl = screen.getByText(/A \(B−V/);
    expect(spectralEl).not.toBeNull();

    // HIP
    expect(screen.getByText('32263')).not.toBeNull();
  });

  it('C1/C2: plain-language class + naked-eye visibility lines', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    render(<InfoPanel adapter={makeAdapter(SIRIUS)} onGoTo={vi.fn()} />);
    // bv=0.009 → A-class line; m = 1.45 + 5·log10(0.265) ≈ −1.4 → naked-eye.
    expect(screen.getByText('White star — hotter than the Sun')).not.toBeNull();
    expect(screen.getByText('Visible to the naked eye')).not.toBeNull();
  });

  it('C2: a faint distant star reads as telescope-only', () => {
    const faint: StarRecord = {
      id: 'hyg:7',
      kind: 'star',
      name: 'Faint',
      positionPc: [400, 0, 0], // M=5 at 400 pc → m ≈ 13
      absMag: 5,
      colorIndexBV: 0.65,
    };
    useSelectionStore.setState({ selectedId: 'hyg:7' });
    render(<InfoPanel adapter={makeAdapter(faint)} onGoTo={vi.fn()} />);
    expect(screen.getByText('Needs binoculars or a telescope')).not.toBeNull();
    expect(screen.getByText('Yellow dwarf — similar to the Sun')).not.toBeNull();
  });

  it('C6: expert details row is collapsed by default', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    const { container } = render(<InfoPanel adapter={makeAdapter(SIRIUS)} onGoTo={vi.fn()} />);
    const details = container.querySelector<HTMLDetailsElement>('.cosmos-ui-info-details')!;
    expect(details.open).toBe(false);
    // The demoted values still live inside it.
    expect(details.textContent).toContain('pc');
  });

  it('C7: the panel carries the spectral tint as a CSS variable', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    const { container } = render(<InfoPanel adapter={makeAdapter(SIRIUS)} onGoTo={vi.fn()} />);
    const panel = container.querySelector<HTMLElement>('.cosmos-ui-info')!;
    expect(panel.style.getPropertyValue('--cosmos-info-tint')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('formats distance to 3 significant digits', () => {
    const star: StarRecord = {
      id: 'hyg:1',
      kind: 'star',
      name: 'Test',
      positionPc: [10, 0, 0],
      absMag: 5,
      colorIndexBV: 0.65,
    };
    useSelectionStore.setState({ selectedId: 'hyg:1' });
    render(<InfoPanel adapter={makeAdapter(star)} onGoTo={vi.fn()} />);
    // dist = 10.0 pc → primary "32.6 ly", pc demoted to "10 pc" detail row
    expect(screen.getByText(/32\.6 ly/)).not.toBeNull();
    expect(screen.getByText('10 pc')).not.toBeNull();
  });

  it('does not show HIP for non-hyg ids', () => {
    const star: StarRecord = {
      id: 'proc:gal0:sec0:1',
      kind: 'star',
      positionPc: [5, 0, 0],
      absMag: 4,
      colorIndexBV: 1.0,
    };
    useSelectionStore.setState({ selectedId: 'proc:gal0:sec0:1' });
    render(<InfoPanel adapter={makeAdapter(star)} onGoTo={vi.fn()} />);
    expect(screen.queryByText('HIP')).toBeNull();
  });
});

describe('InfoPanel — interactions', () => {
  it('"Go to" button calls onGoTo with the star id', async () => {
    const user = userEvent.setup();
    const onGoTo = vi.fn();
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    render(<InfoPanel adapter={makeAdapter(SIRIUS)} onGoTo={onGoTo} />);
    await user.click(screen.getByRole('button', { name: /go to/i }));
    expect(onGoTo).toHaveBeenCalledWith('hyg:32263');
  });

  it('close button calls select(null)', async () => {
    const user = userEvent.setup();
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    render(<InfoPanel adapter={makeAdapter(SIRIUS)} onGoTo={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(useSelectionStore.getState().selectedId).toBeNull();
  });
});

describe('InfoPanel — fallback for unknown id', () => {
  it('shows id as fallback when adapter returns null, no crash', () => {
    useSelectionStore.setState({ selectedId: 'hyg:99999' });
    const adapter: BodyLookupAdapter = {
      search: vi.fn().mockReturnValue([]),
      getBody: vi.fn().mockReturnValue(null),
    };
    render(<InfoPanel adapter={adapter} onGoTo={vi.fn()} />);
    expect(screen.getByText('hyg:99999')).not.toBeNull();
  });

  it('fallback close button still calls select(null)', async () => {
    const user = userEvent.setup();
    useSelectionStore.setState({ selectedId: 'hyg:99999' });
    const adapter: BodyLookupAdapter = {
      search: vi.fn().mockReturnValue([]),
      getBody: vi.fn().mockReturnValue(null),
    };
    render(<InfoPanel adapter={adapter} onGoTo={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(useSelectionStore.getState().selectedId).toBeNull();
  });
});

// ── TASK-026 additions ────────────────────────────────────────────────────────

const SATURN: PlanetRecord = {
  id: 'sol:saturn',
  kind: 'planet',
  name: 'Saturn',
  parentId: 'sol:sol',
  radiusKm: 58232,
  elements: {
    semiMajorAxisAu: 9.5826,
    eccentricity: 0.0565,
    inclinationRad: 0.04336,
    ascendingNodeLongitudeRad: 1.9837,
    argumentOfPeriapsisRad: 1.6227,
    meanAnomalyAtEpochRad: 5.5323,
    epochJD: 2451545.0,
    muKm3S2: 1.32712440018e11,
  },
  seed: 6,
};

const SATURN_NO_ELEMENTS: PlanetRecord = {
  id: 'sol:saturn-bare',
  kind: 'planet',
  name: 'Saturn',
  parentId: 'sol:sol',
  radiusKm: 58232,
};

const MILKY_WAY: GalaxyRecord = {
  id: 'gal:milkyway',
  kind: 'galaxy',
  name: 'Milky Way',
  positionMpc: [0, 0, 0],
  radiusKpc: 15,
  seed: 0,
};

function makePlanetAdapter(
  planet: PlanetRecord,
  parentName?: string,
): BodyLookupAdapter {
  return {
    search: vi.fn().mockReturnValue([]),
    getBody: vi.fn().mockImplementation((id: string) => {
      if (id === planet.id) return planet;
      if (id === planet.parentId && parentName !== undefined) {
        return {
          id: planet.parentId,
          kind: 'star',
          name: parentName,
          positionPc: [0, 0, 0] as [number, number, number],
          absMag: -26.7,
          colorIndexBV: 0.65,
        };
      }
      return undefined;
    }),
  };
}

describe('InfoPanel — planet display', () => {
  it('Saturn fixture: shows name, radius, parent, a, e, period', () => {
    useSelectionStore.setState({ selectedId: 'sol:saturn' });
    render(
      <InfoPanel adapter={makePlanetAdapter(SATURN, 'Sol')} onGoTo={vi.fn()} />,
    );

    expect(screen.getByText('Saturn')).not.toBeNull();

    // Radius: 58232 → "58 232 km"
    expect(screen.getByText(/58.232 km/)).not.toBeNull();

    // Parent
    expect(screen.getByText('Sol')).not.toBeNull();

    // Semi-major axis ≈ 9.58 AU (3 sig figs)
    expect(screen.getByText(/9\.58 AU/)).not.toBeNull();

    // Eccentricity 0.0565 → "0.06"
    expect(screen.getByText('0.06')).not.toBeNull();

    // Period in years (> 1000 days)
    expect(screen.getByText(/yr$/)).not.toBeNull();
  });

  it('planet without elements omits the orbit block', () => {
    useSelectionStore.setState({ selectedId: 'sol:saturn-bare' });
    render(
      <InfoPanel
        adapter={makePlanetAdapter(SATURN_NO_ELEMENTS, 'Sol')}
        onGoTo={vi.fn()}
      />,
    );
    expect(screen.queryByText(/AU$/)).toBeNull();
    expect(screen.queryByText(/yr$|d$/)).toBeNull();
  });
});

// ── TASK-068 additions ───────────────────────────────────────────────────────

function makeBadgeAdapter(
  hostSystemId: string | null,
  planetCount: number | null | 'absent',
): BodyLookupAdapter {
  const adapter: BodyLookupAdapter = {
    search: vi.fn().mockReturnValue([]),
    getBody: vi.fn().mockReturnValue(SIRIUS),
    hostSystemIdFor: vi.fn().mockReturnValue(hostSystemId),
  };
  if (planetCount !== 'absent') {
    adapter.planetCountFor = vi.fn().mockReturnValue(planetCount);
  }
  return adapter;
}

describe('InfoPanel — C3 system badge (card-only v1)', () => {
  it('host star with 8 planets → "8 known planets" (moons not counted upstream)', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    render(<InfoPanel adapter={makeBadgeAdapter('sol', 8)} onGoTo={vi.fn()} />);
    expect(screen.getByText('8 known planets')).not.toBeNull();
  });

  it('singular count → "1 known planet"', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    render(<InfoPanel adapter={makeBadgeAdapter('exo:x', 1)} onGoTo={vi.fn()} />);
    expect(screen.getByText('1 known planet')).not.toBeNull();
  });

  it('non-host star → "No known planetary system"', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    render(<InfoPanel adapter={makeBadgeAdapter(null, 0)} onGoTo={vi.fn()} />);
    expect(screen.getByText('No known planetary system')).not.toBeNull();
  });

  it('adapter without planetCountFor → badge omitted entirely', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    const { container } = render(
      <InfoPanel adapter={makeBadgeAdapter(null, 'absent')} onGoTo={vi.fn()} />,
    );
    expect(container.querySelector('.cosmos-ui-info-badge')).toBeNull();
  });

  it('unresolvable count (null) → badge omitted, never filler', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    const { container } = render(
      <InfoPanel adapter={makeBadgeAdapter('sol', null)} onGoTo={vi.fn()} />,
    );
    expect(container.querySelector('.cosmos-ui-info-badge')).toBeNull();
    expect(container.textContent).not.toContain('null');
  });
});

describe('InfoPanel — C4/C5 planet insight', () => {
  it('Saturn: size bar with Earth-ratio a11y label, human orbit line, no HZ hint', () => {
    useSelectionStore.setState({ selectedId: 'sol:saturn' });
    const { container } = render(
      <InfoPanel adapter={makePlanetAdapter(SATURN, 'Sol')} onGoTo={vi.fn()} />,
    );
    // C4: bar present, labeled with the Earth ratio (58 232 / 6 371 ≈ 9.14).
    const bar = screen.getByRole('img', { name: 'Size: 9.14× Earth' });
    expect(bar).not.toBeNull();
    expect(screen.getByText('9.14× Earth')).not.toBeNull();
    // C5: human-terms orbit; the self-comparison ("like Saturn") is suppressed.
    const orbit = container.querySelector('.cosmos-ui-info-orbit')!;
    expect(orbit.textContent).toMatch(/^29\.\d+-year orbit$/);
    // 9.58 AU around a G star is far outside the HZ band → no hint.
    expect(container.querySelector('.cosmos-ui-info-hz')).toBeNull();
    // Expert orbital elements collapsed by default.
    const details = container.querySelector<HTMLDetailsElement>('.cosmos-ui-info-details')!;
    expect(details.open).toBe(false);
  });

  it('an Earth-like orbit around a Sun-like parent shows the HZ hint', () => {
    const earthLike: PlanetRecord = {
      ...SATURN,
      id: 'exo:x:b',
      name: 'Exo b',
      radiusKm: 6371,
      elements: { ...SATURN.elements!, semiMajorAxisAu: 1.1 },
    };
    useSelectionStore.setState({ selectedId: 'exo:x:b' });
    const { container } = render(
      <InfoPanel adapter={makePlanetAdapter(earthLike, 'Host')} onGoTo={vi.fn()} />,
    );
    expect(container.querySelector('.cosmos-ui-info-hz')?.textContent).toContain(
      'habitable zone',
    );
    // C7: planet card tints from the PARENT star's color.
    const panel = container.querySelector<HTMLElement>('.cosmos-ui-info')!;
    expect(panel.style.getPropertyValue('--cosmos-info-tint')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('never renders NaN/undefined even with a degenerate radius', () => {
    const broken: PlanetRecord = { ...SATURN_NO_ELEMENTS, id: 'sol:broken', radiusKm: NaN };
    useSelectionStore.setState({ selectedId: 'sol:broken' });
    const { container } = render(
      <InfoPanel adapter={makePlanetAdapter(broken, 'Sol')} onGoTo={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('NaN');
    expect(container.querySelector('.cosmos-ui-info-sizebar')).toBeNull();
  });
});

describe('InfoPanel — galaxy display', () => {
  it('shows name and Galaxy tag only', () => {
    useSelectionStore.setState({ selectedId: 'gal:milkyway' });
    const adapter: BodyLookupAdapter = {
      search: vi.fn().mockReturnValue([]),
      getBody: vi.fn().mockReturnValue(MILKY_WAY),
    };
    render(<InfoPanel adapter={adapter} onGoTo={vi.fn()} />);
    expect(screen.getByText('Milky Way')).not.toBeNull();
    expect(screen.getByText('Galaxy')).not.toBeNull();
    expect(screen.queryByText(/km/)).toBeNull();
  });
});
