/**
 * Power 2: the cinder riders (design/drafts/POWERS.md #2, approved; design/text/blaze-draft.md "Power 2",
 * approved; its Q: lines as recommended, design/text/blaze-build.md rulings). One entry in Powers.LIST, and
 * the hooks its puzzle needs, put on the framework from outside (script/powers.js is not changed).
 *
 * Their puzzle: no walls, no siege; they ride away. They live on the desert's three wells. While a well is
 * still theirs, an army that camps at their tents finds them gone. A well is ours while a beacon stands lit
 * on it and the mirrors (B9) carry the light over the open sand; with all three ours the camp must stand,
 * and the storm is the wanderer's fight. When the storm opens they break for the sand: tanglers (bolas)
 * stop them, or they get away. An unlit desert march drinks: water casks (siege gear) carry the army further.
 *
 * Broken (Powers.breakIt): F10 (pitch, either path with the tar-keepers' oath, Network.BEATS); their fall
 * also ends the tar-keepers' clear quest if it is still open (the raiders at the pits were their outriders).
 *
 * The rules at the top are pure (no DOM, no state), so the simulator (tools/sim-power-riders.js) loads this
 * file too. Every number is provisional, tuned with `npm run sim`.
 *
 * Saved state, game.powers.riders (each field defaulted when read):
 *   { seen, met, wells { 'x,y': true (its scene played) }, held (wells ours last tick), broken, way }
 * The site and its wells come from the generator (WorldGen._riders: site.riders, site.wells), not the save.
 */
