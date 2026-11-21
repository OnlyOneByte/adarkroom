// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { openGame, flameTown, EMBER, choose } from './helpers.js';

const FLAME = ['F5', 'F6', 'F7', 'F8', 'B5', 'B6', 'B7', 'B8', 'H5', 'H6', 'H7', 'H8'];
// the event closes (it fades out before Events.activeEvent clears)
const closed = (page) => page.waitForFunction(() => !Events.activeEvent());
const ask = (page) => page.evaluate(() => { Network._nextAsk = 0; Network.checkStory(); });

test('the blaze era is wired: tiers 9-12 of every ladder have a beat and numbers; the old fire is not yet', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => ({
    tiers: Fire.TIERS.filter((t) => t.era === 'blaze').map((t) => ({ id: t.id, when: t.when, hook: typeof Network.UNLOCKS[t.when] })),
    old: Fire.TIERS.filter((t) => t.era === 'old fire').every((t) => t.when === null),
    fuels: Object.keys(Fire.FUELS).map((k) => Fire.FUELS[k].tier).slice(8),
    beacons: Object.keys(Fire.BEACONS).slice(8), hearths: Object.keys(Fire.HEARTHS).slice(8),
    // the powers' hooks (POWERS §2): F10 the riders, B10 the wardens, H11 the foundry, B12 the fleet
    hooks: ['F10', 'B10', 'H11', 'B12', 'F13'].map((id) => Fire.unlock(id)),
    flags: ['ridersBroken', 'passHeld', 'foundryTaken', 'fleetBroken'].map((k) => Network.flag(k)),
  }));
  for (const t of r.tiers) expect(t).toMatchObject({ hook: 'function' });
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

