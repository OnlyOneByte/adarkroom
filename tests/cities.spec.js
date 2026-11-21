// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState, freshToTown } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

// A fresh game with the town open and every ember tier, tallow in stock, and helpers to found cities.
async function townToFound(page) {
  const { errors } = await freshToTown(page);
  await page.evaluate(() => {
    clearTimeout(Events._eventTimeout);
    clearTimeout(Network._tickTimeout);
    Network._nextAsk = Date.now() + 1e9; // no story scenes
    const t = {};
    ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'].forEach((id) => { t[id] = true; });
    $SM.set('game.network.tiers', t);
    $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnDone: true });
    $SM.setM('stores', { tallow: 1000, 'cured meat': 200 });
    $SM.set('game.population', 80);
    window.burnTick = () => Network.tick();
    burnTick();
    const g = World.hex.gen, cap = g.capital;
    window.isLit = (p) => !!World.hex.fire.lit[p[0] + p[1] * g.cols];
    // a lit, open hex with room for a city, at least `min` hexes from the capital
    window.blankSite = (min = 3) => {
      for (const p of Fire.around(cap[0], cap[1], 6)) {
        if (Fire.distance(p, cap) < min || World.siteAt(p[0], p[1])) continue;
        World.hex.mask[p[0]] && (World.hex.mask[p[0]][p[1]] = World.hex.mask[p[0]][p[1]] || isLit(p));
        const f = Network.foundingSite(p[0], p[1]);
        if (f && WorldGen.isPassable(World.hex.map[p[0]][p[1]]) && World.hex.map[p[0]][p[1]] !== WorldGen.TERRAIN.ocean) return p;
      }
      return null;
    };
    // out on a trek with what is waiting, then a step onto the hex from a neighbour
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
  });
  return errors;
}

test('settlers found a city on lit land: the cost, the trek, the new hearth', async ({ page }) => {
  const errors = await townToFound(page);
  const r = await page.evaluate(() => {
    const cap = World.hex.gen.capital;
    // not on dark land, not next to a city
    const dark = Fire.around(cap[0], cap[1], 12).find((p) => World.hex.mask[p[0]] && !isLit(p) && Fire.distance(p, cap) > 8);
    const next = WorldGen.neighbour(cap[0], cap[1], 0);
    const refused = { dark: Network.foundingSite(dark[0], dark[1]), next: Network.foundingSite(next[0], next[1]) };
    const at = blankSite();
    const before = { people: $SM.get('game.population'), wood: $SM.get('stores.wood'), meat: $SM.get('stores["cured meat"]') };
    const sent = Network.sendSettlers('capital', at[0], at[1]);
    const again = Network.cantSend('capital');
    const waiting = { s: JSON.parse(JSON.stringify(Network.settlers())), people: $SM.get('game.population'), wood: $SM.get('stores.wood'), meat: $SM.get('stores["cured meat"]') };
    embark();
    const out = Network.settlers().out;
    stepOnto(at);
    const c = JSON.parse(JSON.stringify($SM.get('game.cities.city2')));
    burnTick();
    return { refused, at, before, sent, again, waiting, out, c, after: $SM.get('game.cities.city2'), tile: World.hex.map[at[0]][at[1]],
      home: Engine.activeModule === Path, settlers: Network.settlers(), litHome: isLit(at) };
  });
  expect(r.refused).toEqual({ dark: null, next: null });
  expect(r.sent).toBe(true);
  expect(r.again).toBe('settlers are already on their way');
  expect(r.waiting.people).toBe(r.before.people - 8);
  expect(r.waiting.wood).toBe(r.before.wood - 40);
  expect(r.waiting.meat).toBe(r.before.meat - 20);
  expect(r.waiting.s).toMatchObject({ from: 'capital', to: r.at, people: 8, resettle: false, out: false });
  expect(r.out).toBe(true);
  // the city, its hearth quarter on the site, the settlers' supplies as its stores
  expect(r.c).toMatchObject({ name: 'second town', focus: null, population: { citizens: 8 }, parent: 'capital',
    stores: { wood: 40, 'cured meat': 20 }, hex: r.at, districts: { [r.at.join(',')]: 'hearth quarter' } });
  // it is ours: home, and the trek ended there
  expect(r.tile).toBe('A');
  expect(r.home).toBe(true);
  expect(r.settlers).toBeNull();
  // its hearth burns its own wood: 8 people want a third of a town hearth's fire
  expect(r.after.hearth.fuel).toBe('wood');
  expect(r.after.hearth.out).toBe(6);
  expect(r.litHome).toBe(true);
  expect(errors).toEqual([]);
});

