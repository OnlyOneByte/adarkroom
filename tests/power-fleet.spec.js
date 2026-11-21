// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { openGame, townWithCityStates, choose } from './helpers.js';

// every tier through the drowned harbour's chain (F11 whale oil, B11 lighthouse) and pitch (F10)
const TIERS = ['F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'H5', 'H6', 'H7', 'H8'];

// the ticks by hand (the fire, the city-states, the armies) and the trek helpers, on a loaded page; a trek
// packed through the outfitting buttons, as the player does (the bag never over-full)
const helpers = () => {
  clearTimeout(Events._eventTimeout);
  clearTimeout(Network._tickTimeout);
  clearTimeout(CityStates._tickTimeout);
  clearTimeout(Armies._tickTimeout);
  Network._nextAsk = Date.now() + 1e9; // no story scenes but the ones a test starts
  window.tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      Network.tick(); clearTimeout(Network._tickTimeout);
      CityStates.update();
      Armies.update();
    }
  };
  window.quiet = (fn) => {
    const play = CityStates.playQueued;
    CityStates.playQueued = () => {};
    try { fn(); } finally { CityStates.playQueued = play; CityStates._queue = []; }
  };
  window.embark = () => {
    Path.updateOutfitting();
    Path.increaseSupply.call($('#outfit_row_cured-meat .upBtn')[0], { data: 1000 });
    Path.embark();
    Math.random = () => 0.99; // no fights, and their blows miss the wanderer
  };
  // an inland sea's open water beside its shallows (where a trek could put out from), off the fleet
  window.seaHex = () => {
    const gen = World.hex.gen, T = WorldGen.TERRAIN;
    for (const f of gen.formations) {
      if (f.kind !== 'sea') continue;
      const h = f.hexes.find((p) => gen.terrain[p[0]][p[1]] === T.ocean && gen.siteAt[p[0] + p[1] * gen.cols] < 0 &&
        District.neighbours(p).some((n) => gen.terrain[n[0]][n[1]] === T.lake));
      if (h) return h;
    }
    return null;
  };
  // a step onto a hex from a neighbour the wanderer can stand on
  window.stepOnto = (p) => {
    for (let d = 0; d < 6; d++) {
      const n = WorldGen.neighbour(p[0], p[1], d);
      // (from off the site: a step within it is no arrival)
      if (!World.canEnter(World.state.map[n[0]][n[1]]) || (World.siteAt(p[0], p[1]) && World.siteAt(n[0], n[1]) === World.siteAt(p[0], p[1]))) continue;
      World.curPos = n.slice();
      World.move([p[0] - n[0], p[1] - n[1]]);
      return true;
    }
    return false;
  };
};

const toPath = async (page) => {
  if (!(await page.evaluate(() => Engine.activeModule === Path))) await page.locator('#location_path').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
};

const toTown = async (page) => {
  await page.locator('#location_city').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
};

