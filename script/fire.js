/**
 * The fire is the network (DESIGN.md "Economy core", design/LADDERS.md, design/CITY.md).
 *
 * Hearths make fire from fuel; beacons on hexes relay it, keeping a share per hop; a hex is
 * lit while fire >= 1 reaches it, and lit land is one band of danger safer. Three ladders
 * climb together: fuel (how far into danger a line reaches), beacons (hops and loss per hop)
 * and hearths (output, storage, sharing). Each caps its own part, so a line works at the
 * lowest of the three.
 *
 * Pure functions and data only (no DOM, no state): the game (script/network.js) and the
 * balance simulator (tools/sim.js) both load this file.
 *
 * Every number marked provisional is the starting value from design/CITY.md, checked with
 * the simulator (npm run sim).
 */
var Fire = {
	ERAS: ['ember', 'flame', 'blaze', 'old fire'],
	LADDERS: ['fuel', 'beacon', 'hearth'],

	/*
	 * All 48 tiers, 16 per ladder in 4 eras. Fields:
	 *   id      F1-F16, B1-B16, H1-H16
	 *   ladder  'fuel' | 'beacon' | 'hearth'
	 *   era     one of Fire.ERAS
	 *   n       1-16 within its ladder
	 *   name    display name
	 *   beat    the story beat that unlocks it
	 *   story   true for a fixed story event (LADDERS.md ⚑), false for a play milestone
	 *   chain   the story chain it belongs to, if any
	 *   when    the unlock condition hook, a key of Network.UNLOCKS; null = not wired yet
	 * The ember, flame and blaze eras are wired; the old fire is data waiting for its story.
	 */
	TIERS: [],

	// provisional (CITY.md for the ember era; the flame and blaze eras sim-tuned, design/text/flame-build.md,
	// design/text/blaze-build.md): what each tier does. The old fire gets its numbers as it is built.
	// fuel: fire per unit, burn time in fire ticks, the danger its line can push into;
	// holds: the ground it reaches further into (Fire.SWAMP, JUNGLE, HILLS, DESERT, COAST, TUNDRA bits), wet: how far
	FUELS: {
		'wood':         { tier: 'F1', fire: 1,   burn: 1, cap: 1 },
		'dry wood':     { tier: 'F2', fire: 1.5, burn: 1, cap: 1.5 },
		'seasoned oak': { tier: 'F3', fire: 2,   burn: 1, cap: 2 },
		'tallow':       { tier: 'F4', fire: 2,   burn: 2, cap: 2.5 },
		'charcoal':     { tier: 'F5', fire: 4,   burn: 1, cap: 3.25 },
		'peat':         { tier: 'F6', fire: 2.5, burn: 2, cap: 3.5,  holds: 1, wet: 5.5 },
		'resin':        { tier: 'F7', fire: 4,   burn: 1, cap: 4,    holds: 2, wet: 6 },
		'coal':         { tier: 'F8', fire: 5,   burn: 2, cap: 6 },
		'coke':         { tier: 'F9', fire: 6,   burn: 2, cap: 6.1,  holds: 16,  wet: 7.25 },
		'pitch':        { tier: 'F10', fire: 5,  burn: 3, cap: 6.2,  holds: 32,  wet: 7.5 },
		'whale oil':    { tier: 'F11', fire: 6,  burn: 3, cap: 6.3,  holds: 128, wet: 7.75 },
		'rock oil':     { tier: 'F12', fire: 8,  burn: 3, cap: 8,    holds: 64,  wet: 9 }
	},
	// beacon: the share of fire kept per hop; hills: a beacon on hills carries one hop further.
	// hops is CITY.md's table, how far a line from a stone hearth (16) carries: it isn't a cap,
	// it falls out of keep and Fire.RELAY_MIN, so a stronger hearth carries further.
	// road: the share kept on a hop that runs all along a road (B6 on); water: lines cross lake
	// hexes (B7 on); marsh: no extra loss over swamps (B8); plain: the share kept on a hop over open
	// flat ground only (B9 on, the mirrors' daylight relay); pass: the share kept on a hop through a
	// mountain pass (B10 on); sea: lines cross an inland sea, and beacons stand in its shallows (B11 on);
	// hop: how far apart two nodes can link (Fire.HOP unless set: the heliograph's long sight lines)
	BEACONS: {
		B1: { name: 'brazier',        hops: 2, keep: 0.5,  hills: false, cost: { wood: 20 } },
		B2: { name: 'torch-post',     hops: 2, keep: 0.6,  hills: false, cost: { wood: 20 } },
		B3: { name: 'cairn fire',     hops: 3, keep: 0.65, hills: false, cost: { wood: 20 } },
		B4: { name: 'watch fire',     hops: 3, keep: 0.7,  hills: true,  cost: { wood: 20 } },
		B5: { name: 'watchtower',     hops: 4, keep: 0.75, hills: true,  cost: { wood: 40 } },
		B6: { name: 'lamp-post',      hops: 4, keep: 0.75, hills: true,  road: 0.95, cost: { wood: 40 } },
		B7: { name: 'ford light',     hops: 4, keep: 0.75, hills: true,  road: 0.95, water: true, cost: { wood: 40 } },
		B8: { name: 'marsh lantern',  hops: 4, keep: 0.75, hills: true,  road: 0.95, water: true, marsh: true, cost: { wood: 40 } },
		B9: { name: 'signal mirror',  hops: 4, keep: 0.75, hills: true,  road: 0.95, water: true, marsh: true, plain: 0.85, cost: { wood: 40, iron: 5 } },
		B10: { name: 'pass beacon',   hops: 4, keep: 0.75, hills: true,  road: 0.95, water: true, marsh: true, plain: 0.85, pass: 1, cost: { wood: 40, iron: 5 } },
		B11: { name: 'lighthouse',    hops: 4, keep: 0.75, hills: true,  road: 0.95, water: true, marsh: true, plain: 0.85, pass: 1, sea: true, cost: { wood: 40, iron: 5 } },
		B12: { name: 'heliograph',    hops: 6, keep: 0.8,  hills: true,  road: 0.95, water: true, marsh: true, plain: 0.85, pass: 1, sea: true, hop: 5, cost: { wood: 60, iron: 10 } }
	},
	// hearth: fire it makes at most, fire it stores, whether it can feed a line; grow: its output
	// grows with the city's people, up to this many times out (Network.hearthScale); boost: the low
	// fuels (below coal, Fire.LOW) give this many times their fire (the bloomery's closed fire); use: it
	// burns this many times the fuel for its fire (the furnace); upkeep: fire a lit beacon it feeds costs a
	// tick (Fire.UPKEEP unless set: the boiler)
	HEARTHS: {
		H1: { name: 'campfire',       out: 4,  store: 0,   share: false },
		H2: { name: 'fire pit',       out: 8,  store: 0,   share: false },
		H3: { name: 'stone hearth',   out: 16, store: 0,   share: true },
		H4: { name: 'town hearth',    out: 24, store: 32,  share: true },
		H5: { name: 'chimney hearth', out: 32, store: 32,  share: true },
		H6: { name: 'kiln',           out: 40, store: 160, share: true },
		H7: { name: 'bread oven',     out: 40, store: 160, share: true, grow: 2 },
		H8: { name: 'forge hearth',   out: 80, store: 240, share: true, grow: 2 },
		H9: { name: 'bloomery',       out: 100, store: 320, share: true, grow: 2, boost: 1.5 },
		H10: { name: 'great hearth',  out: 128, store: 480, share: true, grow: 3, boost: 1.5 },
		H11: { name: 'furnace',       out: 160, store: 480, share: true, grow: 3, boost: 1.5, use: 1.5 },
		H12: { name: 'boiler',        out: 176, store: 640, share: true, grow: 3, boost: 1.5, upkeep: 0.5 }
	},
	// the fuels the bloomery's boost works on: every tier below this one (coal)
	LOW: 8,
	// provisional: a hop over swamp keeps this share of what it would, before the marsh lantern (B8)
	SWAMP_KEEP: 0.85,
	// net.kind bits (Fire.compute): the ground a fuel holds (SWAMP ... COAST: a land hex beside water),
	// lake water, a road, open flat ground (PLAIN: field, barrens, desert, tundra), a mountain pass, an
	// inland sea's open water
	SWAMP: 1, JUNGLE: 2, LAKE: 4, ROAD: 8, HILLS: 16, DESERT: 32, TUNDRA: 64, COAST: 128,
	PLAIN: 256, PASS: 512, SEA: 1024,
	// the bits a fuel may hold (its `wet` cap on them)
	HOLDS: 1 | 2 | 16 | 32 | 64 | 128,

	TICK: 10,           // seconds per fire tick (the room's fire)
	HOP: 3,             // a beacon reaches the next node up to 3 hexes away
	CORRIDOR: 1,        // hexes lit either side of a line, and around a beacon or hearth
	LIT_MIN: 1,         // a hex is lit while at least this much fire reaches it
	RELAY_MIN: 4,       // provisional: fire carries on (to the next beacon, or a ring further from a hearth)
	                    // only while this strong; with CITY.md's keep it gives its 2/2/3/3 hops at a stone hearth
	LIT_DANGER: 1,      // lit land: this much less danger (min 0)
	UPKEEP: 1,          // provisional: fire a lit beacon burns per tick, paid by the hearth that feeds it
	RING_FALLOFF: 0.25, // fire inside a city: -25% per district ring from the hearth quarter

	// how far apart two nodes link under a beacon tier
	hop: function (B) {
		return (B && B.hop) || Fire.HOP;
	},

	// the fire a beacon lit by this hearth tier costs it a tick
	upkeep: function (H) {
		return H && typeof H.upkeep == 'number' ? H.upkeep : Fire.UPKEEP;
	},

	/*
	 * The ground bits of a world (net.kind, without its roads: script/network.js adds them), as a
	 * Uint16Array (x + y * cols). gen is WorldGen.generate's; the game and the simulator both use it.
	 */
	groundBits: function (gen) {
		var T = WorldGen.TERRAIN, cols = gen.cols, rows = gen.rows, bits = new Uint16Array(cols * rows), pass = {};
		var held = {}, plain = {};
		held[T.swamp] = Fire.SWAMP; held[T.jungle] = Fire.JUNGLE; held[T.hills] = Fire.HILLS;
		held[T.desert] = Fire.DESERT; held[T.tundra] = Fire.TUNDRA;
		[T.field, T.barrens, T.desert, T.tundra].forEach(function (t) { plain[t] = true; });
		(gen.passes || []).forEach(function (p) { pass[p[0] + p[1] * cols] = true; });
		for (var x = 0; x < cols; x++) {
			for (var y = 0; y < rows; y++) {
				var t = gen.terrain[x][y], k = x + y * cols, b = held[t] || 0;
				if (t === T.lake) b |= Fire.LAKE;
				if (plain[t]) b |= Fire.PLAIN;
				if (pass[k]) b |= Fire.PASS;
				if (t === T.ocean) {
					var f = gen.formationAt ? gen.formationAt[k] : -1;
					if (f >= 0 && gen.formations[f].kind === 'sea') b |= Fire.SEA;
				} else if (t !== T.lake) {
					for (var d = 0; d < 6; d++) {
						var n = WorldGen.neighbour(x, y, d);
						if (n[0] >= 0 && n[1] >= 0 && n[0] < cols && n[1] < rows && WorldGen.isWater(gen.terrain[n[0]][n[1]])) {
							b |= Fire.COAST;
							break;
						}
					}
				}
				bits[k] = b;
			}
		}
		return bits;
	},

	tier: function (id) {
		for (var i = 0; i < Fire.TIERS.length; i++) {
			if (Fire.TIERS[i].id === id) return Fire.TIERS[i];
		}
		return null;
	},

	// the best tier of a ladder in a set of unlocked ids ({ id: true }), or null
	best: function (ladder, unlocked) {
		var best = null;
		Fire.TIERS.forEach(function (t) {
			if (t.ladder === ladder && unlocked[t.id] && (!best || t.n > best.n)) best = t;
		});
		return best;
	},

	/*
	 * A tier's beat happened somewhere outside the ladders' own checks: a power broken (F8, the
	 * garrison of the deep mines; Phase 6 calls it). The game sets Fire.onUnlock (Network.beat); the
	 * tier comes in once the one before it is in, like every other.
	 */
	/*
	 * provisional (flame-build.md): the fire a founded city's hearth of tier H makes with this many
	 * people. Whatever its tier it gives the town hearth's (H4) up to P people (24 x people / P), so a
	 * small town's big hearth doesn't eat all its wood; it rises to its own tier's fire by 2P, and
	 * the bread oven and forge hearth grow on past that, up to H.grow times their fire.
	 */
	foundedOut: function (H, people, P) {
		var base = Math.min(H.out, Fire.HEARTHS.H4.out);
		var out = base * Math.min(1, people / P) + (H.out - base) * Math.max(0, Math.min(1, (people - P) / P));
		return H.grow && people > 2 * P ? H.out * Math.min(H.grow, people / (2 * P)) : out;
	},

	// the fire one unit of a fuel gives in a hearth of this tier: its own, the low fuels boosted in a
	// bloomery and after, less in a hearth that burns more for its fire (the furnace)
	perUnit: function (H, fuel) {
		var f = Fire.FUELS[fuel], per = f.fire * f.burn;
		if (H.boost && Fire.tier(f.tier).n < Fire.LOW) per *= H.boost;
		return per / (H.use || 1);
	},

	onUnlock: null,
	unlock: function (id) {
		return Fire.onUnlock ? Fire.onUnlock(id) : false;
	},

	/*
	 * One fire tick of a hearth, over every unlocked fuel it has in stock: the strongest first,
	 * then the next tops up what that left short, until the need (and the store) is met.
	 * need = fire wanted (its output plus the upkeep of the beacons it fed last tick);
	 * have(fuel) = units in stock; stored = fire held over (H4 and up);
	 * room = fire it may hold over, the tier's store by default (a small city's hearth holds less).
	 * Units burn in fractions, like every other store, so no fire is wasted.
	 * Returns { burn: { fuel: units used }, fuel: the fuel whose reach its lines get (the
	 * weakest burned: a line works at the lowest), out: fire made, stored }.
	 */
	burnAll: function (hearthId, unlocked, have, need, stored, room) {
		var h = Fire.HEARTHS[hearthId], store = typeof room == 'number' ? room : h.store;
		var want = need + Math.max(0, store - stored), made = 0, burn = {}, fuel = null;
		Object.keys(Fire.FUELS).filter(function (k) { return unlocked[Fire.FUELS[k].tier] && have(k) > 0; })
			.sort(function (a, b) { return Fire.tier(Fire.FUELS[b].tier).n - Fire.tier(Fire.FUELS[a].tier).n; })
			.forEach(function (k) {
				if (made >= want) return;
				var f = Fire.FUELS[k], per = f.fire * f.burn, n = Math.min(have(k), (want - made) / per);
				burn[k] = n;
				made += n * per;
				fuel = k; // strongest first, so the last one burned is the weakest
			});
		var fire = made + stored, used = Math.min(fire, need);
		return { burn: burn, fuel: fuel, out: need > 0 ? h.out * used / need : 0, stored: Math.min(store, fire - used) };
	},

	// offset (odd rows shifted right) <-> cube coordinates
	cube: function (x, y) {
		var q = x - (y - (y & 1)) / 2;
		return [q, y, -q - y];
	},

	// Fire.cube's distance, worked out without making the cubes (perf: the network asks it a lot)
	distance: function (a, b) {
		var dq = a[0] - (a[1] - (a[1] & 1)) / 2 - b[0] + (b[1] - (b[1] & 1)) / 2, dr = a[1] - b[1];
		return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
	},

	// the hexes on the straight line from a to b, both ends included
	line: function (a, b) {
		var n = Fire.distance(a, b), A = Fire.cube(a[0], a[1]), B = Fire.cube(b[0], b[1]), out = [];
		for (var i = 0; i <= n; i++) {
			var t = n === 0 ? 0 : i / n, c = [];
			for (var j = 0; j < 3; j++) c.push(A[j] + (B[j] - A[j]) * t + 1e-6 * (j + 1));
			var r = c.map(Math.round), d = c.map(function (v, j) { return Math.abs(r[j] - v); });
			if (d[0] > d[1] && d[0] > d[2]) r[0] = -r[1] - r[2];
			else if (d[1] > d[2]) r[1] = -r[0] - r[2];
			else r[2] = -r[0] - r[1];
			out.push([r[0] + (r[1] - (r[1] & 1)) / 2, r[1]]);
		}
		return out;
	},

	// every hex exactly r from [x, y]
	ring: function (x, y, r) {
		return Fire.offsets(y, r, true).map(function (d) { return [x + d[0], y + d[1]]; });
	},

	// every hex within r of [x, y]
	around: function (x, y, r) {
		return Fire.offsets(y, r, false).map(function (d) { return [x + d[0], y + d[1]]; });
	},

	// the steps from a hex on row y to every hex within r (exactly r: ring), row by row; they only
	// differ between even and odd rows, so each set is worked out once (perf)
	_offsets: {},
	offsets: function (y, r, ring) {
		var k = (y & 1) + ',' + r + ',' + !!ring, out = Fire._offsets[k];
		if (out) return out;
		out = Fire._offsets[k] = [];
		for (var dy = -r; dy <= r; dy++) {
			for (var dx = -r - 1; dx <= r + 1; dx++) {
				var d = Fire.distance([0, y & 1], [dx, (y & 1) + dy]);
				if (ring ? d === r : d <= r) out.push([dx, dy]);
			}
		}
		return out;
	},

	/*
	 * The network: which hexes the fire reaches, and how strongly.
	 *   net.cols, net.rows
	 *   net.danger(x, y)   the hex's danger before any light; or net.field, the same for every
	 *                      hex as an array (x + y * cols), read without a call (perf)
	 *   net.hills(x, y)    true on hills
	 *   net.open(x, y)     true on open dry ground a line can cross (optional: all of it)
	 *   net.kind           optional Uint8Array (x + y * cols) of Fire.SWAMP / JUNGLE / LAKE / ROAD bits
	 *   net.hearths[]      { at: [x, y], out, share, cap, holds, wet } (its fuel's FUELS fields)
	 *   net.beacons[]      [x, y]
	 *   net.beacon         the beacon tier in use, one of Fire.BEACONS
	 * A hearth lights its own ground, a ring at a time, -25% a ring. A beacon links to any node
	 * up to Fire.HOP hexes away. Sharing hearths whose fire reaches each other pool it, and
	 * each sends the pool out; every hop keeps `keep` of it, and fire carries on only while it
	 * is at least Fire.RELAY_MIN. Nothing goes into a hex over the fuel's danger cap: a beacon
	 * there is dark, and so is everything past it; on the ground a fuel holds (peat: swamp, resin:
	 * jungle, coke: hills, pitch: desert, whale oil: coast, rock oil: tundra) its cap is `wet`. A line
	 * between two nodes needs every hex between them open (lake too, from the ford light; an inland sea
	 * from the lighthouse) and under the cap; a hop all along a road keeps the beacon's road share, one
	 * over open flat ground its plain share, one through a pass its pass share (the best of them), and
	 * one over swamp loses more (Fire.SWAMP_KEEP) until the marsh lantern. Nodes link up to the beacon
	 * tier's hop (Fire.hop) apart.
	 * Returns { fire: Float32Array, lit: Uint8Array, nodes: [{ at, s, hearth }], links: [[i, j, s]] } (links: one a
	 * linked pair, at its strongest).
	 */
	compute: function (net) {
		var cols = net.cols, rows = net.rows, n = cols * rows, field = net.field, kind = net.kind || null;
		var danger = field ? function (x, y) { return field[x + y * cols]; } : net.danger;
		// whether a hearth's fuel reaches hex k: further on the damp ground it holds
		var reaches = function (k, h) {
			return (field ? field[k] : danger(k % cols, (k - k % cols) / cols)) <= (kind && h.holds && kind[k] & h.holds ? h.wet : h.cap);
		};
		var fire = new Float32Array(n), lit = new Uint8Array(n);
		var nodes = net.hearths.map(function (h) { return { at: h.at, s: 0, hearth: h }; })
			.concat(net.beacons.map(function (b) { return { at: b, s: 0, hearth: null }; }));
		// links: every pair of nodes up to a hop apart. Nodes are bucketed in cells a hop wide
		// (a hop can be one column more across), so only neighbouring cells are compared (perf)
		var HOP = Fire.hop(net.beacon);
		var adj = nodes.map(function () { return []; }), cells = {}, CX = HOP + 1, CY = HOP;
		var cell = function (cx, cy) { return cx + ',' + cy; };
		nodes.forEach(function (node, i) {
			var k = cell(Math.floor(node.at[0] / CX), Math.floor(node.at[1] / CY));
			(cells[k] = cells[k] || []).push(i);
		});
		for (var i = 0; i < nodes.length; i++) {
			var cx = Math.floor(nodes[i].at[0] / CX), cy = Math.floor(nodes[i].at[1] / CY);
			for (var dx = -1; dx <= 1; dx++) {
				for (var dy = -1; dy <= 1; dy++) {
					(cells[cell(cx + dx, cy + dy)] || []).forEach(function (j) {
						if (j !== i && Fire.distance(nodes[i].at, nodes[j].at) <= HOP) adj[i].push(j);
					});
				}
			}
			adj[i].sort(function (a, b) { return a - b; }); // in node order, as the walks expect
		}
		var inside = function (p) { return p[0] >= 0 && p[1] >= 0 && p[0] < cols && p[1] < rows; };
		// fire reaching a hex from a line with this fuel cap
		var cover = function (p, s, h) {
			var x = p[0], y = p[1];
			if (x < 0 || y < 0 || x >= cols || y >= rows) return;
			var k = x + y * cols;
			if (s <= fire[k]) return;
			// reaches(k, h), written out: the painter's hottest path (perf)
			var d = field ? field[k] : danger(x, y);
			if (d <= h.cap || (kind && h.holds && kind[k] & h.holds && d <= h.wet)) fire[k] = s;
		};
		var B = net.beacon, H = net.hearths.length;
		// the hexes strictly between two linked nodes: the most danger on dry ground, and each hex on
		// ground a fuel may hold ([danger, bits], few: a hop is short), whether all are open dry ground (a
		// line can't jump what it couldn't light, or cross water or mountains; lake from the ford light, an
		// inland sea from the lighthouse), whether any is swamp, whether all are open flat ground, whether
		// the line, its ends too, goes through a pass, and whether the whole line, its ends too, is road
		var corridors = {}, NN = nodes.length;
		var between = function (a, b) {
			var k = a < b ? a * NN + b : b * NN + a, c = corridors[k];
			if (c) return c;
			c = corridors[k] = { danger: 0, held: null, open: true, wet: false, road: !!kind, plain: !!kind, pass: false };
			var l = Fire.line(nodes[a].at, nodes[b].at);
			for (var i = kind ? 0 : 1; i < (kind ? l.length : l.length - 1); i++) {
				var p = l[i], bits = kind && inside(p) ? kind[p[0] + p[1] * cols] : 0;
				if (!(bits & Fire.ROAD)) c.road = false;
				if (bits & Fire.PASS) c.pass = true;
				if (i === 0 || i === l.length - 1) continue;
				if (!(bits & Fire.PLAIN)) c.plain = false;
				if (!inside(p) || (net.open && !net.open(p[0], p[1]) && !(B && B.water && bits & Fire.LAKE) && !(B && B.sea && bits & Fire.SEA))) {
					c.open = false;
					continue;
				}
				var d = danger(p[0], p[1]);
				if (bits & Fire.SWAMP) c.wet = true;
				if (bits & Fire.HOLDS) (c.held = c.held || []).push(d, bits);
				else c.danger = Math.max(c.danger, d);
			}
			return c;
		};
		var carries = function (a, b, h) {
			var c = between(a, b), holds = h.holds || 0;
			if (!c.open || c.danger > h.cap) return false;
			for (var i = 0; c.held && i < c.held.length; i += 2) {
				if (c.held[i] > (holds & c.held[i + 1] ? h.wet : h.cap)) return false;
			}
			return true;
		};
		// the share of fire a hop from a to b keeps, and the most any hop keeps
		var keep = function (a, b) {
			if (!kind) return B.keep;
			var c = between(a, b), k = B.road && c.road ? B.road : B.keep;
			if (B.plain && c.plain) k = Math.max(k, B.plain);
			if (B.pass && c.pass) k = Math.max(k, B.pass);
			return c.wet && !B.marsh ? k * Fire.SWAMP_KEEP : k;
		};
		var most = B ? (kind ? Math.max(B.keep, B.road || 0, B.plain || 0, B.pass || 0) : B.keep) : 0;
		// each hearth's fuel as a small number (hearths burning alike share what is worked out about their reach)
		var fuelIds = {}, fuelHearth = [];
		var fis = net.hearths.map(function (h) {
			var k = h.cap + ',' + (h.holds || 0) + ',' + (h.wet || 0);
			if (fuelIds[k] === undefined) {
				fuelIds[k] = fuelHearth.length;
				fuelHearth.push(h);
			}
			return fuelIds[k];
		});
		// per fuel, whether each node is within its reach (1, -1; 0 not asked yet); per node, the fire it
		// needs to relay on (a beacon on hills, where its tier can use them, carries one hop further)
		var reachOf = [], relayAt = [];
		// hearths' fire out along the beacons, each of them sending s0, keeping each beacon's strongest:
		// { best, links }. One hearth's is its own walk; several burning alike walk as one, the best of each
		var spread = function (starts, s0, h, fi) {
			var rc = reachOf[fi] || (reachOf[fi] = new Int8Array(NN)), best = {}, links = {}, queue = [];
			starts.forEach(function (hi) { queue.push(hi, s0); });
			for (var qi = 0; qi < queue.length; qi += 2) {
				var a = queue[qi], sa = queue[qi + 1], ad = adj[a], top = sa * most;
				if (top < Fire.LIT_MIN) continue; // not even the best hop would do
				for (var j = 0; j < ad.length; j++) {
					var b = ad[j];
					if (b < H || best[b] >= top) continue; // a hearth doesn't relay another's line
					if (!rc[b]) rc[b] = reaches(nodes[b].at[0] + nodes[b].at[1] * cols, h) ? 1 : -1;
					if (rc[b] < 0) continue; // past the fuel's reach: dark
					var c = between(a, b), ok = c.ok || (c.ok = []);
					if (ok[fi] === undefined) ok[fi] = carries(a, b, h);
					if (!ok[fi]) continue;
					if (c.k === undefined) c.k = keep(a, b);
					var s = sa * c.k;
					if (s < Fire.LIT_MIN || best[b] >= s) continue;
					best[b] = s;
					links[a < b ? a * NN + b : b * NN + a] = [a, b, s];
					if (relayAt[b] === undefined) {
						relayAt[b] = B.hills && net.hills(nodes[b].at[0], nodes[b].at[1]) ? Fire.RELAY_MIN * B.keep : Fire.RELAY_MIN;
					}
					if (s >= relayAt[b]) queue.push(b, s);
				}
			}
			return { best: best, links: links };
		};

		// pools: sharing hearths whose fire reaches each other add up. Fire reaches a hearth from
		// the other's hex, or from one of its beacons strong enough to relay, within a hop; a pool
		// sends further, so it is walked again until no more hearths join it. While pools are joining,
		// a pool's hearths burning alike walk as one (perf): which beacons any of them relays from is all
		// a join asks. Each hearth then walks on its own once, for the corridors it lights.
		var root = net.hearths.map(function (h, i) { return i; });
		var find = function (i) { return root[i] === i ? i : (root[i] = find(root[i])); };
		var walks, joined = true;
		while (joined) {
			joined = false;
			var pool = {};
			net.hearths.forEach(function (h, hi) {
				if (h.share) pool[find(hi)] = (pool[find(hi)] || 0) + h.out;
			});
			var groups = {};
			net.hearths.forEach(function (h, hi) {
				var s0 = pool[find(hi)];
				if (!h.share || !B || !(s0 >= Fire.RELAY_MIN)) return;
				var g = find(hi) + ':' + fis[hi];
				(groups[g] = groups[g] || { starts: [], s0: s0, hi: hi }).starts.push(hi);
			});
			for (var g in groups) {
				var G = groups[g], h0 = net.hearths[G.hi], w = spread(G.starts, G.s0, h0, fis[G.hi]), from = G.starts.slice();
				for (var k in w.best) if (w.best[k] >= Fire.RELAY_MIN) from.push(+k);
				from.forEach(function (f) {
					adj[f].forEach(function (b) {
						if (b < H && net.hearths[b].share && find(b) !== find(G.hi) && carries(f, b, h0)) {
							root[find(b)] = find(G.hi);
							joined = true;
						}
					});
				});
			}
		}
		walks = net.hearths.map(function (h, hi) {
			var s0 = h.share ? pool[find(hi)] : h.out;
			return { s0: s0, w: h.share && B && s0 >= Fire.RELAY_MIN ? spread([hi], s0, h, fis[hi]) : null };
		});

		// each hearth lights its own ground; its walk's beacons and links are gathered per fuel, the
		// strongest of each, and painted once (perf: a pooled network's hearths all walk the same lines)
		var nodeMax = [], linkMax = [];
		net.hearths.forEach(function (h, hi) {
			var s0 = walks[hi].s0, w = walks[hi].w, fi = fis[hi];
			if (s0 > nodes[hi].s) nodes[hi].s = s0;
			// its own ground: ring by ring while the ring inside still carries
			for (var r = 0, s = s0; r <= 1 / Fire.RING_FALLOFF; r++) {
				s = s0 * (1 - Fire.RING_FALLOFF * r);
				Fire.ring(h.at[0], h.at[1], r).forEach(function (p) { cover(p, s, h); });
				if (s < Fire.RELAY_MIN) break;
			}
			if (!w) return;
			var nm = nodeMax[fi] || (nodeMax[fi] = {}), lm = linkMax[fi] || (linkMax[fi] = {});
			for (var b in w.best) {
				if (w.best[b] > nodes[b].s) nodes[b].s = w.best[b];
				if (!(nm[b] >= w.best[b])) nm[b] = w.best[b];
			}
			for (var k in w.links) {
				var l = w.links[k], key = l[0] * NN + l[1];
				if (!lm[key] || lm[key][2] < l[2]) lm[key] = l;
			}
		});
		// the corridors: a beacon's hexes, and a link's line with a hex either side
		var all = {};
		fuelHearth.forEach(function (h, fi) {
			for (var b in nodeMax[fi]) {
				var at = nodes[b].at, sb = nodeMax[fi][b];
				Fire.around(at[0], at[1], Fire.CORRIDOR).forEach(function (p) { cover(p, sb, h); });
			}
			for (var key in linkMax[fi]) {
				var l = linkMax[fi][key], u = Math.min(l[0], l[1]) * NN + Math.max(l[0], l[1]);
				if (!all[u] || all[u][2] < l[2]) all[u] = l;
				Fire.line(nodes[l[0]].at, nodes[l[1]].at).forEach(function (c) {
					Fire.around(c[0], c[1], Fire.CORRIDOR).forEach(function (p) { cover(p, l[2], h); });
				});
			}
		});
		all = Object.keys(all).map(function (u) { return all[u]; });
		for (i = 0; i < n; i++) lit[i] = fire[i] >= Fire.LIT_MIN ? 1 : 0;
		return { fire: fire, lit: lit, nodes: nodes, links: all };
	}
};

