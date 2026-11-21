// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, townWithCityStates, choose } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

test('the hex map opens with 64 city-states: 8 story ones, the guarantees, the Ω glyph, the same after a reload', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const r = await page.evaluate(() => {
    const list = CityStates.list(), by = {};
    list.forEach((c) => { by[c.t] = (by[c.t] || 0) + 1; });
    const field = World.hex.danger;
    const reach = (c) => Danger.at(field, World.hex.gen.cols, c.at[0], c.at[1], 'normal') <= 2.5 && WorldGen.distance(c.at, cap) <= 15;
    const c = list[0];
    return {
      n: list.length, by, ids: new Set(list.map((c) => c.id)).size,
      herders: list.filter((c) => c.t === 'herders' && reach(c)).length,
      potters: list.filter((c) => c.t === 'potters' && reach(c)).length,
      fallen: list.filter((c) => c.site >= 0).length,
      glyph: World.hexGlyph(c.at[0], c.at[1], World.hex.map),
      near: list.filter((c) => WorldGen.distance(c.at, cap) < CityStates.MIN_CAPITAL).length,
      spaced: list.every((a) => list.every((b) => a === b || WorldGen.distance(a.at, b.at) >= CityStates.SPACING)),
      saved: JSON.parse(localStorage.gameState).game.citystates.list.length,
      version: $SM.get('version')
    };
  });
  expect(r.n).toBe(64);
  expect(r.ids).toBe(64);
  for (const t of ['bog_cutters', 'potters', 'resin_tappers', 'forge_masters', 'tar_keepers', 'mirror_folk', 'drifters', 'archive_clerks']) expect(r.by[t]).toBe(1);
  expect(r.by).toMatchObject({ herders: 12, trappers_lodge: 8, stilt_fishers: 8, walled_holdfast: 8, reavers: 8, ash_faithful: 4, scavenger_camp: 4, the_sworn: 4 });
  expect(r.herders).toBeGreaterThanOrEqual(2);
  expect(r.potters).toBe(1);
  expect(r.fallen).toBeGreaterThan(0);
  expect(r.fallen).toBeLessThanOrEqual(16);
  expect(r.glyph).toEqual(['Ω', true]);
  expect(r.near).toBe(0);
  expect(r.spaced).toBe(true);
  expect(r.saved).toBe(64);
  expect(r.version).toBe(2.9);

  const before = await page.evaluate(() => JSON.stringify(CityStates.list()));
  await page.reload();
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);
  expect(await page.evaluate(() => JSON.stringify(CityStates.list()))).toBe(before);
  expect(errors).toEqual([]);
});

