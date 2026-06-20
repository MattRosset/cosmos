import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { injectFrameStats, readFrameStats, percentile } from './helpers/frame-stats';

/**
 * TASK-015 M1 integration flows: load the real HYG pack, search → fly,
 * click-pick, perf smoke. Chromium-only (see playwright.config.ts).
 *
 * Click targets are computed from the real pack plus a deterministic model of
 * the post-goTo camera, so the test self-adapts if the pack is regenerated:
 *
 * - The goTo flight moves the camera along the straight line start → target
 *   (the camera→target direction is constant), arriving exactly
 *   ARRIVAL_DISTANCE_M short of the target.
 * - The orientation slerp therefore rotates about a FIXED axis (f0 × target
 *   direction) with time constant durationMs/5; integrated over the full
 *   6000 ms flight the residual look-error is θ·e⁻⁵ along that geodesic
 *   (≈ 0.55° for an 81° initial offset), deterministic to within one frame's
 *   dt (< 0.05°).
 */

// ── Wiring constants (must match the app / frozen specs) ────────────────────

const GALAXY_UNIT_M = 3.0857e16; // CONTEXT_UNIT_METERS.galaxy (1 pc)
// TASK-029: star/host goTo arrival is 5e14 m (inside the system-enter threshold);
// the app now boots in the galaxy star field 0.06 pc from Sol (NavDriver.INITIAL_CAMERA).
const ARRIVAL_DISTANCE_M = 5e14;
const ARRIVAL_PC = ARRIVAL_DISTANCE_M / GALAXY_UNIT_M;
const CAM_START: Vec3 = [0, 0, 0.06];
const SLERP_RESIDUAL = Math.exp(-5); // 6000 ms flight, slerp T = 1200 ms
const PICK_MAX_ANGLE_RAD = 0.02;

const VIEW_W = 1280;
const VIEW_H = 720;
const TAN_Y = Math.tan(Math.PI / 6); // fov 60° vertical
const TAN_X = TAN_Y * (VIEW_W / VIEW_H);

// ── Vector helpers ───────────────────────────────────────────────────────────

type Vec3 = readonly [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Rodrigues rotation of v about unit axis k by angle ang. */
function rotate(v: Vec3, k: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

// ── Pack access ──────────────────────────────────────────────────────────────

interface Pack {
  readonly count: number;
  readonly positions: Float32Array;
  readonly originPc: Vec3;
  readonly catalogIds: Uint32Array;
  readonly names: Record<string, string>;
}

interface PackManifest {
  count: number;
  binUrl: string;
  namesUrl: string;
  originPc: [number, number, number];
  buffers: Record<string, { byteOffset: number; byteLength: number }>;
}

async function fetchPack(request: APIRequestContext, baseURL: string): Promise<Pack> {
  const manifest = (await (
    await request.get(`${baseURL}/packs/manifest.json`)
  ).json()) as PackManifest;
  const bin = await (await request.get(`${baseURL}/packs/${manifest.binUrl}`)).body();
  const names = (await (
    await request.get(`${baseURL}/packs/${manifest.namesUrl}`)
  ).json()) as Record<string, string>;
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const pos = manifest.buffers['positionsPc']!;
  const ids = manifest.buffers['catalogIds']!;
  return {
    count: manifest.count,
    positions: new Float32Array(buf, pos.byteOffset, pos.byteLength / 4),
    originPc: manifest.originPc,
    catalogIds: new Uint32Array(buf, ids.byteOffset, ids.byteLength / 4),
    names,
  };
}

interface NamedStar {
  readonly index: number;
  readonly catalogId: number;
  readonly id: string;
  readonly posPc: Vec3;
}

function findStarByName(pack: Pack, name: string): NamedStar {
  const entry = Object.entries(pack.names).find(([, v]) => v === name);
  if (!entry) throw new Error(`star '${name}' not in names.json`);
  const catalogId = Number(entry[0]);
  for (let i = 0; i < pack.count; i++) {
    if (pack.catalogIds[i] === catalogId) {
      return {
        index: i,
        catalogId,
        id: `hyg:${catalogId}`,
        posPc: add(pack.originPc, [
          pack.positions[i * 3]!,
          pack.positions[i * 3 + 1]!,
          pack.positions[i * 3 + 2]!,
        ]),
      };
    }
  }
  throw new Error(`catalogId ${catalogId} not in pack`);
}

// ── Deterministic post-goTo camera model ─────────────────────────────────────

interface CameraModel {
  readonly camPos: Vec3;
  readonly targetDir: Vec3;
  readonly fwd: Vec3;
  readonly up: Vec3;
  readonly right: Vec3;
}

function cameraAfterGoTo(targetPc: Vec3): CameraModel {
  const targetDir = norm(sub(targetPc, CAM_START));
  const f0: Vec3 = [0, 0, -1];
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(f0, targetDir))));
  const axis = norm(cross(f0, targetDir));
  const ang = theta * (1 - SLERP_RESIDUAL);
  return {
    camPos: sub(targetPc, scale(targetDir, ARRIVAL_PC)),
    targetDir,
    fwd: rotate(f0, axis, ang),
    up: rotate([0, 1, 0], axis, ang),
    right: rotate([1, 0, 0], axis, ang),
  };
}

