// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState } from './helpers.js';

// A village save made by the unmodified v1.3 game; see fixtures/generate-v1.3-save.js.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/v1.3-village.json', import.meta.url)));

test('a v1.3 village save loads intact', async ({ page }) => {
  await page.clock.install(); // freeze income ticks so stores compare exactly
  const errors = await openGame(page, { save: fixture });

  const state = await getState(page);
  // Engine.loadGame silently starts a new game on a bad save, so check the values.
  expect(state.version).toBe(1.3);
  expect(state.features.location).toEqual(fixture.features.location);
  expect(state.game.buildings).toEqual(fixture.game.buildings);
  expect(state.game.population).toBe(fixture.game.population);
  expect(state.game.workers).toEqual(fixture.game.workers);
  expect(state.stores).toEqual(fixture.stores);
  expect(state.game.builder.level).toBe(4);

  await expect(page.locator('#location_outside')).toBeVisible();
  await page.locator('#location_outside').click();
  await expect(page.locator('#building_row_hut .row_val')).toHaveText(String(fixture.game.buildings.hut));
  await expect(page.locator('#workers_row_hunter .row_val > span')).toHaveText(String(fixture.game.workers.hunter));
  expect(errors).toEqual([]);
});

test('the loaded save keeps producing', async ({ page }) => {
  await page.clock.install();
  const errors = await openGame(page, { save: fixture });

  await page.clock.runFor(11 * 1000); // every income source pays out once
  const state = await getState(page);
  expect(state.stores.fur).toBeGreaterThan(fixture.stores.fur);
  expect(state.stores.bait).toBeGreaterThan(fixture.stores.bait);
  expect(errors).toEqual([]);
});
