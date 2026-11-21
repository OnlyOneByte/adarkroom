// SPDX-License-Identifier: MIT
// QA of Phase 3a (the fire network, districts, story chains): regressions that hold, and the
// bugs found (test.fixme, each naming its bug; design/text/qa-phase3a.md has the table).
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState, freshToTown } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const EMBER = ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'];

// A fresh game with the town open and the given tiers, no ticks or story unless a test asks.
async function town(page, { tiers = EMBER } = {}) {
  const { errors } = await freshToTown(page);
  await page.evaluate((tiers) => {
    clearTimeout(Events._eventTimeout);
    clearTimeout(Network._tickTimeout);
    Network._nextAsk = Date.now() + 1e9;
    const t = {};
    tiers.forEach((id) => { t[id] = true; });
    $SM.set('game.network.tiers', t);
    $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnDone: true });
    // the test owns the ground: set a hex's terrain, seen
    window.setGround = (p, t) => {
      World.hex.gen.terrain[p[0]][p[1]] = WorldGen.TERRAIN[t];
      World.hex.map[p[0]][p[1]] = WorldGen.TERRAIN[t];
      World.hex.mask[p[0]][p[1]] = true;
    };
    window.lit = () => World.hex.fire.lit.reduce((a, b) => a + b, 0);
    window.isLit = (p) => !!World.hex.fire.lit[p[0] + p[1] * World.hex.gen.cols];
    window.hearth = () => $SM.get('game.cities.capital.hearth');
    // a straight line of beacons east of the capital, 3 apart, on field
    window.fieldLine = (n) => {
      const cap = World.hex.gen.capital, out = [];
      for (let i = 1; i <= n; i++) {
        const p = [cap[0] + 3 * i, cap[1]];
        for (let x = cap[0] + 3 * (i - 1) + 1; x <= p[0]; x++) setGround([x, cap[1]], 'field');
        $SM.set('game.network.beacons["' + p[0] + ',' + p[1] + '"]', true);
        out.push(p);
      }
      Network.refresh();
      return out;
    };
  }, tiers);
  return errors;
}

// one pure network: hearths and beacons in a row on open, safe ground
const pure = (page, o) => page.evaluate((o) => {
  const r = Fire.compute({
    cols: 80, rows: 20, danger: o.danger ? new Function('x', 'y', o.danger) : () => 0,
    hills: o.hills ? () => true : () => false, beacon: Fire.BEACONS[o.B || 'B4'],
    hearths: o.hearths, beacons: o.beacons,
  });
  return { nodes: r.nodes.map((n) => Math.round(n.s * 100) / 100), lit: r.lit.reduce((a, b) => a + b, 0) };
}, o);

/*
 * What holds
 */

test('hex geometry agrees: every WorldGen neighbour is 1 away by Fire.distance, on even and odd rows', async ({ page }) => {
  await openGame(page);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const at of [[10, 10], [10, 11], [0, 0], [5, 7]]) {
      for (let d = 0; d < 6; d++) {
        const n = WorldGen.neighbour(at[0], at[1], d);
        if (Fire.distance(at, n) !== 1) out.push([at, d, n]);
      }
      if (Fire.ring(at[0], at[1], 1).length !== 6) out.push([at, 'ring']);
      if (Fire.around(at[0], at[1], 2).length !== 19) out.push([at, 'around']);
    }
    // a line between two nodes is contiguous
    const l = Fire.line([3, 4], [6, 7]);
    for (let i = 1; i < l.length; i++) if (Fire.distance(l[i - 1], l[i]) !== 1) out.push(['line', l]);
    return out;
  });
  expect(bad).toEqual([]);
});

test('the prologue is unchanged: no hearth burns, no land view, no fire network UI before the town', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#lightButton').click();
  const r = await page.evaluate(() => {
    clearTimeout(Events._eventTimeout);
    Room.unlockForest();
    $SM.set('stores.wood', 500);
    const w = $SM.get('stores.wood');
    clearTimeout(Network._tickTimeout);
    Network.tick(); // the fire tick does nothing until the town is open
    return {
      wood: $SM.get('stores.wood') - w, city: !!$SM.get('features.location.city'),
      land: $('#cityLand').length, hearth: $SM.get('game.cities'), tiers: Object.keys(Network.tiers()).sort(),
    };
  });
  expect(r.wood).toBe(0);
  expect(r.city).toBe(false);
  expect(r.land).toBe(0);
  expect(r.hearth).toBeUndefined();
  expect(r.tiers).toEqual(['F1']);
  expect(errors).toEqual([]);
});