test('settlers lost on a trek wait by the dropped pack; the corpse run brings back who held out', async ({ page }) => {
  const errors = await townToFound(page);
  const r = await page.evaluate(() => {
    const at = blankSite();
    Network.sendSettlers('capital', at[0], at[1]);
    embark();
    // they fall a step short of the site
    World.curPos = [0, 1, 2, 3, 4, 5].map((d) => WorldGen.neighbour(at[0], at[1], d)).find((n) => World.canEnter(World.state.map[n[0]][n[1]]) && World.state.map[n[0]][n[1]] !== 'A');
    World.die();
    const pack = $SM.get('game.world.pack');
    const lost = Network.settlers();
    const label = World.packLabel(pack);
    return { at, pack, lost, label };
  });
  expect(r.lost).toBeNull();
  expect(r.pack.settlers).toMatchObject({ from: 'capital', people: 8, stores: { wood: 40, 'cured meat': 20 } });
  expect(r.label).toContain('settlers&nbsp;8');
  // home again after the death's fade, then the corpse run
  await page.waitForFunction(() => Engine.activeModule === Room && !World.dead || !Engine.keyLock, null, { timeout: 10000 });
  await page.waitForTimeout(3500);
  const r2 = await page.evaluate((at) => {
    embark();
    World.state.pack.left = 0.5; // the scavengers have had half
    const pack = World.state.pack;
    World.curPos = pack.at.slice();
    World.doSpace();
    const back = Network.settlers();
    stepOnto(at);
    return { back, c: $SM.get('game.cities.city2') };
  }, r.at);
  expect(r2.back).toMatchObject({ people: 4, stores: { wood: 20, 'cured meat': 10 }, out: true });
  expect(r2.c.population.citizens).toBe(4);
  expect(r2.c.stores).toEqual({ wood: 20, 'cured meat': 10 });
  expect(errors).toEqual([]);
});

test('settlers home without reaching the site wait for the next trek; called off, they unpack', async ({ page }) => {
  const errors = await townToFound(page);
  const r = await page.evaluate(() => {
    const at = blankSite();
    Network.sendSettlers('capital', at[0], at[1]);
    embark();
    World.goHome();
    const waiting = Network.settlers();
    const before = { people: $SM.get('game.population'), wood: $SM.get('stores.wood') };
    Network.callOff();
    return { waiting, before, people: $SM.get('game.population'), wood: $SM.get('stores.wood'), left: Network.settlers() };
  });
  expect(r.waiting.out).toBe(false);
  expect(r.people).toBe(r.before.people + 8);
  expect(r.wood).toBe(r.before.wood + 40);
  expect(r.left).toBeNull();
  expect(errors).toEqual([]);
});

test('a site gone dark while the settlers walk: they will not stay, and go home with what they carried', async ({ page }) => {
  const errors = await townToFound(page);
  const r = await page.evaluate(() => {
    const at = blankSite();
    Network.sendSettlers('capital', at[0], at[1]);
    const before = { people: $SM.get('game.population'), wood: $SM.get('stores.wood') };
    embark();
    // the hearth goes cold behind them
    World.hex.fire.lit.fill(0);
    Network.refresh = () => {};
    stepOnto(at);
    return { before, people: $SM.get('game.population'), wood: $SM.get('stores.wood'), city: $SM.get('game.cities.city2') || null, settlers: Network.settlers() };
  });
  expect(r.city).toBeNull();
  expect(r.settlers).toBeNull();
  expect(r.people).toBe(r.before.people + 8);
  expect(r.wood).toBe(r.before.wood + 40);
  expect(errors).toEqual([]);
});

