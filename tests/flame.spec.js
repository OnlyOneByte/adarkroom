// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, freshToTown } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const EMBER = ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'];

const choose = async (page, text) => {
  const b = page.locator('#event .button', { hasText: text });
  await expect(b).toBeVisible();
  await b.click();
};
// the event closes (it fades out before Events.activeEvent clears)
const closed = (page) => page.waitForFunction(() => !Events.activeEvent());

// A fresh game with the town open, the tiers named (every ember tier by default), tallow in stock,
// no scene unless a test asks, and helpers to make a second city and walk to a hex.
async function flameTown(page, { tiers = EMBER } = {}) {
  const { errors } = await freshToTown(page);
  await page.evaluate((tiers) => {
    clearTimeout(Events._eventTimeout);
    clearTimeout(Network._tickTimeout);
    Network._nextAsk = Date.now() + 1e9;
    const t = {};
    tiers.forEach((id) => { t[id] = true; });
    $SM.set('game.network.tiers', t);
    $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnDone: true });
    $SM.setM('stores', { tallow: 1000, 'cured meat': 2000 });
    $SM.set('game.population', 80);
    window.burnTick = () => Network.tick();
    burnTick();
    const g = World.hex.gen, cap = g.capital;
    window.isLit = (p) => !!World.hex.fire.lit[p[0] + p[1] * g.cols];
    window.blankSite = (min = 3) => {
      for (const p of Fire.around(cap[0], cap[1], 6)) {
        if (Fire.distance(p, cap) < min || World.siteAt(p[0], p[1])) continue;
        World.hex.mask[p[0]][p[1]] = World.hex.mask[p[0]][p[1]] || isLit(p);
        const f = Network.foundingSite(p[0], p[1]);
        if (f && WorldGen.isPassable(World.hex.map[p[0]][p[1]]) && World.hex.map[p[0]][p[1]] !== WorldGen.TERRAIN.ocean) return p;
      }
      return null;
    };
    // a second city on a lit hex near the capital, made directly
    window.secondCity = (citizens = 8) => {
      const at = blankSite(), d = {};
      d[at.join(',')] = 'hearth quarter';
      City.createCity('city2', 'second town', { hex: at, districts: d, stores: { wood: 500 }, citizens, parent: 'capital' });
      Network.refresh();
      return at;
    };
    window.embark = () => {
      Path.outfit = { 'cured meat': 20 };
      Path.embark();
      Math.random = () => 0.99; // no fights
    };
    window.stepOnto = (p) => {
      for (let d = 0; d < 6; d++) {
        const n = WorldGen.neighbour(p[0], p[1], d);
        if (!World.canEnter(World.state.map[n[0]][n[1]])) continue;
        World.curPos = n.slice();
        World.move([p[0] - n[0], p[1] - n[1]]);
        return true;
      }
      return false;
    };
  }, tiers);
  return errors;
}

test('the flame era is wired: tiers 5-8 of every ladder have a beat and numbers; the blaze is not yet', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => ({
    tiers: Fire.TIERS.filter((t) => t.n >= 5).map((t) => ({ id: t.id, era: t.era, when: t.when })),
    fuels: Object.keys(Fire.FUELS).map((k) => Fire.FUELS[k].tier),
    beacons: Object.keys(Fire.BEACONS), hearths: Object.keys(Fire.HEARTHS),
    unknown: Fire.unlock('F9'),
  }));
  for (const t of r.tiers) expect(!!t.when).toBe(t.era === 'flame');
  expect(r.fuels).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
  expect(r.beacons).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
  expect(r.hearths).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8']);
  expect(r.unknown).toBe(false); // only the beats Network.BEATS knows
  expect(errors).toEqual([]);
});

