// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState, freshToTown, onHexTrek } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

// Danger, read in the page for a few seeds: rings around the capital, sites, pockets, wastes.
function survey(seeds) {
  if (!World.panel) World.init();
  return seeds.map((seed) => {
    const g = WorldGen.generate(seed, World.generateMap(WorldGen.rng(seed)));
    const f = Danger.field(g), C = g.cols;
    let min = Infinity, max = -Infinity, bad = 0;
    const ring = [], wastes = Array.from({ length: Danger.BANDS }, () => [0, 0]);
    for (let x = 0; x < C; x++) {
      for (let y = 0; y < g.rows; y++) {
        const v = f[x + y * C];
        if (!(v >= 0 && v <= 10)) bad++;
        min = Math.min(min, v);
        max = Math.max(max, v);
        const r = Math.floor(WorldGen.distance([x, y], g.capital) / 10);
        ring[r] = ring[r] || [0, 0];
        ring[r][0] += v;
        ring[r][1]++;
        if (WorldGen.isWater(g.terrain[x][y]) || g.terrain[x][y] === WorldGen.TERRAIN.mountains) continue;
        const w = wastes[Danger.band(v)];
        w[1]++;
        if (g.terrain[x][y] === WorldGen.TERRAIN.wastes) w[0]++;
      }
    }
    // a crater's hexes against the ring they sit in
    // against the same world without its sites, below the top of the scale where there's room to stand out
    const flat = Danger.field({ ...g, sites: [] });
    const spike = g.sites.filter((s) => (s.kind === 'crater' || s.kind === 'complex') && !s.garrison && !s.wardens).flatMap((s) => s.hexes)
      .filter((h) => flat[h[0] + h[1] * C] < 7.5).map((h) => f[h[0] + h[1] * C] - flat[h[0] + h[1] * C]);
    const ringMean = (h) => { const r = ring[Math.floor(WorldGen.distance(h, g.capital) / 10)]; return r[0] / r[1]; };
    const pocket = g.pockets.map((p) => f[p[0] + p[1] * C] - ringMean(p));
    return {
      seed, min, max, bad, capital: f[g.capital[0] + g.capital[1] * C], heart: f[g.warHeart[0] + g.warHeart[1] * C],
      rings: ring.map((r) => r[0] / r[1]), heartRing: Math.floor(WorldGen.distance(g.capital, g.warHeart) / 10),
      spike, pocket, wastes: wastes.map(([n, t]) => (t ? n / t : null)),
    };
  });
}

test('danger: 0 at home, rising with distance to 10 at the heart, with hotspots and safer pockets', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(survey, [1, 2, 3, 4242]);
  for (const s of r) {
    expect(s.bad).toBe(0);
    expect(s.capital).toBe(0);
    expect(s.heart).toBeGreaterThan(9.5);
    // every 10-hex ring is more dangerous than the one inside it, out to the heart
    for (let i = 1; i < s.heartRing; i++) expect(s.rings[i]).toBeGreaterThan(s.rings[i - 1]);
    for (const d of s.spike) expect(d).toBeGreaterThan(2);       // craters and complexes are hotspots (not the garrison's: POWERS §3)
    expect(s.pocket.filter((d) => d < -1).length).toBeGreaterThan(2); // most pockets are clearly safer
  }
  expect(errors).toEqual([]);
});

test('danger: the wastes grow denser band by band', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(survey, [1, 2, 3, 4242]);
  for (const s of r) {
    const w = s.wastes.filter((v) => v !== null);
    // (the first bands are mostly the old wasteland, which has none)
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1]);
    expect(w[0]).toBeLessThan(0.05);
    expect(w[3]).toBeGreaterThan(0.03);
    expect(w[w.length - 1]).toBeGreaterThan(0.4);
  }
  expect(errors).toEqual([]);
});

test('difficulty scales danger; normal by default, kept in the save', async ({ page }) => {
  const { errors } = await freshToTown(page);
  const r = await page.evaluate(() => {
    const at = (d) => { $SM.set('game.difficulty', d); return World.dangerAt(70, 50); };
    const out = { saved: JSON.parse(localStorage.gameState).game.difficulty, now: World.difficulty() };
    out.gentle = at('gentle'); out.normal = at('normal'); out.harsh = at('harsh');
    $SM.set('game.difficulty', 'normal');
    out.heart = World.dangerAt(World.hex.gen.warHeart[0], World.hex.gen.warHeart[1]);
    return out;
  });
  expect(r.saved).toBe('normal');
  expect(r.now).toBe('normal');
  expect(r.gentle).toBeLessThan(r.normal);
  expect(r.normal).toBeLessThan(r.harsh);
  expect(r.heart).toBeLessThanOrEqual(10);
  expect(errors).toEqual([]);
});

