/* v8 ignore file */
import { serveWorker } from '@cosmos/workers';
import { octreeDecodeHandler } from './octree-decode.js';

serveWorker({ 'octree.decode': octreeDecodeHandler });
