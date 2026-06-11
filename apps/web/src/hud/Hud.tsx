import '@cosmos/ui/ui.css';
import type { BodyId } from '@cosmos/core-types';
import type { StarDataSource } from '@cosmos/data';
import { InfoPanel, SearchPalette } from '@cosmos/ui';

interface HudProps {
  readonly source: StarDataSource;
  /** Select AND fly: wired to `controller.goTo` in App. */
  onGoTo(id: BodyId): void;
}

/**
 * Search palette + info panel against the live catalog (the StarDataSource
 * satisfies the ui BodyLookupAdapter structurally). Lives inside the `.hud`
 * overlay; the panels opt back into pointer events via ui.css.
 */
export function Hud({ source, onGoTo }: HudProps) {
  return (
    <>
      <SearchPalette adapter={source} onGoTo={onGoTo} />
      <InfoPanel adapter={source} onGoTo={onGoTo} />
    </>
  );
}