test('beacon placement: within 3 hexes of a node, seen ground, never on ocean, mountains, a district or another beacon', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    const p = (dx) => [cap[0] + dx, cap[1]];
    for (let dx = 1; dx <= 7; dx++) setGround(p(dx), 'field');
    const out = { d3: Network.canBeacon(...p(3)), d4: Network.canBeacon(...p(4)) };
    World.hex.mask[cap[0] + 2][cap[1]] = false;
    out.unseen = Network.canBeacon(...p(2));
    setGround(p(2), 'ocean'); out.ocean = Network.canBeacon(...p(2));
    setGround(p(2), 'mountains'); out.mountains = Network.canBeacon(...p(2));
    setGround(p(2), 'field');
    out.home = Network.canBeacon(cap[0], cap[1]);
    $SM.set('stores.wood', 100);
    out.raised = Network.raiseBeacon(...p(3));
    out.twice = Network.canBeacon(...p(3));
    out.chained = Network.canBeacon(...p(6)); // 3 from the new beacon
    out.wood = $SM.get('stores.wood');
    $SM.set('stores.wood', 10);
    out.poor = Network.raiseBeacon(...p(6));
    return out;
  });
  expect(r).toEqual({ d3: true, d4: false, unseen: false, ocean: false, mountains: false, home: false,
    raised: true, twice: false, chained: true, wood: 80, poor: false });
  expect(errors).toEqual([]);
});

test('a cut line goes dark past the cut and stops costing upkeep; relit, it pays again', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    $SM.setM('stores', { wood: 100000, tallow: 1000 });
    Network.tick();
    const line = fieldLine(4);
    Network.tick();
    const fed = hearth().fed;
    Network.putOut(line[1][0], line[1][1]);
    Network.tick();
    const cut = { fed: hearth().fed, lit: line.map(isLit) };
    Network.raiseBeacon(line[1][0], line[1][1]);
    Network.tick();
    return { fed, cut, again: hearth().fed };
  });
  expect(r.fed).toBe(4);
  expect(r.cut).toEqual({ fed: 1, lit: [true, false, false, false] });
  expect(r.again).toBe(4);
  expect(errors).toEqual([]);
});

test('relay rule: a beacon below RELAY_MIN is still lit but passes nothing on', async ({ page }) => {
  await openGame(page);
  // a stone hearth (16) with braziers (50%): 8, 4, then 2 (lit, no relay), then nothing
  const r = await pure(page, { B: 'B1', hearths: [{ at: [5, 10], out: 16, share: true, cap: 10 }],
    beacons: [[8, 10], [11, 10], [14, 10], [17, 10]] });
  expect(r.nodes).toEqual([16, 8, 4, 2, 0]);
});

test('fuel reach: a beacon past the fuel\'s danger cap is dark and so is everything past it', async ({ page }) => {
  await openGame(page);
  const r = await pure(page, { hearths: [{ at: [5, 10], out: 24, share: true, cap: 1 }],
    beacons: [[8, 10], [11, 10], [14, 10]], danger: 'return x === 11 ? 1.2 : 0' });
  expect(r.nodes).toEqual([24, 16.8, 0, 0]);
});

test('lit land is safer only while lit: the danger comes back when the fuel runs out', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    $SM.setM('stores', { wood: 0, tallow: 1000, 'dry wood': 0, 'seasoned oak': 0 });
    Network.tick();
    const line = fieldLine(2), p = line[1];
    Network.tick();
    const before = { base: World.baseDangerAt(...p), now: World.dangerAt(...p), lit: isLit(p) };
    $SM.set('stores.tallow', 0);
    $SM.set('game.cities.capital.hearth.stored', 0);
    Network.tick();
    return { before, after: { now: World.dangerAt(...p), lit: isLit(p) } };
  });
  expect(r.before.lit).toBe(true);
  expect(r.before.now).toBe(Math.max(0, r.before.base - 1));
  expect(r.after.lit).toBe(false);
  expect(r.after.now).toBe(r.before.base);
  expect(errors).toEqual([]);
});

