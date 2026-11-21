// SPDX-License-Identifier: MIT
/*
 * Balance simulator for the hex map's difficulty curve (DESIGN.md "Difficulty curve").
 *
 * Loads the game's own world generator, danger curve, World rules and encounter
 * tables headlessly (no DOM) and plays bot treks across many seeds per difficulty.
 * Reports time to reach each danger band, deaths per band, loot per band and how
 * often a dropped pack is recovered.
 *
 *   npm run sim                      full table (markdown)
 *   npm run sim -- --seeds 5 --treks 30
 *   npm run sim -- --ci              small run with assertions; exits 1 if one fails
 *
 * Then the cities (simulateCities, below): how soon the 2nd and 3rd city are founded, and
 * whether a focused city's governor keeps its hearth lit for two hours.
 *
 * Then the city-states (simulateCityStates, below): the placement's counts and guarantees, and how long
 * the nearest herders take to win by influence alone once a beacon line touches them.
 *
 * Then the armies (tools/sim-armies.js): a city-state taken by force, waited out, and a storm lost.
 *
 * Then the fire network (script/fire.js): on every seed a bot raises beacon lines from the
 * capital in all six directions, 3 hexes apart, until the next beacon would stay dark, for each
 * ember and flame tier of each ladder; it reports the land lit and how far out, by danger band
 * and on the damp ground (swamp, jungle) the flame fuels open, and how many lines a steady supply
 * of each fuel keeps burning.
 *
 * The bot: each trek it walks the cheapest way toward a target (a random hex in the
 * outer half of what its water can reach there and back, or its dropped pack) and turns home when
 * the water or food left would only just get it back. Its kit improves every
 * TREKS_PER_KIT treks, like the range upgrades the player builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { simulateArmies, armiesTable, checkArmies } from './sim-armies.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The kits a player has as treks go on: water/armour/weapons are the range upgrades.
const KITS = [
  { name: 'cask, iron sword, i armour', water: 30, hp: 25, weapons: ['iron sword'], meat: 15, medicine: 1, bullets: 0 },
  { name: 'water tank, steel sword, rifle, s armour', water: 60, hp: 45, weapons: ['steel sword', 'rifle'], meat: 25, medicine: 3, bullets: 20 },
  { name: 'fluid recycler, steel sword, rifle, s armour', water: 110, hp: 45, weapons: ['steel sword', 'rifle'], meat: 40, medicine: 5, bullets: 40 },
  // nothing in the game carries this far yet: a stand-in for the waystations, roads and carts to come
  { name: 'future range (250 water), steel sword, rifle, s armour', water: 250, hp: 45, weapons: ['steel sword', 'rifle'], meat: 90, medicine: 8, bullets: 60 },
];
const TREKS_PER_KIT = 10;

export function loadGame(rand) {
  const store = {};
  const ctx = {
    _: (s, ...a) => s.replace(/\{(\d)\}/g, (m, i) => a[i]),
    Events: {},
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    $SM: {
      get: (k, zero) => (k in store ? store[k] : zero ? 0 : undefined),
      set: (k, v) => { store[k] = v; },
      hasPerk: () => false,
    },
    console,
  };
  vm.createContext(ctx);
  // the context's own Math, so the encounter tables' Math.random is the sim's seeded one
  vm.runInContext('Math.random = __rand;', Object.assign(ctx, { __rand: () => rand.next() }));
  for (const f of ['script/danger.js', 'script/worldgen.js', 'script/world.js', 'script/fire.js', 'script/events/encounters.js', 'script/citystates.js', 'script/armies.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('World.setupLandmarks();', ctx);
  return { ctx, store };
}

// a reseedable stream shared by the bot and the game's tables
export function seeded() {
  let a = 1;
  return {
    seed(s) { a = s >>> 0; },
    next() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// cheapest way home from every hex, in moves (World.moveCost), and the next hex on it
function homeward(W, G, gen) {
  const cols = gen.cols, n = cols * gen.rows, dist = new Float64Array(n).fill(Infinity), next = new Int32Array(n).fill(-1);
  const start = gen.capital[0] + gen.capital[1] * cols;
  dist[start] = 0;
  const buckets = [[start]];
  for (let d = 0; d < buckets.length; d++) {
    for (const k of buckets[d] || []) {
      if (dist[k] !== d) continue;
      const x = k % cols, y = (k - x) / cols;
      const cost = k === start ? 0 : W.moveCost(gen.map[x][y]);
      for (let dir = 0; dir < 6; dir++) {
        const [nx, ny] = G.neighbour(x, y, dir);
        if (nx < 0 || ny < 0 || nx >= cols || ny >= gen.rows) continue;
        const c = gen.map[nx][ny];
        if (!W.canEnter(c)) continue;
        // walking home from (nx,ny) to (x,y) costs what stepping onto (x,y) costs
        const nk = nx + ny * cols, nd = d + Math.max(cost, 1);
        if (nd < dist[nk]) {
          dist[nk] = nd;
          next[nk] = k;
          (buckets[nd] = buckets[nd] || []).push(nk);
        }
      }
    }
  }
  return { dist, next };
}

// One fight, in game seconds: the wanderer swings the best weapon ready, eats when hurt.
function fight(W, scene, me, rand) {
  let hp = me.hp, enemy = scene.health, t = 0, nextEnemy = scene.attackDelay, ready = {}, eatAt = 0;
  const weapons = me.weapons.filter((w) => w !== 'rifle' || me.bullets > 0).concat(['fists']);
  while (t < 600) {
    t = Math.round((t + 0.1) * 10) / 10;
    for (const w of weapons) {
      const wp = W.Weapons[w];
      if ((ready[w] || 0) > t || (w === 'rifle' && me.bullets <= 0)) continue;
      ready[w] = t + wp.cooldown;
      if (w === 'rifle') me.bullets--;
      if (rand.next() < W.BASE_HIT_CHANCE) enemy -= wp.damage;
      break; // one attack per tick, like one click
    }
    if (enemy <= 0) return { won: true, hp };
    if (t >= nextEnemy) {
      nextEnemy += scene.attackDelay;
      if (rand.next() <= scene.hit) hp -= scene.damage;
      if (hp <= 0) return { won: false, hp: 0 };
    }
    if (hp <= me.maxHp / 2 && t >= eatAt) {
      if (me.medicine > 0 && hp <= me.maxHp - W.MEDS_HEAL) {
        me.medicine--; hp = Math.min(me.maxHp, hp + W.MEDS_HEAL); eatAt = t + 7;
      } else if (me.meat > 0) {
        me.meat--; hp = Math.min(me.maxHp, hp + W.MEAT_HEAL); eatAt = t + 5;
      }
    }
  }
  return { won: false, hp: 0 };
}

function lootOf(D, danger, scene, rand) {
  let n = 0;
  for (const k in scene.loot || {}) {
    const l = scene.loot[k];
    if (rand.next() < l.chance) n += Math.round((Math.floor(rand.next() * (l.max - l.min)) + l.min) * D.lootScale(danger));
  }
  return n;
}

export function simulate({ seeds, treks, difficulties = ['gentle', 'normal', 'harsh'], firstSeed = 1 }) {
  const rand = seeded();
  const { ctx, store } = loadGame(rand);
  const { World: W, WorldGen: G, Danger: D, Events: E } = ctx;
  const out = {};
  const curve = [];
  for (const diff of difficulties) {
    out[diff] = {
      bands: Array.from({ length: D.BANDS }, () => ({ seedsReached: 0, firstSteps: [], firstTrek: [], entries: 0, deaths: 0, loot: 0, steps: 0 })),
      packs: { dropped: 0, recovered: 0, share: 0 }, deaths: 0, treks: 0,
    };
  }
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed);
    const square = W.generateMap(G.rng(seed));
    const gen = G.generate(seed, square);
    const field = D.field(gen);
    W.hex = { gen, map: gen.map, danger: field, passes: {} };
    W.VILLAGE_POS = gen.capital.slice();
    W.state = { map: gen.map };
    const home = homeward(W, G, gen);
    // mean danger per 5-hex ring at normal, for the monotonic check
    const ring = [];
    for (let x = 0; x < gen.cols; x++) for (let y = 0; y < gen.rows; y++) {
      if (!gen.reachable[x + y * gen.cols]) continue;
      const r = Math.floor(G.distance([x, y], gen.capital) / 5);
      ring[r] = ring[r] || [0, 0];
      ring[r][0] += field[x + y * gen.cols];
      ring[r][1]++;
    }
    curve.push({ seed, rings: ring.map((r) => (r ? r[0] / r[1] : null)), heartRing: Math.floor(G.distance(gen.capital, gen.warHeart) / 5) });

    for (const diff of difficulties) {
      rand.seed(seed * 7919);
      store['game.difficulty'] = diff;
      const res = out[diff];
      const targets = [];
      for (let k = 0; k < field.length; k++) if (home.dist[k] < Infinity) targets.push(k);
      let steps = 0, pack = null;
      const reached = new Array(D.BANDS).fill(false);
      for (let trek = 0; trek < treks; trek++) {
        res.treks++;
        const kit = KITS[Math.min(KITS.length - 1, Math.floor(trek / TREKS_PER_KIT))];
        const me = { hp: kit.hp, maxHp: kit.hp, weapons: kit.weapons, meat: kit.meat, medicine: kit.medicine, bullets: kit.bullets, loot: 0 };
        let water = kit.water, foodMove = 0, fightMove = 0, thirst = false, hunger = false;
        // the target: the pack if it can be reached and back, else a hex in the outer half of the kit's reach.
        // Targets don't depend on the difficulty, so every difficulty walks the same ground.
        let target = null;
        if (pack && home.dist[pack.k] * 2 + 4 <= water) target = pack.k;
        else {
          const reach = (water - 4) / 2, pool = targets.filter((k) => home.dist[k] <= reach && home.dist[k] >= reach / 2);
          target = pool.length ? pool[Math.floor(rand.next() * pool.length)] : gen.capital[0] + gen.capital[1] * gen.cols;
        }
        // the way out is the way home, reversed
        const route = [];
        for (let k = target; k >= 0 && home.dist[k] > 0; k = home.next[k]) route.unshift(k);
        const entered = new Set();
        let at = route.length ? 0 : -1, out_ = true, dead = false, cur = gen.capital[0] + gen.capital[1] * gen.cols;
        const usedOutposts = new Set();
        const walk = (k) => {
          cur = k;
          steps++;
          const x = k % gen.cols, y = (k - x) / gen.cols;
          W.curPos = [x, y];
          const danger = W.dangerAt(x, y), band = D.band(danger), b = res.bands[band];
          if (!entered.has(band)) { entered.add(band); b.entries++; }
          b.steps++;
          if (!reached[band]) { reached[band] = true; b.seedsReached++; b.firstSteps.push(steps); b.firstTrek.push(trek + 1); }
          if (pack) {
            pack.left *= 1 - D.scavengeRate(W.dangerAt(pack.k % gen.cols, (pack.k - pack.k % gen.cols) / gen.cols));
            if (Math.floor(pack.items * pack.left) <= 0) pack = null;
          }
          if (pack && pack.k === k) {
            res.packs.recovered++;
            res.packs.share += Math.floor(pack.items * pack.left) / pack.items;
            pack = null;
          }
          const tile = gen.map[x][y];
          if (W.LANDMARKS[tile.charAt(0)]) {
            if (tile.charAt(0) === 'P' && !usedOutposts.has(k)) { usedOutposts.add(k); water = kit.water; }
            return true; // a landmark's own event; no supplies, no random fight
          }
          // supplies, one stage of hunger or thirst per step
          const warned = { food: false, water: false };
          for (let m = W.moveCost(tile); m > 0; m--) {
            if (++foodMove >= W.MOVES_PER_FOOD) {
              foodMove = 0;
              if (me.meat > 0) { me.meat--; hunger = false; me.hp = Math.min(me.maxHp, me.hp + W.MEAT_HEAL); }
              else if (!hunger) { hunger = warned.food = true; }
              else if (!warned.food) return die(band);
            }
            if (water > 0) { water--; thirst = false; }
            else if (!thirst) { thirst = warned.water = true; }
            else if (!warned.water) return die(band);
          }
          if (++fightMove > W.FIGHT_DELAY && rand.next() < D.fightChance(danger)) {
            fightMove = 0;
            const pool = E.Encounters.filter((e) => e.isAvailable());
            if (pool.length) {
              const scene = pool[Math.floor(rand.next() * pool.length)].scenes.start, m = D.strength(danger);
              const s = { ...scene, health: Math.round(scene.health * m), damage: Math.round(scene.damage * m) };
              const r = fight(W, s, me, rand);
              me.hp = r.hp;
              if (!r.won) return die(band);
              const l = lootOf(D, danger, scene, rand);
              me.loot += l;
              b.loot += l;
            }
          }
          return true;
        };
        const die = (band) => {
          dead = true;
          res.deaths++;
          res.bands[band].deaths++;
          const items = me.meat + me.medicine + me.bullets + me.loot;
          pack = items > 0 ? { k: cur, items, left: 1 } : null;
          if (pack) res.packs.dropped++;
          return false;
        };
        // out along the route, turning back when the supplies left only just get home
        while (at >= 0 && at < route.length) {
          if (!walk(route[at])) break;
          const back = home.dist[cur];
          if (at === route.length - 1 || water < back + 2 || me.meat * W.MOVES_PER_FOOD < back + 2 || me.hp < me.maxHp * 0.3) break;
          at++;
        }
        // and home
        while (!dead && home.dist[cur] > 0) {
          if (!walk(home.next[cur])) break;
        }
      }
    }
  }
  return { results: out, curve };
}

const TIERS = ['1', '2', '3', '4'];
const FLAME = ['4', '5', '6', '7', '8'];
const ID = { fuel: 'F', beacon: 'B', hearth: 'H' };

// Fire.compute's net.kind for a world, as Network.kinds builds it (no roads: the bot lays none)
function kindsOf(ctx, gen) {
  const { Fire: F, WorldGen: G } = ctx, T = G.TERRAIN, bits = new Uint8Array(gen.cols * gen.rows);
  for (let x = 0; x < gen.cols; x++) {
    for (let y = 0; y < gen.rows; y++) {
      const t = gen.terrain[x][y];
      bits[x + y * gen.cols] = t === T.swamp ? F.SWAMP : t === T.jungle ? F.JUNGLE : t === T.lake ? F.LAKE : 0;
    }
  }
  return bits;
}

// The bot's network for one set of ember tiers ({ fuel: n, beacon: n, hearth: n }) on one world:
// six straight lines out from the capital, a beacon every Fire.HOP hexes while it still catches.
function fireNetwork(ctx, gen, field, t, opts = {}) {
  const { Fire: F, WorldGen: G, Danger: D } = ctx;
  // fuel 0: no fuel cap, to see what the beacons and hearths alone allow
  const fuel = Object.keys(F.FUELS).find((k) => F.FUELS[k].tier === 'F' + t.fuel);
  const H = F.HEARTHS['H' + t.hearth];
  const danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
  // the capital's village is full (80 people): a hearth that grows with its people is at its most
  const out = H.out * (H.grow ? Math.min(H.grow, 80 / 32) : 1);
  const net = {
    cols: gen.cols, rows: gen.rows, danger, kind: opts.kind,
    hills: (x, y) => gen.terrain[x][y] === G.TERRAIN.hills,
    open: (x, y) => G.isPassable(gen.terrain[x][y]) && !G.isWater(gen.terrain[x][y]),
    // no fuel cap: and no damp ground either
    hearths: [{ at: gen.capital, out, share: H.share, cap: fuel ? F.FUELS[fuel].cap : Infinity, holds: fuel ? F.FUELS[fuel].holds || 0 : 0, wet: fuel ? F.FUELS[fuel].wet : 0 }],
    beacons: [], beacon: F.BEACONS['B' + t.beacon],
  };
  const open = (p) => p[0] >= 0 && p[1] >= 0 && p[0] < gen.cols && p[1] < gen.rows &&
    G.isPassable(gen.map[p[0]][p[1]]) && gen.map[p[0]][p[1]] !== G.TERRAIN.ocean;
  const lines = [];
  for (let d = 0; d < (opts.dirs || 6); d++) {
    let at = gen.capital;
    const line = [];
    for (let i = 0; i < 20; i++) {
      // 3 hexes on in this direction; or the nearest open hex to it still within a hop
      let p = at;
      for (let k = 0; k < F.HOP; k++) p = G.neighbour(p[0], p[1], d);
      if (!open(p)) {
        const alt = F.around(p[0], p[1], 1).filter((q) => open(q) && F.distance(q, at) <= F.HOP && F.distance(q, at) >= 2);
        if (!alt.length) break;
        p = alt[0];
      }
      net.beacons.push(p);
      const r = F.compute(net);
      if (r.nodes[r.nodes.length - 1].s < F.LIT_MIN) { net.beacons.pop(); break; }
      line.push(p);
      at = p;
    }
    lines.push(line);
  }
  const r = F.compute(net);
  let lit = 0, far = 0;
  const bands = [0, 0, 0, 0, 0], damp = { swamp: 0, jungle: 0 };
  for (let k = 0; k < r.lit.length; k++) {
    if (!r.lit[k]) continue;
    lit++;
    const x = k % gen.cols, y = Math.floor(k / gen.cols);
    far = Math.max(far, G.distance([x, y], gen.capital));
    bands[Math.min(4, Math.floor(danger(x, y) / D.BAND_SIZE))]++;
    if (gen.terrain[x][y] === G.TERRAIN.swamp) damp.swamp++;
    if (gen.terrain[x][y] === G.TERRAIN.jungle) damp.jungle++;
  }
  return { net, lines, lit, far, bands, damp, beacons: r.nodes.filter((n) => !n.hearth && n.s >= F.LIT_MIN).length, result: r, fuel };
}

// Damp ground a fuel can light at all, wherever a line takes it: swamp and jungle hexes the
// wanderer can walk to, within 60 hexes of the capital, under the fuel's cap (its `wet` cap on the
// ground it holds). Six straight lines seldom meet a swamp, so this is what shows peat and resin.
function dampReach(ctx, gen, field, kind, n) {
  const { Fire: F, Danger: D } = ctx, out = { swamp: 0, jungle: 0 };
  const fuel = Object.keys(F.FUELS).find((k) => F.FUELS[k].tier === 'F' + n);
  if (!fuel) return out;
  const f = F.FUELS[fuel], holds = f.holds || 0;
  for (const p of F.around(gen.capital[0], gen.capital[1], 60)) {
    const [x, y] = p;
    if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || !gen.reachable[x + y * gen.cols]) continue;
    const b = kind[x + y * gen.cols] & 3;
    if (!b) continue;
    if (D.at(field, gen.cols, x, y, 'normal') > (b & holds ? f.wet : f.cap)) continue;
    out[b & F.SWAMP ? 'swamp' : 'jungle']++;
  }
  return out;
}

export function simulateFire({ seeds, firstSeed = 1 }) {
  const rand = seeded();
  const { ctx } = loadGame(rand);
  const { World: W, WorldGen: G, Danger: D, Fire: F } = ctx;
  const max = { fuel: 4, beacon: 4, hearth: 4 };
  const rows = [];
  const add = (label, ladder, t) => rows.push({ label, ladder, t, lit: [], far: [], beacons: [], bands: [], damp: [], reach: [] });
  // each ladder on its own: the others at the top of the ember era, except that past tallow's
  // reach (danger 2.5) the fuel is what binds, so beacons and hearths are measured without a fuel cap
  for (const ladder of ['fuel', 'beacon', 'hearth']) {
    const others = ladder === 'fuel' ? { ...max } : { ...max, fuel: 0 };
    const rest = Object.keys(max).filter((l) => l !== ladder).map((l) => (others[l] ? ID[l] + others[l] : 'no fuel cap')).join(', ');
    for (const n of TIERS) add(`${ID[ladder]}${n} (${rest})`, ladder, { ...others, [ladder]: +n });
  }
  for (const n of TIERS) add(`B${n} with tallow (F4, H4)`, 'beacon at F4', { ...max, beacon: +n });
  for (const n of TIERS) add(`F${n} B${n} H${n} together`, 'all', { fuel: +n, beacon: +n, hearth: +n });
  // the flame era, from the top of the ember era: each ladder with the others at the flame's top (F8 B8 H8)
  const top = { fuel: 8, beacon: 8, hearth: 8 };
  for (const ladder of ['fuel', 'beacon', 'hearth']) {
    const others = ladder === 'fuel' ? { ...top } : { ...top, fuel: 0 };
    const rest = Object.keys(top).filter((l) => l !== ladder).map((l) => (others[l] ? ID[l] + others[l] : 'no fuel cap')).join(', ');
    for (const n of FLAME) add(`${ID[ladder]}${n} (${rest})`, 'flame ' + ladder, { ...others, [ladder]: +n });
  }
  for (const n of FLAME) add(`F${n} B${n} H${n} together`, 'flame all', { fuel: +n, beacon: +n, hearth: +n });
  const cut = { checked: 0, fails: [] };
  const sustain = {};
  for (const k in F.FUELS) sustain[k] = { beaconsPerLine: [] };
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    const field = D.field(gen), kind = kindsOf(ctx, gen);
    for (const row of rows) {
      const n = fireNetwork(ctx, gen, field, row.t, { kind });
      row.lit.push(n.lit);
      row.far.push(n.far);
      row.beacons.push(n.beacons);
      row.bands.push(n.bands);
      row.damp.push(n.damp);
      row.reach.push(dampReach(ctx, gen, field, kind, row.t.fuel));
    }
    // lines sustained: how long one line burning each fuel is, at B4 H4 (B8 H8 for the flame fuels)
    for (const k in F.FUELS) {
      const flame = F.tier(F.FUELS[k].tier).n > 4;
      const t = { fuel: F.tier(F.FUELS[k].tier).n, beacon: flame ? 8 : 4, hearth: flame ? 8 : 4 };
      const n = fireNetwork(ctx, gen, field, t, { kind });
      sustain[k].beaconsPerLine.push(n.beacons / 6);
    }
    // a cut line: put out the first beacon of the longest line; everything past it goes dark
    const full = fireNetwork(ctx, gen, field, max, { kind });
    const longest = full.lines.reduce((a, b) => (b.length > a.length ? b : a), []);
    if (longest.length >= 2) {
      cut.checked++;
      const net = { ...full.net, beacons: full.net.beacons.filter((b) => b !== longest[0]) };
      const r = F.compute(net);
      const darkPast = longest.slice(1).every((b) => {
        const i = net.beacons.indexOf(b) + net.hearths.length;
        return r.nodes[i].s < F.LIT_MIN && !r.lit[b[0] + b[1] * gen.cols];
      });
      const litBefore = full.result.lit.reduce((a, b) => a + b, 0), litAfter = r.lit.reduce((a, b) => a + b, 0);
      if (!darkPast || !(litAfter < litBefore)) cut.fails.push(`seed ${seed}: cutting the line at ${longest[0]} left ${darkPast ? 'as much lit' : 'beacons past it lit'}`);
    }
  }
  return { rows, cut, sustain, F };
}

// Lines a steady supply keeps burning: the hearth's own fire first, then Fire.UPKEEP a beacon.
// provisional reference supply: 40 units of the fuel a tick (about ten workers on its chain)
const SUPPLY = 40;

export function fireTable({ rows, cut, sustain, F }) {
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const lines = [];
  lines.push('| tiers | hexes lit | furthest lit (hexes from the capital) | beacons lit | lit in band 0 / 1 / 2 | lit swamp / jungle | swamp / jungle its fuel can light |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const band = (b) => mean(r.bands.map((x) => x[b])).toFixed(0);
    lines.push(`| ${r.label} | ${mean(r.lit).toFixed(0)} | ${mean(r.far).toFixed(1)} | ${mean(r.beacons).toFixed(1)} | ${band(0)} / ${band(1)} / ${band(2)} | ${mean(r.damp.map((d) => d.swamp)).toFixed(1)} / ${mean(r.damp.map((d) => d.jungle)).toFixed(1)} | ${r.t.fuel ? mean(r.reach.map((d) => d.swamp)).toFixed(0) + ' / ' + mean(r.reach.map((d) => d.jungle)).toFixed(0) : '-'} |`);
  }
  lines.push('');
  lines.push(`| fuel (B4 H4; flame: B8 H8) | fire per unit | danger cap | beacons per line | units / tick for the hearth | units / tick per line | lines kept by ${SUPPLY} units / tick |`);
  lines.push('|---|---|---|---|---|---|---|');
  for (const k in sustain) {
    const f = F.FUELS[k], per = f.fire * f.burn, b = mean(sustain[k].beaconsPerLine);
    const H = F.tier(f.tier).n > 4 ? F.HEARTHS.H5 : F.HEARTHS.H4; // the hearth's own fire at its plainest
    const lineCost = b * F.UPKEEP / per;
    const kept = lineCost > 0 ? Math.max(0, Math.floor((SUPPLY - H.out / per) / lineCost)) : 0;
    lines.push(`| ${k} | ${per} | ${f.cap} | ${b.toFixed(1)} | ${(H.out / per).toFixed(1)} | ${lineCost.toFixed(1)} | ${kept} |`);
  }
  lines.push('');
  lines.push(`cut lines checked: ${cut.checked}, past the cut still lit: ${cut.fails.length}`);
  return lines.join('\n');
}

// The guards CI holds the fire to: every ember tier lights more land than the one before it,
// and a cut line goes dark past the cut. The flame era opens the ground LADDERS.md says: charcoal
// lights more of band 1, peat more swamp, resin more jungle, coal band 2; the watchtower carries
// further; the lamp-post, ford light and marsh lantern (roads, lakes, swamps) never light less;
// every flame hearth lights more than the one before it.
export function checkFire({ rows, cut }) {
  const fails = [];
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const more = (rs, i, what, of) => {
    if (!(mean(rs[i][of]) > mean(rs[i - 1][of]))) fails.push(`${rs[i].label} lights ${mean(rs[i][of]).toFixed(1)} ${what}, not more than ${rs[i - 1].label} (${mean(rs[i - 1][of]).toFixed(1)})`);
  };
  for (const ladder of ['fuel', 'beacon', 'hearth', 'all', 'flame fuel', 'flame beacon', 'flame hearth', 'flame all']) {
    const rs = rows.filter((r) => r.ladder === ladder);
    if (!rs.length) fails.push(`no rows for ${ladder}`);
    for (let i = 1; i < rs.length; i++) {
      // roads, lakes and swamps are what B6-B8 add: a straight line may meet none of them
      if (ladder === 'flame beacon' && i > 1) {
        if (mean(rs[i].lit) < mean(rs[i - 1].lit)) fails.push(`${rs[i].label} lights less than ${rs[i - 1].label}`);
      } else more(rs, i, 'hexes', 'lit');
    }
  }
  const fuel = rows.filter((r) => r.ladder === 'flame fuel'), at = (n) => fuel.find((r) => r.t.fuel === n);
  for (const r of fuel) {
    r.band1 = r.bands.map((b) => b[1]);
    r.band2 = r.bands.map((b) => b[2]);
    r.swamp = r.reach.map((d) => d.swamp);
    r.jungle = r.reach.map((d) => d.jungle);
  }
  const step = (n, of, what) => more([at(n - 1), at(n)], 1, what, of);
  step(5, 'band1', 'band 1 hexes');
  step(6, 'swamp', 'swamp hexes in reach');
  step(7, 'jungle', 'jungle hexes in reach');
  step(8, 'band2', 'band 2 hexes');
  if (mean(at(7).band2) > 0.05 * mean(at(8).band2)) fails.push(`resin (F7) already lights ${mean(at(7).band2).toFixed(1)} band 2 hexes; coal (F8) is what opens band 2`);
  if (!cut.checked) fails.push('no line long enough to cut');
  fails.push(...cut.fails);
  return fails;
}

/*
 * Cities (Phase 3b): how soon a capital founds its 2nd and 3rd city, and whether a focused
 * city's governor keeps its hearth lit.
 *
 * Founding: from the town's opening with the ember tiers at their top (F4 B4 H4), a bot picks the
 * nearest place it can found (a fallen city's old centre, or open land 6-10 hexes from every city),
 * raises beacons toward it until it is lit, pays the settlers (City.SETTLERS) and walks them there.
 * The capital's village is not simulated: it pays in at CAPITAL_INCOME a fire tick, and its hearth
 * burns tallow, so beacons and settlers cost only wood and cured meat. A trek step takes
 * STEP_SECONDS. 'Cities held' counts what stands EMBER_MINUTES after the town's opening.
 *
 * Governors: each founded 2nd city is played for two hours of fire ticks under each focus with the
 * game's own jobs (script/city.js), districts (script/districts.js), hearth (script/fire.js) and
 * governor (script/governor.js); the bot gives it the districts its ground fits (woods, hunting
 * grounds, huts), and people come to its houses as they do in the game.
 */
