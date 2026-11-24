// SPDX-License-Identifier: MIT
// The playthrough's stages, in order (tests/playthrough.spec.js runs them; design/text/qa-playthrough.md has
// the findings). Each is { id, name, needs: [stage ids], run(ctx) }; ctx = { page, log, id }. A stage
// returns false (or throws) when a beat can't fire, and records why with log.block.
import {
  BASICS, MIN, ANSWERS, advance, settleEvents, clickEvent, eventNow, waitScene, playScene, playSetpiece, embark, walkTo, walkHome,
} from './playthrough-stages.js';

const has = (page, id) => page.evaluate((id) => Network.has(id), id);

// the player's answer to each story scene that comes while a stage waits on something else: the choice that
// moves the story on (the stages that wait on a scene click their own)
Object.assign(ANSWERS, {
  'The Stone Hearth': 'lay the stones', 'The Bigger World': 'raise braziers', 'A Wanderer': 'ask where',
  'A Stranger at the Hearth': 'trade', 'The Bog-Cutters': 'learn the cutting', 'The Bog Cutters': 'cut it their way',
  'The Lantern-Keepers': 'take up the lanterns', 'The Potters': 'build it of clay, their way', 'Cold Forges': 'pay',
  'Smoke on the Snow': 'walk with them', 'The Old Chimney': 'rebuild the chimney', 'A Stranger in the Ruins': 'sit with them',
  'The Burning Pits': 'learn it their way', 'Smoke in the Hills': 'go and look', 'The Keepers': 'ask them to keep it',
  'The Whales': 'render it all', 'The Missing Plates': 'send a trek for them', 'The Two Lights': 'let them work it out',
  'The Wrights': 'watch', 'The Drowned Harbour': 'go to the tower',
  'The Siege Camp': 'wait them out', 'The Storm': 'take it', 'The Gate Opens': 'go in',
  'The Gate': 'ask whose order they keep', 'An Adit': 'set a charge', 'Into the Shafts': ['take them in', 'go on', 'good'],
  'The Captain': ['take them in', 'go on', 'good'],
});

const csState = (page, id) => page.evaluate((id) => CityStates.state(id), id);

// the basic goods topped back up to BASICS in the capital (the original's grind: gathering, trapping, trading)
const restock = (page) => page.evaluate((b) => {
  const mod = {};
  for (const k in b) if ($SM.get('stores["' + k + '"]', true) < b[k]) mod[k] = b[k];
  $SM.setM('stores', mod);
}, BASICS);

// a trek out to see a hex (and what stands on it): walked to within `r`, then home
async function goSee(page, at, r = 2) {
  if (!(await embark(page))) return 'no embark';
  const ring = await page.evaluate(({ at, r }) => Fire.around(at[0], at[1], r).filter((p) => Fire.distance(p, at) === r), { at, r });
  const res = await walkTo(page, ring);
  const h = await walkHome(page);
  return `${res}/${h}`;
}
// the nearest city-state of a temperament (seed 4242)
const nearestCs = (page, t, skip = []) => page.evaluate(({ t, skip }) => {
  const c = World.hex.gen.capital;
  return CityStates.list().filter((x) => x.t === t && !skip.includes(x.id) && !CityStates.state(x.id).city)
    .sort((a, b) => Fire.distance(a.at, c) - Fire.distance(b.at, c))[0] || null;
}, { t, skip });

// a location tab, clicked, and the slide let finish
export async function goTo(page, where) {
  const mod = { room: 'Room', outside: 'Outside', path: 'Path', city: 'City', ship: 'Ship' }[where];
  if (await page.evaluate((m) => Engine.activeModule === window[m], mod)) return;
  // the header tab, clicked (through jQuery when a fading panel covers it)
  await page.locator('#location_' + where).click({ timeout: 3000 }).catch(() => page.evaluate((w) => $('#location_' + w).click(), where));
  await page.clock.runFor(1500);
}

// a room craftable built as its button builds it (Room.build is the button's click; the button may be
// scrolled off or not drawn yet in a headless page)
const build = (page, thing, n = 1) => page.evaluate(({ thing, n }) => {
  let made = 0;
  for (let i = 0; i < n; i++) if (Room.build($('<div>').attr('buildThing', thing)) !== false) made++;
  return made;
}, { thing, n });

// the player keeps the fire up: stoke whenever the button is ready and the fire is below roaring
const stoke = (page) => page.evaluate(() => {
  const b = $('#stokeButton');
  if (b.length && b.is(':visible') && !b.hasClass('disabled') && $SM.get('game.fire.value') < Room.FireEnum.Roaring.value && $SM.get('stores.wood', true) > 0) b.click();
  const l = $('#lightButton');
  if (l.length && l.is(':visible') && !l.hasClass('disabled') && $SM.get('game.fire.value') === Room.FireEnum.Dead.value) l.click();
});

// villagers to a job, through the village's worker row (+ button): Outside.increaseWorker is its click
const assign = (page, job, n) => page.evaluate(({ job, n }) => {
  const row = $('#workers_row_' + job.replace(/ /g, '-'))[0] || $('.workerRow[key="' + job + '"]')[0];
  if (!row) return false;
  Outside.increaseWorker.call($(row).find('.upBtn')[0] || row, { data: n });
  return $SM.get('game.workers["' + job + '"]', true);
}, { job, n });

// The envoy free to go again: one who fell with the wanderer waits where they fell (a trek picks them up and
// brings them home), one waiting at home unpacks (the panel's "call off")
async function freeEnvoy(page, log, id) {
  for (let i = 0; i < 3; i++) {
    const e = await page.evaluate(() => CityStates.envoy());
    if (!e) return true;
    if (!e.fell) { await page.evaluate(() => CityStates.callOff()); continue; }
    if (!(await embark(page))) return false;
    log.note(id, `a trek for the envoy who fell at ${e.fell}: ${await walkTo(page, e.fell)}/${await walkHome(page)}`);
  }
  return !(await page.evaluate(() => CityStates.envoy()));
}

// A quest city-state won the way a player wins it (PHASE4 §3): met on a trek, an envoy left with them so
// their task is told and its place marked, then the quest trek: the lost party found and walked to their
// gate (find), or the foe at the marked hex fought (clear). Treks are retried when the wanderer falls.
async function questCs(page, log, id, t) {
  const c = await nearestCs(page, t);
  if (!c) { log.block(id, `no ${t} on the map`, '', ''); return false; }
  await restock(page);
  const d = await page.evaluate((at) => [Fire.distance(at, World.hex.gen.capital), +World.baseDangerAt(at[0], at[1]).toFixed(2)], c.at);
  log.note(id, `${t} (${c.name}) at ${c.at}: ${d[0]} hexes, danger ${d[1]}`);
  for (let i = 0; i < 4 && !(await csState(page, c.id)).met; i++) log.note(id, `trek ${i + 1} to meet them: ${await goSee(page, c.at)}`);
  if (!(await csState(page, c.id)).met) { log.block(id, `four treks failed to meet ${c.name} ${d[0]} hexes out`, '', ''); return false; }
  // a line to them first: the glow brings them to 25 and talks open (PHASE4); an envoy only if it doesn't
  await goTo(page, 'city');
  const near = await page.evaluate((at) => __qa.beaconsToward(at, 1, 120), c.at);
  const talks = await advance(page, 60 * MIN, { arg: c.id, until: (cid) => CityStates.talks(CityStates.state(cid)), slice: 30000 });
  log.note(id, `a line to ${c.name} got within ${near}; talks by the glow: ${talks} (influence ${(await csState(page, c.id)).inf | 0})`);
  for (let i = 0; i < 4 && !(await page.evaluate((cid) => CityStates.talks(CityStates.state(cid)), c.id)); i++) {
    await restock(page);
    await freeEnvoy(page, log, id);
    const sent = await page.evaluate((cid) => (CityStates.sendEnvoy('capital', cid) ? 'ok' : CityStates.cantSend('capital', CityStates.byId(cid))), c.id);
    if (sent !== 'ok') { log.block(id, `envoy can't go: ${sent}`, '', ''); return false; }
    if (!(await embark(page))) return false;
    const r = await walkTo(page, c.at, { stopAt: (e) => e && e.title === c.name });
    if (r === 'event') { await clickEvent(page, 'leave the envoy'); await settleEvents(page); }
    else await page.evaluate(() => CityStates.callOff());
    log.note(id, `envoy trek ${i + 1}: ${r}/${await walkHome(page)}`);
  }
  const q = await page.evaluate((cid) => CityStates.questOf(CityStates.byId(cid)), c.id);
  if (!q || !q.at) {
    // talks open at 25 (PHASE4: quest-only types need the glow for it) or when an envoy reports; an empty camp
    // (the resin-tappers' huts, the drifters') takes no envoy, so only the glow is left
    const why = await page.evaluate((cid) => {
      const c = CityStates.byId(cid), st = CityStates.state(cid), fuel = ($SM.get('game.cities.capital.hearth') || {}).fuel || 'wood';
      let near = 99;
      for (const p of Fire.around(c.at[0], c.at[1], CityStates.GLOW_REACH)) near = Math.min(near, World.dangerAt(p[0], p[1]));
      return `influence ${st.inf | 0}, no talks; empty camp ${!!(Events.CityStates.text(c).empty)}; least danger within ${CityStates.GLOW_REACH} of them ${near.toFixed(2)}, the best fuel (${fuel}) lights to ${Fire.FUELS[fuel].cap}`;
    }, c.id);
    log.block(id, `${c.name}'s task is never told: ${why}`, 'fresh save to F6; meet the resin-tappers (36,86); an envoy finds the huts empty ("go back" only)',
      'design: let the empty huts tell the task (content: "(no gate) the huts are empty -> quest find"), or place them inside peat\'s reach');
    return false;
  }
  log.note(id, `their ${q.type} at ${q.at} (${await page.evaluate((at) => Fire.distance(at, World.hex.gen.capital), q.at)} hexes out)`);
  for (let i = 0; i < 5 && !(await csState(page, c.id)).city; i++) {
    await restock(page);
    if (!(await embark(page))) return false;
    let r = await walkTo(page, q.at);
    if (q.type === 'find' && r === 'there') r = await walkTo(page, c.at, { stopAt: () => false });
    await settleEvents(page);
    log.note(id, `quest trek ${i + 1}: ${r}/${await walkHome(page)}, party ${(await csState(page, c.id)).q && (await csState(page, c.id)).q.party}`);
  }
  if (!(await csState(page, c.id)).city) { log.block(id, `${c.name} not won by their quest after five treks`, '', ''); return false; }
  return true;
}

