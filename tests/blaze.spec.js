// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { openGame, flameTown, EMBER, choose } from './helpers.js';

const FLAME = ['F5', 'F6', 'F7', 'F8', 'B5', 'B6', 'B7', 'B8', 'H5', 'H6', 'H7', 'H8'];
// the event closes (it fades out before Events.activeEvent clears)
const closed = (page) => page.waitForFunction(() => !Events.activeEvent());
const ask = (page) => page.evaluate(() => { Network._nextAsk = 0; Network.checkStory(); });

test('the blaze era is wired: tiers 9-12 of every ladder have a beat, numbers and a line; the old fire is not yet', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => ({
    tiers: Fire.TIERS.filter((t) => t.era === 'blaze').map((t) => ({ id: t.id, when: t.when, hook: typeof Network.UNLOCKS[t.when], line: !!Events.Blaze.TEXT.tiers[t.id] })),
    old: Fire.TIERS.filter((t) => t.era === 'old fire').every((t) => t.when === null),
    fuels: Object.keys(Fire.FUELS).map((k) => Fire.FUELS[k].tier).slice(8),
    beacons: Object.keys(Fire.BEACONS).slice(8), hearths: Object.keys(Fire.HEARTHS).slice(8),
    // the powers' hooks (POWERS §2): F10 the riders, B10 the wardens, H11 the foundry, B12 the fleet
    hooks: ['F10', 'B10', 'H11', 'B12', 'F13'].map((id) => Fire.unlock(id)),
    flags: ['ridersBroken', 'passHeld', 'foundryTaken', 'fleetBroken'].map((k) => Network.flag(k)),
  }));
  for (const t of r.tiers) expect(t).toMatchObject({ hook: 'function', line: true });
  expect(r.old).toBe(true);
  expect(r.fuels).toEqual(['F9', 'F10', 'F11', 'F12']);
  expect(r.beacons).toEqual(['B9', 'B10', 'B11', 'B12']);
  expect(r.hearths).toEqual(['H9', 'H10', 'H11', 'H12']);
  expect(r.hooks).toEqual([true, true, true, true, false]);
  expect(r.flags).toEqual([true, true, true, true]);
  // no tier came in: each still waits for the ones before it on its ladder
  expect(await page.evaluate(() => ['F10', 'B10', 'H11', 'B12'].some((id) => Network.has(id)))).toBe(false);
  expect(errors).toEqual([]);
});

test('lines: held ground lets a blaze fuel reach further; mirrors keep more on open ground, a pass loses nothing, the lighthouse crosses an inland sea, the heliograph links 5 apart', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    const cols = 20, rows = 5, k = (x, y) => x + y * cols;
    const run = (beacon, kind, opts = {}) => {
      const field = new Float64Array(cols * rows).fill(opts.danger || 0), water = opts.water || [];
      const res = Fire.compute({
        cols, rows, field, kind, hills: () => false,
        open: (x, y) => !water.some((w) => w[0] === x && w[1] === y),
        hearths: [{ at: [0, 2], out: 40, share: true, cap: opts.cap || 10, holds: opts.holds || 0, wet: opts.wet || 0 }],
        beacons: opts.beacons || [[3, 2], [6, 2]], beacon: Fire.BEACONS[beacon],
      });
      return res.nodes.map((n) => Math.round(n.s * 100) / 100);
    };
    const bits = (b, hexes) => { const a = new Uint16Array(cols * rows); hexes.forEach((h) => { a[k(h[0], h[1])] = b; }); return a; };
    const mid = [[1, 2], [2, 2], [4, 2], [5, 2]];
    const coke = Fire.FUELS.coke;
    return {
      // danger 7 everywhere: coal (cap 6) is dark; coke holds hills to 7.25
      hillsCoke: run('B8', bits(Fire.HILLS, mid.concat([[3, 2], [6, 2]])), { danger: 7, cap: coke.cap, holds: coke.holds, wet: coke.wet }),
      flatCoke: run('B8', bits(0, []), { danger: 7, cap: coke.cap, holds: coke.holds, wet: coke.wet }),
      plainB8: run('B8', bits(Fire.PLAIN, mid)), plainB9: run('B9', bits(Fire.PLAIN, mid)),
      passB9: run('B9', bits(Fire.PASS, [[2, 2]])), passB10: run('B10', bits(Fire.PASS, [[2, 2]])),
      seaB10: run('B10', bits(Fire.SEA, [[1, 2], [2, 2]]), { water: [[1, 2], [2, 2]] }),
      seaB11: run('B11', bits(Fire.SEA, [[1, 2], [2, 2]]), { water: [[1, 2], [2, 2]] }),
      hopB11: run('B11', bits(0, []), { beacons: [[5, 2], [10, 2]] }),
      hopB12: run('B12', bits(0, []), { beacons: [[5, 2], [10, 2]] }),
    };
  });
  expect(r.hillsCoke).toEqual([40, 30, 22.5]);
  expect(r.flatCoke).toEqual([40, 0, 0]);
  expect(r.plainB8).toEqual([40, 30, 22.5]);
  expect(r.plainB9).toEqual([40, 34, 28.9]);
  expect(r.passB9).toEqual([40, 30, 22.5]);
  expect(r.passB10).toEqual([40, 40, 30]); // the first hop goes through the pass
  expect(r.seaB10).toEqual([40, 0, 0]);
  expect(r.seaB11).toEqual([40, 30, 22.5]);
  expect(r.hopB11).toEqual([40, 0, 0]);
  expect(r.hopB12).toEqual([40, 32, 25.6]);
  expect(errors).toEqual([]);
});