test('lines: a hop along a road keeps 95%, the ford light crosses a lake, swamps cost a share until the marsh lantern', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    const cols = 20, rows = 5, k = (x, y) => x + y * cols;
    const run = (beacon, kind, opts = {}) => {
      const water = opts.water || [];
      const res = Fire.compute({
        cols, rows, field: new Float64Array(cols * rows), kind, hills: () => false,
        open: (x, y) => !water.some((w) => w[0] === x && w[1] === y),
        hearths: [{ at: [0, 2], out: 40, share: true, cap: 10, holds: 0 }],
        beacons: [[3, 2], [6, 2]], beacon: Fire.BEACONS[beacon],
      });
      return res.nodes.map((n) => Math.round(n.s * 100) / 100);
    };
    const plain = new Uint8Array(cols * rows);
    const road = new Uint8Array(cols * rows);
    for (let x = 0; x <= 6; x++) road[k(x, 2)] = Fire.ROAD;
    const lake = new Uint8Array(cols * rows);
    lake[k(1, 2)] = lake[k(2, 2)] = Fire.LAKE;
    const swamp = new Uint8Array(cols * rows);
    swamp[k(1, 2)] = swamp[k(2, 2)] = Fire.SWAMP;
    const water = { water: [[1, 2], [2, 2]] };
    return {
      plain: run('B6', plain), road: run('B6', road), roadB5: run('B5', road),
      lakeB6: run('B6', lake, water), lakeB7: run('B7', lake, water),
      swampB7: run('B7', swamp), swampB8: run('B8', swamp),
    };
  });
  expect(r.plain).toEqual([40, 30, 22.5]);
  expect(r.road).toEqual([40, 38, 36.1]);
  expect(r.roadB5).toEqual([40, 30, 22.5]); // the watchtower has no road share
  expect(r.lakeB6).toEqual([40, 0, 0]);
  expect(r.lakeB7).toEqual([40, 30, 22.5]);
  expect(r.swampB7).toEqual([40, 25.5, 19.13]);
  expect(r.swampB8).toEqual([40, 30, 22.5]);
  expect(errors).toEqual([]);
});

test('fuel reach: charcoal reaches band 1, peat further into swamps, resin into jungle, coal into band 2', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    const cols = 10, rows = 3;
    // the beacon's hex at `danger`, on `ground`; what each fuel lights there
    const lit = (fuel, danger, ground) => {
      const field = new Float64Array(cols * rows), kind = new Uint8Array(cols * rows);
      field[3 + cols] = danger;
      kind[3 + cols] = ground;
      const f = Fire.FUELS[fuel];
      const res = Fire.compute({
        cols, rows, field, kind, hills: () => false, open: () => true,
        hearths: [{ at: [0, 1], out: 40, share: true, cap: f.cap, holds: f.holds || 0, wet: f.wet }],
        beacons: [[3, 1]], beacon: Fire.BEACONS.B8,
      });
      return res.nodes[1].s >= Fire.LIT_MIN;
    };
    const out = {};
    for (const fuel of ['tallow', 'charcoal', 'peat', 'resin', 'coal']) {
      out[fuel] = [lit(fuel, 3, 0), lit(fuel, 5, Fire.SWAMP), lit(fuel, 5.8, Fire.JUNGLE), lit(fuel, 5.8, 0)];
    }
    return out;
  });
  // [band 1 at 3, swamp at 5, jungle at 5.8, open ground at 5.8]
  expect(r.tallow).toEqual([false, false, false, false]);
  expect(r.charcoal).toEqual([true, false, false, false]);
  expect(r.peat).toEqual([true, true, false, false]);
  expect(r.resin).toEqual([true, false, true, false]);
  expect(r.coal).toEqual([true, true, true, true]);
  expect(errors).toEqual([]);
});