var Riders = {
	ID: 'riders',
	SIZE: 3,              // provisional: the camp's hexes (tents round a well)
	DANGER: [4, 5],       // provisional: the camp's danger (POWERS §3: band 2, 3-5; band 2 starts at 4)
	MIN_OUT: 12,          // provisional: no nearer home than this (the old wasteland's edge is the garrison's)
	WELLS: 3,             // blaze-draft Q: 3 wells, like the adits
	WELL_RANGE: [3, 6],   // provisional: hexes from the camp's anchor
	WELL_GAP: 3,          // provisional: wells at least this far apart
	CASK_WATER: 100,      // provisional: water a cask carries (10 soldiers' skins)

	POWER: {
		// headStart: blaze-draft Q, "send them into the desert" gives pitch (Powers.HEAD_START), as the garrison's coal
		id: 'riders', name: _('the cinder riders'), unlock: 'F10', headStart: 'pitch',
		anchor: function () { var s = Riders.siteOf(World.hex && World.hex.gen); return s && s.anchor; },
		known: function () { return !!Riders.state().met; },
		// POWERS §3, band 2: 60 riders, no walls; their stores are the wells (an army only camps on them once
		// the wells are ours, so the camp stands and is stormed)
		garrison: 60, walls: 0, kind: 'none', stores: 60,
		might: 0.6,           // provisional: damage a rider a second (a city-state's at band 2 is 0.6)
		// the storm: salvaged rifles and bayonets, mounted
		storm: { chara: 'R', damage: 6, hit: 0.5, delay: 2 },  // provisional
		joiners: 10           // provisional: riders who join you when you take them in
	},

	// the riders' site in a generated world, or null
	siteOf: function (gen) {
		return gen && gen.riders >= 0 ? gen.sites[gen.riders] : null;
	},

	/*
	 * Where they are (pure, WorldGen.generate's last step). The old-world complex nearest home that no other
	 * power has moved becomes their camp: desert at Riders.DANGER that an army can walk to, nearest home
	 * first (barrens, then other open ground, made desert, where a world has no desert there). Its own rng;
	 * nothing else moves. The camp has no danger spike (Danger.field, below): they are low-tech. Its three
	 * wells go on the open sand around it (site.wells). The city-states are placed on the world as it was
	 * before the move (CityStates.place, below), so they stand where they did, and the camp and the wells keep
	 * off their land. Returns the site's index, or -1.
	 */
	place: function (gen) {
		var G = WorldGen, T = G.TERRAIN, cols = gen.cols, rows = gen.rows, cap = gen.capital, R = Riders;
		var i = -1;
		gen.sites.forEach(function (s, j) {
			if (s.kind === 'complex' && !s.garrison && !s.power && (i < 0 || G.distance(s.anchor, cap) < G.distance(gen.sites[i].anchor, cap))) i = j;
		});
		if (i < 0) return -1;
		var old = gen.sites[i], theirs = R.csLand(gen);
		old.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = -1; });
		var field = Danger.field(Object.assign({}, gen, { sites: gen.sites.filter(function (s, j) { return j !== i; }) }));
		var pass = {}, deposit = {};
		gen.passes.forEach(function (p) { pass[p[0] + p[1] * cols] = true; });
		gen.deposits.forEach(function (d) { deposit[d.at[0] + d.at[1] * cols] = true; });
		var inside = function (x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; };
		// open ground: walkable from home, off every site, pass, deposit and city-state, and not next to a site
		var land = function (x, y) {
			var k = x + y * cols;
			if (!inside(x, y) || !gen.reachable[k] || gen.siteAt[k] >= 0 || pass[k] || deposit[k] || theirs[k] || gen.terrain[x][y] !== gen.map[x][y] ||
				!G.isPassable(gen.terrain[x][y]) || G.isWater(gen.terrain[x][y]) || G.distance([x, y], gen.warHeart) <= 3) return false;
			for (var d = 0; d < 6; d++) {
				var n = G.neighbour(x, y, d);
				if (inside(n[0], n[1]) && gen.siteAt[n[0] + n[1] * cols] >= 0) return false;
			}
			return true;
		};
		// the camp itself also keeps off the natural formations (no site stands on one); its wells needn't
		var campLand = function (x, y) { return land(x, y) && gen.formationAt[x + y * cols] < 0; };
		var sand = function (x, y) { return gen.terrain[x][y] === T.desert ? 0 : gen.terrain[x][y] === T.barrens ? 1 : 2; };
		var lo = R.DANGER[0], hi = R.DANGER[1], spots = [];
		for (var y = 0; y < rows; y++) {
			for (var x = 0; x < cols; x++) {
				var d = field[x + y * cols];
				if (!campLand(x, y) || G.distance([x, y], cap) < R.MIN_OUT) continue;
				spots.push([x, y, Math.ceil(Math.max(0, lo - d, d - hi) * 4) * 4 + sand(x, y), G.distance([x, y], cap)]);
			}
		}
		spots.sort(function (a, b) { return a[2] - b[2] || a[3] - b[3] || a[0] - b[0] || a[1] - b[1]; });
		var rand = G.rng(gen.seed ^ 0xC1DE), dirs = R.shuffle([0, 1, 2, 3, 4, 5], rand);
		for (var s = 0; s < spots.length && s < 50; s++) {
			var at = [spots[s][0], spots[s][1]], hexes = [at], has = {};
			has[at[0] + at[1] * cols] = true;
			for (var j = 0; j < hexes.length && hexes.length < R.SIZE; j++) {
				dirs.forEach(function (dd) {
					var nb = G.neighbour(hexes[j][0], hexes[j][1], dd);
					if (hexes.length >= R.SIZE || has[nb[0] + nb[1] * cols] || !campLand(nb[0], nb[1])) return;
					has[nb[0] + nb[1] * cols] = true;
					hexes.push(nb);
				});
			}
			if (hexes.length < 3) continue;
			// (where it was, and the ground it made desert: R.before)
			var site = { kind: 'complex', anchor: at, hexes: hexes, power: 'riders', riders: true, from: old, ground: [] };
			site.wells = R.wellsOf(gen, site, rand, land, sand);
			hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = i; });
			// a camp on other ground is made desert, and so are its wells
			if (sand(at[0], at[1]) > 0) {
				hexes.concat(site.wells).forEach(function (h) {
					site.ground.push([h[0], h[1], gen.terrain[h[0]][h[1]], gen.map[h[0]][h[1]]]);
					gen.terrain[h[0]][h[1]] = gen.map[h[0]][h[1]] = T.desert;
				});
			}
			gen.sites[i] = site;
			return i;
		}
		old.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = i; });
		return -1;
	},

	// the world as it was before the riders moved in (pure): their complex where the generator first put it,
	// the ground it made desert as it was. gen itself is not changed
	before: function (gen) {
		var i = gen.riders, s = gen.sites[i], cols = gen.cols;
		var siteAt = gen.siteAt.slice(), terrain = gen.terrain.slice(), map = gen.map.slice();
		s.hexes.forEach(function (h) { siteAt[h[0] + h[1] * cols] = -1; });
		s.from.hexes.forEach(function (h) { siteAt[h[0] + h[1] * cols] = i; });
		s.ground.forEach(function (g) {
			if (terrain[g[0]] === gen.terrain[g[0]]) terrain[g[0]] = terrain[g[0]].slice();
			if (map[g[0]] === gen.map[g[0]]) map[g[0]] = map[g[0]].slice();
			terrain[g[0]][g[1]] = g[2];
			map[g[0]][g[1]] = g[3];
		});
		var sites = gen.sites.slice();
		sites[i] = s.from;
		return Object.assign({}, gen, { sites: sites, siteAt: siteAt, terrain: terrain, map: map, riders: -1 });
	},

	// the city-states' land and the hexes next to it (pure): CityStates.place on this world, Uint8Array
	csLand: function (gen) {
		var G = WorldGen, cols = gen.cols, out = new Uint8Array(cols * gen.rows);
		if (typeof CityStates == 'undefined') return out;
		var field = Danger.field(gen);
		CityStates.place(gen, function (x, y) { return Danger.at(field, cols, x, y, 'normal'); }, function (x, y) {
			return gen.map[x][y] === World.TILE.VILLAGE;
		}).forEach(function (c) {
			c.land.forEach(function (h) {
				out[h[0] + h[1] * cols] = 1;
				for (var d = 0; d < 6; d++) {
					var n = G.neighbour(h[0], h[1], d);
					if (n[0] >= 0 && n[1] >= 0 && n[0] < cols && n[1] < gen.rows) out[n[0] + n[1] * cols] = 1;
				}
			});
		});
		return out;
	},

	// a Fisher-Yates shuffle on the given rng (a sort with a random comparator isn't one: hexmap.spec.js:132)
	shuffle: function (a, rand) {
		for (var i = a.length - 1; i > 0; i--) {
			var j = Math.floor(rand() * (i + 1)), t = a[i];
			a[i] = a[j];
			a[j] = t;
		}
		return a;
	},

	// the three wells (pure): open ground WELL_RANGE from the camp, sand first, WELL_GAP apart (closer if the
	// ground leaves no room), in the rng's order
	wellsOf: function (gen, site, rand, land, sand) {
		var G = WorldGen, R = Riders, a = site.anchor, cands = [];
		for (var dy = -R.WELL_RANGE[1]; dy <= R.WELL_RANGE[1]; dy++) {
			for (var dx = -R.WELL_RANGE[1] - 1; dx <= R.WELL_RANGE[1] + 1; dx++) {
				var p = [a[0] + dx, a[1] + dy], d = G.distance(p, a);
				if (d >= R.WELL_RANGE[0] && d <= R.WELL_RANGE[1] && land(p[0], p[1])) cands.push(p);
			}
		}
		cands.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
		R.shuffle(cands, rand);
		cands.sort(function (p, q) { return sand(p[0], p[1]) - sand(q[0], q[1]); });
		var out = [];
		for (var gap = R.WELL_GAP; gap >= 1 && out.length < R.WELLS; gap--) {
			cands.forEach(function (p) {
				if (out.length < R.WELLS && out.every(function (w) { return G.distance(w, p) >= gap; })) out.push(p);
			});
		}
		return out;
	},

	// the wells ours (pure): lit(x, y) a lit beacon stands there; mirrors: B9 is in
	heldOf: function (wells, lit, mirrors) {
		return mirrors ? wells.filter(function (w) { return lit(w[0], w[1]); }).length : 0;
	},

	// the storm's opening (pure): the bolas go out after them, a tangler's throw each, or they get away.
	// Returns true if they were caught
	caught: function (army) {
		return Powers.volley(army, 'bolas').n > 0;
	}
};

