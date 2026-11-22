// SPDX-License-Identifier: MIT
/*
 * Power #5, the drowned fleet, in the balance simulator (design/drafts/POWERS.md #5): run from tools/sim.js.
 *
 * On every seed, with the game's own rules (script/armies.js, script/powers.js, script/powers/fleet.js):
 *
 *   where     where the generator put it (WorldGen._fleet): its danger (POWERS §3: 5-7), on an inland sea, every
 *             hex open sea (no one walks there), the land a man could walk before it moved still walkable
 *   way       the way there: home to the drowned harbour on foot, then rowed out to the camp off the hulks
 *             (Fleet.way), the rough army marching it with the whale-oil line lit (F11: the boats come after it)
 *   storm     POWERS §3's rough army (40 bayonets, 20 riflemen, 10 boats, 4 fire-ships) waits off the hulks,
 *             sends the fire-ships in, then storms (every squad fired the moment it is ready)
 *   fed       the same army, no fire-ships, a coast town still feeding them: the hulks never fall
 *   starve    no fire-ships, no coast town feeding them: they yield in their 120 ticks
 *   small     20 iron swords and the fire-ships: the storm is lost, 50-80% of them with it
 */
import { loadGame, seeded } from './sim.js';

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const REF = { squads: { bayonet: 40, rifle: 20 }, ammo: { bullets: 20 * 5 }, gear: { boat: 10, 'fire-ship': 4 } };
const DRY = { squads: { bayonet: 40, rifle: 20 }, ammo: { bullets: 20 * 5 }, gear: { boat: 10 } };
const SMALL = { squads: { 'iron sword': 20 }, ammo: {}, gear: { boat: 4, 'fire-ship': 4 } };

// the siege on the tick, as Armies.besiege runs it for the fleet (Powers.prepare: fed, the charges kept);
// the fire-ships go in on the first tick; then the boarding storm, fought by the numbers
function siege(ctx, P, kit, fed, roll) {
  const { Armies: A, Powers: W, Fleet: F } = ctx;
  const army = { squads: { ...kit.squads }, ammo: { ...kit.ammo }, gear: { ...kit.gear }, hurt: 0 };
  const start = A.soldiers(army), s = W.newSiege(P.id, start);
  s.stance = 'wait';
  const out = { start, ticks: 0, outcome: null, lost: 0 };
  while (A.soldiers(army) > 0 && out.ticks < 360) {
    out.ticks++;
    s.supplied = fed;
    s.keep = true;
    if (army.gear['fire-ship'] > 0) {
      s.walls = Math.max(0, s.walls - army.gear['fire-ship'] * F.BURN);
      delete army.gear['fire-ship'];
    }
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
    if (r.broken) { out.outcome = 'routed'; break; }
  }
  if (!out.outcome) out.outcome = A.soldiers(army) ? 'stalled' : 'destroyed';
  out.walls = s.walls;
  out.lost = start - A.soldiers(army);
  out.minutes = out.ticks * ctx.Fire.TICK / 60;
  return out;
}

// the ground a pitch line can light from home, as Network.lineReach('pitch') works it out: passable dry land up
// to pitch's cap (its wet cap on the ground it holds), at normal difficulty. Uint8Array
function pitchReach(ctx, gen, field) {
  const { Fire: F, WorldGen: G, Danger: D } = ctx, P = F.FUELS.pitch, bits = F.groundBits(gen), cols = gen.cols;
  const out = new Uint8Array(cols * gen.rows), q = [gen.capital];
  out[gen.capital[0] + gen.capital[1] * cols] = 1;
  for (let i = 0; i < q.length; i++) {
    for (let d = 0; d < 6; d++) {
      const [x, y] = G.neighbour(q[i][0], q[i][1], d), k = x + y * cols;
      if (x < 0 || y < 0 || x >= cols || y >= gen.rows || out[k]) continue;
      const t = gen.terrain[x][y];
      if (!G.isPassable(t) || G.isWater(t) || D.at(field, cols, x, y, 'normal') > (bits[k] & P.holds ? P.wet : P.cap)) continue;
      out[k] = 1;
      q.push([x, y]);
    }
  }
  return out;
}

