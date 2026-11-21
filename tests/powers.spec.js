// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { openGame, townWithCityStates, choose } from './helpers.js';

// the flame era short of the garrison (F8 comes in after F7, as every tier after the one before it)
const FLAME = ['F5', 'F6', 'F7', 'B5', 'B6', 'B7', 'B8', 'H5', 'H6', 'H7'];

// the ticks by hand (the fire, the city-states, the armies), and the trek helpers, on a loaded page
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
    try { fn(); } finally { CityStates.playQueued = play; CityStates._queue = []; }
  };
  window.embark = (outfit) => {
    Path.outfit = Object.assign({ 'cured meat': 8 }, outfit); // (as much as the bag holds)
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
};

// the trek's tab (a click, unless it is the one showing)
const toPath = async (page) => {
  if (!(await page.evaluate(() => Engine.activeModule === Path))) await page.locator('#location_path').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
};

// A save at the garrison's gate (seed 4242): the flame era's first tiers, the garrison's smoke seen and its
// gate met on a trek, a beacon line lit to the gate; the capital on military focus, walls, 40 soldiers
// drilled, POWERS §3's rough army in its stores (30 steel swords, 10 rifles, 2 rams), blasting charges
async function gateSave(page) {
  const errors = await townWithCityStates(page);
  await page.evaluate((FLAME) => {
    for (const t in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + t + '"]', true, true);
    FLAME.forEach((id) => $SM.set('game.network.tiers.' + id, true));
    $SM.setM('game.network.story', { charcoalWay: 'their', smoke: 'look' });
    $SM.setM('stores', { charcoal: 100000 });
    Network.markGarrison();
    Network.tick(); clearTimeout(Network._tickTimeout);
  }, FLAME);
  // the line to the gate: beacons from the capital to a hex next to the site
  const line = await page.evaluate(() => {
    return lineTo({ at: Network.garrison() }) && Network.gateLit();
  });
  expect(line).toBe(true);
  // the gate, on a trek
  await page.locator('#location_path').click();
  await page.evaluate(() => { embark(); stepOnto(Network.garrison()); });
  await expect(page.locator('#event')).toContainText('asks whose order you march under.');
  await choose(page, 'ask whose order they keep');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  await page.evaluate(() => World.goHome());
  await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    let placed = 0;
    for (const p of District.neighbours(cap)) {
      if (placed < 4 && Network.districtsFor('capital', p[0], p[1]).includes('walls') && Network.placeDistrict('capital', p[0], p[1], 'walls')) placed++;
    }
    City.setFocus('capital', 'military');
    $SM.set('game.armies.trained["capital"]', 40, true);
    $SM.setM('stores', { 'steel sword': 30, rifle: 10, bullets: 200, ram: 2, 'blasting charge': 3, 'cured meat': 5000 });
    Engine.saveGame();
  });
  expect(await page.evaluate(() => Network.flag('gateMet'))).toBe(true);
  const save = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(errors).toEqual([]);
  return save;
}

