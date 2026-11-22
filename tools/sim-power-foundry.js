// SPDX-License-Identifier: MIT
/*
 * Power #4, the foundry, in the balance simulator (design/drafts/POWERS.md §2-§3): run from tools/sim.js.
 *
 * On every seed, with the game's own rules (script/armies.js, script/powers.js, script/powers/foundry.js):
 *
 *   where     the complex the generator moved for it (WorldGen._foundry): its danger, its ground, and no
 *             other site moved nor any city-state (the same world made without it); none on its ground
 *   reach     a coke line's ground from home (passable open hexes up to coke's cap, F9): a hex next to its
 *             gate is on it, and POWERS §3's rough army marches there by the game's route with it lit
 *   storm     the rough army (50 bayonets, 20 bombers with 5 grenades each) presses the walls, then storms
 *   rams      40 steel swords, 10 riflemen, 4 rams and 4 blasting charges press: brick shrugs them off
 *   starve    the rough army waits them out: they dig their own iron, the army runs out of meat first
 *   few       20 bayonets and 20 bombers: the walls come down, the storm is lost (50-80% of them)
 *   masters   the storm's army again, the forge-masters won first: MASTERS_BRICK less brick to bring down
 * And the steel: grenades for 20 bombers at the armoury, steelworkers' time with and without coke.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the powers placed before it (the shared loader has the fleet's), then the foundry
const BEFORE = ['script/powers/riders.js'];
const FILES = ['script/outside.js', ...BEFORE, 'script/powers/foundry.js'];

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));

const CARRY = 5;
const KITS = {
  storm: { squads: { bayonet: 50, grenade: 20 }, ammo: { grenade: 20 * CARRY }, gear: {}, stance: 'press' },
  rams: { squads: { 'steel sword': 40, rifle: 10 }, ammo: { bullets: 10 * CARRY }, gear: { ram: 4, 'blasting charge': 4 }, stance: 'press' },
  starve: { squads: { bayonet: 50, grenade: 20 }, ammo: { grenade: 20 * CARRY }, gear: {}, stance: 'wait' },
  few: { squads: { bayonet: 20, grenade: 20 }, ammo: { grenade: 20 * CARRY }, gear: {}, stance: 'press' },
  masters: { squads: { bayonet: 50, grenade: 20 }, ammo: { grenade: 20 * CARRY }, gear: {}, stance: 'press', masters: true },
};

// the game with the foundry in it (the shared loader stops at script/powers.js; the village's jobs for the steel)
function loadFoundry(loadGame, rand) {
  const g = loadGame(rand);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), g.ctx, { filename: f });
  return g;
}

// the siege on the tick, as Armies.besiege runs it for a power (Powers.prepare: always supplied, charges
// kept), its own food spent as Armies.supply does on lit land; then the storm, fought by the numbers
function siege(ctx, P, kit, roll, steps) {
  const { Armies: A, Powers: W, Foundry: FD } = ctx;
  const army = { squads: { ...kit.squads }, ammo: { ...kit.ammo }, gear: { ...kit.gear }, hurt: 0 };
  // (the forge-masters won before the siege: the game asks its city-states, the sim says so)
  const won = FD.mastersWon;
  FD.mastersWon = () => !!kit.masters;
  const start = A.soldiers(army), s = W.newSiege(P.id, start);
  FD.mastersWon = won;
  let food = A.foodFor(start, steps) - Math.ceil(start * steps / 2), due = 0;
  s.stance = kit.stance;
  const out = { start, ticks: 0, outcome: null, lost: 0, worn: 0, walls: s.walls };
  while (A.soldiers(army) > 0 && out.ticks < 360) {
    out.ticks++;
    due += A.soldiers(army) / 2;
    const f = Math.floor(due);
    due -= f;
    if (food < f) A.kill(army, Math.max(1, A.DESERT * A.soldiers(army)));
    food = Math.max(0, food - f);
    if (!A.soldiers(army)) break;
    s.supplied = s.keep = true;
    const stores = s.stores, r = A.siegeTick(s, army, roll());
    out.worn += r.worn;
    if (s.stores < stores) out.fed = false;
    if (r.breach) {
      out.breachMinutes = out.ticks * ctx.Fire.TICK / 60;
      s.stormed = A.soldiers(army);
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
    if (r.yield) { out.outcome = 'yielded'; break; }
    if (r.broken) { out.outcome = 'routed'; break; }
  }
  if (!out.outcome) out.outcome = A.soldiers(army) ? 'stalled' : 'destroyed';
  out.lost = start - A.soldiers(army);
  out.minutes = out.ticks * ctx.Fire.TICK / 60;
  out.charges = army.gear['blasting charge'] || 0;
  out.stores = s.stores;
  return out;
}

// a coke line's ground from home: open dry hexes (no water, no peaks: a line's ground) up to its cap
function reach(ctx, gen, danger) {
  const { Fire: F, WorldGen: G } = ctx;
  const cap = F.FUELS.coke.cap, out = new Uint8Array(gen.cols * gen.rows), q = [gen.capital];
  out[gen.capital[0] + gen.capital[1] * gen.cols] = 1;
  for (let i = 0; i < q.length; i++) {
    for (let d = 0; d < 6; d++) {
      const [x, y] = G.neighbour(q[i][0], q[i][1], d), k = x + y * gen.cols;
      if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || out[k] || danger(x, y) > cap) continue;
      const t = gen.map[x][y];
      if (!G.isPassable(t) || G.isWater(t) || t === G.TERRAIN.mountains || gen.siteAt[k] >= 0) continue;
      out[k] = 1;
      q.push([x, y]);
    }
  }
  return out;
}

// the march by the game's route (lit land first), spending water and food as Armies.supply does
function march(ctx, gen, danger, lit, site, kit) {
  const { Armies: A, Fire: F } = ctx;
  const isLit = (x, y) => !!lit[x + y * gen.cols];
  const dangerAt = (x, y) => (isLit(x, y) ? Math.max(0, danger(x, y) - F.LIT_DANGER) : danger(x, y));
  const camp = A.campFor(gen, { at: site.anchor }, gen.capital, (x, y) => (isLit(x, y) ? 1 : 0) - (gen.siteAt[x + y * gen.cols] >= 0 ? 3 : 0));
  const route = camp && A.route(gen, gen.capital, camp, isLit);
  if (!route) return null;
  const army = { squads: { ...kit.squads }, ammo: {}, gear: {}, hurt: 0 }, start = A.soldiers(army);
  const steps = route.reduce((s, p) => s + A.moveCost(gen, p[0], p[1]), 0);
  let food = A.foodFor(start, steps), water = start * A.WATER_EACH, dueFood = 0, dueLost = 0;
  route.forEach((p) => {
    const n = A.soldiers(army), cost = A.moveCost(gen, p[0], p[1]), need = A.stepNeeds(n, isLit(p[0], p[1]), dangerAt(p[0], p[1]), cost);
    dueFood += need.food;
    const f = Math.floor(dueFood);
    dueFood -= f;
    if (water < need.water || food < f) A.kill(army, Math.max(1, A.DESERT * n));
    else if (need.stragglers) {
      dueLost += need.stragglers;
      const l = Math.floor(dueLost);
      dueLost -= l;
      A.kill(army, l);
    }
    water = Math.max(0, water - need.water);
    food = Math.max(0, food - f);
  });
  return { hexes: route.length, steps, unlit: route.filter((p) => !isLit(p[0], p[1])).length, start, left: A.soldiers(army), minutes: steps * F.TICK / 60, campLit: isLit(camp[0], camp[1]) };
}

// the same sites but the foundry's, the garrison's included
function othersSame(a, b, skip) {
  if (a.sites.length !== b.sites.length || a.garrison !== b.garrison || a.riders !== b.riders) return false;
  return a.sites.every((s, i) => i === skip || JSON.stringify(s) === JSON.stringify(b.sites[i]));
}

// (loadGame and seeded are tools/sim.js's, passed in: sim.js imports this file from its own top-level code)
export function simulateFoundry({ seeds, firstSeed = 1, loadGame, seeded }) {
  const rand = seeded();
  const { ctx } = loadFoundry(loadGame, rand);
  const base = loadGame(seeded()).ctx;
  for (const f of BEFORE) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), base, { filename: f });
  const { World: W, WorldGen: G, Danger: D, Powers: PW, Foundry: FD, Outside } = ctx;
  const P = PW.byId('foundry'), roll = () => rand.next(), out = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed * 7919);
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    const plain = base.WorldGen.generate(seed, base.World.generateMap(base.WorldGen.rng(seed)));
    const field = D.field(gen), site = gen.foundry >= 0 ? gen.sites[gen.foundry] : null;
    const o = { seed, placed: !!site, others: othersSame(gen, plain, gen.foundry), own: !site || (!site.garrison && site.power === 'foundry' && gen.foundry !== gen.riders) };
    // the city-states as the world without it places them, none on its ground
    const pf = D.field(plain), cs = ctx.CityStates.place(gen, (x, y) => D.at(field, gen.cols, x, y, 'normal'));
    o.states = JSON.stringify(cs) === JSON.stringify(base.CityStates.place(plain, (x, y) => base.Danger.at(pf, plain.cols, x, y, 'normal')));
    o.clear = !site || !cs.some((c) => c.land.concat([c.at]).some((h) => site.hexes.some((p) => G.distance(p, h) <= 1)));
    if (site) {
      const danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
      const lit = reach(ctx, gen, danger);
      const gS = gen.sites[gen.garrison];
      o.distance = G.distance(site.anchor, gen.capital);
      o.danger = danger(site.anchor[0], site.anchor[1]);
      o.band = D.band(o.danger);
      o.hills = site.hexes.every((h) => gen.terrain[h[0]][h[1]] === G.TERRAIN.hills);
      o.beyond = !gS || o.distance > G.distance(gS.anchor, gen.capital);
      o.march = march(ctx, gen, danger, lit, site, KITS.storm);
      const steps = o.march ? o.march.steps : 40;
      for (const k in KITS) o[k] = siege(ctx, P, KITS[k], roll, steps);
    }
    out.push(o);
  }
  // the steel for 20 bombers' grenades (5 each) at the armoury, and a steelworker's share of it
  const grenade = Outside._INCOME.grenadier.stores, steelworker = Outside._INCOME.steelworker.stores;
  const steel = -grenade.steel * 20 * CARRY / grenade.grenade;
  return { out, seeds, P, FD, steel: { need: steel, plain: steel / steelworker.steel, coke: steel / FD.COKE_STEEL }, needs: Outside._INCOME.grenadier.needs };
}

export function foundryTable({ out, seeds, steel, needs }) {
  const placed = out.filter((o) => o.placed);
  const lines = ['| the foundry | seeds | outcome | breach min (median) | storm s (median) | lost of who went (median / max) |', '|---|---|---|---|---|---|'];
  for (const k of Object.keys(KITS)) {
    const r = placed.map((o) => o[k]), outs = {};
    r.forEach((x) => { outs[x.outcome] = (outs[x.outcome] || 0) + 1; });
    const loss = r.map((x) => x.lost / x.start);
    lines.push(`| ${k} | ${r.length}/${seeds} | ${Object.entries(outs).map(([o, n]) => `${o} ${n}`).join(', ')} | ` +
      `${fmt(median(r.filter((x) => x.breachMinutes !== undefined).map((x) => x.breachMinutes)))} | ` +
      `${fmt(median(r.filter((x) => x.stormSeconds !== undefined).map((x) => x.stormSeconds)), 0)} | ${fmt(100 * median(loss), 0)}% / ${fmt(100 * Math.max(...loss), 0)}% |`);
  }
  lines.push('');
  lines.push('storm/starve: 50 bayonets, 20 bombers (5 grenades each); rams: 40 steel swords, 10 riflemen, 4 rams, 4 charges; few: 20 bayonets, 20 bombers; masters: the storm army, the forge-masters won first.');
  const d = placed.map((o) => o.distance), dz = placed.map((o) => o.danger), m = placed.map((o) => o.march).filter(Boolean);
  lines.push(`the foundry (WorldGen._foundry): placed ${placed.length}/${seeds}, ${median(d)} hexes out (median, ${Math.min(...d)}-${Math.max(...d)}), ` +
    `danger ${fmt(Math.min(...dz))}-${fmt(Math.max(...dz))} (POWERS §3: 5-6), on hills ${placed.filter((o) => o.hills).length}/${seeds}, ` +
    `past the garrison ${placed.filter((o) => o.beyond).length}/${seeds}, other sites unmoved ${out.filter((o) => o.others).length}/${seeds}, ` +
    `city-states placed as without it ${out.filter((o) => o.states).length}/${seeds}, none on or by its site ${out.filter((o) => o.clear).length}/${seeds}; ` +
    `its camp on ground a coke line crosses ${m.filter((x) => x.campLit).length}/${seeds}; the rough army marches there on ${m.length}/${seeds}: ` +
    `${median(m.map((x) => x.hexes))} hexes, ${median(m.map((x) => x.unlit))} unlit, ${fmt(median(m.map((x) => x.minutes)))} min, ` +
    `${fmt(100 * median(m.map((x) => 1 - x.left / x.start)), 0)}% lost on the way (median)`);
  lines.push(`grenades: the grenadier needs ${needs}; 20 bombers' 100 grenades take ${steel.need} steel: ${steel.plain} steelworker turns before coke, ${steel.coke} with it`);
  return lines.join('\n');
}

// The guards CI holds the foundry to (against provisional numbers in script/powers/foundry.js)
export function checkFoundry({ out, needs, FD }) {
  const fails = [];
  if (needs !== 'F9') fails.push(`the armoury's grenadier needs ${needs}, want F9 (coke)`);
  for (const o of out) {
    if (!o.placed) { fails.push(`seed ${o.seed}: no complex moved for the foundry`); continue; }
    if (!o.others) fails.push(`seed ${o.seed}: a site other than the foundry's moved`);
    if (!o.own) fails.push(`seed ${o.seed}: the foundry took a complex another power holds`);
    if (!o.states) fails.push(`seed ${o.seed}: the city-states are placed otherwise than in the world without the foundry`);
    if (!o.clear) fails.push(`seed ${o.seed}: a city-state's land is on or next to the foundry's site`);
    // where it stands: band 2-3 hills an army can reach, a coke line to its camp
    if (!(o.danger >= 5 && o.danger <= 6)) fails.push(`seed ${o.seed}: the foundry stands at danger ${o.danger.toFixed(2)}, want 5-6`);
    if (!o.hills) fails.push(`seed ${o.seed}: the foundry's site is not all hills`);
    if (!o.beyond) fails.push(`seed ${o.seed}: the foundry stands ${o.distance} hexes out, no further than the garrison`);
    if (!o.march) fails.push(`seed ${o.seed}: no way to the foundry on foot`);
    else {
      if (!o.march.campLit) fails.push(`seed ${o.seed}: the army's camp at the foundry is not on ground a coke line crosses`);
      if (o.march.left / o.march.start < 0.8) fails.push(`seed ${o.seed}: the rough army reached the foundry with ${o.march.left} of ${o.march.start}, want 80% or more`);
    }
    // POWERS §3's rough army breaks it: the grenades breach the brick, the storm is won
    if (o.storm.outcome !== 'broken') fails.push(`seed ${o.seed}: the rough army did not break the foundry (${o.storm.outcome})`);
    else if (o.storm.lost / o.storm.start > 0.4) fails.push(`seed ${o.seed}: breaking the foundry cost ${o.storm.lost} of ${o.storm.start}, want 40% or less`);
    // brick shrugs off rams (and charges, kept back), and the cannon break the line pressing them
    if (o.rams.worn > 0) fails.push(`seed ${o.seed}: rams, charges and swords wore ${o.rams.worn} of the foundry's brick, want 0`);
    if (o.rams.charges !== 4) fails.push(`seed ${o.seed}: the army spent charges on the foundry's brick`);
    if (o.rams.outcome !== 'routed') fails.push(`seed ${o.seed}: an army with no grenades ended ${o.rams.outcome} at the foundry, want routed`);
    // starving fails: their stores never run down, the army's meat does
    if (o.starve.outcome === 'yielded' || o.starve.fed === false) fails.push(`seed ${o.seed}: the foundry's stores ran down (${o.starve.outcome})`);
    if (o.starve.outcome === 'broken') fails.push(`seed ${o.seed}: waiting the foundry out broke it`);
    // too few: the walls come down, the storm is lost at 50-80% (POWERS §1)
    if (o.few.outcome !== 'routed' || o.few.stormSeconds === undefined) fails.push(`seed ${o.seed}: 20 bayonets and 20 bombers ended ${o.few.outcome} at the foundry, want a lost storm`);
    else if (!(o.few.routLoss >= 0.5 - 1e-9 && o.few.routLoss <= 0.8 + 1e-9)) fails.push(`seed ${o.seed}: a lost storm at the foundry cost ${(100 * o.few.routLoss).toFixed(0)}%, want 50-80%`);
  }
  // the forge-masters won first: MASTERS_BRICK less of it, so the same army breaches sooner, for no more
  for (const o of out.filter((x) => x.placed)) {
    if (o.masters.walls !== o.storm.walls - FD.MASTERS_BRICK) fails.push(`seed ${o.seed}: with the forge-masters won the foundry has ${o.masters.walls} brick, want ${o.storm.walls - FD.MASTERS_BRICK}`);
    if (o.masters.outcome !== 'broken') fails.push(`seed ${o.seed}: the rough army, the forge-masters won, did not break the foundry (${o.masters.outcome})`);
    else if (!(o.masters.breachMinutes < o.storm.breachMinutes) || o.masters.lost > o.storm.lost) fails.push(`seed ${o.seed}: winning the forge-masters first made the breach no sooner, or dearer`);
  }
  const s = median(out.filter((o) => o.placed && o.storm.stormSeconds !== undefined).map((o) => o.storm.stormSeconds));
  if (!(s <= 120)) fails.push(`the foundry's storm took ${s} s (median), want 120 or less`);
  return fails;
}

// tools/sim.js's hook: the table, and under --ci the checks (a failure fails the run)
export function runFoundry({ seeds, ci, loadGame, seeded }) {
  const run = simulateFoundry({ seeds, loadGame, seeded });
  console.log(`\nPower #4, ${seeds} seeds: the foundry's site, the march there, and an army camped at its walls\n`);
  console.log(foundryTable(run));
  if (!ci) return;
  const fails = checkFoundry(run);
  if (fails.length) {
    console.error('\nFAIL (the foundry)\n' + fails.join('\n'));
    process.exitCode = 1;
  }
}
