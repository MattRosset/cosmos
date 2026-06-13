import '@cosmos/ui/ui.css';
import { useMemo } from 'react';
import type { BodyId } from '@cosmos/core-types';
import type { StarDataSource } from '@cosmos/data';
import { InfoPanel, SearchPalette } from '@cosmos/ui';
import type { BodyLookupAdapter } from '@cosmos/ui';

interface HudProps {
  readonly source: StarDataSource;
  /** Select AND fly: wired to `controller.goTo` in App. */
  onGoTo(id: BodyId): void;
}

/**
 * Search palette + info panel against the live catalog. Wraps StarDataSource
 * in a BodyLookupAdapter so null→undefined and readonly[] conversions are explicit.
 */
export function Hud({ source, onGoTo }: HudProps) {
  const adapter = useMemo<BodyLookupAdapter>(
    () => ({
      getBody: (id) => source.getBody(id) ?? undefined,
      search: (query, max) => Array.from(source.search(query, max)),
    }),
    [source],
  );

  return (
    <>
      <SearchPalette adapter={adapter} onGoTo={onGoTo} />
      <InfoPanel adapter={adapter} onGoTo={onGoTo} />
    </>
  );
}
