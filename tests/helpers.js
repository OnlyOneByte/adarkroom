// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

const JQUERY = fs.readFileSync(path.resolve('lib/jquery.min.js'), 'utf8');

// Opens the game with the given save (or a fresh one) and collects errors.
// Every non-local request is answered locally: the jQuery CDN is served from
// lib/jquery.min.js, anything else is aborted, so tests never touch the network.
export async function openGame(page, { save } = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    if (route.request().url().includes('jquery.min.js')) {
      return route.fulfill({ contentType: 'application/javascript', body: JQUERY });
    }
    return route.abort();
  });

  // A fresh game greets new players with a "Sound Available!" event 3 s after load
  // (Engine.init). It would cover whatever button a test clicks at that moment, so
  // tests never get it; random events are cleared per test (Events._eventTimeout).
  await page.addInitScript(() => {
    const setTimeout = window.setTimeout;
    window.setTimeout = function (fn, ...rest) {
      return fn && fn.name === 'notifyAboutSound' ? 0 : setTimeout.call(this, fn, ...rest);
    };
  });

  if (save) {
    // Seed storage once, before any game script runs.
    await page.addInitScript((state) => {
      if (!sessionStorage.seeded) {
        sessionStorage.seeded = '1';
        localStorage.clear();
        localStorage.gameState = state;
      }
    }, JSON.stringify(save));
  }

  await page.goto('/index.html');
  // Engine can exist before room.js has defined Room: typeof keeps the check from throwing
  await page.waitForFunction(() => window.Engine && typeof Room != 'undefined' && Engine.activeModule === Room);
  return errors;
}

export const getState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(State)));

// Stops the page's clock before the game loads: no timer fires (the 1 s income tick, the fire tick)
// until the test moves it (page.clock.runFor, or resume). page.clock.install alone lets time run on,
// so on a slow host an income tick could land between the load and the test reading the stores.
export async function freezeClock(page) {
  const start = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
}

// A fresh game that has walked the square map, then opens the town the normal way.
// beforeTown: a function run in the page on the square map, just before the town opens
export async function freshToTown(page, { beforeTown } = {}) {
  const errors = await openGame(page);
  await page.locator('#lightButton').click();
  await page.evaluate(() => {
    clearTimeout(Events._eventTimeout); // no random events mid-test
    // the same world every run: set before the compass is stored, which opens the path and makes the world
    WorldGen.newSeed = () => 4242;
    Room.unlockForest();
    $SM.set('game.builder.level', 4);
    $SM.set('game.temperature', Room.TempEnum.Hot);
    $SM.setM('stores', { wood: 100000, fur: 10000, meat: 10000, 'cured meat': 50, compass: 1, waterskin: 1 });
    if (!Path.tab) Path.init();
    // pack cured meat the way the player does, through the outfitting buttons, as much as fits
    window.packMeat = () => {
      Path.updateOutfitting();
      Path.increaseSupply.call($('#outfit_row_cured-meat .upBtn')[0], { data: 1000 });
    };
  });
  // a trek on the square map: walk east, come home
  const square = await page.evaluate(() => {
    packMeat();
    Path.embark();
    Math.random = () => 0.99; // no fights
    for (let i = 0; i < 5; i++) World.moveEast();
    World.goHome();
    return { map: $SM.get('game.world.map'), mask: $SM.get('game.world.mask'), hex: !!World.hex };
  });
  expect(square.hex).toBe(false);
  expect(square.map.length).toBe(61);
  if (beforeTown) await page.evaluate(beforeTown);
  // 20 huts and a trading post, built through the room
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) Room.build($('<div>').attr('buildThing', 'hut'));
  });
  expect(await page.evaluate(() => !!World.hex)).toBe(false);
  await page.evaluate(() => Room.build($('<div>').attr('buildThing', 'trading post')));
  return { errors, square };
}

// Puts the wanderer on the hex map (seed 4242), with helpers to find and take a step.
export async function onHexTrek(page) {
  const { errors } = await freshToTown(page);
  await page.locator('#location_path').click();
  await page.evaluate(() => {
    // no first-sighting scenes of city-states mid-test (tests/citystates.spec.js has its own)
    for (const t in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + t + '"]', true, true);
    packMeat();
    Path.embark();
    Math.random = () => 0.99; // no fights
    // a reachable hex outside any site whose neighbour matches, and the direction to it
    window.findStep = (from, to) => {
      const g = World.hex.gen, m = World.state.map;
      for (let y = 1; y < g.rows - 1; y++) {
        for (let x = 1; x < g.cols - 1; x++) {
          if (!g.reachable[x + y * g.cols] || World.siteAt(x, y) || !from(m[x][y], x, y)) continue;
          for (let d = 0; d < 6; d++) {
            const n = WorldGen.neighbour(x, y, d);
            if (!World.siteAt(n[0], n[1]) && to(m[n[0]][n[1]], n[0], n[1])) return { at: [x, y], dir: d, to: n };
          }
        }
      }
      return null;
    };
    window.stepFrom = (s) => {
      World.curPos = s.at.slice();
      World.moveHex(s.dir);
      return World.curPos.slice();
    };
  });
  await page.waitForFunction(() => !$('#outerSlider').is(':animated')); // the slide to the map
  return errors;
}

