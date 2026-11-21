// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { openGame, townWithCityStates, choose } from './helpers.js';

// the blaze era's floor: coal (F8) and the signal mirror (B9; B10 comes in after it)
const TIERS = ['F5', 'F6', 'F7', 'F8', 'B5', 'B6', 'B7', 'B8', 'B9', 'H5', 'H6', 'H7', 'H8'];

// the ticks by hand (the fire, the city-states, the armies), on a loaded page; a trek packed through the
// outfitting rows and the embark button, as a player does it
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
  // the armies' tick with no siege scene played (the test plays the ones it wants)
  window.quiet = (fn) => {
    const play = CityStates.playQueued;
    CityStates.playQueued = () => {};
    try { return fn(); } finally { CityStates.playQueued = play; CityStates._queue = []; }
  };
  window.embark = () => {
    Path.updateOutfitting();
    Path.increaseSupply.call($('#outfit_row_cured-meat .upBtn')[0], { data: 20 });
    $('#embarkButton').click();
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
};

const toPath = async (page) => {
  if (!(await page.evaluate(() => Engine.activeModule === Path))) await page.locator('#location_path').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
};

// the bag's header on the outfitting panel: never less than nothing free
const freeSpace = (page) => page.evaluate(() => Number(($('#bagspace').text().match(/free (-?\d+)/) || [])[1]));

// A save at the foot of the pass (seed 4242): the blaze era's floor, a coal line lit to the battery, the guns seen,
// the gate met and the goat path found on a trek; the capital on military focus, walls, 40 soldiers drilled,
// POWERS §3's rough army in its stores (40 rifles, bullets, 4 mantlets)
async function passSave(page) {
  const errors = await townWithCityStates(page);
  await page.evaluate((TIERS) => {
    for (const t in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + t + '"]', true, true);
    TIERS.forEach((id) => $SM.set('game.network.tiers.' + id, true));
    $SM.setM('stores', { coal: 100000, iron: 10000 });
    Network.tick(); clearTimeout(Network._tickTimeout);
  }, TIERS);
  const w = await page.evaluate(() => {
    const s = Wardens.site();
    return { at: s.anchor, goat: s.goat, hexes: s.hexes, line: lineTo({ at: s.anchor }), lit: Wardens.passLit(), cap: World.hex.gen.capital };
  });
  expect(w.line).toBe(true);
  expect(w.lit).toBe(true);
  // the trek: the guns seen from the foot of the pass, the gate, the goat path
  await page.locator('#location_path').click();
  await page.evaluate(() => embark());
  await page.waitForFunction(() => Engine.activeModule === World);
  await page.evaluate((w) => {
    const foot = World.hex.gen.sites[World.hex.gen.wardens].foot;
    stepOnto(foot);
  }, w);
  await expect(page.locator('#event')).toContainText('something flashes on the heights.');
  await expect(page.locator('#notifications')).toContainText('guns on the great pass');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  await page.evaluate((w) => stepOnto(w.at), w);
  await expect(page.locator('#event')).toContainText("asks if you're the relief.");
  await choose(page, 'say yes');
  await expect(page.locator('#event')).toContainText("the voice says they've heard that before.");
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  // the goat path: only on foot, on the ledge itself
  await page.evaluate((w) => stepOnto(w.goat), w);
  await expect(page.locator('#event')).toContainText('it comes out above the guns, behind them.');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  const labels = await page.evaluate((w) => ({
    site: World.hexLabel(w.at[0], w.at[1]), goat: World.hexLabel(w.goat[0], w.goat[1]),
  }), w);
  expect(labels.site).toBe('the&nbsp;pass&nbsp;wardens.&nbsp;the&nbsp;guns&nbsp;still&nbsp;face&nbsp;down&nbsp;the&nbsp;pass.');
  expect(labels.goat).toBe('a&nbsp;goat&nbsp;path');
  await page.evaluate(() => World.goHome());
  await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    let placed = 0;
    for (const p of District.neighbours(cap)) {
      if (placed < 4 && Network.districtsFor('capital', p[0], p[1]).includes('walls') && Network.placeDistrict('capital', p[0], p[1], 'walls')) placed++;
    }
    City.setFocus('capital', 'military');
    $SM.set('game.armies.trained["capital"]', 40, true);
    $SM.setM('stores', { rifle: 40, bullets: 200, mantlet: 4, 'cured meat': 5000 });
    Engine.saveGame();
  });
  const st = await page.evaluate(() => Powers.state('wardens'));
  expect(st).toEqual({ sighted: true, gate: true, path: true });
  const save = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(errors).toEqual([]);
  return { save, w };
}

