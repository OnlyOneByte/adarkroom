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

// the nearest city-state of a temperament, met and touched by a beacon line (as the influence tests do)
async function target(page, t) {
  return page.evaluate((t) => {
    const c = nearest(t);
    $SM.set('game.citystates.cs["' + c.id + '"].met', true);
    window.cs = c;
    return JSON.parse(JSON.stringify(c));
  }, t);
}

// ticks the siege on, pressing at every camp scene and going on past any sally, until the storm's scene
async function untilStorm(page) {
  for (let i = 0; i < 80; i++) {
    const ev = await page.evaluate(() => Events.activeEvent() && Events.activeEvent().title);
    if (ev === 'The Storm' || ev === 'The Gate Opens') return ev;
    if (ev) {
      const press = page.locator('#event .button', { hasText: 'press the walls' });
      await choose(page, (await press.count()) ? 'press the walls' : 'go on');
      await page.waitForFunction(() => !$('#event').is(':animated'));
    } else await page.evaluate(() => tick());
  }
  return null;
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
  expect(lost).toBeGreaterThan(0);
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
