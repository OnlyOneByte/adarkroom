// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState, freshToTown, freezeClock } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

// A fresh game with the town open, every ember tier but the ones a test names, and helpers.
async function townWithFire(page, { tiers = ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'] } = {}) {
  const { errors } = await freshToTown(page);
  await page.evaluate((tiers) => {
    clearTimeout(Events._eventTimeout);
    clearTimeout(Network._tickTimeout);
    Network._nextAsk = Date.now() + 1e9; // no story scenes unless a test asks
    const t = {};
    tiers.forEach((id) => { t[id] = true; });
    $SM.set('game.network.tiers', t);
    $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnDone: true });
    // raises a line of n beacons going east from the capital, 3 hexes apart, on open ground
    window.lineEast = (n) => {
      const cap = World.hex.gen.capital, out = [];
      for (let x = cap[0] + 3; out.length < n && x < cap[0] + 60; x += 3) {
        const prev = out.length ? out[out.length - 1] : cap;
        let at = null;
        for (let dy = 0; dy < 3 && !at; dy++) {
          for (const y of [prev[1] + dy, prev[1] - dy]) {
            World.hex.mask[x][y] = true; // seen or not, the test lays it where it wants
            if (Network.canBeacon(x, y) && Fire.distance(prev, [x, y]) <= Fire.HOP) { at = [x, y]; break; }
          }
        }
        if (!at) break;
        $SM.set('game.network.beacons["' + at[0] + ',' + at[1] + '"]', true);
        Network.refresh(); // the next one builds out from this one, once it is lit
        out.push(at);
      }
      return out;
    };
    window.litCount = () => World.hex.fire.lit.reduce((a, b) => a + b, 0);
    window.isLit = (p) => !!World.hex.fire.lit[p[0] + p[1] * World.hex.gen.cols];
    window.burnTick = () => Network.tick();
  }, tiers);
  return errors;
}

test('the town hearth lights home; a beacon line carries fire out, losing some per hop', async ({ page }) => {
  const errors = await townWithFire(page);
  const r = await page.evaluate(() => {
    $SM.set('stores.tallow', 1000);
    burnTick();
    const hearth = $SM.get('game.cities.capital.hearth');
    const home = litCount();
    const line = lineEast(3);
    burnTick();
    const nodes = World.hex.fire.nodes.map((n) => Math.round(n.s * 100) / 100);
    return { hearth, home, n: line.length, after: litCount(), nodes, lastLit: isLit(line[line.length - 1]), wood: $SM.get('stores.wood') };
  });
  expect(r.hearth.fuel).toBe('tallow'); // the strongest unlocked fuel in stock
  expect(r.home).toBeGreaterThan(0);
  expect(r.n).toBe(3);
  expect(r.after).toBeGreaterThan(r.home);
  // watch fire: 24 at the hearth, keeping 70% per hop
  expect(r.nodes).toEqual([24, 16.8, 11.76, 8.23]);
  expect(r.lastLit).toBe(true);
  expect(errors).toEqual([]);
});

test('the ladders: 48 tiers, 16 a ladder in 4 eras, 32 story beats; the ember and flame eras are wired', async ({ page }) => {
  const errors = await openGame(page);
  const t = await page.evaluate(() => Fire.TIERS.map((x) => ({ id: x.id, ladder: x.ladder, era: x.era, n: x.n, story: x.story, when: x.when, name: x.name })));
  expect(t).toHaveLength(48);
  for (const ladder of ['fuel', 'beacon', 'hearth']) {
    const l = t.filter((x) => x.ladder === ladder);
    expect(l.map((x) => x.n)).toEqual([...Array(16).keys()].map((i) => i + 1));
    expect(l.map((x) => x.era)).toEqual(['ember', 'flame', 'blaze', 'old fire'].flatMap((e) => [e, e, e, e]));
    expect(l.filter((x) => x.era === 'ember' || x.era === 'flame').every((x) => x.when)).toBe(true);
    expect(l.filter((x) => x.era === 'blaze' || x.era === 'old fire').every((x) => x.when === null)).toBe(true);
  }
  expect(t.filter((x) => x.story)).toHaveLength(32);
  expect(t.find((x) => x.id === 'F16').name).toBe('the old fire');
  // a new game has nothing; lighting the fire is F1, the warm room H1
  expect(await page.evaluate(() => Network.tiers())).toEqual({});
  await page.locator('#lightButton').click();
  expect(await page.evaluate(() => Network.has('F1'))).toBe(true);
  expect(errors).toEqual([]);
});

