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
    $SM.setM('stores', { wood: 100000, fur: 10000, meat: 10000, 'cured meat': 50, compass: 1, waterskin: 1 });
    WorldGen.newSeed = () => 4242; // the same world every run
    if (!Path.tab) Path.init();
    // pack cured meat the way the player does, through the outfitting buttons, as much as fits
    window.packMeat = () => {
      Path.updateOutfitting();
      Path.increaseSupply.call($('#outfit_row_cured-meat .upBtn')[0], { data: 1000 });
    };
  });
  // a trek on the square map: walk east, come home
  const square = await page.evaluate(() => {
    packMeat();
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
    packMeat();
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
    packMeat();
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

// Puts the wanderer on the hex map (seed 4242), with helpers to find and take a step.
async function onHexTrek(page) {
  const { errors } = await freshToTown(page);
  await page.locator('#location_path').click();
  await page.evaluate(() => {
    packMeat();
    Path.embark();
    Math.random = () => 0.99; // no fights
    // a reachable hex outside any site whose neighbour matches, and the direction to it
    window.findStep = (from, to) => {
      const g = World.hex.gen, m = World.state.map;
      for (let y = 1; y < g.rows - 1; y++) {
        for (let x = 1; x < g.cols - 1; x++) {
          if (!g.reachable[x + y * g.cols] || World.siteAt(x, y) || !from(m[x][y], x, y)) continue;
          for (let d = 0; d < 6; d++) {
            const n = WorldGen.neighbour(x, y, d);
            if (!World.siteAt(n[0], n[1]) && to(m[n[0]][n[1]], n[0], n[1])) return { at: [x, y], dir: d, to: n };
          }
        }
      }
      return null;
    };
    window.stepFrom = (s) => {
      World.curPos = s.at.slice();
      World.moveHex(s.dir);
      return World.curPos.slice();
    };
  });
  await page.waitForFunction(() => !$('#outerSlider').is(':animated')); // the slide to the map
  return errors;
}

test('open ocean blocks the wanderer', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const T = WorldGen.TERRAIN;
    const s = findStep((c) => c === T.lake, (c) => c === T.ocean);
    return { s, pos: stepFrom(s), canSail: World.canSail() };
  });
  expect(r.s).not.toBeNull();
  expect(r.pos).toEqual(r.s.at);
  expect(r.canSail).toBe(false);
  await expect(page.locator('#notifications')).toContainText('the sea is too deep to wade.');
  expect(errors).toEqual([]);
});

test('mountains block the wanderer except at a pass', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const T = WorldGen.TERRAIN;
    const plain = (c) => c === T.field || c === T.barrens || c === T.desert || c === T.tundra || c === T.wastes;
    const wall = findStep(plain, (c) => c === T.mountains);
    const pass = findStep(plain, (c, x, y) => !!World.hex.passes[x + ',' + y]);
    return {
      passes: World.hex.gen.passes.length,
      wall, wallPos: stepFrom(wall),
      pass, passPos: stepFrom(pass), passTile: World.state.map[pass.to[0]][pass.to[1]],
      label: World.hexLabel(pass.to[0], pass.to[1]),
    };
  });
  expect(r.passes).toBeGreaterThan(0);
  expect(r.wallPos).toEqual(r.wall.at);
  expect(r.passPos).toEqual(r.pass.to);
  expect(r.passTile).toBe('^');
  expect(r.label).toBe('a mountain pass');
  await expect(page.locator('#notifications')).toContainText('the mountains are too steep to climb.');
  expect(errors).toEqual([]);
});

test('rough ground costs two moves of food and water', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const T = WorldGen.TERRAIN;
    const cost = (s) => {
      World.setWater(World.getMaxWater());
      World.waterMove = 0;
      World.foodMove = 0;
      const water = World.water, meat = Path.outfit['cured meat'];
      stepFrom(s);
      return [water - World.water, meat - Path.outfit['cured meat']];
    };
    return {
      plain: cost(findStep((c) => c === T.field, (c) => c === T.barrens)),
      forest: cost(findStep((c) => c === T.field, (c) => c === T.forest)),
      hills: cost(findStep((c) => c === T.field, (c) => c === T.hills)),
      costs: ['hills', 'forest', 'jungle', 'swamp', 'field', 'barrens', 'desert', 'tundra', 'wastes', 'lake']
        .map((k) => World.moveCost(T[k])),
    };
  });
  // a move costs one water; food goes every second move (World.MOVES_PER_FOOD)
  expect(r.plain).toEqual([1, 0]);
  expect(r.forest).toEqual([2, 1]);
  expect(r.hills).toEqual([2, 1]);
  expect(r.costs).toEqual([2, 2, 2, 2, 1, 1, 1, 1, 1, 1]);
  expect(errors).toEqual([]);
});

