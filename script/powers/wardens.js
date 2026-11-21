/**
 * The pass wardens, the third power (design/drafts/POWERS.md #3, §2-§3; design/text/blaze-draft.md "Power 3",
 * approved; the counter-siege an outlast quest, as ruled on blaze-draft's Q). An artillery battery that never
 * stood down, on a mountain pass at band 2.
 *
 * Its puzzle: the guns on the heights outrange everything, so a siege from below loses a squad a tick. A
 * trek finds the goat path (a hidden ledge next to the battery, found only on foot); the army climbs it
 * from its camp in the dark, every step unlit, and storms the guns from behind. Then it holds the pass
 * through the counter-siege: a lit beacon on the pass (or next to the battery) kept burning while the rest
 * of them come up in waves. Held, it fires Fire.unlock('B10').
 *
 * Built on the power framework (script/powers.js) without changing it: its entry is in Powers.LIST, and
 * here the hooks the garrison hard-wires (the siege's tick, its end, the trek's steps, the camp's scene,
 * the map's words) are wrapped, each passing anything that isn't the wardens' on to the garrison's.
 *
 * The rules at the top are pure (no DOM, no state), so the simulator (tools/sim-power-wardens.js) loads this
 * file too. Every number is provisional, tuned with `npm run sim`.
 *
 * Saved state, game.powers.wardens (defaulted lazily, no save version):
 *   { sighted, gate, path (the goat path found), broken, way }
 * and on the army: a.siege.dark { path } (the climb), a.siege.over.counter { lit, ticks, waves, held }
 * (the counter-siege), a.siege.over.held (won; its scenes wait).
 */