test('with a stone hearth the lines carry the hops of the CITY.md table; a town hearth carries further', async ({ page }) => {
  await openGame(page);
  const hops = await page.evaluate(() => {
    const run = (H, B) => {
      const beacons = [];
      for (let i = 1; i <= 9; i++) beacons.push([5 + 3 * i, 10]);
      const r = Fire.compute({ cols: 60, rows: 20, danger: () => 0, hills: () => false, beacons, beacon: Fire.BEACONS[B],
        hearths: [{ at: [5, 10], out: Fire.HEARTHS[H].out, share: true, cap: 10 }] });
      return r.nodes.filter((n) => !n.hearth && n.s >= Fire.RELAY_MIN).length; // beacons that pass it on
    };
    return ['B1', 'B2', 'B3', 'B4'].map((b) => [Fire.BEACONS[b].hops, run('H3', b), run('H4', b)]);
  });
  for (const [table, h3, h4] of hops) {
    expect(h3).toBe(table);
    expect(h4).toBeGreaterThanOrEqual(h3);
  }
  // every beacon tier carries a town hearth's line further than the one before it
  expect(hops.map((h) => h[2])).toEqual([2, 3, 4, 5]);
});

test('a line burning wood goes dark past danger 1; tallow reaches danger 2.5', async ({ page }) => {
  const errors = await townWithFire(page);
  const r = await page.evaluate(() => {
    $SM.set('stores.tallow', 1000);
    burnTick(); // built out while tallow lights the way: a new beacon goes by a lit one
    const line = lineEast(6);
    const cols = World.hex.gen.cols;
    const maxLitDanger = () => {
      let m = 0;
      World.hex.fire.lit.forEach((v, k) => { if (v) m = Math.max(m, World.baseDangerAt(k % cols, Math.floor(k / cols))); });
      return m;
    };
    $SM.set('stores.tallow', 0);
    burnTick();
    const wood = { fuel: $SM.get('game.cities.capital.hearth.fuel'), lit: litCount(), max: maxLitDanger() };
    $SM.set('stores.tallow', 1000);
    burnTick();
    const tallow = { fuel: $SM.get('game.cities.capital.hearth.fuel'), lit: litCount(), max: maxLitDanger() };
    return { wood, tallow, n: line.length };
  });
  expect(r.wood.fuel).toBe('wood');
  expect(r.wood.max).toBeLessThanOrEqual(1);
  expect(r.tallow.fuel).toBe('tallow');
  expect(r.tallow.max).toBeLessThanOrEqual(2.5);
  expect(r.tallow.max).toBeGreaterThan(1);
  expect(r.tallow.lit).toBeGreaterThan(r.wood.lit);
  expect(errors).toEqual([]);
});

