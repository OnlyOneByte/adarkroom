// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, townWithCityStates, choose } from './helpers.js';

// the flame era, and the blaze era up to the foundry: coke (F9), the bloomery (H9), the top tier (H10)
const TIERS = ['F5', 'F6', 'F7', 'F8', 'F9', 'B5', 'B6', 'B7', 'B8', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10'];
// frames for the PR's pictures (FRAMES=dir); none by default
const FRAMES = process.env.FRAMES;
const shot = async (page, name) => { if (FRAMES) await page.screenshot({ path: `${FRAMES}/${name}.png` }); };

// the ticks by hand (the fire, the city-states, the armies), on a loaded page
const helpers = () => {
  clearTimeout(Events._eventTimeout);
  clearTimeout(Network._tickTimeout);
  clearTimeout(CityStates._tickTimeout);
  clearTimeout(Armies._tickTimeout);
  clearTimeout(Engine._incomeTimeout);
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

// a trek outfitted the player's way: the path's tab, cured meat packed with the outfitting buttons (no more
// than the bag holds), then the embark button. Returns the bag's header ('free n/m')
async function trek(page) {
  if (!(await page.evaluate(() => Engine.activeModule === Path))) await page.locator('#location_path').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await page.evaluate(() => Path.updateOutfitting());
  for (let i = 0; i < 3; i++) await page.locator('#outfit_row_cured-meat .upManyBtn').click();
  const bag = await page.locator('#bagspace').textContent();
  await page.locator('#embarkButton').click();
  await page.waitForFunction(() => Engine.activeModule === World && !$('#outerSlider').is(':animated'));
  await page.evaluate(() => { Math.random = () => 0.99; }); // no fights
  return bag;
}
const free = (bag) => Number(/free (-?\d+)\//.exec(bag)[1]);

// A save near the foundry (seed 4242): the blaze era to H10, its chimney seen and its gate met on a trek, a
// coke line lit to its walls; the capital on military focus with walls, 70 soldiers, 50 bayonets, 4 rams,
// an armoury with its grenadiers set to work and the steel and sulphur they need
async function foundrySave(page) {
  const errors = await townWithCityStates(page);
  await page.evaluate((TIERS) => {
    TIERS.forEach((id) => $SM.set('game.network.tiers.' + id, true));
    $SM.setM('game.network.story', { charcoalWay: 'their', smoke: 'look', garrisonMarked: true, harbourSeen: true });
    $SM.setM('stores', { coke: 100000 });
    Network.tick(); clearTimeout(Network._tickTimeout);
  }, TIERS);
  await page.evaluate(helpers);
  const site = await page.evaluate(() => ({ at: Foundry.anchor(), hexes: Foundry.site().hexes, cap: World.hex.gen.capital }));
  expect(site.at).not.toBe(null);
  // the line to its walls: beacons from the capital to a hex next to the site
  expect(await page.evaluate(() => lineTo({ at: Foundry.anchor() }))).toBe(true);

  // the trek: the chimney seen from the hills, then the gate
  const bag = await trek(page);
  expect(free(bag)).toBeGreaterThanOrEqual(0);
  await page.evaluate((at) => {
    const n = District.neighbours(at).filter((p) => !World.siteAt(p[0], p[1]) && World.canEnter(World.state.map[p[0]][p[1]]))[0];
    stepOnto(n);
  }, site.at);
  await expect(page.locator('#event')).toContainText('smoke. a great deal of it, from one chimney.');
  await expect(page.locator('#event')).toContainText('the chimney is taller than any tree.');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  expect(await page.evaluate((at) => Network.hexNote(at[0], at[1]), site.at)).toContain('the&nbsp;furnace&nbsp;was&nbsp;never&nbsp;let&nbsp;go&nbsp;out.');
  await page.evaluate((at) => stepOnto(at), site.at);
  await expect(page.locator('#event')).toContainText('a gun sits over it, short and fat. a cannon.');
  await expect(page.locator('#event .button', { hasText: 'ask about the forge-masters' })).toHaveCount(0); // not met yet
  await choose(page, 'ask who the guns are for');
  await expect(page.locator('#event')).toContainText("says the war. says it'll want them back.");
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  expect(await page.evaluate(() => Powers.known('foundry'))).toBe(false); // known once the trek is home
  await page.evaluate(() => World.goHome());
  await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    let placed = 0;
    for (const p of Fire.around(cap[0], cap[1], 2)) {
      if (placed < 7 && Network.districtsFor('capital', p[0], p[1]).includes('walls') && Network.placeDistrict('capital', p[0], p[1], 'walls')) placed++;
    }
    City.setFocus('capital', 'military');
    $SM.set('game.armies.trained["capital"]', 70, true);
    $SM.setM('stores', { bayonet: 50, ram: 4, steel: 2000, sulphur: 2000, iron: 1000, coal: 1000, 'cured meat': 8000 });
    $SM.set('game.buildings["armoury"]', 1);
    $SM.set('game.buildings["steelworks"]', 1);
    $SM.set('game.population', 80);
    $SM.set('game.workers["grenadier"]', 10);
    $SM.set('game.workers["steelworker"]', 5);
    Engine.saveGame();
  });
  expect(await page.evaluate(() => Powers.known('foundry'))).toBe(true);
  const save = await page.evaluate(() => JSON.parse(localStorage.gameState));
  expect(errors).toEqual([]);
  return { save, site };
}

test('the foundry broken from a save near it: grenades from coke steel, brick that shrugs off rams, no starving them, the breach, the storm the wanderer leads, the furnace kept lit; H11', async ({ page, browser }) => {
  test.setTimeout(300000);
  if (FRAMES) fs.mkdirSync(FRAMES, { recursive: true });
  const { save, site } = await foundrySave(page);
  expect(save.version).toBe(2.9); // (no new save version: the foundry's state defaults lazily)

  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  // the same world: the generator moves the same complex for it on every load
  expect(await p2.evaluate(() => Foundry.anchor())).toEqual(site.at);
  // ... and the fleet, put out on the water at game time, takes another complex (it skips a power's)
  expect(await p2.evaluate(() => { const f = Fleet.site(); return !f || f !== Foundry.site(); })).toBe(true);

  // with coke, a steelworker makes twice the steel; the grenadiers make the first grenades
  const steel = await p2.evaluate(() => { Outside.updateVillageIncome(); return { per: Outside._INCOME.steelworker.stores.steel, income: $SM.getIncome('steelworker').stores.steel }; });
  expect(steel).toEqual({ per: 2, income: 10 }); // (Foundry.COKE_STEEL, 5 steelworkers)
  // (the income ticks by hand until the armoury's turn comes round)
  const turns = await p2.evaluate(() => {
    let i = 0;
    for (; i < 30 && !($SM.get('stores.grenade', true) > 0); i++) { $SM.collectIncome(); clearTimeout(Engine._incomeTimeout); }
    return i;
  });
  expect(turns).toBeLessThan(30);
  await expect(p2.locator('#event')).toContainText('the soldiers hold them like eggs.');
  await expect(p2.locator('#notifications')).toContainText('the armoury has made grenades');
  await shot(p2, '01-grenades');
  await choose(p2, 'go on');
  await p2.waitForFunction(() => !Events.activeEvent());
  const made = await p2.evaluate(() => $SM.get('stores.grenade', true));
  expect(made).toBeGreaterThanOrEqual(10);
  // (the rest of the bombers' grenades, as more turns of the armoury would make them)
  await p2.evaluate((made) => $SM.add('stores.grenade', 100 - made), made);

  // the army marches on them from the town panel
  await p2.evaluate(() => tick());
  await p2.locator('#location_city').click();
  await p2.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await expect(p2.locator('#cityArmies')).toContainText('the foundry.');
  await p2.locator('#cityArmies').scrollIntoViewIfNeeded();
  await shot(p2, '02-march');
  await p2.locator('#power_march_foundry').click();
  const a0 = await p2.evaluate(() => JSON.parse(JSON.stringify(Armies.list()[0])));
  expect(a0.power).toBe('foundry');
  expect(a0.squads).toEqual({ bayonet: 50, grenade: 20 });
  expect(a0.gear.ram).toBe(4);
  for (let i = 0; i < 300 && (await p2.evaluate(() => Armies.list()[0].state)) === 'march'; i++) await p2.evaluate(() => tick());
  expect(await p2.evaluate(() => Armies.list()[0] && Armies.list()[0].state)).toBe('siege');

  // the camp: the rams ring off the brick; waiting them out, their stores don't fall
  await p2.evaluate(() => CityStates.playQueued());
  await expect(p2.locator('#event')).toContainText('the rams ring off the brick.');
  await expect(p2.locator('#event')).toContainText('they dig their own iron.');
  await shot(p2, '03-camp');
  await choose(p2, 'wait them out');
  await p2.waitForFunction(() => !Events.activeEvent());
  await expect(p2.locator('#notifications')).toContainText("the foundry doesn't eat less. they'll outlast us.");
  const fed = await p2.evaluate(() => {
    const before = Armies.list()[0].siege.stores;
    for (let i = 0; i < 5; i++) quiet(() => Armies.update());
    const s = Armies.list()[0].siege;
    return { before, after: s.stores, supplied: s.supplied, walls: s.walls };
  });
  expect(fed.after).toBe(fed.before);
  expect(fed.supplied).toBe(true);
  expect(fed.walls).toBe(800); // (the forge-masters not won: all of its brick)

  // press the walls: 4 rams wear none of the brick; each grenade thrown brings down GRENADE_HIT
  await p2.evaluate(() => Armies.stance(Armies.list()[0].id, 'press'));
  const press = await p2.evaluate(() => {
    const a = Armies.list()[0], thrown = Math.min(a.squads.grenade, a.ammo.grenade);
    quiet(() => Armies.update());
    const b = Armies.list()[0];
    return { thrown, worn: 800 - b.siege.walls, rams: b.gear.ram, hit: Foundry.GRENADE_HIT };
  });
  expect(press.rams).toBe(4);
  expect(press.worn).toBe(press.thrown * press.hit);
  for (let i = 0; i < 30 && !(await p2.evaluate(() => !!(Armies.list()[0].siege.over))); i++) {
    await p2.evaluate(() => quiet(() => Armies.update()));
  }
  const breach = await p2.evaluate(() => ({ over: Armies.list()[0].siege.over, walls: Armies.list()[0].siege.walls, at: Armies.list()[0].at }));
  expect(breach.over.breach).toBe(true);
  expect(breach.walls).toBe(0);
  await expect(p2.locator('#notifications')).toContainText('the grenades go over the wall. the brick comes down in a cloud.');
  await expect(p2.locator('#notifications')).toContainText('the army waits for the wanderer.');

  // the wanderer goes to the army: the storm at the furnace door, the squads beside the wanderer's weapons
  const bag = await trek(p2);
  expect(free(bag)).toBeGreaterThanOrEqual(0);
  await p2.evaluate((at) => stepOnto(at), breach.at);
  await expect(p2.locator('#event')).toContainText('the brick comes down in a cloud.');
  await choose(p2, 'go on');
  await expect(p2.locator('#squad_bayonet')).toHaveCount(1);
  await expect(p2.locator('#squad_grenade')).toHaveCount(1);
  await expect(p2.locator('#stormArmy')).toBeVisible();
  await expect(p2.locator('#notifications')).toContainText('they fight at the furnace door, in the heat.');
  const start = await p2.evaluate(() => Armies.soldiers(Armies.list()[0]));
  for (let i = 0; i < 160 && !(await p2.evaluate(() => Events.won)); i++) {
    for (const id of ['#squad_bayonet', '#squad_grenade']) {
      const b = p2.locator(id);
      if (await b.count() && !(await b.evaluate((el) => $(el).hasClass('disabled')))) await b.click();
    }
    if (i % 2 === 0) await shot(p2, `04-storm-${String(i).padStart(3, '0')}`);
    await p2.waitForTimeout(250);
  }
  expect(await p2.evaluate(() => Events.won)).toBe(true);
  await expect(p2.locator('#event')).toContainText('the crew lay down hammers, not rifles.');
  const left = await p2.evaluate(() => Armies.soldiers(Armies.list()[0]));
  expect(left).toBeGreaterThan(start / 2);
  await choose(p2, 'go on');
  // the aftermath: the furnace can't go out, and there's no letting it
  await expect(p2.locator('#event')).toContainText("says if it goes out it cracks.");
  await expect(p2.locator('#event .button', { hasText: 'let it go out' })).toHaveCount(0);
  await shot(p2, '05-broken');
  await choose(p2, 'keep it lit');
  await expect(p2.locator('#event')).toContainText('our stokers go in beside theirs. no one stops feeding it.');
  await choose(p2, 'take them in');
  await p2.waitForFunction(() => !Events.activeEvent());

  // home: H11's scene straight after (its beat came with the foundry: Fire.unlock('H11'))
  await p2.evaluate(() => { World.goHome(); tick(); });
  await expect(p2.locator('#event')).toContainText('the furnace stands three men high. it was never let go out.');
  await choose(p2, 'go on');
  await expect(p2.locator('#event')).toContainText('the iron comes out of it running, like water.');
  await shot(p2, '06-furnace');
  await choose(p2, 'good');
  await p2.waitForFunction(() => !Events.activeEvent());
  const r = await p2.evaluate((site) => ({
    H11: Network.has('H11'), taken: Network.flag('foundryTaken'), broken: Powers.broken('foundry'), way: Powers.state('foundry').way,
    trained: Armies.trained('capital'), after: !!$SM.get('game.armies.after["capital"]'), coal: $SM.get('stores.coal', true),
    sphere: CityStates.spheres().some((p) => p.at[0] === site.at[0] && p.at[1] === site.at[1]),
    march: Powers.cantMarch('capital', 'foundry'), garrison: Powers.broken('garrison'),
  }), site);
  expect(r).toMatchObject({ H11: true, taken: true, broken: true, way: 'take', after: true, sphere: false, march: "they're yours.", garrison: false });
  expect(r.trained).toBeGreaterThanOrEqual(10);
  expect(errors).toEqual([]);
});

test('the foundry with no grenades: rams and charges shrug off its brick (200 less of it, the forge-masters won first), waiting them out the army goes hungry first; grenades wait for coke', async ({ page, browser }) => {
  test.setTimeout(240000);
  const { save } = await foundrySave(page);
  const p2 = await browser.newPage();
  const errors = await openGame(p2, { save });
  await p2.evaluate(helpers);
  const r = await p2.evaluate(() => {
    // no grenades: the grenadiers stood down, and any an income tick made before the helpers ran are gone
    $SM.set('game.workers["grenadier"]', 0);
    $SM.setM('stores', { 'blasting charge': 4, grenade: 0 });
    // the forge-masters won before the siege (joined: their price, influence or force)
    const masters = CityStates.list().find((c) => c.t === 'forge_masters');
    CityStates.join(masters, 'influence');
    quiet(() => {
      Powers.marchOn('capital', 'foundry');
      for (let i = 0; i < 300 && Armies.list()[0].state === 'march'; i++) tick();
    });
    const id = Armies.list()[0].id, walls = Armies.byId(id).siege.walls;
    Armies.stance(id, 'press');
    let worn = 0, ticks = 0;
    for (; ticks < 100 && Armies.byId(id) && !Armies.byId(id).siege.over; ticks++) {
      const w = Armies.byId(id).siege.walls;
      quiet(() => Armies.update());
      worn += w - Armies.byId(id).siege.walls;
    }
    const a = Armies.byId(id);
    return { walls, won: Foundry.mastersWon(), worn, over: a.siege.over, charges: a.gear['blasting charge'], rams: a.gear.ram, ticks };
  });
  expect(r.won).toBe(true);
  expect(r.walls).toBe(800 - 200); // (Foundry.MASTERS_BRICK)
  expect(r.worn).toBe(0);
  expect(r.charges).toBe(4);
  expect(r.over.broken).toBe(true); // the cannon break the line under the walls
  // waiting them out (the save again): the army's meat runs out, theirs never does
  const p3 = await browser.newPage();
  const errors3 = await openGame(p3, { save });
  await p3.evaluate(helpers);
  const w = await p3.evaluate(() => {
    quiet(() => {
      Powers.marchOn('capital', 'foundry');
      for (let i = 0; i < 300 && Armies.list()[0].state === 'march'; i++) tick();
    });
    const id = Armies.list()[0].id;
    Armies.stance(id, 'wait');
    const stores = Armies.byId(id).siege.stores;
    let ticks = 0;
    for (; ticks < 200 && Armies.byId(id) && !Armies.byId(id).siege.over; ticks++) quiet(() => Armies.update());
    const a = Armies.byId(id);
    return { over: a && a.siege.over, stores: a && a.siege.stores, was: stores, ticks, packed: Armies.FOOD_TICKS };
  });
  expect(w.over.broken).toBe(true);
  expect(w.stores).toBe(w.was);
  expect(w.ticks).toBeGreaterThan(w.packed);
  // no coke, no grenadier, and the steelworks make plain steel
  const nc = await p3.evaluate(() => {
    $SM.set('game.network.tiers.F9', false);
    Foundry.cokeSteel();
    return { steel: Outside._INCOME.steelworker.stores.steel, needs: Outside._INCOME.grenadier.needs };
  });
  expect(nc).toEqual({ steel: 1, needs: 'F9' });
  expect(errors).toEqual([]);
  expect(errors3).toEqual([]);
});