test('a city-state is won by influence from a fresh save: a beacon line to the herders, the stranger at 25, they join at 100', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const r = await page.evaluate(() => {
    const c = nearest('herders');
    window.herders = c;
    const lined = lineTo(c);
    tick();
    const st = { ...CityStates.state(c.id) };
    const G = CityStates.glow(World.hex.fire.fire, World.hex.gen.cols, World.hex.gen.rows, c.at, Network.beaconAt);
    const S = CityStates.strength(World.baseDangerAt(c.at[0], c.at[1]));
    // run the ticks until the stranger comes (25)
    let ticks = 1;
    while (!Events.activeEvent() && ticks < 2000) { tick(); ticks++; }
    return { c, lined, first: st.inf, G, S, rate: CityStates.RATE, settlers: City.SETTLERS.stores, touched: CityStates.touched(c), met: st.met, ticks, inf: CityStates.state(c.id).inf,
      title: Events.activeEvent() && Events.activeEvent().title, label: World.hexLabel(c.at[0], c.at[1], { map: World.hex.map, mask: World.hex.mask }) };
  });
  expect(r.lined).toBe(true);
  expect(r.touched).toBe(true);
  expect(r.met).toBe(true);
  // RATE × G × T / S a minute, a sixth of it a 10 s tick; touched counts double
  expect(r.first).toBeCloseTo(r.rate * r.G * 1.5 / r.S / 6, 5);
  expect(r.title).toBe('A Stranger at the Hearth');
  expect(r.inf).toBeGreaterThanOrEqual(25);
  expect(r.label).toContain(r.c.name.replace(/ /g, '&nbsp;'));
  await expect(page.locator('#event')).toContainText("in herder's wool waits by the hearth");
  await page.screenshot({ path: 'test-results/citystates-stranger.png' });
  await choose(page, 'trade');
  await expect(page.locator('#event')).toContainText('leaves a bundle of meat by the fire');
  await choose(page, 'go on');

  // the town panel lists them, with what they want now that they trade
  await page.locator('#location_city').click();
  await page.waitForFunction(() => !$('#outerSlider').is(':animated'));
  const row = page.locator(`#cs_row_${r.c.id}`);
  await expect(row).toContainText(r.c.name);
  await expect(row).toContainText('they trade.');
  await row.click();
  await expect(page.locator('#cityStates')).toContainText('they want leather, tools, cloth.');
  await page.locator('#cityStates').screenshot({ path: 'test-results/citystates-panel.png' });
  // the page grows with the town panel: room under the city-states for the menu fixed at the bottom
  await page.waitForTimeout(100);
  const room = await page.evaluate(() => {
    const cs = $('#cityStates'), c = $('div#content');
    return c.offset().top + c.outerHeight() - (cs.offset().top + cs.outerHeight());
  });
  expect(room).toBeGreaterThanOrEqual(40);

  const j = await page.evaluate(() => {
    const c = herders;
    let ticks = 0;
    while (!CityStates.state(c.id).city && ticks < 3000) { tick(); ticks++; }
    const id = CityStates.state(c.id).city;
    return { ticks, id, city: id && JSON.parse(JSON.stringify($SM.get('game.cities["' + id + '"]'))),
      tile: World.hex.map[c.at[0]][c.at[1]], status: CityStates.status(c), land: CityStates.landAt(c.at[0], c.at[1]),
      lit: !!World.hex.fire.lit[c.at[0] + c.at[1] * World.hex.gen.cols],
      notes: $('#notifications .notification').map((i, n) => $(n).text()).get().join(' | ') };
  });
  expect(j.id).toBeTruthy();
  const types = Object.values(j.city.districts);
  expect(types).toContain('hearth quarter');
  expect(types).toContain('huts');
  expect(types).toContain('hunting grounds');
  expect(j.city).toMatchObject({ name: r.c.name, focus: 'farming', population: { citizens: 16 }, hex: r.c.at });
  expect(j.tile).toBe('A');
  // it starts with what settlers would have carried (pending user), so its hearth burns
  expect(j.city.stores).toEqual(r.settlers);
  expect(j.status).toBe("they're yours.");
  expect(j.land).toBeNull();
  expect(j.notes).toContain('carry their coals to the line');
  expect(j.notes).toContain('the flocks come in with them');
  // from the line to 100 took (25 / rate) + the rest, in 10 s ticks
  expect(r.ticks + j.ticks).toBeLessThan(2000);
  // it is a city of ours now: in the switcher, burning on the next tick
  const hearth = await page.evaluate((id) => { tick(2); return $SM.get('game.cities["' + id + '"].hearth.out'); }, j.id);
  expect(hearth).toBeGreaterThan(0);
  await expect(page.locator(`#city_switch_${j.id}`)).toHaveCount(1);
  await page.screenshot({ path: 'test-results/citystates-joined.png' });
  expect(errors).toEqual([]);
});