// provisional: a village of 80 at the town's opening, about 20 gatherers, 20 hunters (10 meat a tick)
// and the 2 charcutiers that meat keeps busy (5 meat each for 1 cured meat); the rest on other work
const CAPITAL_INCOME = { wood: 20, 'cured meat': 2 };
const CAPITAL_START = { wood: 500, 'cured meat': 50 }; // provisional: what is left after the 20 huts
const STEP_SECONDS = 1;
const GOVERN_TICKS = 720; // two hours of 10 s fire ticks
const EMBER_MINUTES = 60; // provisional: how long after the town's opening the ember era lasts, for 'cities held'

function loadCities(rand) {
  const { ctx, store } = loadGame(rand);
  for (const f of ['script/districts.js', 'script/city.js', 'script/governor.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, store };
}

// what District.TYPES[].fits sees of a hex (Network.ground)
function groundOf(ctx, gen, at, city) {
  const { WorldGen: G } = ctx;
  const key = (x, y) => {
    if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows) return null;
    const c = gen.terrain[x][y];
    return Object.keys(G.TERRAIN).find((k) => G.TERRAIN[k] === c) || null;
  };
  const f = gen.formationAt[at[0] + at[1] * gen.cols];
  return { at, terrain: key(at[0], at[1]), terrainAt: key, site: gen.siteAt[at[0] + at[1] * gen.cols] >= 0,
    deep: f >= 0 && gen.formations[f].kind === 'forest', city, capital: false };
}

function foundCities(ctx, gen, field, home, max) {
  const { Fire: F, WorldGen: G, Danger: D, District: Di, City: C } = ctx;
  const cost = C.SETTLERS.stores;
  const danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
  const H = F.HEARTHS.H4, cap = gen.capital, cols = gen.cols;
  const net = { cols, rows: gen.rows, danger, hills: (x, y) => gen.terrain[x][y] === G.TERRAIN.hills, kind: kindsOf(ctx, gen),
    hearths: [{ at: cap, out: H.out, share: true, cap: F.FUELS.tallow.cap }], beacons: [], beacon: F.BEACONS.B4 };
  const cities = [{ at: cap, districts: { [cap.join(',')]: Di.HEARTH } }];
  const taken = (p) => cities.some((c) => Object.keys(c.districts).some((k) => F.distance(k.split(',').map(Number), p) <= 1));
  const open = (p) => p[0] >= 0 && p[1] >= 0 && p[0] < cols && p[1] < gen.rows && home.dist[p[0] + p[1] * cols] < Infinity &&
    G.isPassable(gen.map[p[0]][p[1]]) && gen.map[p[0]][p[1]] !== G.TERRAIN.ocean;
  const land = (p) => Di.land(groundOf(ctx, gen, p, {}));
  const isBeacon = (p) => net.beacons.some((b) => b[0] === p[0] && b[1] === p[1]);
  let r = F.compute(net);
  const lit = (p) => !!r.lit[p[0] + p[1] * cols];
  let wood = CAPITAL_START.wood, meat = CAPITAL_START['cured meat'], t = 0;
  // waits until the capital has this much, in whole fire ticks
  const wait = (w, m) => {
    const ticks = Math.max(0, Math.ceil((w - wood) / CAPITAL_INCOME.wood), Math.ceil((m - meat) / CAPITAL_INCOME['cured meat']));
    t += ticks * 10;
    wood += ticks * CAPITAL_INCOME.wood;
    meat += ticks * CAPITAL_INCOME['cured meat'];
  };
  const out = [], bad = new Set();
  while (out.length < max) {
    // candidates: fallen cities' old centres, and open land 6-10 hexes from every city
    const cands = [];
    for (const s of gen.sites) {
      if (s.kind === 'fallenCity' && open(s.anchor) && land(s.anchor) && !taken(s.anchor) && G.distance(s.anchor, cap) <= 16) cands.push({ at: s.anchor, site: s });
    }
    for (const p of F.around(cap[0], cap[1], 12)) {
      if (gen.siteAt[p[0] + p[1] * cols] >= 0 || !open(p) || !land(p)) continue;
      const d = Math.min(...cities.map((c) => F.distance(c.at, p)));
      if (d >= 6 && d <= 10) cands.push({ at: p, site: null });
    }
    // the cheapest to light: fewest hexes past the nearest lit node; a fallen city wins a tie by a hop
    const nodes = () => [cap].concat(net.beacons);
    const gap = (c) => Math.min(...nodes().map((n) => F.distance(n, c.at))) - (c.site ? F.HOP : 0);
    const pick = cands.filter((c) => !bad.has(c.at.join(','))).sort((a, b) => gap(a) - gap(b))[0];
    if (!pick) break;
    let raised = 0, ok = true;
    while (!(lit(pick.at) && !isBeacon(pick.at))) {
      const from = nodes().sort((a, b) => F.distance(a, pick.at) - F.distance(b, pick.at))[0];
      const line = F.line(from, pick.at);
      let next = null;
      for (let k = Math.min(F.HOP, line.length - 1); k >= 1 && !next; k--) {
        next = [line[k]].concat(F.around(line[k][0], line[k][1], 1))
          .find((q) => open(q) && !isBeacon(q) && !taken(q) && F.distance(q, from) <= F.HOP && !(q[0] === pick.at[0] && q[1] === pick.at[1]));
      }
      if (!next || raised >= 10) { ok = false; break; }
      wait(20, 0);
      wood -= 20;
      net.beacons.push(next);
      raised++;
      r = F.compute(net);
      if (r.nodes[r.nodes.length - 1].s < F.LIT_MIN) { net.beacons.pop(); r = F.compute(net); ok = false; break; } // past the fuel's reach
    }
    if (!ok) { bad.add(pick.at.join(',')); continue; }
    wait(cost.wood, cost['cured meat']);
    wood -= cost.wood;
    meat -= cost['cured meat'];
    const steps = home.dist[pick.at[0] + pick.at[1] * cols];
    t += steps * STEP_SECONDS;
    const districts = { [pick.at.join(',')]: Di.HEARTH };
    cities.push({ at: pick.at, districts });
    out.push({ at: pick.at, site: !!pick.site, minutes: t / 60, beacons: raised, steps });
  }
  return out;
}

// The flame era's first tiers for a governed city (the ones a city's own land can reach: charcoal,
// the watchtower, the chimney hearth to the bread oven); its collier works the stranger's way
const FLAME_CITY = ['F5', 'B5', 'H5', 'H6', 'H7'];

// One founded city under a focus for GOVERN_TICKS fire ticks; returns how its hearth fared.
// flame: with FLAME_CITY's tiers too, a burning pits district, and the bread oven's hearth
function governCity(ctx, store, gen, at, focus, rand, flame = false) {
  const { Fire: F, District: Di, City: C, Governor: Gv } = ctx;
  const id = 'sim', districts = { [at.join(',')]: Di.HEARTH };
  // the districts its ground fits, next to the hearth quarter: woods, hunting grounds, huts, one each
  for (const type of ['woods', 'hunting grounds', 'huts'].concat(flame ? ['burning pits'] : [])) {
    const p = Di.neighbours(at).find((q) => !districts[q.join(',')] && Di.TYPES[type].fits(groundOf(ctx, gen, q, districts)));
    if (p) districts[p.join(',')] = type;
  }
  const city = { citizens: C.SETTLERS.people, stores: { ...C.SETTLERS.stores }, buildings: {}, workers: {}, hearth: { out: 0, stored: 0 } };
  const tiers = {};
  ['F1', 'F2', 'F3', 'F4', 'B1', 'B2', 'B3', 'B4', 'H1', 'H2', 'H3', 'H4'].concat(flame ? FLAME_CITY : []).forEach((k) => { tiers[k] = true; });
  const hid = flame ? 'H7' : 'H4', H = F.HEARTHS[hid];
  store['game.network.story.charcoalWay'] = flame ? 'their' : undefined;
  const hexesOf = (type) => Object.keys(districts).filter((k) => districts[k] === type).map((k) => k.split(',').map(Number));
  const max = (b) => (C.Buildings[b].later || (C.Buildings[b].needs && !tiers[C.Buildings[b].needs]) ? 0 : C.Buildings[b].maximum * hexesOf(C.Buildings[b].district).length);
  const slots = (j) => {
    const inc = C._INCOME[j];
    if (inc.needs && !tiers[inc.needs]) return 0;
    if (!inc.raw) return Infinity;
    return hexesOf(inc.district).reduce((s, p) => s + Di.TYPES[inc.district].jobs[j](groundOf(ctx, gen, p, districts)), 0);
  };
  const scale = () => Math.min(1, city.citizens / 32); // Network.HEARTH_PEOPLE
  // Network.hearthOut: from the bread oven, the fire grows with the people
  const outScale = () => F.foundedOut(H, city.citizens, 32) / H.out; // Network.hearthOut
  const share = (j) => {
    const inc = C._INCOME[j], fn = inc.raw ? Di.TYPES[inc.district].jobs[j] : null;
    let total = 0, weight = 0;
    for (const p of hexesOf(inc.district)) {
      const w = fn ? fn(groundOf(ctx, gen, p, districts)) : 1;
      if (!w) continue;
      total += w * Di.jobShare(inc.district, j, p, at, districts);
      weight += w;
    }
    if (!weight) return 1;
    const full = H.out * outScale();
    return total / weight * (Di.DARK_FLOOR + (1 - Di.DARK_FLOOR) * (full > 0 ? Math.min(1, city.hearth.out / full) : 0));
  };
  const open = () => {
    const jobs = new Set();
    for (const b in city.buildings) if (city.buildings[b] > 0) (C.Buildings[b].jobs || []).forEach((j) => jobs.add(j));
    for (const j in C._INCOME) if (C._INCOME[j].raw) jobs.add(j);
    return [...jobs].filter((j) => slots(j) > 0);
  };
  const res = { focus: flame ? focus + ' (flame: ' + FLAME_CITY.join(' ') + ')' : focus, cold: 0, lowest: Infinity, built: 0, citizens: 0 };
  let nextPeople = 3 + Math.floor(rand.next() * 15);
  for (let tick = 0; tick < GOVERN_TICKS; tick++) {
    // the hearth
    const need = H.out * outScale();
    const r = F.burnAll(hid, tiers, (k) => city.stores[k] || 0, need, city.hearth.stored, H.store * scale());
    for (const k in r.burn) city.stores[k] -= r.burn[k];
    city.hearth = { out: need > 0 ? r.out * need / H.out : 0, stored: r.stored };
    if (!(city.hearth.out > 0)) res.cold++;
    // the governor
    const view = { focus, citizens: city.citizens, jobs: {}, stores: { ...city.stores }, fuels: {}, builds: [], need, cold: !(city.hearth.out > 0),
      room: (city.buildings.house || 0) * C.Buildings.house.room };
    for (const j of open()) {
      const inc = C.income(j), s = share(j), per = {};
      for (const k in inc.stores) per[k] = inc.stores[k] * s * 10 / inc.delay;
      view.jobs[j] = { slots: slots(j), stores: per };
    }
    for (const f in F.FUELS) if (tiers[F.FUELS[f].tier]) view.fuels[f] = F.FUELS[f].fire * F.FUELS[f].burn;
    for (const b in C.Buildings) {
      if ((city.buildings[b] || 0) >= max(b)) continue;
      store[`game.cities["${id}"].buildings["${b}"]`] = city.buildings[b] || 0;
      view.builds.push({ key: b, cost: C.Buildings[b].cost(id), have: city.buildings[b] || 0 });
    }
    const plan = Gv.plan(view);
    city.workers = plan.workers;
    if (plan.build) {
      const cost = view.builds.find((b) => b.key === plan.build).cost;
      for (const k in cost) city.stores[k] -= cost[k];
      city.buildings[plan.build] = (city.buildings[plan.build] || 0) + 1;
      res.built++;
    }
    // the jobs pay out at their pace (City.updateIncome), all or nothing like $SM.collectIncome
    for (const j in city.workers) {
      const n = city.workers[j];
      if (!n) continue;
      const inc = C.income(j), delay = Math.max(1, Math.round(inc.delay / Math.max(0.1, share(j))));
      const per = 10 / delay, add = {};
      for (const k in inc.stores) add[k] = inc.stores[k] * n * per;
      if (Object.keys(add).every((k) => (city.stores[k] || 0) + add[k] >= 0)) for (const k in add) city.stores[k] = (city.stores[k] || 0) + add[k];
    }
    // people come to its houses (City.increaseCitizens, every 0.5-3 minutes)
    if (--nextPeople <= 0) {
      const room = (city.buildings.house || 0) * C.Buildings.house.room, space = room - city.citizens;
      if (space > 0) city.citizens += Math.max(1, Math.floor(rand.next() * (space / 2) + space / 2));
      nextPeople = 3 + Math.floor(rand.next() * 15);
    }
    if (tick > 0) {
      let stock = 0;
      for (const f in view.fuels) stock += (city.stores[f] || 0) * view.fuels[f];
      res.lowest = Math.min(res.lowest, stock);
    }
  }
  res.citizens = city.citizens;
  res.buildings = city.buildings;
  return res;
}

export function simulateCities({ seeds, firstSeed = 1 }) {
  const rand = seeded();
  const { ctx, store } = loadCities(rand);
  const { World: W, WorldGen: G, Danger: D } = ctx;
  const founding = [], governors = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    rand.seed(seed * 104729);
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    const field = D.field(gen);
    W.hex = { gen, map: gen.map, danger: field, passes: {} };
    const home = homeward(W, G, gen);
    const cities = foundCities(ctx, gen, field, home, 5);
    founding.push({ seed, cities });
    if (cities[0]) {
      for (const focus of ctx.Governor.FOCUSES) governors.push({ seed, ...governCity(ctx, store, gen, cities[0].at, focus, rand) });
      governors.push({ seed, ...governCity(ctx, store, gen, cities[0].at, 'fire', rand, true) });
    }
  }
  return { founding, governors, seeds };
}