// A fresh game with the town open (seed 4242), every ember tier, and the ticks run by hand.
export async function townWithCityStates(page) {
  const { errors } = await freshToTown(page);
  await page.evaluate(() => {
    clearTimeout(Events._eventTimeout);
    clearTimeout(Network._tickTimeout);
    clearTimeout(CityStates._tickTimeout);
    Network._nextAsk = Date.now() + 1e9; // no ember story scenes
    const t = {};
    ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'].forEach((id) => { t[id] = true; });
    $SM.set('game.network.tiers', t);
    $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnDone: true });
    $SM.setM('stores', { tallow: 100000, 'cured meat': 5000, leather: 1000, bait: 1000 });
    $SM.set('game.population', 80);
    // one fire tick: the hearths, then the city-states
    window.tick = (n = 1) => { for (let i = 0; i < n; i++) { Network.tick(); clearTimeout(Network._tickTimeout); CityStates.update(); } };
    // the hearth has burned since the town opened: its fire lights the ground districts and beacons need
    Network.tick();
    clearTimeout(Network._tickTimeout);
    const g = World.hex.gen, cap = g.capital;
    window.cap = cap;
    window.nearest = (t) => CityStates.list().filter((c) => c.t === t)
      .sort((a, b) => WorldGen.distance(a.at, cap) - WorldGen.distance(b.at, cap))[0];
    // beacons from the capital to a hex next to the city-state, each within a hop of the last, as a player
    // raises them after walking the way (the hexes on the way are seen)
    window.lineTo = (c) => {
      const goal = District.neighbours(c.at).filter((p) => Network.canBeacon(p[0], p[1]) || true)
        .sort((a, b) => WorldGen.distance(a, cap) - WorldGen.distance(b, cap))[0];
      let at = cap;
      for (let i = 0; i < 40 && !(at[0] === goal[0] && at[1] === goal[1]); i++) {
        Fire.around(at[0], at[1], Fire.HOP).forEach((p) => { if (World.hex.mask[p[0]]) World.hex.mask[p[0]][p[1]] = true; });
        // the nearest to the goal that the fire reaches once raised (a dark beacon anchors nothing)
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
    window.embark = () => {
      Path.outfit = { 'cured meat': 50 };
      Path.embark();
      Math.random = () => 0.99; // no fights
    };
    // a step onto a hex from a neighbour the wanderer can stand on
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

// clicks an event button by its text, waiting for the event panel
export async function choose(page, text) {
  const b = page.locator('#event .button', { hasText: text }).first();
  await b.waitFor();
  await b.click();
  await page.waitForTimeout(50);
}

export const EMBER = ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'];

// A fresh game with the town open, the tiers named (every ember tier by default), tallow in stock,
// no scene unless a test asks, and helpers to make a second city and walk to a hex.
export async function flameTown(page, { tiers = EMBER } = {}) {
  const { errors } = await freshToTown(page);
  await page.evaluate((tiers) => {
    clearTimeout(Events._eventTimeout);
    clearTimeout(Network._tickTimeout);
    Network._nextAsk = Date.now() + 1e9;
    // no first sightings of city-states mid-test (tests/citystates.spec.js has its own)
    for (const k in CityStates.TEMPERAMENTS) $SM.set('game.citystates.sighted["' + k + '"]', true, true);
    const t = {};
    tiers.forEach((id) => { t[id] = true; });
    $SM.set('game.network.tiers', t);
    $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnDone: true });
    $SM.setM('stores', { tallow: 1000, 'cured meat': 2000 });
    $SM.set('game.population', 80);
    window.burnTick = () => Network.tick();
    burnTick();
    const g = World.hex.gen, cap = g.capital;
    window.isLit = (p) => !!World.hex.fire.lit[p[0] + p[1] * g.cols];
    window.blankSite = (min = 3) => {
      for (const p of Fire.around(cap[0], cap[1], 6)) {
        if (Fire.distance(p, cap) < min || World.siteAt(p[0], p[1])) continue;
        World.hex.mask[p[0]][p[1]] = World.hex.mask[p[0]][p[1]] || isLit(p);
        const f = Network.foundingSite(p[0], p[1]);
        if (f && WorldGen.isPassable(World.hex.map[p[0]][p[1]]) && World.hex.map[p[0]][p[1]] !== WorldGen.TERRAIN.ocean) return p;
      }
      return null;
    };
    // a second city on a lit hex near the capital, made directly
    window.secondCity = (citizens = 8) => {
      const at = blankSite(), d = {};
      d[at.join(',')] = 'hearth quarter';
      City.createCity('city2', 'second town', { hex: at, districts: d, stores: { wood: 500 }, citizens, parent: 'capital' });
      Network.refresh();
      return at;
    };
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
  }, tiers);
  return errors;
}