// the drowned harbour as Network.harbourSite picks it (network.js isn't loaded here): the fallen city nearest
// home on an inland sea's shore whose centre a pitch line lights, else the nearest on any water a pitch line
// lights, else the nearest on an inland sea's shore, else the nearest on any water. lit: pitchReach.
// shortcut: a copy of the game's rule; follow it when harbourSite's rule changes
function harbourSite(G, gen, lit) {
  const touches = (s, ok) => s.hexes.some((h) => [0, 1, 2, 3, 4, 5].some((d) => {
    const [x, y] = G.neighbour(h[0], h[1], d);
    return x >= 0 && y >= 0 && x < gen.cols && y < gen.rows && ok(x, y);
  }));
  const sea = (s) => touches(s, (x, y) => { const f = gen.formationAt[x + y * gen.cols]; return f >= 0 && gen.formations[f].kind === 'sea'; });
  const coast = (s) => touches(s, (x, y) => G.isWater(gen.terrain[x][y]));
  const near = (a, b) => G.distance(a.anchor, gen.capital) - G.distance(b.anchor, gen.capital) || gen.sites.indexOf(a) - gen.sites.indexOf(b);
  const falls = gen.sites.filter((s) => s.kind === 'fallenCity');
  const shore = falls.filter(sea).sort(near), water = falls.filter(coast).sort(near), reach = (s) => !!lit[s.anchor[0] + s.anchor[1] * gen.cols];
  return shore.filter(reach)[0] || water.filter(reach)[0] || shore[0] || water[0] || null;
}

// the land a man walks from home (passable hexes), Uint8Array
function walkable(G, gen) {
  const out = new Uint8Array(gen.cols * gen.rows), q = [gen.capital];
  out[gen.capital[0] + gen.capital[1] * gen.cols] = 1;
  for (let i = 0; i < q.length; i++) {
    for (let d = 0; d < 6; d++) {
      const [x, y] = G.neighbour(q[i][0], q[i][1], d), k = x + y * gen.cols;
      if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || out[k] || !G.isPassable(gen.terrain[x][y])) continue;
      out[k] = 1;
      q.push([x, y]);
    }
  }
  return out;
}

// the ground a line of this fuel can cross from these hearths: passable land up to its danger cap, Uint8Array
function reach(ctx, gen, danger, fuel, from) {
  const { Fire: F, WorldGen: G } = ctx;
  const cap = F.FUELS[fuel].cap, out = new Uint8Array(gen.cols * gen.rows), q = from.slice();
  from.forEach((h) => { out[h[0] + h[1] * gen.cols] = 1; });
  for (let i = 0; i < q.length; i++) {
    for (let d = 0; d < 6; d++) {
      const [x, y] = G.neighbour(q[i][0], q[i][1], d), k = x + y * gen.cols;
      if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || out[k] || danger(x, y) > cap || !G.isPassable(gen.terrain[x][y]) || G.isWater(gen.terrain[x][y])) continue;
      out[k] = 1;
      q.push([x, y]);
    }
  }
  return out;
}