test('the charcoal stranger: the old chimney (H5), the stranger, the old pits on a trek, the burning pits (F5)', async ({ page }) => {
  const errors = await flameTown(page);
  const at = await page.evaluate(() => {
    const at = secondCity();
    $SM.set('game.network.story["the charcoal stranger"]', 'city2');
    Network._nextAsk = 0;
    Network.checkStory();
    return at;
  });
  await expect(page.locator('#event')).toContainText('under it, a hearth. above it, a chimney, still standing.');
  await choose(page, 'rebuild the chimney');
  await expect(page.locator('#event')).toContainText('the fire draws hard.');
  await choose(page, 'good');
  await closed(page);
  const h5 = await page.evaluate(() => ({ H5: Network.has('H5'), way: $SM.get('game.network.story.oldChimney'), shares: Network.shares('city2'),
    wait: $SM.get('game.network.story.strangerTicks') }));
  expect(h5).toEqual({ H5: true, way: 'rebuild', shares: true, wait: 30 });

  // a while later, the stranger; left be, they come back once more
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) Network.flameTick();
    Network._nextAsk = 0;
    Network.checkStory();
  });
  await expect(page.locator('#event')).toContainText('says they never left.');
  await choose(page, 'leave them be');
  await choose(page, 'go back');
  await closed(page);
  expect(await page.evaluate(() => { Network._nextAsk = 0; Network.checkStory(); return !!Events.activeEvent(); })).toBe(false);
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) Network.flameTick();
    Network._nextAsk = 0;
    Network.checkStory();
  });
  await choose(page, 'sit with them');
  await expect(page.locator('#event')).toContainText('scratches a mark in the ash.');
  await choose(page, 'go back');
  await closed(page);
  const pits = await page.evaluate((at) => {
    const p = $SM.get('game.network.pits');
    return { p, d: Fire.distance(p, at), glyph: World.hexGlyph(p[0], p[1], World.hex.map)[0], seen: World.hex.mask[p[0]][p[1]],
      label: World.hexLabel(p[0], p[1], { map: World.hex.map, mask: World.hex.mask }), beacon: Network.canBeacon(p[0], p[1]) };
  }, at);
  expect(pits.d).toBeGreaterThanOrEqual(3);
  expect(pits.glyph).toBe('o');
  expect(pits.seen).toBe(true);
  expect(pits.label).toBe('the&nbsp;old&nbsp;pits');
  expect(pits.beacon).toBe(false);

  // out on a trek to the pits: take what's there, and home
  await page.locator('#location_path').click();
  await page.evaluate((p) => { embark(); stepOnto(p); }, pits.p);
  await expect(page.locator('#event')).toContainText('something has made a den in the largest.');
  await choose(page, "take what's here");
  await expect(page.locator('#event')).toContainText('the stranger will want to know the pit is still there.');
  await choose(page, 'go on');
  await closed(page);
  expect(await page.evaluate(() => Network.flag('pitsFound'))).toBe(false); // the trek's, until it is home
  await page.evaluate(() => World.goHome());
  await expect(page.locator('#event')).toContainText('says three days. no more air than a breath.', { timeout: 5000 });
  await choose(page, 'learn it your own way');
  await expect(page.locator('#event')).toContainText('but it comes out in a day.');
  await choose(page, 'good');
  const f5 = await page.evaluate(() => ({
    F5: Network.has('F5'), way: $SM.get('game.network.story.charcoalWay'), collier: City.income('collier'),
    pits: City.Buildings['charcoal pits'].needs, pitsGone: Network.isPits(...$SM.get('game.network.pits')),
  }));
  expect(f5.F5).toBe(true);
  expect(f5.way).toBe('own');
  expect(f5.collier).toMatchObject({ delay: 10, stores: { wood: -3, charcoal: 1 } });
  expect(f5.pitsGone).toBe(false);
  // the coda, a while after
  const coda = await page.evaluate(() => {
    for (let i = 0; i < 30; i++) Network.flameTick();
    return { coda: Network.flag('coda'), said: $('#notifications').text() };
  });
  expect(coda.coda).toBe(true);
  expect(coda.said).toContain('the stranger has taken a place at the pits.');
  expect(errors).toEqual([]);
});

