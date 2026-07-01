import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { injectFrameStats, readFrameStats, percentile } from './helpers/frame-stats';

/**
 * TASK-015 M1 integration flows: load the real HYG pack, search → fly,
 * click-pick, perf smoke. Chromium-only (see playwright.config.ts).
 *
 * Click-pick queries the app's REAL camera + pick path through the e2e hook
 * (`__cosmos.projectToScreen` / `__cosmos.pickAt`) instead of re-deriving the camera
 * projection in test code. The old parallel model (cameraAfterGoTo / projectToPx /
 * findEmptySkyPx with hard-coded HUD pixel boxes) charged two recurring taxes — a
 * hand-edit on every camera change, and breakage on Linux font width — both removed
 * here. See docs/research/e2e-ci-flakiness-rootcause-and-query-hook.md.
 */

// ── Vector helpers ───────────────────────────────────────────────────────────

type Vec3 = readonly [number, number, number];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

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
      // Picking query surface (replaces the m1 parallel camera model). Both use the
      // app's live camera + flight controller; CSS-px in/out, so they're independent
      // of DPR and platform font geometry.
      pickAt(clientX: number, clientY: number): string | null;
      projectToScreen(
        localPos: readonly [number, number, number],
      ): { x: number; y: number } | null;
    };
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('load: pack ready, no errors, initial Sol-side baseline', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await waitReady(page);

  // Static scene at rest — visual baseline, REFERENCE-MACHINE only. The WebGL scene
  // render is hardware/load-dependent on CI (SceneHost's drei PerformanceMonitor
  // oscillates the canvas DPR under a contended runner), so pixel-exact visual
  // regression lives on the reference GPU, same bucket as wall-clock perf. CI gates
  // the deterministic load correctness above. Canvas only skips the HUD compositor noise.
  await page.waitForTimeout(1_000);
  if (!process.env['CI']) {
    await expect(page.locator('canvas')).toHaveScreenshot('m1-initial.png');
  }

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

  // At rest after arrival — visual baseline, REFERENCE-MACHINE only (see m1-initial).
  // This one proved the point: after the perf-smoke flight loads the runner, CI's
  // adaptive DPR is mid-adjustment at capture time (canvas 640×360, never "stable"),
  // so the element screenshot timed out. Pixel-exact visual regression is reference-
  // GPU only; CI gates the flight correctness (panel name + no errors) instead.
  await page.waitForTimeout(500);
  if (!process.env['CI']) {
    await expect(page.locator('canvas')).toHaveScreenshot('m1-betelgeuse.png');
  }

  expect(pageErrors, 'no uncaught errors during flight').toHaveLength(0);
});

test('click-pick: select a bright star at its projected position, empty-sky click deselects', async ({
  page,
  request,
  baseURL,
}) => {
  const pack = await fetchPack(request, baseURL!);
  const betelgeuse = findStarByName(pack, 'Betelgeuse');

  await page.goto('/');
  await waitReady(page);

  // Fly to Betelgeuse: off the galactic plane, so looking away from Sol there is
  // genuinely empty sky in the magnitude-limited catalog (near Sol every direction
  // sits inside the 0.02 rad pick cone of ~11 stars — no empty sky exists there).
  await searchAndGo(page, 'betelgeuse', 'Betelgeuse');
  await waitFlightDone(page);
  await page.waitForFunction((id) => window.__cosmos?.selectedId === id, betelgeuse.id);

  // ── Positive pick ──────────────────────────────────────────────────────────
  // Clear the search-made selection so the CLICK is what selects.
  await page.locator('.cosmos-ui-info-close').click();
  await page.waitForFunction(() => window.__cosmos?.selectedId === null);

  // Project the target through the REAL camera, then confirm the REAL pick agrees the
  // pixel selects it and that the pixel is on the canvas (not under HUD chrome). All
  // CSS-px, all queried from the app — no camera model, no hard-coded HUD geometry.
  const targetPx = await page.evaluate((local) => {
    const hook = window.__cosmos!;
    const px = hook.projectToScreen(local);
    if (!px) return null;
    const canvas = document.querySelector('canvas');
    return {
      ...px,
      onCanvas: document.elementFromPoint(px.x, px.y) === canvas,
      picked: hook.pickAt(px.x, px.y),
    };
  }, betelgeuse.posPc as [number, number, number]);

  expect(targetPx, 'Betelgeuse must project on-screen at its arrival vantage').not.toBeNull();
  expect(targetPx!.onCanvas, 'the target pixel must be on the canvas, not under HUD chrome').toBe(
    true,
  );
  expect(
    targetPx!.picked,
    'the real pick at the projected pixel must resolve to the target',
  ).toBe(betelgeuse.id);

  await page.mouse.click(targetPx!.x, targetPx!.y);
  await page.waitForFunction((id) => window.__cosmos?.selectedId === id, betelgeuse.id);
  await expect(page.locator('.cosmos-ui-info-name')).toHaveText('Betelgeuse');

  // ── Empty-sky deselect ─────────────────────────────────────────────────────
  // Scan the canvas for a pixel that the REAL pick reports as empty AND that the REAL
  // DOM hit-test reports as the canvas (no HUD element on top → the click reaches the
  // scene). This replaces findEmptySkyPx's parallel star-cone math + hard-coded HUD
  // pixel boxes, so neither a camera change nor Linux font width can break it.
  const emptyPx = await page.evaluate(() => {
    const hook = window.__cosmos!;
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let best: { x: number; y: number; dist: number } | null = null;
    for (let gx = 0.1; gx <= 0.9 + 1e-9; gx += 0.1) {
      for (let gy = 0.1; gy <= 0.9 + 1e-9; gy += 0.1) {
        const x = rect.left + gx * rect.width;
        const y = rect.top + gy * rect.height;
        if (hook.pickAt(x, y) !== null) continue; // ray hits a star
        if (document.elementFromPoint(x, y) !== canvas) continue; // HUD chrome on top
        const dist = Math.hypot(x - cx, y - cy);
        if (best === null || dist < best.dist) best = { x, y, dist };
      }
    }
    return best;
  });

  expect(
    emptyPx,
    'an unoccluded empty-sky pixel must exist at the Betelgeuse vantage',
  ).not.toBeNull();
  // Logged so a CI-only miss is triagable without a rerun.
  console.log(`[m1 empty-sky] px=(${emptyPx!.x.toFixed(0)},${emptyPx!.y.toFixed(0)})`);

  await page.mouse.click(emptyPx!.x, emptyPx!.y);
  await page.waitForFunction(() => window.__cosmos?.selectedId === null);
});