export function citiesTable({ founding, governors, seeds }) {
  const lines = [];
  const nth = (n) => founding.map((f) => f.cities[n]).filter(Boolean);
  const med = (a) => (a.length ? median(a) : null);
  lines.push('| city | seeds that found it | minutes from the town opening (median / max) | beacons raised for it (median) | trek steps (median) | resettled a fallen city |');
  lines.push('|---|---|---|---|---|---|');
  for (let n = 0; n < 4; n++) {
    const c = nth(n);
    const m = c.map((x) => x.minutes);
    lines.push(`| ${['2nd', '3rd', '4th', '5th'][n]} | ${c.length}/${seeds} | ${c.length ? med(m).toFixed(1) + ' / ' + Math.max(...m).toFixed(1) : '-'} | ${med(c.map((x) => x.beacons)) ?? '-'} | ${med(c.map((x) => x.steps)) ?? '-'} | ${c.filter((x) => x.site).length}/${c.length} |`);
  }
  const held = founding.map((f) => 1 + f.cities.filter((c) => c.minutes <= EMBER_MINUTES).length);
  const count = (n) => held.filter((h) => h === n).length;
  lines.push('');
  lines.push(`cities held ${EMBER_MINUTES} minutes after the town opens (the capital included): median ${median(held)}; ` +
    [1, 2, 3, 4, 5, 6].map((n) => `${n}: ${count(n)}`).join(', ') + ` seeds`);
  lines.push('');
  lines.push(`| focus (2nd city, ${GOVERN_TICKS / 360} h) | cities | ticks with a cold hearth | lowest fuel held (fire, median) | buildings built (median) | people at the end (median) |`);
  lines.push('|---|---|---|---|---|---|');
  const foci = [...new Set(governors.map((g) => g.focus))];
  for (const f of foci) {
    const g = governors.filter((x) => x.focus === f);
    lines.push(`| ${f} | ${g.length} | ${g.reduce((a, x) => a + x.cold, 0)} | ${med(g.map((x) => x.lowest)).toFixed(1)} | ${med(g.map((x) => x.built))} | ${med(g.map((x) => x.citizens))} |`);
  }
  return lines.join('\n');
}

