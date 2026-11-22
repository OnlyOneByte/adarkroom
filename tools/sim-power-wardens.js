// SPDX-License-Identifier: MIT
/*
 * The pass wardens in the balance simulator (power #3, design/drafts/POWERS.md; script/powers/wardens.js),
 * run from tools/sim.js. On every seed, with the game's own rules:
 *
 *   where     the pass the generator put them on (Wardens.place): its danger (POWERS §3: band 2, 4-5), the
 *             goat path reachable on foot, the climb to it from the camp
 *   reach     the ground a coal line crosses from home (F8, the blaze era's floor): a beacon next to the battery
 *             can be lit there (the counter-siege needs one), and the rough army marches to the camp with that
 *             ground lit, by the game's route
 *   below     POWERS §3's rough army (40 riflemen under 4 mantlets) sits under the guns: a squad a tick, it breaks
 *   dark      the same army climbs the goat path from the camp, every step unlit (water, food, stragglers)
 *   storm     ... and storms the guns from behind, every squad fired the moment it is ready
 *   hold      ... and holds the battery with the beacon on the pass lit: held, B10
 *   unlit     ... with the pass dark: the first wave takes it back
 */
import { loadGame, seeded } from './sim.js';

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const REF = { squads: { rifle: 40 }, ammo: { bullets: 40 * 5 }, gear: { mantlet: 4 } };

// the ground a line of this fuel can cross from home: passable hexes up to its danger cap
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

// steps along a path as Armies.supply charges them (lit(x, y) false: the dark march). Mutates army; returns what it cost
function walk(ctx, gen, path, army, lit, dangerAt) {
  const A = ctx.Armies;
  const out = { water: 0, food: 0, stragglers: 0, short: false };
  let dueFood = 0, dueLost = 0;
  for (const p of path) {
    const n = A.soldiers(army), cost = A.moveCost(gen, p[0], p[1]), need = A.stepNeeds(n, lit(p[0], p[1]), dangerAt(p[0], p[1]), cost);
    dueFood += need.food;
    const f = Math.floor(dueFood);
    dueFood -= f;
    if (army.water < need.water || army.food < f) {
      out.short = true;
      A.kill(army, Math.max(1, A.DESERT * n));
    } else if (need.stragglers) {
      dueLost += need.stragglers;
      const l = Math.floor(dueLost);
      dueLost -= l;
      out.stragglers += A.kill(army, l);
    }
    out.water += Math.min(army.water, need.water);
    out.food += Math.min(army.food, f);
    army.water = Math.max(0, army.water - need.water);
    army.food = Math.max(0, army.food - f);
  }
  return out;
}

const newArmy = (ctx, kit, steps) => {
  const A = ctx.Armies, army = { squads: { ...kit.squads }, ammo: { ...kit.ammo }, gear: { ...kit.gear }, hurt: 0 }, n = A.soldiers(army);
  return Object.assign(army, { water: n * A.WATER_EACH, food: A.foodFor(n, steps) });
};

// the siege as the game runs it for the wardens (Powers.newSiege + Wardens.prepare, then Armies.siegeTick)
function newSiege(ctx, army) {
  const { Powers: PW, Armies: A } = ctx, s = PW.newSiege('wardens', A.soldiers(army));
  s.stance = 'wait';
  s.sallies = A.SALLIES;
  return s;
}

function below(ctx, army, roll) {
  const { Armies: A, Wardens: W } = ctx, s = newSiege(ctx, army), start = A.soldiers(army);
  let ticks = 0, r = {};
  for (; ticks < 60 && A.soldiers(army) > 0; ticks++) {
    s.supplied = s.keep = true;
    W.guns(army);
    r = A.siegeTick(s, army, roll());
    if (r.breach || r.yield || r.broken) break;
  }
  return { outcome: r.breach ? 'breach' : r.yield ? 'yielded' : r.broken ? 'routed' : 'stalled', ticks: ticks + 1, start, left: A.soldiers(army) };
}

