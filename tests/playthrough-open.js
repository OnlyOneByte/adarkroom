// SPDX-License-Identifier: MIT
// Opens the game for the playthrough on a fake clock (time runs only when a stage runs it forward), fresh or
// from a save (the dev harness resumes from checkpoints this way; the spec always starts fresh).
import { openGame } from './helpers.js';

export async function openPlay(page, save) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.addInitScript(() => {
    window.__t0 = Date.now();
    // the trek's fights and the room's random events: one fixed stream, so every run plays the same game
    let s = 4242;
    Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    // the world: seed 4242, as the other suites (set before the compass makes it)
    let wg;
    Object.defineProperty(window, 'WorldGen', {
      configurable: true,
      get: () => wg,
      set: (v) => { wg = v; v.newSeed = () => 4242; },
    });
  });
  const errors = await openGame(page, save ? { save } : {});
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  // a game timer that throws while the clock runs (an error the player would see in the console): recorded
  // with the rest of the page's errors, and the clock carries on
  const run = page.clock.runFor.bind(page.clock);
  page.clock.runFor = async (ms) => {
    try {
      return await run(ms);
    } catch (e) {
      errors.push(`timer: ${String(e.message).split('\n').slice(0, 6).join(' | ')}`);
      return undefined;
    }
  };
  await page.evaluate(installQa);
  return errors;
}

// The player's map sense, in the page: the way to a hex over ground the wanderer can enter, round landmarks
// (stepping on one starts its scene), other homes (stepping on one ends the trek) and city-states' hearths.
// The trek itself is still World.move, one step at a time.
function installQa() {
  window.__qa = {
    // a hex the way must not cross (the goal itself only needs to be enterable)
    blocked: (x, y, goal, avoid) => {
      const t = World.state.map[x][y];
      if (goal) return !World.canEnter(t);
      if (!World.canEnter(t)) return true;
      // a waystation is on the way (its well refills the water); other landmarks start their scenes
      if (t === World.TILE.VILLAGE || (World.LANDMARKS[t] && t !== World.TILE.OUTPOST)) return true;
      if (avoid.some((a) => a[0] === x && a[1] === y)) return true;
      const c = typeof CityStates != 'undefined' && CityStates.landAt(x, y);
      return !!c && c.at[0] === x && c.at[1] === y;
    },
    // the first step (a hex direction) of a shortest way from the wanderer to any of goals; -1 no way,
    // -2 not on a trek, -3 already there
    step: (goals, avoid) => {
      if (!World.state) return -2;
      const cols = World.cols(), rows = World.rows(), start = World.curPos.slice();
      const isGoal = (x, y) => goals.some((g) => g[0] === x && g[1] === y);
      if (isGoal(start[0], start[1])) return -3;
      // the fewest moves (rough ground costs two, as it eats twice): buckets by cost, cheap hexes first
      const prev = new Int32Array(cols * rows).fill(-1), dirOf = new Int8Array(cols * rows), cost = new Int32Array(cols * rows).fill(1e9);
      const k0 = start[0] + start[1] * cols;
      prev[k0] = k0;
      cost[k0] = 0;
      const buckets = [[start]];
      for (let c0 = 0; c0 < buckets.length; c0++) {
        const q = buckets[c0] || [];
        for (let i = 0; i < q.length; i++) {
          const [x, y] = q[i], k1 = x + y * cols;
          if (cost[k1] !== c0) continue;
          if (k1 !== k0 && isGoal(x, y)) {
            let c = k1;
            while (prev[c] !== k0) c = prev[c];
            return dirOf[c];
          }
          for (let d = 0; d < 6; d++) {
            const n = WorldGen.neighbour(x, y, d), k = n[0] + n[1] * cols;
            if (n[0] < 0 || n[1] < 0 || n[0] >= cols || n[1] >= rows) continue;
            const goal = isGoal(n[0], n[1]);
            if (__qa.blocked(n[0], n[1], goal, avoid)) continue;
            const nc = c0 + World.moveCost(World.state.map[n[0]][n[1]]);
            if (nc >= cost[k]) continue;
            cost[k] = nc;
            prev[k] = k1;
            dirOf[k] = d;
            (buckets[nc] = buckets[nc] || []).push(n);
          }
        }
      }
      return -1;
    },
    // a district of this type put down for a city where the land box offers it (Network.placeDistrict is the
    // box's button), nearest its hearth first, or near a hex if given. Returns the hex or null
    district: (cityId, type, near) => {
      const c = $SM.get('game.cities["' + cityId + '"]'), at = near || c.hex;
      const hexes = Fire.around(c.hex[0], c.hex[1], District.MAX_RING)
        .filter((p) => Network.districtsFor(cityId, p[0], p[1]).includes(type))
        .sort((a, b) => Fire.distance(a, at) - Fire.distance(b, at));
      for (const p of hexes) if (Network.placeDistrict(cityId, p[0], p[1], type)) return p;
      return null;
    },
    // beacons raised one after another toward a hex, each where the land box offers one (Network.raiseBeacon
    // is its button) and the fire then reaches it; the hex nearest the goal first. Stops when one stands within
    // `within` of the goal, or no beacon gets nearer. Returns how near the line got.
    beaconsToward: (goal, within = 1, max = 60) => {
      const lit = (p) => World.hex.fire.nodes.some((n) => !n.hearth && n.at[0] === p[0] && n.at[1] === p[1] && n.s >= Fire.LIT_MIN);
      const near = () => Math.min(...World.hex.fire.nodes.filter((n) => n.hearth || n.s >= Fire.LIT_MIN).map((n) => Fire.distance(n.at, goal)));
      for (let i = 0; i < max && near() > within; i++) {
        const best = near(), gen = World.hex.gen, cands = [];
        World.hex.fire.nodes.filter((n) => n.hearth || n.s >= Fire.LIT_MIN).forEach((n) => {
          Fire.around(n.at[0], n.at[1], Fire.hop(Fire.BEACONS[Network.beaconTier()])).forEach((p) => {
            if (Fire.distance(p, goal) < best && Network.canBeacon(p[0], p[1])) cands.push(p);
          });
        });
        cands.sort((a, b) => Fire.distance(a, goal) - Fire.distance(b, goal));
        let done = false;
        for (const p of cands) {
          if (!Network.raiseBeacon(p[0], p[1])) continue;
          if (lit(p)) { done = true; break; }
          Network.putOut(p[0], p[1]); // dark: the player takes it down again
        }
        if (!done) break;
      }
      return near();
    },
    // our homes on the map (the capital and every city of ours)
    homes: () => {
      const out = [], m = World.state ? World.state.map : World.hex.map;
      for (let x = 0; x < m.length; x++) for (let y = 0; y < m[x].length; y++) if (m[x][y] === World.TILE.VILLAGE) out.push([x, y]);
      return out;
    },
  };
}