test('a dropped pack on lit land is scavenged at the lit danger (slower)', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    $SM.setM('stores', { tallow: 1000 });
    Network.tick();
    const line = fieldLine(2);
    Network.tick();
    const p = line[1];
    return { rate: Danger.scavengeRate(World.dangerAt(...p)), plain: Danger.scavengeRate(World.baseDangerAt(...p)), lit: isLit(p) };
  });
  expect(r.lit).toBe(true);
  expect(r.rate).toBeLessThanOrEqual(r.plain);
  expect(errors).toEqual([]);
});

test('districts: never on water or mountains, never on a beacon, only touching the city, a second hearth quarter never offered', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    const cap = World.hex.gen.capital, n = (d) => WorldGen.neighbour(cap[0], cap[1], d);
    const out = {};
    setGround(n(0), 'lake'); out.lake = Network.districtsFor('capital', ...n(0));
    setGround(n(0), 'ocean'); out.ocean = Network.districtsFor('capital', ...n(0));
    setGround(n(0), 'mountains'); out.mountains = Network.districtsFor('capital', ...n(0));
    setGround(n(0), 'field');
    $SM.set('game.network.beacons["' + n(0).join(',') + '"]', true);
    out.beacon = Network.districtsFor('capital', ...n(0));
    out.hearth = Network.placeDistrict('capital', ...n(1), 'hearth quarter');
    setGround(n(1), 'field');
    $SM.set('stores.wood', 49);
    out.poor = Network.placeDistrict('capital', ...n(1), 'huts');
    return out;
  });
  expect(r).toEqual({ lake: [], ocean: [], mountains: [], beacon: [], hearth: false, poor: false });
  expect(errors).toEqual([]);
});

test('tannery row needs hunting grounds beside it, burning pits need barrens or a forest edge', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    const cap = World.hex.gen.capital, n = (d) => WorldGen.neighbour(cap[0], cap[1], d);
    for (let d = 0; d < 6; d++) setGround(n(d), 'field');
    const out = { before: Network.districtsFor('capital', ...n(1)) };
    Network.placeDistrict('capital', ...n(0), 'hunting grounds');
    out.after = Network.districtsFor('capital', ...n(1)); // n(1) touches n(0)
    return out;
  });
  expect(r.before).not.toContain('tannery row');
  expect(r.before).not.toContain('burning pits'); // field is neither barrens nor forest
  expect(r.after).toContain('tannery row');
  expect(errors).toEqual([]);
});

test('story: put off, the stone hearth asks again later; reloaded mid-chain, it picks up where it was', async ({ page }) => {
  const { errors } = await freshToTown(page);
  await page.evaluate(() => { clearTimeout(Events._eventTimeout); clearTimeout(Network._tickTimeout); Network._nextAsk = 0; Network.checkStory(); });
  await expect(page.locator('#event')).toContainText('says a town needs a hearth');
  await page.locator('#event .button', { hasText: 'not yet' }).click();
  await expect(page.locator('#event')).toHaveCount(0);
  const again = await page.evaluate(() => { Network.checkStory(); return !!Events.activeEvent(); });
  expect(again).toBe(false); // not straight away
  await page.evaluate(() => { Network._nextAsk = 0; Network.checkStory(); });
  await expect(page.locator('#event')).toContainText('says a town needs a hearth');
  await page.locator('#event .button', { hasText: 'lay the stones' }).click();
  await expect(page.locator('#event')).toContainText('stone by stone');
  // saved and reloaded before the last button: H3 is kept, the next scene is the bigger world
  await page.evaluate(() => Engine.saveGame());
  await page.reload();
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);
  const r = await page.evaluate(() => {
    clearTimeout(Events._eventTimeout);
    Network._nextAsk = 0;
    Network.checkStory();
    return { H3: Network.has('H3'), title: Events.activeEvent() && $('#event .eventTitle').text() };
  });
  expect(r.H3).toBe(true);
  expect(r.title).toBe('The Bigger World');
  expect(errors).toEqual([]);
});