test('an envoy carries a gift to the gate: value × want / (10 × S), half again within 5 minutes, capped at 75', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const c = await page.evaluate(() => {
    const c = nearest('herders');
    window.herders = c;
    // seen on an earlier trek
    $SM.set('game.citystates.cs["' + c.id + '"].met', true);
    return c;
  });
  await page.locator('#location_city').click();
  await page.waitForFunction(() => !$('#outerSlider').is(':animated'));
  await page.locator(`#cs_row_${c.id}`).click();
  const before = await page.evaluate(() => ({ people: $SM.get('game.population'), meat: $SM.get('stores["cured meat"]') }));
  await page.locator('#cs_envoy').click();
  // fill the pack: 50 leather
  for (let i = 0; i < 5; i++) await page.locator('#cs_pack_leather .upBtn').click();
  await page.locator('#cityStates').screenshot({ path: 'test-results/citystates-envoy.png' });
  const r = await page.evaluate(() => {
    const e = JSON.parse(JSON.stringify(CityStates.envoy()));
    embark();
    const water = World.water;
    const out = CityStates.envoy().out;
    stepOnto(herders.at);
    return { e, water, max: World.getMaxWater(), out, people: $SM.get('game.population'), meat: $SM.get('stores["cured meat"]'), leather: $SM.get('stores.leather'),
      S: CityStates.strength(World.baseDangerAt(herders.at[0], herders.at[1])) };
  });
  expect(r.people).toBe(before.people - 1);
  expect(r.meat).toBe(before.meat - 10 - 50); // the envoy's 10, and the trek's own 50
  expect(r.e).toMatchObject({ to: c.id, from: 'capital', pack: { leather: 50 }, out: false });
  expect(r.out).toBe(true);
  expect(r.water).toBe(r.max - 10);
  await expect(page.locator('#event')).toContainText('the gate is a cart turned on its side.');
  await choose(page, 'leave the pack');
  const g = await page.evaluate(() => CityStates.state(herders.id).inf);
  expect(g).toBeCloseTo(Math.min(75, 50 * 5 * 2 / (10 * r.S)), 5);
  await choose(page, 'go on');
  // a second gift straight after is worth half; past 75 they only thank you
  const more = await page.evaluate(() => {
    const a = CityStates.state(herders.id).inf;
    CityStates.give(herders, { leather: 10 });
    const b = CityStates.state(herders.id).inf;
    const lines = CityStates.give(herders, { leather: 1000 });
    return { a, b, c: CityStates.state(herders.id).inf, lines };
  });
  if (more.a < 75) expect(more.b - more.a).toBeCloseTo(Math.min(75 - more.a, 10 * 5 * 2 / (10 * r.S) / 2), 5);
  expect(more.c).toBe(75);
  expect(errors).toEqual([]);
});

test('a resident envoy brings them to 25 outside the glow; out of the glow it fades to the floor; rivals pull past it', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const r = await page.evaluate(() => {
    const c = nearest('herders'), path = 'game.citystates.cs["' + c.id + '"]';
    $SM.set(path + '.met', true);
    $SM.set(path + '.envoy', 'capital');
    tick(6 * 60); // an hour
    const envoy = CityStates.state(c.id).inf;
    // out of the glow at 60: it fades to 50, no lower
    $SM.set(path + '.envoy', false);
    $SM.set(path + '.inf', 60);
    $SM.set(path + '.floor', 50);
    tick(6 * 30);
    const faded = CityStates.state(c.id).inf;
    // a sphere in reach pulls a wavering one past the floor (pending user G18)
    const sph = CityStates.spheres()[0];
    const old = CityStates.spheres;
    CityStates.spheres = () => [{ i: sph.i, at: c.at, band: 0 }];
    $SM.set('game.citystates.riders["' + sph.i + '"]', CityStates.tick()); // no rider yet
    tick(6 * 10);
    const pulled = { ...CityStates.state(c.id) };
    // riders: -10 on the next visit
    $SM.set(path + '.inf', 70);
    $SM.set('game.citystates.riders["' + sph.i + '"]', -1e9);
    CityStates.spheres = () => [{ i: sph.i, at: [c.at[0] + 1, c.at[1]], band: 0 }];
    const a = CityStates.state(c.id).inf;
    tick();
    const b = CityStates.state(c.id).inf;
    CityStates.spheres = old;
    return { envoy, faded, pulled: pulled.inf, floor: pulled.floor, isPulled: pulled.pulled, a, b,
      notes: $('#notifications .notification').map((i, n) => $(n).text()).get().join(' | ') };
  });
  expect(r.envoy).toBe(25);
  expect(r.faded).toBe(50);
  expect(r.pulled).toBeLessThan(50);
  expect(r.floor).toBe(25);
  expect(r.isPulled).toBe(true);
  expect(r.a - r.b).toBeGreaterThanOrEqual(10);
  expect(r.notes).toContain('the envoy has said all there is to say');
  expect(r.notes).toContain('they listen less now');
  expect(errors).toEqual([]);
});

