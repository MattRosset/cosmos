import type { BookmarkRecord, BOOKMARKS_SCHEMA_VERSION } from '@cosmos/core-types';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage, migrateBookmarks } from './persist-util';

export interface BookmarkState {
  readonly bookmarks: readonly BookmarkRecord[];
  add(record: BookmarkRecord): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
}

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set) => ({
      bookmarks: [],
      add: (record) =>
        set((state) => {
          const existing = state.bookmarks.findIndex((b) => b.id === record.id);
          if (existing >= 0) {
            const updated = [...state.bookmarks];
            updated[existing] = record;
            return { bookmarks: updated };
          }
          return { bookmarks: [...state.bookmarks, record] };
        }),
      remove: (id) =>
        set((state) => ({
          bookmarks: state.bookmarks.filter((b) => b.id !== id),
        })),
      rename: (id, name) =>
        set((state) => ({
          bookmarks: state.bookmarks.map((b) =>
            b.id === id ? { ...b, name } : b
          ),
        })),
    }),
    {
      name: 'cosmos.bookmarks',
      version: 1 as typeof BOOKMARKS_SCHEMA_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      migrate: (persisted, version) => ({
        bookmarks: migrateBookmarks(persisted, version),
      }),
    }
  )
);
