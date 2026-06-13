import { type JSX } from 'react';
import { useSelectionStore } from '@cosmos/app-state';
import type { BodyId, PlanetRecord } from '@cosmos/core-types';
import { spectralClassFromBV } from './spectral';
import { formatOrbitalPeriod } from './format';
import type { InfoPanelProps } from './types';

const PC_TO_LY = 3.26156;

function fmtSig3(n: number): string {
  return parseFloat(n.toPrecision(3)).toString();
}

function extractHip(id: BodyId): number | null {
  if (id.startsWith('hyg:')) {
    const n = parseInt(id.slice(4), 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

function fmtGrouped(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function PlanetInfo({
  planet,
  parentName,
}: {
  planet: PlanetRecord;
  parentName: string | undefined;
}): JSX.Element {
  const { elements } = planet;
  return (
    <dl className="cosmos-ui-info-data">
      <dt>Type</dt>
      <dd>Planet</dd>
      <dt>Radius</dt>
      <dd>{fmtGrouped(planet.radiusKm)} km</dd>
      {parentName !== undefined && (
        <>
          <dt>Parent</dt>
          <dd>{parentName}</dd>
        </>
      )}
      {elements && (
        <>
          <dt>Semi-major axis</dt>
          <dd>{fmtSig3(elements.semiMajorAxisAu)} AU</dd>
          <dt>Eccentricity</dt>
          <dd>{elements.eccentricity.toFixed(2)}</dd>
          <dt>Period</dt>
          <dd>
            {formatOrbitalPeriod(elements.semiMajorAxisAu, elements.muKm3S2)}
          </dd>
        </>
      )}
    </dl>
  );
}

/** Subscribes to useSelectionStore. Hidden when nothing selected. */
export function InfoPanel({ adapter, onGoTo }: InfoPanelProps): JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId);
  const select = useSelectionStore((s) => s.select);

  if (selectedId === null) return <></>;

  const body = adapter.getBody(selectedId);

  const closeBtn = (
    <button
      className="cosmos-ui-info-close"
      onClick={() => select(null)}
      aria-label="Close panel"
    >
      ✕
    </button>
  );

  if (!body) {
    return (
      <div className="cosmos-ui-info" role="complementary" aria-label="Star information">
        {closeBtn}
        <span className="cosmos-ui-info-name">{selectedId}</span>
      </div>
    );
  }

  if (body.kind === 'galaxy') {
    return (
      <div className="cosmos-ui-info" role="complementary" aria-label="Galaxy information">
        {closeBtn}
        <h2 className="cosmos-ui-info-name">{body.name ?? body.id}</h2>
        <dl className="cosmos-ui-info-data">
          <dt>Type</dt>
          <dd>Galaxy</dd>
        </dl>
      </div>
    );
  }

  if (body.kind === 'planet') {
    const parentBody = adapter.getBody(body.parentId);
    const parentName = parentBody?.name ?? body.parentId;
    return (
      <div className="cosmos-ui-info" role="complementary" aria-label="Planet information">
        {closeBtn}
        <h2 className="cosmos-ui-info-name">{body.name ?? body.id}</h2>
        <PlanetInfo planet={body} parentName={parentName} />
        <button
          className="cosmos-ui-info-goto"
          onClick={() => onGoTo(body.id)}
          aria-label={`Go to ${body.name ?? body.id}`}
        >
          Go to
        </button>
      </div>
    );
  }

  // Star
  const star = body;
  const [x, y, z] = star.positionPc;
  const dist = Math.sqrt(x * x + y * y + z * z);
  const distPcStr = fmtSig3(dist);
  const distLyStr = fmtSig3(dist * PC_TO_LY);
  const hip = extractHip(star.id);
  const spectral = spectralClassFromBV(star.colorIndexBV);

  return (
    <div className="cosmos-ui-info" role="complementary" aria-label="Star information">
      {closeBtn}
      <h2 className="cosmos-ui-info-name">{star.name ?? star.id}</h2>
      <dl className="cosmos-ui-info-data">
        <dt>Distance</dt>
        <dd className="cosmos-ui-info-distance">
          {distPcStr} pc / {distLyStr} ly
        </dd>
        <dt>Abs. Magnitude</dt>
        <dd className="cosmos-ui-info-absmag">{star.absMag}</dd>
        <dt>Spectral Class</dt>
        <dd className="cosmos-ui-info-spectral">
          {spectral} (B−V {star.colorIndexBV})
        </dd>
        {hip !== null && (
          <>
            <dt>HIP</dt>
            <dd className="cosmos-ui-info-hip">{hip}</dd>
          </>
        )}
      </dl>
      <button
        className="cosmos-ui-info-goto"
        onClick={() => onGoTo(star.id)}
        aria-label={`Go to ${star.name ?? star.id}`}
      >
        Go to
      </button>
    </div>
  );
}