// The guards CI holds the cities to (CITY.md: an ember-era empire holds 2-3 small cities): every
// seed founds a 2nd city, 15-25 minutes after the town opens (median); most seeds hold 2-3 cities when
// the ember era ends; no focused city's hearth goes cold in two hours; a flame-era fire city reaches 20 people.
export function checkCities({ founding, governors, seeds }) {
  const fails = [];
  const second = founding.filter((f) => f.cities[0]);
  if (second.length < seeds) fails.push(`only ${second.length}/${seeds} seeds found a 2nd city`);
  const m2 = median(second.map((f) => f.cities[0].minutes));
  if (!(m2 >= 15 && m2 <= 25)) fails.push(`2nd city after ${m2.toFixed(1)} minutes (median), want 15-25`);
  const held = founding.map((f) => 1 + f.cities.filter((c) => c.minutes <= EMBER_MINUTES).length);
  const ok = held.filter((h) => h >= 2 && h <= 3).length;
  if (ok < seeds * 0.8) fails.push(`${ok}/${seeds} seeds hold 2-3 cities at ${EMBER_MINUTES} minutes, want 80%`);
  for (const g of governors) {
    if (g.cold > 0) fails.push(`seed ${g.seed}: a ${g.focus} city's hearth was cold for ${g.cold} ticks`);
  }
  if (!governors.length) fails.push('no governed city');
  // a flame-era fire city grows: its big hearth doesn't eat the wood its houses need (Fire.foundedOut)
  const flame = governors.filter((g) => g.focus.startsWith('fire (flame'));
  const fp = flame.length ? median(flame.map((g) => g.citizens)) : 0;
  if (!(fp >= 20)) fails.push(`the flame-era fire city has ${fp} people after 2 h (median), want 20 or more`);
  return fails;
}

