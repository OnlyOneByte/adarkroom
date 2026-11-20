// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { openGame, getState } from './helpers.js';

test('fresh game loads without errors and shows the room', async ({ page }) => {
  const errors = await openGame(page);

  await expect(page.locator('#roomPanel')).toBeVisible();
  await expect(page.locator('#lightButton')).toBeVisible();
  await expect(page.locator('#location_room')).toBeVisible();

  const state = await getState(page);
  expect(state.version).toBe(2.1);
  expect(state.game.fire.value).toBe(0);
  expect(errors).toEqual([]);
});

test('scripted play: light fire, reach the forest, gather wood', async ({ page }) => {
  const errors = await openGame(page);

  await page.locator('#lightButton').click();
  await expect.poll(() => page.evaluate(() => $SM.get('game.fire.value'))).toBeGreaterThan(0);

  // The builder normally opens the forest after a few minutes; jump ahead.
  await page.evaluate(() => Room.unlockForest());
  await expect(page.locator('#outsidePanel')).toBeAttached();
  const before = await page.evaluate(() => $SM.get('stores.wood'));

  await page.locator('#location_outside').click();
  await expect(page.locator('#gatherButton')).toBeInViewport();
  await page.locator('#gatherButton').click();
  await expect.poll(() => page.evaluate(() => $SM.get('stores.wood'))).toBe(before + 10);

  // The save written to localStorage reflects the play.
  const saved = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(saved.stores.wood).toBe(before + 10);
  expect(saved.features.location.outside).toBe(true);
  expect(errors).toEqual([]);
});

// The "Sound Available!" greeting opens 3 s after a fresh load and used to land on
// top of whatever button a test was about to click (the flaky town test).
test('no event opens over the buttons while a test plays', async ({ page }) => {
  await page.clock.install();
  const errors = await openGame(page);
  await page.clock.runFor(10000);
  await expect(page.locator('#event')).toHaveCount(0);
  expect(errors).toEqual([]);
});