test('story: the wanderer sent off asks again; the cairn left alone can be studied on a later visit', async ({ page }) => {
  const errors = await town(page, { tiers: ['F1', 'B1', 'B2', 'H1', 'H2', 'H3'] });
  await page.evaluate(() => {
    $SM.setM('game.network.story', { cairnTold: false, cairnDone: false });
    Network._nextAsk = 0;
    Network.checkStory();
  });
  await page.locator('#event .button', { hasText: 'send them off' }).click();
  await expect(page.locator('#event')).toHaveCount(0);
  expect(await page.evaluate(() => [Network.flag('cairnTold'), $SM.get('game.network.cairn')])).toEqual([false, undefined]);
  await page.evaluate(() => { Network._nextAsk = 0; Network.checkStory(); });
  await page.locator('#event .button', { hasText: 'ask where' }).click();
  await page.locator('#event .button', { hasText: 'go back' }).click();
  const c = await page.evaluate(() => $SM.get('game.network.cairn'));
  expect(c).toHaveLength(2);
  await page.locator('#location_path').click();
  await page.evaluate((c) => {
    packMeat();
    Path.embark();
    Math.random = () => 0.99;
    Network.onStep(c[0], c[1]);
  }, c);
  await page.locator('#event .button', { hasText: 'leave it' }).click();
  await expect(page.locator('#event')).toHaveCount(0);
  expect(await page.evaluate(() => Network.flag('cairnStudied'))).toBe(false);
  await page.evaluate((c) => Network.onStep(c[0], c[1]), c);
  await expect(page.locator('#event')).toContainText('black with old soot');
  expect(errors).toEqual([]);
});

test('a v1.3 save with a world loads through every step to v2.4, with a fire network and no errors', async ({ page }) => {
  const save = load('v1.3-world');
  await page.clock.install(); // no income ticks before the stores are read
  const errors = await openGame(page, { save });
  const s = await getState(page);
  expect(s.version).toBe(2.4);
  expect(s.game.network.tiers.F1).toBe(true);
  for (const id in s.game.cities || {}) expect(s.game.cities[id].happiness).toBeUndefined();
  expect(s.stores).toEqual(save.stores);
  expect(errors).toEqual([]);
});

test('a v2.0 town save loads to v2.4: happiness gone, the town keeps its people and buildings', async ({ page }) => {
  const save = load('v2.0-town');
  const errors = await openGame(page, { save });
  const s = await getState(page);
  expect(s.version).toBe(2.4);
  for (const id in save.game.cities) {
    expect(s.game.cities[id].happiness).toBeUndefined();
    expect(s.game.cities[id].population).toEqual(save.game.cities[id].population);
    expect(s.game.cities[id].buildings).toEqual(save.game.cities[id].buildings);
  }
  expect(errors).toEqual([]);
});

test('perf: 300 beacons compute, tick and draw inside the frame budget', async ({ page }) => {
  const errors = await town(page);
  const ms = await page.evaluate(() => {
    $SM.setM('stores', { tallow: 1e6, wood: 1e6 });
    Network.tick();
    const cap = World.hex.gen.capital, b = {};
    let n = 0;
    for (let dy = -30; dy <= 30 && n < 300; dy += 2) {
      for (let dx = -30; dx <= 30 && n < 300; dx += 2) {
        const x = cap[0] + dx, y = cap[1] + dy;
        if (x < 0 || y < 0 || x >= World.hex.gen.cols || y >= World.hex.gen.rows || (dx === 0 && dy === 0)) continue;
        b[x + ',' + y] = true;
        n++;
      }
    }
    $SM.set('game.network.beacons', b);
    const time = (f) => {
      for (let i = 0; i < 2; i++) f();
      const t = [];
      for (let i = 0; i < 9; i++) { const t0 = performance.now(); f(); t.push(performance.now() - t0); }
      return t.sort((a, c) => a - c)[4];
    };
    return { n, refresh: time(() => Network.refresh()), tick: time(() => Network.tick()), draw: time(() => Network.draw()) };
  });
  expect(ms.n).toBe(300);
  const budget = process.env.CI ? 200 : 100; // loose: it guards against blow-ups, not for a frame
  expect(ms.refresh).toBeLessThan(budget);
  expect(ms.tick).toBeLessThan(budget);
  expect(ms.draw).toBeLessThan(process.env.CI ? 33 : 16);
  expect(errors).toEqual([]);
});

