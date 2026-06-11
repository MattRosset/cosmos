import type { Page } from '@playwright/test';

export interface FrameStats {
  samples: number[];
  longTasks: number;
}

/**
 * Injects a rAF-based frame-time collector and a PerformanceObserver for
 * longtasks into the page before it navigates. Must be called before
 * `page.goto`. Exposes `window.__frameStats` for `readFrameStats`.
 */
export async function injectFrameStats(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stats: FrameStats = { samples: [], longTasks: 0 };
    (window as unknown as Record<string, unknown>)['__frameStats'] = stats;

    let last = performance.now();
    function tick() {
      const now = performance.now();
      stats.samples.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    try {
      const observer = new PerformanceObserver((list) => {
        stats.longTasks += list.getEntries().length;
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // longtask PerformanceObserver is not supported in all environments
    }
  });
}

export async function readFrameStats(page: Page): Promise<FrameStats> {
  return page.evaluate(() => {
    return (window as unknown as { __frameStats: FrameStats })['__frameStats'];
  });
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
