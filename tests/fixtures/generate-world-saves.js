// SPDX-License-Identifier: MIT
//
// Regenerates a save that has explored the square world map, from an OLD
// version of the game. Run it against that version's code, not fork changes:
//
//   v1.3-world.json  upstream 1fada46, a full village (20 huts, trading post) and one trek
//   v2.0-town.json   fork f821fc3 (Phase 1), the same plus an open town
//
//   python3 -m http.server 8090 --bind 127.0.0.1   # in a checkout of that commit
//   node tests/fixtures/generate-world-saves.js <out.json> [baseURL]
//
// The village is granted directly (the room's build steps are covered by
// city.spec.js); the trek is walked with the world's own moves and goHome().
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
  $SM.setM('stores', { wood: 5000, fur: 500, meat: 500, 'cured meat': 40, compass: 1 });
  $SM.setM('game.buildings', { cart: 1, trap: 5, hut: 20, lodge: 1, 'trading post': 1 });
  $SM.set('game.population', 40);
  if (!$SM.get('features.location.path')) Path.init();
});
await page.evaluate(() => {
  Path.outfit = { 'cured meat': 20 };
  Path.embark();
  Math.random = () => 0.99; // no fights on the way
  for (let i = 0; i < 6; i++) World.moveEast();
  for (let i = 0; i < 4; i++) World.moveSouth();
  World.goHome();
});
const state = await page.evaluate(() => localStorage.gameState);
fs.writeFileSync(out, JSON.stringify(JSON.parse(state), null, 2) + '\n');
await browser.close();
console.log('wrote', out);