(function () {
	// [id, name, beat, story, chain, when]
	var T = {
		fuel: [
			['wood', '"light fire" (the original opening)', true, null, 'fire lit'],
			['dry wood', 'the builder raises a woodshed against the damp', false, null, 'woodshed'],
			['seasoned oak', 'the first trek brings back an old axe-head from the forest', false, null, 'axe-head'],
			['tallow', 'the town has its first tannery and smokehouse running together', false, null, 'tannery and smokehouse'],
			['charcoal', 'a stranger from the first resettled fallen city teaches the burning pits', true, 'the charcoal stranger', 'burning pits'],
			['peat', 'a swamp city-state shares the cutting of the bog', true, null, 'bog cutters'],
			['resin', 'the jungle folk trade the bleeding of the trees', false, null, 'resin tappers'],
			['coal', 'the garrison holding the deep mines is broken (first power)', true, 'the garrison of the deep mines', 'garrison broken'],
			['coke', 'the forge-masters of the hill towns are won over', true, null, 'forge-masters'],
			['pitch', 'the tar-keepers of the desert pits swear to you', true, null, 'tar oath'],
			['whale oil', 'a coastal fallen city is resettled and its boats relaunched', true, 'the drowned harbour', 'boats relaunched'],
			['rock oil', 'an old-world well is found and the knowledge to tap it pieced together', true, 'the black well', 'well tapped'],
			['refined spirit', 'the refinery of an old-world complex is restored', true],
			['salvage cells', 'old cells pulled from the wreck fields hold a little charge', false],
			['rebuilt cells', 'the cell-works rebuilt from recovered fragments', true, 'the cell-works'],
			['the old fire', 'the power at the war\'s heart falls; the ship\'s reactor is yours', true, 'the war\'s heart']
		],
		beacon: [
			['brazier', 'the world opens into hexes at the town', true, 'the world is bigger', 'brazier'],
			['torch-post', 'the first trek returns home alive', false, null, 'trek home'],
			['cairn fire', 'a wanderer shows how the old roads were marked', true, 'the wanderer\'s cairns', 'cairn'],
			['watch fire', 'the first waystation is held', false, null, 'waystation lit'],
			['watchtower', 'a waystation survives a night of attack', false, null, 'waystation held'],
			['lamp-post line', 'the first road joins two cities', false, null, 'road joins'],
			['ford light', 'a river crossing is bridged', false, null, 'water crossed'],
			['marsh lantern', 'the swamp city-state\'s lantern-keepers join you', true, null, 'lantern-keepers'],
			['signal mirror', 'a desert city-state teaches the mirrors', true, null, 'mirrors'],
			['pass beacon', 'a mountain pass is held through a siege', true, null, 'pass held'],
			['lighthouse', 'a coastal fallen city is resettled', true, 'the drowned harbour', 'lighthouse lit'],
			['heliograph', 'the mirror-masters and the lighthouse-keepers share their craft', true, null, 'heliograph'],
			['wire', 'copper and the knowledge of wire recovered from a complex', false],
			['insulated wire', 'a power\'s workshop is captured intact', true],
			['pylon', 'old-world pylons restored', true],
			['the old grid', 'recovered at the war\'s heart', true, 'the war\'s heart']
		],
		hearth: [
			['campfire', 'the room is warm (original)', true, null, 'room warm'],
			['fire pit', 'the builder stays', false, null, 'builder stays'],
			['stone hearth', 'the village is built (20 huts + trading post)', true, 'the world is bigger', 'stone hearth'],
			['town hearth', 'the capital raises its first district', false, null, 'first district'],
			['chimney hearth', 'the first fallen city is resettled', true, null, 'old chimney'],
			['kiln', 'potters of a city-state join the empire', true, null, 'potters'],
			['bread oven', 'a city reaches its second population tier', false, null, 'second tier'],
			['forge hearth', 'the first coal is burned in a city (after F8)', false, null, 'coal burned'],
			['bloomery', 'the hill towns\' smiths teach smelting', true, null, 'bloomery'],
			['great hearth', 'a city reaches the top population tier', false, null, 'top tier'],
			['furnace', 'a power\'s foundry is captured', true, null, 'foundry taken'],
			['boiler', 'rock oil is tapped (F12) and the boiler-wrights found', true, null, 'boiler-wrights'],
			['engine hearth', 'the refinery is restored (F13)', true],
			['dynamo', 'the first wire line is lit (B13)', true],
			['reactor shell', 'rebuilt cells (F15)', true],
			['the first fire', 'the war\'s heart falls', true, 'the war\'s heart']
		]
	};
	var P = { fuel: 'F', beacon: 'B', hearth: 'H' };
	Fire.LADDERS.forEach(function (ladder) {
		T[ladder].forEach(function (t, i) {
			Fire.TIERS.push({
				id: P[ladder] + (i + 1), ladder: ladder, era: Fire.ERAS[Math.floor(i / 4)], n: i + 1,
				name: _(t[0]), beat: t[1], story: t[2], chain: t[3] || null, when: t[4] || null
			});
		});
	});
})();
