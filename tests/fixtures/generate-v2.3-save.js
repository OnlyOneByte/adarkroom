// SPDX-License-Identifier: MIT
//
// Regenerates v2.3-fire.json: a save from fork 543e3d8 (Phase 3a) with an open town,
// a lit fire network (ember tiers, a beacon, a district), the hex map (seed 4242) and one
// hex trek walked and brought home. Run it against that commit's code, not later changes:
//
//   PORT=8090 HOST=127.0.0.1 node dev-server.js   # in a checkout of 543e3d8
//   node tests/fixtures/generate-v2.3-save.js tests/fixtures/v2.3-fire.json [baseURL]
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2];
const baseURL = process.argv[3] || 'http://127.0.0.1:8090';
const JQUERY = fs.readFileSync(new URL('../../lib/jquery.min.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => { throw e; });
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.request().url().includes('jquery.min.js')
  ? route.fulfill({ contentType: 'application/javascript', body: JQUERY })
  : route.abort());
await page.goto(`${baseURL}/index.html`);
await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);

await page.click('#lightButton');
await page.evaluate(() => {
  clearTimeout(Events._eventTimeout);
  Room.unlockForest();
  $SM.set('game.builder.level', 4);
  $SM.setM('stores', { wood: 50000, fur: 5000, meat: 5000, 'cured meat': 60, compass: 1 });
  $SM.setM('game.buildings', { cart: 1, trap: 5, hut: 20, lodge: 1, 'trading post': 1, smokehouse: 1, tannery: 1 });
  $SM.set('game.population', 80);
  $SM.setM('game.workers', { hunter: 10, trapper: 5, tanner: 5, charcutier: 5 });
  WorldGen.newSeed = () => 4242;
  if (!$SM.get('features.location.path')) Path.init();
  City.checkUnlock();
});
await page.evaluate(() => {
  Path.outfit = { 'cured meat': 20 };
  Path.embark();
  Math.random = () => 0.99; // no fights on the way
  for (let i = 0; i < 3; i++) World.moveEast();
  for (let i = 0; i < 2; i++) World.moveNorth();
  World.goHome();
});
// the fire network: the ember tiers, a beacon east of the capital, a district, one fire tick
await page.evaluate(() => {
  const t = {};
  ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'].forEach((id) => { t[id] = true; });
  $SM.set('game.network.tiers', t);
  $SM.setM('game.network.story', { stoneHearth: true, brazier: true, firstBrazier: true });
  $SM.set('stores.tallow', 500);
  const cap = World.hex.gen.capital;
  for (let x = cap[0] + 2; x <= cap[0] + 3; x++) {
    World.hex.mask[x][cap[1]] = true;
    if (Network.raiseBeacon(x, cap[1])) break;
  }
  for (let d = 0; d < 6; d++) {
    const p = WorldGen.neighbour(cap[0], cap[1], d), types = Network.districtsFor('capital', p[0], p[1]);
    if (types.length && Network.placeDistrict('capital', p[0], p[1], types[0])) break;
  }
  Network.tick();
});
const state = await page.evaluate(() => { Engine.saveGame(); return localStorage.gameState; });
fs.writeFileSync(out, JSON.stringify(JSON.parse(state), null, 2) + '\n');
await browser.close();
console.log('wrote', out);