// the march by Fleet.way, spending water and food as Armies.supply does (afloat on the water: its boats carry it)
function march(ctx, gen, danger, lit, hb, site, kit, from) {
  const { Armies: A, Fire: F, Fleet: FL, WorldGen: G } = ctx;
  const isLit = (x, y) => !!lit[x + y * gen.cols];
  const steps = G.waterFrom(gen, hb), way = FL.way(gen, from, hb, site, steps, isLit, null);
  if (!way) return null;
  const army = { squads: { ...kit.squads }, ammo: {}, gear: {}, hurt: 0 }, start = A.soldiers(army);
  const cost = way.path.reduce((s, p) => s + A.moveCost(gen, p[0], p[1]), 0);
  let food = A.foodFor(start, cost), water = start * A.WATER_EACH, dueFood = 0, dueLost = 0;
  way.path.forEach((p, i) => {
    const afloat = i >= way.harbour && G.isWater(gen.terrain[p[0]][p[1]]);
    const n = A.soldiers(army), c = A.moveCost(gen, p[0], p[1]), here = isLit(p[0], p[1]) || afloat;
    const need = A.stepNeeds(n, here, here ? Math.max(0, danger(p[0], p[1]) - F.LIT_DANGER) : danger(p[0], p[1]), c);
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
  const land = way.path.slice(0, way.harbour);
  return { hexes: way.path.length, rowed: way.path.length - way.harbour, unlit: land.filter((p) => !isLit(p[0], p[1])).length, start, left: A.soldiers(army), minutes: cost * F.TICK / 60, camp: way.camp };
}

export function simulatePowerFleet({ seeds, firstSeed = 1 }) {
  const rand = seeded();
  const { ctx } = loadGame(rand);
  const { World: W, WorldGen: G, Danger: D, Powers: PW } = ctx;
  const P = PW.byId('fleet'), roll = () => rand.next(), out = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed * 7919);
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    // the game's Fleet.place: put out on the drowned harbour's water
    const field0 = D.field(gen);
    const pitch = pitchReach(ctx, gen, field0), hb = harbourSite(G, gen, pitch);
    gen.fleet = G._fleet(gen, hb);
    if (gen.fleet < 0) { out.push({ seed, none: true }); continue; }
    const field = D.field(gen), danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
    const site = gen.sites[gen.fleet], cols = gen.cols;
    const walk = walkable(G, gen);
    let lostLand = 0;
    // (the fleet's own hexes aside: a shallows hex under it is made deep)
    for (let k = 0; k < cols * gen.rows; k++) if (gen.reachable[k] && !walk[k] && gen.siteAt[k] !== gen.fleet) lostLand++;
    const dz = site.hexes.map((h) => danger(h[0], h[1]));
    // the whale-oil line from home and from the drowned harbour's own hearth (a city of ours by then)
    const lit = reach(ctx, gen, danger, 'whale oil', [gen.capital, hb.anchor]);
    out.push({
      seed, distance: G.distance(site.anchor, gen.capital), harbour: G.distance(hb.anchor, gen.capital),
      harbourLit: !!pitch[hb.anchor[0] + hb.anchor[1] * gen.cols],
      hexes: site.hexes.length, danger: [Math.min(...dz), Math.max(...dz)],
      sea: site.hexes.every((h) => ctx.Fleet.inland(gen, h[0], h[1])),
      deep: site.hexes.every((h) => !G.isPassable(gen.terrain[h[0]][h[1]])),
      onFoot: !!ctx.Armies.route(gen, gen.capital, site.anchor, () => true),
      harbourOnFoot: !!walk[hb.anchor[0] + hb.anchor[1] * cols], lostLand,
      march: march(ctx, gen, danger, lit, hb, site, REF, hb.anchor),
      fromHome: march(ctx, gen, danger, lit, hb, site, REF, gen.capital),
      storm: siege(ctx, P, REF, true, roll),
      fed: siege(ctx, P, DRY, true, roll),
      starve: siege(ctx, P, DRY, false, roll),
      small: siege(ctx, P, SMALL, true, roll),
    });
  }
  return { out, seeds, P };
}

export function powerFleetTable({ out, seeds }) {
  const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));
  const ok = out.filter((o) => !o.none);
  const lines = ['| the drowned fleet | seeds | outcome | siege min (median) | storm s (median) | lost of who went (median / max) |', '|---|---|---|---|---|---|'];
  for (const k of ['storm', 'fed', 'starve', 'small']) {
    const r = ok.map((o) => o[k]), outs = {};
    r.forEach((x) => { outs[x.outcome] = (outs[x.outcome] || 0) + 1; });
    const loss = r.map((x) => x.lost / x.start);
    lines.push(`| ${k} | ${r.length}/${seeds} | ${Object.entries(outs).map(([o, n]) => `${o} ${n}`).join(', ')} | ${fmt(median(r.map((x) => x.minutes)))} | ` +
      `${fmt(median(r.filter((x) => x.stormSeconds !== undefined).map((x) => x.stormSeconds)), 0)} | ${fmt(100 * median(loss), 0)}% / ${fmt(100 * Math.max(...loss), 0)}% |`);
  }
  lines.push('');
  lines.push('storm: 40 bayonets, 20 riflemen (5 bullets each), 10 boats, 4 fire-ships; fed/starve: the same, no fire-ships; small: 20 iron swords, 4 fire-ships.');
  const m = ok.map((o) => o.march).filter(Boolean), h = ok.map((o) => o.fromHome).filter(Boolean), d = ok.map((o) => o.distance), lo = ok.map((o) => o.danger[0]), hi = ok.map((o) => o.danger[1]);
  lines.push(`the drowned harbour (Network.harbourSite): ${median(ok.map((o) => o.harbour))} hexes out (median), its centre in a pitch line's reach ${ok.filter((o) => o.harbourLit).length}/${seeds}`);
  lines.push(`the fleet (WorldGen._fleet): ${median(d)} hexes out (median, ${Math.min(...d)}-${Math.max(...d)}), danger ${fmt(Math.min(...lo))}-${fmt(Math.max(...hi))} ` +
    `(POWERS §3: 5-7), on an inland sea ${ok.filter((o) => o.sea).length}/${seeds}, all open sea ${ok.filter((o) => o.deep).length}/${seeds}, ` +
    `reached on foot ${ok.filter((o) => o.onFoot).length}/${seeds}, land lost to it ${ok.reduce((s, o) => s + o.lostLand, 0)} hexes; ` +
    `the rough army rows out from the harbour on ${m.length}/${seeds}: ${median(m.map((x) => x.rowed))} hexes, ${fmt(median(m.map((x) => x.minutes)))} min, ` +
    `${fmt(100 * median(m.map((x) => 1 - x.left / x.start)), 0)}% lost (median); from the capital, by the harbour: ${median(h.map((x) => x.hexes))} hexes, ` +
    `${median(h.map((x) => x.unlit))} unlit on land, ${fmt(median(h.map((x) => x.minutes)))} min, ${fmt(100 * median(h.map((x) => 1 - x.left / x.start)), 0)}% lost ` +
    `(median; ${fmt(100 * Math.max(...h.map((x) => 1 - x.left / x.start)), 0)}% at worst)`);
  return lines.join('\n');
}