test('the stranger left be twice comes back after 30 minutes, every time; the old pits cleared by force give more charcoal', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['H5']) });
  await page.evaluate(() => {
    secondCity();
    $SM.setM('game.network.story', { 'the charcoal stranger': 'city2', oldChimney: 'new', strangerAsked: 1, strangerTicks: 0 });
    Network._nextAsk = 0;
    Network.checkStory();
  });
  await choose(page, 'leave them be');
  await choose(page, 'go back');
  await closed(page);
  const r = await page.evaluate(() => {
    const out = { ticks: $SM.get('game.network.story.strangerTicks'), asked: $SM.get('game.network.story.strangerAsked') };
    for (let i = 0; i < 179; i++) Network.flameTick();
    out.early = !!Network.flameStory();
    Network.flameTick();
    out.back = Network.flameStory() && Network.flameStory().title;
    return out;
  });
  expect(r).toEqual({ ticks: 180, asked: 2, early: false, back: 'A Stranger in the Ruins' });
  const scene = await page.evaluate(() => {
    const s = Events.Flame.pits().scenes;
    return { fight: s.fight.combat, enemy: s.fight.enemyName, cleared: s.cleared.loot.charcoal, took: s.took.loot.charcoal };
  });
  expect(scene.fight).toBe(true);
  expect(scene.enemy).toBe('man-eater');
  expect(scene.cleared.min).toBeGreaterThan(scene.took.max);
  expect(errors).toEqual([]);
});

test('the city-states\' beats (Phase 4): without them F6, F7, B8 and H6 stay locked; with them they come in ladder order', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['F5', 'H5']) });
  const r = await page.evaluate(() => {
    $SM.set('game.population', 40); // under the second tier: no bread oven yet
    const has = () => ['F6', 'F7', 'B8', 'H6'].filter((id) => Network.has(id));
    Network.checkUnlocks();
    const none = has();
    $SM.set('game.citystates', { beats: { F7: 'cs2', B8: 'cs1', H6: 'cs3' } });
    const noF6 = has(); // resin waits for peat, the marsh lantern for the ford light
    $SM.set('game.citystates.beats.F6', 'cs1');
    const all = has();
    const store = { clay: Network.hearthStore('capital') };
    $SM.set('game.citystates.beats.H6build', 'stone');
    store.stone = Network.hearthStore('capital');
    return { none, noF6, all, store };
  });
  expect(r.none).toEqual([]);
  expect(r.noF6).toEqual(['H6']);
  expect(r.all).toEqual(['F6', 'F7', 'H6']);
  expect(r.store).toEqual({ clay: 160, stone: 80 });
  expect(errors).toEqual([]);
});

test('peat cut deep: twice the peat, and a bog cut wears out, then rests', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['F5', 'F6']) });
  const r = await page.evaluate(() => {
    const g = World.hex.gen;
    let bog = null;
    for (let x = 0; x < g.cols && !bog; x++) for (let y = 0; y < g.rows && !bog; y++) if (g.terrain[x][y] === WorldGen.TERRAIN.swamp) bog = [x, y];
    const d = {};
    d[bog.join(',')] = 'bog cuts';
    City.createCity('city3', 'third town', { hex: [bog[0] + 1, bog[1]], districts: d, citizens: 8, parent: 'capital' });
    $SM.set('game.cities.city3.workers', { 'peat cutter': 4 });
    $SM.set('game.citystates', { beats: { F6: 'cs1', F6way: 'their' } });
    const their = City.income('peat cutter').stores.peat;
    $SM.set('game.citystates.beats.F6way', 'deep');
    const deep = City.income('peat cutter').stores.peat;
    const slots0 = City.jobSlots('city3', 'peat cutter');
    for (let i = 0; i < 250; i++) Network.wearBogs();
    const spent = { slots: City.jobSlots('city3', 'peat cutter'), cutters: $SM.get('game.cities.city3.workers["peat cutter"]') };
    for (let i = 0; i < 500; i++) Network.wearBogs();
    return { their, deep, slots0, spent, rested: City.jobSlots('city3', 'peat cutter') };
  });
  expect(r.their).toBe(1);
  expect(r.deep).toBe(2);
  expect(r.slots0).toBe(4);
  expect(r.spent).toEqual({ slots: 0, cutters: 0 });
  expect(r.rested).toBe(4);
  expect(errors).toEqual([]);
});

