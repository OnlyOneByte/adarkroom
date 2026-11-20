// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
// made by the unmodified old games; see fixtures/generate-world-saves.js
const v13 = load('v1.3-world');
const v20 = load('v2.0-town');

const TERRAINS = 12;

// A fresh game that has walked the square map, then opens the town the normal way.
async function freshToTown(page) {
  const errors = await openGame(page);
  await page.locator('#lightButton').click();
  await page.evaluate(() => {
    clearTimeout(Events._eventTimeout); // no random events mid-test
    Room.unlockForest();
    $SM.set('game.builder.level', 4);
    $SM.set('game.temperature', Room.TempEnum.Hot);
    $SM.setM('stores', { wood: 100000, fur: 10000, meat: 10000, 'cured meat': 50, compass: 1 });
    WorldGen.newSeed = () => 4242; // the same world every run
    if (!Path.tab) Path.init();
  });
  // a trek on the square map: walk east, come home
  const square = await page.evaluate(() => {
    Path.outfit = { 'cured meat': 20 };
    Path.embark();
    Math.random = () => 0.99; // no fights
    for (let i = 0; i < 5; i++) World.moveEast();
    World.goHome();
    return { map: $SM.get('game.world.map'), mask: $SM.get('game.world.mask'), hex: !!World.hex };
  });
  expect(square.hex).toBe(false);
  expect(square.map.length).toBe(61);
  // 20 huts and a trading post, built through the room
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) Room.build($('<div>').attr('buildThing', 'hut'));
  });
  expect(await page.evaluate(() => !!World.hex)).toBe(false);
  await page.evaluate(() => Room.build($('<div>').attr('buildThing', 'trading post')));
  return { errors, square };
}

// Everything the tests check about a hex world, read in the page.
function page_summary() {
  const g = World.hex.gen;
  const glyphs = new Set();
  for (let x = 0; x < g.cols; x++) for (let y = 0; y < g.rows; y++) glyphs.add(g.terrain[x][y]);
  const terrains = Object.values(WorldGen.TERRAIN).filter((t) => glyphs.has(t));
  return {
    cols: g.cols, rows: g.rows, capital: g.capital, coreOffset: g.coreOffset,
    atCapital: World.hex.map[g.capital[0]][g.capital[1]],
    terrains: terrains.length,
    formations: g.formations.map((f) => [f.kind, f.hexes.length]),
    sites: g.sites.map((s) => [s.kind, s.hexes.length]),
    ship: World.mapSearch(World.TILE.SHIP, World.hex.map, 1)[0],
    warHeart: g.warHeart,
    villagePos: World.VILLAGE_POS,
  };
}

// every square the prologue revealed is revealed on the hex map, at its projected hex
const revealedKept = (square) => {
  const off = World.hex.gen.coreOffset, mask = World.hex.mask;
  for (let x = 0; x < square.mask.length; x++) {
    for (let y = 0; y < square.mask[x].length; y++) {
      if (square.mask[x][y] && !mask[x + off[0]][y + off[1]]) return [x, y];
    }
  }
  return true;
};