test('lit land is one less danger (never under 0), and the fights and loot follow it', async ({ page }) => {
  const errors = await townWithFire(page);
  const r = await page.evaluate(() => {
    $SM.set('stores.tallow', 1000);
    burnTick();
    lineEast(4);
    burnTick();
    const g = World.hex.gen;
    let hi = null, lo = null, dark = null;
    for (let k = 0; k < g.cols * g.rows; k++) {
      const x = k % g.cols, y = Math.floor(k / g.cols), base = World.baseDangerAt(x, y);
      if (World.hex.fire.lit[k]) {
        if (!hi && base >= 1.5) hi = [x, y];
        if (!lo && base > 0 && base < 1) lo = [x, y];
      } else if (!dark && base >= 1.5 && base < 3) dark = [x, y];
    }
    const at = (p) => ({ base: World.baseDangerAt(p[0], p[1]), now: World.dangerAt(p[0], p[1]), fight: Danger.fightChance(World.dangerAt(p[0], p[1])), plain: Danger.fightChance(World.baseDangerAt(p[0], p[1])) });
    return { hi: at(hi), lo: at(lo), dark: at(dark) };
  });
  expect(r.hi.now).toBeCloseTo(r.hi.base - 1, 5);
  expect(r.hi.fight).toBeLessThan(r.hi.plain);
  expect(r.lo.now).toBe(0);
  expect(r.dark.now).toBe(r.dark.base);
  expect(errors).toEqual([]);
});

test('putting out a beacon darkens the line past it; raising it again lights it back', async ({ page }) => {
  const errors = await townWithFire(page);
  const r = await page.evaluate(() => {
    $SM.set('stores.tallow', 1000);
    burnTick();
    const line = lineEast(3);
    const before = { lit: litCount(), ends: line.map(isLit) };
    Network.putOut(line[0][0], line[0][1]);
    const cut = { lit: litCount(), ends: line.slice(1).map(isLit), nodes: World.hex.fire.nodes.slice(1).map((n) => n.s) };
    Network.raiseBeacon(line[0][0], line[0][1]);
    return { before, cut, again: { lit: litCount(), ends: line.map(isLit) } };
  });
  expect(r.before.ends).toEqual([true, true, true]);
  expect(r.cut.ends).toEqual([false, false]);
  expect(r.cut.nodes).toEqual([0, 0]);
  expect(r.cut.lit).toBeLessThan(r.before.lit);
  expect(r.again).toEqual(r.before);
  expect(errors).toEqual([]);
});

test('the hearth burns its fuel every fire tick, and a beacon costs upkeep', async ({ page }) => {
  const errors = await townWithFire(page);
  const r = await page.evaluate(() => {
    $SM.setM('stores', { wood: 1000, tallow: 0, 'dry wood': 0, 'seasoned oak': 0 });
    burnTick();
    const alone = 1000 - $SM.get('stores.wood');
    lineEast(2);
    burnTick(); // learns how many beacons it fed
    const fedLine = $SM.get('game.cities.capital.hearth.fed');
    const w = $SM.get('stores.wood');
    burnTick();
    const withLine = w - $SM.get('stores.wood');
    $SM.set('stores.wood', 0);
    burnTick(); // the town hearth's store carries it a tick...
    const stored = $SM.get('game.cities.capital.hearth.out');
    burnTick();
    burnTick();
    return { alone, withLine, fedLine, stored, fed: $SM.get('game.cities.capital.hearth.fed'), cold: $SM.get('game.cities.capital.hearth'), status: $('#fireStatus').text() };
  });
  // a town hearth makes 24 fire from 24 wood, and fills its store of 32 once
  expect(r.alone).toBe(24 + 32);
  expect(r.fedLine).toBeGreaterThanOrEqual(1);
  expect(r.withLine).toBe(24 + r.fedLine); // and 1 a lit beacon
  expect(r.stored).toBe(24);
  expect(r.fed).toBe(0); // ...then it is out, with nothing lit to feed
  expect(r.cold.fuel).toBeNull();
  expect(r.cold.out).toBe(0);
  expect(r.status).toContain('is cold');
  expect(errors).toEqual([]);
});