/** Project a world direction to viewport px through the modeled camera. */
function projectToPx(cam: CameraModel, dir: Vec3): { x: number; y: number } {
  const zc = dot(dir, cam.fwd);
  const ndcX = dot(dir, cam.right) / (zc * TAN_X);
  const ndcY = dot(dir, cam.up) / (zc * TAN_Y);
  return { x: ((ndcX + 1) / 2) * VIEW_W, y: ((1 - ndcY) / 2) * VIEW_H };
}

/** Angles of the two stars angularly nearest to a ray (and the nearest index). */
function nearestTwoAngles(
  pack: Pack,
  camPos: Vec3,
  rayDir: Vec3,
): { index: number; angle: number; secondAngle: number } {
  let best = -2;
  let second = -2;
  let index = -1;
  for (let i = 0; i < pack.count; i++) {
    const d = norm([
      pack.originPc[0] + pack.positions[i * 3]! - camPos[0],
      pack.originPc[1] + pack.positions[i * 3 + 1]! - camPos[1],
      pack.originPc[2] + pack.positions[i * 3 + 2]! - camPos[2],
    ]);
    const dp = dot(d, rayDir);
    if (dp > best) {
      second = best;
      best = dp;
      index = i;
    } else if (dp > second) {
      second = dp;
    }
  }
  return {
    index,
    angle: Math.acos(Math.min(1, best)),
    secondAngle: Math.acos(Math.min(1, second)),
  };
}

/**
 * Find an in-frustum click point whose ray misses every star by a wide margin
 * (model error is < ~1.5e-3 rad, so > 0.025 rad guarantees a pick miss).
 * Avoids the HUD title panel (top-left) and info panel (top-right) regions.
 */
function findEmptySkyPx(pack: Pack, cam: CameraModel): { x: number; y: number } {
  let best = { angle: 0, x: 0, y: 0 };
  for (let gx = -0.85; gx <= 0.85; gx += 0.1) {
    for (let gy = -0.85; gy <= 0.85; gy += 0.1) {
      const dir = norm(
        add(add(scale(cam.right, gx * TAN_X), scale(cam.up, gy * TAN_Y)), cam.fwd),
      );
      const { x, y } = projectToPx(cam, dir);
      if (x < 340 && y < 140) continue; // HUD title panel
      if (x > 940 && y < 420) continue; // info panel
      const { angle } = nearestTwoAngles(pack, cam.camPos, dir);
      if (angle > best.angle) best = { angle, x, y };
    }
  }
  expect(
    best.angle,
    'an in-frustum empty-sky direction must clear the pick cone with margin',
  ).toBeGreaterThan(PICK_MAX_ANGLE_RAD + 0.005);
  return best;
}

