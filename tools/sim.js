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
 * The bot: each trek it walks the cheapest way toward a target (a random hex in the
 * outer half of what its water can reach there and back, or its dropped pack) and turns home when
 * the water or food left would only just get it back. Its kit improves every
 * TREKS_PER_KIT treks, like the range upgrades the player builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

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

function loadGame(rand) {
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
  for (const f of ['script/danger.js', 'script/worldgen.js', 'script/world.js', 'script/events/encounters.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('World.setupLandmarks();', ctx);
  return { ctx, store };
}

// a reseedable stream shared by the bot and the game's tables
function seeded() {
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
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (ci) {
    const fails = check(run);
    if (fails.length) {
      console.error('\nFAIL\n' + fails.join('\n'));
      process.exit(1);
    }
    console.log('\nall curve checks pass');
  }
}