test('districts go next to the city, on the ground their type fits, up to three rings out', async ({ page }) => {
  const errors = await townWithFire(page);
  const r = await page.evaluate(() => {
    burnTick(); // the hearth lit: districts go only where its fire reaches
    const cap = World.hex.gen.capital, g = World.hex.gen;
    const ringOf = (p) => Fire.distance(cap, p);
    const kinds = {};
    for (const p of Fire.around(cap[0], cap[1], 1)) {
      if (ringOf(p) !== 1) continue;
      World.hex.mask[p[0]][p[1]] = true;
      kinds[Network.terrainKey(p[0], p[1])] = { at: p, types: Network.districtsFor('capital', p[0], p[1]) };
    }
    const far = Fire.ring(cap[0], cap[1], 2)[0];
    World.hex.mask[far[0]][far[1]] = true;
    // stubs, and the types whose tier isn't in yet (bog cuts: peat, mines: coal)
    const stubs = Object.keys(District.TYPES).filter((t) => District.TYPES[t].stub || !City.tierMet(District.TYPES[t].needs));
    return { kinds, notTouching: Network.districtsFor('capital', far[0], far[1]), stubs, offered: [].concat(...Object.values(kinds).map((k) => k.types)) };
  });
  expect(r.notTouching).toEqual([]);
  for (const s of r.stubs) expect(r.offered).not.toContain(s);
  expect(r.offered).not.toContain('hearth quarter');
  expect(r.offered).not.toContain('tannery row'); // only next to hunting grounds
  if (r.kinds.forest) expect(r.kinds.forest.types).toEqual(expect.arrayContaining(['woods', 'hunting grounds']));
  if (r.kinds.field) expect(r.kinds.field.types).toEqual(expect.arrayContaining(['huts', 'hunting grounds']));
  if (r.kinds.barrens) expect(r.kinds.barrens.types).toEqual(expect.arrayContaining(['huts', 'burning pits']));
  expect(r.stubs.sort()).toEqual(['bog cuts', 'fields', 'forge', 'harbour', 'mines', 'old-world works', 'tar pits', 'trading post', 'workshop']);
  expect(errors).toEqual([]);
});

// a capital with a few districts laid out on given ground, through the game's own placing
async function laidOut(page) {
  return page.evaluate(() => {
    const cap = World.hex.gen.capital, g = World.hex.gen;
    // pretend ground: a forest east of the capital, fields west (the test owns the map)
    const set = (p, t) => { g.terrain[p[0]][p[1]] = WorldGen.TERRAIN[t]; World.hex.map[p[0]][p[1]] = WorldGen.TERRAIN[t]; World.hex.mask[p[0]][p[1]] = true; };
    const e1 = WorldGen.neighbour(cap[0], cap[1], 0), e2 = WorldGen.neighbour(e1[0], e1[1], 0);
    const w1 = WorldGen.neighbour(cap[0], cap[1], 3), se = WorldGen.neighbour(cap[0], cap[1], 1);
    set(e1, 'forest'); set(e2, 'forest'); set(w1, 'field'); set(se, 'field');
    Network.tick(); // the hearth lit: districts go only where its fire reaches
    return { cap, e1, e2, w1, se };
  });
}

test('a district holds only its buildings and opens the raw jobs of its ground', async ({ page }) => {
  const errors = await townWithFire(page);
  const at = await laidOut(page);
  const r = await page.evaluate((at) => {
    $SM.set('game.cities.capital.population.citizens', 20);
    const before = { house: City.maximum('house'), woodshed: City.maximum('woodshed'), slots: City.jobSlots('capital', 'woodcutter') };
    Network.placeDistrict('capital', at.e1[0], at.e1[1], 'woods');
    Network.placeDistrict('capital', at.w1[0], at.w1[1], 'huts');
    const after = { house: City.maximum('house'), tannery: City.maximum('tannery'), slots: City.jobSlots('capital', 'woodcutter'),
      hunter: City.jobSlots('capital', 'hunter'), oak: City.jobSlots('capital', 'oak cutter') };
    return { before, after, districts: $SM.get('game.cities.capital.districts'), tiers: Network.tiers() };
  }, at);
  expect(r.before).toEqual({ house: 0, woodshed: 1, slots: 0 });
  expect(r.after.house).toBe(10);
  expect(r.after.tannery).toBe(0);
  expect(r.after.slots).toBe(4);
  expect(r.after.hunter).toBe(0);
  expect(Object.values(r.districts).sort()).toEqual(['hearth quarter', 'huts', 'woods']);
  // the woodcutters' row opens, and holds no more than the land has room for
  await page.locator('#location_city').click();
  const row = page.locator('#city_workers_row_woodcutter');
  await expect(row).toBeVisible();
  await row.locator('.upManyBtn').click();
  expect(await page.evaluate(() => $SM.get('game.cities.capital.workers.woodcutter'))).toBe(4);
  // the original village keeps its own jobs for the capital
  expect(await page.evaluate(() => typeof $SM.get('income["gatherer"]'))).toBe('object');
  expect(errors).toEqual([]);
});