// The guards CI holds the fleet to (against provisional numbers in script/powers/fleet.js)
export function checkPowerFleet({ out }) {
  const fails = [];
  for (const o of out) {
    if (o.none) { fails.push(`seed ${o.seed}: no drowned fleet`); continue; }
    // where it stands: band 3, out on open water no one walks to; nothing walkable lost to it
    if (!(o.danger[0] >= 5 && o.danger[1] <= 7.5)) fails.push(`seed ${o.seed}: the fleet stands at danger ${o.danger[0].toFixed(1)}-${o.danger[1].toFixed(1)}, want 5-7.5`);
    if (!o.deep || o.onFoot) fails.push(`seed ${o.seed}: the fleet can be walked to`);
    if (o.lostLand) fails.push(`seed ${o.seed}: ${o.lostLand} hexes walkable before the fleet moved are not now`);
    // the way: the harbour on foot, then the boats out to the hulks
    if (!o.harbourOnFoot) fails.push(`seed ${o.seed}: the drowned harbour can't be walked to`);
    if (!o.march) fails.push(`seed ${o.seed}: no way to the fleet by the harbour's boats`);
    else if (o.march.left / o.march.start < 0.8) fails.push(`seed ${o.seed}: the rough army rowed out from the harbour with ${o.march.left} of ${o.march.start}, want 80% or more`);
    // POWERS §3's rough army breaks it, most of it alive
    if (o.storm.outcome !== 'broken') fails.push(`seed ${o.seed}: the rough army did not break the fleet (${o.storm.outcome})`);
    else if (o.storm.lost / o.storm.start > 0.35) fails.push(`seed ${o.seed}: breaking the fleet cost ${o.storm.lost} of ${o.storm.start}, want 35% or less`);
    // the puzzle: the hulks fall to fire-ships only; fed, they never yield; unfed, they do
    if (o.fed.outcome === 'broken' || o.fed.outcome === 'yielded' || o.fed.walls < 1000) fails.push(`seed ${o.seed}: without fire-ships the fleet fell (${o.fed.outcome}, hulks ${o.fed.walls})`);
    if (o.starve.outcome !== 'yielded') fails.push(`seed ${o.seed}: unfed, waiting the fleet out ended ${o.starve.outcome}, want yielded`);
    if (o.small.outcome !== 'routed') fails.push(`seed ${o.seed}: 20 iron swords ended ${o.small.outcome} against the fleet, want routed`);
    else if (!(o.small.routLoss >= 0.5 - 1e-9 && o.small.routLoss <= 0.8 + 1e-9)) fails.push(`seed ${o.seed}: a lost storm cost ${(100 * o.small.routLoss).toFixed(0)}%, want 50-80%`);
  }
  const s = median(out.filter((o) => !o.none && o.storm.stormSeconds !== undefined).map((o) => o.storm.stormSeconds));
  if (!(s <= 120)) fails.push(`the fleet's storm took ${s} s (median), want 120 or less`);
  return fails;
}