var Wardens = {
	ID: 'wardens',
	// provisional: the danger its pass stands at (POWERS §3: 4-5, band 2)
	DANGER: [4, 5],
	SIZE: 3,               // provisional: the battery's hexes, its gate and the heights the guns stand on
	CLIMB: 4,              // provisional: the longest climb from the foot of the pass to the goat path
	REACH: 6,              // coal's reach (Fire.FUELS, F8, the blaze era's floor): the pass on ground it can light

	// POWERS §3, band 2: 50 + guns, cannon (15 at range); the pass and the height are its walls
	SQUAD: 10,             // POWERS §2: a siege from below loses a squad a tick (mantlets halve it)
	WAVES: [12, 12, 11],   // provisional: the rest of the 50 (the storm finds 15 at the guns), wave by wave
	HOLD: 60,              // the outlast quest's hold (CityStates.LIGHT_HOLD: ten minutes of ticks)
	WAVE_AT: [15, 35, 50], // provisional: ticks of the hold a wave comes at

	/*
	 * Where it stands (pure, from WorldGen.generate): at the foot of a mountain pass (else under the mountains),
	 * at DANGER, on ground a coal line can cross from home, nearest home first (a world with none there: the
	 * nearest danger to it, by quarters). The battery is SIZE hexes of open ground grown from its gate, made
	 * hills (the heights); like every site it is walkable and off the formations, so not on the pass itself.
	 * The goat path is a mountain hex beside the battery, made a hill ledge, climbed from the foot in at most
	 * CLIMB hexes without crossing the battery and opening no new ground, best one that leads nowhere else.
	 * The complex nearest the gate moves there (the garrison's and any other power's stay), on its own rng;
	 * nothing else moves. Returns its index in gen.sites, or -1.
	 */
	place: function (gen) {
		var G = WorldGen, T = G.TERRAIN, W = Wardens, cols = gen.cols, rows = gen.rows, cap = gen.capital;
		var k = function (h) { return h[0] + h[1] * cols; };
		var inside = function (x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; };
		var around = function (h) {
			var out = [];
			for (var d = 0; d < 6; d++) {
				var n = G.neighbour(h[0], h[1], d);
				if (inside(n[0], n[1])) out.push(n);
			}
			return out;
		};
		var mountain = function (h) { return gen.terrain[h[0]][h[1]] === T.mountains && gen.siteAt[k(h)] < 0; };
		var deposit = {};
		gen.deposits.forEach(function (d) { deposit[k(d.at)] = true; });
		var field = Danger.field(gen), lo = W.DANGER[0], hi = W.DANGER[1];
		var rand = G.rng(gen.seed ^ 0x9A55), dirs = [0, 1, 2, 3, 4, 5];
		for (var di = dirs.length - 1; di > 0; di--) {
			var dj = Math.floor(rand() * (di + 1)), dt = dirs[di];
			dirs[di] = dirs[dj];
			dirs[dj] = dt;
		}
		// the ground a coal line can cross from home (passable, up to REACH): an army reaches it lit
		var near = new Uint8Array(cols * rows), queue = [cap];
		near[k(cap)] = 1;
		for (var q = 0; q < queue.length; q++) {
			around(queue[q]).forEach(function (n) {
				if (near[k(n)] || field[k(n)] > W.REACH || !G.isPassable(gen.terrain[n[0]][n[1]])) return;
				near[k(n)] = 1;
				queue.push(n);
			});
		}
		// open ground a site may take: reachable, off every formation, site, pass, deposit and landmark
		var pass = {}, spots = [];
		gen.passes.forEach(function (p) { pass[k(p)] = true; });
		var land = function (h) {
			var x = h[0], y = h[1], c = gen.terrain[x][y];
			return gen.reachable[k(h)] && gen.siteAt[k(h)] < 0 && gen.formationAt[k(h)] < 0 && !pass[k(h)] && !deposit[k(h)] &&
				G.isPassable(c) && !G.isWater(c) && c === gen.map[x][y] && G.distance(h, gen.warHeart) > 3;
		};
		var hills = function (h) { return land(h) && gen.terrain[h[0]][h[1]] === T.hills; };
		// the gate at the foot of a cut pass first, else under the mountains; at DANGER, on that ground, nearest home
		for (var y = 0; y < rows; y++) {
			for (var x = 0; x < cols; x++) {
				var p = [x, y], d = field[k(p)];
				if (!land(p)) continue;
				var byPass = around(p).some(function (h) { return pass[k(h)]; });
				if (!byPass && !around(p).some(mountain)) continue;
				spots.push([p, Math.ceil(Math.max(0, lo - d, d - hi) * 4) * 4 + (near[k(p)] ? 0 : 2) + (byPass ? 0 : 1), G.distance(p, cap)]);
			}
		}
		spots.sort(function (a, b) { return a[1] - b[1] || a[2] - b[2] || a[0][0] - b[0][0] || a[0][1] - b[0][1]; });
		for (var s = 0; s < spots.length; s++) {
			var at = spots[s][0], own = {}, hexes = [at];
			own[k(at)] = true;
			// the battery: grown from the gate through hills, then open ground, in the site's own order
			[hills, land].forEach(function (fits) {
				for (var j = 0; j < hexes.length && hexes.length < W.SIZE; j++) {
					dirs.forEach(function (d) {
						var h = G.neighbour(hexes[j][0], hexes[j][1], d);
						if (hexes.length >= W.SIZE || !inside(h[0], h[1]) || own[k(h)] || !fits(h)) return;
						own[k(h)] = true;
						hexes.push(h);
					});
				}
			});
			if (hexes.length < W.SIZE) continue;
			// the foot: the gate's open neighbour nearest home (where the army camps)
			var foot = around(at).filter(function (h) { return !own[k(h)] && G.isPassable(gen.terrain[h[0]][h[1]]) && gen.reachable[k(h)]; })
				.sort(function (a, b) { return G.distance(a, cap) - G.distance(b, cap) || a[0] - b[0] || a[1] - b[1]; })[0];
			if (!foot) continue;
			// the goat path: a mountain beside the battery, climbed from the foot off the battery; it opens no new
			// ground (every open hex by it is reachable already), best a ledge that leads nowhere else
			var best = null;
			hexes.forEach(function (h) {
				around(h).forEach(function (g) {
					// (never beside the gate: the army camps there)
					if (own[k(g)] || !mountain(g) || G.distance(g, at) <= 1 || around(g).some(function (n) { return !own[k(n)] && G.isPassable(gen.terrain[n[0]][n[1]]) && !gen.reachable[k(n)]; })) return;
					var climb = W.climb(gen, foot, g, function (x, y) { return own[x + y * cols]; }, W.CLIMB, true);
					if (!climb) return;
					var score = climb.length + (W.deadEnd(gen, g, own) ? 0 : 20);
					if (!best || score < best.score) best = { at: g, score: score };
				});
			});
			if (!best) continue;
			// the complex nearest the pass moves to it
			var i = -1;
			gen.sites.forEach(function (c, j) {
				if (c.kind === 'complex' && !c.garrison && !c.power && (i < 0 || G.distance(c.anchor, at) < G.distance(gen.sites[i].anchor, at))) i = j;
			});
			if (i < 0) return -1;
			gen.sites[i].hexes.forEach(function (h) { gen.siteAt[k(h)] = -1; });
			hexes.forEach(function (h) {
				gen.siteAt[k(h)] = i;
				gen.terrain[h[0]][h[1]] = gen.map[h[0]][h[1]] = T.hills; // the heights
			});
			var g = best.at;
			gen.terrain[g[0]][g[1]] = gen.map[g[0]][g[1]] = T.hills;
			gen.reachable[k(g)] = 1;
			gen.sites[i] = { kind: 'complex', anchor: at.slice(), hexes: hexes, power: W.ID, wardens: true, foot: foot, goat: g.slice() };
			return i;
		}
		return -1;
	},

	// the ledge leads nowhere but up to the guns: its open neighbours (off the battery) touch one another
	deadEnd: function (gen, g, own) {
		var G = WorldGen, cols = gen.cols, open = [];
		for (var d = 0; d < 6; d++) {
			var n = G.neighbour(g[0], g[1], d);
			var ok = n[0] >= 0 && n[1] >= 0 && n[0] < cols && n[1] < gen.rows && !own[n[0] + n[1] * cols] && G.isPassable(gen.terrain[n[0]][n[1]]);
			open.push(ok && gen.reachable[n[0] + n[1] * cols] ? 1 : ok ? 2 : 0);
		}
		if (open.indexOf(2) >= 0 || open.indexOf(1) < 0) return false;
		var runs = 0;
		for (var j = 0; j < 6; j++) if (open[j] && !open[(j + 5) % 6]) runs++;
		return runs <= 1;
	},

	// the climb (pure): the fewest hexes on foot from one hex to another, off the hexes blocked(x, y), at most
	// max (none: any); toMountain: the last hex may still be mountain (the ledge before it is cut).
	// [[x, y]] after `from`, or null
	climb: function (gen, from, to, blocked, max, toMountain) {
		var G = WorldGen, cols = gen.cols, prev = {}, depth = {};
		var start = from[0] + from[1] * cols, goal = to[0] + to[1] * cols, q = [start];
		prev[start] = start;
		depth[start] = 0;
		for (var i = 0; i < q.length && prev[goal] === undefined; i++) {
			var x = q[i] % cols, y = (q[i] - x) / cols;
			if (max && depth[q[i]] >= max) continue;
			for (var d = 0; d < 6; d++) {
				var nb = G.neighbour(x, y, d), j = nb[0] + nb[1] * cols;
				if (nb[0] < 0 || nb[1] < 0 || nb[0] >= cols || nb[1] >= gen.rows || prev[j] !== undefined) continue;
				if (!(j === goal && toMountain) && (!G.isPassable(gen.terrain[nb[0]][nb[1]]) || blocked(nb[0], nb[1]))) continue;
				prev[j] = q[i];
				depth[j] = depth[q[i]] + 1;
				q.push(j);
			}
		}
		if (prev[goal] === undefined) return null;
		var path = [];
		for (var c = goal; c !== start; c = prev[c]) path.unshift([c % cols, (c - c % cols) / cols]);
		return path;
	},

	/*
	 * The siege and the hold (pure pieces the game and the simulator share)
	 */
	// a tick of the siege from below: the guns on the heights take a squad (mantlets halve it). Returns the lost
	guns: function (army) {
		return Armies.kill(army, Wardens.SQUAD * Armies.shield(army));
	},

	// the counter-siege's hold (the outlast quest): c { ticks, lit, waves, men (who held the battery) }; lit:
	// the beacon on the pass burns this tick. A wave comes at its tick, beaten back like a sally while the beacon
	// burns; the beacon dark once lit, or at a wave, loses it; so does the army breaking. Returns
	// { wave: { n, lost }, half, fail ('dark' | 'broken'), held }
	hold: function (c, army, lit, P) {
		var W = Wardens, A = Armies, out = {};
		c.ticks++;
		if (lit) {
			c.lit++;
			if (c.lit === W.HOLD / 2) out.half = true;
		} else if (c.lit > 0) {
			out.fail = 'dark';
			return out;
		}
		if (c.waves < W.WAVES.length && c.ticks >= W.WAVE_AT[c.waves]) {
			if (!lit) {
				out.fail = 'dark';
				return out;
			}
			var n = W.WAVES[c.waves++];
			out.wave = { n: n, lost: A.kill(army, n * P.might * A.ROUND / A.HP * A.shield(army)) };
			if (A.soldiers(army) < A.ROUT_AT * c.men) {
				out.fail = 'broken';
				return out;
			}
		}
		out.held = c.lit >= W.HOLD && c.waves >= W.WAVES.length;
		return out;
	}
};

