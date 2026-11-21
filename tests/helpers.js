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
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);
  return errors;
}

export const getState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(State)));

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

