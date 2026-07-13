import { type CSSProperties, type JSX } from 'react';
import { useSelectionStore } from '@cosmos/app-state';
import type { BodyId, PlanetRecord } from '@cosmos/core-types';
import { spectralClassFromBV } from './spectral';
import { formatOrbitalPeriod, formatLightTravel, formatEtaAtC, orbitalPeriodDays } from './format';
import {
  apparentMagnitude,
  habitableZoneHint,
  nakedEyeVisibility,
  orbitInHumanTerms,
  radiusVsEarth,
  spectralPlainLanguage,
  spectralTint,
} from './astro-derive';
import { STRINGS } from './strings';
import { Icon } from './Icon';
import type { BodyLookupAdapter, InfoPanelProps } from './types';

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

/** Panel style carrying the C7 spectral tint as a CSS variable (null ⇒ default chrome). */
function tintStyle(tint: string | null): CSSProperties | undefined {
  return tint === null ? undefined : ({ '--cosmos-info-tint': tint } as CSSProperties);
}

/**
 * C4 size bar: bounded ratio→width mapping r/(r+1) that puts Earth (r=1) at the
 * 50% reference tick — purely presentational; the accessible value is the label.
 */
function sizeBarWidthPct(ratio: number): number {
  return (ratio / (ratio + 1)) * 100;
}

function PlanetInfo({
  planet,
  parentName,
  parentBv,
}: {
  planet: PlanetRecord;
  parentName: string | undefined;
  parentBv: number | null;
}): JSX.Element {
  const { elements } = planet;
  const size = radiusVsEarth(planet.radiusKm);
  const orbitLine =
    elements !== undefined
      ? orbitInHumanTerms(
          orbitalPeriodDays(elements.semiMajorAxisAu, elements.muKm3S2),
          elements.semiMajorAxisAu,
        )
      : null;
  const hzLine =
    elements !== undefined ? habitableZoneHint(elements.semiMajorAxisAu, parentBv) : null;

  return (
    <>
      {size !== null && (
        <div className="cosmos-ui-info-size">
          <div
            className="cosmos-ui-info-sizebar"
            role="img"
            aria-label={`${STRINGS.sizeBarAriaPrefix} ${size.label}`}
          >
            <span
              className="cosmos-ui-info-sizebar-fill"
              style={{ width: `${sizeBarWidthPct(size.ratio)}%` }}
              aria-hidden="true"
            />
          </div>
          <p className="cosmos-ui-info-size-label">{size.label}</p>
        </div>
      )}
      {orbitLine !== null && <p className="cosmos-ui-info-orbit">{orbitLine}</p>}
      {hzLine !== null && <p className="cosmos-ui-info-hz">{hzLine}</p>}
      <dl className="cosmos-ui-info-data">
        {Number.isFinite(planet.radiusKm) && (
          <>
            <dt>Radius</dt>
            <dd>{fmtGrouped(planet.radiusKm)} km</dd>
          </>
        )}
        {parentName !== undefined && (
          <>
            <dt>Parent</dt>
            <dd>{parentName}</dd>
          </>
        )}
      </dl>
      {elements && (
        <details className="cosmos-ui-info-details">
          <summary>{STRINGS.detailsLabel}</summary>
          <dl className="cosmos-ui-info-data">
            <dt>Semi-major axis</dt>
            <dd>{fmtSig3(elements.semiMajorAxisAu)} AU</dd>
            <dt>Eccentricity</dt>
            <dd>{elements.eccentricity.toFixed(2)}</dd>
            <dt>Period</dt>
            <dd>{formatOrbitalPeriod(elements.semiMajorAxisAu, elements.muKm3S2)}</dd>
          </dl>
        </details>
      )}
    </>
  );
}

/**
 * C3 system badge (card-only v1). Omitted entirely when the adapter does not
 * provide `planetCountFor` (or the count is unresolvable) — never filler text.
 */
function systemBadge(adapter: BodyLookupAdapter, hostSystemId: BodyId | null): string | null {
  if (adapter.planetCountFor === undefined) return null;
  if (hostSystemId === null) return STRINGS.badgeNoSystem;
  const count = adapter.planetCountFor(hostSystemId);
  if (count === null) return null;
  return `${count} ${count === 1 ? STRINGS.badgePlanetSingular : STRINGS.badgePlanetPlural}`;
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
    // The tint (C7) and the habitable-zone hint (C5) both come from the PARENT
    // star's color — a planet card glows with its sun.
    const parentBv = parentBody?.kind === 'star' ? parentBody.colorIndexBV : null;
    return (
      <div
        className="cosmos-ui-info"
        role="complementary"
        aria-label="Planet information"
        style={tintStyle(spectralTint(parentBv))}
      >
        {closeBtn}
        <h2 className="cosmos-ui-info-name">{body.name ?? body.id}</h2>
        <PlanetInfo planet={body} parentName={parentName} parentBv={parentBv} />
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
  const classLine = spectralPlainLanguage(star.colorIndexBV);
  const visibilityLine = nakedEyeVisibility(apparentMagnitude(star.absMag, dist));
  const badge = systemBadge(adapter, hostSystemId);
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
    <div
      className="cosmos-ui-info"
      role="complementary"
      aria-label="Star information"
      style={tintStyle(spectralTint(star.colorIndexBV))}
    >
      {closeBtn}
      <h2 className="cosmos-ui-info-name">{starLabel}</h2>
      {badge !== null && <p className="cosmos-ui-info-badge">{badge}</p>}
      {/* C6 hero metric: light-years + light-travel time, one block (D1 copy). */}
      <p className="cosmos-ui-info-hero cosmos-ui-info-distance">
        <span className="cosmos-ui-info-hero-value">{distLyStr} ly</span>
        <span className="cosmos-ui-info-hero-sub">
          {STRINGS.lightTravelPrefix} {formatLightTravel(distLy)} {STRINGS.lightTravelSuffix}
        </span>
      </p>
      {classLine !== null && <p className="cosmos-ui-info-class">{classLine}</p>}
      {visibilityLine !== null && <p className="cosmos-ui-info-visibility">{visibilityLine}</p>}
      <dl className="cosmos-ui-info-data">
        <dt>Travel</dt>
        <dd className="cosmos-ui-info-eta">{formatEtaAtC(distLy)}</dd>
        <dt>Spectral Class</dt>
        <dd className="cosmos-ui-info-spectral">
          {spectral} (B−V {star.colorIndexBV.toFixed(2)})
        </dd>
      </dl>
      {/* Expert values live behind a native details row, collapsed by default. */}
      <details className="cosmos-ui-info-details">
        <summary>{STRINGS.detailsLabel}</summary>
        <dl className="cosmos-ui-info-data">
          <dt>Distance (pc)</dt>
          <dd className="cosmos-ui-info-distance-pc">{distPcStr} pc</dd>
          <dt>Abs. Magnitude</dt>
          <dd className="cosmos-ui-info-absmag">{fmtSig3(star.absMag)}</dd>
          {hip !== null && (
            <>
              <dt>HIP</dt>
              <dd className="cosmos-ui-info-hip">{hip}</dd>
            </>
          )}
        </dl>
      </details>
      <button className="cosmos-ui-info-goto" onClick={onAction} aria-label={actionAria}>
        {actionLabel}
      </button>
    </div>
  );
}