test('hearths: the bloomery boosts the low fuels, the furnace burns half again for its fire, the boiler halves a beacon\'s upkeep', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME) });
  const r = await page.evaluate(() => {
    const per = (h, f) => Fire.perUnit(Fire.HEARTHS[h], f);
    const need = (h) => {
      $SM.set('game.network.tiers.' + h, true);
      $SM.set('game.cities.capital.hearth.fed', 10, true);
      return Network.hearthNeed('capital') - Network.hearthOut('capital');
    };
    return {
      wood: ['H8', 'H9', 'H11'].map((h) => per(h, 'wood')), coal: ['H8', 'H9', 'H11'].map((h) => per(h, 'coal')),
      upkeep: [need('H9'), need('H10'), need('H11'), need('H12')],
    };
  });
  expect(r.wood).toEqual([1, 1.5, 1]);
  expect(r.coal).toEqual([10, 10, 10 / 1.5]);
  expect(r.upkeep).toEqual([10, 10, 10, 5]);
  expect(errors).toEqual([]);
});

test('the city-states\' and the powers\' beats: F9 and B9 from Phase 4; F10 needs the oath and the riders broken; B10, H11 from the powers; H10 at 128 people', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME) });
  const r = await page.evaluate(() => {
    const has = () => ['F9', 'F10', 'B9', 'B10', 'H9', 'H10', 'H11'].filter((id) => Network.has(id));
    $SM.set('game.citystates.beats.F9', 'cs1');
    $SM.set('game.citystates.beats.B9', 'cs2');
    $SM.set('game.citystates.beats.F10', 'cs3');
    const phase4 = has();
    Fire.unlock('F10');
    const riders = has();
    Fire.unlock('B10');
    Fire.unlock('H11'); // waits: H9 and H10 aren't in
    const powers = has();
    Network.setFlag('bloomery');
    $SM.set('game.population', 128);
    Network.checkUnlocks();
    return { phase4, riders, powers, all: has() };
  });
  expect(r.phase4).toEqual(['F9', 'B9']);
  expect(r.riders).toEqual(['F9', 'F10', 'B9']);
  expect(r.powers).toEqual(['F9', 'F10', 'B9', 'B10']);
  expect(r.all).toEqual(['F9', 'F10', 'B9', 'B10', 'H9', 'H10', 'H11']);
  expect(errors).toEqual([]);
});

