// SPDX-License-Identifier: MIT
/*
 * Performance benchmark at the Huge scale (DESIGN.md "Scale"): the 160x100 hex world (16,000 hexes)
 * with a late-game empire on it (tools/bench/synth.js: 64 cities with districts and jobs, ~500
 * beacons, the whole map seen), measured against provisional budgets.
 *
 *   node tools/bench.js              the game's rules headless in a Node vm (like tools/sim.js)
 *   node tools/bench.js --browser    the same state in the real page, Chromium via Playwright:
 *                                    the ticks with their DOM work, saves to localStorage, canvas draws
 *   node tools/bench.js --profile    the Node run under --cpu-prof (or, with --browser, the page's
 *                                    measurements under the DevTools profiler); prints the top functions
 *   options: --cities N --beacons N --seed N --json
 * Exits 1 when a measurement is over its budget.
 *
 * Headless, the jQuery DOM calls go to a no-op stand-in, so the Node numbers are the game logic
 * alone; the state updates still reach the handlers City and Network subscribe in the game, and
 * every save is a real JSON.stringify of the whole state, as Engine.saveGame does.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { synth } from './bench/synth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Budgets, all provisional:
 *   tick     16 ms   one frame at 60 fps: a tick that runs longer drops a frame of whatever is moving
 *   network  50 ms   it runs on a click (raise, put out, place): under 50 ms the click still feels instant
 *   save    200 ms, 500 KB   one save; localStorage holds ~5 MB per origin, and the export is base64 (+33%)
 *   draw     16 ms   a drag redraws the view every mouse move: one frame at 60 fps
 *   danger  1e6 / s  a fight roll or a path search reads it per hex; a million a second keeps a
 *                    16,000-hex sweep under 16 ms
 */
export const BUDGETS = {
  incomeTick: { max: 16, unit: 'ms' },
  fireTick: { max: 16, unit: 'ms' },
  cityStatesTick: { max: 16, unit: 'ms' },
  armiesTick: { max: 16, unit: 'ms' },
  armyRoute: { max: 50, unit: 'ms' },
  network: { max: 50, unit: 'ms' },
  networkCut: { max: 50, unit: 'ms' },
  fireCompute: { max: 50, unit: 'ms' },
  danger: { min: 1e6, unit: '/s' },
  save: { max: 200, unit: 'ms' },
  saveSize: { max: 500, unit: 'KB' },
  load: { max: 200, unit: 'ms' },
  draw: { max: 16, unit: 'ms' },
  landDraw: { max: 16, unit: 'ms' },
};

// What the game's scripts expect around them, with the DOM a no-op
const STUBS = `
var State = {};
var __storage = {};
var __count = { saves: 0, events: 0 };
var __dom = new Proxy(function () {}, {
  get: function (t, p) {
    if (p === 'length') return 0;
    if (p === Symbol.toPrimitive) return function () { return ''; };
    return function () { return __dom; };
  },
  apply: function () { return __dom; }
});
var $ = function () { return __dom; };
var __subs = [];
$.Dispatch = function () {
  return {
    subscribe: function (f) { __subs.push(f); },
    publish: function (e) { __count.events++; for (var i = 0; i < __subs.length; i++) __subs[i](e); }
  };
};
$.isEmptyObject = function (o) { for (var k in o) return false; return true; };
$.extend = function () {
  var args = Array.prototype.slice.call(arguments), deep = false;
  if (typeof args[0] === 'boolean') deep = args.shift();
  var t = args[0] || {};
  for (var i = 1; i < args.length; i++) {
    var s = args[i];
    for (var k in s) {
      var v = s[k];
      if (deep && v && typeof v === 'object') {
        var base = Array.isArray(v) ? (Array.isArray(t[k]) ? t[k] : []) : (t[k] && typeof t[k] === 'object' ? t[k] : {});
        t[k] = $.extend(true, base, v);
      } else if (v !== undefined) t[k] = v;
    }
  }
  return t;
};
var Engine = {
  activeModule: null,
  saveGame: function () { __count.saves++; __storage.gameState = JSON.stringify(State); },
  log: function () {}, event: function () {}, setTimeout: function () { return 0; },
  getIncomeMsg: function () { return ''; }
};
var Notifications = { notify: function () {} };
var Room = { updateIncomeView: function () {}, compassTooltip: function () {}, TempEnum: { Warm: { value: 2 } } };
var Button = { Button: function () { return __dom; }, setDisabled: function () {} };
var Space = {}, AudioEngine = { playSound: function () {} }, AudioLibrary = {};
var Events = { activeEvent: function () { return null; }, startEvent: function () {}, Story: {} };
`;
const SCRIPTS = ['state_manager', 'city', 'danger', 'worldgen', 'world', 'fire', 'districts', 'network', 'citystates', 'events/citystates', 'armies', 'events/armies'];