test('the pass wardens broken from a save at the foot of the pass: under the guns a squad a tick, the dark march up the goat path, the storm from behind, the counter-siege held; B10', async ({ page, browser }) => {
  test.setTimeout(300000);
  const { save, w } = await passSave(page);
  expect(save.version).toBe(2.9);
  expect(save.game.powers.wardens).toEqual({ sighted: true, gate: true, path: true });

  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  expect(await p2.evaluate(() => ({ B10: Network.has('B10'), known: Powers.known('wardens'), lit: Wardens.passLit() }))).toEqual({ B10: false, known: true, lit: true });

  // the army marches on them from the town panel
  await p2.evaluate(() => tick());
  await p2.locator('#location_city').click();
  await p2.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await expect(p2.locator('#cityArmies')).toContainText('the pass wardens.');
  await p2.locator('#power_march_wardens').click();
  expect(await p2.evaluate(() => Armies.list()[0].power)).toBe('wardens');
  for (let i = 0; i < 200 && (await p2.evaluate(() => Armies.list()[0].state)) === 'march'; i++) await p2.evaluate(() => quiet(() => tick()));
  expect(await p2.evaluate(() => Armies.list()[0].state)).toBe('siege');

  // the camp: the guns told, the goat path offered
  await p2.evaluate(() => Events.startEvent(Events.Armies.camp(Armies.list()[0].id)));
  await expect(p2.locator('#event')).toContainText('every tick under them costs a squad.');
  await expect(p2.locator('#event .button', { hasText: 'march the goat path' })).toHaveCount(1);
  await p2.screenshot({ path: 'test-results/wardens-camp.png' });
  await choose(p2, 'wait them out');
  await p2.waitForFunction(() => !Events.activeEvent());

  // under the guns: a squad a tick (halved by the mantlets), whatever the stance; they never run short
  const below = await p2.evaluate(() => {
    const a = () => Armies.list()[0], n = [Armies.soldiers(a())];
    for (let i = 0; i < 2; i++) { quiet(() => Armies.update()); n.push(Armies.soldiers(a())); }
    return { n, stores: a().siege.stores, walls: a().siege.walls, status: $('#armyStatus').text() };
  });
  expect(below.n).toEqual([40, 35, 30]);
  expect(below.stores).toBe(90);
  expect(below.walls).toBe(100000);
  expect(below.status).toContain('camped below the guns of the pass wardens');
  await expect(p2.locator('#notifications')).toContainText('the guns find the camp. 5 soldiers fall.');

  // the dark march: the camp's choice, then the climb
  await p2.evaluate(() => Events.startEvent(Events.Armies.camp(Armies.list()[0].id)));
  await choose(p2, 'march the goat path');
  await p2.waitForFunction(() => !Events.activeEvent());
  await p2.evaluate(() => CityStates.playQueued());
  await expect(p2.locator('#event')).toContainText('one hand on the rock, one on the man in front.');
  await choose(p2, 'climb');
  await p2.waitForFunction(() => !Events.activeEvent());
  const dark = await p2.evaluate((goat) => {
    const a = () => Armies.list()[0], gen = World.hex.gen;
    const path = a().siege.dark.path.slice(), start = { n: Armies.soldiers(a()), water: a().water };
    // every step charged unlit: the water it costs as Armies.stepNeeds counts an unlit step
    const want = path.reduce((s, p) => s + Armies.stepNeeds(1, false, World.dangerAt(p[0], p[1]), Armies.moveCost(gen, p[0], p[1])).water, 0);
    const lit = path.filter((p) => World.hex.fire.lit[p[0] + p[1] * gen.cols]).length;
    const n = [];
    for (let i = 0; i < 20 && !a().siege.over; i++) { quiet(() => Armies.update()); n.push(Armies.soldiers(a())); }
    return { path, lit, start, want, n, at: a().at, over: a().siege.over, water: a().water, goat };
  }, w.goat);
  expect(dark.path.length).toBeGreaterThan(0);
  expect(dark.at).toEqual(w.goat);
  expect(dark.over.breach).toBe(true);
  expect(dark.n.every((x) => x >= dark.start.n - 3)).toBe(true); // no guns on the climb, only stragglers
  // every step of the climb paid unlit, the lit ones too (some are under the beacon line), at the soldiers who
  // made it (stragglers fall on the way)
  expect(dark.lit).toBeGreaterThan(0);
  expect(dark.start.water - dark.water).toBeGreaterThanOrEqual(dark.want * (dark.start.n - 3));
  await expect(p2.locator('#notifications')).toContainText('the army is on the cliff.');
  await expect(p2.locator('#notifications')).toContainText('the army waits for the wanderer.');

  // the storm: the wanderer goes up the goat path to the army
  await toPath(p2);
  await p2.evaluate(() => embark());
  await p2.waitForFunction(() => Engine.activeModule === World);
  await p2.evaluate((g) => stepOnto(g), w.goat);
  await expect(p2.locator('#event')).toContainText('the army comes down off the cliff, behind the guns.');
  await choose(p2, 'go on');
  await expect(p2.locator('#squad_rifle')).toHaveCount(1);
  await expect(p2.locator('#event')).toContainText("they turn the guns. the guns don't turn far enough.");
  await p2.screenshot({ path: 'test-results/wardens-storm.png' });
  for (let i = 0; i < 120 && !(await p2.evaluate(() => Events.won)); i++) {
    const b = p2.locator('#squad_rifle');
    if (await b.count() && !(await b.evaluate((el) => $(el).hasClass('disabled')))) await b.click();
    await p2.waitForTimeout(250);
  }
  expect(await p2.evaluate(() => Events.won)).toBe(true);
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('below, on the far side, the rest of them are coming up.');
  await choose(p2, 'light the beacon on the pass');
  await p2.waitForFunction(() => !Events.activeEvent());
  await expect(p2.locator('#notifications')).toContainText("they're coming up the pass.");
  await p2.evaluate(() => World.goHome());

  // the counter-siege: the beacon on the pass kept burning through the waves
  const held = await p2.evaluate(() => {
    const a = () => Armies.list()[0], c0 = JSON.parse(JSON.stringify(a().siege.over.counter)), at = a().at.slice();
    let ticks = 0;
    for (; ticks < 80 && a().siege && !a().siege.over.held; ticks++) quiet(() => tick());
    return { c0, at, ticks, over: a().siege && a().siege.over, B10: Network.has('B10'), flag: Network.flag('passHeld'), seen: Network.flag('passSeen') };
  });
  expect(held.at).toEqual(w.at);
  expect(held.c0).toEqual({ ticks: 0, lit: 0, waves: 0, men: held.c0.men });
  expect(held.ticks).toBe(60);
  expect(held.over).toEqual({ held: true });
  expect(held.B10).toBe(true);
  expect(held.flag).toBe(true);
  expect(held.seen).toBe(true);
  await expect(p2.locator('#notifications')).toContainText('half the night is gone.');
  await expect(p2.locator('#notifications')).toContainText('the beacon on the pass still burns.');

  // their last scenes: The Pass Held (B10's), then the wardens broken
  await p2.evaluate(() => { Armies.tellEnd(Armies.list()[0]); CityStates.playQueued(); });
  await expect(p2.locator('#event')).toContainText('from here the fire can see both ways.');
  await choose(p2, 'good');
  await expect(p2.locator('#event')).toContainText('says there was');
  await p2.screenshot({ path: 'test-results/wardens-broken.png' });
  await choose(p2, 'take them in');
  await expect(p2.locator('#event')).toContainText('they bring their range cards. no one else can read them.');
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('past the range, land no one here has seen.');
  await choose(p2, 'good');
  await p2.waitForFunction(() => !Events.activeEvent());
  const r = await p2.evaluate((at) => ({
    broken: Powers.broken('wardens'), way: Powers.state('wardens').way, trained: Armies.trained('capital'),
    after: !!$SM.get('game.armies.after["capital"]'), march: Powers.cantMarch('capital', 'wardens'),
    sphere: CityStates.spheres().some((p) => p.at[0] === at[0] && p.at[1] === at[1]), army: Armies.list()[0].state,
    garrison: Powers.broken('garrison'), coal: $SM.get('stores.coal', true),
  }), w.at);
  expect(r.broken).toBe(true);
  expect(r.way).toBe('take');
  expect(r.trained).toBeGreaterThanOrEqual(10);
  expect(r.after).toBe(true);
  expect(r.march).toBe("they're yours.");
  expect(r.sphere).toBe(false);
  expect(r.army).toBe('camp');
  expect(r.garrison).toBe(false);
  expect(errors).toEqual([]);
});

