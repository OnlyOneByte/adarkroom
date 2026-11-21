// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { townWithCityStates, choose, getState } from './helpers.js';

// A fresh game with the town open (seed 4242), the capital on military focus with walls, soldiers drilled
// on the tick, iron swords in its stores; the ticks run by hand (the fire, the city-states, the armies)
async function garrisonTown(page, { walls = 2, swords = 20 } = {}) {
  const errors = await townWithCityStates(page);
  await page.evaluate(({ walls, swords }) => {
    clearTimeout(Armies._tickTimeout);
    for (const t in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + t + '"]', true, true); // no first sightings
    window.tick = (n = 1) => {
      for (let i = 0; i < n; i++) {
        Network.tick(); clearTimeout(Network._tickTimeout);
        CityStates.update();
        Armies.update();
      }
    };
    // walls districts beside the capital's hearth quarter, placed as the land view places them
    const cap = World.hex.gen.capital;
    let placed = 0;
    for (const p of District.neighbours(cap)) {
      if (placed < walls && Network.districtsFor('capital', p[0], p[1]).includes('walls') && Network.placeDistrict('capital', p[0], p[1], 'walls')) placed++;
    }
    $SM.set('game.cities["capital"].population.citizens', 30);
    City.setFocus('capital', 'military');
    $SM.setM('stores', { 'iron sword': swords, oak: 200, steel: 100, leather: 100 });
  }, { walls, swords });
  return errors;
}

// the nearest city-state of a temperament, met; with line, a beacon line raised to it (as the influence tests
// do), so the army marches and camps in the light (their thresholds' scenes already told)
async function target(page, t, { line = false } = {}) {
  return page.evaluate(({ t, line }) => {
    const c = nearest(t);
    $SM.set('game.citystates.cs["' + c.id + '"].met', true);
    if (line) {
      [25, 50, 75].forEach((n) => $SM.set('game.citystates.cs["' + c.id + '"].told[' + n + ']', true, true));
      if (!lineTo(c)) throw new Error('no line');
    }
    window.cs = c;
    return JSON.parse(JSON.stringify(c));
  }, { t, line });
}

// ticks the siege on, answering every camp scene with `stance` and going on past any sally, until a scene
// with one of these titles comes
async function untilScene(page, titles, stance = 'press the walls') {
  for (let i = 0; i < 120; i++) {
    const ev = await page.evaluate(() => Events.activeEvent() && Events.activeEvent().title);
    if (titles.includes(ev)) return ev;
    if (ev) {
      const camp = page.locator('#event .button', { hasText: stance });
      await choose(page, (await camp.count()) ? stance : 'go on');
      await page.waitForFunction(() => !$('#event').is(':animated'));
    } else await page.evaluate(() => tick());
  }
  return null;
}
const untilStorm = (page) => untilScene(page, ['The Storm']);

// the capital's soldiers marched on a city-state through the panel, ticked on until camped below its walls
async function marchOn(page, c) {
  await page.locator('#location_city').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await page.evaluate(() => { CityStates.selected = null; $('#cityStates').removeAttr('data-key'); CityStates.updatePanel(); });
  await page.locator('#cs_row_' + c.id).click();
  await page.locator('#cs_march').click();
  for (let i = 0; i < 80 && (await page.evaluate(() => Armies.list()[0].state)) === 'march'; i++) await page.evaluate(() => tick());
  expect(await page.evaluate(() => Armies.list()[0].state)).toBe('siege');
}

const army = (page) => page.evaluate(() => JSON.parse(JSON.stringify(Armies.list()[0] || null)));

