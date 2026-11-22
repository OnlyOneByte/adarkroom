// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { openGame, townWithCityStates, choose } from './helpers.js';

// the blaze era short of pitch: coal and coke in, the mirrors (B9) in
const TIERS = ['F5', 'F6', 'F7', 'F8', 'F9', 'B5', 'B6', 'B7', 'B8', 'B9', 'H5', 'H6', 'H7', 'H8'];

// the ticks by hand (the fire, the city-states, the armies), on a loaded page
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
  // beacons from the capital to a hex next to c.at, as tests/helpers.js townWithCityStates raises them
  window.lineTo = (c) => {
    const cap = World.hex.gen.capital;
    const goal = District.neighbours(c.at).sort((a, b) => WorldGen.distance(a, cap) - WorldGen.distance(b, cap))[0];
    let at = cap;
    for (let i = 0; i < 40 && !(at[0] === goal[0] && at[1] === goal[1]); i++) {
      Fire.around(at[0], at[1], Fire.HOP).forEach((p) => { if (World.hex.mask[p[0]]) World.hex.mask[p[0]][p[1]] = true; });
      const next = Fire.around(at[0], at[1], Fire.HOP).filter((p) => Network.canBeacon(p[0], p[1]))
        .sort((a, b) => WorldGen.distance(a, goal) - WorldGen.distance(b, goal))
        .find((p) => {
          if (!Network.raiseBeacon(p[0], p[1])) return false;
          if (World.hex.fire.nodes.some((n) => !n.hearth && n.at[0] === p[0] && n.at[1] === p[1] && n.s >= Fire.LIT_MIN)) return true;
          $SM.remove('game.network.beacons["' + p.join(',') + '"]');
          Network.refresh();
          return false;
        });
      if (!next) return false;
      at = next;
    }
    return at[0] === goal[0] && at[1] === goal[1];
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

// a screenshot for the PR (test-results/riders/, numbered in the order taken: frames for its GIFs)
let shots = 0;
const shot = (page, name) => page.screenshot({ path: `test-results/riders/${String(++shots).padStart(2, '0')}-${name}.png` });

// a trek outfitted the way a player does it: the trek's tab, ten cured meat by the button (a full bag), embark
async function trek(page) {
  if (!(await page.evaluate(() => Engine.activeModule === Path))) await page.locator('#location_path').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await page.locator('#outfit_row_cured-meat .upManyBtn').click();
  const bag = await page.evaluate(() => ({ free: Path.getFreeSpace(), meat: Path.outfit['cured meat'] }));
  expect(bag.meat).toBe(10);
  expect(bag.free).toBeGreaterThanOrEqual(0);
  await page.locator('#embarkButton').click();
  await page.waitForFunction(() => Engine.activeModule === World && !$('#outerSlider').is(':animated'));
  await page.evaluate(() => { Math.random = () => 0.99; }); // no fights
}

// plays through the scenes a test doesn't look at (a city-state's stranger, ...) by their first button, until
// the one with this text
async function until(page, text) {
  for (let i = 0; i < 10; i++) {
    await page.waitForFunction(() => !!Events.activeEvent());
    if ((await page.locator('#event').textContent()).includes(text)) break;
    await page.locator('#event .button').first().click();
    await page.waitForFunction(() => !Events.activeEvent() || !$('#event').is(':animated'));
    await page.waitForTimeout(400);
    if (!(await page.evaluate(() => !!Events.activeEvent()))) await page.evaluate(() => CityStates.playQueued());
  }
  await expect(page.locator('#event')).toContainText(text);
}

// clears every scene in the queue a test doesn't look at, by its first button
async function settle(page) {
  for (let i = 0; i < 10 && (await page.evaluate(() => !!Events.activeEvent())); i++) {
    await page.locator('#event .button').first().click();
    await page.waitForTimeout(50);
  }
}

// A save near the riders (seed 4242): the blaze era short of pitch, the riders' camp seen and met on a trek
// and a well found on it; beacon lines from the capital onto two of the three wells; the capital on military
// focus, walls for 50, 50 soldiers drilled, POWERS §3's rough army in its stores (40 bayonets, 10 tanglers'
// bolas, 3 days' water in casks)
async function ridersSave(page) {
  const errors = await townWithCityStates(page);
  await page.evaluate((TIERS) => {
    for (const t in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + t + '"]', true, true);
    TIERS.forEach((id) => $SM.set('game.network.tiers.' + id, true));
    $SM.setM('game.network.story', { charcoalWay: 'their', smoke: 'look' });
    $SM.setM('stores', { coal: 100000, coke: 100000, wood: 100000, iron: 10000 });
    Network.tick(); clearTimeout(Network._tickTimeout);
  }, TIERS);
  await page.evaluate(helpers);
  const s = await page.evaluate(() => {
    const s = Riders.site(), lines = s.wells.slice(0, 2).map((w) => lineTo({ at: w }) && Network.raiseBeacon(w[0], w[1]));
    Network.refresh();
    return { anchor: s.anchor, wells: s.wells, lines, held: Riders.held() };
  });
  expect(s.lines).toEqual([true, true]);
  expect(s.held).toBe(2);
  // the camp, on a trek: the dust first, then their tents; the third well found on the way home
  await trek(page);
  await page.evaluate((a) => stepOnto(a), s.anchor);
  await expect(page.locator('#event')).toContainText("dust on the horizon. it doesn't settle.");
  await expect(page.locator('#notifications')).toContainText('riders out on the desert. they saw you.');
  await shot(page, 'trek-dust');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  await page.evaluate((a) => stepOnto(a), s.anchor);
  await expect(page.locator('#event')).toContainText('a rider in a burnt coat sits a mount just out of throw.');
  await shot(page, 'trek-camp');
  await choose(page, 'ask about the water');
  await expect(page.locator('#event')).toContainText("says there are three. says you'll find them dry before you find them.");
  await shot(page, 'trek-water');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  await page.evaluate((w) => stepOnto(w), s.wells[2]);
  await expect(page.locator('#event')).toContainText('a ring of stones in the sand. a bucket on a rope. the water is cold.');
  await shot(page, 'trek-well');
  await choose(page, 'light a fire on it');
  await expect(page.locator('#event')).toContainText('by morning the riders know.');
  await shot(page, 'trek-lit');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  await page.waitForTimeout(500);
  await shot(page, 'trek-map');
  const hover = await page.evaluate((s) => ({
    camp: World.hexLabel(s.anchor[0], s.anchor[1], { map: World.state.map, mask: World.state.mask }),
    well: World.hexLabel(s.wells[2][0], s.wells[2][1], { map: World.state.map, mask: World.state.mask }),
    bold: World.hexGlyph(s.wells[2][0], s.wells[2][1])[1],
  }), s);
  expect(hover.camp).toBe('the&nbsp;cinder&nbsp;riders.&nbsp;dust,&nbsp;and&nbsp;fires&nbsp;at&nbsp;night.');
  expect(hover.well).toBe('a&nbsp;well');
  expect(hover.bold).toBe(true);
  await page.evaluate(() => World.goHome());
  await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    let placed = 0;
    for (const p of District.neighbours(cap)) {
      if (placed < 5 && Network.districtsFor('capital', p[0], p[1]).includes('walls') && Network.placeDistrict('capital', p[0], p[1], 'walls')) placed++;
    }
    City.setFocus('capital', 'military');
    $SM.set('game.armies.trained["capital"]', 50, true);
    $SM.setM('stores', { bayonet: 40, bolas: 50, 'water cask': 3, 'cured meat': 5000 });
    Engine.saveGame();
  });
  const save = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(save.game.powers.riders.met).toBe(true);
  expect(errors).toEqual([]);
  return { save, site: s };
}