// ── Page helpers ─────────────────────────────────────────────────────────────

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
}

async function searchAndGo(page: Page, query: string, resultText: string): Promise<void> {
  await page.keyboard.press('Control+k');
  const input = page.locator('.cosmos-ui-palette input');
  await input.fill(query);
  await expect(page.locator('.cosmos-ui-palette-item').first()).toContainText(resultText);
  await input.press('Enter');
}

async function waitFlightDone(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.goToActive === true, undefined, {
    timeout: 2_000,
  });
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 15_000,
  });
}

declare global {
  interface Window {
    // Widened in TASK-029 for the M2 hook and TASK-040 for the M3 streaming/quality
    // hook; M1 reads only the first three fields. The M3 fields are optional so the
    // M1/M2 specs are unaffected.
    __cosmos?: {
      ready: boolean;
      goToActive: boolean;
      selectedId: string | null;
      contextId: string;
      anchorSystemId: string | null;
      epochJD: number;
      cameraPosition: { context: string; local: [number, number, number] };
      streaming?: {
        inFlight: number;
        loadedChunks: number;
        renderedPoints: number;
        drawCalls: number;
      };
      qualityTier?: string;
    };
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('load: pack ready, no errors, initial Sol-side baseline', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await waitReady(page);

  // Static scene at rest — let a few frames settle before the baseline. Canvas
  // only: the HUD's backdrop-filter blur composites with per-frame sub-pixel
  // noise on SwiftShader (retries never settle) and its text is live data; the
  // scene pixels are the regression signal.
  await page.waitForTimeout(1_000);
  await expect(page.locator('canvas')).toHaveScreenshot('m1-initial.png');

  expect(pageErrors, 'no uncaught errors during load').toHaveLength(0);
});

test('search → fly: Betelgeuse flight with info panel, perf smoke, baseline', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await injectFrameStats(page);
  await page.goto('/');
  await waitReady(page);

  const samplesBefore = (await readFrameStats(page)).samples.length;

  await searchAndGo(page, 'betelgeuse', 'Betelgeuse');
  await waitFlightDone(page);

  // Selection happened on Enter; the panel shows the target's data
  await expect(page.locator('.cosmos-ui-info-name')).toHaveText('Betelgeuse');

  // Perf smoke during the flight (CI-relaxed; the strict reference-machine
  // 60 fps gate is TASK-017)
  const stats = await readFrameStats(page);
  const flightSamples = stats.samples.slice(samplesBefore);
  expect(flightSamples.length).toBeGreaterThan(0);
  const p95 = percentile(flightSamples, 95);
  const maxFrame = Math.max(...flightSamples);
  // Strict frame budgets are a reference-machine criterion — same doctrine as
  // m2 perf smoke. CI's SwiftShader is contention-dominated; we log every run.
  console.log(`[m1 perf] p95=${p95.toFixed(1)}ms max=${maxFrame.toFixed(1)}ms`);
  if (!process.env['CI']) {
    expect(p95, 'p95 frame time during flight must be < 75 ms').toBeLessThan(75);
  }

  // At rest after arrival — baseline keyframe. Canvas only (see m1-initial): the
  // full-page shot failed in CI because the HUD's backdrop-filter blur never
  // settles on SwiftShader, so the screenshot retries timed out; the scene pixels
  // are the signal.
  await page.waitForTimeout(500);
  await expect(page.locator('canvas')).toHaveScreenshot('m1-betelgeuse.png');

  expect(pageErrors, 'no uncaught errors during flight').toHaveLength(0);
});

