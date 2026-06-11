import type { BodyId, StarRecord } from '@cosmos/core-types';

/** Injected by the app (TASK-015 passes the real @cosmos/data source). */
export interface BodyLookupAdapter {
  search(query: string, maxResults?: number): readonly StarRecord[];
  getBody(id: BodyId): StarRecord | null;
}

export interface SearchPaletteProps {
  readonly adapter: BodyLookupAdapter;
  /** Called on Enter/click of a result: the app selects AND flies to it. */
  onGoTo(id: BodyId): void;
}

export interface InfoPanelProps {
  readonly adapter: BodyLookupAdapter;
  onGoTo(id: BodyId): void;
}