test('difficulty is picked from the footer until the world opens up, then locked', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#lightButton').click();
  await page.locator('.menuBtn', { hasText: 'difficulty.' }).click();
  await expect(page.locator('#event')).toContainText('now: normal');
  await page.locator('#event .button', { hasText: 'harsh' }).click();
  expect(await page.evaluate(() => [$SM.get('game.difficulty'), JSON.parse(localStorage.gameState).game.difficulty]))
    .toEqual(['harsh', 'harsh']);
  await page.waitForFunction(() => !Events.activeEvent());

  // the town opens, the world with it: no more changes
  await page.evaluate(() => {
    $SM.set('game.buildings["trading post"]', 1);
    $SM.set('game.buildings.hut', 20);
  });
  expect(await page.evaluate(() => $SM.get('features.location.city'))).toBe(true);
  await page.locator('.menuBtn', { hasText: 'difficulty.' }).click();
  await expect(page.locator('#event')).toContainText('already harsh');
  await expect(page.locator('#event .button', { hasText: 'gentle' })).toHaveCount(0);
  await page.locator('#event .button', { hasText: 'ok' }).click();
  expect(await page.evaluate(() => $SM.get('game.difficulty'))).toBe('harsh');
  expect(errors).toEqual([]);
});

test('the prologue keeps its distance tiers and fight chance', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#lightButton').click();
  const r = await page.evaluate(() => {
    clearTimeout(Events._eventTimeout);
    Room.unlockForest();
    $SM.set('game.builder.level', 4);
    $SM.setM('stores', { 'cured meat': 50, compass: 1 });
    if (!Path.tab) Path.init();
    Path.outfit = { 'cured meat': 10 };
    Path.embark();
    const out = [];
    for (const pos of [[30, 25], [30, 18], [12, 30], [5, 5]]) {
      World.curPos = pos;
      out.push([World.dangerDistance(), World.getDistance()]);
    }
    let started = 0;
    const orig = Events.triggerFight;
    Events.triggerFight = () => { started++; };
    World.fightMove = 0;
    let rolls = 0;
    Math.random = () => { rolls++; return 0.199; }; // just under the prologue's 0.20
    for (let i = 0; i < 5; i++) World.checkFight();
    Events.triggerFight = orig;
    return { out, started, hex: !!World.hex };
  });
  expect(r.hex).toBe(false);
  for (const [a, b] of r.out) expect(a).toBe(b);
  expect(r.started).toBe(1); // once past FIGHT_DELAY moves, a roll under 0.20 fights
  expect(errors).toEqual([]);
});

test('on the hex map danger picks the encounter tier, its strength, the fight chance and the loot', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const g = World.hex.gen, T = World.TILE;
    // a field hex at each kind of danger (the first-tier fights want a field). Some worlds have
    // no field at low danger, only barrens and forest round home, so a plain hex is made one.
    const find = (lo, hi) => {
      let plain = null;
      for (let x = 1; x < g.cols - 1; x++) for (let y = 1; y < g.rows - 1; y++) {
        if (!g.reachable[x + y * g.cols] || World.siteAt(x, y)) continue;
        const d = World.dangerAt(x, y);
        if (d < lo || d >= hi) continue;
        if (World.state.map[x][y] === WorldGen.TERRAIN.field) return [x, y];
        if (!plain && World.state.map[x][y] === WorldGen.TERRAIN.barrens) plain = [x, y];
      }
      if (plain) World.state.map[plain[0]][plain[1]] = WorldGen.TERRAIN.field;
      return plain;
    };
    const tierAt = (pos) => {
      World.curPos = pos;
      const names = Events.Encounters.filter((e) => e.isAvailable()).map((e) => e.title);
      return { names, danger: World.dangerAt(pos[0], pos[1]), distance: World.getDistance() };
    };
    const low = find(0.5, 1.8), mid = find(2.2, 3), high = find(7, 9);
    const out = { low: tierAt(low), mid: tierAt(mid), high: tierAt(high) };
    // strength: the same fight, scaled where it's dangerous
    World.curPos = high;
    const beast = Events.Encounters.find((e) => e.isAvailable());
    const strong = Events.strengthen(beast);
    out.strength = [beast.scenes.start.health, strong.scenes.start.health, beast.scenes.start.damage, strong.scenes.start.damage];
    World.curPos = low;
    out.weak = Events.strengthen(beast) === beast;
    out.chance = [Danger.fightChance(out.low.danger), Danger.fightChance(out.high.danger)];
    // loot: a fixed roll pays more at high danger
    Math.random = () => 0.5;
    const loot = (pos) => {
      World.curPos = pos;
      let n = null;
      const row = Events.drawLootRow, stack = Events.eventStack;
      Events.drawLootRow = (k, num) => { n = num; return row(k, num); };
      Events.eventStack = [{ eventPanel: $('<div>').append($('<div>').attr('id', 'description')) }];
      Events.drawLoot({ fur: { min: 4, max: 6, chance: 1 } });
      Events.drawLootRow = row;
      Events.eventStack = stack;
      return n;
    };
    out.loot = [loot(low), loot(high)];
    return out;
  });
  // near home the first-tier fights, out at danger 7+ the third tier, wherever the hex is
  expect(r.low.names).toContain('A Strange Bird');
  expect(r.mid.names).toContain('A Huge Lizard');
  expect(r.high.names).toContain('A Sniper');
  expect(r.high.names).not.toContain('A Strange Bird');
  expect(r.strength[1]).toBeGreaterThan(r.strength[0]);
  expect(r.strength[3]).toBeGreaterThan(r.strength[2]);
  expect(r.weak).toBe(true);
  expect(r.chance[1]).toBeGreaterThan(r.chance[0]);
  expect(r.loot[1]).toBeGreaterThan(r.loot[0]);
  expect(errors).toEqual([]);
});

