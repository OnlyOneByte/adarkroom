// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test';
import { townWithCityStates, choose } from './helpers.js';

// A story city-state with talks open (as at 25), its quest placed; then out on a trek packed the
// player's way, with water to spare for the walking
async function questFor(page, t) {
  const errors = await townWithCityStates(page);
  const c = await page.evaluate((t) => {
    const c = CityStates.list().find((x) => x.t === t);
    for (const k in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + k + '"]', true, true); // no first sightings
    $SM.set('game.citystates.cs["' + c.id + '"].met', true);
    $SM.set('game.citystates.cs["' + c.id + '"].told[25]', true);
    CityStates.tell(c);
    window.cs = c;
    window.trek = () => {
      packMeat();
      Path.embark();
      Math.random = () => 0.99; // no fights
      World.water = 999;
      Path.outfit['cured meat'] -= 2; // room in the bag for what a quest gives
      World.updateSupplies();
    };
    // two open hexes side by side, away from them and their quest, to walk back and forth on
    window.pace = (n) => {
      const g = World.hex.gen, q = CityStates.state(cs.id).q || {};
      const ok = (p) => WorldGen.isTerrain(World.state.map[p[0]][p[1]].charAt(0)) && World.canEnter(World.state.map[p[0]][p[1]]) && !CityStates.landAt(p[0], p[1]) && !World.siteAt(p[0], p[1]) &&
        !(q.at && q.at[0] === p[0] && q.at[1] === p[1]);
      const a = Fire.around(g.capital[0], g.capital[1], 4).find((p) => WorldGen.distance(p, g.capital) >= 2 && ok(p) &&
        District.neighbours(p).some(ok));
      const b = District.neighbours(a).find(ok);
      for (let i = 0; i < n; i++) {
        const [from, to] = i % 2 ? [b, a] : [a, b];
        Path.outfit['cured meat'] = Math.max(Path.outfit['cured meat'] || 0, 4); // fed: the walk is long
        World.curPos = from.slice();
        World.move([to[0] - from[0], to[1] - from[1]]);
        if (Events.activeEvent()) return i + 1;
      }
      return n;
    };
    return JSON.parse(JSON.stringify(c));
  }, t);
  return { errors, c };
}

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(CityStates.state(cs.id))));
const beats = (page) => page.evaluate(() => JSON.parse(JSON.stringify($SM.get('game.citystates.beats'))));

test('find: the lost tappers walk home with the trek; the resin-tappers join (F7)', async ({ page }) => {
  const { errors, c } = await questFor(page, 'resin_tappers');
  const q = (await state(page)).q;
  expect(q.type).toBe('find');
  expect(q.party).toBe('waiting');
  const d = await page.evaluate((q) => WorldGen.distance(q.at, cs.at), q);
  expect(d).toBeGreaterThanOrEqual(4);
  expect(d).toBeLessThanOrEqual(8);
  const marked = await page.evaluate((q) => ({ seen: !!World.hex.mask[q.at[0]][q.at[1]], glyph: World.hexGlyph(q.at[0], q.at[1], World.hex.map),
    label: World.hexLabel(q.at[0], q.at[1], { map: World.hex.map, mask: World.hex.mask }) }), q);
  expect(marked.seen).toBe(true);
  expect(marked.glyph[1]).toBe(true);
  expect(marked.label).toContain('lost&nbsp;tappers');

  // a trek that falls with them: they wait on the marked hex again
  await page.evaluate((q) => { trek(); stepOnto(q.at); }, q);
  expect((await state(page)).q.party).toBe('with');
  await page.evaluate(() => CityStates.questFail(true));
  expect((await state(page)).q.party).toBe('waiting');

  await page.evaluate((q) => { stepOnto(q.at); stepOnto(cs.at); }, q);
  await expect(page.locator('#event')).toContainText('the tappers come home thin');
  await page.screenshot({ path: 'test-results/quest-find.png' });
  await choose(page, 'go on');
  await expect(page.locator('#event')).toContainText('the trees weep resin');
  await choose(page, 'good');
  const st = await state(page);
  expect(st.quest).toBe(true);
  expect(st.city).toBeTruthy();
  expect(await beats(page)).toMatchObject({ F7: c.id, 'jungle jobs': c.id });
  expect(errors).toEqual([]);
});

test('clear: the raiders at the pits are a fight one band hard; won, the tar-keepers swear and join (F10)', async ({ page }) => {
  const { errors, c } = await questFor(page, 'tar_keepers');
  const q = (await state(page)).q;
  expect(q.type).toBe('clear');
  const d = await page.evaluate((q) => WorldGen.distance(q.at, cs.at), q);
  expect(d).toBeGreaterThanOrEqual(2);
  expect(d).toBeLessThanOrEqual(4);
  const fight = await page.evaluate((q) => { trek(); stepOnto(q.at); const s = Events.activeEvent().scenes.start; return { combat: s.combat, enemy: s.enemy, health: s.health }; }, q);
  expect(fight).toMatchObject({ combat: true, enemy: 'raiders at the pits' });
  expect(fight.health).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/quest-clear.png' });
  await page.evaluate(() => Events.winFight());
  await expect(page.locator('#event')).toContainText("the raiders at the pits won't trouble");
  await page.waitForFunction(() => !$('#event #leaveBtn').hasClass('disabled'));
  await page.locator('#event #leaveBtn').click();
  await expect(page.locator('#event')).toContainText('says pitch burns where nothing else will.');
  // fixes G14: the oath and the joining, no "pitch only"
  await expect(page.locator('#event .button')).toHaveCount(1);
  await choose(page, 'take their oath');
  await choose(page, 'good');
  const st = await state(page);
  expect(st.city).toBeTruthy();
  expect(await beats(page)).toMatchObject({ F10: c.id });
  expect(errors).toEqual([]);
});

