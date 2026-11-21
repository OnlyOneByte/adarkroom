// SPDX-License-Identifier: MIT
/*
 * The powers in the balance simulator (Phase 6, design/drafts/POWERS.md): run from tools/sim.js.
 *
 * On every seed, with the game's own rules (script/armies.js, script/powers.js), an army camped at the
 * garrison of the deep mines (the march there is the armies' own, tools/sim-armies.js):
 *
 *   storm     POWERS §3's rough army (30 steel swords, 10 riflemen, 2 rams) presses the walls with every
 *             adit open, then storms the shafts, every squad fired the moment it is ready
 *   starve    the same army waits them out once the three adits are down: they yield
 *   fed       the same army waits them out with an adit open: they never do
 *   small     10 iron swords and a ram: the storm is lost, 50-80% of them with it
 * And the way there: where the generator put the garrison (WorldGen._garrison), and the ground a charcoal line
 * can cross from home (passable hexes up to its danger cap, F5: what the flame era has before coal): whether
 * the garrison's gate is on it (a beacon next to it can be lit: the shafts need one), and the rough army's
 * march there by the game's route with that ground lit (the line a player raises along it, cities and all).
 */
import { loadGame, seeded } from './sim.js';

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const REF = { squads: { 'steel sword': 30, rifle: 10 }, ammo: { bullets: 10 * 5 }, gear: { ram: 2 } };
const SMALL = { squads: { 'iron sword': 10 }, ammo: {}, gear: { ram: 1 } };

// the siege on the tick, as Armies.besiege runs it for a power; then the storm, fought by the numbers
function siege(ctx, P, kit, stance, adits, roll) {
  const { Armies: A, Powers: W } = ctx;
  const army = { squads: { ...kit.squads }, ammo: { ...kit.ammo }, gear: { ...kit.gear }, hurt: 0 };
  const start = A.soldiers(army), s = W.newSiege(P.id, start);
  s.stance = stance;
  const out = { start, ticks: 0, outcome: null, lost: 0 };
  while (A.soldiers(army) > 0 && out.ticks < 360) {
    out.ticks++;
    s.supplied = s.keep = adits > 0;
    const r = A.siegeTick(s, army, roll());
    if (r.breach) {
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
  out.minutes = out.ticks * ctx.Fire.TICK / 60;
  return out;
}

// the ground a line of this fuel can cross from home: passable hexes up to its danger cap (Fire.compute
// lights nothing past it), Uint8Array
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

// the march by the game's route (lit land first), spending water and food as Armies.supply does
function march(ctx, gen, danger, lit, site, kit) {
  const { Armies: A, Fire: F } = ctx;
  const isLit = (x, y) => !!lit[x + y * gen.cols];
  const dangerAt = (x, y) => (isLit(x, y) ? Math.max(0, danger(x, y) - F.LIT_DANGER) : danger(x, y));
  const camp = A.campFor(gen, { at: site.anchor }, gen.capital, (x, y) => (isLit(x, y) ? 1 : 0) - (gen.siteAt[x + y * gen.cols] >= 0 ? 3 : 0));
  const path = camp && A.route(gen, gen.capital, camp, isLit);
  if (!path) return null;
  const army = { squads: { ...kit.squads }, ammo: {}, gear: {}, hurt: 0 }, start = A.soldiers(army);
  const steps = path.reduce((s, p) => s + A.moveCost(gen, p[0], p[1]), 0);
  let food = A.foodFor(start, steps), water = start * A.WATER_EACH, dueFood = 0, dueLost = 0;
  path.forEach((p) => {
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
  return { hexes: path.length, unlit: path.filter((p) => !isLit(p[0], p[1])).length, start, left: A.soldiers(army), minutes: steps * F.TICK / 60 };
}

// a hex next to the site (off it) on that ground: a beacon there can be lit (Network.gateLit)
function gateOn(ctx, gen, lit, site) {
  const G = ctx.WorldGen;
  return site.hexes.some((h) => [0, 1, 2, 3, 4, 5].some((d) => {
    const [x, y] = G.neighbour(h[0], h[1], d);
    return x >= 0 && y >= 0 && x < gen.cols && y < gen.rows && gen.siteAt[x + y * gen.cols] < 0 && !!lit[x + y * gen.cols];
  }));
}

export function simulatePowers({ seeds, firstSeed = 1 }) {
  const rand = seeded();
  const { ctx } = loadGame(rand);
  const { World: W, WorldGen: G, Danger: D, Powers: PW } = ctx;
  const P = PW.byId('garrison'), roll = () => rand.next(), out = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed * 7919);
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    const field = D.field(gen);
    // Network.garrison: the complex the generator moved for it
    const site = gen.sites[gen.garrison];
    const danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
    const lit = reach(ctx, gen, danger, 'charcoal');
    out.push({
      seed, distance: G.distance(site.anchor, gen.capital), danger: danger(site.anchor[0], site.anchor[1]),
      hills: gen.terrain[site.anchor[0]][site.anchor[1]] === G.TERRAIN.hills,
      gate: gateOn(ctx, gen, lit, site), march: march(ctx, gen, danger, lit, site, REF),
      adits: PW.aditsOf(gen, site, P.adits).length,
      storm: siege(ctx, P, REF, 'press', P.adits, roll),
      starve: siege(ctx, P, REF, 'wait', 0, roll),
      fed: siege(ctx, P, REF, 'wait', P.adits, roll),
      small: siege(ctx, P, SMALL, 'press', P.adits, roll),
    });
  }
  return { out, seeds, P };
}

export function powersTable({ out, seeds }) {
  const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));
  const lines = ['| the garrison | seeds | outcome | siege min (median) | storm s (median) | lost of who went (median / max) |', '|---|---|---|---|---|---|'];
  for (const k of ['storm', 'starve', 'fed', 'small']) {
    const r = out.map((o) => o[k]);
    const outs = {};
    r.forEach((x) => { outs[x.outcome] = (outs[x.outcome] || 0) + 1; });
    const loss = r.map((x) => x.lost / x.start);
    lines.push(`| ${k} | ${r.length}/${seeds} | ${Object.entries(outs).map(([o, n]) => `${o} ${n}`).join(', ')} | ${fmt(median(r.map((x) => x.minutes)))} | ` +
      `${fmt(median(r.filter((x) => x.stormSeconds !== undefined).map((x) => x.stormSeconds)), 0)} | ${fmt(100 * median(loss), 0)}% / ${fmt(100 * Math.max(...loss), 0)}% |`);
  }
  lines.push('');
  lines.push('storm/starve/fed: 30 steel swords, 10 riflemen (5 bullets each), 2 rams; small: 10 iron swords, a ram.');
  const m = out.map((o) => o.march).filter(Boolean), d = out.map((o) => o.distance), dz = out.map((o) => o.danger);
  lines.push(`the garrison (WorldGen._garrison): ${median(d)} hexes out (median, ${Math.min(...d)}-${Math.max(...d)}), ` +
    `danger ${fmt(Math.min(...dz))}-${fmt(Math.max(...dz))} (POWERS §3: 2-4), on hills ${out.filter((o) => o.hills).length}/${seeds}; ` +
    `its gate on ground a charcoal line crosses ${out.filter((o) => o.gate).length}/${seeds}; the rough army marches there on ${m.length}/${seeds}: ` +
    `${median(m.map((x) => x.hexes))} hexes, ${median(m.map((x) => x.unlit))} unlit, ${fmt(median(m.map((x) => x.minutes)))} min, ` +
    `${fmt(100 * median(m.map((x) => 1 - x.left / x.start)), 0)}% lost on the way (median)`);
  return lines.join('\n');
}