test('a city-state taken by force from a fresh save: soldiers drilled, a ram built, the march, the siege, the storm', async ({ page }) => {
  const errors = await garrisonTown(page);
  // the military capital drills a soldier every 3 ticks (30 s), up to 10 a walls district
  await page.evaluate(() => tick(3));
  expect(await page.evaluate(() => Armies.trained('capital'))).toBe(1);
  await page.evaluate(() => tick(90));
  const drilled = await page.evaluate(() => ({ n: Armies.trained('capital'), room: Armies.room('capital'), citizens: $SM.get('game.cities["capital"].population.citizens') }));
  expect(drilled).toEqual({ n: 20, room: 20, citizens: 10 });

  // the town panel: the army box, a ram built from the capital's stores
  await page.locator('#location_city').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await expect(page.locator('#armySoldiers')).toContainText('soldiers at home 20');
  await page.locator('#army_gear_ram').click();
  expect(await page.evaluate(() => $SM.get('stores.ram'))).toBe(1);

  // the nearest herders, selected in the city-state list, marched on
  const c = await target(page, 'herders');
  await page.evaluate(() => CityStates.updatePanel());
  await page.locator('#cs_row_' + c.id).click();
  await page.locator('#cs_march').click();
  let a = await army(page);
  expect(a.state).toBe('march');
  expect(a.squads).toEqual({ 'iron sword': 20 });
  expect(a.gear).toEqual({ ram: 1 });
  expect(await page.evaluate(() => ({ swords: $SM.get('stores["iron sword"]'), ram: $SM.get('stores.ram'), home: Armies.trained('capital') })))
    .toEqual({ swords: 0, ram: 0, home: 0 });
  // on the map: the army's glyph, its hover line
  const glyph = await page.evaluate(() => { const a = Armies.list()[0]; return World.hexGlyph(a.at[0], a.at[1], World.hex.map); });
  // (it starts on the capital's own hex, which shows the capital)
  expect(glyph[1]).toBe(true);

  // it marches on its own, a hex a tick (two on rough ground), and pitches camp at their walls
  const steps = a.path.length;
  for (let i = 0; i < 60 && (await army(page)).state === 'march'; i++) await page.evaluate(() => tick());
  a = await army(page);
  expect(a.state).toBe('siege');
  expect(steps).toBeGreaterThan(0);
  expect(await page.evaluate(() => { const a = Armies.list()[0]; return World.hexGlyph(a.at[0], a.at[1], World.hex.map); })).toEqual(['Δ', true]);
  // the camp scene: press the walls
  await choose(page, 'press the walls');
  // the walls come down, then the storm, resolved by numbers (the camp asks again every minute; a sally
  // may come out)
  expect(await untilStorm(page)).toBe('The Storm');
  await choose(page, 'go on');
  await choose(page, 'take it');
  await choose(page, 'go on');

  // they're ours: a city at -50% production, wearing off over 10 minutes
  const r = await page.evaluate(() => {
    const st = CityStates.state(cs.id), after = $SM.get('game.armies.after["' + st.city + '"]');
    return { city: st.city, after, share: Armies.output(after), joined: !!$SM.get('game.cities["' + st.city + '"]') };
  });
  expect(r.joined).toBe(true);
  expect(r.after).toEqual({ loss: 0.5, ticks: 60, left: 60 });
  expect(r.share).toBe(0.5);
  a = await army(page);
  expect(a.state).toBe('camp');
  const lost = 20 - Object.values(a.squads).reduce((s, n) => s + n, 0);
  expect(lost).toBeGreaterThanOrEqual(0);
  expect(lost).toBeLessThan(10);
  await page.evaluate(() => tick(30));
  expect(await page.evaluate(() => Armies.output($SM.get('game.armies.after["' + CityStates.state(cs.id).city + '"]')))).toBeCloseTo(0.75, 5);

  // the army marches home: its soldiers and swords back in the capital
  await page.evaluate(() => { City.switchTo('capital'); Armies.updatePanel(); });
  await page.locator('#army_home').click();
  // (stragglers may fall behind on unlit ground on the way)
  let back = 20 - lost;
  for (let i = 0; i < 80 && (a = await army(page)); i++) {
    back = Object.values(a.squads).reduce((s, n) => s + n, 0);
    await page.evaluate(() => tick());
  }
  expect(await army(page)).toBeNull();
  const home = await page.evaluate(() => ({ n: Armies.trained('capital'), swords: $SM.get('stores["iron sword"]') }));
  // the swords came home with the soldiers who carried them; the walls' room was drilled full again meanwhile
  expect(home.swords).toBeGreaterThanOrEqual(back - 1);
  expect(home.swords).toBeLessThanOrEqual(20 - lost);
  expect(home.n).toBeGreaterThanOrEqual(home.swords);
  expect(home.n).toBeLessThanOrEqual(20);
  expect(errors).toEqual([]);
});

