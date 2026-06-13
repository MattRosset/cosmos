import { type JSX } from 'react';
import { useTimeStore, ACCEL_STEPS } from '@cosmos/app-state';
import { formatEpochJD } from './format';
import type { TimeControlsProps } from './types';

/** Next ACCEL_STEPS entry larger than abs; saturates at 1e7. */
function nextStep(abs: number): number {
  for (const step of ACCEL_STEPS) {
    if (step > abs) return step;
  }
  return 1e7;
}

function fmtAccel(accel: number): string {
  const neg = accel < 0;
  const abs = Math.abs(accel);
  const numStr =
    abs >= 1000
      ? String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
      : String(abs);
  return `${neg ? '−' : ''}${numStr}×`;
}

/** Reads/writes useTimeStore from @cosmos/app-state. */
export function TimeControls({ onSyncToNow }: TimeControlsProps): JSX.Element {
  const paused = useTimeStore((s) => s.paused);
  const accel = useTimeStore((s) => s.accel);
  const epochJD = useTimeStore((s) => s.epochJD);
  const setPaused = useTimeStore((s) => s.setPaused);
  const setAccel = useTimeStore((s) => s.setAccel);

  function handleFwd(): void {
    if (accel < 0) {
      setAccel(1);
    } else {
      setAccel(nextStep(accel));
    }
  }

  function handleRev(): void {
    if (accel > 0) {
      setAccel(-1);
    } else {
      setAccel(-nextStep(Math.abs(accel)));
    }
  }

  return (
    <div className="cosmos-ui-time" role="toolbar" aria-label="Time controls">
      <button aria-label="Reverse faster" onClick={handleRev}>
        ⏪
      </button>
      <button
        aria-label={paused ? 'Resume' : 'Pause'}
        onClick={() => setPaused(!paused)}
      >
        {paused ? '▶' : '⏸'}
      </button>
      <button aria-label="Forward faster" onClick={handleFwd}>
        ⏩
      </button>
      <button aria-label="Reset speed" onClick={() => setAccel(1)}>
        1×
      </button>
      {onSyncToNow && (
        <button aria-label="Sync to now" onClick={onSyncToNow}>
          Now
        </button>
      )}
      <span className="cosmos-ui-time-readout" aria-live="polite">
        {fmtAccel(accel)} {formatEpochJD(epochJD)}
      </span>
    </div>
  );
}
