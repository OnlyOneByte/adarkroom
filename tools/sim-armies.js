// SPDX-License-Identifier: MIT
/*
 * Armies and sieges in the balance simulator (Phase 5, design/drafts/POWERS.md §1): run from tools/sim.js.
 *
 * On every seed, with the game's own rules (script/armies.js): a beacon line at the ember top (F4 B4 H4,
 * tallow) is raised toward a city-state, then an army from the capital marches there by the game's route
 * (lit land first), spending water and food a hex at a time and losing stragglers off the light, and
 * besieges it on the 10 s tick until the walls come down (the storm) or their stores run out (they yield).
 *
 *   taken     the nearest herders (band 0-1) by 20 iron swords and a ram, pressing the walls
 *   waited    the same army, waiting them out
 *   holdfast  the nearest walled holdfast (bands 1-3) by the same 20: the storm can be lost there
 *   small     the nearest herders by 5 bone spears: the storm is lost, 50-80% of them with it
 *   unlit     the nearest herders with no beacon line at all: the supply off the light
 */
import { loadGame, seeded } from './sim.js';

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// the lit land (Fire.compute's result) of the capital's hearth plus a beacon line toward the target,
// each beacon within a hop of the last, as far as the fuel keeps it lit
function lit(ctx, gen, danger, target, line) {
  const { Fire: F, WorldGen: G } = ctx;
  const H = F.HEARTHS.H4;
  const net = { cols: gen.cols, rows: gen.rows, danger, hills: (x, y) => gen.terrain[x][y] === G.TERRAIN.hills,
    hearths: [{ at: gen.capital, out: H.out, share: true, cap: F.FUELS.tallow.cap }], beacons: [], beacon: F.BEACONS.B4 };
  let r = F.compute(net);
  if (!line) return r;
  const open = (p) => p[0] >= 0 && p[1] >= 0 && p[0] < gen.cols && p[1] < gen.rows && gen.reachable[p[0] + p[1] * gen.cols] &&
    G.isPassable(gen.map[p[0]][p[1]]) && gen.map[p[0]][p[1]] !== G.TERRAIN.ocean && !(p[0] === target.at[0] && p[1] === target.at[1]);
  let at = gen.capital;
  for (let i = 0; i < 40 && G.distance(at, target.at) > 1; i++) {
    const next = F.around(at[0], at[1], F.HOP).filter((p) => open(p) && !net.beacons.some((b) => b[0] === p[0] && b[1] === p[1]))
      .sort((a, b) => G.distance(a, target.at) - G.distance(b, target.at))[0];
    if (!next || G.distance(next, target.at) >= G.distance(at, target.at)) break;
    net.beacons.push(next);
    const r2 = F.compute(net);
    if (r2.nodes[r2.nodes.length - 1].s < F.LIT_MIN) { net.beacons.pop(); break; }
    r = r2;
    at = next;
  }
  return r;
}