// Loads the game's scripts as globals of this process, as the page does. (Not a vm context: every
// global lookup there goes through the context's interceptor, some 250x slower, which would swamp
// what is measured.) So it can run once per process.
export function loadGame({ seed }) {
  globalThis._ = (s, ...a) => s.replace(/\{(\d)\}/g, (m, i) => a[i]);
  vm.runInThisContext(STUBS, { filename: 'tools/bench.js:stubs' });
  for (const f of SCRIPTS) {
    const file = `script/${f}.js`;
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  }
  // a town that has just opened its hex map, the way a save loads it
  vm.runInThisContext(`
    $SM.init();
    $SM.set('version', 2.3, true);
    $SM.set('game.difficulty', 'normal', true);
    $SM.setM('features.location', { room: true, outside: true, world: true, city: true }, true);
    World.setupLandmarks();
    $SM.set('game.world', { seed: ${seed}, map: World.generateMap(WorldGen.rng(${seed})), mask: World.newMask() }, true);
    City.createCity(City.CAPITAL, 'capital');
    $SM.set('game.empire.treasury', {}, true);
    $SM.set('game.network', { tiers: {}, beacons: {}, story: {} }, true);
    World.openHexMap();
    CityStates.init();
    Armies.init();
    // the handlers the modules subscribe in their init
    $.Dispatch('stateUpdate').subscribe($SM.handleStateUpdates);
    $.Dispatch('stateUpdate').subscribe(City.handleStateUpdates);
    $.Dispatch('stateUpdate').subscribe(World.handleStateUpdates);
    $.Dispatch('stateUpdate').subscribe(Network.handleStateUpdates);
  `);
  return globalThis;
}

// runs fn reps times (after one warm-up); times in ms
function time(fn, reps) {
  fn();
  const t = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  t.sort((x, y) => x - y);
  return { median: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)], max: t[t.length - 1] };
}