test('a lit fallen city is resettled: old districts by its size, and the first one starts the charcoal stranger', async ({ page }) => {
  const errors = await townToFound(page);
  const r = await page.evaluate(() => {
    const g = World.hex.gen, cap = g.capital;
    // the nearest fallen city, lit by a hearth the test sets there (a stand-in for a beacon line)
    const site = g.sites.filter((s) => s.kind === 'fallenCity')
      .sort((a, b) => Fire.distance(a.anchor, cap) - Fire.distance(b.anchor, cap))[0];
    site.hexes.forEach((h) => { World.hex.mask[h[0]][h[1]] = true; });
    const fire = World.hex.fire;
    site.hexes.concat(Fire.around(site.anchor[0], site.anchor[1], 3)).forEach((h) => { fire.lit[h[0] + h[1] * g.cols] = 1; });
    const f = Network.foundingSite(site.hexes[site.hexes.length - 1][0], site.hexes[site.hexes.length - 1][1]);
    const sent = Network.sendSettlers('capital', site.anchor[0], site.anchor[1]);
    embark();
    World.hex.fire = fire; // keep the stand-in light through the trek
    Network.refresh = () => {};
    stepOnto(site.anchor);
    const c = $SM.get('game.cities.city2');
    return { size: site.hexes.length, anchor: site.anchor, f, sent, c, story: $SM.get('game.network.story') };
  });
  expect(r.f.at).toEqual(r.anchor); // any hex of the site resettles it from its old centre
  expect(r.f.site).toBeTruthy();
  expect(r.sent).toBe(true);
  const old = Object.entries(r.c.districts).filter(([, t]) => t !== 'hearth quarter');
  const want = r.size <= 4 ? 1 : r.size <= 6 ? 2 : 3;
  expect(old.length).toBeLessThanOrEqual(want);
  expect(old.length).toBeGreaterThan(0);
  expect(r.c.districts[r.anchor.join(',')]).toBe('hearth quarter');
  expect(r.story.resettled).toBe(1);
  expect(r.story['the charcoal stranger']).toBe('city2');
  expect(errors).toEqual([]);
});