/*
 * City-states (Phase 4, design/drafts/PHASE4.md): on every seed the generator's 64 are placed, then a bot
 * at the ember top (F4 B4 H4, tallow) raises a beacon line from the capital until a lit beacon stands next
 * to the nearest herders, and the influence they gain a minute is worked out with the game's own glow and
 * rate (script/citystates.js). Minutes to win = 100 over that rate, the rival pull of any sphere in reach
 * taken off past 50. The potters get the same line, for the story city-state the generator guarantees.
 */
function lineToward(ctx, gen, field, cs, target, list) {
  const { Fire: F, WorldGen: G, Danger: D } = ctx;
  const danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
  const H = F.HEARTHS.H4;
  const net = { cols: gen.cols, rows: gen.rows, danger, hills: (x, y) => gen.terrain[x][y] === G.TERRAIN.hills,
    hearths: [{ at: gen.capital, out: H.out, share: true, cap: F.FUELS.tallow.cap }], beacons: [], beacon: F.BEACONS.B4 };
  const anchors = new Set(list.map((c) => c.at.join(',')));
  const open = (p) => p[0] >= 0 && p[1] >= 0 && p[0] < gen.cols && p[1] < gen.rows && gen.reachable[p[0] + p[1] * gen.cols] &&
    G.isPassable(gen.map[p[0]][p[1]]) && gen.map[p[0]][p[1]] !== G.TERRAIN.ocean && !anchors.has(p.join(',')) &&
    !(p[0] === gen.capital[0] && p[1] === gen.capital[1]);
  const goals = [0, 1, 2, 3, 4, 5].map((d) => G.neighbour(target.at[0], target.at[1], d)).filter(open);
  if (!goals.length) return null;
  const goal = goals.sort((a, b) => G.distance(a, gen.capital) - G.distance(b, gen.capital))[0];
  let at = gen.capital, r = F.compute(net);
  for (let i = 0; i < 40 && !(at[0] === goal[0] && at[1] === goal[1]); i++) {
    const next = F.around(at[0], at[1], F.HOP).filter((p) => open(p) && !net.beacons.some((b) => b[0] === p[0] && b[1] === p[1]))
      .sort((a, b) => G.distance(a, goal) - G.distance(b, goal))[0];
    if (!next || G.distance(next, goal) >= G.distance(at, goal)) return null;
    net.beacons.push(next);
    r = F.compute(net);
    if (r.nodes[r.nodes.length - 1].s < F.LIT_MIN) return null; // past the fuel's reach
    at = next;
  }
  if (!(at[0] === goal[0] && at[1] === goal[1])) return null;
  const isBeacon = (x, y) => net.beacons.some((b) => b[0] === x && b[1] === y);
  const G0 = cs.glow(r.fire, gen.cols, gen.rows, target.at, isBeacon);
  const S = cs.strength(danger(target.at[0], target.at[1]));
  const T = cs.rateT(target.t, {});
  const rate = cs.perMinute(G0, T, S);
  // the rival spheres in reach pull past 50 (only where no beacon touches does it count in full)
  let pull = 0;
  for (const s of gen.sites) {
    if (s.kind !== 'complex') continue;
    const band = D.band(danger(s.anchor[0], s.anchor[1]));
    if (G.distance(s.anchor, target.at) <= cs.RIVAL_REACH(band)) pull += cs.RIVAL_PULL(band) * 0.5;
  }
  const minutes = rate > pull ? 50 / rate + 50 / (rate - pull) : Infinity;
  return { beacons: net.beacons.length, G: G0, S, rate, pull, minutes, distance: G.distance(target.at, gen.capital) };
}

