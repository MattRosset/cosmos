import type { JumpHudModel } from './jump-hud-model';
import { STRINGS } from './strings';

export interface JumpHudProps {
  readonly model: JumpHudModel;
  /** Wall-clock seconds the completed jump took (arrival card), or null. */
  readonly durationS: number | null;
  /** Order-of-magnitude span now in view, in ly (arrival card), or null. */
  readonly fieldOfViewLy: number | null;
  /** Dismiss the arrival card early. */
  onDismiss(): void;
}

/** Human magnitude for a ly count — never hard-coded copy (spec §Common Mistakes). */
function fmtLy(ly: number): string {
  if (!Number.isFinite(ly)) return '—';
  if (ly >= 1000) return Math.round(ly).toLocaleString('en-US');
  if (ly >= 1) return String(parseFloat(ly.toFixed(1)));
  return ly.toPrecision(2);
}

/**
 * Unified Jump HUD (TASK-067 W2, absorbs S4+D5): one component, one lifecycle.
 * While jumping it shows the live distance remaining + the @ c equivalent; on
 * arrival the same component morphs into the summary card — full (first jumps)
 * or a one-line readout (W2a dampening). Presentational only: all numbers come
 * from the model/props the host computed from queried flight state.
 */
export function JumpHud({
  model,
  durationS,
  fieldOfViewLy,
  onDismiss,
}: JumpHudProps): React.JSX.Element | null {
  if (model.phase === 'idle') return null;

  if (model.phase === 'jumping') {
    return (
      <div className="cosmos-ui-jump cosmos-ui-jump--jumping" role="status">
        <span className="cosmos-ui-jump-remaining">
          ≈ {fmtLy(model.distanceRemainingLy)} {STRINGS.jumpRemainingSuffix}
        </span>
        <span className="cosmos-ui-jump-eta">{model.etaAtC}</span>
      </div>
    );
  }

  const jumped = `${STRINGS.jumpArrivedPrefix} ~${fmtLy(model.distanceTotalLy)} ly`;

  if (!model.showFullArrivalCard) {
    return (
      <div className="cosmos-ui-jump cosmos-ui-jump--arrived cosmos-ui-jump--brief" role="status">
        <span className="cosmos-ui-jump-summary">
          {jumped} — {model.etaAtC}
        </span>
      </div>
    );
  }

  return (
    <div className="cosmos-ui-jump cosmos-ui-jump--arrived cosmos-ui-jump--full" role="status">
      <span className="cosmos-ui-jump-summary">
        {jumped}
        {durationS !== null ? ` in ${parseFloat(durationS.toFixed(1))} s` : ''}
      </span>
      <span className="cosmos-ui-jump-eta">{model.etaAtC}</span>
      {fieldOfViewLy !== null ? (
        <span className="cosmos-ui-jump-fov">
          {STRINGS.jumpFovPrefix}
          {fmtLy(fieldOfViewLy)} {STRINGS.jumpFovSuffix}
        </span>
      ) : null}
      <button type="button" className="cosmos-ui-jump-dismiss" onClick={onDismiss}>
        {STRINGS.jumpDismiss}
      </button>
    </div>
  );
}