// A save by the drowned fleet (seed 4242): the blaze era through F11 and B11, the drowned harbour resettled
// (its keepers, its boats raised, a harbour district), the fleet seen from the harbour's tower and its gate
// met; the harbour's town on military focus with 80 soldiers drilled and armed (60 bayonets, 20 rifles), and
// the boatyard's wood, cloth and pitch
async function fleetSave(page) {
  const errors = await townWithCityStates(page);
  await page.evaluate(helpers);
  const hb = await page.evaluate((TIERS) => {
    for (const t in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + t + '"]', true, true);
    TIERS.forEach((id) => $SM.set('game.network.tiers.' + id, true));
    const site = Network.harbourSite(), at = site.anchor, d = {};
    Network.markHarbour();
    $SM.set('game.network.story.resettled', 1);
    d[at.join(',')] = 'hearth quarter';
    City.createCity('city4', 'the drowned harbour', { hex: at, districts: d, stores: { wood: 5000, cloth: 500, pitch: 500, 'cured meat': 5000, bayonet: 60, rifle: 20, bullets: 200 }, citizens: 16, parent: 'capital' });
    Network.resettleStory('city4', site);
    $SM.setM('game.network.story', { lighthouseLit: true, boatsRaised: true, boatsRelaunched: true });
    for (const p of District.neighbours(at)) {
      if (!Network.districtAt(p[0], p[1]) && District.TYPES.harbour.fits(Network.ground('city4', p[0], p[1]))) {
        $SM.set('game.cities.city4.districts["' + p.join(',') + '"]', 'harbour');
        break;
      }
    }
    City.setFocus('city4', 'military');
    $SM.set('game.armies.trained["city4"]', 80, true);
    Network.refresh();
    return { at, site: site.hexes, yard: Fleet.boatyard(), fleet: Fleet.place() };
  }, TIERS);
  expect(hb.yard).toBe('city4');
  expect(hb.fleet).toBeGreaterThanOrEqual(0);

  // out from the harbour: the hulks seen from the lit tower, then rowed out to, its gate
  await toPath(page);
  await page.evaluate((at) => { embark(); stepOnto(at); }, hb.at);
  await expect(page.locator('#event')).toContainText('hulks out on the water, chained together, hull to hull.');
  await expect(page.locator('#notifications')).toContainText('a fleet lies out on the inland sea');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  await page.evaluate((at) => stepOnto(at), hb.at);
  await expect(page.locator('#event')).toContainText("says the land lost the war. says the sea didn't.");
  await choose(page, 'ask what they eat');
  await expect(page.locator('#event')).toContainText('fish, and what the coast towns bring. they bring it every month.');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  await page.evaluate(() => World.goHome());
  const seen = await page.evaluate(() => {
    const s = Fleet.site();
    return { seen: Fleet.state(), all: s.hexes.every((h) => World.hex.mask[h[0]][h[1]]), hover: Network.hexNote(s.anchor[0], s.anchor[1]) };
  });
  expect(seen.seen).toMatchObject({ seen: true, gate: true });
  expect(seen.all).toBe(true);
  expect(seen.hover).toBe('the&nbsp;drowned&nbsp;fleet.&nbsp;it&nbsp;hasn\'t&nbsp;moved&nbsp;in&nbsp;years.');
  await page.evaluate(() => Engine.saveGame());
  const save = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(errors).toEqual([]);
  return { save, hb };
}