// one march and siege, as Armies.march / Armies.besiege run them; returns what happened
function campaign(ctx, gen, danger, fire, c, squads, gear, stance, roll) {
  const { Armies: A, Fire: F } = ctx;
  const isLit = (x, y) => !!fire.lit[x + y * gen.cols];
  const dangerAt = (x, y) => (isLit(x, y) ? Math.max(0, danger(x, y) - F.LIT_DANGER) : danger(x, y));
  const camp = A.campFor(gen, c, gen.capital, isLit);
  const path = camp && A.route(gen, gen.capital, camp, isLit);
  if (!path) return null;
  const army = { squads: { ...squads }, ammo: {}, gear: { ...gear }, hurt: 0 };
  const start = A.soldiers(army);
  const steps = path.reduce((s, p) => s + A.moveCost(gen, p[0], p[1]), 0);
  let food = A.foodFor(start, steps), water = start * A.WATER_EACH, dueFood = 0, dueLost = 0;
  const out = { start, steps, hexes: path.length, unlit: path.filter((p) => !isLit(p[0], p[1])).length, stragglers: 0, deserted: 0,
    marchTicks: 0, siegeTicks: 0, outcome: null, lost: 0, waterLeft: 0, foodLeft: 0 };
  const supply = (at, cost) => {
    const n = A.soldiers(army), need = A.stepNeeds(n, isLit(at[0], at[1]), dangerAt(at[0], at[1]), cost);
    dueFood += need.food;
    const f = Math.floor(dueFood);
    dueFood -= f;
    if (water < need.water || food < f) {
      out.deserted += A.kill(army, Math.max(1, A.DESERT * n));
    } else if (need.stragglers) {
      dueLost += need.stragglers;
      const l = Math.floor(dueLost);
      dueLost -= l;
      out.stragglers += A.kill(army, l);
    }
    water = Math.max(0, water - need.water);
    food = Math.max(0, food - f);
  };
  // the march: a move point a tick
  let moves = 0;
  const left = path.slice();
  while (left.length && A.soldiers(army) > 0) {
    out.marchTicks++;
    moves += 1;
    while (left.length && moves >= A.moveCost(gen, left[0][0], left[0][1])) {
      const next = left.shift();
      moves -= A.moveCost(gen, next[0], next[1]);
      supply(next, A.moveCost(gen, next[0], next[1]));
    }
  }
  // the siege
  const s = A.newSiege(c.band, A.soldiers(army));
  s.stance = stance;
  while (A.soldiers(army) > 0 && out.siegeTicks < 500) {
    out.siegeTicks++;
    supply(camp, 1);
    const r = A.siegeTick(s, army, roll());
    if (r.breach) {
      const st = A.storm(s, army);
      if (st.won) out.outcome = 'taken';
      else {
        out.outcome = 'routed';
        const keep = Math.min(A.soldiers(army), A.routed(st.start, s.garrison, s.garrisonMax));
        A.kill(army, A.soldiers(army) - keep);
        out.routLoss = 1 - keep / st.start;
      }
      out.rounds = st.rounds.length;
      break;
    }
    if (r.yield) { out.outcome = 'yielded'; break; }
    if (r.broken) {
      out.outcome = 'routed';
      const keep = Math.min(A.soldiers(army), A.routed(s.invested, s.garrison, s.garrisonMax));
      out.routLoss = 1 - keep / s.invested;
      A.kill(army, A.soldiers(army) - keep);
      break;
    }
  }
  if (!out.outcome) out.outcome = A.soldiers(army) ? 'stalled' : 'destroyed';
  out.lost = start - A.soldiers(army);
  out.minutes = (out.marchTicks + out.siegeTicks) * F.TICK / 60;
  out.waterLeft = water;
  out.foodLeft = food;
  return out;
}

export function simulateArmies({ seeds, firstSeed = 1 }) {
  const rand = seeded();
  const { ctx } = loadGame(rand);
  const { World: W, WorldGen: G, Danger: D, CityStates: CS, Armies: A } = ctx;
  const out = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed * 7907);
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    const field = D.field(gen);
    const danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
    const list = CS.place(gen, danger);
    const nearest = (t) => list.filter((c) => c.t === t).sort((a, b) => G.distance(a.at, gen.capital) - G.distance(b.at, gen.capital))[0];
    const herders = nearest('herders'), holdfast = nearest('walled_holdfast');
    const roll = () => rand.next();
    const ref = { 'iron sword': 20 }, ram = { ram: 1 };
    const lineH = lit(ctx, gen, danger, herders, true);
    out.push({
      seed,
      distance: G.distance(herders.at, gen.capital), band: herders.band,
      taken: campaign(ctx, gen, danger, lineH, herders, ref, ram, 'press', roll),
      waited: campaign(ctx, gen, danger, lineH, herders, ref, ram, 'wait', roll),
      small: campaign(ctx, gen, danger, lineH, herders, { 'bone spear': 5 }, {}, 'press', roll),
      holdfast: holdfast && campaign(ctx, gen, danger, lit(ctx, gen, danger, holdfast, true), holdfast, ref, ram, 'press', roll),
      holdfastBand: holdfast && holdfast.band,
      unlit: campaign(ctx, gen, danger, lit(ctx, gen, danger, herders, false), herders, ref, ram, 'press', roll),
    });
  }
  // the aftermath at its start and end (POWERS §1): a taken city at 50%, recovered after 10 minutes
  const M = A.AFTERMATH.force, ticks = M.minutes * 60 / ctx.Fire.TICK;
  const after = { start: A.output({ loss: M.loss, ticks, left: ticks }), half: A.output({ loss: M.loss, ticks, left: ticks / 2 }), end: A.output(null) };
  return { out, seeds, after, A };
}

