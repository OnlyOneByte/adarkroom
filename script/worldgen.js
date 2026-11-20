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
	// shortcut: only version 1 exists; keep old generators around once there is a version 2
	VERSION: 1,

	// provisional -- pending design: world size, capital position, feature counts
	COLS: 160,
	ROWS: 100,
	CAPITAL: [44, 50],
	SQUARE_RADIUS: 30,      // the prologue map's World.RADIUS
	BLEND: 6,               // hexes past the old edge where the wasteland fades out
	COUNTS: {
		range: 10, forest: 8, sea: 5, desert: 4,     // natural formations
		crater: 14, fallenCity: 40, complex: 8       // sites outside the old wasteland
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

	/*
	 * Builds the hex world. squareMap is the prologue map (61x61, World.TILE codes,
	 * '!' marks visited); it must not be modified. Returns:
	 *   cols, rows, capital, warHeart
	 *   map[x][y]      World.TILE code or terrain glyph, like the square map
	 *   terrain[x][y]  the ground under every hex (deposits sit on hills)
	 *   sites[]        { kind, anchor:[x,y], hexes:[[x,y]...] } multi-hex sites
	 *   formations[]   { kind, hexes:[[x,y]...] } multi-hex natural formations
	 *   siteAt, formationAt  Int16Array(cols*rows) index into the lists above, -1 none
	 *   coreOffset     [dx, dy] from square to hex coordinates
	 */
	generate: function (seed, squareMap) {
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
				// war scars, denser toward the heart
				var near = Math.max(0, 1 - G.distance([x, y], heart) / heartReach);
				if (c !== T.ocean && c !== T.mountains && scar(x, y) < near * near * 0.95) c = T.wastes;
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
		var coreSites = [];
		for (x = 0; x <= 2 * R; x++) {
			for (y = 0; y <= 2 * R; y++) {
				var cell = squareMap[x][y], code = cell.charAt(0), hx = x + ox, hy = y + oy;
				var ground = waste.indexOf(code) >= 0 ? code : null;
				if (code === World.TILE.SHIP) {
					ship = cell;
					cell = null;
				}
				if (code === World.TILE.IRON_MINE || code === World.TILE.COAL_MINE || code === World.TILE.SULPHUR_MINE) {
					ground = T.hills; // deposits sit on hills
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

		// 6. Multi-hex sites.
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
		var siteOk = function (x, y) { return free(x, y) && land(x, y) && terrain[x][y] !== T.mountains; };
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

		return {
			gen: G.VERSION, seed: seed, cols: cols, rows: rows,
			capital: cap.slice(), warHeart: heart, coreOffset: [ox, oy],
			map: map, terrain: terrain, sites: sites, formations: formations,
			siteAt: siteAt, formationAt: formationAt
		};
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
