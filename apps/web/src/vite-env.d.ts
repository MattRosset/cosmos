/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** TASK-065: Gaia octree manifest override; unset ⇒ committed sample pack. */
  readonly VITE_GAIA_OCTREE_MANIFEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