// The road between two of our cities lit end to end, as carts need (Network.litRoad): beacons raised by its
// dark hexes, the nearest to `from` first, until a cart can go. Returns { carts, dark: [the hexes left] }.
async function lightRoad(page, from, to) {
  const dark = await page.evaluate(({ from, to }) => {
    const g = World.hex.gen, cols = g.cols, at = $SM.get('game.cities["' + from + '"].hex');
    // the road's hexes out from the city, in the order a walk along it meets them
    const path = () => {
      const bits = Network.kinds(), seen = {}, q = [at];
      seen[at[0] + at[1] * cols] = 1;
      for (let i = 0; i < q.length; i++) for (let d = 0; d < 6; d++) {
        const p = WorldGen.neighbour(q[i][0], q[i][1], d), k = p[0] + p[1] * cols;
        if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= g.rows || seen[k] || !(bits[k] & Fire.ROAD)) continue;
        seen[k] = 1;
        q.push(p);
      }
      return q;
    };
    let left = [];
    for (let n = 0; n < 40; n++) {
      if (Network.cartsTo(from).includes(to)) return [];
      left = path().filter((p) => !World.hex.fire.lit[p[0] + p[1] * cols]);
      if (!left.length) break;
      __qa.beaconsToward(left[0], 1, 30);
      Network.refresh();
    }
    return left.map((p) => `${p.join(',')}@${World.dangerAt(p[0], p[1]).toFixed(2)}`).slice(0, 8);
  }, { from, to });
  await page.clock.runFor(11000);
  return { carts: await page.evaluate(({ from, to }) => Network.cartsTo(from).includes(to), { from, to }), dark, joined: await page.evaluate((f) => Network.joinedTo(f), from) };
}