test('the garrison of the deep mines broken by force from a save at its gate: adits blown, the walls pressed, the storm the wanderer leads, the captain; F8 opens coal', async ({ page, browser }) => {
  test.setTimeout(240000);
  const save = await gateSave(page);
  expect(save.version).toBe(2.8);

  // the save, loaded fresh
  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  const g = await p2.evaluate(() => {
    const g = Network.garrison();
    return { g, adits: Powers.adits('garrison'), site: World.siteAt(g[0], g[1]).hexes, F8: Network.has('F8'), lit: Network.gateLit() };
  });
  expect(g.adits.length).toBe(3);
  expect(g.F8).toBe(false);
  expect(g.lit).toBe(true);

  // the army marches on them from the town panel (drawn on the first tick after the load)
  await p2.evaluate(() => tick());
  await p2.locator('#location_city').click();
  await p2.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await expect(p2.locator('#cityArmies')).toContainText('the garrison of the deep mines.');
  await p2.locator('#power_march_garrison').click();
  const a0 = await p2.evaluate(() => JSON.parse(JSON.stringify(Armies.list()[0])));
  expect(a0.power).toBe('garrison');
  for (let i = 0; i < 200 && (await p2.evaluate(() => Armies.list()[0].state)) === 'march'; i++) await p2.evaluate(() => tick());
  expect(await p2.evaluate(() => Armies.list()[0] && Armies.list()[0].state)).toBe('siege');

  // the camp: the puzzle told; they are fed through the adits, so the army waits them out in vain
  await p2.evaluate(() => CityStates.playQueued());
  await expect(p2.locator('#event')).toContainText('three adits feed the stockade');
  await choose(p2, 'wait them out');
  await p2.waitForFunction(() => !Events.activeEvent());
  const fed = await p2.evaluate(() => {
    const before = Armies.list()[0].siege.stores;
    for (let i = 0; i < 5; i++) quiet(() => Armies.update());
    return { before, after: Armies.list()[0].siege.stores, supplied: Armies.list()[0].siege.supplied };
  });
  expect(fed.after).toBe(fed.before); // an adit open: their stores don't run down
  expect(fed.supplied).toBe(true);

  // the camp's rows in the town panel: scrolled to the bottom, the menu fixed at the bottom of the window
  // sits under the last of them (City.fitHeight counts the army box)
  await p2.waitForTimeout(100); // (the panel refits once a frame)
  const fit = await p2.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const rows = $('#cityArmies').find('*').filter(':visible').toArray();
    return {
      last: Math.max(...rows.map((e) => e.getBoundingClientRect().bottom)),
      menu: $('.menu')[0].getBoundingClientRect().top,
      camped: $('#armyStatus').text(), out: $('#cityArmies').text().includes('the army is already out'),
    };
  });
  expect(fit.camped).toContain('camped below the walls');
  expect(fit.out).toBe(true);
  expect(fit.last).toBeLessThanOrEqual(fit.menu);

  // one adit blown by the wanderer, a blasting charge in the pack
  await toPath(p2);
  await p2.evaluate((a) => { embark({ 'blasting charge': 1 }); stepOnto(a); }, g.adits[0]);
  await expect(p2.locator('#event')).toContainText('a cart track runs into the dark.');
  await choose(p2, 'set a charge');
  await expect(p2.locator('#event')).toContainText('the hill settles over the mouth.');
  await choose(p2, 'go on');
  await p2.waitForFunction(() => !Events.activeEvent());
  await p2.evaluate(() => World.goHome());
  expect(await p2.evaluate(() => Powers.open('garrison').length)).toBe(2);

  // the other two by the army's own charges, from the camp
  for (let k = 0; k < 2; k++) {
    await p2.evaluate(() => Events.startEvent(Events.Armies.camp(Armies.list()[0].id)));
    await choose(p2, 'blast an adit');
    await p2.waitForFunction(() => !Events.activeEvent());
  }
  expect(await p2.evaluate(() => ({ open: Powers.open('garrison').length, charges: Armies.list()[0].gear['blasting charge'] }))).toEqual({ open: 0, charges: 1 });

  // press the walls: the rams break the timber; the storm waits for the wanderer
  await p2.evaluate(() => Armies.stance(Armies.list()[0].id, 'press'));
  for (let i = 0; i < 30 && !(await p2.evaluate(() => !!(Armies.list()[0].siege.over))); i++) {
    await p2.evaluate(() => quiet(() => Armies.update()));
  }
  const breach = await p2.evaluate(() => ({ over: Armies.list()[0].siege.over, walls: Armies.list()[0].siege.walls, at: Armies.list()[0].at }));
  expect(breach.over.breach).toBe(true);
  expect(breach.walls).toBe(0);
  await expect(p2.locator('#notifications')).toContainText('the army waits for the wanderer.');

  // the wanderer goes to the army: into the shafts, the light carried down from the beacon
  await toPath(p2);
  await p2.evaluate((at) => { embark(); stepOnto(at); }, breach.at);
  await expect(p2.locator('#event')).toContainText('fire is carried down from the beacon, lamp by lamp.');
  await choose(p2, 'go on');
  // the storm: the army's squads are weapon buttons beside the wanderer's own
  await expect(p2.locator('#squad_steel-sword')).toHaveCount(1);
  await expect(p2.locator('#squad_rifle')).toHaveCount(1);
  await expect(p2.locator('#stormArmy')).toBeVisible();
  await p2.screenshot({ path: 'test-results/powers-storm.png' });
  const start = await p2.evaluate(() => Armies.soldiers(Armies.list()[0]));
  for (let i = 0; i < 120 && !(await p2.evaluate(() => Events.won)); i++) {
    for (const id of ['#squad_steel-sword', '#squad_rifle']) {
      const b = p2.locator(id);
      if (await b.count() && !(await b.evaluate((el) => $(el).hasClass('disabled')))) await b.click();
    }
    await p2.waitForTimeout(250);
  }
  expect(await p2.evaluate(() => Events.won)).toBe(true);
  await expect(p2.locator('#event')).toContainText('the flag comes down. no one cheers.');
  const left = await p2.evaluate(() => Armies.soldiers(Armies.list()[0]));
  expect(left).toBeGreaterThan(start / 2);
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('asks who won the war.');
  await choose(p2, 'take them in');
  await expect(p2.locator('#event')).toContainText('some of them have never seen a town.');
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('it burns like nothing before it.');
  await choose(p2, 'good');
  await p2.waitForFunction(() => !Events.activeEvent());

  // broken for good: F8, coal on the hills by the deep mines, the garrison's soldiers taken in
  const r = await p2.evaluate((site) => {
    World.goHome();
    const coal = site.some((h) => District.neighbours(h).some((p) => World.hex.gen.terrain[p[0]][p[1]] === WorldGen.TERRAIN.hills && Network.coalAt(p[0], p[1])));
    return {
      F8: Network.has('F8'), broken: Powers.broken('garrison'), way: Powers.state('garrison').way, coal,
      trained: Armies.trained('capital'), after: !!$SM.get('game.armies.after["capital"]'),
      sphere: CityStates.spheres().some((p) => p.at[0] === site[0][0] && p.at[1] === site[0][1]),
      march: Powers.cantMarch('capital', 'garrison'),
    };
  }, g.site);
  expect(r.F8).toBe(true);
  expect(r.broken).toBe(true);
  expect(r.way).toBe('take');
  expect(r.trained).toBeGreaterThanOrEqual(10);
  expect(r.after).toBe(true);
  expect(r.sphere).toBe(false);
  expect(r.march).toBe("they're yours.");
  expect(errors).toEqual([]);
});

