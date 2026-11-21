// SPDX-License-Identifier: MIT
/*
 * A late-game state for the benchmark (tools/bench.js), built on a world whose hex map is open.
 *
 * Runs against the game's own globals (World, City, Network, Fire, District, WorldGen, $SM), so the
 * same function builds the state in the Node vm and, passed to page.evaluate, in the real page.
 * It must stay self-contained: no imports, nothing from the enclosing module.
 *
 *   cities    city-states held, the capital included, at least MIN_GAP hexes apart
 *   beacons   beacons raised, each Fire.HOP from a hearth or beacon, only where the fuel's fire reaches
 *   era       'ember' (default), 'flame' or 'blaze': which eras' tiers are in
 * Every hex is seen, every tier of the era is in, each city has up to 14 districts with their buildings
 * filled, its citizens housed and at work, and a hearth burning a stand-in late fuel.
 */
export function synth({ cities: nCities = 64, beacons: nBeacons = 500, seed = 7, era = 'ember' } = {}) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const MIN_GAP = 8, MAX_DISTRICTS = 14;
  const gen = World.hex.gen, cols = gen.cols, rows = gen.rows, map = World.hex.map, mask = World.hex.mask;
  const key = (x, y) => x + ',' + y;

  // the whole map seen
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) mask[x][y] = true;

  // every tier of the era and every story beat behind them
  const tiers = {};
  Fire.TIERS.forEach((t) => { if (t.n <= ({ flame: 8, blaze: 12 }[era] || 4)) tiers[t.id] = true; });
  // shortcut: only the ember, flame and blaze fuels have numbers yet, and their lines stop at danger 9 at
  // most. A late-game empire burns the old fire (F16), so it gets stand-in numbers here that reach
  // every danger; drop this once the later fuels are in Fire.FUELS.
  if (!Fire.FUELS['the old fire']) Fire.FUELS['the old fire'] = { tier: 'F16', fire: 4, burn: 2, cap: Danger.MAX };
  tiers.F16 = true;
  const FUEL = 'the old fire';
  $SM.set('game.network.tiers', tiers, true);
  $SM.set('game.network.story', {
    stoneHearth: true, brazier: true, firstBrazier: true, trekHome: true, cairnTold: true, cairnStudied: true, cairnDone: true,
  }, true);
  $SM.set('game.world.axeHead', true, true);
  const cap = Fire.FUELS[FUEL].cap;

  const open = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows &&
    WorldGen.isPassable(map[x][y]) && map[x][y] !== WorldGen.TERRAIN.ocean;
  const groundOk = (x, y) => open(x, y) && gen.reachable[x + y * cols] && WorldGen.isTerrain(map[x][y]) &&
    !World.siteAt(x, y) && District.land({ terrain: Network.terrainKey(x, y) });

  // the cities: the capital, then sites spread over the land
  const STOCK = { wood: 5000, 'dry wood': 2000, oak: 1000, 'seasoned oak': 1000, tallow: 5000, 'the old fire': 100000, fur: 2000, meat: 2000, leather: 500, 'cured meat': 500, bait: 200 };
  const sites = [gen.capital.slice()];
  const candidates = [];
  for (let x = 2; x < cols - 2; x++) for (let y = 2; y < rows - 2; y++) if (groundOk(x, y)) candidates.push([x, y]);
  shuffle(candidates);
  for (const p of candidates) {
    if (sites.length >= nCities) break;
    if (sites.every((s) => Fire.distance(s, p) >= MIN_GAP)) sites.push(p);
  }

  const PREFER = ['huts', 'woods', 'hunting grounds', 'tannery row', 'burning pits', 'walls'];
  const WANT = { huts: 4, woods: 3, 'hunting grounds': 2, 'tannery row': 1, 'burning pits': 2, walls: 2 };
  let districts = 0, citizens = 0;
  sites.forEach((at, i) => {
    const id = i === 0 ? City.CAPITAL : 'city' + i;
    if (i > 0) City.createCity(id, 'city ' + i);
    const d = {};
    d[key(at[0], at[1])] = District.HEARTH;
    $SM.setM('game.cities["' + id + '"]', { hex: at.slice(), districts: d, hearth: { fuel: FUEL, out: 24, stored: 32, fed: 0 } }, true);
    const rec = $SM.get('game.cities["' + id + '"]');
    Network.refresh(); // its hearth lights the ground its districts go on
    // districts ring by ring, each the most wanted type the ground takes
    const have = {};
    for (let r = 1; r <= 2; r++) {
      for (const p of Fire.ring(at[0], at[1], r)) {
        if (Object.keys(rec.districts).length >= MAX_DISTRICTS) break;
        const fits = Network.districtsFor(id, p[0], p[1]);
        const pick = PREFER.find((t) => fits.indexOf(t) >= 0 && (have[t] || 0) < WANT[t]) || PREFER.find((t) => fits.indexOf(t) >= 0);
        if (!pick) continue;
        rec.districts[key(p[0], p[1])] = pick;
        have[pick] = (have[pick] || 0) + 1;
      }
    }
    districts += Object.keys(rec.districts).length;
    // every building it has room for, every house full, every job worked
    for (const b in City.Buildings) {
      const n = City.maximum(b, id);
      if (n > 0) rec.buildings[b] = n;
    }
    const people = City.getMaxCitizens(id);
    rec.population.citizens = people;
    citizens += people;
    const jobs = [];
    for (const b in rec.buildings) (City.Buildings[b].jobs || []).forEach((j) => jobs.push(j));
    for (const j in City._INCOME) if (City._INCOME[j].raw && jobs.indexOf(j) < 0) jobs.push(j);
    let left = people;
    jobs.forEach((j) => {
      const n = Math.min(left, City.jobSlots(id, j), Math.ceil(people / 6));
      if (n > 0) {
        rec.workers[j] = n;
        left -= n;
      }
    });
    if (i === 0) $SM.setM('stores', STOCK, true);
    else rec.stores = Object.assign({}, STOCK);
  });

  // the beacons: grown out from the hearths, a hop at a time, where tallow's fire can still go
  const taken = {}, nodes = sites.slice();
  sites.forEach((s, i) => {
    const rec = $SM.get('game.cities["' + (i === 0 ? City.CAPITAL : 'city' + i) + '"]');
    for (const k in rec.districts) taken[k] = true;
  });
  const beacons = {};
  let placed = 0;
  for (let tries = 0; placed < nBeacons && tries < nBeacons * 400; tries++) {
    const from = nodes[Math.floor(rand() * nodes.length)];
    const ring = Fire.ring(from[0], from[1], Fire.HOP);
    const p = ring[Math.floor(rand() * ring.length)];
    if (!open(p[0], p[1]) || taken[key(p[0], p[1])] || World.baseDangerAt(p[0], p[1]) > cap) continue;
    if (nodes.some((n) => Fire.distance(n, p) < 2)) continue;
    beacons[key(p[0], p[1])] = true;
    taken[key(p[0], p[1])] = true;
    nodes.push(p);
    placed++;
  }
  $SM.set('game.network.beacons', beacons, true);

  City.updateIncome();
  Network.refresh();
  const fire = World.hex.fire;
  let lit = 0, land = 0;
  for (let k = 0; k < fire.lit.length; k++) {
    const x = k % cols, y = (k - x) / cols;
    if (open(x, y)) land++;
    if (fire.lit[k]) lit++;
  }
  return {
    hexes: cols * rows, land, cities: sites.length, districts, citizens, beacons: placed,
    beaconsLit: fire.nodes.filter((n) => !n.hearth && n.s >= Fire.LIT_MIN).length,
    lit, litShare: lit / land, incomeSources: Object.keys($SM.get('income') || {}).length,
  };
}