// the framework's own lists, from outside: the power, the generator's step, the camp's missing spike, the cask
Powers.LIST.push(Riders.POWER);
WorldGen._riders = Riders.place;
Armies.GEAR['water cask'] = { 'leather': 50, 'iron': 10 };  // provisional (the wanderer's cask: 100 leather, 20 iron)
(function (field) {
	Danger.field = function (gen) {
		return gen.sites.some(function (s) { return s.riders; }) ? field(Object.assign({}, gen, { sites: gen.sites.filter(function (s) { return !s.riders; }) })) : field(gen);
	};
})(Danger.field);

/*
 * The game side: state, and the hooks the puzzle needs on the trek, the march, the siege and the storm, each
 * one a wrapper that lets every other power through. Nothing here runs at load but the wrapping.
 */
(function (game) {
	for (var k in game) Riders[k] = game[k];
})({
	state: function () {
		return $SM.get(Powers.path(Riders.ID)) || {};
	},

	set: function (k, v) {
		$SM.set(Powers.path(Riders.ID) + '.' + k, v, true);
	},

	site: function () {
		return Riders.siteOf(World.hex && World.hex.gen);
	},

	wells: function () {
		var s = Riders.site();
		return s ? s.wells : [];
	},

	wellAt: function (x, y) {
		return Riders.wells().filter(function (w) { return w[0] === x && w[1] === y; })[0] || null;
	},

	// a lit beacon on the hex
	litBeacon: function (x, y) {
		var fire = World.hex && World.hex.fire;
		return Network.beaconAt(x, y) && !!(fire && fire.lit[x + y * World.hex.gen.cols]);
	},

	// the wells ours now: a lit beacon on each, the mirrors carrying the light over the sand
	held: function () {
		return Riders.heldOf(Riders.wells(), Riders.litBeacon, Network.has('B9'));
	},

	allHeld: function () {
		return Riders.wells().length > 0 && Riders.held() >= Riders.wells().length;
	},

	army: function () {
		return Armies.list().filter(function (a) { return a.power === Riders.ID; })[0] || null;
	},

	/*
	 * Each fire tick (before the armies'): a well won is told; a well a beacon lit is told with its scene,
	 * at home
	 */
	watch: function () {
		var R = Riders, st = R.state();
		if (!st.seen || st.broken) return;
		var n = R.held(), total = R.wells().length, was = st.held || 0;
		if (n !== was) {
			R.set('held', n);
			if (n > was) Notifications.notify(null, n >= total ? _('the last well is ours. they have nowhere to ride.') : _('a well is ours. {0} still theirs.', total - n));
		}
		R.wells().forEach(function (w) {
			var k = w[0] + ',' + w[1];
			if ((st.wells || {})[k] || !R.litBeacon(w[0], w[1]) || R._telling[k]) return;
			R._telling[k] = true;
			CityStates.queue(function () {
				R._telling[k] = false;
				if (!(R.state().wells || {})[k]) Events.startEvent(Events.PowersRiders.well(w));
			});
		});
	},
	_telling: {},

	// a well's scene played: it is found
	found: function (w) {
		Riders.set('wells["' + w[0] + ',' + w[1] + '"]', true);
	},

	// out on a trek: the dust seen, the army waiting at the camp, the camp, a well. true if a scene started.
	// Not before the garrison is broken (F8): it is the first power (POWERS §2)
	onStep: function (x, y) {
		var R = Riders, st = R.state(), s = R.site(), E = Events.PowersRiders;
		if (!s || st.broken || Events.activeEvent() || !Network.has('F8')) return false;
		if (!st.seen && s.hexes.some(function (h) { return Fire.distance(h, [x, y]) <= World.LIGHT_RADIUS; })) {
			Events.startEvent(E.dust());
			return true;
		}
		var a = R.army();
		if (a && a.siege && a.siege.over && a.siege.over.breach && (WorldGen.distance(a.at, [x, y]) <= 1 || World.siteAt(x, y) === s)) {
			Events.startEvent(E.storm(a.id));
			return true;
		}
		if (!st.met && World.siteAt(x, y) === s) {
			Events.startEvent(E.camp());
			return true;
		}
		var w = R.wellAt(x, y);
		if (w && !(st.wells || {})[x + ',' + y]) {
			Events.startEvent(E.well(w));
			return true;
		}
		return false;
	},

	/*
	 * The siege: while a well is theirs the camp is empty and the army waits there, drinking; once all three
	 * are ours they come back and the camp stands (no walls: the first tick is the breach, and the storm waits
	 * for the wanderer). A well lost again sends them back out to the sand.
	 */
	besiege: function (a) {
		var A = Armies, s = a.siege;
		if (s.over && s.over.storming) return;
		if (!Riders.allHeld()) {
			if (!s.away) {
				s.away = true;
				s.over = null;
				Notifications.notify(null, _("the riders rode off. they'll be at the wells."));
			}
			A.supply(a, a.at, 1);
			if (!A.soldiers(a)) return A.lostArmy(a);
			A.set(a);
			$SM.fireUpdate('game.armies');
			return;
		}
		if (s.away) {
			s.away = false;
			s.asked = s.ticks;
			A.set(a);
			CityStates.queue(function () { if (A.byId(a.id)) Events.startEvent(Events.Armies.camp(a.id)); });
		}
		return Riders._besiege(a);
	},

	// they got away from the storm (no tanglers): the camp stands again, the storm waits for the wanderer
	escaped: function (id) {
		var a = Armies.byId(id);
		if (!a || !a.siege) return;
		a.siege.over = { breach: true, told: true };
		Armies.set(a);
	},

	// the aftermath (Powers.breakIt does the rest): the tar-keepers' clear quest ends with them
	freeTarKeepers: function () {
		var CS = CityStates, c = CS.get() && CS.list().filter(function (c) { return c.t === 'tar_keepers'; })[0];
		if (!c) return;
		var st = CS.state(c.id);
		if (st.city || st.quest) return;
		CS.queue(function () { CS.questDone(c); });
	},

	// hover: the camp once seen, a well once the riders told of them (or its scene played)
	label: function (x, y) {
		var R = Riders, st = R.state(), s = R.site();
		if (!s || !st.seen || st.broken) return '';
		if (World.siteAt(x, y) === s) return _('the&nbsp;cinder&nbsp;riders.&nbsp;dust,&nbsp;and&nbsp;fires&nbsp;at&nbsp;night.');
		return R.wellAt(x, y) && (st.met || (st.wells || {})[x + ',' + y]) ? _('a&nbsp;well') : '';
	}
});