// The quests (find, clear, meet, fetch) on one world: where each is, how far, whether the wanderer can walk
// there, and where the drifters wander in 500 trek steps (a hex every 50).
function questsOf(ctx, gen, danger, list) {
  const { CityStates: CS, WorldGen: G, Danger: D } = ctx;
  const out = {};
  for (const c of list) {
    const q = CS.questType(c.t);
    if (!q) continue;
    if (q.type === 'meet') {
      let at = c.at.slice(), moves = 0, open = true;
      const me = { ...c, at, land: [at] };
      const others = list.filter((o) => o !== c);
      for (let step = 1; step <= 500; step++) {
        if (step % CS.QUEST.DRIFT_STEPS) continue;
        const to = CS.driftTo(gen, me, others.concat([me]), (step * 0.618) % 1);
        if (!to) continue;
        moves++;
        me.at = to;
        me.land = [to];
        open = open && !!gen.reachable[to[0] + to[1] * gen.cols];
      }
      out[q.type] = { ok: moves > 0 && open, moves, d: G.distance(me.at, c.at) };
      continue;
    }
    const s = CS.questSite(gen, danger, c, list);
    if (!s) { out[q.type] = { ok: false }; continue; }
    const d = G.distance(s.at, c.at);
    const win = { find: CS.QUEST.FIND, clear: CS.QUEST.CLEAR, fetch: CS.QUEST.FETCH }[q.type];
    const r = { ok: !!gen.reachable[s.at[0] + s.at[1] * gen.cols], d, inWindow: d >= win[0] && d <= win[1] };
    if (q.type === 'fetch') r.bandUp = D.band(danger(s.at[0], s.at[1])) >= c.band + 1;
    out[q.type] = r;
  }
  return out;
}