test('a price: the trappers join once the tribute is left at their gate, after talks open at 25', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const r = await page.evaluate(() => {
    const c = nearest('trappers_lodge'), path = 'game.citystates.cs["' + c.id + '"]';
    const price = CityStates.tribute(c.t, c.band);
    $SM.set(path + '.met', true);
    const early = CityStates.give(c, price); // before 25: only a gift
    const joinedEarly = !!CityStates.state(c.id).city;
    $SM.set(path + '.inf', 30);
    $SM.set(path + '.told[25]', true);
    const lines = CityStates.give(c, price);
    CityStates.playQueued();
    return { price, band: c.band, early, joinedEarly, lines, city: CityStates.state(c.id).city, name: c.name };
  });
  expect(r.price).toEqual({ bait: 40 * (1 + r.band), 'cured meat': 40 * (1 + r.band) });
  expect(r.joinedEarly).toBe(false);
  expect(r.lines.join(' ')).toContain('are counted at the gate');
  expect(r.city).toBeTruthy();
  expect(errors).toEqual([]);
});

test('reavers will not bend; nothing of ours goes on a city-state\'s land', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const r = await page.evaluate(() => {
    const rv = nearest('reavers'), h = nearest('herders');
    $SM.set('game.citystates.cs["' + rv.id + '"].met', true);
    World.hex.mask[h.at[0]][h.at[1]] = true;
    return { status: CityStates.status(rv), why: CityStates.cantSend('capital', rv), gift: CityStates.give(rv, { leather: 10 }),
      beacon: Network.canBeacon(h.at[0], h.at[1]), found: Network.foundingSite(h.at[0], h.at[1]) };
  });
  expect(r.status).toBe('they will not bend.');
  expect(r.why).toBe('they will not bend.');
  expect(r.gift).toEqual(['they will not bend.']);
  expect(r.beacon).toBe(false);
  expect(r.found).toBeNull();
  expect(errors).toEqual([]);
});

test('a v2.4 save with a hex map loads (as v2.9) and gets its city-states around what it has built', async ({ page }) => {
  const save = load('v2.3-fire');
  const errors = await openGame(page, { save });
  const r = await page.evaluate(() => {
    const list = CityStates.list();
    return { version: $SM.get('version'), n: list.length,
      onCity: list.filter((c) => c.land.some((h) => Network.districtAt(h[0], h[1]))).length };
  });
  expect(r.version).toBe(2.9);
  expect(r.n).toBe(64);
  expect(r.onCity).toBe(0);
  expect(errors).toEqual([]);
});

test('the bog-cutters at 50: "learn the cutting" gives F6 (B8 waits for them joining); gifts raise the floor they fade to', async ({ page }) => {
  const errors = await townWithCityStates(page);
  const c = await page.evaluate(() => {
    const c = CityStates.list().find((x) => x.t === 'bog_cutters');
    window.bog = c;
    $SM.set('game.citystates.cs["' + c.id + '"].met', true);
    $SM.set('game.citystates.cs["' + c.id + '"].told[25]', true); // their stranger came already
    $SM.set('game.network.tiers.F5', true);
    // a pack of leather left at their gate: 1/3 a piece at band 2, past 50
    CityStates.give(c, { leather: 200 });
    CityStates.playQueued();
    return c;
  });
  await expect(page.locator('#event')).toContainText('says peat burns low and long');
  await choose(page, 'learn the cutting');
  await page.waitForFunction(() => !Events.activeEvent() || Events.activeEvent().title === 'The Bog Cutters');
  await page.evaluate(() => CityStates.playQueued());
  await expect(page.locator('#event')).toContainText('cuts the black earth into squares');
  await choose(page, 'cut it their way');
  const r = await page.evaluate(() => {
    const st = CityStates.state(bog.id), before = st.inf;
    tick(6 * 60); // an hour out of the glow
    return { beat: $SM.get('game.citystates.beats.F6'), way: $SM.get('game.citystates.beats.F6way'), F6: Network.has('F6'), B8: Network.has('B8'),
      floor: st.floor, before, after: CityStates.state(bog.id).inf, joined: !!CityStates.state(bog.id).city };
  });
  expect(r).toMatchObject({ beat: c.id, way: 'their way', F6: true, B8: false, floor: 50, joined: false });
  expect(r.before).toBeGreaterThanOrEqual(50);
  expect(r.after).toBe(50); // faded to the 50 the gift passed, not to 0
  expect(errors).toEqual([]);
});
