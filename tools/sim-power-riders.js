// SPDX-License-Identifier: MIT
/*
 * Power 2, the cinder riders, in the balance simulator (design/drafts/POWERS.md #2): run from tools/sim.js.
 *
 * On every seed, with the game's own rules (script/armies.js, script/powers.js, script/powers/riders.js):
 *
 *   where     where the generator put their camp (WorldGen._riders): its danger, ground and distance, its three
 *             wells, and whether an army can walk there and a coke line (F9, the blaze era before pitch) can
 *             reach the camp's neighbours and every well
 *   march     POWERS §3's rough army (40 bayonets, 10 tanglers) marches by the game's route: with the coke
 *             ground lit (the wells' lines); and with only the charcoal ground lit (an unlit desert march),
 *             with its waterskins alone and with the casks its unlit steps need
 *   storm     the rough army camped at the tents, the wells ours: the camp stands, the storm opens with the
 *             tanglers' throw, every squad fired the moment it is ready
 *   loose     the same 50 soldiers with no tanglers: they ride off when the storm opens
 *   small     15 iron swords and 5 tanglers: the storm is lost, 50-80% of them with it
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const REF = { squads: { bayonet: 40, bolas: 10 }, ammo: { bolas: 10 * 5 }, gear: {} };
const LOOSE = { squads: { bayonet: 50 }, ammo: {}, gear: {} };
const SMALL = { squads: { 'iron sword': 15, bolas: 5 }, ammo: { bolas: 5 * 5 }, gear: {} };

// tools/sim.js's game, with the riders' file run into it (sim.js hands its loadGame and seeded over: this
// module is imported from its main, so it doesn't import sim.js back)
function load(loadGame, rand) {
  const { ctx } = loadGame(rand);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'script/powers/riders.js'), 'utf8'), ctx, { filename: 'script/powers/riders.js' });
  return ctx;
}

// the ground a line of this fuel can cross from home: passable hexes up to its danger cap, Uint8Array
function reach(ctx, gen, danger, fuel) {
  const { Fire: F, WorldGen: G } = ctx;
  const cap = F.FUELS[fuel].cap, out = new Uint8Array(gen.cols * gen.rows), q = [gen.capital];
  out[gen.capital[0] + gen.capital[1] * gen.cols] = 1;
  for (let i = 0; i < q.length; i++) {
    for (let d = 0; d < 6; d++) {
      const [x, y] = G.neighbour(q[i][0], q[i][1], d), k = x + y * gen.cols;
      if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || out[k] || danger(x, y) > cap || !G.isPassable(gen.map[x][y])) continue;
      out[k] = 1;
      q.push([x, y]);
    }
  }
  return out;
}

// the march by the game's route (lit land first), spending water and food as Armies.supply does; casks add
// their water as Armies.send does with them ('enough': as many as the unlit steps drink past the skins)
function march(ctx, gen, danger, lit, site, kit, casks) {
  const { Armies: A, Fire: F, Riders: R } = ctx;
  const isLit = (x, y) => !!lit[x + y * gen.cols];
  const dangerAt = (x, y) => (isLit(x, y) ? Math.max(0, danger(x, y) - F.LIT_DANGER) : danger(x, y));
  const camp = A.campFor(gen, { at: site.anchor }, gen.capital, (x, y) => (isLit(x, y) ? 1 : 0) - (gen.siteAt[x + y * gen.cols] >= 0 ? 3 : 0));
  const route = camp && A.route(gen, gen.capital, camp, isLit);
  if (!route) return null;
  const army = { squads: { ...kit.squads }, ammo: {}, gear: {}, hurt: 0 }, start = A.soldiers(army);
  const steps = route.reduce((s, p) => s + A.moveCost(gen, p[0], p[1]), 0);
  if (casks === 'enough') {
    const drink = route.reduce((s, p) => s + A.stepNeeds(start, isLit(p[0], p[1]), dangerAt(p[0], p[1]), A.moveCost(gen, p[0], p[1])).water, 0);
    casks = Math.max(0, Math.ceil((drink - start * A.WATER_EACH) / R.CASK_WATER));
  }
  let food = A.foodFor(start, steps), water = start * A.WATER_EACH + casks * R.CASK_WATER, dueFood = 0, dueLost = 0, dry = 0;
  route.forEach((p) => {
    const n = A.soldiers(army), cost = A.moveCost(gen, p[0], p[1]), need = A.stepNeeds(n, isLit(p[0], p[1]), dangerAt(p[0], p[1]), cost);
    dueFood += need.food;
    const f = Math.floor(dueFood);
    dueFood -= f;
    if (water < need.water || food < f) {
      A.kill(army, Math.max(1, A.DESERT * n));
      dry++;
    } else if (need.stragglers) {
      dueLost += need.stragglers;
      const l = Math.floor(dueLost);
      dueLost -= l;
      A.kill(army, l);
    }
    water = Math.max(0, water - need.water);
    food = Math.max(0, food - f);
  });
  return { hexes: route.length, unlit: route.filter((p) => !isLit(p[0], p[1])).length, start, left: A.soldiers(army), dry, casks, minutes: steps * F.TICK / 60 };
}

// the siege at the tents with the wells ours, as Armies.besiege runs it for the riders; then the storm
function siege(ctx, P, kit, roll) {
  const { Armies: A, Powers: W, Riders: R } = ctx;
  const army = { squads: { ...kit.squads }, ammo: { ...kit.ammo }, gear: { ...kit.gear }, hurt: 0 };
  const start = A.soldiers(army), s = W.newSiege(P.id, start);
  const out = { start, ticks: 0, outcome: null };
  while (A.soldiers(army) > 0 && out.ticks < 360) {
    out.ticks++;
    const r = A.siegeTick(s, army, roll());
    if (!r.breach) continue;
    s.stormed = A.soldiers(army);
    if (!R.caught(army)) { out.outcome = 'rode off'; break; }
    const st = W.autoStorm(P, s, army);
    out.stormSeconds = st.seconds;
    if (st.won) out.outcome = 'broken';
    else {
      out.outcome = 'routed';
      const keep = Math.min(A.soldiers(army), A.routed(st.start, s.garrison, s.garrisonMax));
      out.routLoss = 1 - keep / st.start;
      A.kill(army, A.soldiers(army) - keep);
    }
    break;
  }
  if (!out.outcome) out.outcome = 'stalled';
  out.lost = start - A.soldiers(army);
  return out;
}

export function simulateRiders({ seeds, firstSeed = 1, loadGame, seeded }) {
  const rand = seeded();
  const ctx = load(loadGame, rand);
  const { World: W, WorldGen: G, Danger: D, Powers: PW, Riders: R } = ctx;
  const P = PW.byId('riders'), roll = () => rand.next(), out = [];
  // the game without the riders' file: the world and city-states as they were before it
  const { ctx: plain } = loadGame(seeded());
  const places = (c, gen) => {
    const f = c.Danger.field(gen);
    return c.CityStates.place(gen, (x, y) => c.Danger.at(f, gen.cols, x, y, 'normal'), () => false);
  };
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed * 7919);
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    const site = R.siteOf(gen);
    if (!site) { out.push({ seed, site: false }); continue; }
    const field = D.field(gen), danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
    // the city-states stand where they did, none on the camp or a well
    const cs = places(ctx, gen), was = places(plain, plain.WorldGen.generate(seed, plain.World.generateMap(plain.WorldGen.rng(seed))));
    const ours = {};
    site.hexes.concat(site.wells).forEach((h) => { ours[h[0] + ',' + h[1]] = true; });
    const coke = reach(ctx, gen, danger, 'coke'), dark = reach(ctx, gen, danger, 'charcoal');
    const near = (lit, h) => [0, 1, 2, 3, 4, 5].some((d) => { const [x, y] = G.neighbour(h[0], h[1], d); return !!lit[x + y * gen.cols]; });
    const sand = (p) => gen.terrain[p[0]][p[1]] === G.TERRAIN.desert || gen.terrain[p[0]][p[1]] === G.TERRAIN.barrens;
    out.push({
      seed, site: true, distance: G.distance(site.anchor, gen.capital), danger: danger(site.anchor[0], site.anchor[1]),
      desert: gen.terrain[site.anchor[0]][site.anchor[1]] === G.TERRAIN.desert,
      wells: site.wells.length, wellsSand: site.wells.every(sand), wellsLit: site.wells.every((w) => !!coke[w[0] + w[1] * gen.cols]),
      wellDanger: Math.max(...site.wells.map((w) => danger(w[0], w[1]))),
      onFoot: site.wells.concat([site.anchor]).every((p) => !!A_route(ctx, gen, p)), campLit: near(coke, site.anchor),
      csSame: JSON.stringify(cs) === JSON.stringify(was), csClear: cs.every((c) => c.land.every((h) => !ours[h[0] + ',' + h[1]])),
      lit: march(ctx, gen, danger, coke, site, REF, 0),
      dry: march(ctx, gen, danger, dark, site, REF, 0),
      casked: march(ctx, gen, danger, dark, site, REF, 'enough'),
      storm: siege(ctx, P, REF, roll), loose: siege(ctx, P, LOOSE, roll), small: siege(ctx, P, SMALL, roll),
    });
  }
  return { out, seeds };
}

// a walk from home on foot (the route with no light preferred)
function A_route(ctx, gen, to) {
  return ctx.Armies.route(gen, gen.capital, to, () => true);
}

export function ridersTable({ out, seeds }) {
  const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));
  const o = out.filter((x) => x.site);
  const lines = ['| the riders | seeds | outcome | storm s (median) | lost of who went (median / max) |', '|---|---|---|---|---|'];
  for (const k of ['storm', 'loose', 'small']) {
    const r = o.map((x) => x[k]), outs = {};
    r.forEach((x) => { outs[x.outcome] = (outs[x.outcome] || 0) + 1; });
    const loss = r.map((x) => x.lost / x.start);
    lines.push(`| ${k} | ${r.length}/${seeds} | ${Object.entries(outs).map(([w, n]) => `${w} ${n}`).join(', ')} | ` +
      `${fmt(median(r.filter((x) => x.stormSeconds !== undefined).map((x) => x.stormSeconds)), 0)} | ${fmt(100 * median(loss), 0)}% / ${fmt(100 * Math.max(...loss), 0)}% |`);
  }
  lines.push('');
  lines.push('storm: 40 bayonets, 10 tanglers (5 bolas each); loose: 50 bayonets; small: 15 iron swords, 5 tanglers.');
  const d = o.map((x) => x.distance), dz = o.map((x) => x.danger);
  lines.push(`their camp (WorldGen._riders): ${median(d)} hexes out (median, ${Math.min(...d)}-${Math.max(...d)}), danger ${fmt(Math.min(...dz))}-${fmt(Math.max(...dz))} ` +
    `(POWERS §3: band 2, 3-5), on desert ${o.filter((x) => x.desert).length}/${seeds}; 3 wells on sand ${o.filter((x) => x.wells === 3 && x.wellsSand).length}/${seeds}, ` +
    `danger up to ${fmt(Math.max(...o.map((x) => x.wellDanger)))}, on ground a coke line crosses ${o.filter((x) => x.wellsLit).length}/${seeds}; ` +
    `camp and wells walkable from home ${o.filter((x) => x.onFoot).length}/${seeds}; ` +
    `the city-states where they were ${o.filter((x) => x.csSame).length}/${seeds}, none on the camp or a well ${o.filter((x) => x.csClear).length}/${seeds}`);
  const m = (k, f) => median(o.map((x) => x[k]).filter(Boolean).map(f));
  for (const [k, what] of [['lit', 'the coke ground lit'], ['dry', 'only the charcoal ground lit, waterskins alone'], ['casked', 'only the charcoal ground lit, casks for the unlit steps']]) {
    lines.push(`the rough army's march, ${what}: ${m(k, (x) => x.hexes)} hexes, ${m(k, (x) => x.unlit)} unlit, ${fmt(m(k, (x) => x.minutes))} min, ` +
      `${fmt(100 * m(k, (x) => 1 - x.left / x.start), 0)}% lost, ${m(k, (x) => x.dry)} steps dry, ${m(k, (x) => x.casks)} casks (median)`);
  }
  return lines.join('\n');
}

// The guards CI holds the riders to (against provisional numbers in script/powers/riders.js)
export function checkRiders({ out }) {
  const fails = [];
  for (const o of out) {
    if (!o.site) { fails.push(`seed ${o.seed}: no camp for the riders`); continue; }
    // where they stand: a band 2 desert camp an army can walk to, its three wells a coke line can reach
    if (!(o.danger >= 3 && o.danger <= 5)) fails.push(`seed ${o.seed}: the riders camp at danger ${o.danger.toFixed(1)}, want 3-5`);
    if (!o.desert) fails.push(`seed ${o.seed}: the riders' camp is not on desert`);
    if (o.wells !== 3 || !o.wellsSand) fails.push(`seed ${o.seed}: the riders have ${o.wells} wells${o.wellsSand ? '' : ', not all on sand'}, want 3 on sand`);
    if (!o.onFoot) fails.push(`seed ${o.seed}: the riders' camp or a well can't be walked to from home`);
    if (!o.wellsLit) fails.push(`seed ${o.seed}: a well is off the ground a coke line crosses`);
    if (!o.campLit) fails.push(`seed ${o.seed}: no hex next to the riders' camp is on the ground a coke line crosses`);
    // nothing else moves: the city-states stand where they did, off the camp and its wells
    if (!o.csSame) fails.push(`seed ${o.seed}: the city-states moved with the riders' camp`);
    if (!o.csClear) fails.push(`seed ${o.seed}: a city-state stands on the riders' camp or a well`);
    // the army gets there: along the lines, most of it; an unlit march needs the casks
    if (!o.lit) fails.push(`seed ${o.seed}: no way to the riders on foot`);
    else if (o.lit.left / o.lit.start < 0.8) fails.push(`seed ${o.seed}: the rough army reached the riders along the lines with ${o.lit.left} of ${o.lit.start}, want 80% or more`);
    if (o.casked && o.dry && o.casked.left < o.dry.left) fails.push(`seed ${o.seed}: casks lost the unlit march more soldiers (${o.casked.left} vs ${o.dry.left} left)`);
    // POWERS §3's rough army breaks them, most of it alive; with no tanglers they ride off; too small loses
    if (o.storm.outcome !== 'broken') fails.push(`seed ${o.seed}: the rough army did not break the riders (${o.storm.outcome})`);
    else if (o.storm.lost / o.storm.start > 0.35) fails.push(`seed ${o.seed}: breaking the riders cost ${o.storm.lost} of ${o.storm.start}, want 35% or less`);
    if (o.loose.outcome !== 'rode off') fails.push(`seed ${o.seed}: 50 bayonets with no tanglers ended ${o.loose.outcome}, want rode off`);
    if (o.small.outcome !== 'routed') fails.push(`seed ${o.seed}: 15 iron swords and 5 tanglers ended ${o.small.outcome} against the riders, want routed`);
    else if (!(o.small.routLoss >= 0.5 - 1e-9 && o.small.routLoss <= 0.8 + 1e-9)) fails.push(`seed ${o.seed}: a lost storm cost ${(100 * o.small.routLoss).toFixed(0)}%, want 50-80%`);
  }
  // an unlit desert march: the waterskins alone run dry somewhere on most seeds, the casks carry it
  const o = out.filter((x) => x.site && x.dry && x.casked);
  if (o.filter((x) => x.dry.dry > 0).length * 2 < o.length) fails.push(`an unlit desert march ran dry on ${o.filter((x) => x.dry.dry > 0).length} of ${o.length} seeds without casks, want most`);
  if (o.some((x) => x.casked.dry > 0)) fails.push(`an unlit desert march with casks for its unlit steps still ran dry on ${o.filter((x) => x.casked.dry > 0).length} seeds`);
  const s = median(out.filter((x) => x.site && x.storm.stormSeconds !== undefined).map((x) => x.storm.stormSeconds));
  if (!(s <= 120)) fails.push(`the riders' storm took ${s} s (median), want 120 or less`);
  return fails;
}

// tools/sim.js's hook: the table, and under --ci the guards (exits 1 if one fails)
export function run({ seeds, ci, loadGame, seeded }) {
  const r = simulateRiders({ seeds, loadGame, seeded });
  console.log(`\nThe cinder riders, ${seeds} seeds: their camp, the march there, the storm at the tents\n`);
  console.log(ridersTable(r));
  const fails = ci ? checkRiders(r) : [];
  if (fails.length) {
    console.error('\nFAIL\n' + fails.join('\n'));
    process.exit(1);
  }
}