/*
 * Bugs (test.fixme until fixed; see design/text/qa-phase3a.md)
 */

// BUG 1: Fire.pickFuel takes the strongest fuel with any stock and burns only that, so a trickle
// of dry wood (one drier) or tallow (one renderer) starves a hearth sitting on a big woodpile.
test('BUG 1: a trickle of a strong fuel does not starve a hearth with plenty of wood', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    $SM.setM('stores', { wood: 10000, 'dry wood': 0, tallow: 0, 'seasoned oak': 0 });
    Network.tick();
    const wood = hearth().out;
    // one drier's output: 2 dry wood each tick
    const outs = [];
    for (let i = 0; i < 6; i++) {
      $SM.add('stores["dry wood"]', 2);
      Network.tick();
      outs.push(hearth().out);
    }
    return { wood, outs };
  });
  expect(r.wood).toBe(24);
  for (const o of r.outs) expect(o).toBe(24);
  expect(errors).toEqual([]);
});

// BUG 2: running on its stored fire (fuel just ran out) the hearth records fuel: null, so its reach
// cap drops to 0 and the whole network goes dark while the hearth still makes full fire.
test('BUG 2: a hearth burning its store keeps its lines lit through a short fuel gap', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    $SM.setM('stores', { wood: 0, tallow: 1000, 'dry wood': 0, 'seasoned oak': 0 });
    Network.tick();
    const line = fieldLine(2);
    Network.tick();
    const before = { lit: line.map(isLit), n: lit() };
    $SM.set('stores.tallow', 0);
    Network.tick(); // the town hearth's store of 32 carries it this tick
    return { before, out: hearth().out, after: { lit: line.map(isLit), n: lit() }, status: $('#fireStatus').text() };
  });
  expect(r.before.lit).toEqual([true, true]);
  expect(r.out).toBe(24);
  expect(r.after.lit).toEqual([true, true]);
  expect(r.after.n).toBe(r.before.n);
  expect(r.status).not.toContain('is cold');
  expect(errors).toEqual([]);
});

// BUG 3: Fire.compute pools sharing hearths by distance alone, so two hearths joined only through
// a dark beacon (past the fuel's reach, or too weak to be lit) still add their fire together.
test('BUG 3: hearths joined only through a dark beacon do not pool their fire', async ({ page }) => {
  await openGame(page);
  const r = await pure(page, { hearths: [{ at: [5, 10], out: 16, share: true, cap: 1 }, { at: [11, 10], out: 16, share: true, cap: 1 }],
    beacons: [[8, 10]], danger: 'return x === 8 ? 5 : 0' });
  expect(r.nodes[2]).toBe(0); // the beacon between them is dark
  expect(r.nodes.slice(0, 2)).toEqual([16, 16]);
});

// BUG 4: Network.tick gives every city the whole network's count of lit beacons as its upkeep, so
// with a second city each hearth pays for every beacon (latent until Phase 3b founds cities).
test('BUG 4 (fixed in 3b): a second city does not pay the upkeep of the capital\'s beacons', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    $SM.setM('stores', { wood: 100000, tallow: 1000 });
    const g = World.hex.gen, cap = g.capital, far = [cap[0], cap[1] + 20];
    setGround(far, 'field');
    const d = {};
    d[far.join(',')] = District.HEARTH;
    $SM.set('game.cities["b"]', { name: 'b', focus: null, population: { citizens: 0 }, buildings: {}, workers: {},
      stores: { wood: 1000 }, hex: far, districts: d, hearth: { fuel: null, out: 0, stored: 0, fed: 0 } });
    Network.tick();
    fieldLine(3);
    Network.tick();
    return { capital: hearth().fed, b: $SM.get('game.cities["b"].hearth.fed') };
  });
  expect(r.capital).toBe(3);
  expect(r.b).toBe(0);
  expect(errors).toEqual([]);
});