test('walking into a new band brings its hint once', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const g = World.hex.gen;
    // walk east from the capital, recording each band's first step
    const seen = [];
    World.setWater(World.getMaxWater());
    for (let i = 0; i < 60 && $SM.get('game.danger.band', true) < 2; i++) {
      const before = $SM.get('game.danger.band', true);
      World.state.map[World.curPos[0] + 1][World.curPos[1]] = WorldGen.TERRAIN.field; // a clear way
      World.water = 99;
      Path.outfit['cured meat'] = 99;
      World.moveHex(0);
      if ($SM.get('game.danger.band', true) > before) seen.push([$SM.get('game.danger.band'), World.curPos[0]]);
    }
    const text = $('#notifications').text();
    // and back and forth across the first edge: no second time
    const count = (s) => text.split(s).length - 1;
    for (let i = 0; i < 10; i++) { World.water = 99; Path.outfit['cured meat'] = 99; World.moveHex(i % 2 ? 0 : 3); }
    return { seen, hint1: count('the quiet out here feels watched.'), hint2: count('the air tastes of ash.'),
      after: $('#notifications').text().split('the quiet out here feels watched.').length - 1 };
  });
  expect(r.seen.map(([b]) => b)).toEqual([1, 2]);
  expect(r.hint1).toBe(1);
  expect(r.hint2).toBe(1);
  expect(r.after).toBe(1);
  expect(errors).toEqual([]);
});

test('rough ground: water and food twice, but one stage of thirst per step', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const T = WorldGen.TERRAIN;
    const s = findStep((c) => c === T.field, (c) => c === T.forest);
    // out of water, not yet thirsty: the forest step brings the warning, not death
    World.setWater(0);
    World.thirst = false;
    World.waterMove = 0;
    stepFrom(s);
    const first = { dead: !!World.dead, thirst: World.thirst };
    // the next rough step kills
    const back = WorldGen.neighbour(s.to[0], s.to[1], 3);
    World.state.map[back[0]][back[1]] = T.forest;
    World.moveHex(3);
    return { first, dead: !!World.dead, text: $('#notifications').text() };
  });
  expect(r.first).toEqual({ dead: false, thirst: true });
  expect(r.text).toContain('the thirst becomes unbearable');
  expect(r.dead).toBe(true);
  expect(errors).toEqual([]);
});