export function benchNode({ cities = 64, beacons = 500, seed = 7 } = {}) {
  const t0 = performance.now();
  const ctx = loadGame({ seed });
  ctx.__opts = { cities, beacons, seed };
  const state = vm.runInThisContext(`(${synth.toString()})(__opts)`);
  const setup = performance.now() - t0;
  const run = (src) => vm.runInThisContext(src);
  const { $SM, Network, Fire, World, __count } = ctx;
  const out = { state, setup, rows: [] };
  const row = (id, label, value, note) => out.rows.push({ id, label, value, note });
  const counted = (fn) => {
    const s = __count.saves, e = __count.events;
    fn();
    return { saves: __count.saves - s, events: __count.events - e };
  };

  // the 1 s income tick: every city's job sources counted down, the due ones paid in
  const income = time(() => $SM.collectIncome(), 100);
  const inc = counted(() => { for (let i = 0; i < 10; i++) $SM.collectIncome(); });
  row('incomeTick', 'income tick, 1 s ($SM.collectIncome), 95th percentile of 100', income.p95,
    `median ${income.median.toFixed(2)} ms, max ${income.max.toFixed(1)} ms; ${Object.keys($SM.get('income')).length} sources; ${inc.saves} full saves in 10 ticks`);

  // the 10 s fire tick: every hearth burns, the network is worked out again, the job paces follow
  const fire = time(() => Network.tick(), 10);
  const ft = counted(() => Network.tick());
  row('fireTick', 'fire tick, 10 s (Network.tick), median of 10', fire.median,
    `max ${fire.max.toFixed(1)} ms; ${ft.saves} full saves and ${ft.events} state events a tick`);

  // the 10 s city-state tick, right after the fire's: every city-state's glow, influence, rivals
  const cst = time(() => CityStates.update(), 10);
  const cs = counted(() => CityStates.update());
  row('cityStatesTick', 'city-state tick, 10 s (CityStates.update), median of 10', cst.median,
    `max ${cst.max.toFixed(1)} ms; ${CityStates.list().length} city-states; ${cs.saves} full saves and ${cs.events} state events a tick`);

  // the 10 s army tick: 16 armies in the field, 8 marching across the map and 8 camped at walls (none ends)
  const field = run(`(function () {
    var list = CityStates.list(), gen = World.hex.gen, cap = gen.capital, lit = Armies.lit(), armies = [], far = null;
    list.slice().sort(function (a, b) { return WorldGen.distance(b.at, cap) - WorldGen.distance(a.at, cap); }).slice(0, 16).forEach(function (c, i) {
      var camp = Armies.campFor(gen, c, cap, lit), path = camp && Armies.route(gen, cap, camp, lit);
      if (!path) return;
      far = far || camp;
      var a = { id: 'b' + i, from: 'capital', to: c.id, squads: { 'iron sword': 30 }, ammo: {}, gear: {}, food: 1e9, water: 1e9,
        at: cap.slice(), path: path, moves: 0, due: { food: 0, lost: 0 }, state: 'march', home: false, siege: null, loot: {}, warned: false };
      if (i % 2) {
        a.state = 'siege'; a.at = camp; a.path = [];
        a.siege = Armies.newSiege(c.band, 30);
        a.siege.walls = a.siege.wallsMax = 1e9; a.siege.stores = 1e9; a.siege.stance = 'wait'; a.siege.asked = 0; a.siege.sallies = 99;
      }
      armies.push(a);
    });
    $SM.set('game.armies.list', armies, true);
    Armies.CHOICE_EVERY = 1e9; Armies.DESERT = 0; Armies.STRAGGLE = 0; Armies.WAITING = 0;
    return { n: armies.length, far: far };
  })()`);
  const at = time(() => ctx.Armies.update(), 10);
  const ac = counted(() => ctx.Armies.update());
  row('armiesTick', 'army tick, 10 s (Armies.update), median of 10', at.median,
    `max ${at.max.toFixed(1)} ms; ${field.n} armies in the field; ${ac.saves} full saves and ${ac.events} state events a tick`);
  const route = time(() => ctx.Armies.route(World.hex.gen, World.hex.gen.capital, field.far, ctx.Armies.lit()), 10);
  row('armyRoute', 'a march order across the map (Armies.route)', route.median, `to the farthest city-state's walls, ${ctx.Armies.route(World.hex.gen, World.hex.gen.capital, field.far, ctx.Armies.lit()).length} hexes`);
  run(`$SM.set('game.armies.list', [], true)`);

  // the network from scratch: the refresh a click on the land makes, and Fire.compute inside it
  const refresh = time(() => Network.refresh(), 10);
  row('network', 'network recompute, full (Network.refresh)', refresh.median, `max ${refresh.max.toFixed(1)} ms`);
  const net = run(`(function () {
    var gen = World.hex.gen, H = Fire.HEARTHS[Network.hearthTier()];
    return {
      cols: gen.cols, rows: gen.rows, danger: World.baseDangerAt,
      hills: function (x, y) { return gen.terrain[x][y] === WorldGen.TERRAIN.hills; },
      hearths: Network.cities().map(function (c) {
        var h = c.city.hearth || {}, f = h.fuel && Fire.FUELS[h.fuel];
        return { at: c.city.hex, out: h.out || 0, share: H.share, cap: f ? f.cap : 0 };
      }),
      beacons: Object.keys($SM.get('game.network.beacons')).map(function (k) { return k.split(',').map(Number); }),
      beacon: Fire.BEACONS[Network.beaconTier()]
    };
  })()`);
  const compute = time(() => Fire.compute(net), 10);
  row('fireCompute', '  of which Fire.compute', compute.median,
    `${net.hearths.length} hearths, ${net.beacons.length} beacons, ${World.hex.fire.links.length} links`);

  // one beacon put out (the middle one raised), and the network worked out again
  const litOf = () => World.hex.fire.lit.reduce((x, y) => x + y, 0);
  const before = litOf();
  const keys = Object.keys($SM.get('game.network.beacons'));
  const cutAt = keys[Math.floor(keys.length / 2)].split(',').map(Number);
  const cut = time(() => {
    Network.putOut(cutAt[0], cutAt[1]);
    $SM.set('game.network.beacons["' + cutAt.join(',') + '"]', true, true);
  }, 5);
  Network.putOut(cutAt[0], cutAt[1]);
  const after = litOf();
  $SM.set('game.network.beacons["' + cutAt.join(',') + '"]', true, true);
  Network.refresh();
  row('networkCut', 'network recompute after one beacon cut (Network.putOut)', cut.median,
    `lit ${before} -> ${after} hexes; the network is rebuilt from scratch, so a cut costs a full recompute`);

  // danger lookups over every hex, for 300 ms, called the way the game's scripts call it
  const lookups = (call) => run(`(function () {
    var cols = World.hex.gen.cols, n = cols * World.hex.gen.rows, done = 0, sink = 0, end = performance.now() + 300;
    while (performance.now() < end) {
      for (var k = 0; k < n; k++) { var x = k % cols, y = (k - x) / cols; sink += ${call}; }
      done += n;
    }
    return done / 0.3;
  })()`);
  const dz = lookups('World.dangerAt(x, y)');
  const raw = lookups("Danger.at(World.hex.danger, cols, x, y, 'normal')");
  row('danger', 'danger lookups (World.dangerAt)', dz, `Danger.at on the field alone: ${(raw / 1e6).toFixed(0)} M/s`);

  // a save, and a load
  const json = JSON.stringify(ctx.State);
  const save = time(() => JSON.stringify(ctx.State), 10);
  const load = time(() => JSON.parse(json), 10);
  const big = Object.entries(ctx.State).map(([k, v]) => [k, JSON.stringify(v).length]).sort((p, q) => q[1] - p[1]).slice(0, 3);
  row('save', 'save (JSON.stringify of the state)', save.median, big.map(([k, n]) => `${k} ${(n / 1024).toFixed(0)} KB`).join(', '));
  row('saveSize', 'save size', json.length / 1024, `${(json.length * 4 / 3 / 1024).toFixed(0)} KB as an export (base64)`);
  row('load', 'load (JSON.parse of the save)', load.median, '');
  return out;
}