test('fire falls 25% a ring from the hearth quarter; touching the hearth and good neighbours help; a cold hearth halves it', async ({ page }) => {
  const errors = await townWithFire(page);
  const at = await laidOut(page);
  const r = await page.evaluate((at) => {
    $SM.set('game.cities.capital.population.citizens', 20);
    burnTick();
    Network.placeDistrict('capital', at.e1[0], at.e1[1], 'woods');
    $SM.set('game.cities.capital.workers.woodcutter', 2);
    City.updateIncome();
    const ring1 = $SM.get('income["capital:woodcutter"]').delay;
    const share1 = City.jobShare('capital', 'woodcutter');
    Network.placeDistrict('capital', at.e2[0], at.e2[1], 'woods');
    const share12 = City.jobShare('capital', 'woodcutter');
    Network.placeDistrict('capital', at.se[0], at.se[1], 'huts'); // touches e1: +wood next to huts
    const withHuts = City.jobShare('capital', 'woodcutter');
    $SM.setM('stores', { wood: 0, tallow: 0 });
    for (let i = 0; i < 3; i++) burnTick(); // past what the hearth had stored
    const cold = City.jobShare('capital', 'woodcutter');
    return { ring1, share1, share12, withHuts, cold };
  }, at);
  expect(r.share1).toBeCloseTo(0.75 + 0.1, 5);  // ring 1, touching the hearth quarter
  expect(r.ring1).toBe(Math.round(10 / 0.85));
  expect(r.share12).toBeCloseTo((0.85 + 0.5) / 2, 5); // ring 2 doesn't touch it
  expect(r.withHuts).toBeGreaterThan(r.share12);
  expect(r.cold).toBeCloseTo(r.withHuts * 0.5, 5);
  expect(errors).toEqual([]);
});

// clicks an event's button by its text, once the event shows it
const choose = async (page, text) => {
  const b = page.locator('#event .button', { hasText: text });
  await expect(b).toBeVisible();
  await b.click();
};