// BUG 5: a watch fire (B4) on hills keeps all its fire, so a chain of hill beacons never loses
// strength and carries without end; CITY.md gives B4 "+1 hop on hills".
test('BUG 5: watch fires on hills add one hop, not endless reach', async ({ page }) => {
  await openGame(page);
  const beacons = [];
  for (let i = 1; i <= 12; i++) beacons.push([5 + 3 * i, 10]);
  const o = { B: 'B4', hearths: [{ at: [5, 10], out: 16, share: true, cap: 10 }], beacons };
  const litOf = (r) => r.nodes.slice(1).filter((s) => s >= 1).length;
  const flat = litOf(await pure(page, o)), hills = litOf(await pure(page, { ...o, hills: true }));
  expect(flat).toBe(4);
  expect(hills).toBe(flat + 1); // before the fix all 12 were lit, at full strength
});

// BUG 6: Network.canBeacon only refuses ocean and mountains; a lake hex is passable, so an ember
// beacon stands on open water (crossing water is B7 ford light / B11 lighthouse).
test('BUG 6: no ember beacon on a lake', async ({ page }) => {
  const errors = await town(page);
  const ok = await page.evaluate(() => {
    const cap = World.hex.gen.capital, p = [cap[0] + 2, cap[1]];
    setGround(p, 'lake');
    return Network.canBeacon(p[0], p[1]);
  });
  expect(ok).toBe(false);
  expect(errors).toEqual([]);
});

// BUG 7: Network.hexNote names the capital's hex by its district, so the hover on home reads
// "hearth quarter" instead of "the capital", on the trek map and in the land view.
test('BUG 7: the capital\'s hex is still labelled the capital', async ({ page }) => {
  const errors = await town(page);
  const label = await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    return World.hexLabel(cap[0], cap[1], { map: World.hex.map, mask: World.hex.mask });
  });
  expect(label).toBe('the&nbsp;capital');
  expect(errors).toEqual([]);
});

// BUG 8: Network.placeCairn doesn't skip beacon hexes; a cairn put under a beacon is hidden (the
// beacon's point of light replaces its glyph) and its hover says "a watch fire".
test('BUG 8: the wanderer\'s cairn is never placed under a beacon', async ({ page }) => {
  const errors = await town(page);
  const r = await page.evaluate(() => {
    // every hex placeCairn could pick gets a beacon, but one (a plain, seen one, its lowest pick)
    const g = World.hex.gen, cap = g.capital, spots = [];
    for (const p of Fire.around(cap[0], cap[1], 9)) {
      const d = Fire.distance(cap, p), t = World.hex.map[p[0]] && World.hex.map[p[0]][p[1]];
      if (d < 7 || !t || !g.reachable[p[0] + p[1] * g.cols] || World.siteAt(p[0], p[1])) continue;
      if (!WorldGen.isTerrain(t) || !WorldGen.isPassable(t) || t === WorldGen.TERRAIN.ocean) continue;
      spots.push(p);
    }
    const free = spots.find((p) => World.hex.map[p[0]][p[1]] !== WorldGen.TERRAIN.hills && World.hex.mask[p[0]][p[1]]) || spots[0];
    spots.forEach((p) => { if (p !== free) $SM.set('game.network.beacons["' + p.join(',') + '"]', true); });
    Network.placeCairn();
    const c = $SM.get('game.network.cairn');
    $SM.set('game.network.story.cairnDone', false); // the cairn still to be found
    return { free, c, onBeacon: Network.beaconAt(c[0], c[1]), n: spots.length, raise: Network.canBeacon(c[0], c[1]) };
  });
  expect(r.n).toBeGreaterThan(1);
  expect(r.onBeacon).toBe(false);
  expect(r.raise).toBe(false); // and no beacon goes on it later
  expect(r.c).toEqual(r.free);
  expect(errors).toEqual([]);
});