export function armiesTable({ out, seeds, after }) {
  const lines = [];
  const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));
  lines.push('| campaign | seeds | outcome | hexes (median) | unlit (median) | march min (median) | siege min (median) | lost of who went (median / max) | stragglers + deserters (median) |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const k of ['taken', 'waited', 'holdfast', 'small', 'unlit']) {
    const r = out.map((o) => o[k]).filter(Boolean);
    const outs = {};
    r.forEach((x) => { outs[x.outcome] = (outs[x.outcome] || 0) + 1; });
    const loss = r.map((x) => x.lost / x.start);
    lines.push(`| ${k} | ${r.length}/${seeds} | ${Object.entries(outs).map(([o, n]) => `${o} ${n}`).join(', ')} | ${median(r.map((x) => x.hexes)) ?? '-'} | ${median(r.map((x) => x.unlit)) ?? '-'} | ` +
      `${fmt(median(r.map((x) => x.marchTicks / 6)))} | ${fmt(median(r.map((x) => x.siegeTicks / 6)))} | ${fmt(100 * median(loss), 0)}% / ${fmt(100 * Math.max(...loss), 0)}% | ${median(r.map((x) => x.stragglers + x.deserted)) ?? '-'} |`);
  }
  lines.push('');
  lines.push(`taken: the army is 20 iron swords and a ram; small: 5 bone spears. the herders' band (median) ${median(out.map((o) => o.band))}, ${median(out.map((o) => o.distance))} hexes out; ` +
    `the holdfast's band (median) ${median(out.filter((o) => o.holdfast).map((o) => o.holdfastBand))}. production of a city taken by force: ${fmt(100 * after.start, 0)}% at once, ${fmt(100 * after.half, 0)}% after 5 min, ${fmt(100 * after.end, 0)}% after 10`);
  return lines.join('\n');
}

// The guards CI holds the armies to (all against provisional numbers in script/armies.js)
export function checkArmies({ out, seeds, after }) {
  const fails = [];
  for (const o of out) {
    const t = o.taken;
    if (!t) { fails.push(`seed ${o.seed}: no way to the nearest herders on foot`); continue; }
    // force is the fast route: the reference army takes the nearest herders in a few minutes, most of it alive
    if (t.outcome !== 'taken') fails.push(`seed ${o.seed}: 20 iron swords and a ram did not take the nearest herders (${t.outcome})`);
    else if (t.minutes > 10) fails.push(`seed ${o.seed}: taking the nearest herders took ${t.minutes.toFixed(1)} minutes, want under 10`);
    if (t.lost / t.start > 0.3) fails.push(`seed ${o.seed}: taking the nearest herders cost ${t.lost} of ${t.start}, want under 30%`);
    // waiting them out: they yield; slower than pressing, with fewer lost
    const w = o.waited;
    if (w.outcome !== 'yielded') fails.push(`seed ${o.seed}: waiting the herders out ended ${w.outcome}, want yielded`);
    else if (!(w.siegeTicks > t.siegeTicks)) fails.push(`seed ${o.seed}: waiting them out (${w.siegeTicks} ticks) is not slower than pressing (${t.siegeTicks})`);
    // too small an army breaks, and a broken storm costs 50-80% (POWERS §1)
    const s = o.small;
    if (s.outcome !== 'routed') fails.push(`seed ${o.seed}: 5 bone spears ended ${s.outcome} against the herders, want routed`);
    else if (!(s.routLoss >= 0.5 - 1e-9 && s.routLoss <= 0.8 + 1e-9)) fails.push(`seed ${o.seed}: a lost storm cost ${(100 * s.routLoss).toFixed(0)}%, want 50-80%`);
  }
  // the influence route takes ~17 min at the feel check: force should be the fast one (DESIGN "Taking city-states")
  const m = median(out.filter((o) => o.taken).map((o) => o.taken.minutes));
  if (!(m <= 8)) fails.push(`the nearest herders taken in ${m.toFixed(1)} minutes (median), want 8 or less (influence takes ~17)`);
  if (after.start !== 0.5 || after.end !== 1) fails.push(`a city taken by force produces ${after.start} at once and ${after.end} at the end, want 0.5 and 1`);
  return fails;
}