test('fresh save: the town opens the Huge hex map, built from the same world', async ({ page }) => {
  const { errors, square } = await freshToTown(page);
  expect(await page.evaluate(() => $SM.get('features.location.city'))).toBe(true);
  expect(await page.evaluate(() => !!World.hex)).toBe(true);
  const s = await page.evaluate(page_summary);

  expect(s.cols * s.rows).toBeGreaterThanOrEqual(4000);
  expect(s.terrains).toBe(TERRAINS);
  expect(s.formations.length).toBeGreaterThan(0);
  expect(s.formations.some(([, n]) => n > 1)).toBe(true);
  expect(new Set(s.formations.map(([k]) => k))).toEqual(new Set(['range', 'forest', 'sea', 'desert']));
  expect(s.sites.length).toBeGreaterThan(0);
  for (const [, n] of s.sites) {
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(7);
  }
  expect(new Set(s.sites.map(([k]) => k))).toEqual(new Set(['fallenCity', 'crater', 'complex']));

  // the village is the capital, where it was on the square map
  expect(s.atCapital).toBe('A');
  expect([s.coreOffset[0] + 30, s.coreOffset[1] + 30]).toEqual(s.capital);
  expect(s.villagePos).toEqual(s.capital);
  // the ship has moved to the war's heart
  expect([s.ship.x + s.capital[0], s.ship.y + s.capital[1]]).toEqual(s.warHeart);

  // the prologue map is the core of the hex map, and what was seen stays seen
  const core = await page.evaluate((sq) => {
    const off = World.hex.gen.coreOffset, T = World.TILE;
    for (let x = 0; x < 61; x++) {
      for (let y = 0; y < 61; y++) {
        const c = sq.map[x][y], h = World.hex.map[x + off[0]][y + off[1]];
        if (c.charAt(0) === T.SHIP) continue; // relocated
        if (!WorldGen.isTerrain(c) && c !== h) return [x, y, c, h];
        if (WorldGen.isTerrain(c) && !WorldGen.isTerrain(h)) return [x, y, c, h];
      }
    }
    return true;
  }, square);
  expect(core).toBe(true);
  expect(await page.evaluate(revealedKept, square)).toBe(true);

  // the save holds a seed and deltas, not the hex world
  const saved = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(saved.version).toBe(2.1);
  expect(typeof saved.game.world.seed).toBe('number');
  expect(saved.game.world.hex.gen).toBe(1);
  expect(Object.keys(saved.game.world.hex.delta)).toEqual([]);
  expect(saved.game.world.map.length).toBe(61);
  expect(JSON.stringify(saved.game.world).length).toBeLessThan(40000);
  expect(errors).toEqual([]);
});

