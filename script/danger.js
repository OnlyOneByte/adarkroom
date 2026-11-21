/**
 * The difficulty curve: one danger score per hex, 0-10 (DESIGN.md "Difficulty curve").
 *
 * Danger rises with distance from the capital, with the wastes around a hex and
 * with nearness to the war's heart; craters and old-world complexes are hotspots
 * and a few pockets are safer. Everything that scales with difficulty reads it:
 * encounter tier, strength and frequency, loot, the scavengers at a dropped pack.
 *
 * Pure functions and data only (no DOM, no state): the generator, World and the
 * balance simulator (tools/sim.js) all load this file.
 *
 * Every number marked provisional was picked with the simulator (npm run sim).
 */
var Danger = {
	MAX: 10,
	BAND_SIZE: 2,           // provisional: bands are 0-2, 2-4, 4-6, 6-8, 8-10
	BANDS: 5,

	// provisional: the whole curve scales by the game's difficulty
	DIFFICULTY: { gentle: 0.8, normal: 1, harsh: 1.25 },
	DEFAULT_DIFFICULTY: 'normal',

	// provisional weights
	HEART_RADIUS: 20,       // the heart's own pull, in hexes
	HEART_WEIGHT: 1.5,
	WASTES_RADIUS: 2,       // wastes counted around a hex
	WASTES_WEIGHT: 1.5,
	SPIKE: { crater: 2.5, complex: 2.5 },   // on a site's own hexes
	SPIKE_REACH: 2,         // hexes past a site's edge where its spike fades out
	POCKETS: 6,
	POCKET_RADIUS: 6,
	POCKET_DEPTH: 3,

	// Distance alone, 0-1: 1 at the heart's distance. provisional: the 0.7 puts band 1 at about
	// 12 hexes out, band 2 at 30, band 3 at 55, band 4 at 85 (for a heart 115 hexes away)
	gradient: function (dCap, reach) {
		return Math.pow(Math.min(1, dCap / reach), 0.7);
	},

	// How scarred the ground is, 0-1, for the generator's wastes: distance, a lean toward the heart, less in a pocket.
	threat: function (dCap, reach, dHeart, pocket) {
		var t = 0.8 * Danger.gradient(dCap, reach) + 0.2 * Math.max(0, 1 - dHeart / reach) - 0.3 * pocket;
		return Math.max(0, Math.min(1, t));
	},

	// The generator's wastes go where its scar noise (0.25-0.75 for nearly every hex) is under this line:
	// none until threat 0.35, then more and more, all of it at 1. provisional
	scarLine: function (threat) {
		return 0.25 + 0.5 * Math.pow(Math.max(0, Math.min(1, (threat - 0.35) / 0.65)), 1.5);
	},

	// The safer pockets: seeded, away from home and from the heart.
	pockets: function (seed, cols, rows, cap, heart, distance) {
		var r = WorldGen.rng(seed ^ 0xDA9E), out = [];
		for (var tries = 0; out.length < Danger.POCKETS && tries < 500; tries++) {
			var p = [Math.floor(r() * cols), Math.floor(r() * rows)];
			if (distance(p, cap) < 25 || distance(p, heart) < 15) continue;
			out.push(p);
		}
		return out;
	},

	// 0-1: how deep inside a pocket a hex is
	pocketAt: function (pockets, x, y, distance) {
		var v = 0;
		for (var i = 0; i < pockets.length; i++) {
			v = Math.max(v, 1 - distance([x, y], pockets[i]) / Danger.POCKET_RADIUS);
		}
		return v;
	},

	/*
	 * The danger of every hex at normal difficulty, Float32Array(cols*rows).
	 * Built from a generated world (WorldGen.generate); not saved, rebuilt on load.
	 */
	field: function (gen) {
		var G = WorldGen, cols = gen.cols, rows = gen.rows, n = cols * rows;
		var cap = gen.capital, heart = gen.warHeart, reach = G.distance(cap, heart);
		var out = new Float32Array(n);
		var inside = function (x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; };

		// hotspots: each crater and complex hex, then 60% fading to nothing over SPIKE_REACH hexes
		var spike = new Float32Array(n), src = new Float32Array(n), dist = new Int16Array(n).fill(-1), queue = [];
		gen.sites.forEach(function (s) {
			var v = Danger.SPIKE[s.kind];
			// the garrison of the deep mines is old-world, but low-tech (POWERS §3: danger 2-4): no spike
			if (!v || s.garrison) return;
			s.hexes.forEach(function (h) {
				var k = h[0] + h[1] * cols;
				spike[k] = src[k] = v;
				dist[k] = 0;
				queue.push(k);
			});
		});
		for (var qi = 0; qi < queue.length; qi++) {
			var k = queue[qi], kx = k % cols, ky = (k - kx) / cols;
			if (dist[k] >= Danger.SPIKE_REACH) continue;
			for (var d = 0; d < 6; d++) {
				var nb = G.neighbour(kx, ky, d), nk = nb[0] + nb[1] * cols;
				if (!inside(nb[0], nb[1]) || dist[nk] >= 0) continue;
				dist[nk] = dist[k] + 1;
				src[nk] = src[k];
				spike[nk] = src[k] * 0.6 * (1 - dist[nk] / (Danger.SPIKE_REACH + 1));
				queue.push(nk);
			}
		}

		var wastes = G.TERRAIN.wastes, R = Danger.WASTES_RADIUS;
		for (var y = 0; y < rows; y++) {
			for (var x = 0; x < cols; x++) {
				var count = 0, total = 0;
				for (var dy = -R; dy <= R; dy++) {
					for (var dx = -R - 1; dx <= R + 1; dx++) {
						var hx = x + dx, hy = y + dy;
						if (!inside(hx, hy) || G.distance([x, y], [hx, hy]) > R) continue;
						total++;
						if (gen.terrain[hx][hy] === wastes) count++;
					}
				}
				var dHeart = G.distance([x, y], heart);
				var v = Danger.MAX * Danger.gradient(G.distance([x, y], cap), reach) +
					Danger.HEART_WEIGHT * Math.pow(Math.max(0, 1 - dHeart / Danger.HEART_RADIUS), 2) +
					Danger.WASTES_WEIGHT * count / total +
					spike[x + y * cols] -
					Danger.POCKET_DEPTH * Danger.pocketAt(gen.pockets, x, y, G.distance);
				out[x + y * cols] = Math.max(0, Math.min(Danger.MAX, v));
			}
		}
		// home is safe
		out[cap[0] + cap[1] * cols] = 0;
		return out;
	},

	// the danger at a hex for a difficulty
	at: function (field, cols, x, y, difficulty) {
		var m = Danger.DIFFICULTY[difficulty] || 1;
		return Math.min(Danger.MAX, field[x + y * cols] * m);
	},

	band: function (danger) {
		return Math.min(Danger.BANDS - 1, Math.floor(danger / Danger.BAND_SIZE));
	},

	// The prologue picks encounters by distance (tier 1 to 10, tier 2 to 20, tier 3 past it);
	// on the hex map danger stands in for that distance. provisional: tier 2 from danger 2, tier 3
	// from 3.2, which is about where the prologue had them (10 and 20 hexes out)
	encounterDistance: function (danger) {
		if (danger < 2) return danger / 2 * 10;
		if (danger < 3.2) return 10 + (danger - 2) / 1.2 * 10;
		return 20 + (danger - 3.2) * 2;
	},

	// provisional: past the near wastes enemies hit harder and last longer, x1.7 at 10
	strength: function (danger) {
		return 1 + 0.1 * Math.max(0, danger - 3);
	},

	// provisional: the chance of a fight per step, 0.12 at home, the prologue's 0.20 at 5, 0.28 at 10
	fightChance: function (danger) {
		return 0.2 * (0.6 + 0.08 * danger);
	},

	// provisional: loot grows with danger past the near wastes, x1.7 at 10
	lootScale: function (danger) {
		return 1 + 0.1 * Math.max(0, danger - 3);
	},

	// provisional: share of a dropped pack scavengers take per step the wanderer walks, 0.5% at home to
	// 2% at 10; a pack reached on the next trek still holds 40-50% (npm run sim)
	scavengeRate: function (danger) {
		return 0.005 + 0.0015 * danger;
	}
};