test('sacked: -75% for 20 minutes, its stores carried home; an army on the march survives a reload', async ({ page }) => {
  const errors = await garrisonTown(page);
  await page.evaluate(() => { $SM.set('game.armies.trained["capital"]', 20); $SM.set('stores.ram', 1); });
  const c = await target(page, 'herders');
  await page.locator('#location_city').click();
  await page.waitForFunction(() => !$('#locationSlider').is(':animated'));
  await page.evaluate(() => CityStates.updatePanel());
  await page.locator('#cs_row_' + c.id).click();
  await page.locator('#cs_march').click();
  await page.evaluate(() => tick(2));
  // saved and reloaded mid-march: the army is where it was and marches on
  const before = await page.evaluate(() => { Engine.saveGame(); return JSON.parse(JSON.stringify(Armies.list()[0])); });
  await page.reload();
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room && World.hex);
  const after = await page.evaluate(() => JSON.parse(JSON.stringify(Armies.list()[0])));
  expect(after).toEqual(before);
  await page.evaluate((id) => {
    clearTimeout(Events._eventTimeout); clearTimeout(Network._tickTimeout); clearTimeout(CityStates._tickTimeout); clearTimeout(Armies._tickTimeout);
    Network._nextAsk = Date.now() + 1e9;
    window.cs = CityStates.byId(id);
    window.tick = (n = 1) => { for (let i = 0; i < n; i++) { Network.tick(); clearTimeout(Network._tickTimeout); CityStates.update(); Armies.update(); } };
  }, c.id);
  for (let i = 0; i < 80 && (await page.evaluate(() => Armies.list()[0].state)) === 'march'; i++) await page.evaluate(() => tick());
  expect(await untilStorm(page)).toBe('The Storm');
  await choose(page, 'go on');
  await choose(page, 'sack it');
  await choose(page, 'go on');
  const r = await page.evaluate(() => {
    const st = CityStates.state(cs.id), a = Armies.list()[0];
    return { after: $SM.get('game.armies.after["' + st.city + '"]'), loot: a.loot, stores: $SM.get('game.cities["' + st.city + '"].stores') };
  });
  expect(r.after).toEqual({ loss: 0.75, ticks: 120, left: 120 });
  // their stores (what a city-state joins with) ride home in the baggage, x(1 + band)
  const band = c.band;
  expect(r.loot).toEqual({ wood: 600 * (1 + band), 'cured meat': 300 * (1 + band) });
  // a job in the sacked town runs at a quarter of its pace
  expect(await page.evaluate(() => { const id = CityStates.state(cs.id).city; return Armies.output($SM.get('game.armies.after["' + id + '"]')); })).toBe(0.25);
  const wood = await page.evaluate(() => $SM.get('stores.wood'));
  await page.evaluate(() => Armies.goHome(Armies.list()[0].id));
  for (let i = 0; i < 80 && (await page.evaluate(() => Armies.list().length)); i++) await page.evaluate(() => tick());
  const home = await page.evaluate(() => $SM.get('stores.wood'));
  expect(home - wood).toBeGreaterThanOrEqual(600 * (1 + band) - 50); // (the hearth burns a little meanwhile)
  expect(errors).toEqual([]);
});

test('waited out: their stores run down, they yield; -25% for 5 minutes', async ({ page }) => {
  const errors = await garrisonTown(page);
  await page.evaluate(() => $SM.set('game.armies.trained["capital"]', 20));
  const c = await target(page, 'herders', { line: true });
  await marchOn(page, c);
  expect(await untilScene(page, ['The Gate Opens', 'The Storm'], 'wait them out')).toBe('The Gate Opens');
  const ticks = await page.evaluate(() => Armies.list()[0].siege.ticks);
  expect(ticks).toBe(await page.evaluate(() => Armies.stores(cs.band)));
  await choose(page, 'go in');
  await choose(page, 'go on');
  const after = await page.evaluate(() => $SM.get('game.armies.after["' + CityStates.state(cs.id).city + '"]'));
  expect(after).toEqual({ loss: 0.25, ticks: 30, left: 30 });
  expect(errors).toEqual([]);
});

