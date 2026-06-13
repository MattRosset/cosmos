import type { BookmarkRecord } from '@cosmos/core-types';
import type { HistoryEntry } from './history';

// Safe storage shim that handles localStorage unavailability (Node, SSR).
export function createSafeStorage() {
  return {
    getItem: (key: string) => {
      try {
        return localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      try {
        localStorage?.setItem(key, value);
      } catch {
        // Silently fail (quota exceeded, unavailable, etc.)
      }
    },
    removeItem: (key: string) => {
      try {
        localStorage?.removeItem(key);
      } catch {
        // Silently fail
      }
    },
  };
}

// Validate bookmark record shape and types.
function validateBookmarkRecord(v: unknown): v is BookmarkRecord {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  const pos = obj.position as Record<string, unknown> | undefined;
  const ori = obj.orientation as unknown[] | undefined;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.name !== 'string' ||
    typeof obj.createdAtIso !== 'string' ||
    !pos ||
    typeof pos !== 'object' ||
    typeof pos.context !== 'string' ||
    !Array.isArray(pos.local) ||
    pos.local.length !== 3 ||
    !pos.local.every((x) => typeof x === 'number') ||
    !Array.isArray(ori) ||
    ori.length !== 4 ||
    !ori.every((x) => typeof x === 'number') ||
    typeof obj.epochJD !== 'number'
  ) {
    return false;
  }
  return true;
}

export function migrateBookmarks(
  persisted: unknown,
  version: number
): BookmarkRecord[] {
  if (version === 1) {
    if (!Array.isArray(persisted)) return [];
    return persisted.filter((record) => validateBookmarkRecord(record));
  }
  if (version > 1) {
    console.warn(
      `Unknown bookmarks schema version ${version}, resetting to empty`
    );
    return [];
  }
  return [];
}

// Validate history entry shape and types.
function validateHistoryEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.id.length > 0 &&
    typeof obj.visitedAtIso === 'string' &&
    obj.visitedAtIso.length > 0
  );
}

export function migrateHistory(
  persisted: unknown,
  version: number
): HistoryEntry[] {
  if (version === 1) {
    if (!Array.isArray(persisted)) return [];
    return persisted.filter((entry) => validateHistoryEntry(entry));
  }
  if (version > 1) {
    console.warn(
      `Unknown history schema version ${version}, resetting to empty`
    );
    return [];
  }
  return [];
}
