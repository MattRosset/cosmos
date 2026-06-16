const CELL_SIZE = 25; // parsecs

function cellCoord(v: number): number {
  return Math.floor(v / CELL_SIZE);
}

// Pack (cx, cy, cz) each biased by 2048 into a JS safe integer.
// Range -2048..2047 per axis covers ±51 200 pc — well beyond any HYG star.
function cellKey(cx: number, cy: number, cz: number): number {
  return (cx + 2048) * 4096 * 4096 + (cy + 2048) * 4096 + (cz + 2048);
}

export type SpatialGrid = Map<number, Uint32Array>;

export function buildGrid(positionsPc: Float32Array, count: number): SpatialGrid {
  const cellCounts = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const key = cellKey(
      cellCoord(positionsPc[i * 3]!),
      cellCoord(positionsPc[i * 3 + 1]!),
      cellCoord(positionsPc[i * 3 + 2]!),
    );
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }

  const grid: SpatialGrid = new Map();
  const fill = new Map<number, number>();
  for (const [key, cnt] of cellCounts) {
    grid.set(key, new Uint32Array(cnt));
    fill.set(key, 0);
  }

  for (let i = 0; i < count; i++) {
    const key = cellKey(
      cellCoord(positionsPc[i * 3]!),
      cellCoord(positionsPc[i * 3 + 1]!),
      cellCoord(positionsPc[i * 3 + 2]!),
    );
    const arr = grid.get(key)!;
    const f = fill.get(key)!;
    arr[f] = i;
    fill.set(key, f + 1);
  }

  return grid;
}

// Module-scoped scratch — reset at the top of each nearestStarIndex call.
// Keeping these here satisfies the zero-allocation-per-call contract.
let _bestDistSq = 0;
let _bestIdx = 0;

function _scanCell(
  grid: SpatialGrid,
  positionsPc: Float32Array,
  cx: number,
  cy: number,
  cz: number,
  xPc: number,
  yPc: number,
  zPc: number,
): void {
  const indices = grid.get(cellKey(cx, cy, cz));
  if (indices === undefined) return;
  for (let j = 0; j < indices.length; j++) {
    const idx = indices[j]!;
    const dx = positionsPc[idx * 3]! - xPc;
    const dy = positionsPc[idx * 3 + 1]! - yPc;
    const dz = positionsPc[idx * 3 + 2]! - zPc;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < _bestDistSq) {
      _bestDistSq = d2;
      _bestIdx = idx;
    }
  }
}

/**
 * Index of the star nearest to (xPc, yPc, zPc) in tile-local coordinates,
 * or -1 if count === 0.  Zero allocations per call — all state is module-scoped.
 */
export function nearestStarIndex(
  grid: SpatialGrid,
  positionsPc: Float32Array,
  count: number,
  xPc: number,
  yPc: number,
  zPc: number,
): number {
  if (count === 0) return -1;

  _bestDistSq = Infinity;
  _bestIdx = -1;

  const cx0 = cellCoord(xPc);
  const cy0 = cellCoord(yPc);
  const cz0 = cellCoord(zPc);

  // Expanding shell search; ring r covers max(|Δcx|,|Δcy|,|Δcz|) == r.
  // Minimum possible Euclidean distance to any ring-r cell is (r-1)*CELL_SIZE,
  // so once bestDistSq ≤ that threshold squared we can stop.
  //
  // Each ring is visited by iterating its surface cells directly — three pairs
  // of face slabs that together tile the shell without overlap or gaps:
  //   ±X faces: full (2r+1)² slabs
  //   ±Y faces: (2r-1)×(2r+1) strips (X edges already covered)
  //   ±Z faces: (2r-1)² patches (X and Y edges already covered)
  // This is O(r²) per ring rather than O(r³) for the full-cube scan.
  for (let r = 0; r <= 200; r++) {
    if (r > 0 && _bestDistSq <= (r - 1) * (r - 1) * CELL_SIZE * CELL_SIZE) break;

    if (r === 0) {
      _scanCell(grid, positionsPc, cx0, cy0, cz0, xPc, yPc, zPc);
      continue;
    }

    // ±X faces
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        _scanCell(grid, positionsPc, cx0 + r, cy0 + a, cz0 + b, xPc, yPc, zPc);
        _scanCell(grid, positionsPc, cx0 - r, cy0 + a, cz0 + b, xPc, yPc, zPc);
      }
    }
    // ±Y faces, excluding the X-face columns already covered
    for (let a = -r + 1; a <= r - 1; a++) {
      for (let b = -r; b <= r; b++) {
        _scanCell(grid, positionsPc, cx0 + a, cy0 + r, cz0 + b, xPc, yPc, zPc);
        _scanCell(grid, positionsPc, cx0 + a, cy0 - r, cz0 + b, xPc, yPc, zPc);
      }
    }
    // ±Z faces, excluding edges already covered by X and Y faces
    for (let a = -r + 1; a <= r - 1; a++) {
      for (let b = -r + 1; b <= r - 1; b++) {
        _scanCell(grid, positionsPc, cx0 + a, cy0 + b, cz0 + r, xPc, yPc, zPc);
        _scanCell(grid, positionsPc, cx0 + a, cy0 + b, cz0 - r, xPc, yPc, zPc);
      }
    }
  }

  return _bestIdx;
}

export function queryRegion(
  grid: SpatialGrid,
  positionsPc: Float32Array,
  originPc: readonly [number, number, number],
  minPc: readonly [number, number, number],
  maxPc: readonly [number, number, number],
  maxCount: number,
): Uint32Array {
  // Convert absolute AABB to tile-local
  const minX = minPc[0] - originPc[0];
  const minY = minPc[1] - originPc[1];
  const minZ = minPc[2] - originPc[2];
  const maxX = maxPc[0] - originPc[0];
  const maxY = maxPc[1] - originPc[1];
  const maxZ = maxPc[2] - originPc[2];

  const cxMin = cellCoord(minX);
  const cyMin = cellCoord(minY);
  const czMin = cellCoord(minZ);
  const cxMax = cellCoord(maxX);
  const cyMax = cellCoord(maxY);
  const czMax = cellCoord(maxZ);

  const results: number[] = [];

  const rangeX = cxMax - cxMin + 1;
  const rangeY = cyMax - cyMin + 1;
  const rangeZ = czMax - czMin + 1;
  const cellsInRange = rangeX * rangeY * rangeZ;

  function checkIndices(indices: Uint32Array): boolean {
    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j]!;
      const px = positionsPc[idx * 3]!;
      const py = positionsPc[idx * 3 + 1]!;
      const pz = positionsPc[idx * 3 + 2]!;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY && pz >= minZ && pz <= maxZ) {
        results.push(idx);
        if (results.length >= maxCount) return true;
      }
    }
    return false;
  }

  if (cellsInRange <= grid.size) {
    // Dense query: iterate the coordinate range
    outer: for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cz = czMin; cz <= czMax; cz++) {
          const indices = grid.get(cellKey(cx, cy, cz));
          if (indices !== undefined && checkIndices(indices)) break outer;
        }
      }
    }
  } else {
    // Sparse query: iterate only populated grid cells and check if in range
    for (const [key, indices] of grid) {
      // Decode cell coords from packed key
      const cz = (key % 4096) - 2048;
      const cy = (Math.floor(key / 4096) % 4096) - 2048;
      const cx = Math.floor(key / (4096 * 4096)) - 2048;
      if (cx < cxMin || cx > cxMax || cy < cyMin || cy > cyMax || cz < czMin || cz > czMax) {
        continue;
      }
      if (checkIndices(indices)) break;
    }
  }

  return new Uint32Array(results);
}