test('meet: the drifters move every 50 steps; "go on alone" keeps the quest; 20 steps with them and they join (F12)', async ({ page }) => {
  const { errors, c } = await questFor(page, 'drifters');
  // they move a hex every 50 trek steps, onto open land
  const moved = await page.evaluate(() => {
    const before = cs.at.slice();
    trek();
    $SM.set('game.citystates.steps', 48);
    pace(2);
    const now = CityStates.byId(cs.id).at;
    window.cs = CityStates.byId(cs.id);
    return { before, now, dist: WorldGen.distance(before, now), land: CityStates.landAt(now[0], now[1]) === cs };
  });
  expect(moved.dist).toBe(1);
  expect(moved.land).toBe(true);
  await page.evaluate(() => stepOnto(cs.at));
  await expect(page.locator('#event')).toContainText('smoke on the snow. a camp, already half struck.');
  await page.screenshot({ path: 'test-results/quest-meet.png' });
  await choose(page, 'go on alone');
  await expect(page.locator('#event')).toContainText('the camp moves off into the white.');
  await choose(page, 'go on');
  await page.waitForFunction(() => !Events.activeEvent());
  let st = await state(page);
  expect(st.quest).toBeFalsy();
  expect(st.q.walked).toBeNull();

  // caught again: walk with them. going home before 20 steps fails it, and it stays open
  await page.evaluate(() => stepOnto(cs.at));
  await choose(page, 'walk with them');
  await page.waitForFunction(() => !Events.activeEvent());
  expect(await page.evaluate(() => pace(5))).toBe(5);
  expect((await state(page)).q.walked).toBe(5);
  await page.evaluate(() => World.goHome());
  await page.waitForFunction(() => !$('#outerSlider').is(':animated'));
  await page.evaluate(() => trek());
  await page.waitForFunction(() => !!World.state);
  await page.evaluate(() => stepOnto(cs.at));
  expect((await state(page)).q.walked).toBeNull();
  await choose(page, 'walk with them');
  await page.waitForFunction(() => !Events.activeEvent());
  expect(await page.evaluate(() => pace(40))).toBe(20);
  await expect(page.locator('#event')).toContainText('an old woman points north');
  await choose(page, 'go on');
  st = await state(page);
  expect(st.city).toBeTruthy();
  expect(await beats(page)).toMatchObject({ F12: c.id, 'the black well': c.id });
  expect(errors).toEqual([]);
});

test('fetch: a page from the old works, carried to the archive clerks; they join (B13) and their maps show the sites around', async ({ page }) => {
  const { errors, c } = await questFor(page, 'archive_clerks');
  const q = (await state(page)).q;
  expect(q.type).toBe('fetch');
  const site = await page.evaluate((q) => {
    const s = World.hex.gen.sites[q.site];
    return { kind: s.kind, d: WorldGen.distance(s.anchor, cs.at), hex: s.hexes.find((h) => !(h[0] === s.anchor[0] && h[1] === s.anchor[1])) || s.anchor };
  }, q);
  expect(site.kind).toBe('complex');
  expect(site.d).toBeGreaterThanOrEqual(6);
  const got = await page.evaluate((h) => { trek(); stepOnto(h); return Path.outfit['knowledge fragment']; }, site.hex);
  expect(got).toBe(1);
  // the old maps: a crater or complex near them, unseen before
  const hidden = await page.evaluate(() => {
    const s = World.hex.gen.sites.find((s) => (s.kind === 'crater' || s.kind === 'complex') && WorldGen.distance(s.anchor, cs.at) <= 20 &&
      !World.state.mask[s.anchor[0]][s.anchor[1]]);
    return s ? s.anchor : null;
  });
  await page.evaluate(() => stepOnto(cs.at));
  await expect(page.locator('#event')).toContainText('the clerk takes the fragment with both hands.');
  await page.screenshot({ path: 'test-results/quest-fetch.png' });
  await choose(page, 'go on');
  await choose(page, 'good');
  const r = await page.evaluate((h) => ({ bag: Path.outfit['knowledge fragment'], seen: h ? !!World.state.mask[h[0]][h[1]] : true }), hidden);
  expect(r.bag).toBe(0);
  expect(r.seen).toBe(true);
  const st = await state(page);
  expect(st.city).toBeTruthy();
  expect(await beats(page)).toMatchObject({ B13: c.id });
  expect(errors).toEqual([]);
});