/*
 * The game side: the hooks the framework calls, wrapped for the wardens. Nothing here runs at load but the
 * wrapping of Powers.init (the simulator loads this file with no game around it).
 */
(function (game) {
	for (var k in game) Wardens[k] = game[k];
	var init = Powers.init;
	Powers.init = function () {
		var first = !Powers._ready;
		init.apply(Powers, arguments);
		if (first) Wardens.adapt();
	};
})({
	adapt: function () {
		var P = Powers, A = Armies, W = Wardens;
		var wrap = function (o, k, fn) { var f = o[k]; o[k] = function () { return fn(f, arguments); }; };
		var ours = function (a) { return !!a && a.power === W.ID; };
		wrap(P, 'newSiege', function (f, args) {
			var s = f.apply(P, args);
			if (args[0] === W.ID) {
				s.stance = 'wait';     // nothing to press: the walls are the height (POWERS §3)
				s.sallies = A.SALLIES; // the battery doesn't come down
			}
			return s;
		});
		wrap(P, 'prepare', function (f, args) { return ours(args[0]) ? W.prepare(args[0]) : f.apply(P, args); });
		wrap(P, 'tellEnd', function (f, args) { return ours(args[0]) ? W.tellEnd(args[0]) : f.apply(P, args); });
		wrap(P, 'onStep', function (f, args) {
			if ($SM.get('game.powers') && !Events.activeEvent()) W.onStep(args[0], args[1]);
			return f.apply(P, args);
		});
		wrap(P, 'label', function (f, args) { return W.label(args[0], args[1]) || f.apply(P, args); });
		// "send them down the far side" gives nothing (blaze-draft: only the garrison's sending gave coal)
		wrap(P, 'breakIt', function (f, args) {
			var h = P.HEAD_START;
			if (ours(A.byId(args[0]))) P.HEAD_START = 0;
			try { return f.apply(P, args); } finally { P.HEAD_START = h; }
		});
		// the counter-siege runs on the siege's tick once the battery is taken
		wrap(A, 'besiege', function (f, args) {
			var a = args[0];
			return ours(a) && a.siege && a.siege.over && a.siege.over.counter ? W.counterTick(a) : f.apply(A, args);
		});
		wrap(A, 'status', function (f, args) {
			var a = args[0], c = A.target(a), s = a.siege;
			if (!ours(a) || a.state !== 'siege' || !c || !s) return f.apply(A, args);
			var n = { n: A.men(A.soldiers(a)) };
			if (s.over && s.over.counter) return CityStates.fill(_('the army holds the battery on the pass. {n}.'), c, n);
			if (s.dark) return CityStates.fill(_('the army climbs the goat path in the dark. {n}.'), c, n);
			if (s.over) return CityStates.fill(_('the army is on the cliff above the guns. {n}.'), c, n);
			return CityStates.fill(_('the army is camped below the guns of {name}. {n}.'), c, n);
		});
	},

	state: function () {
		return Powers.state(Wardens.ID);
	},

	set: function (k) {
		$SM.set(Powers.path(Wardens.ID) + '.' + k, true, true);
	},

	// the battery's site (WorldGen.generate), null in a world with no pass for it
	site: function () {
		var gen = World.hex && World.hex.gen;
		return gen && gen.wardens >= 0 ? gen.sites[gen.wardens] : null;
	},

	anchor: function () {
		var s = Wardens.site();
		return s ? s.anchor : null;
	},

	// an army may march on them once the gate is met on a trek
	known: function () {
		return !!Wardens.state().gate;
	},

	onSite: function (x, y) {
		var s = Wardens.site();
		return !!s && World.siteAt(x, y) === s;
	},

	isGoat: function (x, y) {
		var s = Wardens.site();
		return !!s && s.goat[0] === x && s.goat[1] === y;
	},

	label: function (x, y) {
		var st = Wardens.state(), nb = CityStates.nb;
		if (Wardens.onSite(x, y) && (st.sighted || st.gate)) return nb(_('the pass wardens.')) + '&nbsp;' + nb(_('the guns still face down the pass.'));
		if (st.path && Wardens.isGoat(x, y)) return nb(_('a goat path'));
		return '';
	},

	// the beacon on the pass: a lit beacon on the battery's hexes or next to them
	passLit: function () {
		var s = Wardens.site(), fire = World.hex && World.hex.fire;
		if (!s || !fire) return false;
		var cols = World.hex.gen.cols;
		return s.hexes.some(function (h) {
			return [h].concat(District.neighbours(h)).some(function (p) {
				return !!Network.beaconAt(p[0], p[1]) && !!fire.lit[p[0] + p[1] * cols];
			});
		});
	},

	/*
	 * On a trek: the guns seen, the gate, the goat path (found only on foot), the army waiting on the cliff
	 */
	onStep: function (x, y) {
		var W = Wardens, s = W.site(), st = W.state();
		if (!s || Powers.broken(W.ID)) return;
		if (!st.sighted && s.hexes.some(function (h) { return Fire.distance(h, [x, y]) <= World.LIGHT_RADIUS; })) {
			var mask = World.state ? World.state.mask : World.hex.mask;
			s.hexes.forEach(function (h) { World.uncoverMap(h[0], h[1], 0, mask); });
			W.set('sighted');
			return Events.startEvent(Events.Powers.Wardens.sighted());
		}
		if (W.onSite(x, y) && !st.gate) return Events.startEvent(Events.Powers.Wardens.gate());
		if (W.isGoat(x, y) && !st.path) return Events.startEvent(Events.Powers.Wardens.goat());
		Armies.list().forEach(function (a) {
			if (Events.activeEvent() || a.power !== W.ID || !a.siege || !a.siege.over || !a.siege.over.breach) return;
			if (WorldGen.distance(a.at, [x, y]) <= 1 || W.onSite(x, y)) Events.startEvent(Events.Powers.Wardens.storm(a.id));
		});
	},

	/*
	 * The siege (Armies.besiege calls Powers.prepare before each tick at the walls)
	 */
	prepare: function (a) {
		var A = Armies, s = a.siege;
		s.supplied = true;          // fed from the far side: they never starve
		s.keep = true;
		s.sallies = A.SALLIES;
		if (s.dark) {
			Wardens.darkStep(a);
			if (!s.dark.path.length) {
				delete s.dark;
				s.walls = 0;        // behind the guns: the storm waits for the wanderer
			}
			return;
		}
		var lost = Wardens.guns(a);
		if (lost) Notifications.notify(null, lost === 1 ? _('the guns find the camp. 1 soldier falls.') : _('the guns find the camp. {0} soldiers fall.', lost));
	},

	// the camp's "march the goat path": the climb from where the army stands, off the battery
	climbOut: function (id) {
		var W = Wardens, a = Armies.byId(id), s = W.site();
		if (!a || a.power !== W.ID || !a.siege || a.siege.over || a.siege.dark || !W.state().path) return false;
		var gen = World.hex.gen, path = W.climb(gen, a.at, s.goat, function (x, y) { return gen.siteAt[x + y * gen.cols] === gen.wardens; });
		if (!path) return false;
		a.siege.dark = { path: path };
		a.moves = 0;
		Armies.set(a);
		$SM.fireUpdate('game.armies');
		return true;
	},

	// a tick of the climb: a move point, spent on the next hex; every step unlit, whatever burns there (the
	// march's own supply rule, Armies.supply, with no light)
	darkStep: function (a) {
		var A = Armies, gen = World.hex.gen, d = a.siege.dark, lit = A.lit;
		a.moves = (a.moves || 0) + 1;
		A.lit = function () { return function () { return false; }; };
		try {
			while (d.path.length && a.moves >= A.moveCost(gen, d.path[0][0], d.path[0][1]) && A.soldiers(a) > 0) {
				var next = d.path.shift(), cost = A.moveCost(gen, next[0], next[1]);
				a.moves -= cost;
				A.supply(a, next, cost);
				a.at = next.slice();
			}
		} finally {
			A.lit = lit;
		}
		if (!d.path.length) Notifications.notify(null, _('the army is on the cliff.'));
	},

	// the siege's ends (Armies.tellEnd): behind the guns (the storm waits for the wanderer), the battery held
	// (its scenes), or the army broken under the guns
	tellEnd: function (a) {
		var o = a.siege.over, id = a.id;
		if (o.breach) {
			if (!o.told) {
				o.told = true;
				Armies.set(a);
				Notifications.notify(null, _('the army waits for the wanderer.'));
			}
			return;
		}
		if (o.counter) return;
		CityStates.queue(function () {
			if (!Armies.byId(id)) return;
			Events.startEvent(o.held ? Events.Powers.Wardens.held(id) : Events.Armies.broken(id));
		});
	},

	/*
	 * The counter-siege (the remnant's last stand: an outlast quest, blaze-draft Q), begun from the storm's
	 * last scene: the army holds the battery while the beacon on the pass burns
	 */
	begin: function (id) {
		var A = Armies, a = A.byId(id);
		if (!a || a.power !== Wardens.ID || !a.siege || (a.siege.over && !a.siege.over.breach)) return;
		Powers.won(id);
		a = A.byId(id);
		a.at = Wardens.anchor().slice();
		a.siege.over = { counter: { ticks: 0, lit: 0, waves: 0, men: A.soldiers(a) } };
		A.set(a);
		Notifications.notify(null, _("they're coming up the pass."));
		$SM.fireUpdate('game.armies');
	},

	counterTick: function (a) {
		var A = Armies, s = a.siege, c = s.over.counter;
		A.supply(a, a.at, 1);
		if (!A.soldiers(a)) return A.lostArmy(a);
		var r = Wardens.hold(c, a, Wardens.passLit(), Powers.byId(Wardens.ID));
		if (r.half) Notifications.notify(null, _('half the night is gone.'));
		if (r.wave && !r.fail) Notifications.notify(null, _('the beacon on the pass still burns.'));
		if (r.fail) {
			Notifications.notify(null, _("the beacon on the pass went dark. they've taken it back."));
			s.stormed = c.men;
			A.set(a);
			return A.rout(a.id);
		}
		if (r.held) {
			s.over = { held: true };
			A.set(a);
			// B10 comes with their beat (Network.BEATS); "The Pass Held" is told with their last scenes, not again at home
			Network.setFlag('passSeen');
			Fire.unlock('B10');
			Engine.event('progress', 'pass held');
			return Wardens.tellEnd(a);
		}
		A.set(a);
	}
});