export function simulateCityStates({ seeds, firstSeed = 1 }) {
  const rand = seeded();
  const { ctx } = loadGame(rand);
  const { World: W, WorldGen: G, Danger: D, CityStates: CS } = ctx;
  const out = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    const gen = G.generate(seed, W.generateMap(G.rng(seed)));
    const field = D.field(gen);
    const danger = (x, y) => D.at(field, gen.cols, x, y, 'normal');
    const list = CS.place(gen, danger);
    const by = {};
    list.forEach((c) => { by[c.t] = (by[c.t] || 0) + 1; });
    const reach = (c) => danger(c.at[0], c.at[1]) <= CS.REACH.danger && G.distance(c.at, gen.capital) <= CS.REACH.hexes;
    const nearest = (t) => list.filter((c) => c.t === t).sort((a, b) => G.distance(a.at, gen.capital) - G.distance(b.at, gen.capital))[0];
    // the capital's own hearth (H4, tallow), no beacons: no city-state should glow from it alone
    const { Fire: F } = ctx, H = F.HEARTHS.H4;
    const home = F.compute({ cols: gen.cols, rows: gen.rows, danger, hills: () => false,
      hearths: [{ at: gen.capital, out: H.out, share: true, cap: F.FUELS.tallow.cap }], beacons: [], beacon: F.BEACONS.B4 });
    out.push({
      seed, n: list.length, by, fallen: list.filter((c) => c.site >= 0).length,
      glowFromHome: list.filter((c) => CS.glow(home.fire, gen.cols, gen.rows, c.at, null) > 0).length,
      herdersInReach: list.filter((c) => c.t === 'herders' && reach(c)).length,
      pottersInReach: list.filter((c) => c.t === 'potters' && reach(c)).length,
      herders: lineToward(ctx, gen, field, CS, nearest('herders'), list),
      quests: questsOf(ctx, gen, danger, list),
      potters: lineToward(ctx, gen, field, CS, nearest('potters'), list),
    });
  }
  // the design's feel check and gift example (PHASE4 §2a, §2c), and every wanted good has a value (fixes C13)
  const feel = CS.perMinute(4 * CS.TOUCH, 1.5, 2);
  const gift = CS.giftWorth('herders', {}, { leather: 50 }, 2);
  const unvalued = [];
  for (const t in CS.TEMPERAMENTS) {
    const tt = CS.TEMPERAMENTS[t];
    const all = Array.isArray(tt.wants) ? tt.wants : Object.values(tt.wants).flat();
    const price = tt.price_pool.flatMap((p) => Object.keys(p.base || p.fixed || {}));
    for (const g of all.concat(price)) {
      for (const k of g === 'weapons' ? CS.WEAPONS : [g]) if (!(CS.VALUES[k] > 0) && !unvalued.includes(k)) unvalued.push(k);
    }
  }
  return { out, seeds, feel, gift, unvalued, CS };
}

export function cityStatesTable({ out, seeds, feel, gift, unvalued, CS }) {
  const lines = [];
  const med = (a) => (a.length ? median(a) : null);
  const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number.isFinite(v) ? v.toFixed(d) : 'never');
  lines.push(`placed: ${out.map((o) => o.n).join(', ')} city-states; fallen cities resettled by them (median) ${med(out.map((o) => o.fallen))}; ` +
    `herders inside the ember reach (min) ${Math.min(...out.map((o) => o.herdersInReach))}; potters inside it ${out.filter((o) => o.pottersInReach).length}/${seeds} seeds`);
  lines.push('');
  lines.push('| won by influence | seeds lined | hexes from the capital (median) | beacons (median) | glow G (median) | S (median) | influence / min (median) | rival pull / min past 50 (median) | minutes to 100 (median / max) |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const k of ['herders', 'potters']) {
    const r = out.map((o) => o[k]).filter(Boolean);
    const m = r.map((x) => x.minutes);
    lines.push(`| nearest ${k} | ${r.length}/${seeds} | ${med(r.map((x) => x.distance)) ?? '-'} | ${med(r.map((x) => x.beacons)) ?? '-'} | ${fmt(med(r.map((x) => x.G)))} | ${med(r.map((x) => x.S)) ?? '-'} | ${fmt(med(r.map((x) => x.rate)), 2)} | ${fmt(med(r.map((x) => x.pull)), 2)} | ${fmt(med(m))} / ${fmt(m.length ? Math.max(...m) : null)} |`);
  }
  lines.push('');
  const qs = (k, f) => out.filter((o) => o.quests[k] && f(o.quests[k])).length;
  lines.push(`quests, of ${seeds} seeds: find placed ${qs('find', (q) => q.ok && q.inWindow)} (4-8 hexes); clear ${qs('clear', (q) => q.ok && q.inWindow)} (2-4); ` +
    `fetch ${qs('fetch', (q) => q.ok)}, inside 6-20 hexes ${qs('fetch', (q) => q.inWindow)}, a band above them ${qs('fetch', (q) => q.bandUp)}; ` +
    `the drifters moved in 500 steps ${qs('meet', (q) => q.ok)} (median ${median(out.map((o) => o.quests.meet.moves))} hexes)`);
  lines.push('');
  lines.push(`the design's example (herders, S=2, touched by a G=4 line) at RATE ${CS.RATE}: ${feel.toFixed(2)} / min, ~${(100 / feel).toFixed(0)} min; 50 leather to them: +${gift.toFixed(1)}; goods with no gift value: ${unvalued.length ? unvalued.join(', ') : 'none'}`);
  return lines.join('\n');
}