test('the city-states\' and the powers\' beats: F9 and B9 from Phase 4; F10 from the oath or the riders broken, whichever is first; B10, H11 from the powers; H10 at 128 people', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME) });
  const r = await page.evaluate(() => {
    const has = () => ['F9', 'F10', 'B9', 'B10', 'H9', 'H10', 'H11'].filter((id) => Network.has(id));
    $SM.set('game.citystates.beats.F9', 'cs1');
    $SM.set('game.citystates.beats.B9', 'cs2');
    const phase4 = has();
    // the riders broken first: pitch; the oath after changes nothing
    Fire.unlock('F10');
    const riders = has();
    $SM.set('game.citystates.beats.F10', 'cs3');
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

test('the drowned harbour: seen on a trek and marked; resettled, the keepers (B11); a harbour district raises the boats, then the whales (F11)', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['F9', 'F10', 'B9', 'B10']) });
  const r = await page.evaluate(() => {
    const g = World.hex.gen, site = Network.harbourSite(), lit = Network.lineReach('pitch');
    const seaOf = (s) => s.hexes.some((h) => District.neighbours(h).some((p) => { const f = g.formationAt[p[0] + p[1] * g.cols]; return f >= 0 && g.formations[f].kind === 'sea'; }));
    const reach = (s) => !!lit[s.anchor[0] + s.anchor[1] * g.cols];
    // its centre on ground a pitch line lights; seed 4242's sea-shore fallen cities are all past it (danger 6.3+),
    // so it is the nearest on any water there; nearer ones on the water in reach: none
    const nearer = g.sites.filter((s) => s.kind === 'fallenCity' && s !== site && Fire.distance(s.anchor, g.capital) < Fire.distance(site.anchor, g.capital) &&
      reach(s) && Network.coastal(s));
    const seaInReach = g.sites.filter((s) => s.kind === 'fallenCity' && seaOf(s) && reach(s)).length;
    return { at: site.anchor, reach: reach(site), coastal: Network.coastal(site), nearer: nearer.length, seaInReach, kind: site.kind };
  });
  expect(r).toMatchObject({ reach: true, coastal: true, nearer: 0, seaInReach: 0, kind: 'fallenCity' });
  // on a trek, the site comes into sight
  await page.locator('#location_path').click();
  await page.evaluate((at) => { embark(); World.curPos = at.slice(); Network.onStep(at[0], at[1]); }, r.at);
  await expect(page.locator('#event')).toContainText('on the point, a tower. a light at the top of it, small and yellow.');
  await choose(page, 'go to the tower');
  await expect(page.locator('#event')).toContainText("when it comes back, it's aimed at you.");
  await choose(page, 'go back');
  await closed(page);
  const seen = await page.evaluate((at) => ({ flag: Network.flag('harbourSeen'), hover: Network.hexNote(at[0], at[1]) }), r.at);
  expect(seen).toEqual({ flag: true, hover: 'the&nbsp;drowned&nbsp;harbour.&nbsp;a&nbsp;light&nbsp;on&nbsp;the&nbsp;point.' });
  await page.evaluate(() => World.goHome());
  // resettled (made here directly; the charcoal stranger's city was the first): the keepers
  await page.evaluate((at) => {
    const site = World.siteAt(at[0], at[1]), d = {};
    $SM.set('game.network.story.resettled', 1);
    d[at.join(',')] = 'hearth quarter';
    City.createCity('city4', 'city4', { hex: at, districts: d, stores: { wood: 2000 }, citizens: 16, parent: 'capital' });
    Network.resettleStory('city4', site);
    Network.refresh();
  }, r.at);
  expect(await page.evaluate(() => $SM.get('game.network.story["the drowned harbour"]'))).toBe('city4');
  await ask(page);
  await expect(page.locator('#event')).toContainText("says they've kept the light since the water came. for the boats.");
  await choose(page, 'ask them to teach it');
  await expect(page.locator('#event')).toContainText('they come down at dawn, smelling of oil.');
  await choose(page, 'good');
  await closed(page);
  const b11 = await page.evaluate(() => ({ B11: Network.has('B11'), sea: !!Fire.BEACONS[Network.beaconTier()].sea, said: $('#notifications').text() }));
  expect(b11).toMatchObject({ B11: true, sea: true });
  expect(b11.said).toContain('the light on the point reaches across the water now.');
  // no boats without a harbour district; the district is the whole cost
  await ask(page);
  expect(await page.evaluate(() => !!Events.activeEvent())).toBe(false);
  const placed = await page.evaluate(() => {
    const c = $SM.get('game.cities.city4');
    for (const p of District.neighbours(c.hex)) {
      if (Network.districtAt(p[0], p[1])) continue;
      if (District.TYPES.harbour.fits(Network.ground('city4', p[0], p[1]))) {
        $SM.set('game.cities.city4.districts["' + p.join(',') + '"]', 'harbour');
        return p;
      }
    }
    return null;
  });
  expect(placed).not.toBe(null);
  const stores = await page.evaluate(() => JSON.stringify($SM.get('stores')));
  await ask(page);
  await expect(page.locator('#event')).toContainText('divers go down on ropes. one hull, then another.');
  await choose(page, 'go on');
  await expect(page.locator('#event')).toContainText('by spring there are three on the water.');
  await choose(page, 'good');
  await closed(page);
  await ask(page);
  await expect(page.locator('#event')).toContainText('they come back low in the water, towing something huge.');
  await choose(page, 'render it all');
  await expect(page.locator('#event')).toContainText("the oil burns clean. it doesn't stink, like tallow.");
  await choose(page, 'good');
  await closed(page);
  const f11 = await page.evaluate(() => ({
    F11: Network.has('F11'), stores: JSON.stringify($SM.get('stores')), whalers: City.jobSlots('city4', 'whaler'), tryWorks: City.maximum('try-works', 'city4'),
  }));
  expect(f11).toMatchObject({ F11: true, stores, tryWorks: 1 });
  expect(f11.whalers).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the black well: the stain on a trek (a rubbing), the missing plates at home, the plates fetched, the well opened (F12); a well-hand on the old-world works; the drifters joined are the wrights (H12)', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['F9', 'F10', 'F11', 'B9', 'B10', 'B11', 'H9', 'H10', 'H11']) });
  const well = await page.evaluate(() => {
    const at = secondCity();
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
  await expect(page.locator('#event')).toContainText('plates on the side, stamped with words. half of them sheared away.');
  await choose(page, 'take a rubbing of the plates');
  await expect(page.locator('#event')).toContainText('they tell how to open it. not how to keep it shut.');
  await choose(page, 'go on');
  await closed(page);
  expect(await page.evaluate(() => Network.flag('wellFound'))).toBe(false); // the trek's, until it is home
  await page.evaluate(() => World.goHome());
  await ask(page);
  await expect(page.locator('#event')).toContainText('says the rest of the plates went south with the crews.');
  await choose(page, 'ask what else her mother said');
  await expect(page.locator('#event')).toContainText('she says they were called wrights. no one now remembers why.');
  await choose(page, 'go on');
  await closed(page);
  const site = await page.evaluate((w) => {
    const s = Network.platesSite(), d = Fire.distance(s.anchor, w);
    return { sent: Network.flag('platesSent'), d, kind: s.kind, hover: CityStates.label(w[0], w[1]), hex: s.hexes[0] };
  }, well);
  expect(site.sent).toBe(true);
  expect(site.d).toBeGreaterThanOrEqual(6);
  expect(['fallenCity', 'crater']).toContain(site.kind);
  expect(site.hover).toBe('the&nbsp;black&nbsp;well.&nbsp;the&nbsp;ground&nbsp;here&nbsp;burns.');
  // a trek to the plates' site, then a fall: they lie where it fell
  await page.locator('#location_path').click();
  await page.evaluate((h) => { embark(); World.curPos = h.slice(); Network.onStep(h[0], h[1]); }, site.hex);
  expect(await page.evaluate(() => World.state.plates)).toBe(true);
  await page.evaluate(() => World.die());
  await page.waitForFunction(() => !World.state);
  expect(await page.evaluate(() => ({ said: $('#notifications').text().includes('the plates lie where the trek fell.'), held: Network.flag('plates') })))
    .toEqual({ said: true, held: false });
  // again, home with them, and out to the well
  await page.waitForFunction(() => !Engine.keyLock && Engine.activeModule !== World, null, { timeout: 15000 });
  await page.locator('#location_path').click();
  await page.evaluate((h) => { embark(); World.curPos = h.slice(); Network.onStep(h[0], h[1]); World.goHome(); }, site.hex);
  expect(await page.evaluate(() => Network.flag('plates'))).toBe(true);
  await page.locator('#location_path').click();
  await page.evaluate((p) => { embark(); stepOnto(p); }, well);
  await expect(page.locator('#event')).toContainText('the cap comes off with a sound like breath.');
  await choose(page, 'cap it again, half way');
  await expect(page.locator('#event')).toContainText('barrels fill one by one.');
  await choose(page, 'good');
  await closed(page);
  await page.evaluate(() => World.goHome());
  const f12 = await page.evaluate((w) => {
    const types = Network.districtsFor('city2', w[0], w[1]);
    Network.placeDistrict('city2', w[0], w[1], 'old-world works');
    return { F12: Network.has('F12'), types, hands: City.jobSlots('city2', 'well-hand'), plates: Network.flag('plates') };
  }, well);
  expect(f12).toMatchObject({ F12: true, hands: 4, plates: false });
  expect(f12.types).toContain('old-world works');
  // F12 in, but the drifters haven't joined: no wrights yet
  await ask(page);
  expect(await page.evaluate(() => !!Events.activeEvent())).toBe(false);
  await page.evaluate(() => $SM.set('game.citystates.cs.cs9', { city: 'city3' }));
  await ask(page);
  await expect(page.locator('#event')).toContainText("says she's a wright. says her mother was. says this is what they did.");
  await choose(page, 'help');
  await expect(page.locator('#event')).toContainText("it hums. it doesn't need feeding for a long time.");
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

test('the two lights (B12): the mirror folk and the harbour\'s keepers ours, and the fleet broken; then beacons link five hexes apart', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['B9', 'B10', 'B11']) });
  await page.evaluate(() => { $SM.set('game.citystates.beats.B9', 'cs2'); Network.setFlag('lighthouseLit'); });
  await ask(page);
  expect(await page.evaluate(() => !!Events.activeEvent())).toBe(false); // the fleet still stands
  await page.evaluate(() => Fire.unlock('B12'));
  await ask(page);
  await expect(page.locator('#event')).toContainText('the keeper says a light should turn. the woman says it should flash.');
  await choose(page, 'let them argue it out');
  await expect(page.locator('#event')).toContainText("on the fourth there's a mirror on the tower, turning, with a shutter.");
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