test('B5: a fight won by a lit waystation, home alive, raises the watchtower', async ({ page }) => {
  const errors = await flameTown(page);
  await page.locator('#location_path').click();
  const r = await page.evaluate(() => {
    embark();
    const cap = World.hex.gen.capital, w = WorldGen.neighbour(cap[0], cap[1], 0);
    World.state.map[w[0]][w[1]] = World.TILE.OUTPOST; // a waystation in the capital's light
    World.curPos = WorldGen.neighbour(w[0], w[1], 0);
    Network.onFightWon();
    const out = { trek: !!World.state.towerHeld, before: Network.has('B5') };
    World.goHome();
    return { ...out, after: Network.has('B5') };
  });
  expect(r).toEqual({ trek: true, before: false, after: true });
  expect(errors).toEqual([]);
});

test('B6: a founded city lays a road home; the road joins two cities, and carts carry goods along it, lit, in time', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['B5']) });
  await page.locator('#location_path').click();
  const r = await page.evaluate(() => {
    const at = blankSite();
    Network.sendSettlers('capital', at[0], at[1]);
    embark();
    stepOnto(at);
    Network.refresh();
    const roads = [];
    for (let x = 0; x < World.hex.gen.cols; x++) for (let y = 0; y < World.hex.gen.rows; y++) if (World.hex.map[x][y] === World.TILE.ROAD) roads.push([x, y]);
    return { at, roads: roads.length, joined: Network.joinedTo('capital'), B6: Network.has('B6') };
  });
  expect(r.joined).toEqual(['city2']);
  expect(r.B6).toBe(true);
  // the town panel: a cart of wood from the capital to the second town
  await page.locator('#location_city').click();
  await page.evaluate(() => Network.draw());
  await page.locator('#land_road_city2').click();
  await expect(page.locator('#event')).toContainText('carts stand ready on the road to second town.');
  // the event's mask covers the whole land view, its lower edge too (it was a fixed 700px tall)
  await page.setViewportSize({ width: 1100, height: 1080 });
  const masked = await page.evaluate(() => {
    const r = $('#landMap canvas')[0].getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 5, r.bottom - 5);
    // the footer menu stays over the mask, usable mid-event as before
    const m = $('.menu span').last()[0].getBoundingClientRect(), menu = document.elementFromPoint(m.left + 2, m.top + m.height / 2);
    return { below700: r.bottom > 715, mask: !!hit && hit.closest('#event') !== null, menu: !!menu && !!menu.closest('.menu') };
  });
  expect(masked).toEqual({ below700: true, mask: true, menu: true });
  const before = await page.evaluate(() => ({ cap: $SM.get('stores.wood'), c2: $SM.get('game.cities.city2.stores.wood') || 0 }));
  await choose(page, 'send wood');
  // the cart is on its way: a second a road hex (provisional)
  const out = await page.evaluate(() => ({ cap: $SM.get('stores.wood'), c2: $SM.get('game.cities.city2.stores.wood') || 0,
    carts: $SM.get('game.network.carts').length, steps: Network.litRoad('capital', 'city2') }));
  expect(out.cap).toBe(before.cap - 100);
  expect(out.c2).toBe(before.c2);
  expect(out.carts).toBe(1);
  expect(out.steps).toBeGreaterThan(0);
  await page.waitForFunction((want) => $SM.get('game.cities.city2.stores.wood') === want, before.c2 + 100, { timeout: out.steps * 1000 + 5000 });
  expect(await page.evaluate(() => $SM.get('game.network.carts'))).toEqual([]);
  // no road, no carts; a road gone dark, no carts either
  const dark = await page.evaluate(() => {
    const none = Network.sendCart('capital', 'nowhere', 'wood');
    const g = World.hex.gen, fire = World.hex.fire;
    for (let x = 0; x < g.cols; x++) for (let y = 0; y < g.rows; y++) if (World.hex.map[x][y] === World.TILE.ROAD) fire.lit[x + y * g.cols] = 0;
    return { none, to: Network.cartsTo('capital'), sent: Network.sendCart('capital', 'city2', 'wood') };
  });
  expect(dark).toEqual({ none: 0, to: [], sent: 0 });
  expect(errors).toEqual([]);
});