test('treks continue on the hex map and come home to the same world', async ({ page }) => {
  const { errors } = await freshToTown(page);
  await page.locator('#location_path').click();
  const trek = await page.evaluate(() => {
    Path.outfit = { 'cured meat': 20 };
    Path.embark();
    Math.random = () => 0.99; // no fights
    const start = World.curPos.slice();
    const water = World.water;
    for (let i = 0; i < 3; i++) World.moveHex(0);      // east
    for (let i = 0; i < 3; i++) World.moveHex(1);      // south-east
    World.markVisited(World.curPos[0], World.curPos[1]);
    const end = World.curPos.slice();
    return { start, end, water, waterNow: World.water, dist: World.getDistance(), seen: World.state.mask[end[0]][end[1] + 2] };
  });
  expect(trek.start).not.toEqual(trek.end);
  expect(trek.dist).toBe(6);
  expect(trek.waterNow).toBeLessThan(trek.water); // supplies still run down
  expect(trek.seen).toBe(true);                   // the light still reaches two hexes
  await expect(page.locator('#map canvas')).toBeVisible();

  const home = await page.evaluate((end) => {
    World.goHome();
    const saved = JSON.parse(localStorage.gameState).game.world.hex;
    return { delta: saved.delta, hex: World.hex.map[end[0]][end[1]] };
  }, trek.end);
  expect(Object.values(home.delta)).toEqual([home.hex]);
  expect(home.hex.endsWith('!')).toBe(true);

  // reload: the world comes back from the seed and the deltas
  const before = await page.evaluate(() => ({ map: JSON.stringify(World.hex.map), mask: JSON.stringify(World.hex.mask) }));
  await page.reload();
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);
  const after = await page.evaluate(() => ({ map: JSON.stringify(World.hex.map), mask: JSON.stringify(World.hex.mask) }));
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('the generator is deterministic for a seed', async ({ page }) => {
  const errors = await openGame(page);
  const same = await page.evaluate(() => {
    const run = (seed) => {
      const square = World.generateMap(WorldGen.rng(seed));
      const g = WorldGen.generate(seed, square);
      return JSON.stringify([square, g.map, g.terrain, g.sites, g.formations, g.warHeart]);
    };
    const a = run(1234), b = run(1234), c = run(99);
    return { same: a === b, differs: a !== c };
  });
  expect(same).toEqual({ same: true, differs: true });
  expect(errors).toEqual([]);
});

test('every terrain and both kinds of multi-hex feature appear across seeds', async ({ page }) => {
  const errors = await openGame(page);
  const missing = await page.evaluate((n) => {
    const out = [];
    for (let seed = 1; seed <= 10; seed++) {
      const g = WorldGen.generate(seed, World.generateMap(WorldGen.rng(seed)));
      const glyphs = new Set();
      for (let x = 0; x < g.cols; x++) for (let y = 0; y < g.rows; y++) glyphs.add(g.terrain[x][y]);
      const count = Object.values(WorldGen.TERRAIN).filter((t) => glyphs.has(t)).length;
      if (count !== n || !g.formations.length || !g.sites.length) out.push(seed);
    }
    return out;
  }, TERRAINS);
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});

test('a v1.3 save with a full village and a walked map migrates and opens the hex map', async ({ page }) => {
  await page.clock.install();
  const errors = await openGame(page, { save: v13 });
  const state = await getState(page);
  expect(state.version).toBe(2.1);
  expect(state.features.location.city).toBe(true);
  expect(typeof state.game.world.seed).toBe('number');
  expect(state.game.world.map).toEqual(v13.game.world.map); // the prologue map is kept as is
  expect(state.stores).toEqual(v13.stores);
  const s = await page.evaluate(page_summary);
  expect(s.atCapital).toBe('A');
  expect(await page.evaluate(revealedKept, v13.game.world)).toBe(true);
  expect(errors).toEqual([]);
});

test('a v1.3 save without the town keeps the square map until the town opens', async ({ page }) => {
  await page.clock.install();
  const save = structuredClone(v13);
  save.game.buildings.hut = 10;
  const errors = await openGame(page, { save });
  expect(await page.evaluate(() => !!World.hex)).toBe(false);
  expect(await page.evaluate(() => $SM.get('version'))).toBe(2.1);
  await page.evaluate(() => $SM.set('game.buildings["hut"]', 20));
  expect(await page.evaluate(() => !!World.hex)).toBe(true);
  expect(await page.evaluate(revealedKept, v13.game.world)).toBe(true);
  expect(errors).toEqual([]);
});

test('a v2.0 save with an open town loads into the hex map', async ({ page }) => {
  await page.clock.install();
  const errors = await openGame(page, { save: v20 });
  const state = await getState(page);
  expect(state.version).toBe(2.1);
  expect(state.game.cities).toEqual(v20.game.cities);
  expect(state.game.world.hex.gen).toBe(1);
  expect(await page.evaluate(revealedKept, v20.game.world)).toBe(true);
  // the hex map stays the same across reloads
  const before = await page.evaluate(() => JSON.stringify(World.hex.map));
  await page.reload();
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);
  expect(await page.evaluate(() => JSON.stringify(World.hex.map))).toBe(before);
  expect(errors).toEqual([]);
});

test('drawing the hex viewport stays inside a frame budget, in both themes', async ({ page }) => {
  const { errors } = await freshToTown(page);
  await page.locator('#location_path').click();
  const timing = await page.evaluate(() => {
    Path.outfit = { 'cured meat': 20 };
    Path.embark();
    // reveal the whole world so every hex in view is drawn
    const g = World.hex.gen;
    for (let x = 0; x < g.cols; x++) for (let y = 0; y < g.rows; y++) World.state.mask[x][y] = true;
    const time = () => {
      World.drawHexMap(); // warm up
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        World.cam = World.hexCentre(30 + i * 4, 40 + (i % 5) * 4);
        World.drawHexMap();
      }
      return (performance.now() - t0) / 20;
    };
    const light = time();
    Engine.turnLightsOff();
    const dark = time();
    return { light, dark, lightsOff: $SM.get('config.lightsOff') };
  });
  expect(timing.lightsOff).toBe(true);
  expect(timing.light).toBeLessThan(16);
  expect(timing.dark).toBeLessThan(16);
  expect(errors).toEqual([]);
});