test('every land region with a site, and the ship, can be walked to from the capital', async ({ page }) => {
  const errors = await openGame(page);
  const bad = await page.evaluate(() => {
    const out = [];
    for (let seed = 1; seed <= 8; seed++) {
      const g = WorldGen.generate(seed, World.generateMap(WorldGen.rng(seed)));
      // flood fill on foot from the capital, independent of the generator's own answer
      const seen = new Uint8Array(g.cols * g.rows), q = [g.capital];
      seen[g.capital[0] + g.capital[1] * g.cols] = 1;
      while (q.length) {
        const [x, y] = q.pop();
        for (let d = 0; d < 6; d++) {
          const [nx, ny] = WorldGen.neighbour(x, y, d), k = nx + ny * g.cols;
          if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows || seen[k] || !WorldGen.isPassable(g.map[nx][ny])) continue;
          seen[k] = 1;
          q.push([nx, ny]);
        }
      }
      g.sites.forEach((s, i) => s.hexes.forEach(([x, y]) => { if (!seen[x + y * g.cols]) out.push([seed, 'site', i]); }));
      if (!seen[g.warHeart[0] + g.warHeart[1] * g.cols]) out.push([seed, 'ship']);
      // every mountain range has a pass
      const passAt = new Set(g.passes.map(([x, y]) => x + ',' + y));
      g.formations.forEach((f, i) => {
        if (f.kind === 'range' && !f.hexes.some(([x, y]) => passAt.has(x + ',' + y))) out.push([seed, 'range', i]);
      });
    }
    return out;
  });
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

test('the view follows the wanderer until dragged away, and space brings it back', async ({ page }) => {
  const errors = await onHexTrek(page);
  await expect(page.locator('#hexHint')).toHaveText('drag to look around. space to come back.');
  const view = () => page.evaluate(() => ({ cam: World.cam.slice(), me: World.hexCentre(World.curPos[0], World.curPos[1]) }));
  // one plain step near the capital
  const step = () => page.evaluate(() => {
    const T = WorldGen.TERRAIN;
    stepFrom(findStep((c, x, y) => c === T.field && WorldGen.distance([x, y], World.VILLAGE_POS) < 15, (c) => c === T.field));
  });

  await step();
  let v = await view();
  expect(v.cam).toEqual(v.me);

  const box = await page.locator('#map canvas').boundingBox();
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 5 });
  await page.mouse.up();
  const dragged = (await view()).cam;
  await step();
  v = await view();
  expect(v.cam).toEqual(dragged); // detached: a step doesn't move the view
  expect(v.cam).not.toEqual(v.me);

  await page.keyboard.press('Space');
  v = await view();
  expect(v.cam).toEqual(v.me);
  await step();
  v = await view();
  expect(v.cam).toEqual(v.me); // attached again
  expect(errors).toEqual([]);
});

