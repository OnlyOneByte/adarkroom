// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState, freezeClock } from './helpers.js';

// A village save made by the unmodified v1.3 game; see fixtures/generate-v1.3-save.js.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/v1.3-village.json', import.meta.url)));

test('a v1.3 village save loads intact', async ({ page }) => {
  await freezeClock(page); // no income ticks so stores compare exactly
  const errors = await openGame(page, { save: fixture });

  const state = await getState(page);
  // Engine.loadGame silently starts a new game on a bad save, so check the values.
  expect(state.version).toBe(2.9); // migrated by $SM.updateOldState
  expect(state.features.location).toEqual(fixture.features.location);
  expect(state.game.buildings).toEqual(fixture.game.buildings);
  expect(state.game.population).toBe(fixture.game.population);
  expect(state.game.workers).toEqual(fixture.game.workers);
  expect(state.stores).toEqual(fixture.stores);
  expect(state.game.builder.level).toBe(4);
  await page.clock.resume(); // time runs again for the clicks

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

// A hex-map save from generator 1 (v2.3, the fire network); see fixtures/generate-v2.3-save.js.
const hexSave = JSON.parse(fs.readFileSync(new URL('./fixtures/v2.3-fire.json', import.meta.url)));

test('a generator-1 hex save loads as v2.9 without being re-projected: its map, mask and city kept, the garrison moved and unseen', async ({ page }) => {
  const errors = await openGame(page, { save: hexSave });
  const r = await page.evaluate(() => {
    const gen = World.hex.gen, g = Network.garrison(), site = gen.sites[gen.garrison];
    return {
      version: $SM.get('version'), gen: $SM.get('game.world.hex.gen'), mask: $SM.get('game.world.hex.mask'),
      delta: $SM.get('game.world.hex.delta'), capital: $SM.get('game.cities.capital.hex'),
      garrison: g, at: site.anchor, hidden: site.hexes.every((h) => World.hexGlyph(h[0], h[1], World.hex.map)[0] !== 'Π'),
    };
  });
  expect(r.version).toBe(2.9);
  expect(r.gen).toBe(2);
  expect(r.mask).toBe(hexSave.game.world.hex.mask);
  expect(r.delta).toEqual(hexSave.game.world.hex.delta);
  expect(r.capital).toEqual(hexSave.game.cities.capital.hex);
  expect(r.garrison).toEqual(r.at);
  expect(r.hidden).toBe(true); // not until "smoke in the hills" marks it
  expect(errors).toEqual([]);
});

test('a hex save with a waystation on the map loads (the land view paints it before any trek)', async ({ page }) => {
  const save = JSON.parse(JSON.stringify(hexSave));
  const cap = save.game.cities.capital.hex;
  save.game.world.hex.delta[(cap[0] + 2) + ',' + cap[1]] = 'P'; // a cleared landmark: World.TILE.OUTPOST
  const errors = await openGame(page, { save });
  const r = await page.evaluate((at) => ({ tile: World.hex.map[at[0]][at[1]], used: World.outpostUsed(at[0], at[1]) }), [cap[0] + 2, cap[1]]);
  expect(r).toEqual({ tile: 'P', used: false });
  expect(errors).toEqual([]);
});