test('dying on a hex trek drops the pack there; the map shows it and what is left', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    for (let i = 0; i < 6; i++) { World.water = 99; World.moveHex(0); }
    const at = World.curPos.slice();
    Path.outfit = { 'cured meat': 10, fur: 20, bullets: 0 };
    World.die();
    return { at, pack: $SM.get('game.world.pack') };
  });
  expect(r.pack).toEqual({ at: r.at, items: { 'cured meat': 10, fur: 20 }, left: 1 });
  await page.waitForFunction(() => Engine.activeModule === Room && !Engine.keyLock);

  // the next trek: the pack is on the map, in the fog too, and hovering shows what's in it
  await page.evaluate(() => { Engine.travelTo(Path); });
  await page.waitForFunction(() => !$('#outerSlider').is(':animated'));
  await page.evaluate((at) => {
    Path.outfit = { 'cured meat': 5 };
    Path.embark();
  }, r.at);
  await page.waitForFunction(() => !$('#outerSlider').is(':animated'));
  const shown = await page.evaluate((at) => {
    World.state.mask[at[0]][at[1]] = undefined; // the hex itself was seen on the lost trek only
    World.drawMap();
    const o = World.viewOrigin(), c = World.hexCentre(at[0], at[1]);
    return { pack: !!World.state.pack, label: World.hexLabel(at[0], at[1]), x: c[0] - o[0], y: c[1] - o[1] };
  }, r.at);
  expect(shown.pack).toBe(true);
  expect(shown.label).toBe('the&nbsp;pack:&nbsp;cured meat&nbsp;10,&nbsp;fur&nbsp;20');
  const box = await page.locator('#map canvas').boundingBox();
  await page.mouse.move(box.x + shown.x, box.y + shown.y);
  await expect(page.locator('#hexInfo')).toHaveText('the pack: cured meat 10, fur 20');
  // the glyph is drawn: the canvas differs where the pack is when it's gone
  const ink = () => page.evaluate(([x, y]) => {
    const c = $('#map canvas')[0], d = c.width / World.VIEW[0];
    const px = c.getContext('2d').getImageData((x - 4) * d, (y - 5) * d, 8 * d, 10 * d).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) n += px[i];
    return n;
  }, [shown.x, shown.y]);
  const withPack = await ink();
  await page.evaluate(() => { const p = World.state.pack; delete World.state.pack; World.drawMap(); window._pack = p; });
  expect(withPack).toBeGreaterThan(await ink());
  expect(errors).toEqual([]);
});

test('scavengers take a share of the pack each step, faster where it is dangerous; reaching it takes back the rest', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const g = World.hex.gen;
    const safe = WorldGen.neighbour(g.capital[0], g.capital[1], 0);
    const far = [g.warHeart[0] - 3, g.warHeart[1]];
    const after = (at, steps) => {
      World.state.pack = { at, items: { fur: 100 }, left: 1 };
      for (let i = 0; i < steps; i++) World.scavengePack();
      return World.state.pack ? World.packLeft(World.state.pack).fur : 0;
    };
    const out = { safe: after(safe, 10), far: after(far, 10), gone: after(far, 1000) };
    // recover: walk onto it
    World.curPos = g.capital.slice();
    World.state.pack = { at: safe, items: { fur: 6, 'cured meat': 4 }, left: 0.6 }; // the step there takes its share first
    Path.outfit = { 'cured meat': 2 };
    World.water = 99;
    World.moveHex(0);
    out.recovered = { outfit: { ...Path.outfit }, pack: World.state.pack || null };
    return out;
  });
  expect(r.safe).toBeLessThan(100);
  expect(r.far).toBeLessThan(r.safe);
  expect(r.gone).toBe(0);
  expect(r.recovered.pack).toBeNull();
  expect(r.recovered.outfit.fur).toBe(3);
  expect(r.recovered.outfit['cured meat']).toBe(3); // 2 + 2 of the 4, less one eaten on the step
  expect(errors).toEqual([]);
});

test('a full bag leaves the rest in the pack; a new death replaces the old pack; the prologue drops none', async ({ page }) => {
  const errors = await onHexTrek(page);
  const r = await page.evaluate(() => {
    const g = World.hex.gen, at = WorldGen.neighbour(g.capital[0], g.capital[1], 0);
    World.curPos = g.capital.slice();
    World.state.pack = { at, items: { iron: 500 }, left: 1 };
    Path.outfit = {};
    World.water = 99;
    World.moveHex(0);
    const there = Math.floor(500 * (1 - Danger.scavengeRate(World.dangerAt(at[0], at[1]))));
    const rest = World.state.pack && World.state.pack.items.iron;
    const carried = Path.outfit.iron;
    // die with the old pack still out there: the new one replaces it
    Path.outfit = { coal: 3 };
    World.die();
    return { rest, there, carried, capacity: Path.getCapacity(), pack: $SM.get('game.world.pack') };
  });
  expect(r.carried).toBe(r.capacity);
  expect(r.rest).toBe(r.there - r.capacity);
  expect(r.pack.items).toEqual({ coal: 3 });
  expect(errors).toEqual([]);
});