// The guards CI holds the powers to (against provisional numbers in script/powers.js)
export function checkPowers({ out }) {
  const fails = [];
  for (const o of out) {
    if (o.adits !== 3) fails.push(`seed ${o.seed}: the garrison has ${o.adits} adits, want 3`);
    // where it stands: the band 1-2 edge, reachable, its gate lightable before coal (the shafts need it)
    if (!(o.danger >= 2 && o.danger <= 4)) fails.push(`seed ${o.seed}: the garrison stands at danger ${o.danger.toFixed(1)}, want 2-4`);
    if (!o.gate) fails.push(`seed ${o.seed}: no hex next to the garrison's gate is on ground a charcoal line crosses`);
    if (!o.march) fails.push(`seed ${o.seed}: no way to the garrison on foot`);
    else if (o.march.left / o.march.start < 0.8) fails.push(`seed ${o.seed}: the rough army reached the garrison with ${o.march.left} of ${o.march.start}, want 80% or more`);
    // POWERS §3's rough army breaks it, most of it alive
    if (o.storm.outcome !== 'broken') fails.push(`seed ${o.seed}: the rough army did not break the garrison (${o.storm.outcome})`);
    else if (o.storm.lost / o.storm.start > 0.35) fails.push(`seed ${o.seed}: breaking the garrison cost ${o.storm.lost} of ${o.storm.start}, want 35% or less`);
    // the puzzle: fed through an adit they never starve; with the adits down they do, in their 60 ticks
    if (o.fed.outcome === 'yielded') fails.push(`seed ${o.seed}: the garrison yielded with an adit open`);
    if (o.starve.outcome !== 'yielded') fails.push(`seed ${o.seed}: with the adits down, waiting the garrison out ended ${o.starve.outcome}, want yielded`);
    // too small an army: the storm is lost, at 50-80% (POWERS §1)
    if (o.small.outcome !== 'routed') fails.push(`seed ${o.seed}: 10 iron swords ended ${o.small.outcome} against the garrison, want routed`);
    else if (!(o.small.routLoss >= 0.5 - 1e-9 && o.small.routLoss <= 0.8 + 1e-9)) fails.push(`seed ${o.seed}: a lost storm cost ${(100 * o.small.routLoss).toFixed(0)}%, want 50-80%`);
  }
  // the storm is a fight, not a slog: under two minutes at the median
  const s = median(out.filter((o) => o.storm.stormSeconds !== undefined).map((o) => o.storm.stormSeconds));
  if (!(s <= 120)) fails.push(`the garrison's storm took ${s} s (median), want 120 or less`);
  return fails;
}
