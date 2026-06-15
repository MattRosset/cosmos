import { type JSX } from 'react';
import { useSettingsStore, EXPOSURE_MIN, EXPOSURE_MAX } from '@cosmos/app-state';
import { Icon } from './Icon';

/**
 * Star-field exposure slider. Exposure is a brightness multiplier spanning three
 * orders of magnitude, so the slider is mapped LOGARITHMICALLY: the [0,1] track
 * position `t` maps to `EXPOSURE_MIN · (EXPOSURE_MAX/EXPOSURE_MIN)^t`. Low end ≈
 * "naked-eye sky" (few bright stars); high end ≈ "planetarium" (most of the HYG
 * catalog visible). Reads/writes `useSettingsStore` only — zero Canvas re-renders.
 */

const SLIDER_STEPS = 1000;
const LOG_MIN = Math.log(EXPOSURE_MIN);
const LOG_SPAN = Math.log(EXPOSURE_MAX) - LOG_MIN;

/** Slider position [0..SLIDER_STEPS] → exposure (log scale). */
function sliderToExposure(pos: number): number {
  return Math.exp(LOG_MIN + (pos / SLIDER_STEPS) * LOG_SPAN);
}

/** Exposure → slider position [0..SLIDER_STEPS] (inverse of the above). */
function exposureToSlider(exposure: number): number {
  return Math.round(((Math.log(exposure) - LOG_MIN) / LOG_SPAN) * SLIDER_STEPS);
}

function fmtExposure(exposure: number): string {
  return exposure >= 10 ? Math.round(exposure).toString() : exposure.toFixed(1);
}

export function ExposureControl(): JSX.Element {
  const exposure = useSettingsStore((s) => s.exposure);
  const setExposure = useSettingsStore((s) => s.setExposure);

  return (
    <div className="cosmos-ui-exposure" role="group" aria-label="Star brightness">
      <span className="cosmos-ui-exposure-icon" aria-hidden="true">
        <Icon name="sun" size={15} />
      </span>
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS}
        value={exposureToSlider(exposure)}
        onChange={(e) => setExposure(sliderToExposure(Number(e.target.value)))}
        aria-label="Star-field brightness (exposure)"
        aria-valuetext={`Exposure ${fmtExposure(exposure)}`}
      />
      <span className="cosmos-ui-exposure-readout" aria-live="polite">
        {fmtExposure(exposure)}×
      </span>
    </div>
  );
}