export const STAGES = [
  {
    id: 'prologue', name: 'prologue: light the fire, the stranger, the builder',
    run: async ({ page, log, id }) => {
      await page.locator('#lightButton').click();
      const warm = await advance(page, 10 * MIN, {
        slice: 5000,
        until: () => $SM.get('game.builder.level') >= 3 && typeof Outside != 'undefined' && !!Outside.tab,
        each: () => stoke(page),
      });
      if (!warm) { log.block(id, 'builder never reached level 3 in 10 game minutes', 'fresh save, light fire, stoke, wait', ''); return false; }
      await goTo(page, 'outside');
      await page.locator('#gatherButton').click();
      await page.clock.runFor(2000);
      await goTo(page, 'room');
      return page.evaluate(() => $SM.get('game.builder.level') === 4 && Network.has('H2') && Network.has('H1') && Network.has('F1'));
    },
  },
  {
    id: 'village', name: 'the village: huts, trading post, compass, a trek on the square map, 20 huts open the town',
    needs: ['prologue'],
    run: async ({ page, log, id }) => {
      await page.evaluate((b) => $SM.setM('stores', b), BASICS);
      await page.clock.runFor(1000);
      for (const t of ['cart', 'trap', 'lodge', 'trading post', 'tannery', 'smokehouse', 'workshop', 'steelworks', 'armoury']) {
        if (!(await build(page, t))) log.note(id, `could not build ${t}`);
      }
      for (const t of ['torch', 'waterskin', 'cask', 'water tank', 'rucksack', 'wagon', 'convoy', 'l armour', 'i armour', 's armour', 'bone spear', 'iron sword', 'steel sword', 'rifle']) {
        if (!(await build(page, t))) log.note(id, `could not craft ${t}`);
      }
      await build(page, 'hut', 10);
      // the compass from the trading post
      const bought = await page.evaluate(() => { Room.buy($('<div>').attr('buildThing', 'compass')); return $SM.get('stores.compass', true); });
      if (!bought) { log.block(id, 'compass could not be bought', '', ''); return false; }
      await page.clock.runFor(2000);
      // a trek on the square map: five steps east and home
      if (!(await embark(page, { 'cured meat': 50 }))) { log.block(id, 'could not embark', '', ''); return false; }
      const square = await page.evaluate(() => !World.hex);
      if (!square) log.note(id, 'first trek was already on the hex map');
      for (let i = 0; i < 5; i++) { await page.evaluate(() => World.moveEast()); await settleEvents(page); }
      for (let i = 0; i < 5 && (await page.evaluate(() => !!World.state)); i++) { await page.evaluate(() => World.moveWest()); await settleEvents(page); }
      await page.clock.runFor(2000);
      if (await page.evaluate(() => !!World.state)) { log.block(id, 'square trek did not end at the village', '', ''); return false; }
      // villagers come as huts go up: the tannery and smokehouse worked
      await build(page, 'hut', 10);
      await page.clock.runFor(1000);
      const town = await page.evaluate(() => ({ city: !!City.tab, hex: !!World.hex, huts: $SM.get('game.buildings.hut') }));
      if (!town.city || !town.hex) { log.block(id, `town or hex map did not open: ${JSON.stringify(town)}`, '', ''); return false; }
      return true;
    },
  },
  {
    id: 'stoneHearth', name: 'H3 the stone hearth (scene on the fire tick once the town is open)', needs: ['village'],
    run: async ({ page, log, id }) => {
      const ev = await playScene(page, { title: 'The Stone Hearth', buttons: ['lay the stones', 'good'], ms: 5 * MIN });
      if (!ev || ev.missing) { log.block(id, `The Stone Hearth did not play: ${JSON.stringify(ev)}`, 'fresh save to town, wait 5 game min', ''); return false; }
      await page.clock.runFor(11000);
      return has(page, 'H3');
    },
  },
  {
    id: 'brazier', name: 'B1 the bigger world, the first brazier', needs: ['stoneHearth'],
    run: async ({ page, log, id }) => {
      const ev = await playScene(page, { title: 'The Bigger World', buttons: ['raise braziers'], ms: 5 * MIN });
      if (!ev || ev.missing) { log.block(id, `The Bigger World did not play: ${JSON.stringify(ev)}`, '', ''); return false; }
      await page.clock.runFor(11000);
      if (!(await has(page, 'B1'))) { log.block(id, 'B1 not in after the scene', '', ''); return false; }
      // the first brazier, from the land view: a hex two out from home toward the east
      await goTo(page, 'city');
      const at = await page.evaluate(() => {
        const cap = World.hex.gen.capital;
        return Fire.around(cap[0], cap[1], 2).filter((p) => Fire.distance(p, cap) === 2 && Network.canBeacon(p[0], p[1]))[0] || null;
      });
      if (!at) { log.block(id, 'no hex two out from home takes a brazier', '', ''); return false; }
      await page.evaluate((p) => Network.raiseBeacon(p[0], p[1]), at);
      const fb = await playScene(page, { title: 'The First Brazier', buttons: ['go back'], ms: 10000 });
      if (!fb) log.note(id, 'The First Brazier scene did not show after the first beacon');
      return page.evaluate(() => Object.keys($SM.get('game.network.beacons') || {}).length === 1);
    },
  },
  {
    id: 'woodshed', name: 'F2 a woodshed in the town', needs: ['stoneHearth'],
    run: async ({ page, log, id }) => {
      await goTo(page, 'city');
      const ok = await page.evaluate(() => {
        const b = $('#build_woodshed');
        if (b.length) b.click(); else City.build($('<div>').attr('buildThing', 'woodshed'));
        return $SM.get('game.cities["capital"].buildings.woodshed', true);
      });
      if (!ok) { log.block(id, 'woodshed could not be built in the capital', '', ''); return false; }
      await page.clock.runFor(1000);
      return has(page, 'F2');
    },
  },
  {
    id: 'axeHead', name: 'F3 the old axe-head (the first forest walked after the woodshed), B2 the trek home', needs: ['woodshed', 'brazier'],
    run: async ({ page, log, id }) => {
      if (!(await embark(page))) { log.block(id, 'could not embark', '', ''); return false; }
      const forest = await page.evaluate(() => {
        const g = World.hex.gen, c = g.capital, T = WorldGen.TERRAIN.forest;
        return Fire.around(c[0], c[1], 8).filter((p) => World.state.map[p[0]] && World.state.map[p[0]][p[1]] === T && g.reachable[p[0] + p[1] * g.cols])
          .sort((a, b) => Fire.distance(a, c) - Fire.distance(b, c))[0] || null;
      });
      if (!forest) { log.block(id, 'no forest within 8 hexes of home', '', ''); return false; }
      const r = await walkTo(page, forest);
      const found = await page.evaluate(() => !!(World.state && World.state.axeHead));
      if (r !== 'there' || !found) log.block(id, `walked to forest ${forest}: ${r}, axe-head ${found}`, '', '');
      const h = await walkHome(page);
      await page.clock.runFor(11000);
      if (h !== 'home') { log.block(id, `trek home: ${h}`, '', ''); return false; }
      return (await has(page, 'F3')) && (await has(page, 'B2'));
    },
  },
  {
    id: 'tallow', name: 'F4 tallow: the tannery and smokehouse worked together', needs: ['axeHead'],
    run: async ({ page, log, id }) => {
      // villagers move into the huts over time
      await advance(page, 10 * MIN, { until: () => $SM.get('game.population', true) >= 20 });
      await goTo(page, 'outside');
      const w = await page.evaluate(() => {
        $('#workers_row_tanner .upBtn').click();
        $('#workers_row_charcutier .upBtn').click();
        return [$SM.get('game.workers.tanner', true), $SM.get('game.workers.charcutier', true)];
      });
      await page.clock.runFor(11000);
      if (!(w[0] > 0 && w[1] > 0)) { log.block(id, `tanner/charcutier rows: ${w}`, '', ''); return false; }
      return has(page, 'F4');
    },
  },
  {
    id: 'district', name: 'H4 the capital raises its first district', needs: ['stoneHearth'],
    run: async ({ page, log, id }) => {
      await goTo(page, 'city');
      const p = await page.evaluate(() => __qa.district('capital', 'huts'));
      if (!p) { log.block(id, 'no hex next to the hearth quarter takes huts', '', ''); return false; }
      await page.clock.runFor(11000);
      return has(page, 'H4');
    },
  },
  {
    id: 'cairn', name: "B3 the wanderer's cairn: told, studied on a trek, the cairn fire at home", needs: ['axeHead'],
    run: async ({ page, log, id }) => {
      const ev = await playScene(page, { title: 'A Wanderer', buttons: ['ask where', 'go back'], ms: 10 * MIN });
      if (!ev || ev.missing) { log.block(id, `A Wanderer did not play: ${JSON.stringify(ev)}`, '', ''); return false; }
      const cairn = await page.evaluate(() => $SM.get('game.network.cairn'));
      if (!cairn) { log.block(id, 'no cairn placed after "ask where"', '', ''); return false; }
      if (!(await embark(page))) return false;
      const r = await walkTo(page, cairn, { stopAt: (e) => e && e.title === 'An Old Cairn' });
      if (r !== 'event') { log.block(id, `walk to the cairn at ${cairn}: ${r}`, '', ''); await walkHome(page); return false; }
      await clickEvent(page, 'study the stacking');
      await clickEvent(page, 'go on');
      const h = await walkHome(page);
      if (h !== 'home') { log.block(id, `trek home from the cairn: ${h}`, '', ''); return false; }
      const cf = await playScene(page, { title: 'The Cairn Fire', buttons: ['good'], ms: 30000 });
      if (!cf) log.block(id, 'The Cairn Fire did not play at home', '', '');
      await page.clock.runFor(11000);
      return has(page, 'B3');
    },
  },
  {
    id: 'waystation', name: 'B4 a waystation (a cleared cave or house) lit by a beacon line', needs: ['cairn'],
    run: async ({ page, log, id }) => {
      // landmarks a trek can clear into a waystation, nearest first
      const marks = await page.evaluate(() => {
        const g = World.hex.gen, c = g.capital, m = World.hex.map, out = [];
        for (let x = 0; x < g.cols; x++) for (let y = 0; y < g.rows; y++) {
          if ([World.TILE.CAVE, World.TILE.HOUSE, World.TILE.TOWN].includes(m[x][y]) && g.reachable[x + y * g.cols]) out.push([x, y]);
        }
        return out.sort((a, b) => Fire.distance(a, c) - Fire.distance(b, c)).slice(0, 6);
      });
      let way = null;
      for (const p of marks) {
        if (!(await embark(page))) return false;
        const r = await walkTo(page, p, { stopAt: () => true });
        if (r === 'event') await playSetpiece(page);
        const cleared = await page.evaluate((p) => World.state && World.state.map[p[0]][p[1]] === World.TILE.OUTPOST, p);
        await walkHome(page);
        if (cleared && (await page.evaluate((p) => World.hex.map[p[0]][p[1]] === World.TILE.OUTPOST, p))) { way = p; break; }
        log.note(id, `landmark at ${p} not cleared (${r})`);
      }
      if (!way) { log.block(id, 'no nearby cave/house/town cleared into a waystation', '', ''); return false; }
      await goTo(page, 'city');
      const near = await page.evaluate((p) => __qa.beaconsToward(p, 0), way);
      await page.clock.runFor(11000);
      if (!(await has(page, 'B4'))) { log.block(id, `waystation at ${way} not lit (line got within ${near})`, '', ''); return false; }
      return true;
    },
  },
  {
    id: 'found', name: 'a 2nd city founded: settlers sent from the land box, walked to a lit hex', needs: ['district'],
    run: async ({ page, log, id }) => {
      await goTo(page, 'city');
      // a line of braziers out east to light the way, then a lit hex 4-6 out the land box sends settlers to
      await page.evaluate(() => { const c = World.hex.gen.capital; __qa.beaconsToward([c[0] + 7, c[1]], 2); });
      await page.clock.runFor(11000);
      const site = await page.evaluate(() => {
        const c = World.hex.gen.capital;
        // as far out as the light lets them go
        return Fire.around(c[0], c[1], 8).filter((p) => Fire.distance(p, c) >= 3 && Network.foundingSite(p[0], p[1]) && !Network.foundingSite(p[0], p[1]).site)
          .sort((a, b) => Fire.distance(b, c) - Fire.distance(a, c))[0] || null;
      });
      if (!site) { log.block(id, 'no lit hex 4-6 out takes a city', '', ''); return false; }
      const why = await page.evaluate(() => Network.cantSend('capital'));
      if (why) { log.block(id, `settlers can't go: ${why}`, '', ''); return false; }
      await page.evaluate((p) => Network.sendSettlers('capital', p[0], p[1]), site);
      if (!(await embark(page))) return false;
      const r = await walkTo(page, site);
      const made = await page.evaluate(() => Object.keys($SM.get('game.cities')).length);
      await walkHome(page);
      if (made < 2) { log.block(id, `settlers walked to ${site} (${r}) but no city was made`, '', ''); return false; }
      log.note(id, `2nd city at ${site}`);
      return true;
    },
  },
  {
    id: 'economy', name: "the capital's town: houses, burning pits and tallow vats, fire focus (the hearth on tallow)", needs: ['tallow', 'district'],
    run: async ({ page, log, id }) => {
      await goTo(page, 'city');
      const r = await page.evaluate(() => {
        const out = {};
        for (const t of ['huts', 'burning pits', 'woods', 'hunting grounds']) out[t] = !!__qa.district('capital', t);
        // the town's build buttons (City.build is their click)
        let houses = 0;
        for (let i = 0; i < 10; i++) if (City.buildIn('capital', 'house')) houses++;
        out.houses = houses;
        out.vats = [City.buildIn('capital', 'tallow vats'), City.buildIn('capital', 'tallow vats')].filter(Boolean).length;
        City.setFocus('capital', 'fire'); // the focus button
        return out;
      });
      log.note(id, `capital: ${JSON.stringify(r)}`);
      const ok = await advance(page, 20 * MIN, { until: () => ($SM.get('game.cities.capital.hearth') || {}).fuel === 'tallow' });
      const st = await page.evaluate(() => ({ citizens: $SM.get('game.cities.capital.population.citizens'), workers: $SM.get('game.cities.capital.workers'), tallow: $SM.get('stores.tallow', true), hearth: $SM.get('game.cities.capital.hearth') }));
      if (!ok) { log.block(id, `the capital's hearth never burned tallow in 20 game min: ${JSON.stringify(st)}`, '', ''); return false; }
      log.note(id, `capital after: ${JSON.stringify(st)}`);
      return true;
    },
  },
  {
    id: 'influence', name: 'a city-state won by influence: a beacon line touching the nearest herders, then the glow', needs: ['economy'],
    run: async ({ page, log, id }) => {
      const c = await nearestCs(page, 'herders');
      await goTo(page, 'city');
      const near = await page.evaluate((at) => __qa.beaconsToward(at, 1), c.at);
      if (near > 1) log.note(id, `the line to ${c.name} got within ${near}`);
      const t0 = await page.evaluate(() => Date.now());
      const ok = await advance(page, 60 * MIN, { arg: c.id, until: (id) => !!CityStates.state(id).city, slice: 30000 });
      const st = await csState(page, c.id);
      if (!ok) { log.block(id, `${c.name} (${c.id}, ${c.at}) not joined in 60 game min: influence ${st.inf}`, '', ''); return false; }
      log.note(id, `${c.name} (${c.id}) joined by influence after ${((await page.evaluate(() => Date.now())) - t0) / MIN | 0} game min of glow`);
      return true;
    },
  },
  {
    id: 'force', name: 'a city-state taken by force: walls, the capital on military focus, a march and a siege', needs: ['influence'],
    run: async ({ page, log, id }) => {
      const c = await nearestCs(page, 'herders');
      await restock(page);
      if (!(await csState(page, c.id)).met) log.note(id, `a trek to meet ${c.name}: ${await goSee(page, c.at)}`);
      await goTo(page, 'city');
      // weapons from the armoury (the room's craft buttons), walls for the drill yard, then the focus button
      const prep = await page.evaluate(() => {
        let swords = 0, rifles = 0;
        for (let i = 0; i < 30; i++) if (Room.build($('<div>').attr('buildThing', 'steel sword')) !== false) swords++;
        for (let i = 0; i < 10; i++) if (Room.build($('<div>').attr('buildThing', 'rifle')) !== false) rifles++;
        const walls = [__qa.district('capital', 'walls'), __qa.district('capital', 'walls'), __qa.district('capital', 'walls')].filter(Boolean).length;
        City.setFocus('capital', 'military');
        return { swords, rifles, walls };
      });
      log.note(id, `military prep: ${JSON.stringify(prep)}`);
      const drilled = await advance(page, 20 * MIN, { until: () => Armies.trained('capital') >= 25 });
      const n = await page.evaluate(() => Armies.trained('capital'));
      if (!drilled) log.note(id, `only ${n} soldiers drilled in 20 game min`);
      // a lit camp: off the light the army drinks its water every siege tick and melts away
      const near = await page.evaluate((at) => __qa.beaconsToward(at, 1), c.at);
      if (near > 1) log.note(id, `the line to ${c.name} got within ${near}`);
      await page.clock.runFor(11000);
      const why = await page.evaluate((cid) => Armies.cantMarch('capital', CityStates.byId(cid)), c.id);
      if (why) { log.block(id, `can't march on ${c.name}: ${why}`, '', ''); return false; }
      await page.evaluate((cid) => Armies.marchOn('capital', cid), c.id); // the town panel's "march on them"
      const t0 = await page.evaluate(() => Date.now());
      const ok = await advance(page, 60 * MIN, { arg: c.id, until: (id) => !!CityStates.state(id).city, slice: 10000 });
      // the army home, the capital back on its fire
      await page.evaluate(() => { Armies.list().forEach((a) => Armies.goHome(a.id)); City.setFocus('capital', 'fire'); });
      if (!ok) { log.block(id, `${c.name} not taken in 60 game min: ${JSON.stringify(await page.evaluate(() => Armies.list().map((a) => [a.state, a.siege && a.siege.ticks, Armies.soldiers(a)])))}`, '', ''); return false; }
      const how = await page.evaluate((cid) => { const city = CityStates.state(cid).city; return !!$SM.get('game.armies.after["' + city + '"]') || Armies.list().length; }, c.id);
      log.note(id, `${c.name} (${c.id}) taken ${((await page.evaluate(() => Date.now())) - t0) / MIN | 0} game min after the march (force aftermath recorded: ${how})`);
      return true;
    },
  },
  {
    id: 'resettle', name: 'a fallen city resettled (lit by a line, settlers walked in): the charcoal stranger hook', needs: ['found', 'economy'],
    run: async ({ page, log, id }) => {
      await goTo(page, 'city');
      const sites = await page.evaluate(() => {
        const c = World.hex.gen.capital;
        return World.hex.gen.sites.filter((s) => s.kind === 'fallenCity').map((s) => s.anchor)
          .sort((a, b) => Fire.distance(a, c) - Fire.distance(b, c)).slice(0, 8);
      });
      let at = null;
      for (const s of sites) {
        await page.evaluate((s) => __qa.beaconsToward(s, 1), s);
        await page.clock.runFor(11000);
        if (await page.evaluate((s) => !!Network.foundingSite(s[0], s[1]), s)) { at = s; break; }
        log.note(id, `fallen city at ${s} can't be resettled (lit ${await page.evaluate((s) => !!World.hex.fire.lit[s[0] + s[1] * World.hex.gen.cols], s)})`);
      }
      if (!at) { log.block(id, 'none of the 8 nearest fallen cities could be resettled', '', ''); return false; }
      const why = await page.evaluate(() => Network.cantSend('capital'));
      if (why) { log.block(id, `settlers can't go: ${why}`, '', ''); return false; }
      await page.evaluate((p) => Network.sendSettlers('capital', p[0], p[1]), at);
      if (!(await embark(page))) return false;
      const r = await walkTo(page, at, { stopAt: () => false });
      await walkHome(page);
      const hook = await page.evaluate(() => $SM.get('game.network.story["the charcoal stranger"]'));
      if (!hook) { log.block(id, `settlers walked to the fallen city at ${at} (${r}) but no resettled city/hook`, '', ''); return false; }
      log.note(id, `resettled the fallen city at ${at} as ${hook}`);
      return true;
    },
  },
  {
    id: 'chimney', name: 'H5 the old chimney (scene at home)', needs: ['resettle'],
    run: async ({ page, log, id }) => {
      const ev = await playScene(page, { title: 'The Old Chimney', buttons: ['rebuild the chimney', 'good'], ms: 10 * MIN });
      if (!ev || ev.missing) { log.block(id, `The Old Chimney did not play: ${JSON.stringify(ev)}`, '', ''); return false; }
      await page.clock.runFor(11000);
      return has(page, 'H5');
    },
  },
  {
    id: 'charcoal', name: 'F5 the charcoal stranger: sat with, the old pits on a trek, the burning pits at home', needs: ['chimney'],
    run: async ({ page, log, id }) => {
      const ev = await playScene(page, { title: 'A Stranger in the Ruins', buttons: ['sit with them'], ms: 15 * MIN });
      if (!ev || ev.missing) { log.block(id, `A Stranger in the Ruins did not play: ${JSON.stringify(ev)}`, '', ''); return false; }
      await settleEvents(page);
      const pits = await page.evaluate(() => $SM.get('game.network.pits'));
      if (!pits) { log.block(id, 'no old pits marked after sitting with the stranger', '', ''); return false; }
      if (!(await embark(page))) return false;
      const r = await walkTo(page, pits, { stopAt: (e) => e && e.title === 'The Old Pits' });
      if (r !== 'event') { log.block(id, `walk to the old pits at ${pits}: ${r}`, '', ''); await walkHome(page); return false; }
      await clickEvent(page, 'clear it out');
      await settleEvents(page); // the fight, its loot, "go on"
      const h = await walkHome(page);
      if (h !== 'home') { log.block(id, `trek home from the pits: ${h}`, '', ''); return false; }
      const bp = await playScene(page, { title: 'The Burning Pits', buttons: ['learn it their way', 'good'], ms: 2 * MIN });
      if (!bp || bp.missing) { log.block(id, `The Burning Pits did not play at home: ${JSON.stringify(bp)}`, '', ''); return false; }
      await page.clock.runFor(11000);
      return has(page, 'F5');
    },
  },
  {
    id: 'potters', name: 'H6 the kiln: the potters won by influence (a beacon line, the glow)', needs: ['chimney', 'influence'],
    run: async ({ page, log, id }) => {
      const c = await nearestCs(page, 'potters');
      if (!c) { log.block(id, 'no potters on the map', '', ''); return false; }
      await restock(page);
      await goTo(page, 'city');
      const near = await page.evaluate((at) => __qa.beaconsToward(at, 1), c.at);
      if (near > 1) log.note(id, `the line to ${c.name} got within ${near}`);
      const ok = await advance(page, 150 * MIN, { arg: c.id, until: (id) => !!CityStates.state(id).city, slice: 30000 });
      const st = await csState(page, c.id);
      if (!ok) { log.block(id, `${c.name} (${c.at}) not joined in 150 game min: influence ${st.inf | 0}, line within ${near}`, '', ''); return false; }
      await advance(page, 2 * MIN, { until: () => Network.has('H6') });
      return has(page, 'H6');
    },
  },
  {
    id: 'tower', name: 'B5 the watchtower: a fight won beside a lit waystation, home alive; B6 the road between two cities', needs: ['waystation', 'found'],
    run: async ({ page, log, id }) => {
      const way = await page.evaluate(() => {
        const cols = World.hex.gen.cols;
        return Network.outposts().find((p) => World.hex.fire.lit[p[0] + p[1] * cols]) || null;
      });
      if (!way) { log.block(id, 'no lit waystation', '', ''); return false; }
      if (!(await embark(page))) return false;
      const ring = await page.evaluate((w) => District.neighbours(w).filter((p) => World.canEnter(World.state.map[p[0]][p[1]]) && !World.LANDMARKS[World.state.map[p[0]][p[1]]] && World.state.map[p[0]][p[1]] !== World.TILE.VILLAGE), way);
      let held = false, steps = 0;
      // back and forth round the waystation until something comes at the wanderer there
      for (; steps < 300 && !held; steps++) {
        const r = await walkTo(page, ring[steps % ring.length], { avoid: [way] });
        if (r === 'dead' || r === 'home') break;
        held = await page.evaluate(() => !!(World.state && World.state.towerHeld));
      }
      const h = await walkHome(page);
      if (!held) { log.block(id, `no fight won beside the lit waystation at ${way} in ${steps} steps (${h})`, '', ''); return false; }
      await page.clock.runFor(11000);
      log.note(id, `the waystation held after ${steps} steps round it`);
      return (await has(page, 'B5')) && (await has(page, 'B6'));
    },
  },
  {
    id: 'peat', name: "F6 peat: the bog-cutters met on a trek, an envoy's pack of what they want, 50 influence, their scene", needs: ['charcoal'],
    run: async ({ page, log, id }) => {
      const c = await nearestCs(page, 'bog_cutters');
      if (!c) { log.block(id, 'no bog-cutters on the map', '', ''); return false; }
      await restock(page);
      const d = await page.evaluate((at) => [Fire.distance(at, World.hex.gen.capital), +World.baseDangerAt(at[0], at[1]).toFixed(2)], c.at);
      log.note(id, `the bog-cutters (${c.name}) at ${c.at}: ${d[0]} hexes, danger ${d[1]}`);
      for (let i = 0; i < 3 && !(await csState(page, c.id)).met; i++) {
        const r = await goSee(page, c.at);
        log.note(id, `trek ${i + 1} to meet them: ${r}`);
      }
      if (!(await csState(page, c.id)).met) { log.block(id, `three treks failed to meet the bog-cutters ${d[0]} hexes out`, '', ''); return false; }
      // the envoy, from the town panel, with a pack of leather (they want it: 1/3 influence a piece at band 2)
      for (let i = 0; i < 3 && (await csState(page, c.id)).inf < 50; i++) {
        await freeEnvoy(page, log, id);
        const sent = await page.evaluate((cid) => {
          if (!CityStates.sendEnvoy('capital', cid)) return CityStates.cantSend('capital', CityStates.byId(cid));
          CityStates.pack('leather', 200);
          CityStates.pack('cured meat', 100);
          return 'ok';
        }, c.id);
        if (sent !== 'ok') { log.block(id, `envoy can't go: ${sent}`, '', ''); return false; }
        if (!(await embark(page))) return false;
        const r = await walkTo(page, c.at, { stopAt: (e) => e && e.title === c.name });
        if (r === 'event') { await clickEvent(page, 'leave the pack'); await settleEvents(page); }
        const h = await walkHome(page);
        log.note(id, `envoy trek ${i + 1}: ${r}/${h}, influence ${(await csState(page, c.id)).inf | 0}`);
        if (r !== 'event') await page.evaluate(() => CityStates.callOff());
      }
      // at 50 their eldest comes to the hearth: "learn the cutting" is F6, then the way of the cutting
      const f6 = await advance(page, 15 * MIN, { until: () => Network.has('F6'), slice: 10000 });
      const st = await csState(page, c.id);
      if (!f6) { log.block(id, `F6 not in: influence ${st.inf | 0}, floor ${st.floor}, cutting ${!!st.cutting}`, '', ''); return false; }
      log.note(id, `F6 in at influence ${st.inf | 0} (floor ${st.floor}); the way: ${await page.evaluate(() => $SM.get('game.citystates.beats.F6way'))}`);
      return true;
    },
  },
  {
    id: 'bogRoad', name: "a road out to the bog-cutters before they join: a landmark near them cleared into a waystation (its road runs home)", needs: ['peat'],
    run: async ({ page, log, id }) => {
      const c = await nearestCs(page, 'bog_cutters');
      if (!c) return true;
      // the road they lay when they join looks ROAD_REACH out for a road or a city of ours
      const near = () => page.evaluate((at) => {
        const m = World.hex.map;
        return Fire.around(at[0], at[1], Network.ROAD_REACH).some((p) => m[p[0]] && [World.TILE.ROAD, World.TILE.OUTPOST, World.TILE.VILLAGE].includes(m[p[0]][p[1]]) && !(p[0] === at[0] && p[1] === at[1]));
      }, c.at);
      if (await near()) { log.note(id, 'a road or city of ours is already in reach of them'); return true; }
      const marks = await page.evaluate((at) => {
        const g = World.hex.gen, m = World.hex.map, out = [];
        for (const p of Fire.around(at[0], at[1], Network.ROAD_REACH - 2)) {
          if (p[0] < 0 || p[1] < 0 || p[0] >= g.cols || p[1] >= g.rows) continue;
          if ([World.TILE.CAVE, World.TILE.HOUSE, World.TILE.TOWN].includes(m[p[0]][p[1]]) && g.reachable[p[0] + p[1] * g.cols]) out.push(p);
        }
        return out.sort((a, b) => Fire.distance(a, at) - Fire.distance(b, at));
      }, c.at);
      log.note(id, `landmarks within ${await page.evaluate(() => Network.ROAD_REACH - 2)} of the bog-cutters: ${marks.length}`);
      for (const p of marks.slice(0, 4)) {
        for (let i = 0; i < 2 && !(await near()); i++) {
          if (!(await embark(page))) return false;
          const r = await walkTo(page, p, { stopAt: () => true });
          if (r === 'event') await playSetpiece(page);
          log.note(id, `landmark at ${p}: ${r}/${await walkHome(page)}, cleared ${await page.evaluate((p) => World.hex.map[p[0]][p[1]] === World.TILE.OUTPOST, p)}`);
          if (await page.evaluate((p) => World.hex.map[p[0]][p[1]] === World.TILE.OUTPOST, p)) break;
        }
        if (await near()) break;
      }
      if (!(await near())) { log.block(id, `no road or city of ours within ROAD_REACH of the bog-cutters (${c.at}), and no landmark near them was cleared into one`, '', ''); return false; }
      return true;
    },
  },
  {
    id: 'bogJoin', name: 'the bog-cutters joined (100) by the glow of a charcoal line', needs: ['peat'],
    run: async ({ page, log, id }) => {
      const c = await nearestCs(page, 'bog_cutters');
      if (!c) { log.note(id, 'the bog-cutters are ours already'); return true; }
      await restock(page);
      await goTo(page, 'city');
      const near = await page.evaluate((at) => __qa.beaconsToward(at, 1, 120), c.at);
      log.note(id, `a line to the bog-cutters got within ${near}`);
      const ok = await advance(page, 180 * MIN, { arg: c.id, until: (cid) => !!CityStates.state(cid).city, slice: 30000 });
      if (!ok) { log.block(id, `the bog-cutters not joined in 180 min of glow: influence ${(await csState(page, c.id)).inf | 0}, line within ${near}`, '', ''); return false; }
      return true;
    },
  },
  {
    id: 'peatFire', name: "peat burned: bog cuts on the bog-cutters' swamp, their city on fire focus", needs: ['bogJoin'],
    run: async ({ page, log, id }) => {
      const city = await page.evaluate(() => CityStates.state(CityStates.list().find((x) => x.t === 'bog_cutters').id).city);
      await goTo(page, 'city');
      const cuts = await page.evaluate((cid) => [__qa.district(cid, 'bog cuts'), __qa.district(cid, 'bog cuts')].filter(Boolean).length, city);
      await page.evaluate((cid) => City.setFocus(cid, 'fire'), city); // the focus button
      log.note(id, `${cuts} bog cuts in ${city}`);
      if (!cuts) {
        // districts go only where the fire reaches; their swamp is past what the line's fuel lights (peat, the one
        // that lights swamp further, is what the bog cuts would make)
        const why = await page.evaluate((cid) => {
          const c = $SM.get('game.cities["' + cid + '"]'), g = World.hex.gen, fuel = ($SM.get('game.cities.capital.hearth') || {}).fuel;
          const sw = Fire.around(c.hex[0], c.hex[1], 2).filter((p) => g.terrain[p[0]][p[1]] === WorldGen.TERRAIN.swamp);
          return `${sw.length} swamp hexes by their hearth, lit ${sw.filter((p) => World.hex.fire.lit[p[0] + p[1] * g.cols]).length}, ` +
            `danger ${sw.map((p) => World.dangerAt(p[0], p[1]).toFixed(2)).join('/')}; the best fuel (${fuel}) lights to ${Fire.FUELS[fuel].cap}`;
        }, city);
        log.block(id, `no bog cuts can go in the bog-cutters' city: ${why}`, 'fresh save to F6; the bog-cutters joined by a charcoal line',
          'design: the reach rule puts them in the glow of charcoal, but their swamp must also be lit for a bog cut (place their ground on lit ground, or let a joined fuel city-state bring its first district)');
        return false;
      }
      const ok = await advance(page, 20 * MIN, { arg: city, until: (cid) => ($SM.get('game.cities["' + cid + '"].hearth') || {}).fuel === 'peat' });
      if (!ok) {
        const st = await page.evaluate((cid) => ({ h: $SM.get('game.cities["' + cid + '"].hearth'), w: $SM.get('game.cities["' + cid + '"].workers'), peat: $SM.get(City.storePath(cid, 'peat'), true) }), city);
        log.block(id, `${city}'s hearth never burned peat: ${JSON.stringify(st)}`, '', '');
        return false;
      }
      return true;
    },
  },
  {
    id: 'peatCity', name: "a waypoint city founded on lit land between the capital and the bog-cutters (its road chains theirs), peat carted to it, its small hearth on peat", needs: ['peatFire'],
    run: async ({ page, log, id }) => {
      await restock(page);
      const bog = await page.evaluate(() => CityStates.state(CityStates.list().find((x) => x.t === 'bog_cutters').id).city);
      const resin = await nearestCs(page, 'resin_tappers');
      // a lit hex that takes a city, within ROAD_REACH of the bog-cutters' city and of a road or city of ours
      // toward the capital (so its road chains theirs); the one nearest the resin-tappers, whose talks a peat
      // line's glow opens
      const sites = await page.evaluate(({ bog, to }) => {
        const g = World.hex.gen, m = World.hex.map, cols = g.cols, R = Network.ROAD_REACH, cap = g.capital;
        const b = $SM.get('game.cities["' + bog + '"].hex');
        const ours = (p) => [World.TILE.ROAD, World.TILE.OUTPOST, World.TILE.VILLAGE].includes(m[p[0]][p[1]]);
        let lit = 0;
        const out = Fire.around(b[0], b[1], R).filter((p) => {
          if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= g.rows || Fire.distance(p, b) < 3) return false;
          if (World.hex.fire.lit[p[0] + p[1] * cols]) lit++;
          const f = Network.foundingSite(p[0], p[1]);
          return f && !f.site && Fire.distance(p, cap) < Fire.distance(b, cap) &&
            Fire.around(p[0], p[1], R).some((q) => m[q[0]] && ours(q) && Fire.distance(q, b) > 1 && !(q[0] === p[0] && q[1] === p[1]));
        });
        out.sort((x, y) => Fire.distance(x, to || cap) - Fire.distance(y, to || cap));
        return { lit, sites: out.slice(0, 6), b };
      }, { bog, to: resin && resin.at });
      log.note(id, `lit hexes within ${12} of ${bog} (${sites.b}): ${sites.lit}; founding sites between it and home: ${sites.sites.length} (${sites.sites.join(' ')})`);
      if (!sites.sites.length) {
        log.block(id, `no lit hex the settlers can found on within ROAD_REACH of both the bog-cutters' city (${sites.b}) and a road of ours`, '', '');
        return false;
      }
      let made = null;
      for (const p of sites.sites.slice(0, 3)) {
        const why = await page.evaluate(() => Network.cantSend('capital'));
        if (why) { log.block(id, `settlers can't go: ${why}`, '', ''); return false; }
        const n0 = await page.evaluate(() => Object.keys($SM.get('game.cities')));
        await page.evaluate((p) => Network.sendSettlers('capital', p[0], p[1]), p);
        if (!(await embark(page))) return false;
        const r = await walkTo(page, p);
        made = await page.evaluate((n0) => Object.keys($SM.get('game.cities')).find((k) => !n0.includes(k)) || null, n0);
        log.note(id, `settlers to ${p}: ${r}/${await walkHome(page)}, city ${made}`);
        if (made) break;
        await page.evaluate(() => Network.callOff());
      }
      if (!made) { log.block(id, 'the settlers founded no waypoint city', '', ''); return false; }
      await goTo(page, 'city');
      const road = await lightRoad(page, bog, made);
      log.note(id, `${bog} -> ${made}: ${JSON.stringify(road)}`);
      if (!road.carts) { log.block(id, `no carts from ${bog} to ${made}: road hexes dark ${road.dark.join(' ')}`, '', ''); return false; }
      // a cart of peat whenever there is a cartload (the road box's "send"), until the new city's hearth burns peat
      const ok = await advance(page, 60 * MIN, {
        slice: 30000, arg: made,
        each: () => page.evaluate(({ bog, made }) => { if ($SM.get(City.storePath(bog, 'peat'), true) >= Network.CART) Network.sendCart(bog, made, 'peat'); }, { bog, made }),
        until: (cid) => ($SM.get('game.cities["' + cid + '"].hearth') || {}).fuel === 'peat',
      });
      const st = await page.evaluate(({ bog, made }) => ({
        need: +Network.hearthNeed(made).toFixed(1), capital: +Network.hearthNeed('capital').toFixed(1), peat: Math.round($SM.get(City.storePath(made, 'peat'), true)),
        cut: Math.round($SM.get(City.storePath(bog, 'peat'), true)), hearth: $SM.get('game.cities["' + made + '"].hearth'),
      }), { bog, made });
      log.note(id, `${made}'s hearth wants ${st.need} fire a tick (the capital's ${st.capital}): ${JSON.stringify(st)}`);
      if (!ok) { log.block(id, `${made}'s hearth never burned peat alone: ${JSON.stringify(st)}`, '', ''); return false; }
      return true;
    },
  },
  {
    id: 'resin', name: "F7 resin: the resin-tappers' quest (met, a peat line's glow opens talks, the lost tappers found and walked home)", needs: ['peatCity'],
    run: async ({ page, log, id }) => {
      if (!(await questCs(page, log, id, 'resin_tappers'))) return false;
      const ok = await advance(page, 5 * MIN, { until: () => Network.has('F7') });
      if (!ok) log.block(id, `the resin-tappers joined but F7 is not in (beat ${await page.evaluate(() => ($SM.get('game.citystates.beats') || {}).F7)})`, '', '');
      return ok;
    },
  },
  {
    id: 'smoke', name: 'the garrison of the deep mines: smoke in the hills (a lit hex within 2 of its site), its gate met on a trek', needs: ['charcoal'],
    run: async ({ page, log, id }) => {
      await restock(page);
      await goTo(page, 'city');
      const g = await page.evaluate(() => Network.garrison());
      const near = await page.evaluate((g) => __qa.beaconsToward(g, 2), g);
      log.note(id, `the garrison's site at ${g}; a line got within ${near}`);
      // (an earlier line can have brought it already: the player answered it then)
      const seen = await page.evaluate(() => Network.flag('smoke'));
      if (seen) log.note(id, `the smoke was seen earlier (${seen})`);
      const ev = seen ? { title: 'Smoke in the Hills' } : await playScene(page, { title: 'Smoke in the Hills', buttons: ['go and look'], ms: 10 * MIN });
      // (it can also come while another scene is settled, and be answered with the rest)
      if ((!ev || ev.missing) && !(await page.evaluate(() => Network.flag('smoke')))) {
        const st = await page.evaluate((g) => {
          const site = World.siteAt(g[0], g[1]), cols = World.hex.gen.cols, f = World.hex.fire;
          return { smoke: Network._smoke, litNear: site.hexes.some((h) => Fire.around(h[0], h[1], 2).some((p) => f.lit[p[0] + p[1] * cols])),
            beacons: Object.keys($SM.get('game.network.beacons') || {}).length, lit: f.nodes.filter((n) => !n.hearth && n.s >= Fire.LIT_MIN).length,
            hearth: $SM.get('game.cities.capital.hearth'), story: Object.keys($SM.get('game.network.story') || {}).join(' ') };
        }, g);
        log.block(id, `Smoke in the Hills did not play with a line ${near} from the garrison: ${JSON.stringify(st)}`, '', '');
        return false;
      }
      await settleEvents(page);
      // the gate is known at home only if the wanderer gets back alive: treks until one does
      for (let i = 0; i < 4 && !(await page.evaluate(() => Network.flag('gateMet'))); i++) {
        if (!(await embark(page))) return false;
        const r = await walkTo(page, g, { stopAt: (e) => e && e.title === 'The Gate' });
        if (r === 'event') await settleEvents(page);
        log.note(id, `trek ${i + 1} to the gate: ${r}/${await walkHome(page)}`);
      }
      if (!(await page.evaluate(() => Network.flag('gateMet')))) { log.block(id, 'four treks to the garrison\'s gate did not bring its news home', '', ''); return false; }
      return page.evaluate(() => Powers.known('garrison'));
    },
  },
  {
    id: 'garrison', name: 'the garrison broken: a line to its gate, the adits blown, the walls pressed, the storm the wanderer leads, the captain', needs: ['smoke'],
    run: async ({ page, log, id }) => {
      await restock(page);
      await goTo(page, 'city');
      const g = await page.evaluate(() => Network.garrison());
      // the shafts need a lit beacon at the gate: on a hex beside the site, off it
      await page.evaluate((g) => {
        const s = World.siteAt(g[0], g[1]);
        const gate = s.hexes.flatMap((h) => District.neighbours(h)).filter((p) => World.siteAt(p[0], p[1]) !== s)
          .sort((a, b) => Fire.distance(a, World.hex.gen.capital) - Fire.distance(b, World.hex.gen.capital));
        for (const p of gate) {
          if (Network.gateLit()) break;
          __qa.beaconsToward(p, 0);
        }
      }, g);
      await page.clock.runFor(11000);
      const lit = await page.evaluate(() => Network.gateLit());
      if (!lit) log.note(id, 'no lit beacon next to the gate (the storm will fail)');
      const prep = await page.evaluate(() => {
        for (let i = 0; i < 40; i++) Room.build($('<div>').attr('buildThing', 'steel sword'));
        for (let i = 0; i < 10; i++) Room.build($('<div>').attr('buildThing', 'rifle'));
        let walls = City.districtHexes('capital', 'walls').length;
        while (walls < 4 && __qa.district('capital', 'walls')) walls++;
        let charges = 0;
        for (let i = 0; i < 8; i++) if (Armies.buildGear('capital', 'blasting charge') !== false) charges++;
        City.setFocus('capital', 'military');
        return { walls, charges: $SM.get('stores["blasting charge"]', true), swords: $SM.get('stores["steel sword"]', true), rifles: $SM.get('stores.rifle', true) };
      });
      log.note(id, `garrison prep: ${JSON.stringify(prep)}`);
      await advance(page, 25 * MIN, { until: () => Armies.trained('capital') >= 40 });
      const why = await page.evaluate(() => Powers.cantMarch('capital', 'garrison'));
      if (why) { log.block(id, `can't march on the garrison: ${why}`, '', ''); return false; }
      await page.evaluate(() => Powers.marchOn('capital', 'garrison'));
      // the camp: the adits blown with the army's charges first, then the walls pressed
      const camp = async (ev) => {
        if (ev.title !== 'The Siege Camp') return false;
        const open = await page.evaluate(() => Powers.open('garrison').length);
        const pick = open > 0 && ev.btns.some((b) => b.startsWith('blast an adit')) ? 'blast an adit' : 'press the walls';
        await clickEvent(page, pick);
        return true;
      };
      const breach = await advance(page, 60 * MIN, { onEvent: camp, slice: 10000, until: () => Armies.list().some((a) => a.power && a.siege && a.siege.over && a.siege.over.breach) || Powers.broken('garrison') || !Armies.list().some((a) => a.power) });
      const st = await page.evaluate(() => Armies.list().map((a) => ({ power: a.power, at: a.at, state: a.state, n: Armies.soldiers(a), siege: a.siege && { walls: a.siege.walls, garrison: a.siege.garrison, over: a.siege.over, stores: a.siege.stores } })));
      if (!breach || !st.some((a) => a.siege && a.siege.over && a.siege.over.breach)) { log.block(id, `no breach at the garrison: ${JSON.stringify(st)}, adits open ${await page.evaluate(() => Powers.open('garrison').length)}`, '', ''); return false; }
      // the wanderer goes to the army at the walls: into the shafts
      const at = st.find((a) => a.power).at || (await page.evaluate(() => Armies.list().find((a) => a.power).at));
      if (!(await embark(page))) return false;
      const r = await walkTo(page, at, { stopAt: (e) => e && e.title === 'Into the Shafts' });
      if (r === 'event') await settleEvents(page);
      await walkHome(page);
      await page.evaluate(() => { Armies.list().forEach((a) => Armies.goHome(a.id)); City.setFocus('capital', 'fire'); });
      const done = await page.evaluate(() => ({ broken: Powers.broken('garrison'), flag: Network.flag('garrisonBroken'), F8: Network.has('F8'), F7: Network.has('F7') }));
      log.note(id, `after the storm: ${JSON.stringify(done)}`);
      if (!done.broken) { log.block(id, `the storm (${r}) did not break the garrison`, '', ''); return false; }
      if (!done.F8) log.block(id, 'the garrison is broken (garrisonBroken set) but F8 coal does not come in: it waits for F7 on the fuel ladder', 'as F6 above', 'see F6');
      return true;
    },
  },
  {
    id: 'coal', name: 'F8 coal and H8 the forge hearth (the first coal burned in a city)', needs: ['garrison'],
    run: async ({ page, log, id }) => {
      await goTo(page, 'city');
      const m = await page.evaluate(() => !!__qa.district('capital', 'mines'));
      if (!m) log.note(id, 'no mines district placed beside the capital (no coal seam in reach)');
      const ok = await advance(page, 20 * MIN, { until: () => Network.has('F8') && Network.has('H8') });
      if (!ok) { log.block(id, `F8 ${await has(page, 'F8')}, H8 ${await has(page, 'H8')}`, '', ''); return false; }
      return true;
    },
  },
  {
    id: 'forgeMasters', name: "the forge-masters' price (F9's beat): met, an envoy's gifts to 25, the price (300 coal, 100 iron) at their gate", needs: ['coal'],
    run: async ({ page, log, id }) => {
      const c = await nearestCs(page, 'forge_masters');
      if (!c) { log.block(id, 'no forge-masters on the map', '', ''); return false; }
      await restock(page);
      const d = await page.evaluate((at) => [Fire.distance(at, World.hex.gen.capital), +World.baseDangerAt(at[0], at[1]).toFixed(2)], c.at);
      log.note(id, `the forge-masters (${c.name}) at ${c.at}: ${d[0]} hexes, danger ${d[1]}`);
      for (let i = 0; i < 4 && !(await csState(page, c.id)).met; i++) log.note(id, `trek ${i + 1} to meet them: ${await goSee(page, c.at)}`);
      if (!(await csState(page, c.id)).met) { log.block(id, `four treks failed to meet the forge-masters ${d[0]} hexes out (the wanderer fell each time)`, '', ''); return false; }
      // two envoy treks: steel to bring them to 25 (the price is told), then the price in the pack
      const packs = [{ steel: 60 }, { coal: 300, iron: 100 }];
      for (let i = 0, p = 0; i < 6 && p < packs.length && !(await csState(page, c.id)).city; i++) {
        if (p === 1) await restock(page);
        await freeEnvoy(page, log, id);
        const sent = await page.evaluate(({ cid, pack }) => {
          if (!CityStates.sendEnvoy('capital', cid)) return CityStates.cantSend('capital', CityStates.byId(cid));
          for (const k in pack) CityStates.pack(k, pack[k]);
          return 'ok';
        }, { cid: c.id, pack: packs[p] });
        if (sent !== 'ok') { log.block(id, `envoy can't go: ${sent}`, '', ''); return false; }
        if (!(await embark(page))) return false;
        const r = await walkTo(page, c.at, { stopAt: (e) => e && e.title === c.name });
        if (r === 'event') { await clickEvent(page, 'leave the pack'); await settleEvents(page); p++; }
        else await page.evaluate(() => CityStates.callOff());
        const h = await walkHome(page);
        await advance(page, 30000);
        const st = await csState(page, c.id);
        log.note(id, `envoy trek ${i + 1}: ${r}/${h}, influence ${st.inf | 0}, told 25 ${!!(st.told || {})[25]}`);
      }
      const beat = await page.evaluate(() => ($SM.get('game.citystates.beats') || {}).F9 || null);
      if (!beat) { log.block(id, `the forge-masters did not take the price: ${JSON.stringify(await csState(page, c.id))}`, '', ''); return false; }
      log.note(id, `F9's beat recorded (${beat}); F9 itself waits for F8 on the fuel ladder: ${await has(page, 'F9')}`);
      return true;
    },
  },
  {
    id: 'reload', name: 'the save so far loads in a fresh page (old saves load)', needs: ['prologue'],
    run: async ({ page, log, id }) => {
      const save = await page.evaluate(() => { Engine.saveGame(); return localStorage.gameState; });
      const ctx = await page.context().browser().newContext({ baseURL: new URL(page.url()).origin });
      const p2 = await ctx.newPage();
      const errs = [];
      p2.on('pageerror', (e) => errs.push(e.message));
      await p2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await p2.addInitScript((s) => { if (!sessionStorage.seeded) { sessionStorage.seeded = '1'; localStorage.clear(); localStorage.gameState = s; } }, save);
      await p2.goto('/index.html').catch(() => {});
      const up = await p2.waitForFunction(() => window.Engine && typeof Room != 'undefined' && Engine.activeModule === Room, null, { timeout: 15000 }).then(() => true, () => false);
      await ctx.close();
      if (!up || errs.length) {
        log.block(id, `the save does not load: ${errs.slice(0, 2).join(' / ') || 'the game never started'}`,
          'fresh save; clear a cave on the hex map into a waystation; reload the page',
          'World.outpostUsed reads World.usedOutposts, which is only made on embark (World.onArrival); the land view paints waystations on load (City.init -> Network.refresh -> draw -> hexGlyph). Start it as `usedOutposts: {}` in World, or guard `(World.usedOutposts || {})`');
        return false;
      }
      return true;
    },
  },
  {
    id: 'coke', name: "F9 coke: the forge-masters' price paid, F8 in", needs: ['coal', 'forgeMasters'],
    run: async ({ page, log, id }) => {
      const ok = await advance(page, 10 * MIN, { until: () => Network.has('F9') });
      if (!ok) log.block(id, 'F9 not in after the forge-masters joined and F8 is in', '', '');
      return ok;
    },
  },
  {
    id: 'bloomery', name: "H9 the bloomery: a forge district in the forge-masters' city, touching its hearth quarter", needs: ['coal', 'forgeMasters'],
    run: async ({ page, log, id }) => {
      const city = await page.evaluate(() => Network.mastersCity());
      await goTo(page, 'city');
      const at = await page.evaluate((cid) => __qa.district(cid, 'forge'), city);
      if (!at) {
        const why = await page.evaluate((cid) => { const c = $SM.get('game.cities["' + cid + '"]'); return District.neighbours(c.hex).map((p) => `${p}:${Network.districtsFor(cid, p[0], p[1]).join('/') || '-'}`).join(' '); }, city);
        log.block(id, `no forge district can go beside ${city}'s hearth quarter: ${why}`, '', '');
        return false;
      }
      const ok = await advance(page, 10 * MIN, { until: () => Network.has('H9') });
      if (!ok) log.block(id, `forge at ${at} but H9 not in (H8 ${await has(page, 'H8')}, bloomery ${await page.evaluate(() => Network.flag('bloomery'))})`, '', '');
      return ok;
    },
  },
  {
    id: 'lanterns', name: 'B7 the ford light (a lake between two lit nodes), then B8 the marsh lantern (the bog-cutters joined)', needs: ['coal', 'bogJoin'],
    run: async ({ page, log, id }) => {
      await restock(page);
      await goTo(page, 'city');
      // the nearest lake: a beacon each side of it
      const lake = await page.evaluate(() => {
        const g = World.hex.gen, c = g.capital;
        let best = null;
        for (let x = 0; x < g.cols; x++) for (let y = 0; y < g.rows; y++) {
          if (g.terrain[x][y] === WorldGen.TERRAIN.lake && (!best || Fire.distance([x, y], c) < Fire.distance(best, c))) best = [x, y];
        }
        return best;
      });
      if (!lake) { log.block(id, 'no lake on the map', '', ''); return false; }
      const near = await page.evaluate((at) => __qa.beaconsToward(at, 1, 160), lake);
      await page.evaluate((at) => {
        const far = Fire.around(at[0], at[1], 3).filter((p) => Fire.distance(p, at) >= 2).sort((a, b) => Fire.distance(b, World.hex.gen.capital) - Fire.distance(a, World.hex.gen.capital));
        for (const p of far) { if (Network.has('B7')) break; __qa.beaconsToward(p, 0, 6); Network.refresh(); }
      }, lake);
      const ok = await advance(page, 3 * MIN, { until: () => Network.has('B7') && Network.has('B8') });
      log.note(id, `the nearest lake at ${lake}: a line within ${near}; B7 ${await has(page, 'B7')}, B8 ${await has(page, 'B8')}`);
      if (!ok) log.block(id, `B7 ${await has(page, 'B7')}, B8 ${await has(page, 'B8')} after a line to the lake at ${lake} (within ${near})`, '', '');
      return ok;
    },
  },
  {
    id: 'tar', name: "F10 pitch: the tar-keepers' quest (the raiders at the pits fought), their oath", needs: ['coke'],
    run: async ({ page, log, id }) => {
      if (!(await questCs(page, log, id, 'tar_keepers'))) return false;
      const ok = await advance(page, 5 * MIN, { until: () => Network.has('F10') });
      if (!ok) log.block(id, 'the tar-keepers swore but F10 is not in', '', '');
      return ok;
    },
  },
  {
    id: 'harbour', name: 'F11 whale oil: the drowned harbour seen, lit, resettled (the keepers), a harbour district, the boats, the whales', needs: ['coal'],
    run: async ({ page, log, id }) => {
      const site = await page.evaluate(() => { const s = Network.harbourSite(); return s && { at: s.anchor, hexes: s.hexes, d: Fire.distance(s.anchor, World.hex.gen.capital), danger: +World.baseDangerAt(s.anchor[0], s.anchor[1]).toFixed(2) }; });
      if (!site) { log.block(id, 'no drowned harbour site in this world', '', ''); return false; }
      log.note(id, `the drowned harbour at ${site.at}: ${site.d} hexes, danger ${site.danger}`);
      for (let i = 0; i < 4 && !(await page.evaluate(() => Network.flag('harbourSeen'))); i++) {
        if (!(await embark(page))) return false;
        const ring = await page.evaluate((hs) => hs.flatMap((h) => Fire.around(h[0], h[1], World.LIGHT_RADIUS)), site.hexes);
        const r = await walkTo(page, ring, { stopAt: (e) => e && e.title === 'The Drowned Harbour', max: 400 });
        if (r === 'event') { await clickEvent(page, 'go to the tower'); await settleEvents(page); }
        log.note(id, `trek ${i + 1} to the harbour: ${r}/${await walkHome(page)}`);
      }
      if (!(await page.evaluate(() => Network.flag('harbourSeen')))) { log.block(id, `four treks failed to see the drowned harbour ${site.d} hexes out`, '', ''); return false; }
      await restock(page);
      await goTo(page, 'city');
      const near = await page.evaluate((at) => __qa.beaconsToward(at, 1, 120), site.at);
      await page.clock.runFor(11000);
      const f = await page.evaluate((at) => !!Network.foundingSite(at[0], at[1]), site.at);
      if (!f) { log.block(id, `the harbour's centre can't be resettled (line within ${near}, lit ${await page.evaluate((at) => !!World.hex.fire.lit[at[0] + at[1] * World.hex.gen.cols], site.at)}, fuel ${await page.evaluate(() => ($SM.get('game.cities.capital.hearth') || {}).fuel)})`, '', ''); return false; }
      await page.evaluate((p) => Network.sendSettlers('capital', p[0], p[1]), site.at);
      if (!(await embark(page))) return false;
      log.note(id, `settlers to the harbour: ${await walkTo(page, site.at, { stopAt: () => false })}/${await walkHome(page)}`);
      const city = await page.evaluate(() => $SM.get('game.network.story["the drowned harbour"]'));
      if (!city) { log.block(id, 'the harbour was not resettled', '', ''); return false; }
      await advance(page, 10 * MIN, { until: () => Network.flag('lighthouseLit') });
      await goTo(page, 'city');
      const h = await page.evaluate((cid) => __qa.district(cid, 'harbour'), city);
      if (!h) log.note(id, 'no harbour district could go in the drowned harbour');
      const ok = await advance(page, 15 * MIN, { until: () => Network.flag('boatsRelaunched') });
      log.note(id, `keepers ${await page.evaluate(() => Network.flag('lighthouseLit'))}, boats ${ok}; B11 ${await has(page, 'B11')} (waits on B10, power 3), F11 ${await has(page, 'F11')} (waits on F10)`);
      if (!ok) { log.block(id, 'the boats were not relaunched', '', ''); return false; }
      return true;
    },
  },
  {
    id: 'powers', name: 'powers 2-5 (riders F10, wardens B10, foundry H11, fleet B12): not merged, where the run stops by design', needs: ['prologue'],
    run: async ({ page, log, id }) => {
      const listed = await page.evaluate(() => Powers.LIST.map((P) => `${P.id}:${P.unlock}`));
      log.note(id, `Powers.LIST holds ${listed.join(', ')}; B10 (pass held), H11 (foundry taken), B12 (fleet broken) have no trigger without powers 3-5, ` +
        'and B11 (lighthouse) and H12 (boiler) wait behind B10 and H11 on their ladders. F10 can come by the tar-keepers\' oath (Phase 4 quest) without power 2.');
      return true;
    },
  },
];