test('the drowned fleet broken from a save by it: no march by land, boats and fire-ships from the harbour boatyard, the hulks burned, the boarding storm the wanderer leads; the inland seas open (B12\'s share)', async ({ page, browser }) => {
  test.setTimeout(300000);
  const { save, hb } = await fleetSave(page);
  expect(save.version).toBe(2.9);

  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  await p2.evaluate(() => tick());

  // out on the water: every hex of it open sea, no way there on foot
  const where = await p2.evaluate(() => {
    const gen = World.hex.gen, s = Fleet.site(), cap = gen.capital;
    return {
      deep: s.hexes.every((h) => gen.terrain[h[0]][h[1]] === WorldGen.TERRAIN.ocean),
      onFoot: !!Armies.route(gen, cap, s.anchor, () => true), danger: World.dangerAt(s.anchor[0], s.anchor[1]),
    };
  });
  expect(where.deep).toBe(true);
  expect(where.onFoot).toBe(false);

  // the harbour's town panel: the army can't go before there are boats
  await toTown(p2);
  await p2.evaluate(() => { City.switchTo('city4'); quiet(() => tick()); }); // (the army box is drawn on a tick)
  await expect(p2.locator('#cityArmies')).toContainText('the drowned fleet.');
  await expect(p2.locator('#cityArmies')).toContainText("the fleet is out on the water. an army can't march there.");
  await expect(p2.locator('#power_march_fleet')).toHaveClass(/disabled/);

  // the boatyard: boats (wood and cloth), fire-ships (a boat and pitch)
  await expect(p2.locator('#cityBoatyard')).toContainText('boats 0. fire-ships 0.');
  // (PR_FRAMES=<dir>: frames of the boatyard and the fight, for the PR's GIFs)
  const frame = async (name) => { if (process.env.PR_FRAMES) await p2.screenshot({ path: `${process.env.PR_FRAMES}/${name}.png` }); };
  for (let i = 0; i < 18; i++) {
    await p2.locator('#fleet_boat').click();
    if (i % 3 === 0) await frame(`yard-${String(i).padStart(2, '0')}`);
  }
  for (let i = 0; i < 4; i++) {
    await p2.locator('#fleet_fireship').click();
    await frame(`yard-fire-${i}`);
  }
  await expect(p2.locator('#cityBoatyard')).toContainText('boats 14. fire-ships 4.');
  await p2.locator('#cityBoatyard').scrollIntoViewIfNeeded();
  await p2.screenshot({ path: 'test-results/fleet-boatyard.png' });
  await expect(p2.locator('#power_march_fleet')).not.toHaveClass(/disabled/);

  // march: to the shore, into the boats, out to the hulks
  await p2.locator('#power_march_fleet').click();
  const a0 = await p2.evaluate(() => JSON.parse(JSON.stringify(Armies.list()[0])));
  expect(a0.power).toBe('fleet');
  expect(a0.gear).toMatchObject({ boat: 14, 'fire-ship': 4 });
  expect(await p2.evaluate(() => ({ boats: Fleet.have('boat'), fire: Fleet.have('fire-ship') }))).toEqual({ boats: 0, fire: 0 });
  for (let i = 0; i < 100 && (await p2.evaluate(() => Armies.list()[0].state)) === 'march'; i++) await p2.evaluate(() => quiet(() => tick()));
  const camp = await p2.evaluate(() => {
    const a = Armies.list()[0];
    return { state: a.state, water: WorldGen.isWater(World.hex.gen.terrain[a.at[0]][a.at[1]]), n: Armies.soldiers(a), fed: a.siege.supplied };
  });
  expect(camp).toMatchObject({ state: 'siege', water: true, n: 80 });

  // the camp on the water: the squads can't wear the hulks; the fire-ships burn them
  await p2.evaluate(() => Events.startEvent(Events.Armies.camp(Armies.list()[0].id)));
  await expect(p2.locator('#event')).toContainText("the boats lie off the hulks, out of the big gun's reach.");
  await p2.waitForFunction(() => $('#event').css('opacity') === '1');
  await p2.evaluate(() => window.scrollTo(0, 0));
  await p2.screenshot({ path: 'test-results/fleet-camp.png' });
  await choose(p2, 'press the walls');
  await p2.waitForFunction(() => !Events.activeEvent());
  const pressed = await p2.evaluate(() => {
    for (let i = 0; i < 3; i++) quiet(() => Armies.update());
    return Armies.list()[0].siege.walls;
  });
  expect(pressed).toBe(1000);
  await p2.evaluate(() => Events.startEvent(Events.Armies.camp(Armies.list()[0].id)));
  await choose(p2, 'send in the fire-ships');
  await expect(p2.locator('#event')).toContainText('halfway, the men go over the side. the boats go on.');
  await choose(p2, 'send them in');
  await expect(p2.locator('#event')).toContainText("the first one strikes, and the tar on the hulk's side goes up.");
  await choose(p2, 'go on');
  await p2.waitForFunction(() => !Events.activeEvent());
  await p2.evaluate(() => quiet(() => Armies.update()));
  const breach = await p2.evaluate(() => ({ over: Armies.list()[0].siege.over, walls: Armies.list()[0].siege.walls }));
  expect(breach.over.breach).toBe(true);
  expect(breach.walls).toBe(0);
  await expect(p2.locator('#notifications')).toContainText('the hulks are burning. the boats can board.');

  // the wanderer rows out from the harbour: the boarding fight, the army's squads beside the wanderer's own
  await toPath(p2);
  await p2.evaluate((at) => { embark(); stepOnto(at); }, hb.at);
  await expect(p2.locator('#event')).toContainText('over the rail, onto a burning deck.');
  await expect(p2.locator('#squad_bayonet')).toHaveCount(1);
  await expect(p2.locator('#squad_rifle')).toHaveCount(1);
  await p2.waitForFunction(() => $('#event').css('opacity') === '1');
  await p2.screenshot({ path: 'test-results/fleet-storm.png' });
  const start = await p2.evaluate(() => Armies.soldiers(Armies.list()[0]));
  for (let i = 0; i < 240 && !(await p2.evaluate(() => Events.won)); i++) {
    if (i % 3 === 0) await frame(`storm-${String(i).padStart(3, '0')}`);
    for (const id of ['#squad_bayonet', '#squad_rifle']) {
      const b = p2.locator(id);
      if (await b.count() && !(await b.evaluate((el) => $(el).hasClass('disabled')))) await b.click();
    }
    await p2.waitForTimeout(200);
  }
  expect(await p2.evaluate(() => Events.won)).toBe(true);
  await expect(p2.locator('#event')).toContainText('the iron ship lists, and settles in the shallows, and stays.');
  expect(await p2.evaluate(() => Armies.soldiers(Armies.list()[0]))).toBeGreaterThan(start / 2);
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('someone tells them they\'re still on the bottom.');
  await choose(p2, 'take them in');
  await expect(p2.locator('#event')).toContainText("they know the sea. the harbour's boats will go further now.");
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('the inland sea is open.');
  await choose(p2, 'good');
  await p2.waitForFunction(() => !Events.activeEvent());
  await expect(p2.locator('#notifications')).toContainText('the keepers on the point say the light can reach the flats now.');

  // broken for good: the fleet's share of B12 recorded, the sailors taken in, the inland seas open to armies
  // and treks
  const r = await p2.evaluate(() => {
    const sea = seaHex(), sail = Armies.sails(null);
    World.goHome();
    return {
      broken: Powers.broken('fleet'), way: Powers.state('fleet').way, flag: Network.flag('fleetBroken'), B12: Network.has('B12'),
      trained: Armies.trained(Armies.list()[0].from), sails: !!sail && sail(sea[0], sea[1]), march: Powers.cantMarch('city4', 'fleet'),
      sea, coastal: Fleet.coastal().length,
    };
  });
  expect(r).toMatchObject({ broken: true, way: 'take', flag: true, B12: false, sails: true, march: "they're yours." });
  expect(r.trained).toBeGreaterThanOrEqual(20);
  // the wanderer steps out onto an inland sea now
  await toPath(p2);
  const out = await p2.evaluate((sea) => { embark(); return { tried: stepOnto(sea), at: World.curPos.slice() }; }, r.sea);
  expect(out).toEqual({ tried: true, at: r.sea });
  expect(errors).toEqual([]);
});