function hold(ctx, army, litAt) {
  const { Armies: A, Wardens: W, Powers: PW } = ctx, c = { ticks: 0, lit: 0, waves: 0, men: A.soldiers(army) };
  for (let t = 0; t < 200; t++) {
    const r = W.hold(c, army, litAt(t), PW.byId('wardens'));
    if (r.fail) return { outcome: r.fail, ticks: c.ticks, waves: c.waves, lost: c.men - A.soldiers(army) };
    if (r.held) return { outcome: 'held', ticks: c.ticks, waves: c.waves, lost: c.men - A.soldiers(army) };
  }
  return { outcome: 'stalled', ticks: c.ticks };
}

export function simulateWardens({ seeds, firstSeed = 1 }) {
  const rand = seeded();
  const { ctx } = loadGame(rand);
  const { World: W, WorldGen: G, Danger: D, Powers: PW, Wardens: WA, Armies: A, Fire: F } = ctx;
  const P = PW.byId('wardens'), roll = () => rand.next(), out = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed * 7919);
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    if (gen.wardens < 0) { out.push({ seed, none: true }); continue; }
    const site = gen.sites[gen.wardens], cols = gen.cols, field = D.field(gen);
    const danger = (x, y) => D.at(field, cols, x, y, 'normal');
    const coal = reach(ctx, gen, danger, 'coal');
    const isLit = (x, y) => !!coal[x + y * cols];
    const dangerAt = (x, y) => (isLit(x, y) ? Math.max(0, danger(x, y) - F.LIT_DANGER) : danger(x, y));
    const passAt = new Set(gen.passes.map((p) => p[0] + ',' + p[1]));
    const o = { seed, distance: G.distance(site.anchor, gen.capital), danger: danger(site.anchor[0], site.anchor[1]), hexes: site.hexes.length,
      byPass: [0, 1, 2, 3, 4, 5].some((d) => passAt.has(G.neighbour(site.anchor[0], site.anchor[1], d).join(','))) };
    // a beacon next to the battery, on ground a coal line crosses
    o.beacon = site.hexes.some((h) => [0, 1, 2, 3, 4, 5].some((d) => {
      const [x, y] = G.neighbour(h[0], h[1], d);
      return x >= 0 && y >= 0 && x < cols && y < gen.rows && gen.siteAt[x + y * cols] < 0 && isLit(x, y) && G.isPassable(gen.terrain[x][y]) && !G.isWater(gen.terrain[x][y]);
    }));
    o.goatOnFoot = !!gen.reachable[site.goat[0] + site.goat[1] * cols] && G.isPassable(gen.map[site.goat[0]][site.goat[1]]);
    // the march to the camp (Armies.send: next to the pass, lit land first, off the site)
    const camp = A.campFor(gen, { at: site.anchor }, gen.capital, (x, y) => (isLit(x, y) ? 1 : 0) - (gen.siteAt[x + y * cols] >= 0 ? 3 : 0));
    const path = camp && A.route(gen, gen.capital, camp, isLit);
    if (!path) { out.push(o); continue; }
    const steps = path.reduce((s, p) => s + A.moveCost(gen, p[0], p[1]), 0);
    const army = newArmy(ctx, REF, steps), start = A.soldiers(army);
    walk(ctx, gen, path, army, isLit, dangerAt);
    o.march = { hexes: path.length, unlit: path.filter((p) => !isLit(p[0], p[1])).length, start, left: A.soldiers(army) };
    // under the guns (a copy of the army as it arrived)
    o.below = below(ctx, JSON.parse(JSON.stringify(army)), roll);
    // the dark march: the climb from the camp, off the battery, every step unlit
    const climb = WA.climb(gen, camp, site.goat, (x, y) => gen.siteAt[x + y * cols] === gen.wardens);
    if (!climb) { out.push(o); continue; }
    const before = A.soldiers(army), water = army.water;
    const cost = walk(ctx, gen, climb, army, () => false, danger);
    o.dark = { hexes: climb.length, lit: climb.filter((p) => isLit(p[0], p[1])).length, before, left: A.soldiers(army), water: cost.water, waterBefore: water, stragglers: cost.stragglers, short: cost.short };
    // the storm behind the guns
    const s = newSiege(ctx, army);
    s.stormed = A.soldiers(army);
    const st = PW.autoStorm(P, s, army);
    o.storm = { won: st.won, seconds: st.seconds, start: st.start, left: st.left };
    // the counter-siege: the beacon on the pass lit throughout; dark from the start; going dark half way
    o.hold = hold(ctx, JSON.parse(JSON.stringify(army)), () => true);
    o.hold.men = A.soldiers(army);
    o.unlit = hold(ctx, JSON.parse(JSON.stringify(army)), () => false);
    o.lapse = hold(ctx, JSON.parse(JSON.stringify(army)), (t) => t < 30);
    // the same army with no mantlets: the cannon and the waves break it
    const bare = JSON.parse(JSON.stringify(army));
    bare.gear.mantlet = 0;
    o.bare = hold(ctx, bare, () => true);
    // the mountain city-state behind the pass (no envoys or armies until they fall)
    const cs = ctx.CityStates.place(gen, danger), behind = WA.behindOf(gen, site, cs);
    o.behind = behind ? { t: behind.t, d: G.distance(behind.at, site.anchor) } : null;
    out.push(o);
  }
  return { out, seeds };
}