test('the cinder riders broken from a save near them: their camp empty while a well is theirs, the last well lit, the storm the wanderer leads with tanglers; F10 opens pitch', async ({ page, browser }) => {
  test.setTimeout(240000);
  const { save, site } = await ridersSave(page);
  expect(save.version).toBe(2.9);

  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  // where they stand: a desert camp on band 2 (danger 3-5), three wells round it, an army's walk from home
  const where = await p2.evaluate(() => {
    const s = Riders.site(), gen = World.hex.gen;
    return {
      desert: gen.terrain[s.anchor[0]][s.anchor[1]] === WorldGen.TERRAIN.desert, danger: World.baseDangerAt(s.anchor[0], s.anchor[1]),
      wells: s.wells.length, known: Powers.known('riders'), F10: Network.has('F10'),
      route: !!Armies.route(gen, gen.capital, s.anchor, Armies.lit()),
    };
  });
  expect(where).toMatchObject({ desert: true, wells: 3, known: true, F10: false, route: true });
  expect(where.danger).toBeGreaterThanOrEqual(3);
  expect(where.danger).toBeLessThanOrEqual(5);

  // the two lit wells are told on the ticks: the count, and a scene each (a beacon lit on a well)
  for (let k = 0; k < 2; k++) {
    await p2.waitForFunction(() => !Events.activeEvent());
    await p2.evaluate(() => tick());
    if (!k) await expect(p2.locator('#notifications')).toContainText('a well is ours. 1 still theirs.');
    await until(p2, 'a ring of stones in the sand.');
    await choose(p2, 'light a fire on it');
    await choose(p2, 'go on');
  }
  await p2.waitForFunction(() => !Events.activeEvent());

  // the army marches on them from the town panel; a cask carries a hundred water
  await p2.locator('#location_city').click();
  await p2.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await expect(p2.locator('#cityArmies')).toContainText('the cinder riders.');
  await p2.locator('#cityArmies').scrollIntoViewIfNeeded();
  await shot(p2, 'town-march');
  await p2.locator('#power_march_riders').click();
  const a0 = await p2.evaluate(() => Object.assign(JSON.parse(JSON.stringify(Armies.list()[0])), { full: 50 * Armies.WATER_EACH + 3 * Riders.CASK_WATER }));
  expect(a0.power).toBe('riders');
  expect(a0.squads).toEqual({ bayonet: 40, bolas: 10 });
  expect(a0.water).toBe(a0.full);
  expect(a0.water).toBe(800);
  for (let i = 0; i < 300 && (await p2.evaluate(() => Armies.list()[0].state)) === 'march'; i++) await p2.evaluate(() => tick());
  expect(await p2.evaluate(() => Armies.list()[0].state)).toBe('siege');

  // a well still theirs: the camp is empty, they ride off, and the army waits there in vain
  await until(p2, 'the camp is empty when the army gets there. the fires are warm.');
  await shot(p2, 'siege-empty');
  await choose(p2, 'go on');
  await p2.waitForFunction(() => !Events.activeEvent());
  const away = await p2.evaluate(() => {
    for (let i = 0; i < 3; i++) tick();
    const a = Armies.list()[0];
    return { away: a.siege.away, over: a.siege.over, status: Armies.status(a) };
  });
  expect(away.away).toBe(true);
  expect(away.over).toBe(null);
  expect(away.status).toContain('the army waits at the empty camp.');
  await expect(p2.locator('#notifications')).toContainText("the riders rode off. they'll be at the wells.");

  // the last well lit: they have nowhere to ride; the camp stands, and the storm waits for the wanderer
  const last = await p2.evaluate((w) => {
    const ok = lineTo({ at: w }) && Network.raiseBeacon(w[0], w[1]);
    Network.refresh();
    return ok && Riders.allHeld();
  }, site.wells[2]);
  expect(last).toBe(true);
  await p2.evaluate(() => tick());
  await expect(p2.locator('#notifications')).toContainText('the last well is ours. they have nowhere to ride.');
  await until(p2, "the riders don't run now. they wait at the camp, mounted.");
  await shot(p2, 'siege-stand');
  await choose(p2, 'go on');
  await p2.waitForFunction(() => !Events.activeEvent());
  const breach = await p2.evaluate(() => ({ over: Armies.list()[0].siege.over, at: Armies.list()[0].at }));
  expect(breach.over.breach).toBe(true);
  await expect(p2.locator('#notifications')).toContainText('the riders wait at the camp, mounted. the army waits for the wanderer.');

  // the wanderer goes to the army: they break for the sand, the bolas go out after them
  await trek(p2);
  const bolas = await p2.evaluate(() => Armies.list()[0].ammo.bolas);
  await p2.evaluate((at) => stepOnto(at), breach.at);
  await expect(p2.locator('#event')).toContainText('they break for the open sand. the bolas go out after them.');
  await shot(p2, 'storm-open');
  await choose(p2, 'go on');
  await expect(p2.locator('#squad_bayonet')).toHaveCount(1);
  await expect(p2.locator('#squad_bolas')).toHaveCount(1);
  expect(await p2.evaluate(() => Armies.list()[0].ammo.bolas)).toBe(bolas - 10); // the opening throw, a bolas a tangler
  const start = await p2.evaluate(() => Armies.soldiers(Armies.list()[0]));
  for (let i = 0; i < 160 && !(await p2.evaluate(() => Events.won)); i++) {
    for (const id of ['#squad_bayonet', '#squad_bolas']) {
      const b = p2.locator(id);
      if (await b.count() && !(await b.evaluate((el) => $(el).hasClass('disabled')))) await b.click();
    }
    if (i % 3 === 0) await shot(p2, 'storm');
    await p2.waitForTimeout(250);
  }
  expect(await p2.evaluate(() => Events.won)).toBe(true);
  await expect(p2.locator('#event')).toContainText('the last of them come down off their mounts.');
  await shot(p2, 'storm-won');
  expect(await p2.evaluate(() => Armies.soldiers(Armies.list()[0]))).toBeGreaterThan(start / 2);
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText("under it, the same coat as the garrison's.");
  await shot(p2, 'broken');
  await choose(p2, 'take them in');
  await expect(p2.locator('#event')).toContainText('they come in on foot, leading the mounts.');
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('the tar pits are quiet. the keepers come out on the planks to look.');
  await shot(p2, 'pits');
  await choose(p2, 'good');
  await p2.waitForFunction(() => !Events.activeEvent());

  // broken for good: F10, the riders taken in, their camp no rival's; the tar-keepers' quest ends with them
  await p2.evaluate(() => World.goHome());
  await p2.evaluate(() => CityStates.playQueued());
  await settle(p2);
  const r = await p2.evaluate((s) => {
    const tk = CityStates.list().filter((c) => c.t === 'tar_keepers')[0], st = CityStates.state(tk.id);
    return {
      F10: Network.has('F10'), broken: Powers.broken('riders'), way: Powers.state('riders').way, trained: Armies.trained('capital'),
      sphere: CityStates.spheres().some((p) => p.at[0] === s.anchor[0] && p.at[1] === s.anchor[1]),
      march: Powers.cantMarch('capital', 'riders'), quest: !!st.quest, joined: !!st.city,
    };
  }, site);
  expect(r).toMatchObject({ F10: true, broken: true, way: 'take', sphere: false, march: "they're yours.", quest: true, joined: true });
  expect(r.trained).toBeGreaterThanOrEqual(10);
  expect(errors).toEqual([]);
});