test('B7: two lit nodes a hop apart across lake water bring the ford light', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['B5', 'B6']) });
  const r = await page.evaluate(() => {
    const cols = World.hex.gen.cols, kind = new Uint8Array(cols * World.hex.gen.rows);
    kind[11 + 10 * cols] = kind[12 + 10 * cols] = Fire.LAKE;
    const net = { kind, open: (x, y) => !(kind[x + y * cols] & Fire.LAKE) };
    const dry = { nodes: [{ at: [10, 10], s: 20 }, { at: [13, 10], s: 0.5 }] };
    Network.facing(net, dry);
    const dark = !!Network._facing;
    Network.facing(net, { nodes: [{ at: [10, 10], s: 20 }, { at: [13, 10], s: 5 }] });
    Network.checkUnlocks();
    return { dark, B7: Network.has('B7') };
  });
  expect(r).toEqual({ dark: false, B7: true });
  expect(errors).toEqual([]);
});

test('H7 and H8: a city of 64 brings the bread oven, whose fire grows with its people; F8 from the power, then the first coal burned', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['F5', 'F6', 'F7', 'H5', 'H6']) });
  const r = await page.evaluate(() => {
    $SM.set('game.population', 60);
    $SM.remove('game.network.tiers.H7'); // the test's town opened with 80 people
    secondCity(16);
    Network.checkUnlocks();
    const at60 = Network.has('H7');
    $SM.set('game.population', 64);
    Network.checkUnlocks();
    const out = { capital: Network.hearthOut('capital'), city2: Network.hearthOut('city2') };
    const f8 = { before: Network.has('F8'), call: Fire.unlock('F8'), after: Network.has('F8') };
    $SM.set('stores.coal', 100);
    burnTick();
    return { at60, H7: Network.has('H7'), out, f8, fuel: $SM.get('game.cities.capital.hearth.fuel'), H8: Network.has('H8') };
  });
  expect(r.at60).toBe(false);
  expect(r.H7).toBe(true);
  // 40 fire; the capital's 64 people (twice HEARTH_PEOPLE) double it, the second town's 16 halve it
  expect(r.out).toEqual({ capital: 80, city2: 20 });
  expect(r.f8).toEqual({ before: false, call: true, after: true });
  expect(r.fuel).toBe('coal');
  expect(r.H8).toBe(true);
  expect(errors).toEqual([]);
});

test('the garrison of the deep mines: smoke in the hills, the site marked, the gate on a trek; a beacon at the gate', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['F5', 'F6', 'F7', 'B5', 'B6', 'B7', 'B8', 'H5', 'H6', 'H7']) });
  await page.evaluate(() => {
    Network._smoke = true; // a lit hex near band 2 hills (Network.seeSmoke)
    Network._nextAsk = 0;
    Network.checkStory();
  });
  await expect(page.locator('#event')).toContainText('standing watch over a hole in the hill.');
  await choose(page, 'go and look');
  await expect(page.locator('#event')).toContainText('the site is marked on the map.');
  await choose(page, 'go back');
  const site = await page.evaluate(() => {
    const g = $SM.get('game.network.garrison'), s = World.siteAt(g[0], g[1]);
    return { g, kind: s.kind, seen: s.hexes.every((h) => World.hex.mask[h[0]][h[1]]),
      label: World.hexLabel(g[0], g[1], { map: World.hex.map, mask: World.hex.mask }) };
  });
  expect(site.kind).toBe('complex');
  expect(site.seen).toBe(true);
  expect(site.label).toBe('the&nbsp;garrison&nbsp;of&nbsp;the&nbsp;deep&nbsp;mines');

  await page.locator('#location_path').click();
  await page.evaluate((g) => { embark(); stepOnto(g); }, site.g);
  await expect(page.locator('#event')).toContainText('asks whose order you march under.');
  await choose(page, 'show them the fire');
  await expect(page.locator('#event')).toContainText('says the war needed fire too.');
  await choose(page, 'go on');
  const r = await page.evaluate((g) => {
    World.goHome();
    const s = World.siteAt(g[0], g[1]), cols = World.hex.gen.cols;
    const before = Network.gateLit();
    // a lit beacon just outside the site (a stand-in for a line that reaches it)
    const p = District.neighbours(s.hexes[0]).find((q) => World.siteAt(q[0], q[1]) !== s);
    $SM.set('game.network.beacons["' + p.join(',') + '"]', true);
    World.hex.fire.lit[p[0] + p[1] * cols] = 1;
    return { met: Network.flag('gateMet'), label: Network.hexNote(g[0], g[1]), before, after: Network.gateLit(), F8: Network.has('F8') };
  }, site.g);
  expect(r.met).toBe(true);
  expect(r.label).toContain('the&nbsp;shafts&nbsp;go&nbsp;down&nbsp;into&nbsp;the&nbsp;dark.');
  expect(r.before).toBe(false);
  expect(r.after).toBe(true);
  expect(r.F8).toBe(false); // the light doesn't win it: the siege is Phase 6's
  expect(errors).toEqual([]);
});