test('the counter-siege lost: the beacon on the pass goes dark, they take the battery back and the army routs; B10 waits, the siege can be tried again', async ({ page, browser }) => {
  test.setTimeout(300000);
  const { save, w } = await passSave(page);
  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  // the army camped, up the goat path and through the storm, by the hooks the scenes call
  const r = await p2.evaluate(() => quiet(() => {
    Powers.marchOn('capital', 'wardens');
    for (let i = 0; i < 200 && Armies.list()[0].state === 'march'; i++) tick();
    const id = Armies.list()[0].id;
    Wardens.climbOut(id);
    for (let i = 0; i < 20 && !Armies.list()[0].siege.over; i++) Armies.update();
    Wardens.begin(id);
    for (let i = 0; i < 20; i++) tick(); // the first wave beaten back, the beacon burning
    const mid = JSON.parse(JSON.stringify(Armies.list()[0].siege.over.counter));
    // then every beacon put out
    for (const k in $SM.get('game.network.beacons')) $SM.remove('game.network.beacons["' + k + '"]');
    Network.refresh();
    const n = Armies.soldiers(Armies.list()[0]);
    tick();
    const a = Armies.list()[0];
    return { mid, n, left: Armies.soldiers(a), power: a.power, siege: a.siege, cache: Object.keys($SM.get('game.armies.caches') || {}).length };
  }));
  expect(r.mid.waves).toBe(1);
  expect(r.mid.lit).toBe(20);
  expect(r.power).toBe(null);
  expect(r.siege).toBe(null);
  expect(1 - r.left / r.n).toBeGreaterThanOrEqual(0.5);
  expect(r.cache).toBe(1);
  await expect(p2.locator('#notifications')).toContainText("the beacon on the pass went dark. they've taken it back.");
  const after = await p2.evaluate(() => ({ B10: Network.has('B10'), broken: Powers.broken('wardens'), path: Powers.state('wardens').path }));
  expect(after).toEqual({ B10: false, broken: false, path: true });
  // the siege can be tried again: new soldiers and rifles, and they may march on the wardens
  const again = await p2.evaluate(() => {
    for (const a of Armies.list()) Armies.remove(a);
    $SM.set('game.armies.trained["capital"]', 40, true);
    $SM.setM('stores', { rifle: 40, bullets: 200 });
    return Powers.cantMarch('capital', 'wardens');
  });
  expect(again).toBe(null);

  // the same save, the siege from below sat out with no way up: the army breaks under the guns
  const p3 = await browser.newPage();
  const errors3 = await openGame(p3, { save });
  await p3.evaluate(helpers);
  const b = await p3.evaluate(() => quiet(() => {
    Powers.marchOn('capital', 'wardens');
    for (let i = 0; i < 200 && Armies.list()[0].state === 'march'; i++) tick();
    let ticks = 0;
    for (; ticks < 30 && !Armies.list()[0].siege.over; ticks++) Armies.update();
    return { ticks, over: Armies.list()[0].siege.over, n: Armies.soldiers(Armies.list()[0]) };
  }));
  expect(b.over.broken).toBe(true);
  expect(b.ticks).toBe(5); // 40 under 4 mantlets: 5 a tick, under half of who went in on the fifth
  expect(b.n).toBe(15);
  expect(errors).toEqual([]);
  expect(errors3).toEqual([]);
});

