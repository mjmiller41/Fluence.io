import { expect, test } from '@playwright/test';

// The offline invariant (CLAUDE.md invariant 3 / development-plan §4.4, §8):
// after one online load the editor must fully function with the network cut —
// the app shell, the scene model, and the WebGL render worker all from cache.
test.describe('offline invariant', () => {
  test('@offline editor shell + scene editing work with the network blocked', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('app-title')).toHaveText('Fluence');

    // Wait for the service worker to activate, control the page, and precache.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          });
        });
      }
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const keys = await caches.keys();
        if (keys.length > 0) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    });

    // Cut the network entirely and reload from the service worker cache.
    await context.setOffline(true);
    await page.reload();

    await expect(page.getByTestId('net-status')).toHaveText('offline');
    await expect(page.getByTestId('app-title')).toHaveText('Fluence');

    // Editing works offline: the scene model + render worker run from cache.
    await expect(page.getByTestId('shape-count')).toHaveText('0');
    await page.getByTestId('add-rect').click();
    await expect(page.getByTestId('shape-count')).toHaveText('1');
    await page.getByTestId('add-rect').click();
    await expect(page.getByTestId('shape-count')).toHaveText('2');

    // Boolean union runs Clipper2 WASM in a worker from precache — merges the two
    // overlapping rects into one shape, proving geometry works fully offline.
    await page.getByTestId('select-all').click();
    await page.getByTestId('op-union').click();
    await expect(page.getByTestId('shape-count')).toHaveText('1', { timeout: 20_000 });

    await context.setOffline(false);
  });
});