test('a pack filled to the brim stays within its capacity on a hex trek', async ({ page }) => {
  const { errors } = await freshToTown(page);
  await page.locator('#location_path').click();
  const r = await page.evaluate(() => {
    $SM.set('stores["cured meat"]', 500);
    $SM.set('stores.bullets', 500);
    Path.updateOutfitting();
    // the outfitting buttons, asked for far more than fits; meat left over from the last trek counts too
    const up = (key) => Path.increaseSupply.call($('#outfit_row_' + key.replace(' ', '-') + ' .upBtn')[0], { data: 1000 });
    up('cured meat');
    up('bullets');
    const packed = Path.getFreeSpace();
    Path.embark();
    Math.random = () => 0.99;
    for (let i = 0; i < 3; i++) World.moveWest();
    return { packed, free: $('#backpackSpace').text(), outfit: Path.outfit };
  });
  expect(r.packed).toBeGreaterThanOrEqual(0);
  expect(r.packed).toBeLessThan(1);
  expect(Number(r.free.match(/free (-?\d+)\//)[1])).toBeGreaterThanOrEqual(0);
  expect(r.outfit['cured meat']).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a click on the wanderer\'s own hex does not take a step', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    World.drawMap();
    const o = World.viewOrigin(), me = World.hexCentre(World.curPos[0], World.curPos[1]);
    return { pos: World.curPos.slice(), water: World.water, x: me[0] - o[0], y: me[1] - o[1] };
  });
  const box = await page.locator('#map canvas').boundingBox();
  // anywhere inside the hex, not just its centre
  for (const [dx, dy] of [[0, 0], [3, 2], [-4, -3], [0, 6]]) {
    await page.mouse.click(box.x + r.x + dx, box.y + r.y + dy);
  }
  expect(await page.evaluate(() => [World.curPos.slice(), World.water])).toEqual([r.pos, r.water]);
  // a click one hex east still steps east
  await page.mouse.click(box.x + r.x + Math.sqrt(3) * 9, box.y + r.y);
  expect(await page.evaluate(() => World.curPos.slice())).toEqual([r.pos[0] + 1, r.pos[1]]);
  expect(errors).toEqual([]);
});

test('maps scavenged on a trek stay revealed once home, on both maps', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#lightButton').click();
  const r = await page.evaluate(() => {
    clearTimeout(Events._eventTimeout);
    Room.unlockForest();
    $SM.set('game.builder.level', 4);
    $SM.set('game.temperature', Room.TempEnum.Hot);
    $SM.setM('stores', { wood: 100000, fur: 10000, meat: 10000, 'cured meat': 50, compass: 1 });
    WorldGen.newSeed = () => 4242;
    if (!Path.tab) Path.init();
    const lit = (m) => m.reduce((n, col) => n + col.filter(Boolean).length, 0);
    // the executioner's "scavenge maps" calls World.applyMap three times, mid-trek
    const trek = () => {
      Path.updateOutfitting();
      Path.increaseSupply.call($('#outfit_row_cured-meat .upBtn')[0], { data: 1000 });
      Path.embark();
      const before = lit(World.committedMask());
      for (let i = 0; i < 3; i++) World.applyMap();
      World.goHome();
      return lit(World.committedMask()) - before;
    };
    const square = trek();
    for (let i = 0; i < 20; i++) Room.build($('<div>').attr('buildThing', 'hut'));
    Room.build($('<div>').attr('buildThing', 'trading post'));
    if (!World.hex) return 'the town did not open';
    const hex = trek();
    const saved = WorldGen.decodeMask($SM.get('game.world.hex.mask'), World.cols(), World.rows());
    return { square, hex, savedHex: lit(saved) === lit(World.hex.mask) };
  });
  // three patches of radius 5 (61 hexes or squares each), less any overlap with what was seen
  expect(r.square).toBeGreaterThan(60);
  expect(r.hex).toBeGreaterThan(60);
  expect(r.savedHex).toBe(true);
  expect(errors).toEqual([]);
});

test('a hex save survives export and import, and stays small', async ({ page }) => {
  const { errors } = await freshToTown(page);
  await page.locator('#location_path').click();
  const before = await page.evaluate(() => {
    packMeat();
    Path.embark();
    Math.random = () => 0.99;
    for (let i = 0; i < 4; i++) World.moveHex(0);
    World.markVisited(World.curPos[0], World.curPos[1]);
    World.goHome();
    return {
      map: JSON.stringify(World.hex.map), mask: JSON.stringify(World.hex.mask),
      export: Engine.export64(), size: localStorage.gameState.length,
    };
  });
  // a player's base64 export, pasted back in with the line breaks the dialog shows
  await page.evaluate(() => { localStorage.clear(); });
  await page.evaluate((s) => Engine.import64(s.replace(/(.{60})/g, '$1\n')), before.export);
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room && World.hex);
  const after = await page.evaluate(() => ({ map: JSON.stringify(World.hex.map), mask: JSON.stringify(World.hex.mask) }));
  expect(after).toEqual({ map: before.map, mask: before.mask });
  expect(before.size).toBeLessThan(60000); // the whole save, not just the world
  expect(errors).toEqual([]);
});