test('the world is bigger: the stone hearth, the braziers and the first one lit, on a fresh save', async ({ page }) => {
  const { errors } = await freshToTown(page);
  const ask = () => page.evaluate(() => { clearTimeout(Events._eventTimeout); Network._nextAsk = 0; Network.checkStory(); });
  expect(await page.evaluate(() => ['H2', 'H3', 'B1'].map((t) => Network.has(t)))).toEqual([true, false, false]);
  await ask();
  await expect(page.locator('#event')).toContainText('says a town needs a hearth, not a campfire.');
  const wood = await page.evaluate(() => $SM.get('stores.wood'));
  await choose(page, 'lay the stones');
  await expect(page.locator('#event')).toContainText('stone by stone');
  await choose(page, 'good');
  await expect(page.locator('#event')).toHaveCount(0);
  // 200 wood for the stones (the room's fire and the hearth burn a little meanwhile)
  const left = await page.evaluate(() => $SM.get('stores.wood'));
  expect(left).toBeLessThanOrEqual(wood - 200);
  expect(left).toBeGreaterThan(wood - 300);
  expect(await page.evaluate(() => Network.has('H3'))).toBe(true);

  await ask();
  await expect(page.locator('#event')).toContainText('the land runs on past the wasteland.');
  await choose(page, 'raise braziers');
  await expect(page.locator('#event')).toHaveCount(0);
  expect(await page.evaluate(() => Network.has('B1'))).toBe(true);

  // the first brazier, raised from the land view in the town
  await page.locator('#location_city').click();
  await expect(page.locator('#cityLand')).toBeVisible();
  const spot = await page.evaluate(() => {
    Network.tick(); // the hearth has been burning since the town opened
    const cap = World.hex.gen.capital;
    for (const p of Fire.ring(cap[0], cap[1], 2)) if (Network.canBeacon(p[0], p[1])) return p;
    return null;
  });
  expect(spot).not.toBeNull();
  await page.evaluate((p) => Network.select(p), spot);
  await page.locator('#land_beacon').click();
  await expect(page.locator('#event')).toContainText('the brazier catches.');
  await choose(page, 'go back');
  expect(await page.evaluate((p) => Network.beaconAt(p[0], p[1]), spot)).toBe(true);
  expect(errors).toEqual([]);
});

test('the wanderer\'s cairns: told in town, found on a trek, built at home', async ({ page }) => {
  const errors = await townWithFire(page, { tiers: ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'H1', 'H2', 'H3', 'H4'] });
  await page.evaluate(() => {
    $SM.set('game.network.story.cairnTold', false);
    $SM.set('game.network.story.cairnDone', false);
    Network._nextAsk = 0;
    Network.checkStory();
  });
  await expect(page.locator('#event')).toContainText('the cairns had fire on them');
  await choose(page, 'ask where');
  await expect(page.locator('#event')).toContainText('gone by morning.');
  await choose(page, 'go back');
  const cairn = await page.evaluate(() => $SM.get('game.network.cairn'));
  const r = await page.evaluate((c) => ({
    d: Fire.distance(c, World.hex.gen.capital), seen: !!World.hex.mask[c[0]][c[1]], glyph: World.hexGlyph(c[0], c[1], World.hex.map)[0],
  }), cairn);
  expect(r.d).toBeGreaterThanOrEqual(7);
  expect(r.d).toBeLessThanOrEqual(9);
  expect(r.seen).toBe(true);
  expect(r.glyph).toBe('|');

  // out on a trek to it
  await page.locator('#location_path').click();
  await page.evaluate((c) => {
    packMeat();
    Path.embark();
    Math.random = () => 0.99;
    for (let d = 0; d < 6; d++) {
      const n = WorldGen.neighbour(c[0], c[1], d);
      if (WorldGen.isPassable(World.state.map[n[0]][n[1]])) {
        World.curPos = n;
        World.moveHex((d + 3) % 6);
        break;
      }
    }
  }, cairn);
  await expect(page.locator('#event')).toContainText('black with old soot');
  await choose(page, 'study the stacking');
  await choose(page, 'go on');
  await page.evaluate(() => World.goHome());
  await expect(page.locator('#event')).toContainText('it carries further.', { timeout: 5000 });
  await choose(page, 'good');
  expect(await page.evaluate(() => Network.has('B3'))).toBe(true);
  expect(await page.evaluate((c) => Network.isCairn(c[0], c[1]), cairn)).toBe(false);
  expect(errors).toEqual([]);
});