test('the wardens stand at the foot of a mountain pass at band 2, reachable from a fresh save; the goat path hides as plain hills until found', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const r = await page.evaluate(() => {
    const gen = World.hex.gen, s = Wardens.site(), m = World.hex.map;
    s.hexes.concat([s.goat]).forEach((h) => { World.hex.mask[h[0]][h[1]] = true; });
    return {
      danger: World.baseDangerAt(s.anchor[0], s.anchor[1]), kind: s.kind,
      pass: District.neighbours(s.anchor).some((p) => World.hex.passes[p.join(',')]),
      heights: s.hexes.every((h) => gen.terrain[h[0]][h[1]] === WorldGen.TERRAIN.hills && gen.formationAt[h[0] + h[1] * gen.cols] < 0),
      goat: gen.terrain[s.goat[0]][s.goat[1]] === WorldGen.TERRAIN.hills,
      reach: !!gen.reachable[s.goat[0] + s.goat[1] * gen.cols] && !!gen.reachable[s.anchor[0] + s.anchor[1] * gen.cols],
      goatLabel: World.hexLabel(s.goat[0], s.goat[1], { map: m, mask: World.hex.mask }),
      siteLabel: World.hexLabel(s.anchor[0], s.anchor[1], { map: m, mask: World.hex.mask }),
      garrison: gen.sites[gen.garrison].garrison, complexes: gen.sites.filter((c) => c.kind === 'complex').length,
    };
  });
  expect(r.kind).toBe('complex');
  expect(r.danger).toBeGreaterThanOrEqual(4);
  expect(r.danger).toBeLessThan(6);
  expect(r.pass).toBe(true); // the gate at the foot of a pass
  expect(r.heights).toBe(true);
  expect(r.goat).toBe(true);
  expect(r.reach).toBe(true);
  expect(r.goatLabel).not.toContain('goat');
  expect(r.siteLabel).toBe('an old-world complex');
  expect(r.garrison).toBe(true);
  expect(r.complexes).toBe(8);
  expect(errors).toEqual([]);
});
