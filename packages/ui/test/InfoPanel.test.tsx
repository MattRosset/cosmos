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
  it('shows name, distance pc+ly, absMag, spectral class, HIP', () => {
    useSelectionStore.setState({ selectedId: 'hyg:32263' });
    render(<InfoPanel adapter={makeAdapter(SIRIUS)} onGoTo={vi.fn()} />);

    // Name
    expect(screen.getByText('Sirius')).not.toBeNull();

    // Distance: sqrt(1.8²+1.9²+0.4²) = sqrt(7.01) ≈ 2.648 → 2.65 pc, 8.64 ly
    const distEl = screen.getByText(/pc.*ly/);
    expect(distEl.textContent).toContain('pc');
    expect(distEl.textContent).toContain('ly');

    // absMag
    expect(screen.getByText('1.45')).not.toBeNull();

    // Spectral class: bv=0.009 → A
    const spectralEl = screen.getByText(/A \(B−V/);
    expect(spectralEl).not.toBeNull();

    // HIP
    expect(screen.getByText('32263')).not.toBeNull();
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
    // dist = 10.0 pc → "10" pc; ly = 32.6156 → "32.6" ly
    expect(screen.getByText(/10 pc \/ 32.6 ly/)).not.toBeNull();
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
  it('Saturn fixture: shows name, Planet tag, radius, parent, a, e, period', () => {
    useSelectionStore.setState({ selectedId: 'sol:saturn' });
    render(
      <InfoPanel adapter={makePlanetAdapter(SATURN, 'Sol')} onGoTo={vi.fn()} />,
    );

    expect(screen.getByText('Saturn')).not.toBeNull();
    expect(screen.getByText('Planet')).not.toBeNull();

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
