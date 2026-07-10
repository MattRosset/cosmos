import { type JSX } from 'react';
import { useSelectionStore } from '@cosmos/app-state';
import type { BodyId, PlanetRecord } from '@cosmos/core-types';
import { spectralClassFromBV } from './spectral';
import { formatOrbitalPeriod, formatLightTravel, formatEtaAtC } from './format';
import { STRINGS } from './strings';
import { Icon } from './Icon';
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
export function InfoPanel({
  adapter,
  onGoTo,
  currentSystemId = null,
  onExitSystem,
}: InfoPanelProps): JSX.Element {
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
      <Icon name="close" size={14} />
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
  const distLy = dist * PC_TO_LY;
  const distPcStr = fmtSig3(dist);
  const distLyStr = fmtSig3(distLy);
  const hip = extractHip(star.id);
  const spectral = spectralClassFromBV(star.colorIndexBV);
  const hostSystemId = adapter.hostSystemIdFor?.(star.id) ?? null;
  const starLabel = star.name ?? star.id;
  // A host star's primary action depends on context: descend in from the galaxy,
  // or pop back out once you're already inside that system.
  const insideThisSystem =
    hostSystemId !== null && hostSystemId === currentSystemId && onExitSystem !== undefined;
  const actionLabel =
    hostSystemId === null ? 'Go to' : insideThisSystem ? '◂ Exit system' : 'Enter system ▸';
  const actionAria =
    hostSystemId === null
      ? `Go to ${starLabel}`
      : insideThisSystem
        ? `Exit ${starLabel} system`
        : `Enter ${starLabel} system`;
  const onAction = insideThisSystem ? onExitSystem! : (): void => onGoTo(star.id);

  return (
    <div className="cosmos-ui-info" role="complementary" aria-label="Star information">
      {closeBtn}
      <h2 className="cosmos-ui-info-name">{starLabel}</h2>
      <dl className="cosmos-ui-info-data">
        <dt>Distance</dt>
        <dd className="cosmos-ui-info-distance">
          {distLyStr} ly — {STRINGS.lightTravelPrefix} {formatLightTravel(distLy)}{' '}
          {STRINGS.lightTravelSuffix}
        </dd>
        <dt>Travel</dt>
        <dd className="cosmos-ui-info-eta">{formatEtaAtC(distLy)}</dd>
        <dt>Abs. Magnitude</dt>
        <dd className="cosmos-ui-info-absmag">{fmtSig3(star.absMag)}</dd>
        <dt>Spectral Class</dt>
        <dd className="cosmos-ui-info-spectral">
          {spectral} (B−V {star.colorIndexBV.toFixed(2)})
        </dd>
        {hip !== null && (
          <>
            <dt>HIP</dt>
            <dd className="cosmos-ui-info-hip">{hip}</dd>
          </>
        )}
        <dt className="cosmos-ui-info-detail">Distance (pc)</dt>
        <dd className="cosmos-ui-info-detail cosmos-ui-info-distance-pc">{distPcStr} pc</dd>
      </dl>
      <button className="cosmos-ui-info-goto" onClick={onAction} aria-label={actionAria}>
        {actionLabel}
      </button>
    </div>
  );
}