test('milestones: the woodshed, the axe-head, the tannery and smokehouse, the first trek home and district', async ({ page }) => {
  const errors = await townWithFire(page, { tiers: ['F1', 'B1', 'H1', 'H2', 'H3'] });
  const r = await page.evaluate(() => {
    const out = {};
    $SM.setM('game.network.story', { trekHome: false, cairnDone: false });
    $SM.set('game.network.tiers', { F1: true, B1: true, H1: true, H2: true, H3: true });
    out.start = Object.keys(Network.tiers()).sort();
    $SM.set('game.cities.capital.buildings.woodshed', 1);
    out.F2 = Network.has('F2');
    const cap = World.hex.gen.capital, e1 = WorldGen.neighbour(cap[0], cap[1], 0);
    World.hex.gen.terrain[e1[0]][e1[1]] = WorldGen.TERRAIN.field;
    World.hex.map[e1[0]][e1[1]] = WorldGen.TERRAIN.field;
    World.hex.mask[e1[0]][e1[1]] = true;
    burnTick(); // lit ground for the district
    Network.placeDistrict('capital', e1[0], e1[1], 'huts');
    out.H4 = Network.has('H4');
    $SM.setM('game.workers', { tanner: 1, charcutier: 1 });
    out.F4early = Network.has('F4'); // waits for F3
    return out;
  });
  expect(r.start).toEqual(['B1', 'F1', 'H1', 'H2', 'H3']);
  expect(r.F2).toBe(true);
  expect(r.H4).toBe(true);
  expect(r.F4early).toBe(false);
  // a trek into a forest finds the axe-head; home again, B2 and F3 (and then F4) follow
  await page.locator('#location_path').click();
  await page.evaluate(() => {
    packMeat();
    Path.embark();
    Math.random = () => 0.99;
    // a step onto the nearest forest the capital touches, or else anywhere
    const cap = World.hex.gen.capital, g = World.hex.gen;
    const n = WorldGen.neighbour(cap[0], cap[1], 0);
    g.terrain[n[0]][n[1]] = World.state.map[n[0]][n[1]] = WorldGen.TERRAIN.forest;
    World.moveHex(0);
  });
  expect(await page.evaluate(() => World.state.axeHead)).toBe(true);
  await page.evaluate(() => World.goHome());
  expect(await page.evaluate(() => ['B2', 'F3', 'F4'].map((t) => Network.has(t)))).toEqual([true, true, true]);
  expect(errors).toEqual([]);
});

test('a v2.2 save loads: no happiness, the capital on the map with its hearth quarter, the tiers it has earned', async ({ page }) => {
  const save = load('v2.2-hex');
  expect(save.version).toBe(2.2);
  expect(save.game.cities.capital.happiness).toBe(50);
  await freezeClock(page); // no income ticks before the stores are read
  const errors = await openGame(page, { save });
  const s = await getState(page);
  expect(s.version).toBe(2.7);
  expect(s.game.cities.capital.happiness).toBeUndefined();
  const cap = save.game.cities.capital;
  expect(s.game.cities.capital).toMatchObject({ name: cap.name, focus: cap.focus, population: cap.population, workers: cap.workers });
  const hex = await page.evaluate(() => World.hex.gen.capital);
  expect(s.game.cities.capital.hex).toEqual(hex);
  expect(s.game.cities.capital.districts).toEqual({ [hex.join(',')]: 'hearth quarter' });
  // the old game had lit the fire, warmed the room, kept the builder, run the tannery and smokehouse
  expect(Object.keys(s.game.network.tiers).sort()).toEqual(['F1', 'H1', 'H2']);
  expect(s.stores).toEqual(save.stores);
  await page.clock.runFor(11 * 1000);
  expect(await page.evaluate(() => $SM.get('game.cities.capital.hearth.fuel'))).toBe('wood');
  expect(errors).toEqual([]);
});

test('a v2.1 save (no difficulty) still loads, through every step to v2.7', async ({ page }) => {
  const save = load('v2.2-hex');
  save.version = 2.1;
  delete save.game.difficulty;
  const errors = await openGame(page, { save });
  const s = await getState(page);
  expect(s.version).toBe(2.7);
  expect(s.game.difficulty).toBe('normal');
  expect(s.game.cities.capital.happiness).toBeUndefined();
  expect(errors).toEqual([]);
});