test('a storm lost: 50-80% gone, the baggage dropped as a cache the scavengers thin; the rest fall back to the light', async ({ page }) => {
  const errors = await garrisonTown(page, { swords: 3 });
  await page.evaluate(() => $SM.set('game.armies.trained["capital"]', 20));
  const c = await target(page, 'herders');
  await marchOn(page, c);
  const a0 = await army(page);
  expect(a0.squads).toEqual({ 'iron sword': 3 }); // the unarmed stay home
  const camp = a0.at;
  const ev = await untilScene(page, ['The Storm', c.name]);
  // under the walls (the city-state's own title) or in the storm, the army breaks
  expect(ev).toBeTruthy();
  const lines = await page.locator('#event #description').innerText();
  const m = lines.match(/(\d+) soldiers come away from the walls/);
  if (!m) await choose(page, 'go on'); // the storm's rounds first
  const left = Number((await page.locator('#event #description').innerText()).match(/(\d+) soldiers come away from the walls/)[1]);
  await choose(page, 'go on');
  // 3 went in: 50-80% lost is 2 (66%) at the most a whole soldier allows
  expect(left).toBeLessThanOrEqual(1);
  const r = await page.evaluate((camp) => {
    const k = Armies.cacheAt(camp[0], camp[1]);
    return { k, cache: k && JSON.parse(JSON.stringify($SM.get('game.armies.caches')[k])), glyph: World.hexGlyph(camp[0], camp[1], World.hex.map),
      label: World.hexLabel(camp[0], camp[1], { map: World.hex.map, mask: World.hex.mask }), army: JSON.parse(JSON.stringify(Armies.list()[0] || null)) };
  }, camp);
  expect(r.cache.items['cured meat']).toBeGreaterThan(0);
  // (the survivors camp on the nearest lit hex, which can be this one)
  expect(r.glyph).toEqual([r.army && r.army.at[0] === camp[0] && r.army.at[1] === camp[1] ? 'Δ' : '+', true]);
  expect(r.k).toBeTruthy();
  expect(await page.evaluate((camp) => { const a = Armies.list()[0]; if (a) a.at = [0, 0]; return Armies.label(camp[0], camp[1]); }, camp)).toContain('baggage');
  if (left) {
    expect(r.army.food).toBe(0);
    expect(r.army.siege).toBeNull();
  } else {
    expect(r.army).toBeNull();
  }
  // the scavengers take a share a step the wanderer walks
  const thinned = await page.evaluate(() => { Armies.onStep(0, 0); Armies.onStep(0, 0); return $SM.get('game.armies.caches')[Object.keys($SM.get('game.armies.caches'))[0]].left; });
  expect(thinned).toBeLessThan(1);
  expect(thinned).toBeGreaterThan(0.9);
  // an army that marches over it takes back what is left
  const back = await page.evaluate((camp) => {
    const a = { id: 'x', squads: { 'iron sword': 1 }, ammo: {}, gear: {}, food: 0, at: camp.slice() };
    Armies.pickUp(a);
    return { food: a.food, cache: Armies.cacheAt(camp[0], camp[1]) };
  }, camp);
  expect(back.food).toBeGreaterThan(0);
  expect(back.cache).toBeNull();
  expect(errors).toEqual([]);
});

test('a story city-state taken by force: its craftsmen flee; a trek finds them and brings them home; then the beat (H6)', async ({ page }) => {
  const errors = await garrisonTown(page);
  await page.evaluate(() => { $SM.set('game.armies.trained["capital"]', 20); $SM.set('stores.ram', 1); });
  const c = await target(page, 'potters', { line: true });
  await marchOn(page, c);
  expect(await untilStorm(page)).toBe('The Storm');
  await choose(page, 'go on');
  await choose(page, 'take it');
  expect(await page.locator('#event #description').innerText()).toContain('the ones who knew the craft are gone');
  await choose(page, 'go on');
  const fled = await page.evaluate(() => {
    const f = $SM.get('game.armies.fled["' + cs.id + '"]');
    return { f: JSON.parse(JSON.stringify(f)), joined: !!CityStates.state(cs.id).city, beat: $SM.get('game.citystates.beats.H6') || null,
      seen: !!World.hex.mask[f.at[0]][f.at[1]], d: WorldGen.distance(f.at, cs.at),
      label: World.hexLabel(f.at[0], f.at[1], { map: World.hex.map, mask: World.hex.mask }) };
  });
  expect(fled.joined).toBe(true);
  expect(fled.beat).toBeNull(); // the kiln waits for them
  expect(fled.f.party).toBe('waiting');
  expect(fled.seen).toBe(true);
  expect(fled.d).toBeGreaterThanOrEqual(4);
  expect(fled.d).toBeLessThanOrEqual(8);
  expect(fled.label).toContain('the&nbsp;craftsmen&nbsp;of');

  // a trek walks to them; they fall in, and come home with it
  await page.locator('#location_path').click();
  await page.evaluate((at) => {
    Path.outfit = { 'cured meat': 20 };
    Path.embark();
    Math.random = () => 0.99; // no fights
    World.water = 999;
    stepOnto(at);
  }, fled.f.at);
  expect(await page.evaluate(() => $SM.get('game.armies.fled["' + cs.id + '"].party'))).toBe('with');
  await page.evaluate(() => World.goHome());
  await page.waitForFunction(() => !$('#outerSlider').is(':animated') && Engine.activeModule !== World);
  await page.evaluate(() => tick()); // the scene waits for the next tick at home
  await page.waitForFunction(() => Events.activeEvent() && Events.activeEvent().title === cs.name, null, { timeout: 10000 });
  expect(await page.locator('#event #description').innerText()).toContain('they show the craft anyway');
  await choose(page, 'go on');
  expect(await page.evaluate(() => $SM.get('game.citystates.beats.H6'))).toBe(c.id);
  expect(errors).toEqual([]);
});