test('the town panel switches between cities: each shows its own people, stores and buildings', async ({ page }) => {
  const errors = await townToFound(page);
  await page.evaluate(() => {
    const at = blankSite();
    Network.sendSettlers('capital', at[0], at[1]);
    embark();
    stepOnto(at);
  });
  await page.waitForFunction(() => !$('#outerSlider').is(':animated'));
  await page.locator('#location_city').click();
  await expect(page.locator('#citySwitch')).toBeVisible();
  await expect(page.locator('#cityStores')).toHaveCount(0); // the capital keeps the village's stockpile
  await page.locator('#city_switch_city2').click();
  await expect(page.locator('#citizens')).toHaveText('citizens 8/0');
  await expect(page.locator('#city_store_wood .row_val')).toHaveText('40');
  await expect(page.locator('#city_workers_row_gatherer')).toBeVisible();
  // a building paid from this city's stores: the woodshed (100 wood)
  const r = await page.evaluate(() => {
    $SM.set('game.cities.city2.stores.wood', 150);
    const built = City.buildIn('city2', 'woodshed');
    return { built, wood: $SM.get('game.cities.city2.stores.wood'), capital: $SM.get('game.cities.capital.buildings.woodshed') || 0, status: $('#fireStatus').text() };
  });
  expect(r).toMatchObject({ built: true, wood: 50, capital: 0 });
  await page.locator('#city_switch_capital').click();
  await expect(page.locator('#cityStores')).toHaveCount(0);
  await expect(page.locator('#city_workers_row_gatherer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a city focused on fire runs itself: gatherers to the hearth, a woodshed when it can, one notice when it goes cold', async ({ page }) => {
  const errors = await townToFound(page);
  const r = await page.evaluate(() => {
    const at = blankSite();
    Network.sendSettlers('capital', at[0], at[1]);
    embark();
    stepOnto(at);
    City.setFocus('city2', 'fire');
    const workers = $SM.get('game.cities.city2.workers');
    const notes = [];
    const notify = Notifications.notify;
    Notifications.notify = (m, t) => { notes.push(t); notify.call(Notifications, m, t); };
    // two hours of fire ticks, paid out at the jobs' pace
    let cold = 0;
    for (let i = 0; i < 720; i++) {
      for (const j in $SM.get('game.cities.city2.workers')) {
        const n = $SM.get('game.cities.city2.workers')[j], inc = City._INCOME[j];
        if (!n) continue;
        const st = {};
        for (const s in inc.stores) st[s] = inc.stores[s] * n * City.jobShare('city2', j);
        const ok = Object.keys(st).every((s) => $SM.get('game.cities.city2.stores["' + s + '"]', true) + st[s] >= 0);
        if (ok) $SM.addM('game.cities.city2.stores', st, true);
      }
      burnTick();
      if (!($SM.get('game.cities.city2.hearth.out') > 0)) cold++;
    }
    const after = $SM.get('game.cities.city2');
    // then the wood runs out and nobody can make more
    $SM.set('game.cities.city2.workers', {});
    City.setFocus('city2', null);
    $SM.set('game.cities.city2.stores', {});
    burnTick();
    City.setFocus('city2', 'fire');
    $SM.set('game.cities.city2.population.citizens', 0);
    burnTick(); burnTick(); burnTick();
    return { workers, cold, after, notes };
  });
  expect(r.workers.gatherer).toBe(8);
  expect(r.cold).toBe(0);
  expect(r.after.buildings.woodshed).toBe(1);
  expect(r.notes.filter((n) => n === 'the hearth in the fire town has gone cold.')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('ember chains in a founded city pay into its own stores', async ({ page }) => {
  const errors = await townToFound(page);
  const r = await page.evaluate(() => {
    const at = blankSite();
    Network.sendSettlers('capital', at[0], at[1]);
    embark();
    stepOnto(at);
    $SM.set('game.cities.city2.buildings', { woodshed: 1 });
    $SM.set('game.cities.city2.stores', { wood: 100, meat: 100, fur: 100, oak: 10 });
    $SM.set('game.cities.city2.workers', { drier: 1, seasoner: 1 });
    // the chains on a district each, the way the land view places them (the test owns the ground)
    City.maximum = () => 1;
    City.jobSlots = () => 9;
    $SM.setM('game.cities.city2.workers', { tanner: 1, charcutier: 1, renderer: 1 });
    City.updateIncome();
    const capital = { 'dry wood': $SM.get('stores["dry wood"]', true), leather: $SM.get('stores.leather', true) };
    for (const k in $SM.get('income')) if (k.indexOf('city2:') === 0) $SM.set('income["' + k + '"].timeLeft', 0);
    $SM.collectIncome();
    clearTimeout(Engine._incomeTimeout);
    return { stores: $SM.get('game.cities.city2.stores'), capital, capAfter: { 'dry wood': $SM.get('stores["dry wood"]', true), leather: $SM.get('stores.leather', true) } };
  });
  expect(r.stores['dry wood']).toBe(2);
  expect(r.stores['seasoned oak']).toBe(1);
  expect(r.stores.leather).toBe(1);
  expect(r.stores['cured meat']).toBe(1);
  expect(r.stores.tallow).toBe(1);
  expect(r.capAfter).toEqual(r.capital); // goods stay in their own city
  expect(errors).toEqual([]);
});

test('a v2.3 save loads as v2.4: every city gets its notices, the town still works', async ({ page }) => {
  const save = load('v2.3-fire');
  const errors = await openGame(page, { save });
  const s = await getState(page);
  expect(s.version).toBe(2.4);
  expect(s.game.cities.capital.notices).toEqual({});
  expect(s.game.cities.capital.districts).toEqual(save.game.cities.capital.districts);
  expect(s.game.network.tiers).toEqual(save.game.network.tiers);
  expect(s.stores).toEqual(expect.objectContaining({ wood: expect.any(Number) }));
  await page.locator('#location_city').click();
  await expect(page.locator('#cityLand')).toBeVisible();
  expect(errors).toEqual([]);
});