test('the drowned harbour: a coastal fallen city resettled (not the first), its lighthouse (B11), a harbour and its boats relaunched (F11), whalers and try-works', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['F9', 'F10', 'B9', 'B10']) });
  const r = await page.evaluate(() => {
    const g = World.hex.gen;
    const site = g.sites.find((s) => s.kind === 'fallenCity' && Network.coastal(s));
    const other = g.sites.find((s) => s.kind === 'fallenCity' && s !== site);
    const make = (id, s) => {
      const d = {};
      d[s.anchor.join(',')] = 'hearth quarter';
      City.createCity(id, id, { hex: s.anchor, districts: d, stores: { wood: 2000 }, citizens: 16, parent: 'capital' });
      Network.resettleStory(id, s);
    };
    // the first resettled is the charcoal stranger's, whether or not it is on the water
    make('city2', site);
    const first = $SM.get('game.network.story["the drowned harbour"]') || null;
    $SM.remove('game.network.story["the charcoal stranger"]');
    make('city3', other);
    $SM.set('game.network.story.resettled', 1);
    make('city4', site);
    Network.refresh();
    return { first, harbour: $SM.get('game.network.story["the drowned harbour"]'), at: site.anchor };
  });
  expect(r.first).toBe(null);
  expect(r.harbour).toBe('city4');
  await ask(page);
  await expect(page.locator('#event')).toContainText('a lighthouse stands at the end of the mole');
  await choose(page, 'light the lamp');
  await choose(page, 'good');
  await closed(page);
  expect(await page.evaluate(() => ({ B11: Network.has('B11'), sea: !!Fire.BEACONS[Network.beaconTier()].sea }))).toEqual({ B11: true, sea: true });
  // no boats without a harbour district; then the boats, paid from the capital
  await ask(page);
  expect(await page.evaluate(() => !!Events.activeEvent())).toBe(false);
  const placed = await page.evaluate(() => {
    const c = $SM.get('game.cities.city4'), g = World.hex.gen;
    for (const p of District.neighbours(c.hex)) {
      if (Network.districtAt(p[0], p[1])) continue;
      const gr = Network.ground('city4', p[0], p[1]);
      if (District.TYPES.harbour.fits(gr)) {
        $SM.set('game.cities.city4.districts["' + p.join(',') + '"]', 'harbour');
        return p;
      }
    }
    return null;
  });
  expect(placed).not.toBe(null);
  await page.evaluate(() => $SM.setM('stores', { wood: 1000, cloth: 50 }));
  await ask(page);
  await expect(page.locator('#event')).toContainText('their hulls are sound.');
  await choose(page, 'relaunch them');
  await choose(page, 'good');
  await closed(page);
  const f11 = await page.evaluate(() => ({
    F11: Network.has('F11'), cloth: $SM.get('stores.cloth'), whalers: City.jobSlots('city4', 'whaler'),
    tryWorks: City.maximum('try-works', 'city4'), said: $('#notifications').text(),
  }));
  expect(f11.F11).toBe(true);
  expect(f11.cloth).toBe(30);
  expect(f11.whalers).toBeGreaterThan(0);
  expect(f11.tryWorks).toBe(1);
  expect(f11.said).toContain('whale oil burns long and bright.');
  expect(errors).toEqual([]);
});

test('the black well: found on a trek, its pumps pieced together at home (F12); a well-hand on the old-world works; the first rock oil brings the boiler-wrights (H12)', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['F9', 'F10', 'F11', 'B9', 'B10', 'B11', 'H9', 'H10', 'H11']) });
  const well = await page.evaluate(() => {
    const at = secondCity(), g = World.hex.gen;
    // the drifters' well, as CityStates.markWell leaves it: a hex next to the second town
    const w = District.neighbours(at).find((p) => !Network.districtAt(p[0], p[1]) && District.land(Network.ground(null, p[0], p[1])) &&
      WorldGen.isPassable(World.hex.map[p[0]][p[1]]) && !World.siteAt(p[0], p[1]));
    $SM.set('game.citystates.beats["the black well"]', 'cs9');
    $SM.set('game.citystates.well', w);
    CityStates._well = w;
    return w;
  });
  await page.locator('#location_path').click();
  await page.evaluate((p) => { embark(); stepOnto(p); }, well);
  await expect(page.locator('#event')).toContainText('an iron cap sits in the middle of it.');
  await choose(page, 'look closer');
  await choose(page, 'go back');
  await closed(page);
  expect(await page.evaluate(() => Network.flag('wellFound'))).toBe(false); // the trek's, until it is home
  await page.evaluate(() => { $SM.setM('stores', { steel: 60, leather: 30 }); World.goHome(); });
  await ask(page);
  await expect(page.locator('#event')).toContainText('a pump, a seal, a way to draw it up.');
  await choose(page, 'build the pumps');
  await choose(page, 'good');
  await closed(page);
  const f12 = await page.evaluate((w) => {
    const types = Network.districtsFor('city2', w[0], w[1]);
    Network.placeDistrict('city2', w[0], w[1], 'old-world works');
    return { F12: Network.has('F12'), steel: $SM.get('stores.steel'), types, hands: City.jobSlots('city2', 'well-hand') };
  }, well);
  expect(f12).toMatchObject({ F12: true, steel: 10, hands: 4 });
  expect(f12.types).toContain('old-world works');
  // rock oil burned in a hearth: the boiler-wrights
  await page.evaluate(() => { $SM.set('stores["rock oil"]', 200); burnTick(); });
  expect(await page.evaluate(() => ({ fuel: $SM.get('game.cities.capital.hearth.fuel'), burned: Network.flag('rockOilBurned') })))
    .toEqual({ fuel: 'rock oil', burned: true });
  await ask(page);
  await expect(page.locator('#event')).toContainText('they say they built boilers once.');
  await choose(page, 'take them in');
  await choose(page, 'good');
  await closed(page);
  expect(await page.evaluate(() => ({ H12: Network.has('H12'), tier: Network.hearthTier() }))).toEqual({ H12: true, tier: 'H12' });
  expect(errors).toEqual([]);
});

