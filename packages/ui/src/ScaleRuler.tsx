import { SCALE_RULER_SEGMENTS, type ScaleRulerSegment } from './scale-ruler';
import { STRINGS } from './strings';

export interface ScaleRulerProps {
  /** Segment to highlight (from `scaleRulerSegment`), or null for no highlight. */
  readonly active: ScaleRulerSegment | null;
}

const SEGMENT_LABELS: Record<ScaleRulerSegment, string> = {
  planet: STRINGS.rulerPlanet,
  system: STRINGS.rulerSystem,
  starfield: STRINGS.rulerStarfield,
  'galactic-survey': STRINGS.rulerGalacticSurvey,
  universe: STRINGS.rulerUniverse,
};

/**
 * Persistent scale ruler (TASK-067 D3). Presentational only: the host computes
 * the active segment via the pure `scaleRulerSegment` mapping and this renders
 * the bar — every segment always present, the current one highlighted. The e2e
 * test reads `data-segment` off the highlighted node.
 */
export function ScaleRuler({ active }: ScaleRulerProps): React.JSX.Element {
  return (
    <div className="cosmos-ui-ruler" role="group" aria-label={STRINGS.rulerLabel}>
      {SCALE_RULER_SEGMENTS.map((seg) => (
        <span
          key={seg}
          data-segment={seg}
          className={`cosmos-ui-ruler-seg${seg === active ? ' cosmos-ui-ruler-seg--active' : ''}`}
        >
          {SEGMENT_LABELS[seg]}
        </span>
      ))}
    </div>
  );
}