test('coal: mines on a coal seam, and once the garrison is broken on the hills by its deep mines', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(['F5', 'F6', 'F7', 'F8']) });
  const r = await page.evaluate(() => {
    const gen = World.hex.gen, g = Network.garrison(), s = World.siteAt(g[0], g[1]);
    let hill = null;
    s.hexes.forEach((h) => District.neighbours(h).forEach((p) => {
      if (!hill && World.siteAt(p[0], p[1]) !== s) hill = p;
    }));
    gen.terrain[hill[0]][hill[1]] = WorldGen.TERRAIN.hills; // the test makes sure it is hills
    const before = Network.coalAt(hill[0], hill[1]);
    Fire.unlock('F8');
    const after = Network.coalAt(hill[0], hill[1]);
    const ground = Network.ground('capital', hill[0], hill[1]);
    return { before, after, slots: District.TYPES.mines.jobs['coal miner'](ground), deposit: gen.deposits.filter((d) => d.kind === 'coal').every((d) => Network.coalAt(d.at[0], d.at[1])) };
  });
  expect(r).toEqual({ before: false, after: true, slots: 4, deposit: true });
  expect(errors).toEqual([]);
});

test('a v2.3 save loads with the flame era in: no flame tier, no errors, the fire tick runs', async ({ page }) => {
  const errors = await openGame(page, { save: load('v2.3-fire') });
  const r = await page.evaluate(() => {
    clearTimeout(Network._tickTimeout);
    Network.tick();
    return { flame: Object.keys(Network.tiers()).filter((id) => Fire.tier(id).era === 'flame'), lit: World.hex.fire.lit.reduce((a, b) => a + b, 0) };
  });
  expect(r.flame).toEqual([]);
  expect(r.lit).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a governor never starves its growth: with no room left it saves for a house, ahead of its focus', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    const view = (citizens, room, wood) => ({
      focus: 'fire', citizens, room, jobs: {}, stores: { wood }, fuels: { wood: 1 }, need: 10, cold: false,
      builds: [{ key: 'tallow vats', cost: { wood: 150 }, have: 0 }, { key: 'house', cost: { wood: 350 }, have: 2 }],
    });
    return {
      full: Governor.plan(view(8, 8, 200)).build,    // can't afford the house: builds nothing else
      fullRich: Governor.plan(view(8, 8, 400)).build, // a house, past the reserve (30)
      reserve: Governor.plan(view(8, 8, 360)).build,  // a house would eat the reserve: nothing
      room: Governor.plan(view(6, 8, 200)).build,     // room left: the focus's order
    };
  });
  expect(r).toEqual({ full: null, fullRich: 'house', reserve: null, room: 'tallow vats' });
  expect(errors).toEqual([]);
});