export function wardensTable({ out, seeds }) {
  const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));
  const ok = out.filter((o) => o.storm), d = out.filter((o) => !o.none);
  const lines = ['| the pass wardens | seeds | outcome | median |', '|---|---|---|---|'];
  const count = (k) => { const c = {}; ok.forEach((o) => { c[o[k].outcome] = (c[o[k].outcome] || 0) + 1; }); return Object.entries(c).map(([x, n]) => `${x} ${n}`).join(', '); };
  lines.push(`| below the guns | ${ok.length}/${seeds} | ${count('below')} | broken in ${median(ok.map((o) => o.below.ticks))} ticks, ${fmt(100 * median(ok.map((o) => 1 - o.below.left / o.below.start)), 0)}% lost |`);
  lines.push(`| the dark march | ${ok.length}/${seeds} | ${ok.filter((o) => o.dark.left > 0).length} on the cliff | ${median(ok.map((o) => o.dark.hexes))} hexes, all unlit, ${median(ok.map((o) => o.dark.water))} water, ${median(ok.map((o) => o.dark.stragglers))} stragglers, ${fmt(100 * median(ok.map((o) => 1 - o.dark.left / o.dark.before)), 0)}% lost |`);
  lines.push(`| the storm | ${ok.length}/${seeds} | won ${ok.filter((o) => o.storm.won).length} | ${fmt(median(ok.map((o) => o.storm.seconds)), 0)} s, ${fmt(100 * median(ok.map((o) => 1 - o.storm.left / o.storm.start)), 0)}% lost |`);
  lines.push(`| the counter-siege, the pass lit | ${ok.length}/${seeds} | ${count('hold')} | ${median(ok.map((o) => o.hold.ticks))} ticks, ${median(ok.map((o) => o.hold.lost))} of ${median(ok.map((o) => o.hold.men))} lost (${fmt(100 * median(ok.map((o) => o.hold.lost / o.hold.men)), 0)}%); the whole break ${fmt(100 * median(ok.map((o) => (o.march.start - o.hold.men + o.hold.lost) / o.march.start)), 0)}% |`);
  lines.push(`| ... no mantlets | ${ok.length}/${seeds} | ${count('bare')} | at tick ${median(ok.map((o) => o.bare.ticks))} |`);
  lines.push(`| ... the pass dark | ${ok.length}/${seeds} | ${count('unlit')} | at tick ${median(ok.map((o) => o.unlit.ticks))} |`);
  lines.push(`| ... dark after 30 ticks | ${ok.length}/${seeds} | ${count('lapse')} | at tick ${median(ok.map((o) => o.lapse.ticks))} |`);
  lines.push('');
  lines.push('40 riflemen (5 bullets each) under 4 mantlets; the march there with the ground a coal line crosses lit.');
  const dist = d.map((o) => o.distance), dz = d.map((o) => o.danger), m = d.filter((o) => o.march).map((o) => o.march);
  lines.push(`the pass (Wardens.place): on ${d.length}/${seeds}, ${median(dist)} hexes out (median, ${Math.min(...dist)}-${Math.max(...dist)}), danger ${fmt(Math.min(...dz))}-${fmt(Math.max(...dz))} ` +
    `(band 2 on ${dz.filter((z) => z >= 4 && z < 6).length}/${d.length}), at the foot of a cut pass ${d.filter((o) => o.byPass).length}/${d.length}; a beacon beside it on coal ground ${d.filter((o) => o.beacon).length}/${d.length}; ` +
    `the goat path on foot ${d.filter((o) => o.goatOnFoot).length}/${d.length}; the march there ${median(m.map((x) => x.hexes))} hexes, ${median(m.map((x) => x.unlit))} unlit, ` +
    `${fmt(100 * median(m.map((x) => 1 - x.left / x.start)), 0)}% lost (median)`);
  const b = d.filter((o) => o.behind);
  lines.push(`the city-state behind the pass: on ${b.length}/${d.length} (${b.map((o) => o.behind.t + ' ' + o.behind.d).join(', ')} hexes past the battery)`);
  return lines.join('\n');
}