// QA Q9 (decided): stores are fractional, so a hearth burns fractions of a unit
test('QA Q9: fuel burns in fractions, so a hearth without a store wastes none', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => Fire.burnAll('H3', { F1: true, F2: true }, (k) => (k === 'dry wood' ? 100 : 0), 17, 0));
  expect(r.burn['dry wood']).toBeCloseTo(17 / 1.5, 6); // 11.33 dry wood, not 12
  expect(r.out).toBe(16);
  expect(r.stored).toBe(0);
});

// QA Q5 (provisional, pending user): a line works at the lowest, so the weakest fuel burned sets the reach
test('QA Q5: with two fuels burned in a tick, the lines reach only as far as the weaker one', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const t = { F1: true, F2: true, F3: true, F4: true };
    const burn = (tallow) => Fire.burnAll('H4', t, (k) => ({ wood: 1000, tallow })[k] || 0, 24, 32);
    return { both: burn(2), tallow: burn(100) };
  });
  expect(r.both.burn).toEqual({ tallow: 2, wood: 16 });
  expect(r.both.fuel).toBe('wood');
  expect(r.tallow.burn).toEqual({ tallow: 6 });
  expect(r.tallow.fuel).toBe('tallow');
});

test('a saved network comes back on reload: beacons, the lit land, the hearth', async ({ page }) => {
  const errors = await town(page);
  const before = await page.evaluate(() => {
    $SM.setM('stores', { tallow: 1000 });
    Network.tick();
    fieldLine(3);
    Network.tick();
    Engine.saveGame();
    return { lit: lit(), beacons: Object.keys($SM.get('game.network.beacons')).sort() };
  });
  await page.reload();
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room && World.hex && World.hex.fire);
  const after = await page.evaluate(() => ({
    lit: World.hex.fire.lit.reduce((a, b) => a + b, 0), beacons: Object.keys($SM.get('game.network.beacons')).sort(),
  }));
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('lights off and on again with the land view open repaints it without errors', async ({ page }) => {
  const errors = await town(page);
  await page.evaluate(() => { $SM.setM('stores', { tallow: 1000 }); Network.tick(); fieldLine(2); });
  await page.locator('#location_city').click();
  await expect(page.locator('#landMap canvas')).toBeVisible();
  await page.evaluate(() => Engine.turnLightsOff());
  await page.waitForFunction(() => Engine.findStylesheet('darkenLights') != null); // the dark sheet has loaded
  await page.evaluate(() => Engine.turnLightsOff());
  expect(await page.evaluate(() => $SM.get('config.lightsOff'))).toBe(false);
  expect(errors).toEqual([]);
});

// BUG 9: Network.tick writes each city's hearth with two $SM.set calls (and a third for its fuel),
// each a full stateUpdate round, so with the 50 cities DESIGN.md "Scale" plans one fire tick takes
// 200-300 ms, a visible hitch every 10 s (latent until Phase 3b founds cities).
test.fixme('BUG 9: one fire tick with 50 cities stays inside 50 ms', async ({ page }) => {
  const errors = await town(page);
  const ms = await page.evaluate(() => {
    $SM.setM('stores', { wood: 1e6 });
    const cities = $SM.get('game.cities');
    for (let i = 0; i < 50; i++) {
      const at = [10 + (i % 10) * 12, 10 + Math.floor(i / 10) * 15], d = {};
      d[at.join(',')] = District.HEARTH;
      cities['c' + i] = { name: 'c' + i, focus: null, population: { citizens: 0 }, buildings: {}, workers: {},
        stores: { wood: 1e6 }, hex: at, districts: d, hearth: { fuel: null, out: 0, stored: 0, fed: 0 } };
    }
    $SM.set('game.cities', cities);
    const t = [];
    for (let i = 0; i < 7; i++) { const t0 = performance.now(); Network.tick(); t.push(performance.now() - t0); }
    return t.sort((a, b) => a - b)[3];
  });
  expect(ms).toBeLessThan(50);
  expect(errors).toEqual([]);
});