test('the land view: a click picks a hex and offers what can go there; the map shows the light', async ({ page }) => {
  const errors = await townWithFire(page);
  await page.evaluate(() => { $SM.set('stores.tallow', 1000); burnTick(); lineEast(2); });
  await page.locator('#location_city').click();
  await expect(page.locator('#landMap canvas')).toBeVisible();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated')); // the slide to the town
  await expect(page.locator('#fireStatus')).toHaveText('the town hearth burns tallow. fire 24. beacons lit: 2 of 2.');
  // click the hex east of the capital, in the middle of the view
  const target = await page.evaluate(() => {
    const cap = World.hex.gen.capital, p = World.hexCentre(cap[0] + 1, cap[1]), c = World.hexCentre(cap[0], cap[1]);
    return { dx: p[0] - c[0], dy: p[1] - c[1], hex: [cap[0] + 1, cap[1]] };
  });
  // through the locator, which waits for the canvas to sit still and take the click
  await page.locator('#landMap canvas').click({ position: { x: 230 + target.dx, y: 150 + target.dy } });
  expect(await page.evaluate(() => Network.selected)).toEqual(target.hex);
  await expect(page.locator('#landActions .button').first()).toBeVisible();
  // lit hexes are drawn: the view is not blank where the line is
  const inked = await page.evaluate(() => {
    const c = $('#landMap canvas')[0], d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(inked).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('drawing a lit network stays inside the frame budget, on the trek map and in the town', async ({ page }) => {
  const errors = await townWithFire(page);
  const ms = await page.evaluate(() => {
    $SM.set('stores.tallow', 1000);
    burnTick();
    lineEast(5);
    Network.draw();
    const time = (f) => {
      for (let i = 0; i < 3; i++) f();
      const t = [];
      for (let i = 0; i < 20; i++) { const t0 = performance.now(); f(); t.push(performance.now() - t0); }
      return t.sort((a, b) => a - b)[10];
    };
    return time(() => Network.draw());
  });
  expect(ms).toBeLessThan(process.env.CI ? 33 : 16);
  expect(errors).toEqual([]);
});

test('lights on, the lit land stays clear and the dark past it is washed grey; lights off, the lit land glows', async ({ page }) => {
  const errors = await townWithFire(page);
  const alphaAt = () => page.evaluate(() => {
    const g = World.hex.gen, cap = g.capital, fire = World.hex.fire;
    // a seen hex lit and one seen but dark, both in the land view
    let lit = null, dark = null;
    for (let r = 1; r < 8 && !(lit && dark); r++) {
      for (const p of Fire.ring(cap[0], cap[1], r)) {
        World.hex.mask[p[0]][p[1]] = true;
        const k = p[0] + p[1] * g.cols;
        if (!lit && fire.lit[k] && !Network.beaconAt(p[0], p[1])) lit = p;
        if (!dark && !fire.lit[k]) dark = p;
      }
    }
    Network.draw();
    const c = $('#landMap canvas')[0], dpr = c.width / Network.VIEW[0], ctx = c.getContext('2d');
    const at = (p) => {
      const m = World.hexCentre(p[0], p[1]);
      const x = Math.round((m[0] - Network.cam[0] + Network.VIEW[0] / 2) * dpr);
      const y = Math.round((m[1] - 6 - Network.cam[1] + Network.VIEW[1] / 2) * dpr); // above the glyph
      return ctx.getImageData(x, y, 1, 1).data[3];
    };
    return { lit: at(lit), dark: at(dark) };
  });
  await page.evaluate(() => { $SM.set('stores.tallow', 1000); burnTick(); lineEast(2); });
  const on = await alphaAt();
  expect(on.lit).toBe(0);
  expect(on.dark).toBeGreaterThan(0);
  await page.evaluate(() => Engine.turnLightsOff());
  await page.waitForTimeout(300);
  const off = await alphaAt();
  expect(off.lit).toBeGreaterThan(0);
  expect(off.dark).toBe(0);
  expect(errors).toEqual([]);
});
