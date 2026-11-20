// SPDX-License-Identifier: MIT
//
// Regenerates tests/fixtures/v1.3-village.json: plays the UNMODIFIED v1.3 game
// headlessly to a small village (huts, lodge, trading post, workers) and dumps
// localStorage.gameState. Run against upstream code, not fork changes:
//
//   npm start   # in another shell, serves on :8080
//   node tests/fixtures/generate-v1.3-save.js [baseURL]
//
// The fire, stranger and forest unlock run on the game's own timers (on a fake
// clock). Wood comes from the real gather action; the builder's "helping" level
// and the furs/meat a lodge needs are granted directly, because in the real
// game they arrive through random events and long waits.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const baseURL = process.argv[2] || 'http://127.0.0.1:8080';
const out = new URL('./v1.3-village.json', import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => { throw e; });
await page.clock.install();
await page.goto(`${baseURL}/index.html`);
await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);

const tick = (ms) => page.clock.runFor(ms);

await page.click('#lightButton');
// Stranger arrives, warms up, and the forest opens.
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => Room.stokeFire());
  await tick(30 * 1000);
}
await page.waitForFunction(() => $SM.get('game.builder.level') >= 3 && $('#outsidePanel').length);
await page.evaluate(() => $SM.set('game.builder.level', 4));

const gather = async (n) => {
  for (let i = 0; i < n; i++) await page.evaluate(() => Outside.gatherWood());
};
const build = async (thing, n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => Room.build($('<div>').attr('buildThing', t)), thing);
  }
};
await gather(10);
await build('cart');
await gather(40); // the cart carries 50 a trip
await page.evaluate(() => { $SM.add('stores.fur', 120); $SM.add('stores.meat', 20); });
await build('trap', 3);
await build('hut', 4);
await build('lodge');
await build('trading post');

await page.evaluate(() => { Outside.increasePopulation(); Outside.increasePopulation(); });
await page.evaluate(() => {
  $SM.add('game.workers["hunter"]', 3);
  $SM.add('game.workers["trapper"]', 2);
});
await tick(25 * 1000); // let a couple of income ticks land

const state = await page.evaluate(() => JSON.parse(localStorage.gameState));
fs.writeFileSync(out, JSON.stringify(state, null, 2) + '\n');
console.log(`wrote ${out.pathname}: v${state.version}, huts=${state.game.buildings.hut}, pop=${state.game.population}`);
await browser.close();
