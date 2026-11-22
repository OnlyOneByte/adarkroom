/**
 * The world generator: one seeded world behind both maps.
 *
 * The prologue's square map (World.generateMap) is drawn with WorldGen.rng(seed),
 * and WorldGen.generate(seed, squareMap) builds the Huge hex world around it:
 * the square map becomes the core of the hex world, hex for square, so
 * everything the wanderer saw in the wasteland is where it was.
 *
 * Hexes are pointy-top in "odd-r" offset coordinates [col, row]: odd rows sit
 * half a hex to the right. In these coordinates (x±1, y) and (x, y±1) are always
 * neighbours, which is why the square core maps onto hexes one to one.
 *
 * No behaviour lives here: terrain and sites are data. Hooks for later phases
 * (yields, movement costs, city-states, powers) belong in World.
 */
var WorldGen = {
	// generator version; a save records it, so a change to the output must bump it
	// shortcut: no old generator is kept; 1 -> 2 only moved one site, so the v2.8 save migration marks a
	// version 1 world as 2 (its deltas and mask still fit), upgrade this once a change moves more
	VERSION: 2,     // 2: the garrison's complex on the band 1-2 hills (WorldGen._garrison)

	// world size, capital position and feature counts: DESIGN.md "Hex map parameters"
	COLS: 160,
	ROWS: 100,
	CAPITAL: [44, 50],
	SQUARE_RADIUS: 30,      // the prologue map's World.RADIUS
	BLEND: 6,               // hexes past the old edge where the wasteland fades out
	COUNTS: {
		range: 10, forest: 8, sea: 5, desert: 4,     // natural formations
		crater: 14, fallenCity: 40, complex: 8,      // sites outside the old wasteland
		passes: [1, 3]                               // passes cut through each mountain range
	},

	TERRAIN: {
		field: ',',
		forest: ';',
		barrens: '.',
		hills: '^',
		mountains: '▲',
		lake: '~',
		ocean: '≈',
		desert: ':',
		swamp: '"',
		tundra: '\'',
		jungle: '&',
		wastes: '*'
	},

	SITES: {
		fallenCity: { glyph: 'Y', label: _('a fallen city') },
		crater: { glyph: 'Ø', label: _('a war crater') },
		complex: { glyph: 'Π', label: _('an old-world complex') }
	},

	PASS_LABEL: _('a mountain pass'),

	FORMATIONS: {
		range: _('a mountain range'),
		forest: _('a great forest'),
		sea: _('an inland sea'),
		desert: _('a desert')
	},

	// [dx, dy] per direction for even and odd rows: E, SE, SW, W, NW, NE
	_DIRS: [
		[[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]],
		[[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]]
	],

	newSeed: function () {
		return Math.floor(Math.random() * 4294967296);
	},

	// mulberry32: small, fast, good enough for map generation
	rng: function (seed) {
		var a = seed >>> 0;
		return function () {
			a = (a + 0x6D2B79F5) | 0;
			var t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	},

	neighbour: function (x, y, dir) {
		var d = WorldGen._DIRS[y & 1][dir];
		return [x + d[0], y + d[1]];
	},

	distance: function (a, b) {
		var aq = a[0] - (a[1] - (a[1] & 1)) / 2, bq = b[0] - (b[1] - (b[1] & 1)) / 2;
		var dq = aq - bq, dr = a[1] - b[1];
		return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
	},

	isTerrain: function (c) {
		for (var k in WorldGen.TERRAIN) {
			if (WorldGen.TERRAIN[k] === c) return true;
		}
		return false;
	},

	isWater: function (c) {
		return c === WorldGen.TERRAIN.ocean || c === WorldGen.TERRAIN.lake;
	},

	// on foot: open ocean and mountains (outside their passes, which are hills) can't be crossed
	isPassable: function (c) {
		return c !== WorldGen.TERRAIN.ocean && c !== WorldGen.TERRAIN.mountains;
	},

	/*
	 * Builds the hex world. squareMap is the prologue map (61x61, World.TILE codes,
	 * '!' marks visited); it must not be modified. cleared: { 'x,y': mine tile } of the
	 * prologue mines cleared at those squares (game.world.clearedMines), optional. Returns:
	 *   cols, rows, capital, warHeart
	 *   map[x][y]      World.TILE code or terrain glyph, like the square map
	 *   terrain[x][y]  the ground under every hex (deposits sit on hills)
	 *   sites[]        { kind, anchor:[x,y], hexes:[[x,y]...] } multi-hex sites
	 *   formations[]   { kind, hexes:[[x,y]...] } multi-hex natural formations
	 *   passes[]       [x,y] hexes where a way is cut through mountains (hills now)
	 *   reachable      Uint8Array(cols*rows), 1 = reachable from the capital on foot
	 *   siteAt, formationAt  Int16Array(cols*rows) index into the lists above, -1 none
	 *   coreOffset     [dx, dy] from square to hex coordinates
	 *   deposits[]     { kind: 'iron'|'coal'|'sulphur', at:[x,y], cleared } the prologue's mines
 *   garrison       the index in sites[] of the garrison of the deep mines' complex (-1: none)
	 *   pockets[]      [x,y] centres of the safer pockets (Danger)
	 */
	generate: function (seed, squareMap, cleared) {
		var G = WorldGen, T = G.TERRAIN;
		var cols = G.COLS, rows = G.ROWS, R = G.SQUARE_RADIUS;
		var rand = G.rng(seed ^ 0x5EED);
		var cap = G.CAPITAL, ox = cap[0] - R, oy = cap[1] - R;
		var i, x, y;

		var terrain = new Array(cols);
		for (x = 0; x < cols; x++) terrain[x] = new Array(rows);
		var idx = function (x, y) { return x + y * cols; };
		var inside = function (x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; };
		// offset distance outside the old wasteland's square; 0 = inside it
		var coreDist = function (x, y) {
			var dx = Math.max(ox - x, 0, x - (ox + 2 * R));
			var dy = Math.max(oy - y, 0, y - (oy + 2 * R));
			return Math.max(dx, dy);
		};

		// Value noise on a seeded lattice, sampled at hex centres so rows don't shear.
		var lattice = function (s) {
			var r = G.rng(s), n = 64, v = new Float32Array(n * n);
			for (var k = 0; k < n * n; k++) v[k] = r();
			return function (px, py) {
				var x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
				var at = function (a, b) { return v[(((a % n) + n) % n) + (((b % n) + n) % n) * n]; };
				fx = fx * fx * (3 - 2 * fx);
				fy = fy * fy * (3 - 2 * fy);
				var top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
				var bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
				return top + (bot - top) * fy;
			};
		};
		var fbm = function (s, scale) {
			var octaves = [lattice(s), lattice(s + 1), lattice(s + 2)];
			return function (x, y) {
				var px = (x + 0.5 * (y & 1)) * scale, py = y * 0.866 * scale;
				return (octaves[0](px, py) * 4 + octaves[1](px * 2, py * 2) * 2 + octaves[2](px * 4, py * 4)) / 7;
			};
		};
		var elev = fbm(seed + 11, 0.07), moist = fbm(seed + 23, 0.09), scar = fbm(seed + 37, 0.12);

		// The war's heart: far east of the capital, where the ship came down.
		var heart = [cols - 22 + Math.floor(rand() * 8), Math.floor(rows * 0.3 + rand() * rows * 0.4)];
		var heartReach = G.distance(cap, heart);
		var pockets = Danger.pockets(seed, cols, rows, cap, heart, G.distance);

		// 1. Climate: elevation and moisture noise, temperature in bands from cold north to hot south.
		for (y = 0; y < rows; y++) {
			for (x = 0; x < cols; x++) {
				var edge = Math.min(x, y, cols - 1 - x, rows - 1 - y);
				var e = elev(x, y) - Math.max(0, 6 - edge) * 0.08;
				var m = moist(x, y);
				var t = y / (rows - 1) + (moist(x + 97, y + 31) - 0.5) * 0.15;
				var c;
				if (e < 0.30) c = T.ocean;
				else if (e > 0.72) c = T.mountains;
				else if (e > 0.64) c = T.hills;
				else if (t < 0.17) c = T.tundra;
				else if (t > 0.78) c = m < 0.45 ? T.desert : (m > 0.55 ? T.jungle : T.field);
				else if (m > 0.62 && e < 0.42) c = T.swamp;
				else if (m > 0.54) c = T.forest;
				else if (m < 0.40) c = T.barrens;
				else c = T.field;
				// war scars, as dense as the danger: further out, toward the heart, fewer in a safe pocket
				var threat = Danger.threat(G.distance([x, y], cap), heartReach, G.distance([x, y], heart),
					Danger.pocketAt(pockets, x, y, G.distance));
				if (c !== T.ocean && c !== T.mountains && scar(x, y) < Danger.scarLine(threat)) c = T.wastes;
				terrain[x][y] = c;
			}
		}
		// coasts: ocean that touches land
		var coast = [];
		for (y = 0; y < rows; y++) {
			for (x = 0; x < cols; x++) {
				if (terrain[x][y] !== T.ocean) continue;
				for (i = 0; i < 6; i++) {
					var n = G.neighbour(x, y, i);
					if (inside(n[0], n[1]) && !G.isWater(terrain[n[0]][n[1]])) { coast.push([x, y]); break; }
				}
			}
		}
		for (i = 0; i < coast.length; i++) terrain[coast[i][0]][coast[i][1]] = T.lake;

		// 2. Near the old edge the wasteland's own ground carries on and fades out.
		var waste = [T.forest, T.field, T.barrens];
		for (var d = 1; d <= G.BLEND; d++) {
			for (y = oy - d; y <= oy + 2 * R + d; y++) {
				for (x = ox - d; x <= ox + 2 * R + d; x++) {
					if (!inside(x, y) || coreDist(x, y) !== d) continue;
					if (rand() > (1 - d / (G.BLEND + 1)) * 0.95) continue;
					var from = [];
					for (i = 0; i < 6; i++) {
						var nb = G.neighbour(x, y, i);
						if (inside(nb[0], nb[1]) && coreDist(nb[0], nb[1]) < d) from.push(nb);
					}
					var src = from.length && rand() < 0.6 ? from[Math.floor(rand() * from.length)] : null;
					var g = src ? (src[0] >= ox && src[0] <= ox + 2 * R && src[1] >= oy && src[1] <= oy + 2 * R ?
						squareMap[src[0] - ox][src[1] - oy].charAt(0) : terrain[src[0]][src[1]]) : null;
					terrain[x][y] = waste.indexOf(g) >= 0 ? g : waste[Math.floor(rand() * 3)];
				}
			}
		}

		// 3. The core: the prologue map, hex for square.
		var map = new Array(cols);
		for (x = 0; x < cols; x++) map[x] = terrain[x].slice();
		var ship = null;
		var coreSites = [], deposits = [];
		var MINES = {};
		MINES[World.TILE.IRON_MINE] = 'iron';
		MINES[World.TILE.COAL_MINE] = 'coal';
		MINES[World.TILE.SULPHUR_MINE] = 'sulphur';
		cleared = cleared || {};
		for (x = 0; x <= 2 * R; x++) {
			for (y = 0; y <= 2 * R; y++) {
				var cell = squareMap[x][y], code = cell.charAt(0), hx = x + ox, hy = y + oy;
				var ground = waste.indexOf(code) >= 0 ? code : null;
				if (code === World.TILE.SHIP) {
					ship = cell;
					cell = null;
				}
				// a mine cleared in the prologue is an outpost on the square map; it is still a deposit, held by a waystation
				var mine = MINES[code] || (code === World.TILE.OUTPOST && MINES[cleared[x + ',' + y]]);
				if (mine) {
					ground = T.hills; // deposits sit on hills
					deposits.push({ kind: mine, at: [hx, hy], cleared: code === World.TILE.OUTPOST });
				}
				if (code === World.TILE.TOWN || code === World.TILE.CITY) coreSites.push([hx, hy]);
				terrain[hx][hy] = ground || G._groundAround(squareMap, x, y);
				map[hx][hy] = cell === null ? terrain[hx][hy] : cell;
			}
		}

		var siteAt = new Int16Array(cols * rows).fill(-1);
		var formationAt = new Int16Array(cols * rows).fill(-1);
		var sites = [], formations = [];

		// Grows a blob of up to `size` hexes from start through hexes ok() accepts.
		var grow = function (start, size, ok) {
			var hexes = [start], seen = {};
			seen[idx(start[0], start[1])] = true;
			var frontier = [start];
			while (hexes.length < size && frontier.length) {
				var f = frontier[Math.floor(rand() * frontier.length)];
				var nb = G.neighbour(f[0], f[1], Math.floor(rand() * 6));
				var k = idx(nb[0], nb[1]);
				var open = false;
				for (var j = 0; j < 6; j++) {
					var o = G.neighbour(f[0], f[1], j);
					if (inside(o[0], o[1]) && !seen[idx(o[0], o[1])] && ok(o[0], o[1])) { open = true; break; }
				}
				if (!open) { frontier.splice(frontier.indexOf(f), 1); continue; }
				if (!inside(nb[0], nb[1]) || seen[k] || !ok(nb[0], nb[1])) continue;
				seen[k] = true;
				hexes.push(nb);
				frontier.push(nb);
			}
			return hexes;
		};
		var free = function (x, y) {
			return coreDist(x, y) > G.BLEND + 2 && formationAt[idx(x, y)] < 0 && siteAt[idx(x, y)] < 0 &&
				G.distance([x, y], heart) > 3;
		};
		var pick = function (ok) {
			for (var tries = 0; tries < 2000; tries++) {
				var p = [Math.floor(rand() * cols), Math.floor(rand() * rows)];
				if (ok(p[0], p[1])) return p;
			}
			return null;
		};
		var addFormation = function (kind, hexes, glyphOf) {
			if (!hexes || hexes.length < 2) return;
			for (var j = 0; j < hexes.length; j++) {
				var h = hexes[j];
				formationAt[idx(h[0], h[1])] = formations.length;
				terrain[h[0]][h[1]] = map[h[0]][h[1]] = glyphOf(h, j);
			}
			formations.push({ kind: kind, hexes: hexes });
		};
		var land = function (x, y) { return !G.isWater(terrain[x][y]); };
		var tempAt = function (y) { return y / (rows - 1); };

		// 4. Natural formations.
		var c0 = G.COUNTS;
		for (i = 0; i < c0.range; i++) {
			var s = pick(function (x, y) { return free(x, y) && land(x, y); });
			if (!s) break;
			var path = [s], dir = Math.floor(rand() * 6), len = 8 + Math.floor(rand() * 13), seenR = {};
			seenR[idx(s[0], s[1])] = true;
			for (var step = 1; step < len; step++) {
				if (rand() < 0.3) dir = (dir + (rand() < 0.5 ? 5 : 1)) % 6;
				var last = path[path.length - 1], nx = G.neighbour(last[0], last[1], dir);
				if (!inside(nx[0], nx[1]) || !free(nx[0], nx[1]) || seenR[idx(nx[0], nx[1])]) break;
				seenR[idx(nx[0], nx[1])] = true;
				path.push(nx);
			}
			var spine = path.length;
			for (var p = 0; p < spine; p++) {
				for (var j2 = 0; j2 < 6; j2++) {
					var fl = G.neighbour(path[p][0], path[p][1], j2);
					if (inside(fl[0], fl[1]) && free(fl[0], fl[1]) && !seenR[idx(fl[0], fl[1])] && rand() < 0.35) {
						seenR[idx(fl[0], fl[1])] = true;
						path.push(fl);
					}
				}
			}
			addFormation('range', path, function (h, j) { return j < spine ? T.mountains : T.hills; });
		}
		var blobs = [
			['forest', c0.forest, 20, 45, function (y) { var t = tempAt(y); return t > 0.25 && t < 0.7; }, function () { return T.forest; }],
			['desert', c0.desert, 25, 50, function (y) { return tempAt(y) > 0.68; }, function () { return T.desert; }],
			['sea', c0.sea, 15, 35, function () { return true; }, null]
		];
		for (var b = 0; b < blobs.length; b++) {
			var spec = blobs[b];
			for (i = 0; i < spec[1]; i++) {
				var st = pick(function (x, y) { return free(x, y) && land(x, y) && spec[4](y); });
				if (!st) break;
				var hexes = grow(st, spec[2] + Math.floor(rand() * (spec[3] - spec[2] + 1)), free);
				var glyph = spec[5];
				if (!glyph) {
					// an inland sea: open water, shallows at its rim
					var inSea = {};
					for (var q = 0; q < hexes.length; q++) inSea[idx(hexes[q][0], hexes[q][1])] = true;
					glyph = function (h) {
						for (var j3 = 0; j3 < 6; j3++) {
							var o = G.neighbour(h[0], h[1], j3);
							if (!inSea[idx(o[0], o[1])]) return T.lake;
						}
						return T.ocean;
					};
				}
				addFormation(spec[0], hexes, glyph);
			}
		}

		// 5. The war's heart, and the ship relocated to it.
		for (i = 0; i < 6; i++) {
			var hn = G.neighbour(heart[0], heart[1], i);
			terrain[hn[0]][hn[1]] = map[hn[0]][hn[1]] = T.wastes;
		}
		terrain[heart[0]][heart[1]] = T.wastes;
		map[heart[0]][heart[1]] = ship || World.TILE.SHIP;

		// 6. Passes: a few through every range, then more wherever mountains wall a region off.
		var passes = [], passAt = {};
		var cutPass = function (x, y) {
			terrain[x][y] = map[x][y] = T.hills;
			if (!passAt[idx(x, y)]) {
				passAt[idx(x, y)] = true;
				passes.push([x, y]);
			}
		};
		for (i = 0; i < formations.length; i++) {
			if (formations[i].kind !== 'range') continue;
			// only a peak with open ground on two sides that don't touch leads somewhere
			var peaks = formations[i].hexes.filter(function (h) {
				return terrain[h[0]][h[1]] === T.mountains && G._throughWay(terrain, h[0], h[1]);
			});
			var want = c0.passes[0] + Math.floor(rand() * (c0.passes[1] - c0.passes[0] + 1));
			for (var w = 0; w < want && peaks.length; w++) {
				var pk = peaks.splice(Math.floor(rand() * peaks.length), 1)[0];
				cutPass(pk[0], pk[1]);
			}
			if (!w) G._tunnel(formations[i].hexes, terrain, cutPass);
		}
		// Cheapest way from the capital to every hex, counting mountains crossed (oceanCost for open sea).
		var walk = function (oceanCost) {
			var n = cols * rows, dist = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
			// a bucket queue: every step costs a whole number
			var start = idx(cap[0], cap[1]), buckets = [[start]];
			dist[start] = 0;
			for (var d0 = 0; d0 < buckets.length; d0++) {
				var bucket = buckets[d0];
				if (!bucket) continue;
				for (var bi = 0; bi < bucket.length; bi++) {
					var at = bucket[bi];
					if (dist[at] !== d0) continue;
					var ax = at % cols, ay = (at - ax) / cols;
					for (var dd = 0; dd < 6; dd++) {
						var nb = G.neighbour(ax, ay, dd);
						if (!inside(nb[0], nb[1])) continue;
						var c = terrain[nb[0]][nb[1]];
						var step = c === T.mountains ? 1 : (c === T.ocean ? oceanCost : 0);
						var k = idx(nb[0], nb[1]), nd = d0 + step;
						if (nd < dist[k]) {
							dist[k] = nd;
							from[k] = at;
							(buckets[nd] = buckets[nd] || []).push(k);
						}
					}
				}
			}
			return { dist: dist, from: from };
		};
		// cut through along the cheapest way to hex k, then everything joined to it is reached
		var carve = function (r, k, ford) {
			var opened = [];
			for (; k >= 0 && r.dist[k] > 0; k = r.from[k]) {
				var kx = k % cols, ky = (k - kx) / cols;
				if (terrain[kx][ky] === T.mountains) cutPass(kx, ky);
				else if (ford && terrain[kx][ky] === T.ocean) terrain[kx][ky] = map[kx][ky] = T.lake;
				r.dist[k] = 0;
				opened.push(k);
			}
			while (opened.length) {
				var o = opened.pop(), qx = o % cols, qy = (o - qx) / cols;
				for (var dd = 0; dd < 6; dd++) {
					var nb = G.neighbour(qx, qy, dd);
					if (!inside(nb[0], nb[1]) || !G.isPassable(terrain[nb[0]][nb[1]])) continue;
					var nk = idx(nb[0], nb[1]);
					if (r.dist[nk] > 0) { r.dist[nk] = 0; opened.push(nk); }
				}
			}
		};
		// the ship must be reachable, if need be through the shallows
		var res = walk(50);
		if (res.dist[idx(heart[0], heart[1])] > 0) carve(res, idx(heart[0], heart[1]), true);
		// then every walled-off region gets a pass, nearest first
		res = walk(Infinity);
		var order = [];
		for (i = 0; i < cols * rows; i++) {
			if (res.dist[i] > 0 && res.dist[i] < Infinity && G.isPassable(terrain[i % cols][(i - i % cols) / cols])) order.push(i);
		}
		order.sort(function (a, b) { return res.dist[a] - res.dist[b] || a - b; });
		for (i = 0; i < order.length; i++) {
			if (res.dist[order[i]] > 0) carve(res, order[i], false);
		}
		var reachable = new Uint8Array(cols * rows);
		for (i = 0; i < cols * rows; i++) reachable[i] = res.dist[i] === 0 ? 1 : 0;

		// 7. Multi-hex sites, only where the wanderer can walk to them.
		var addSite = function (kind, anchor, size, ok, ground) {
			var hexes = grow(anchor, size, ok);
			if (hexes.length < 3) return false;
			for (var j = 0; j < hexes.length; j++) {
				var h = hexes[j];
				siteAt[idx(h[0], h[1])] = sites.length;
				if (ground) terrain[h[0]][h[1]] = map[h[0]][h[1]] = ground;
			}
			sites.push({ kind: kind, anchor: anchor, hexes: hexes });
			return true;
		};
		var size = function () { return 3 + Math.floor(rand() * 5); };
		// towns and cities of the wasteland become fallen cities; their own events stay on the anchor
		for (i = 0; i < coreSites.length; i++) {
			var a = coreSites[i];
			addSite('fallenCity', a, size(), function (x, y) {
				var sx = x - ox, sy = y - oy;
				return siteAt[idx(x, y)] < 0 && sx >= 0 && sy >= 0 && sx <= 2 * R && sy <= 2 * R &&
					(G.isTerrain(map[x][y]) || (x === a[0] && y === a[1]));
			});
		}
		var siteOk = function (x, y) { return free(x, y) && reachable[idx(x, y)] && land(x, y); };
		var towardHeart = function (power) {
			return function (x, y) {
				return siteOk(x, y) && rand() < Math.pow(1 - G.distance([x, y], heart) / (cols * 0.9), power);
			};
		};
		var place = [
			['crater', c0.crater, towardHeart(3), T.wastes],
			['complex', c0.complex, towardHeart(1.5), null],
			['fallenCity', c0.fallenCity, siteOk, null]
		];
		for (var pl = 0; pl < place.length; pl++) {
			var spc = place[pl];
			for (i = 0; i < spc[1]; i++) {
				var an = pick(spc[2]);
				if (an) addSite(spc[0], an, size(), siteOk, spc[3]);
			}
		}

		// a crater can land on a pass; it is open ground then, not a pass
		passes = passes.filter(function (p) { return terrain[p[0]][p[1]] === T.hills; });

		var out = {
			gen: G.VERSION, seed: seed, cols: cols, rows: rows,
			capital: cap.slice(), warHeart: heart, coreOffset: [ox, oy],
			map: map, terrain: terrain, sites: sites, formations: formations, passes: passes,
			reachable: reachable, siteAt: siteAt, formationAt: formationAt,
			deposits: deposits, pockets: pockets, garrison: -1
		};
		// 8. The garrison of the deep mines (POWERS §2, the first power): the complex nearest home moves to the
		// old wasteland's edge, where a charcoal line can reach it, on its own rng (nothing else moves)
		out.garrison = G._garrison(out);
		out.wardens = typeof Wardens != 'undefined' ? Wardens.place(out) : -1; // the pass wardens' pass (script/powers/wardens.js)
		return out;
	},

	// the water joined to a site's shore: Int32Array(cols*rows), the steps out from the shore (1 on the water
	// beside it), -1 off it
	waterFrom: function (gen, site) {
		var G = WorldGen, cols = gen.cols, rows = gen.rows, steps = new Int32Array(cols * rows).fill(-1), queue = [];
		var visit = function (p, n) {
			var k = p[0] + p[1] * cols;
			if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= rows || steps[k] >= 0 || !G.isWater(gen.terrain[p[0]][p[1]])) return;
			steps[k] = n;
			queue.push(p);
		};
		site.hexes.forEach(function (h) { for (var d = 0; d < 6; d++) visit(G.neighbour(h[0], h[1], d), 1); });
		for (var q = 0; q < queue.length; q++) {
			for (var d = 0; d < 6; d++) visit(G.neighbour(queue[q][0], queue[q][1], d), steps[queue[q][0] + queue[q][1] * cols] + 1);
		}
		return steps;
	},

	FLEET_SIZE: 4,          // provisional: the hulks, chained hull to hull
	FLEET_DANGER: [5, 7],   // POWERS §3: the fleet's band 3

	// the drowned fleet (POWERS §2, #5), the last of the powers to claim a complex: the one nearest the drowned
	// harbour (hb: its site, Network.harbourSite) moves out onto open water joined to the harbour's shore: at
	// FLEET_DANGER, an inland sea's first, nearest the harbour by water, on its own rng. Its hexes are open sea
	// (no one walks to it) and it has no danger spike of its own (site.fleet, Danger.field). Run on the game's
	// world once the harbour is known (Fleet.place), not in generate: the harbour is the game's pick.
	// Returns its index, or -1
	_fleet: function (gen, hb) {
		var G = WorldGen, T = G.TERRAIN, cols = gen.cols, rows = gen.rows;
		if (!hb) return -1;
		var i = -1;
		gen.sites.forEach(function (s, j) {
			// (a power claims its complex with site.power; the garrison's is site.garrison)
			if (s.kind !== 'complex' || s.power || s.garrison) return;
			if (i < 0 || G.distance(s.anchor, hb.anchor) < G.distance(gen.sites[i].anchor, hb.anchor)) i = j;
		});
		if (i < 0) return -1;
		var old = gen.sites[i], steps = G.waterFrom(gen, hb), lo = G.FLEET_DANGER[0], hi = G.FLEET_DANGER[1];
		// the danger read with the complex gone from where it stood (its spike goes with it)
		old.fleet = true;
		var field = Danger.field(gen);
		delete old.fleet;
		var sea = function (k) { var f = gen.formationAt[k]; return f >= 0 && gen.formations[f].kind === 'sea'; };
		var open = function (x, y) {
			var k = x + y * cols;
			return x >= 0 && y >= 0 && x < cols && y < rows && steps[k] > 0 && gen.terrain[x][y] === T.ocean && (gen.siteAt[k] < 0 || gen.siteAt[k] === i);
		};
		// a shallows hex is made deep only where the ground round it stays joined (one run of passable hexes in
		// its ring): no one is cut off by it
		var passable = function (h) { return h[0] >= 0 && h[1] >= 0 && h[0] < cols && h[1] < rows && G.isPassable(gen.terrain[h[0]][h[1]]); };
		var deepens = function (x, y) {
			var runs = 0;
			for (var dd = 0; dd < 6; dd++) {
				if (passable(G.neighbour(x, y, dd)) && !passable(G.neighbour(x, y, (dd + 5) % 6))) runs++;
			}
			return runs <= 1;
		};
		// in the window, then on an inland sea, then open sea (a shallows hex is made deep), then nearest by water
		var spots = [];
		for (var k = 0; k < cols * rows; k++) {
			if (steps[k] <= 0 || (gen.siteAt[k] >= 0 && gen.siteAt[k] !== i)) continue;
			var x = k % cols, y = (k - x) / cols, d = field[k];
			if (gen.terrain[x][y] !== T.ocean && !deepens(x, y)) continue;
			spots.push([x, y, Math.ceil(Math.max(0, lo - d, d - hi) * 4) * 4 + (sea(k) ? 0 : 2) + (gen.terrain[x][y] === T.ocean ? 0 : 1), steps[k]]);
		}
		if (!spots.length) return -1;
		spots.sort(function (a, b) { return a[2] - b[2] || a[3] - b[3] || a[0] - b[0] || a[1] - b[1]; });
		var at = [spots[0][0], spots[0][1]], rand = G.rng(gen.seed ^ 0xF1EE7), dirs = [0, 1, 2, 3, 4, 5];
		for (var di = dirs.length - 1; di > 0; di--) {
			var dj = Math.floor(rand() * (di + 1)), dt = dirs[di];
			dirs[di] = dirs[dj];
			dirs[dj] = dt;
		}
		gen.terrain[at[0]][at[1]] = gen.map[at[0]][at[1]] = T.ocean;
		gen.reachable[at[0] + at[1] * cols] = 0;
		var hexes = [at], has = {};
		has[at[0] + at[1] * cols] = true;
		for (var j = 0; j < hexes.length && hexes.length < G.FLEET_SIZE; j++) {
			dirs.forEach(function (dd) {
				var nb = G.neighbour(hexes[j][0], hexes[j][1], dd);
				if (hexes.length >= G.FLEET_SIZE || has[nb[0] + nb[1] * cols] || !open(nb[0], nb[1])) return;
				has[nb[0] + nb[1] * cols] = true;
				hexes.push(nb);
			});
		}
		// water left beside it for the boats to lie on (a small pond holds a small fleet)
		var lies = function () {
			return hexes.some(function (h) {
				for (var dd = 0; dd < 6; dd++) {
					var p = G.neighbour(h[0], h[1], dd), pk = p[0] + p[1] * cols;
					if (p[0] >= 0 && p[1] >= 0 && p[0] < cols && p[1] < rows && steps[pk] > 0 && !has[pk] && (gen.siteAt[pk] < 0 || gen.siteAt[pk] === i)) return true;
				}
				return false;
			});
		};
		while (hexes.length > 1 && !lies()) {
			var last = hexes.pop();
			delete has[last[0] + last[1] * cols];
		}
		old.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = -1; });
		hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = i; });
		gen.sites[i] = { kind: 'complex', anchor: at, hexes: hexes, fleet: true, power: 'fleet' };
		return i;
	},

	GARRISON_SIZE: 4,      // provisional: its gate and three adits (POWERS §2)
	// provisional: the danger its gate stands at (POWERS §3: 2-4); up to charcoal's cap (F5, Fire.FUELS), so
	// a beacon next to it can be lit before coal (flame-draft "Into the Shafts"): the charcoal frontier, ~20
	// hexes out, inside the old wasteland's square
	GARRISON_DANGER: [3, 3.25],

	// moves the complex nearest the capital to the charcoal frontier: open ground at GARRISON_DANGER that a
	// line can reach from home through ground no more dangerous, nearest home first, hills first; its hexes
	// become hills (the pithead), and it has no danger spike of its own (site.garrison, Danger.field).
	// Returns its index, or -1
	_garrison: function (gen) {
		var G = WorldGen, T = G.TERRAIN, cols = gen.cols, rows = gen.rows, cap = gen.capital;
		var i = -1;
		gen.sites.forEach(function (s, j) {
			if (s.kind === 'complex' && (i < 0 || G.distance(s.anchor, cap) < G.distance(gen.sites[i].anchor, cap))) i = j;
		});
		if (i < 0) return -1;
		var old = gen.sites[i];
		old.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = -1; });
		var field = Danger.field(gen), lo = G.GARRISON_DANGER[0], hi = G.GARRISON_DANGER[1];
		var pass = {}, deposit = {};
		gen.passes.forEach(function (p) { pass[p[0] + p[1] * cols] = true; });
		gen.deposits.forEach(function (d) { deposit[d.at[0] + d.at[1] * cols] = true; });
		var land = function (x, y) {
			var k = x + y * cols;
			return x >= 0 && y >= 0 && x < cols && y < rows && gen.reachable[k] && gen.siteAt[k] < 0 && gen.formationAt[k] < 0 && !pass[k] && !deposit[k] &&
				G.isPassable(gen.terrain[x][y]) && !G.isWater(gen.terrain[x][y]) && gen.terrain[x][y] === gen.map[x][y] &&
				G.distance([x, y], gen.warHeart) > 3;
		};
		var ok = function (x, y) { return land(x, y) && gen.terrain[x][y] === T.hills; };
		// the ground a line can cross on the way: from home, through passable hexes up to that danger
		var near = new Uint8Array(cols * rows), queue = [cap];
		near[cap[0] + cap[1] * cols] = 1;
		for (var q = 0; q < queue.length; q++) {
			for (var dir = 0; dir < 6; dir++) {
				var n = G.neighbour(queue[q][0], queue[q][1], dir), nk = n[0] + n[1] * cols;
				if (n[0] < 0 || n[1] < 0 || n[0] >= cols || n[1] >= rows || near[nk] || field[nk] > hi || !G.isPassable(gen.terrain[n[0]][n[1]])) continue;
				near[nk] = 1;
				queue.push(n);
			}
		}
		// the ground at that danger a line can reach, nearest home first, hills first; a world with none
		// there: out of reach, then the nearest danger to it (by quarters)
		var spots = [];
		for (var y = 0; y < rows; y++) {
			for (var x = 0; x < cols; x++) {
				var d = field[x + y * cols];
				if (land(x, y)) spots.push([x, y, Math.ceil(Math.max(0, lo - d, d - hi) * 4) * 4 + (near[x + y * cols] ? 0 : 2) + (ok(x, y) ? 0 : 1), G.distance([x, y], cap)]);
			}
		}
		spots.sort(function (a, b) { return a[2] - b[2] || a[3] - b[3] || a[0] - b[0] || a[1] - b[1]; });
		// grown from the spot through hills, then open ground, the directions in the site's own order
		// a Fisher-Yates shuffle: a sort with a random comparator isn't one, and Chrome's sort gives such a
		// comparator different orders as it tiers up the code, so the same seed grew different sites
		var rand = G.rng(gen.seed ^ 0x6A11), dirs = [0, 1, 2, 3, 4, 5];
		for (var di = dirs.length - 1; di > 0; di--) {
			var dj = Math.floor(rand() * (di + 1)), dt = dirs[di];
			dirs[di] = dirs[dj];
			dirs[dj] = dt;
		}
		var grow = function (at) {
			var hexes = [at], has = {};
			has[at[0] + at[1] * cols] = true;
			[ok, land].forEach(function (fits) {
				for (var j = 0; j < hexes.length && hexes.length < G.GARRISON_SIZE; j++) {
					dirs.forEach(function (d) {
						var nb = G.neighbour(hexes[j][0], hexes[j][1], d);
						if (hexes.length >= G.GARRISON_SIZE || has[nb[0] + nb[1] * cols] || !fits(nb[0], nb[1])) return;
						has[nb[0] + nb[1] * cols] = true;
						hexes.push(nb);
					});
				}
			});
			return hexes;
		};
		for (var s = 0; s < spots.length && s < 50; s++) {
			var at = [spots[s][0], spots[s][1]], hexes = grow(at);
			if (hexes.length < 3) continue;
			hexes.forEach(function (h) {
				gen.siteAt[h[0] + h[1] * cols] = i;
				gen.terrain[h[0]][h[1]] = gen.map[h[0]][h[1]] = T.hills;
			});
			gen.sites[i] = { kind: 'complex', anchor: at, hexes: hexes, garrison: true };
			return i;
		}
		old.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = i; });
		return -1;
	},

	// A range too thick for a one-hex pass: from open ground at its edge, straight through the
	// peaks to open ground on the far side (at most 5 hexes), cutting every one.
	_tunnel: function (hexes, terrain, cutPass) {
		var G = WorldGen, T = G.TERRAIN;
		var open = function (h) { var col = terrain[h[0]]; return col && col[h[1]] && G.isPassable(col[h[1]]); };
		for (var i = 0; i < hexes.length; i++) {
			var h = hexes[i];
			if (terrain[h[0]][h[1]] !== T.mountains) continue;
			for (var d = 0; d < 6; d++) {
				if (!open(G.neighbour(h[0], h[1], d))) continue;
				var line = [h], at = h;
				for (var s = 0; s < 5; s++) {
					at = G.neighbour(at[0], at[1], (d + 3) % 6);
					if (!terrain[at[0]] || !terrain[at[0]][at[1]] || terrain[at[0]][at[1]] === T.ocean) break;
					if (open(at)) {
						line.forEach(function (p) { cutPass(p[0], p[1]); });
						return;
					}
					line.push(at);
				}
			}
		}
	},

	// true if the hex has passable neighbours on two sides that aren't next to each other
	_throughWay: function (terrain, x, y) {
		var open = [];
		for (var d = 0; d < 6; d++) {
			var n = WorldGen.neighbour(x, y, d), col = terrain[n[0]];
			if (col && col[n[1]] && WorldGen.isPassable(col[n[1]])) open.push(d);
		}
		for (var i = 0; i < open.length; i++) {
			for (var j = i + 1; j < open.length; j++) {
				var gap = open[j] - open[i];
				if (gap >= 2 && gap <= 4) return true;
			}
		}
		return false;
	},

	// the most common wasteland ground around a square-map landmark
	_groundAround: function (squareMap, x, y) {
		var count = {}, best = World.TILE.BARRENS, n = 0;
		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				var col = squareMap[x + dx], c = col && col[y + dy] && col[y + dy].charAt(0);
				if (c === World.TILE.FOREST || c === World.TILE.FIELD || c === World.TILE.BARRENS) {
					count[c] = (count[c] || 0) + 1;
					if (count[c] > n) { n = count[c]; best = c; }
				}
			}
		}
		return best;
	},

	// The fog of war as a base64 bit string, one bit per hex.
	encodeMask: function (mask, cols, rows) {
		var bytes = new Uint8Array(Math.ceil(cols * rows / 8));
		for (var x = 0; x < cols; x++) {
			for (var y = 0; y < rows; y++) {
				if (mask[x][y]) {
					var i = x + y * cols;
					bytes[i >> 3] |= 1 << (i & 7);
				}
			}
		}
		var s = '';
		for (var j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
		return btoa(s);
	},

	decodeMask: function (str, cols, rows) {
		var s = atob(str), mask = new Array(cols);
		for (var x = 0; x < cols; x++) {
			mask[x] = new Array(rows);
			for (var y = 0; y < rows; y++) {
				var i = x + y * cols;
				mask[x][y] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1 ? true : undefined;
			}
		}
		return mask;
	}
};