test('without tanglers they ride off from the storm; without the mirrors (B9) a lit well is not ours; sent into the desert, they leave pitch', async ({ page, browser }) => {
  test.setTimeout(240000);
  const { save, site } = await ridersSave(page);
  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  // the mirrors gone: the wells' beacons burn, but not across the open sand to them
  const mirrors = await p2.evaluate((w) => {
    lineTo({ at: w });
    Network.raiseBeacon(w[0], w[1]);
    Network.refresh();
    const lit = Riders.wells().every((p) => Riders.litBeacon(p[0], p[1]));
    $SM.set('game.network.tiers.B9', false);
    const without = Riders.held();
    $SM.set('game.network.tiers.B9', true);
    return { lit, without, with: Riders.held() };
  }, site.wells[2]);
  expect(mirrors).toEqual({ lit: true, without: 0, with: 3 });

  // an army with no bolas, the wells all ours: the camp stands, the walls are none, it waits for the wanderer
  const r = await p2.evaluate(() => {
    window.playQueued = CityStates.playQueued;
    CityStates.playQueued = () => {};
    $SM.setM('stores', { bolas: 0, bayonet: 50 });
    Powers.marchOn('capital', 'riders');
    for (let i = 0; i < 300 && Armies.list()[0].state === 'march'; i++) tick();
    tick();
    CityStates._queue = [];
    const a = Armies.list()[0];
    return { squads: Object.keys(a.squads), n: Armies.soldiers(a), over: a.siege.over, at: a.at };
  });
  expect(r.squads).toEqual(['bayonet']);
  expect(r.over.breach).toBe(true);
  await trek(p2);
  await p2.evaluate((at) => stepOnto(at), r.at);
  await expect(p2.locator('#event')).toContainText('they break for the open sand. nothing goes out after them.');
  await shot(p2, 'loose');
  await choose(p2, 'go back');
  await p2.waitForFunction(() => !Events.activeEvent());
  const still = await p2.evaluate(() => ({ over: Armies.list()[0].siege.over, n: Armies.soldiers(Armies.list()[0]), broken: Powers.broken('riders') }));
  expect(still.over.breach).toBe(true);
  expect(still.n).toBe(r.n); // they rode off: no one lost
  expect(still.broken).toBe(false);

  // broken anyway (the storm won by hand), and sent into the desert: pitch into the army's city
  await p2.evaluate(() => World.goHome());
  const sent = await p2.evaluate(() => {
    const id = Armies.list()[0].id, coal = $SM.get('stores.coal', true);
    Powers.won(id);
    Powers.breakIt(id, 'send');
    return { F10: Network.has('F10'), way: Powers.state('riders').way, pitch: $SM.get('stores.pitch', true), coal: $SM.get('stores.coal', true) === coal };
  });
  expect(sent).toEqual({ F10: true, way: 'send', pitch: 100, coal: true }); // Powers.HEAD_START, pitch for the riders
  expect(errors).toEqual([]);
});
