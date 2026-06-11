import { type JSX } from 'react';
import { useSelectionStore } from '@cosmos/app-state';
import type { BodyId } from '@cosmos/core-types';
import { spectralClassFromBV } from './spectral';
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

/** Subscribes to useSelectionStore. Hidden when nothing selected. */
export function InfoPanel({ adapter, onGoTo }: InfoPanelProps): JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId);
  const select = useSelectionStore((s) => s.select);

  if (selectedId === null) return <></>;

  const star = adapter.getBody(selectedId);

  if (!star) {
    return (
      <div className="cosmos-ui-info" role="complementary" aria-label="Star information">
        <button
          className="cosmos-ui-info-close"
          onClick={() => select(null)}
          aria-label="Close panel"
        >
          ✕
        </button>
        <span className="cosmos-ui-info-name">{selectedId}</span>
      </div>
    );
  }

  const [x, y, z] = star.positionPc;
  const dist = Math.sqrt(x * x + y * y + z * z);
  const distPcStr = fmtSig3(dist);
  const distLyStr = fmtSig3(dist * PC_TO_LY);
  const hip = extractHip(star.id);
  const spectral = spectralClassFromBV(star.colorIndexBV);

  return (
    <div className="cosmos-ui-info" role="complementary" aria-label="Star information">
      <button
        className="cosmos-ui-info-close"
        onClick={() => select(null)}
        aria-label="Close panel"
      >
        ✕
      </button>
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