// The guards CI holds the city-states to: 64 placed with every story one and the guarantees, every wanted
// good valued, the design's feel check and gift example, and the nearest herders won by influence on every seed.
export function checkCityStates({ out, seeds, feel, gift, unvalued, CS }) {
  const fails = [];
  for (const o of out) {
    if (o.n !== 64) fails.push(`seed ${o.seed}: ${o.n} city-states placed, want 64`);
    for (const t in CS.TEMPERAMENTS) if (CS.TEMPERAMENTS[t].kind === 'story' && o.by[t] !== 1) fails.push(`seed ${o.seed}: ${o.by[t] || 0} ${t}`);
    if (o.herdersInReach < 2) fails.push(`seed ${o.seed}: ${o.herdersInReach} herders inside the ember reach, want 2`);
    for (const k of ['find', 'clear', 'meet', 'fetch']) {
      const q = o.quests[k];
      if (!q || !q.ok) fails.push(`seed ${o.seed}: the ${k} quest has no place the wanderer can reach`);
      else if (k !== 'meet' && k !== 'fetch' && !q.inWindow) fails.push(`seed ${o.seed}: the ${k} quest is ${q.d} hexes from them`);
    }
    if (o.glowFromHome) fails.push(`seed ${o.seed}: ${o.glowFromHome} city-states glow from the capital's hearth alone, want a beacon line to each`);
    if (o.pottersInReach !== 1) fails.push(`seed ${o.seed}: the potters are not inside the ember reach`);
    if (!o.herders) fails.push(`seed ${o.seed}: no beacon line reaches the nearest herders`);
    else if (!Number.isFinite(o.herders.minutes)) fails.push(`seed ${o.seed}: the nearest herders can't be won by influence (rate ${o.herders.rate.toFixed(2)}, pull ${o.herders.pull.toFixed(2)})`);
  }
  // the approved feel check: ~17 minutes for the easy first win (RATE is tuned to it)
  const m = median(out.filter((o) => o.herders).map((o) => o.herders.minutes));
  if (!(m >= 12 && m <= 25)) fails.push(`nearest herders won by an ember line in ${m.toFixed(1)} minutes (median), want ~17 (12-25)`);
  if (Math.abs(gift - 25) > 1e-9) fails.push(`50 leather to herders worth ${gift}, want 25`);
  if (unvalued.length) fails.push(`no gift value for ${unvalued.join(', ')}`);
  return fails;
}

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export function table({ results }, seeds) {
  const lines = [];
  lines.push('| difficulty | band | danger | seeds reaching | steps to reach (median) | trek reached (median) | treks entering | deaths | death rate | loot / 100 steps |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const diff in results) {
    const r = results[diff];
    r.bands.forEach((b, i) => {
      lines.push(`| ${diff} | ${i} | ${i * 2}-${i * 2 + 2} | ${b.seedsReached}/${seeds} | ${median(b.firstSteps) ?? '-'} | ${median(b.firstTrek) ?? '-'} | ${b.entries} | ${b.deaths} | ${b.entries ? (100 * b.deaths / b.entries).toFixed(1) + '%' : '-'} | ${b.steps ? (100 * b.loot / b.steps).toFixed(1) : '-'} |`);
    });
  }
  lines.push('');
  lines.push('| difficulty | treks | deaths | death rate | packs dropped | packs recovered | recovery rate | share left when recovered |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const diff in results) {
    const r = results[diff], p = r.packs;
    lines.push(`| ${diff} | ${r.treks} | ${r.deaths} | ${(100 * r.deaths / r.treks).toFixed(1)}% | ${p.dropped} | ${p.recovered} | ${p.dropped ? (100 * p.recovered / p.dropped).toFixed(0) + '%' : '-'} | ${p.recovered ? (100 * p.share / p.recovered).toFixed(0) + '%' : '-'} |`);
  }
  return lines.join('\n');
}

// The guards CI holds the curve to.
export function check({ results, curve }) {
  const fails = [];
  for (const c of curve) {
    // mean danger per 5-hex ring rises (within a hair, for the pockets) out to the heart's distance
    for (let i = 1; i < Math.min(c.rings.length, c.heartRing); i++) {
      // (near the heart the curve tops out at 10, where a pocket or the map's edge can dent the mean)
      if (c.rings[i] !== null && c.rings[i - 1] !== null && c.rings[i - 1] < 9.5 && c.rings[i] < c.rings[i - 1] - 0.15) {
        fails.push(`seed ${c.seed}: danger falls from ring ${i - 1} (${c.rings[i - 1].toFixed(2)}) to ring ${i} (${c.rings[i].toFixed(2)})`);
      }
    }
  }
  const rate = (d) => results[d].deaths / results[d].treks;
  if (!(rate('gentle') < rate('normal') && rate('normal') < rate('harsh'))) {
    fails.push(`death rates not gentle < normal < harsh: ${['gentle', 'normal', 'harsh'].map((d) => rate(d).toFixed(3)).join(', ')}`);
  }
  // band 1 with the first kit (a cask) at normal and harsh; gentle pushes it out, the second kit gets there
  for (const d in results) {
    const m = median(results[d].bands[1].firstTrek), most = d === 'gentle' ? 2 * TREKS_PER_KIT : TREKS_PER_KIT;
    if (m === null || m > most) fails.push(`${d}: band 1 first reached on trek ${m}, want by trek ${most}`);
  }
  return fails;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? Number(process.argv[i + 1]) : dflt;
  };
  const ci = process.argv.includes('--ci');
  const seeds = arg('seeds', ci ? 6 : 30), treks = arg('treks', KITS.length * TREKS_PER_KIT);
  const t0 = Date.now();
  const run = simulate({ seeds, treks });
  console.log(`${seeds} seeds x ${treks} treks per difficulty, kits change every ${TREKS_PER_KIT} treks: ${KITS.map((k) => k.name).join(' / ')}\n`);
  console.log(table(run, seeds));
  const fire = simulateFire({ seeds });
  console.log(`\nThe fire network, ${seeds} seeds, normal difficulty: six beacon lines from the capital\n`);
  console.log(fireTable(fire));
  const cities = simulateCities({ seeds });
  console.log(`\nCities, ${seeds} seeds, normal difficulty, ember tiers at the top (F4 B4 H4)\n`);
  console.log(citiesTable(cities));
  const states = simulateCityStates({ seeds });
  console.log(`\nCity-states, ${seeds} seeds, normal difficulty, a beacon line at the ember top (F4 B4 H4)\n`);
  console.log(cityStatesTable(states));
  const armies = simulateArmies({ seeds });
  console.log(`\nArmies and sieges, ${seeds} seeds, normal difficulty, a beacon line at the ember top (F4 B4 H4)\n`);
  console.log(armiesTable(armies));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (ci) {
    const fails = check(run).concat(checkFire(fire), checkCities(cities), checkCityStates(states), checkArmies(armies));
    if (fails.length) {
      console.error('\nFAIL\n' + fails.join('\n'));
      process.exit(1);
    }
    console.log('\nall curve checks pass');
  }
}