test('the powers\' single scenes: the pass held (B10), the furnace (H11); and coke opens the armoury\'s grenadier', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME, ['F9', 'B9', 'H9', 'H10']) });
  await page.evaluate(() => Fire.unlock('B10'));
  await ask(page);
  await expect(page.locator('#event')).toContainText('the beacon at the top is still burning. no one let it go out.');
  await choose(page, 'good');
  await closed(page);
  await page.evaluate(() => Fire.unlock('H11'));
  await ask(page);
  await expect(page.locator('#event')).toContainText("the crew's foremen show how it's fed: ore and coke and lime, all day, all night.");
  await choose(page, 'go on');
  await expect(page.locator('#event')).toContainText('the iron comes out of it running, like water.');
  await choose(page, 'good');
  await closed(page);
  const r = await page.evaluate(() => {
    $SM.set('game.buildings["armoury"]', 1);
    Outside.checkWorker('armoury');
    return { B10: Network.has('B10'), H11: Network.has('H11'), grenadier: $SM.get('game.workers["grenadier"]'), stores: Outside._INCOME.grenadier.stores };
  });
  expect(r).toEqual({ B10: true, H11: true, grenadier: 0, stores: { steel: -2, sulphur: -2, grenade: 1 } });
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

test('a v2.8 save loads as v2.9: a city it resettled on the drowned harbour\'s site is the drowned harbour', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME) });
  const saved = await page.evaluate(() => {
    const site = Network.harbourSite(), d = {};
    d[site.anchor.join(',')] = 'hearth quarter';
    City.createCity('city2', 'second town', { hex: site.anchor, districts: d, stores: {}, citizens: 8, parent: 'capital' });
    $SM.set('game.network.story.resettled', 2);
    $SM.set('game.network.story["the charcoal stranger"]', 'city9');
    $SM.remove('game.network.harbour');
    Engine.saveGame();
    const s = JSON.parse(localStorage.gameState);
    s.version = 2.8;
    return s;
  });
  const page2 = await page.context().newPage();
  const after = await openGame(page2, { save: saved });
  // the hex map comes up after the room: the scan runs on its first refresh
  await page2.waitForFunction(() => typeof Network != 'undefined' && World.hex && !Network.flag('harbourScan'));
  const r = await page2.evaluate(() => ({ version: $SM.get('version'), harbour: $SM.get('game.network.story["the drowned harbour"]'), scan: Network.flag('harbourScan') }));
  expect(r).toEqual({ version: 2.9, harbour: 'city2', scan: false });
  expect(errors).toEqual([]);
  expect(after).toEqual([]);
});

test('F10 by the other path: the tar-keepers\' oath alone brings pitch, once; the riders broken later changes nothing', async ({ page }) => {
  const errors = await flameTown(page, { tiers: EMBER.concat(FLAME) });
  const r = await page.evaluate(() => {
    $SM.set('game.citystates.beats.F9', 'cs1');
    $SM.set('game.citystates.beats.F10', 'cs3');
    const oath = Network.has('F10');
    Fire.unlock('F10');
    return { oath, after: Network.has('F10'), riders: Network.flag('ridersBroken') };
  });
  expect(r).toEqual({ oath: true, after: true, riders: true });
  expect(errors).toEqual([]);
});