test('reloading mid-trek on the hex map wakes at home in the world as last committed', async ({ page }) => {
  const { errors } = await freshToTown(page);
  await page.locator('#location_path').click();
  const before = await page.evaluate(() => {
    const map = JSON.stringify(World.hex.map), mask = JSON.stringify(World.hex.mask);
    packMeat();
    Path.embark();
    Math.random = () => 0.99;
    for (let i = 0; i < 4; i++) World.moveHex(0);
    World.markVisited(World.curPos[0], World.curPos[1]);
    Engine.saveGame();
    return { map, mask };
  });
  await page.reload();
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room && World.hex);
  const after = await page.evaluate(() => ({ map: JSON.stringify(World.hex.map), mask: JSON.stringify(World.hex.mask), state: World.state }));
  // like the prologue: an unfinished trek's discoveries are not kept
  expect(after).toEqual({ ...before, state: undefined });
  expect(errors).toEqual([]);
});

test('200 worlds: every landmark, site, pass and the ship can be walked to; nothing overlaps', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    if (!World.panel) World.init(); // sets up the landmarks, so the wasteland core is the real one
    const bad = [], T = WorldGen.TERRAIN;
    let slowest = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const square = World.generateMap(WorldGen.rng(seed));
      const t0 = performance.now();
      const g = WorldGen.generate(seed, square);
      slowest = Math.max(slowest, performance.now() - t0);
      const C = g.cols, at = (x, y) => x + y * C;
      const inside = (x, y) => x >= 0 && y >= 0 && x < C && y < g.rows;
      // flood fill on foot from the capital, independent of the generator's own answer
      const seen = new Uint8Array(C * g.rows), q = [g.capital];
      seen[at(g.capital[0], g.capital[1])] = 1;
      while (q.length) {
        const [x, y] = q.pop();
        for (let d = 0; d < 6; d++) {
          const [nx, ny] = WorldGen.neighbour(x, y, d);
          if (!inside(nx, ny) || seen[at(nx, ny)] || !WorldGen.isPassable(g.map[nx][ny])) continue;
          seen[at(nx, ny)] = 1;
          q.push([nx, ny]);
        }
      }
      const ground = g.terrain[g.capital[0]][g.capital[1]];
      if (g.map[g.capital[0]][g.capital[1]] !== 'A' || WorldGen.isWater(ground) || ground === T.mountains) bad.push([seed, 'capital']);
      let ships = 0;
      for (let x = 0; x < C; x++) {
        for (let y = 0; y < g.rows; y++) {
          const c = g.map[x][y];
          if (!WorldGen.isTerrain(g.terrain[x][y]) || typeof c !== 'string' || !c) bad.push([seed, 'tile', x, y]);
          else if (World.LANDMARKS[c.charAt(0)] && !seen[at(x, y)]) bad.push([seed, 'landmark', c, x, y]);
          if (c && c.charAt(0) === World.TILE.SHIP) ships++;
          if (!!seen[at(x, y)] !== !!g.reachable[at(x, y)]) bad.push([seed, 'reachable', x, y]);
        }
      }
      if (ships !== 1 || !seen[at(g.warHeart[0], g.warHeart[1])]) bad.push([seed, 'ship']);
      const owner = new Int16Array(C * g.rows).fill(-1);
      g.sites.forEach((s, i) => s.hexes.forEach(([x, y]) => {
        if (owner[at(x, y)] >= 0 || g.formationAt[at(x, y)] >= 0 || !seen[at(x, y)]) bad.push([seed, 'site', i, x, y]);
        owner[at(x, y)] = i;
      }));
      // a pass is hills you can reach; a crater dropped on one is open ground, not a pass
      g.passes.forEach(([x, y]) => { if (g.terrain[x][y] !== T.hills || !seen[at(x, y)]) bad.push([seed, 'pass', x, y]); });
    }
    return { bad: bad.slice(0, 20), slowest };
  });
  expect(r.bad).toEqual([]);
  expect(r.slowest).toBeLessThan(250); // ms for one world, well inside a load
  expect(errors).toEqual([]);
});