export function verdict(rows) {
  return rows.map((r) => {
    const b = BUDGETS[r.id];
    if (!b) return { ...r, budget: '', pass: true };
    const pass = b.max !== undefined ? r.value <= b.max : r.value >= b.min;
    const budget = b.max !== undefined ? `<= ${b.max} ${b.unit}` : `>= ${fmt(b.min, b.unit)}`;
    return { ...r, unit: b.unit, budget, pass };
  });
}

function fmt(v, unit) {
  if (unit === '/s') return v >= 1e6 ? `${(v / 1e6).toFixed(2)} M/s` : `${(v / 1e3).toFixed(0)} k/s`;
  return `${v.toFixed(v < 10 ? 2 : 1)} ${unit || ''}`.trim();
}

export function table(rows) {
  const lines = ['| measurement | value | budget | | notes |', '|---|---|---|---|---|'];
  for (const r of verdict(rows)) {
    lines.push(`| ${r.label} | ${fmt(r.value, r.unit)} | ${r.budget} | ${r.budget ? (r.pass ? 'pass' : '**FAIL**') : ''} | ${r.note || ''} |`);
  }
  return lines.join('\n');
}

export function stateLine(s) {
  return `${s.hexes} hexes (${s.land} open land), ${s.cities} cities, ${s.districts} districts, ${s.citizens} citizens, ` +
    `${s.incomeSources} income sources, ${s.beacons} beacons (${s.beaconsLit} lit), ` +
    `${s.lit} hexes lit (${(100 * s.litShare).toFixed(0)}% of the open land), whole map seen`;
}