test('the bloomery (H9): a forge district touching the forge-masters\' hearth; coke ovens and the coker turn coal into coke', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['F9']) });
  const r = await page.evaluate(() => {
    // the forge-masters joined: a city of ours where they stood (CityStates.join)
    const at = secondCity(16);
    $SM.set('game.citystates.beats.F9', 'cs4');
    $SM.set('game.citystates.cs.cs4', { city: 'city2' });
    const before = Network.forgeByMasters();
    const g = World.hex.gen, T = WorldGen.TERRAIN;
    const p = District.neighbours(at).find((q) => !Network.districtAt(q[0], q[1]));
    // forge ground (hills or barrens) under it, for the test
    g.terrain[p[0]][p[1]] = T.barrens;
    World.hex.map[p[0]][p[1]] = T.barrens;
    World.hex.mask[p[0]][p[1]] = true;
    const types = Network.districtsFor('city2', p[0], p[1]);
    $SM.set('stores.wood', 1000);
    $SM.set('game.cities.city2.stores.wood', 1000);
    Network.placeDistrict('city2', p[0], p[1], 'forge');
    return { before, types, after: Network.forgeByMasters(), ovens: City.maximum('coke ovens', 'city2'), coker: City._INCOME.coker.stores };
  });
  expect(r.before).toBe(false);
  expect(r.types).toContain('forge');
  expect(r.after).toBe(true);
  expect(r.ovens).toBe(2);
  expect(r.coker).toEqual({ coal: -3, coke: 2 });
  await ask(page);
  await expect(page.locator('#event')).toContainText('iron wants a closed fire, and a slow one.');
  await choose(page, 'go on');
  await choose(page, 'good');
  await closed(page);
  expect(await page.evaluate(() => Network.has('H9'))).toBe(true);
  expect(errors).toEqual([]);
});

test('the heliograph (B12): the mirror folk, the lighthouse and the fleet broken; then beacons link five hexes apart', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['B9', 'B10', 'B11']) });
  await page.evaluate(() => { $SM.set('game.citystates.beats.B9', 'cs2'); });
  await ask(page);
  expect(await page.evaluate(() => !!Events.activeEvent())).toBe(false); // the fleet still stands
  await page.evaluate(() => Fire.unlock('B12'));
  await ask(page);
  await expect(page.locator('#event')).toContainText('they show the keepers the mirrors.');
  await choose(page, 'go on');
  await choose(page, 'good');
  await closed(page);
  const r = await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    const far = Fire.ring(cap[0], cap[1], 5).filter((p) => { World.hex.mask[p[0]][p[1]] = true; return Network.canBeacon(p[0], p[1]); });
    return { B12: Network.has('B12'), tier: Network.beaconTier(), far: far.length };
  });
  expect(r).toMatchObject({ B12: true, tier: 'B12' });
  expect(r.far).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('tar pits: tar gatherers on desert, pitch boilers turn tar and wood into pitch; fumes slow tar pits beside huts', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    const T = District.TYPES['tar pits'];
    return {
      fits: [T.fits({ terrain: 'desert', at: [5, 5], terrainAt: () => 'desert' }), T.fits({ terrain: 'field', at: [5, 5], terrainAt: () => 'field' })],
      slots: T.jobs['tar gatherer'](), needs: T.needs, holds: T.holds,
      boiler: City._INCOME['pitch boiler'].stores, fumes: T.bonus,
    };
  });
  expect(r.fits).toEqual([true, false]);
  expect(r.slots).toBe(4);
  expect(r.needs).toBe('F10');
  expect(r.holds).toEqual(['pitch boilers']);
  expect(r.boiler).toEqual({ tar: -2, wood: -1, pitch: 1 });
  expect(r.fumes).toEqual([{ next: 'huts', job: '*', add: -0.2 }]);
  expect(errors).toEqual([]);
});

test('a v2.8 save loads as v2.9: a coastal fallen city it resettled after the first is the drowned harbour', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME) });
  const saved = await page.evaluate(() => {
    const g = World.hex.gen;
    const site = g.sites.find((s) => s.kind === 'fallenCity' && Network.coastal(s));
    const d = {};
    d[site.anchor.join(',')] = 'hearth quarter';
    City.createCity('city2', 'second town', { hex: site.anchor, districts: d, stores: {}, citizens: 8, parent: 'capital' });
    $SM.set('game.network.story.resettled', 2);
    $SM.set('game.network.story["the charcoal stranger"]', 'city9');
    Engine.saveGame();
    const s = JSON.parse(localStorage.gameState);
    s.version = 2.8;
    return s;
  });
  const page2 = await page.context().newPage();
  const after = await openGame(page2, { save: saved });
  const r = await page2.evaluate(() => ({ version: $SM.get('version'), harbour: $SM.get('game.network.story["the drowned harbour"]'), scan: Network.flag('harbourScan') }));
  expect(r).toEqual({ version: 2.9, harbour: 'city2', scan: false });
  expect(errors).toEqual([]);
  expect(after).toEqual([]);
});