// the wrappers (each lets every other power, army and hex through; the simulator has no Network)
(function (R, A, P) {
	var update = A.update, besiege = A.besiege, send = A.send, status = A.status;
	R._besiege = besiege;
	A.update = function () {
		if (World.hex && $SM.get('game.powers')) R.watch();
		return update.apply(A, arguments);
	};
	A.besiege = function (a) {
		return a.power === R.ID ? R.besiege(a) : besiege.apply(A, arguments);
	};
	// the casks' water goes with the army
	A.send = function () {
		var ok = send.apply(A, arguments), list = A.list(), a = ok && list[list.length - 1];
		if (a && (a.gear || {})['water cask'] > 0) {
			a.water += a.gear['water cask'] * R.CASK_WATER;
			A.set(a);
		}
		return ok;
	};
	A.status = function (a) {
		if (a.power !== R.ID || a.state !== 'siege') return status.apply(A, arguments);
		return a.siege.away ? _('the army waits at the empty camp. {0}. the riders are out at the wells.', A.men(A.soldiers(a))) :
			_("the army is camped at the riders' tents. {0}. the riders wait, mounted.", A.men(A.soldiers(a)));
	};
	// the city-states stand where they would with the riders' complex unmoved (danger at normal, as asked)
	var place = CityStates.place;
	CityStates.place = function (gen, danger, taken) {
		var s = R.siteOf(gen);
		if (!s || !s.from) return place.apply(CityStates, arguments);
		var old = R.before(gen), field = Danger.field(old);
		return place.call(CityStates, old, function (x, y) { return Danger.at(field, old.cols, x, y, 'normal'); }, taken);
	};
	var onStep = P.onStep, tellEnd = P.tellEnd, breakIt = P.breakIt;
	P.onStep = function (x, y) {
		if ($SM.get('game.powers') && R.onStep(x, y)) return;
		return onStep.apply(P, arguments);
	};
	P.tellEnd = function (a) {
		if (a.power !== R.ID) return tellEnd.apply(P, arguments);
		var o = a.siege.over;
		if (o.breach && !o.told) {
			o.told = true;
			A.set(a);
			Notifications.notify(null, _('the riders wait at the camp, mounted. the army waits for the wanderer.'));
		}
	};
	P.breakIt = function (armyId) {
		var a = A.byId(armyId), ours = !!a && a.power === R.ID, ok = breakIt.apply(P, arguments);
		if (ok && ours) R.freeTarKeepers();
		return ok;
	};
	if (typeof Network == 'undefined') return;
	// the map: the camp and its wells named on hover (a beacon on a well after its name), a known well bold
	var note = Network.hexNote, glyph = CityStates.glyphAt;
	Network.hexNote = function (x, y) {
		var l = World.hex && R.label(x, y);
		if (!l) return note.apply(Network, arguments);
		var b = R.wellAt(x, y) && note.apply(Network, arguments);
		return b ? l + ',&nbsp;' + b : l;
	};
	CityStates.glyphAt = function (x, y) {
		var g = glyph.apply(CityStates, arguments);
		if (g || !World.hex || !R.wellAt(x, y) || !R.label(x, y)) return g;
		return [World.hex.gen.terrain[x][y], true];
	};
})(Riders, Armies, Powers);
