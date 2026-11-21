// SPDX-License-Identifier: MIT
/*
 * tools/bench.js --browser: the benchmark in the real page, in Chromium through Playwright.
 *
 * Serves the game locally (dev-server.js on 127.0.0.1), opens it from a v2.2 hex-map save the way the
 * tests do (tests/helpers.js openGame), builds the late-game state in the page (tools/bench/synth.js)
 * and measures with every module's DOM work and the real localStorage. The canvas draws are timed up
 * to a pixel read-back, so the rasterising is in the number, not left for the next frame.
 * opts.profile: a path to write a CPU profile of the measurements to (Chrome DevTools Protocol).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { synth } from './synth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8183;
// tests/helpers.js reads lib/jquery.min.js from the working directory
process.chdir(ROOT);
const { openGame } = await import('../../tests/helpers.js');

async function serve() {
  const server = spawn(process.execPath, ['dev-server.js'], { cwd: ROOT, env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('Listening')) resolve(); });
    server.on('exit', (code) => reject(new Error(`dev-server exited (${code})`)));
  });
  return server;
}

// Runs in the page: every measurement, in ms (danger in lookups a second)
function measure() {
  const time = (fn, reps) => {
    fn();
    const t = [];
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      fn();
      t.push(performance.now() - t0);
    }
    t.sort((x, y) => x - y);
    return { median: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)], max: t[t.length - 1] };
  };
  const out = {};
  out.income = time(() => $SM.collectIncome(), 100);
  out.fire = time(() => Network.tick(), 5);
  out.refresh = time(() => Network.refresh(), 10);
  const keys = Object.keys($SM.get('game.network.beacons'));
  const cutAt = keys[Math.floor(keys.length / 2)].split(',').map(Number);
  out.cut = time(() => {
    Network.putOut(cutAt[0], cutAt[1]);
    $SM.set('game.network.beacons["' + cutAt.join(',') + '"]', true, true);
  }, 5);
  Network.refresh();

  const cols = World.hex.gen.cols, n = cols * World.hex.gen.rows;
  let done = 0, sink = 0;
  const end = performance.now() + 300;
  while (performance.now() < end) {
    for (let k = 0; k < n; k++) { const x = k % cols; sink += World.dangerAt(x, (k - x) / cols); }
    done += n;
  }
  out.danger = done / 0.3;

  out.save = time(() => Engine.saveGame(), 10);
  out.size = localStorage.gameState.length;
  out.load = time(() => JSON.parse(localStorage.gameState), 10);

  // the hex map's view (World.VIEW) over the capital and over a few cities, as a drag redraws it
  const el = $('<div>').attr('id', 'benchMap').addClass('hex').css({ position: 'absolute', left: 0, top: 0 }).appendTo('body');
  const dpr = window.devicePixelRatio || 1;
  const canvas = $('<canvas>').attr({ width: World.VIEW[0] * dpr, height: World.VIEW[1] * dpr })
    .css({ width: World.VIEW[0] + 'px', height: World.VIEW[1] + 'px' }).appendTo(el)[0];
  $('<span>').addClass('landmark hexProbe').appendTo(el);
  const flush = (c) => c.getContext('2d').getImageData(0, 0, 1, 1);
  const cities = Network.cities();
  const cams = [World.hex.gen.capital].concat([1, 2, 3, 4].map((i) => cities[Math.floor(i * cities.length / 5)].city.hex));
  out.draws = cams.map((at) => time(() => {
    World.paintHex(el, { cam: World.hexCentre(at[0], at[1]), view: World.VIEW, map: World.hex.map, mask: World.hex.mask, me: null, pack: null });
    flush(canvas);
  }, 10).median);
  el.remove();
  // the town's land view (Network.VIEW)
  out.land = time(() => { Network.draw(); flush($('#landMap canvas')[0]); }, 10);
  out.sources = Object.keys($SM.get('income')).length;
  out.dpr = dpr;
  return out;
}

export async function benchBrowser(opts) {
  const server = await serve();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ baseURL: `http://127.0.0.1:${PORT}` })).newPage();
    const save = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/v2.2-hex.json'), 'utf8'));
    const errors = await openGame(page, { save });
    // no timers of its own while it is measured: every tick is called by hand
    await page.evaluate(() => {
      [Engine._incomeTimeout, Network._tickTimeout, Events._eventTimeout, City._popTimeout].forEach(clearTimeout);
      Engine.setTimeout = () => 0;
    });
    const t0 = Date.now();
    const state = await page.evaluate(synth, opts);
    const setup = Date.now() - t0;
    let cdp = null;
    if (opts.profile) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      await cdp.send('Profiler.start');
    }
    const m = await page.evaluate(measure);
    if (cdp) fs.writeFileSync(opts.profile, JSON.stringify((await cdp.send('Profiler.stop')).profile));
    if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
    const rows = [];
    const row = (id, label, value, note) => rows.push({ id, label, value, note });
    row('incomeTick', 'income tick, 1 s ($SM.collectIncome), 95th percentile of 100', m.income.p95, `median ${m.income.median.toFixed(2)} ms, max ${m.income.max.toFixed(1)} ms; ${m.sources} sources`);
    row('fireTick', 'fire tick, 10 s (Network.tick), median of 5', m.fire.median, `max ${m.fire.max.toFixed(1)} ms; with the town panel's DOM updates`);
    row('network', 'network recompute, full (Network.refresh)', m.refresh.median, `max ${m.refresh.max.toFixed(1)} ms; includes the land view's redraw`);
    row('networkCut', 'network recompute after one beacon cut (Network.putOut)', m.cut.median, '');
    row('danger', 'danger lookups (World.dangerAt)', m.danger, '');
    row('save', 'save (Engine.saveGame to localStorage)', m.save.median, `max ${m.save.max.toFixed(1)} ms`);
    row('saveSize', 'save size', m.size / 1024, 'localStorage.gameState, in characters');
    row('load', 'load (JSON.parse of the save)', m.load.median, '');
    const worst = Math.max(...m.draws);
    row('draw', `hex map view ${600}x${420} (World.paintHex), worst of ${m.draws.length} places`, worst,
      `medians ${m.draws.map((d) => d.toFixed(1)).join(' / ')} ms; devicePixelRatio ${m.dpr}; headless, software raster`);
    row('landDraw', 'town land view 460x300 (Network.draw)', m.land.median, `max ${m.land.max.toFixed(1)} ms`);
    return { state, setup, rows };
  } finally {
    await browser.close();
    server.kill();
  }
}