test('the shafts are dark without a beacon at the gate: the storm fails, losses as a lost fight; starved out with the adits down, they yield to the captain', async ({ page, browser }) => {
  test.setTimeout(240000);
  const save = await gateSave(page);
  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  // the army camped at the walls, the walls down, the gate's beacon put out (the siege's scenes held back:
  // this test plays the ones it wants)
  const r = await p2.evaluate(() => {
    window.playQueued = CityStates.playQueued;
    CityStates.playQueued = () => {};
    Powers.marchOn('capital', 'garrison');
    for (let i = 0; i < 200 && Armies.list()[0].state === 'march'; i++) tick();
    CityStates._queue = [];
    const a = Armies.list()[0];
    a.siege.walls = 1;
    Armies.set(a);
    for (let i = 0; i < 10 && !Armies.list()[0].siege.over; i++) { Armies.update(); CityStates._queue = []; }
    for (const k in $SM.get('game.network.beacons')) $SM.remove('game.network.beacons["' + k + '"]');
    Network.refresh();
    return { over: Armies.list()[0].siege.over, lit: Network.gateLit(), n: Armies.soldiers(Armies.list()[0]), at: Armies.list()[0].at };
  });
  expect(r.over.breach).toBe(true);
  expect(r.lit).toBe(false);
  await toPath(p2);
  await p2.evaluate((at) => { embark(); stepOnto(at); }, r.at);
  await expect(p2.locator('#event')).toContainText('the torches gutter in the bad air.');
  await choose(p2, 'fall back');
  await p2.waitForFunction(() => !Events.activeEvent());
  const lost = await p2.evaluate(() => ({ n: Armies.soldiers(Armies.list()[0]), power: Armies.list()[0].power, cache: Object.keys($SM.get('game.armies.caches') || {}).length, broken: Powers.broken('garrison') }));
  expect(lost.power).toBe(null);
  expect(lost.broken).toBe(false);
  expect(1 - lost.n / r.n).toBeGreaterThanOrEqual(0.5);
  expect(1 - lost.n / r.n).toBeLessThanOrEqual(0.8);
  expect(lost.cache).toBe(1);

  expect(errors).toEqual([]);

  // starved out (the save again): the adits down, they yield and the captain comes, no storm
  const p3 = await browser.newPage();
  const errors3 = await openGame(p3, { save });
  await p3.evaluate(helpers);
  const y = await p3.evaluate(() => {
    window.playQueued = CityStates.playQueued;
    CityStates.playQueued = () => {};
    Powers.adits('garrison').forEach((h) => $SM.set('game.powers["garrison"].closed["' + h[0] + ',' + h[1] + '"]', true));
    Powers.marchOn('capital', 'garrison');
    for (let i = 0; i < 200 && Armies.list()[0].state === 'march'; i++) tick();
    CityStates._queue = [];
    Armies.stance(Armies.list()[0].id, 'wait');
    let ticks = 0;
    for (; ticks < 100 && !Armies.list()[0].siege.over; ticks++) { Armies.update(); CityStates._queue = []; }
    const over = Armies.list()[0].siege.over;
    CityStates._queue = [];
    Armies.tellEnd(Armies.list()[0]);
    playQueued.call(CityStates);
    return { over, ticks };
  });
  expect(y.over.yield).toBe(true);
  expect(y.ticks).toBeGreaterThanOrEqual(59);
  await expect(p3.locator('#event')).toContainText('give up their rifles one by one.');
  await choose(p3, 'go on');
  await choose(p3, 'send them down the hill');
  await expect(p3.locator('#event')).toContainText('the captain leaves the box behind.');
  await choose(p3, 'go on');
  await choose(p3, 'good');
  const done = await p3.evaluate(() => ({ F8: Network.has('F8'), way: Powers.state('garrison').way, coal: $SM.get('stores.coal', true) === Powers.HEAD_START }));
  expect(done).toEqual({ F8: true, way: 'send', coal: true });
  expect(errors3).toEqual([]);
});