// The top functions of a .cpuprofile by self time, and the game's own by total time (with callees)
export function hotspots(file, top = 12) {
  const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map();
  prof.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
  const where = (url) => (url.includes('/script/') ? url.slice(url.lastIndexOf('/script/') + 1) : url.startsWith('file://') ? path.relative(ROOT, fileURLToPath(url)) : url);
  const name = (f) => `${f.functionName || '(anonymous)'} ${f.url ? where(f.url) : ''}:${f.lineNumber + 1}`;
  const self = new Map(), total = new Map(), dt = prof.timeDeltas, all = dt.reduce((x, y) => x + y, 0);
  prof.samples.forEach((id, i) => {
    const t = dt[i] || 0, seen = new Set(), own = name(byId.get(id).callFrame);
    self.set(own, (self.get(own) || 0) + t);
    for (let n = id; n !== undefined; n = parent.get(n)) {
      const f = byId.get(n).callFrame;
      if (!f.url.includes('script/')) continue;
      const k = name(f);
      if (!seen.has(k)) total.set(k, (total.get(k) || 0) + t);
      seen.add(k);
    }
  });
  const list = (m) => [...m.entries()].sort((p, q) => q[1] - p[1]).slice(0, top).map(([k, us]) => ({ fn: k, ms: us / 1000, share: us / all }));
  return { self: list(self), total: list(total) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? Number(argv[i + 1]) : dflt;
  };
  const opts = { cities: arg('cities', 64), beacons: arg('beacons', 500), seed: arg('seed', 7) };
  const profile = argv.includes('--profile') ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-prof-')), 'bench.cpuprofile') : null;
  const report = () => {
    const h = hotspots(profile);
    console.log(`\nprofile: ${profile}`);
    for (const [kind, rows] of [['self', h.self], ['total (game scripts, with callees)', h.total]]) {
      console.log(`\n| function | ${kind} ms | share |\n|---|---|---|`);
      for (const x of rows) console.log(`| ${x.fn} | ${x.ms.toFixed(0)} | ${(100 * x.share).toFixed(1)}% |`);
    }
  };
  if (profile && !argv.includes('--browser')) {
    // the Node run again, under the V8 profiler
    const dir = path.dirname(profile), pass = argv.filter((a) => a !== '--profile');
    const r = spawnSync(process.execPath, ['--cpu-prof', '--cpu-prof-dir', dir, '--cpu-prof-name', path.basename(profile), fileURLToPath(import.meta.url), ...pass], { stdio: 'inherit' });
    report();
    process.exit(r.status);
  }
  let res;
  if (argv.includes('--browser')) {
    const { benchBrowser } = await import('./bench/browser.js');
    res = await benchBrowser({ ...opts, profile });
  } else {
    res = benchNode(opts);
  }
  const rows = verdict(res.rows);
  if (argv.includes('--json')) console.log(JSON.stringify({ ...res, rows }, null, 2));
  else {
    console.log(`${argv.includes('--browser') ? 'Chromium (Playwright)' : 'Node vm, DOM stubbed'}, seed ${opts.seed}: ${stateLine(res.state)}`);
    console.log(`(state built in ${(res.setup / 1000).toFixed(1)} s)\n`);
    console.log(table(res.rows));
  }
  if (profile) report();
  const fails = rows.filter((r) => !r.pass);
  if (fails.length) {
    console.error(`\nover budget: ${fails.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }
}