test('before the fleet falls the inland seas stay shut to treks; the coastal city-states its fall lifts the price of are won by influence', async ({ page }) => {
  const errors = await townWithCityStates(page);
  await page.evaluate(helpers);
  const r = await page.evaluate(() => {
    const sea = seaHex();
    // a price-only city-state on the fleet's water: influence alone can't win it, until the fleet falls
    const c = CityStates.list().find((x) => CityStates.TEMPERAMENTS[x.t].ways_to_win.includes('price') && !CityStates.TEMPERAMENTS[x.t].ways_to_win.includes('influence'));
    const st = CityStates.state(c.id), before = CityStates.influenceWins(c.t, st);
    Fleet.coastal = () => [c];
    Fleet.lift();
    return { sea, before, after: CityStates.influenceWins(c.t, CityStates.state(c.id)), sails: Armies.sails(null) };
  });
  expect(r.before).toBe(false);
  expect(r.after).toBe(true);
  expect(r.sails).toBe(null);
  await toPath(page);
  const out = await page.evaluate((sea) => { embark(); return { tried: stepOnto(sea), at: World.curPos.slice() }; }, r.sea);
  expect(out.tried).toBe(true);
  expect(out.at).not.toEqual(r.sea);
  await expect(page.locator('#notifications')).toContainText('the sea is too deep to wade.');
  expect(errors).toEqual([]);
});