test('the garrison is unseen until "smoke in the hills" marks it, even on land the prologue walked', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const r = await page.evaluate(() => {
    const gen = World.hex.gen, site = gen.sites[gen.garrison], m = World.hex.map;
    site.hexes.forEach((h) => { World.hex.mask[h[0]][h[1]] = true; }); // as if walked in the prologue
    const look = () => ({
      glyphs: site.hexes.map((h) => World.hexGlyph(h[0], h[1], m)[0]),
      label: World.hexLabel(site.anchor[0], site.anchor[1], { map: m, mask: World.hex.mask }),
    });
    const before = look();
    $SM.set('game.network.story.smoke', 'look');
    Network.markGarrison();
    return { before, after: look(), danger: World.dangerAt(site.anchor[0], site.anchor[1]), at: site.anchor, cap: gen.capital };
  });
  expect(r.before.glyphs).not.toContain('Π');
  expect(r.before.label).not.toContain('complex');
  expect(r.after.glyphs.every((g) => g === 'Π')).toBe(true);
  expect(r.after.label).toBe('the&nbsp;garrison&nbsp;of&nbsp;the&nbsp;deep&nbsp;mines');
  expect(errors).toEqual([]);
});

test('a v2.7 save loads as v2.8: the powers start empty, its hex map kept (not re-projected), the garrison picked where it now stands', async ({ page }) => {
  const save = await gateSave(page);
  // as a v2.7 save: generator 1, the garrison's old anchor stored, no powers
  save.version = 2.7;
  save.game.world.hex.gen = 1;
  save.game.network.garrison = [0, 0];
  delete save.game.powers;
  const delta = save.game.world.hex.delta;
  const page2 = await page.context().newPage();
  const errors = await openGame(page2, { save });
  const r = await page2.evaluate(() => ({
    version: $SM.get('version'), gen: $SM.get('game.world.hex.gen'), delta: $SM.get('game.world.hex.delta'), powers: $SM.get('game.powers'),
    garrison: $SM.get('game.network.garrison'), at: World.hex.gen.sites[World.hex.gen.garrison].anchor,
    seen: World.hex.gen.sites[World.hex.gen.garrison].hexes.every((h) => World.hex.mask[h[0]][h[1]]),
  }));
  expect(r.version).toBe(2.8);
  expect(r.gen).toBe(2);
  expect(r.delta).toEqual(delta);
  expect(r.powers).toEqual({});
  expect(r.garrison).toEqual(r.at);
  expect(r.seen).toBe(true);
  expect(errors).toEqual([]);
});
