// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState, freezeClock } from './helpers.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/v1.3-village.json', import.meta.url)));

const city = (page, path) => page.evaluate((p) => $SM.get(p), path);

// A hovered button's cost tooltip covers the button below it, so move off first.
const press = async (page, selector) => {
  await page.mouse.move(0, 0);
  await page.locator(selector).click();
};

test('fresh save: 20 huts and a trading post open the town, which builds and works', async ({ page }) => {
  const errors = await openGame(page);

  // Skip the slow early game: light the fire, open the forest, wake the builder, fill the stores.
  await page.locator('#lightButton').click();
  await page.evaluate(() => {
    clearTimeout(Events._eventTimeout); // no random events mid-test
    Room.unlockForest();
    $SM.set('game.builder.level', 4);
    $SM.set('game.temperature', Room.TempEnum.Hot);
    $SM.setM('stores', { wood: 100000, fur: 10000, meat: 10000 });
  });

  // Build the village the normal way, through the room's build buttons.
  const hut = page.locator('#build_hut');
  for (let i = 0; i < 20; i++) await hut.click();
  expect(await city(page, 'game.buildings["hut"]')).toBe(20);
  expect(await city(page, 'features.location.city')).toBeFalsy();
  await expect(page.locator('#location_city')).toHaveCount(0);

  await press(page, '#build_trading-post');
  expect(await city(page, 'features.location.city')).toBe(true);
  await expect(page.locator('#location_city')).toBeVisible();
  await expect(page.locator('#location_city')).toHaveText('A Growing Town');

  // The village became the capital: a city record whose stockpile is the original one.
  expect(await city(page, 'game.cities["capital"]')).toEqual({
    name: 'capital', focus: null, population: { citizens: 0 }, buildings: {}, workers: {}, notices: {},
  });
  expect(await city(page, 'game.empire.treasury')).toEqual({});
  expect(await page.evaluate(() => City.storesPath('capital'))).toBe('stores');

  // Build the placeholder house in the town.
  await page.locator('#location_city').click();
  await expect(page.locator('#build_city_house')).toBeInViewport();
  const woodBeforeHouse = await city(page, 'stores.wood');
  await press(page, '#build_city_house');
  expect(await city(page, 'game.cities["capital"].buildings["house"]')).toBe(1);
  expect(await city(page, 'stores.wood')).toBe(woodBeforeHouse - 300);
  await expect(page.locator('#citizens')).toHaveText('citizens 0/4');

  // Citizens normally arrive on a timer; bring them in now.
  await page.evaluate(() => City.increaseCitizens());
  const citizens = await city(page, 'game.cities["capital"].population.citizens');
  expect(citizens).toBeGreaterThanOrEqual(2);
  expect(citizens).toBeLessThanOrEqual(4);

  // Put a citizen to work; the capital's job source pays into the capital's stores.
  // Nothing else produces wood here: no villagers yet, and the builder was never asked to help.
  const woodBefore = await city(page, 'stores.wood');
  await page.locator('#city_workers_row_labourer .upBtn').click();
  expect(await city(page, 'game.cities["capital"].workers["labourer"]')).toBe(1);
  await expect(page.locator('#city_workers_row_idle .row_val > span')).toHaveText(String(citizens - 1));
  expect(await city(page, 'income["capital:labourer"]')).toMatchObject({ delay: 10, stores: { wood: 1 } });
  expect(await city(page, 'income["capital:labourer"].city')).toBeUndefined();
  await expect.poll(() => city(page, 'stores.wood'), { timeout: 15000 }).toBe(woodBefore + 1);

  // Everything lands in the save.
  const saved = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(saved.version).toBe(2.9);
  expect(saved.features.location.city).toBe(true);
  expect(saved.game.cities.capital.buildings).toEqual({ house: 1 });
  expect(errors).toEqual([]);
});

test('city-scoped income pays into that city, not the capital', async ({ page }) => {
  await page.clock.install();
  const save = structuredClone(fixture);
  save.game.buildings.hut = 20;
  const errors = await openGame(page, { save });

  // shortcut: no way to found a second city yet, so make one by hand and staff it.
  await page.evaluate(() => {
    City.createCity('outpost', 'outpost');
    $SM.set('game.cities["outpost"].stores.wood', 5);
    $SM.set('game.cities["outpost"].population.citizens', 3);
    $SM.set('game.cities["outpost"].buildings["house"]', 1);
    City.checkWorkers('outpost');
    $SM.set('game.cities["outpost"].workers["labourer"]', 2);
  });
  expect(await city(page, 'income["outpost:labourer"]')).toMatchObject({ city: 'outpost', stores: { wood: 2 } });

  // silence the village's own income so any change to the capital's stores would come from the outpost
  const capitalStores = await page.evaluate(() => {
    for (const k in State.income) if (k != 'outpost:labourer') delete State.income[k];
    return JSON.parse(JSON.stringify(State.stores));
  });
  await page.clock.runFor(5 * 1000); // a new source pays on its first tick, then every 10s
  expect(await city(page, 'game.cities["outpost"].stores.wood')).toBe(5 + 2);
  expect(await city(page, 'stores')).toEqual(capitalStores);
  expect(errors).toEqual([]);
});

test('the v1.3 fixture migrates to v2.9 without a town', async ({ page }) => {
  const errors = await openGame(page, { save: fixture });
  const state = await getState(page);
  expect(state.version).toBe(2.9);
  expect(state.features.location.city).toBeUndefined();
  expect(state.game.cities).toBeUndefined();
  expect(state.game.empire).toBeUndefined();
  await expect(page.locator('#location_city')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a v1.3 save that already has 20 huts and a trading post opens the town on load', async ({ page }) => {
  await freezeClock(page); // no income ticks so stores compare exactly
  const save = structuredClone(fixture);
  save.game.buildings.hut = 20;
  const errors = await openGame(page, { save });
  const state = await getState(page);
  expect(state.version).toBe(2.9);
  expect(state.features.location.city).toBe(true);
  expect(Object.keys(state.game.cities)).toEqual(['capital']);
  // the village's own state is untouched by the unlock
  expect(state.game.buildings).toEqual(save.game.buildings);
  expect(state.game.population).toBe(save.game.population);
  expect(state.stores).toEqual(save.stores);
  await expect(page.locator('#location_city')).toBeVisible();
  expect(errors).toEqual([]);
});