// The guards CI holds the wardens to (against provisional numbers in script/powers/wardens.js)
export function checkWardens({ out }) {
  const fails = [];
  const d = out.filter((o) => !o.none);
  for (const o of out) {
    if (o.none) { fails.push(`seed ${o.seed}: no pass for the wardens`); continue; }
    // where they stand: band 2 or just past, reachable, lightable before the counter-siege
    if (!(o.danger >= 4 && o.danger < 7)) fails.push(`seed ${o.seed}: the wardens stand at danger ${o.danger.toFixed(1)}, want 4-7`);
    if (!o.beacon) fails.push(`seed ${o.seed}: no hex beside the battery on ground a coal line crosses`);
    if (!o.goatOnFoot) fails.push(`seed ${o.seed}: the goat path can't be walked to`);
    if (!o.march) { fails.push(`seed ${o.seed}: no way to the wardens on foot`); continue; }
    if (o.march.left / o.march.start < 0.8) fails.push(`seed ${o.seed}: the rough army reached the wardens with ${o.march.left} of ${o.march.start}, want 80% or more`);
    // a siege from below loses a squad a tick, and never takes them
    if (o.below.outcome !== 'routed') fails.push(`seed ${o.seed}: sitting under the guns ended ${o.below.outcome}, want routed`);
    if (!o.dark) { fails.push(`seed ${o.seed}: no climb from the camp to the goat path`); continue; }
    // the dark march: every step paid unlit, and most of the army on the cliff
    if (!(o.dark.water > 0)) fails.push(`seed ${o.seed}: the dark march cost no water`);
    if (o.dark.left / o.dark.before < 0.7) fails.push(`seed ${o.seed}: ${o.dark.left} of ${o.dark.before} reached the cliff, want 70% or more`);
    if (!o.storm.won) fails.push(`seed ${o.seed}: the rough army lost the storm behind the guns`);
    if (o.hold.outcome !== 'held') fails.push(`seed ${o.seed}: the counter-siege with the pass lit ended ${o.hold.outcome}, want held`);
    // it bites: a well-supplied army holds with real losses; without mantlets it breaks
    else if (!(o.hold.lost / o.hold.men >= 0.15 && o.hold.lost / o.hold.men <= 0.45)) fails.push(`seed ${o.seed}: holding the pass cost ${o.hold.lost} of ${o.hold.men}, want 15-45%`);
    if (o.bare.outcome !== 'broken') fails.push(`seed ${o.seed}: the hold with no mantlets ended ${o.bare.outcome}, want broken`);
    if (o.unlit.outcome !== 'dark') fails.push(`seed ${o.seed}: the counter-siege with the pass dark ended ${o.unlit.outcome}, want lost`);
    if (o.lapse.outcome !== 'dark') fails.push(`seed ${o.seed}: the counter-siege with the beacon gone out ended ${o.lapse.outcome}, want lost`);
  }
  // POWERS §3 band 2 on most worlds
  const band2 = d.filter((o) => o.danger >= 4 && o.danger < 6).length;
  if (band2 < d.length - 1) fails.push(`the wardens are at band 2 on ${band2}/${d.length} seeds, want all but one`);
  return fails;
}

// tools/sim.js's hook: the table, and in CI the checks
export function wardensRun({ seeds, ci }) {
  const w = simulateWardens({ seeds });
  console.log(`\nThe pass wardens, ${seeds} seeds: the rough army at the pass\n`);
  console.log(wardensTable(w));
  if (!ci) return [];
  const fails = checkWardens(w);
  if (fails.length) {
    console.error('\nFAIL (the pass wardens)\n' + fails.join('\n'));
    process.exitCode = 1;
  }
  return fails;
}
