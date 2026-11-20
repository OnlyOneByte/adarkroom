// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openGame, getState, freshToTown } from './helpers.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

// A fresh game with the town open, every ember tier but the ones a test names, and helpers.
async function townWithFire(page, { tiers = ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'] } = {}) {
  const { errors } = await freshToTown(page);
  await page.evaluate((tiers) => {
    clearTimeout(Events._eventTimeout);
    clearTimeout(Network._tickTimeout);
    Network._nextAsk = Date.now() + 1e9; // no story scenes unless a test asks
    const t = {};
    tiers.forEach((id) => { t[id] = true; });
    $SM.set('game.network.tiers', t);
    $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnDone: true });
    // raises a line of n beacons going east from the capital, 3 hexes apart, on open ground
    window.lineEast = (n) => {
      const cap = World.hex.gen.capital, out = [];
      for (let x = cap[0] + 3; out.length < n && x < cap[0] + 60; x += 3) {
        const prev = out.length ? out[out.length - 1] : cap;
        let at = null;
        for (let dy = 0; dy < 3 && !at; dy++) {
          for (const y of [prev[1] + dy, prev[1] - dy]) {
            World.hex.mask[x][y] = true; // seen or not, the test lays it where it wants
            if (Network.canBeacon(x, y) && Fire.distance(prev, [x, y]) <= Fire.HOP) { at = [x, y]; break; }
          }
        }
        if (!at) break;
        $SM.set('game.network.beacons["' + at[0] + ',' + at[1] + '"]', true);
        out.push(at);
      }
      Network.refresh();
      return out;
    };
    window.litCount = () => World.hex.fire.lit.reduce((a, b) => a + b, 0);
    window.isLit = (p) => !!World.hex.fire.lit[p[0] + p[1] * World.hex.gen.cols];
    window.burnTick = () => Network.tick();
  }, tiers);
  return errors;
}

test('the town hearth lights home; a beacon line carries fire out, losing some per hop', async ({ page }) => {
  const errors = await townWithFire(page);
  const r = await page.evaluate(() => {
    $SM.set('stores.tallow', 1000);
    burnTick();
    const hearth = $SM.get('game.cities.capital.hearth');
    const home = litCount();
    const line = lineEast(3);
    burnTick();
    const nodes = World.hex.fire.nodes.map((n) => Math.round(n.s * 100) / 100);
    return { hearth, home, n: line.length, after: litCount(), nodes, lastLit: isLit(line[line.length - 1]), wood: $SM.get('stores.wood') };
  });
  expect(r.hearth.fuel).toBe('tallow'); // the strongest unlocked fuel in stock
  expect(r.home).toBeGreaterThan(0);
  expect(r.n).toBe(3);
  expect(r.after).toBeGreaterThan(r.home);
  // watch fire: 24 at the hearth, keeping 70% per hop
  expect(r.nodes).toEqual([24, 16.8, 11.76, 8.23]);
  expect(r.lastLit).toBe(true);
  expect(errors).toEqual([]);
});