/**
 * Among well-known bright stars present in the pack, choose the one most
 * angularly isolated at its own goTo arrival vantage — so clicking its projected
 * centre selects it unambiguously despite the camera-model error. The M2 arrival
 * distance (5e14 m, TASK-029) stops farther from the target than M1's old 1e13 m,
 * making the field denser, so a hard-coded Sirius is no longer guaranteed safe;
 * this auto-adapts to the pack and the arrival distance.
 */
function pickIsolatedTarget(
  pack: Pack,
  candidateNames: readonly string[],
): { star: NamedStar; name: string; cam: CameraModel } {
  let best:
    | { star: NamedStar; name: string; cam: CameraModel; secondAngle: number }
    | null = null;
  for (const name of candidateNames) {
    if (!Object.values(pack.names).includes(name)) continue;
    const star = findStarByName(pack, name);
    const cam = cameraAfterGoTo(star.posPc);
    const near = nearestTwoAngles(pack, cam.camPos, cam.targetDir);
    // The flown-to star must be the nearest to its own flight ray, within the
    // model error; keep the most isolated runner-up across candidates.
    if (near.index !== star.index || near.angle >= 2e-3) continue;
    if (best === null || near.secondAngle > best.secondAngle) {
      best = { star, name, cam, secondAngle: near.secondAngle };
    }
  }
  expect(best, 'at least one candidate bright star must be in the pack').not.toBeNull();
  expect(
    best!.secondAngle,
    'chosen target must clear the camera-model error (runner-up well outside it)',
  ).toBeGreaterThan(5e-3);
  return { star: best!.star, name: best!.name, cam: best!.cam };
}

test('click-pick: select a bright star at its projected position, empty-sky click deselects', async ({
  page,
  request,
  baseURL,
}) => {
  const pack = await fetchPack(request, baseURL!);
  const betelgeuse = findStarByName(pack, 'Betelgeuse');
  const target = pickIsolatedTarget(pack, [
    'Vega', 'Arcturus', 'Capella', 'Procyon', 'Altair', 'Aldebaran',
    'Pollux', 'Fomalhaut', 'Regulus', 'Spica', 'Antares', 'Deneb',
    'Castor', 'Rigel', 'Sirius', 'Canopus', 'Achernar',
  ]);

  await page.goto('/');
  await waitReady(page);

  // Face the target via the search flow, then clear the selection it made so the
  // click is what selects.
  await searchAndGo(page, target.name.toLowerCase(), target.name);
  await waitFlightDone(page);
  await page.locator('.cosmos-ui-info-close').click();
  await page.waitForFunction(() => window.__cosmos?.selectedId === null);

  // Click the target's projected position (its direction from the camera IS the
  // flight direction — the camera traveled along it).
  const targetPx = projectToPx(target.cam, target.cam.targetDir);
  await page.mouse.click(targetPx.x, targetPx.y);
  await page.waitForFunction(
    (id) => window.__cosmos?.selectedId === id,
    target.star.id,
  );
  await expect(page.locator('.cosmos-ui-info-name')).toHaveText(target.name);

  // Near Sol the catalog leaves no direction empty within the 0.02 rad pick
  // cone (≈ 11 stars per cone on average) — fly to Betelgeuse, where looking
  // away from Sol the magnitude-limited catalog has genuinely empty sky.
  // Reload first so the flight starts from Sol, matching the camera model
  // (a flight from the Sirius vantage would have a different slerp basis).
  await page.goto('/');
  await waitReady(page);
  await searchAndGo(page, 'betelgeuse', 'Betelgeuse');
  await waitFlightDone(page);
  await page.waitForFunction(
    (id) => window.__cosmos?.selectedId === id,
    betelgeuse.id,
  );

  const camB = cameraAfterGoTo(betelgeuse.posPc);
  const emptyPx = findEmptySkyPx(pack, camB);
  await page.mouse.click(emptyPx.x, emptyPx.y);
  await page.waitForFunction(() => window.__cosmos?.selectedId === null);
});