test('the prologue: dying drops no pack', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#lightButton').click();
  const pack = await page.evaluate(() => {
    clearTimeout(Events._eventTimeout);
    Room.unlockForest();
    $SM.setM('stores', { 'cured meat': 50, compass: 1 });
    if (!Path.tab) Path.init();
    Path.outfit = { 'cured meat': 10 };
    Path.embark();
    World.die();
    return $SM.get('game.world.pack');
  });
  expect(pack).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a mine cleared in the prologue is a deposit held by a waystation on the hex map', async ({ page }) => {
  const { errors } = await freshToTown(page, {
    beforeTown: () => {
      // clear the iron mine on a trek, the way its setpiece does
      packMeat();
      Path.embark();
      const map = World.state.map;
      for (let x = 0; x < 61; x++) for (let y = 0; y < 61; y++) if (map[x][y].charAt(0) === World.TILE.IRON_MINE) World.curPos = [x, y];
      window._mine = World.curPos.slice();
      World.state.ironmine = true;
      World.clearDungeon();
      World.goHome();
    },
  });
  const r = await page.evaluate(() => {
    const [x, y] = window._mine, off = World.hex.gen.coreOffset;
    const hx = x + off[0], hy = y + off[1];
    return {
      cleared: $SM.get('game.world.clearedMines'), key: x + ',' + y,
      square: $SM.get('game.world.map')[x][y],
      tile: World.hex.map[hx][hy], ground: World.terrainAt(hx, hy),
      deposit: World.hex.gen.deposits.find((d) => d.at[0] === hx && d.at[1] === hy),
      building: $SM.get('game.buildings["iron mine"]'),
    };
  });
  expect(r.cleared).toEqual({ [r.key]: 'I' });
  expect(r.square).toBe('P');
  expect(r.tile).toBe('P');
  expect(r.ground).toBe('^');
  expect(r.deposit).toMatchObject({ kind: 'iron', cleared: true });
  expect(r.building).toBe(1);
  expect(errors).toEqual([]);
});

test('a hex map from another generator version is re-projected, not mis-patched', async ({ page }) => {
  await page.clock.install();
  const save = load('v2.0-town');
  // as if saved by a generator before this one, with a delta on what was then a hex
  save.version = 2.1;
  save.game.world.seed = 4242;
  save.game.world.hex = { gen: 0, delta: { '50,50': 'Y!' }, mask: '' };
  const errors = await openGame(page, { save });
  const r = await page.evaluate(() => ({
    gen: $SM.get('game.world.hex.gen'), delta: $SM.get('game.world.hex.delta'), tile: World.hex.map[50][50],
  }));
  expect(r.gen).toBe(2);
  expect(r.delta).toEqual({});
  expect(r.tile).not.toBe('Y!');
  expect(errors).toEqual([]);
});

test('a v2.1 save migrates to v2.2 at normal difficulty and keeps its hex map', async ({ page }) => {
  await page.clock.install();
  const v20 = load('v2.0-town');
  // load once to make a v2.1-style hex save, then strip what v2.2 adds
  let errors = await openGame(page, { save: v20 });
  const saved = await page.evaluate(() => {
    const s = JSON.parse(localStorage.gameState);
    s.version = 2.1;
    delete s.game.difficulty;
    return { s, map: JSON.stringify(World.hex.map) };
  });
  await page.evaluate((s) => { localStorage.gameState = JSON.stringify(s); }, saved.s);
  await page.reload();
  await page.waitForFunction(() => window.Engine && typeof Room != 'undefined' && Engine.activeModule === Room && World.hex);
  const state = await getState(page);
  expect(state.version).toBe(2.9);
  expect(state.game.difficulty).toBe('normal');
  expect(await page.evaluate(() => JSON.stringify(World.hex.map))).toBe(saved.map);
  expect(errors).toEqual([]);
});

test('lift-off is locked until Act I is won', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    $SM.set('game.spaceShip.hull', 5);
    $SM.set('game.spaceShip.seenWarning', true);
    Ship.init();
    Engine.activeModule = Ship;
    let lifted = false;
    const orig = Ship.liftOff;
    Ship.liftOff = () => { lifted = true; };
    Ship.checkLiftOff();
    const locked = !lifted;
    $SM.set('game.actOne.complete', true);
    Ship.checkLiftOff();
    Ship.liftOff = orig;
    return { locked, unlocked: lifted, text: $('#notifications').text() };
  });
  expect(r.locked).toBe(true);
  expect(r.text).toContain("not yet. the world isn't won.");
  expect(r.unlocked).toBe(true); // the flag is the only gate
  expect(errors).toEqual([]);
});
