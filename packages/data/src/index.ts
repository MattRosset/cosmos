export { loadStarPack, PackFormatError } from './load.js';
export type { LoadOptions, StarDataSource } from './load.js';
export type { Vec3Pc } from './source.js';
export { loadSystemsPack, SystemsPackFormatError } from './systems.js';
export type { SystemsSource } from './systems.js';
export { createCombinedSource } from './combined.js';
export type { CombinedSource, NearestHostHit } from './combined.js';
export { loadOctreePack, OctreeFormatError } from './octree.js';
export type { OctreeNode, OctreeSource, LoadOctreeOptions } from './octree.js';
// Worker-side tile decode handler (§5.13): injected into the app's unified worker
// entry's `serveWorker`. Pure (no Three.js/DOM), the data counterpart to procgen's
// `galaxyWorkerHandler`. `decodeTile` is the underlying main-thread decoder.
export { octreeDecodeHandler, decodeTile } from './octree-decode.js';
