/**
 * Power #4, the foundry (design/drafts/POWERS.md §2-§3, approved; design/text/blaze-draft.md "Power 4", approved;
 * LADDERS.md H11). Built on the power framework (script/powers.js): one entry in Powers.LIST, and adapters
 * on the framework's hooks, so the garrison's code is not changed.
 *
 * The arms works' crew kept the furnace lit. Its puzzle (POWERS §2):
 *   - brick walls shrug off rams (Armies.siegeTick wears only timber with a ram); here nothing but the
 *     grenades the bombers throw wears them (Foundry.GRENADE_HIT a grenade)
 *   - cannon wreck lines: their fire at the walls and in the storm is heavy (the entry's might, its storm)
 *   - starving fails: they mine their own iron (the siege is always supplied; their stores never run down)
 *   - grenades come from the armoury's grenadier once coke is in (F9, Outside._INCOME), and with coke the
 *     steelworks make more steel (Foundry.COKE_STEEL)
 * A breach, then a storm the wanderer leads; the aftermath unlocks H11 (Fire.unlock), whose scene
 * (Events.Blaze.furnace) plays straight after.
 *
 * Where it stands: an old-world complex moved to the band 2-3 hills (WorldGen._foundry, its own rng; no
 * other site moves), past the garrison, its gate on ground a coke line crosses.
 *
 * The rules at the top are pure, so the simulator (tools/sim-power-foundry.js) loads this file too. Every
 * number is provisional, tuned with `npm run sim`.
 *
 * Saved state, game.powers.foundry (defaulted lazily): { seen, met, grenades, broken, way }
 */
var Foundry = {
	ID: 'foundry',
	SIZE: 3,               // provisional: the site's hexes (its gate and the works)
	DANGER: [5, 6],        // POWERS §3, band 2-3: the danger at its gate, its own spike counted
	REACH: 6.1,            // the ground a line reaches it over: coke's cap (Fire.FUELS.coke, F9)
	PAST: 5,               // provisional: hexes further from home than the garrison of the deep mines, if it can
	GRENADE_HIT: 10,       // provisional: brick a grenade thrown at the walls brings down
	COKE_STEEL: 2,         // provisional: steel a steelworker makes from an iron and a coal once coke is in

	// the entry in the power framework (POWERS §3, band 2-3: 80 men, cannon (15), 800 of brick, their own iron)
	POWER: {
		id: 'foundry', name: _('the foundry'), unlock: 'H11',
		anchor: function () { return Foundry.anchor(); },
		known: function () { return !!Foundry.state().met; },
		garrison: 80, walls: 800, kind: 'brick', stores: 60,
		might: 0.9,            // provisional: the cannon over the gate (a city-state's at band 2-3: 0.6-0.75)
		storm: { chara: 'F', damage: 15, hit: 0.4, delay: 3 },  // provisional: the cannon's damage (POWERS §3)
		joiners: 10            // provisional: the crew taken in, as the garrison's (blaze-draft scene 7 Q)
	},

	/*
	 * The site (pure): the complex nearest home that no power holds yet moves to the hills at DANGER, on
	 * ground a coke line can cross from home, off any land the city-states take; its hexes become hills.
	 * Its own rng; nothing else moves, and the city-states are placed as if it had not (Foundry.unmoved).
	 * Returns its index in gen.sites, or -1 (the complex then stays where it was)
	 */
	place: function (gen) {
		var G = WorldGen, T = G.TERRAIN, cols = gen.cols, rows = gen.rows, cap = gen.capital, i = -1;
		gen.sites.forEach(function (s, j) {
			if (s.kind !== 'complex' || s.garrison || s.power || j === gen.garrison) return;
			if (i < 0 || G.distance(s.anchor, cap) < G.distance(gen.sites[i].anchor, cap)) i = j;
		});
		if (i < 0) return -1;
		var old = gen.sites[i], claimed = Foundry.claimed(gen);
		// the danger without this complex's spike; a spot's own is SPIKE on its hexes, SPIKE * 0.4 next to them
		old.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = -1; });
		gen.sites[i] = { kind: 'complex', anchor: old.anchor, hexes: [] };
		var field = Danger.field(gen), spike = Danger.SPIKE.complex, edge = spike * 0.6 * (1 - 1 / (Danger.SPIKE_REACH + 1));
		gen.sites[i] = old;
		var pass = {}, deposit = {};
		gen.passes.forEach(function (p) { pass[p[0] + p[1] * cols] = true; });
		gen.deposits.forEach(function (d) { deposit[d.at[0] + d.at[1] * cols] = true; });
		var inside = function (x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; };
		var land = function (x, y) {
			var k = x + y * cols;
			return inside(x, y) && gen.reachable[k] && gen.siteAt[k] < 0 && gen.formationAt[k] < 0 && !pass[k] && !deposit[k] && !claimed[k] &&
				G.isPassable(gen.terrain[x][y]) && !G.isWater(gen.terrain[x][y]) && gen.terrain[x][y] === gen.map[x][y] &&
				G.distance([x, y], gen.warHeart) > 3;
		};
		var hills = function (x, y) { return land(x, y) && gen.terrain[x][y] === T.hills; };
		// the ground a line can cross from home: open dry ground (no water, no peaks) under the reach once
		// the site's spike is on the hexes next to it
		var near = new Uint8Array(cols * rows), queue = [cap];
		near[cap[0] + cap[1] * cols] = 1;
		for (var q = 0; q < queue.length; q++) {
			for (var dir = 0; dir < 6; dir++) {
				var n = G.neighbour(queue[q][0], queue[q][1], dir), nk = n[0] + n[1] * cols;
				if (!inside(n[0], n[1]) || near[nk] || field[nk] + edge > Foundry.REACH) continue;
				var t = gen.terrain[n[0]][n[1]];
				if (!G.isPassable(t) || G.isWater(t) || t === T.mountains) continue;
				near[nk] = 1;
				queue.push(n);
			}
		}
		var reached = function (x, y) {
			for (var d = 0; d < 6; d++) {
				var p = G.neighbour(x, y, d);
				if (inside(p[0], p[1]) && near[p[0] + p[1] * cols]) return true;
			}
			return false;
		};
		// further out than the garrison (band 2-3 past its band 1-2), PAST further if it can; nearest home first
		var lo = Foundry.DANGER[0], hi = Foundry.DANGER[1], spots = [];
		var g = gen.garrison >= 0 ? G.distance(gen.sites[gen.garrison].anchor, cap) : 0;
		for (var y = 0; y < rows; y++) {
			for (var x = 0; x < cols; x++) {
				if (!land(x, y)) continue;
				var dz = field[x + y * cols] + spike, dc = G.distance([x, y], cap);
				spots.push([x, y, Math.ceil(Math.max(0, lo - dz, dz - hi) * 4) * 16 + (reached(x, y) ? 0 : 8) + (dc >= g + Foundry.PAST ? 0 : dc > g ? 2 : 4) + (hills(x, y) ? 0 : 1), dc]);
			}
		}
		spots.sort(function (a, b) { return a[2] - b[2] || a[3] - b[3] || a[0] - b[0] || a[1] - b[1]; });
		// grown through hills, then open ground, in the site's own order (a Fisher-Yates shuffle, as the garrison's)
		var rand = G.rng(gen.seed ^ 0xF0D4), dirs = [0, 1, 2, 3, 4, 5];
		for (var di = dirs.length - 1; di > 0; di--) {
			var dj = Math.floor(rand() * (di + 1)), dt = dirs[di];
			dirs[di] = dirs[dj];
			dirs[dj] = dt;
		}
		for (var s = 0; s < spots.length && s < 50; s++) {
			var at = [spots[s][0], spots[s][1]], hexes = [at], has = {};
			has[at[0] + at[1] * cols] = true;
			[hills, land].forEach(function (fits) {
				for (var j = 0; j < hexes.length && hexes.length < Foundry.SIZE; j++) {
					dirs.forEach(function (d) {
						var nb = G.neighbour(hexes[j][0], hexes[j][1], d);
						if (hexes.length >= Foundry.SIZE || has[nb[0] + nb[1] * cols] || !fits(nb[0], nb[1])) return;
						has[nb[0] + nb[1] * cols] = true;
						hexes.push(nb);
					});
				}
			});
			if (hexes.length < Foundry.SIZE) continue;
			gen._foundryFrom = { site: old, under: hexes.map(function (h) { return [h[0], h[1], gen.terrain[h[0]][h[1]], gen.map[h[0]][h[1]]]; }) };
			hexes.forEach(function (h) {
				gen.siteAt[h[0] + h[1] * cols] = i;
				gen.terrain[h[0]][h[1]] = gen.map[h[0]][h[1]] = T.hills;
			});
			gen.sites[i] = { kind: 'complex', anchor: at, hexes: hexes, power: Foundry.ID };
			return i;
		}
		old.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = i; });
		return -1;
	},

	// the city-states' land and the hexes around it, as they are placed in this world before the move:
	// Uint8Array, or none when the city-states aren't loaded
	claimed: function (gen) {
		var out = new Uint8Array(gen.cols * gen.rows);
		if (typeof CityStates == 'undefined') return out;
		var field = Danger.field(gen);
		CityStates.place(gen, function (x, y) { return Danger.at(field, gen.cols, x, y, 'normal'); }).forEach(function (c) {
			c.land.concat([c.at]).forEach(function (h) {
				[h].concat([0, 1, 2, 3, 4, 5].map(function (d) { return WorldGen.neighbour(h[0], h[1], d); })).forEach(function (p) {
					if (p[0] >= 0 && p[1] >= 0 && p[0] < gen.cols && p[1] < gen.rows) out[p[0] + p[1] * gen.cols] = 1;
				});
			});
		});
		return out;
	},

	// fn() run on the world as it was before the move (the complex back, its new hexes' ground back), with
	// that world's danger; the move is put back after
	unmoved: function (gen, fn) {
		var u = gen._foundryFrom, i = gen.foundry, cols = gen.cols, now = gen.sites[i];
		now.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = -1; });
		u.under.forEach(function (h) { gen.terrain[h[0]][h[1]] = h[2]; gen.map[h[0]][h[1]] = h[3]; });
		u.site.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = i; });
		gen.sites[i] = u.site;
		try {
			var field = Danger.field(gen);
			return fn(function (x, y) { return Danger.at(field, cols, x, y, 'normal'); });
		} finally {
			u.site.hexes.forEach(function (h) { gen.siteAt[h[0] + h[1] * cols] = -1; });
			now.hexes.forEach(function (h) {
				gen.siteAt[h[0] + h[1] * cols] = i;
				gen.terrain[h[0]][h[1]] = gen.map[h[0]][h[1]] = WorldGen.TERRAIN.hills;
			});
			gen.sites[i] = now;
		}
	},

	// grenades a press tick throws: one a bomber with a grenade left
	thrown: function (army) {
		return Math.min(army.squads.grenade || 0, (army.ammo || {}).grenade || 0);
	},

	/*
	 * A siege tick at the foundry (pure, around Armies.siegeTick): the ordinary tick, then the walls as only
	 * the grenades wear them (a ram never wears brick; the army keeps its charges: siege.keep), and their
	 * stores never run down (siege.supplied: they dig their own iron)
	 */
	siegeTick: function (tick, siege, army, roll) {
		var walls = siege.walls, n = siege.stance === 'press' ? Foundry.thrown(army) : 0;
		var out = tick(siege, army, roll);
		out.worn = Math.min(walls, n * Foundry.GRENADE_HIT);
		siege.walls = walls - out.worn;
		out.breach = siege.walls <= 0;
		out.yield = false;
		out.broken = !out.breach && Armies.soldiers(army) < Armies.ROUT_AT * siege.invested;
		return out;
	}
};

// the framework's pure pieces, for the game and the simulator alike: the site moves when the world is made,
// the city-states are placed as before it, a foundry siege knows it is one, and its tick is the foundry's
(function () {
	var generate = WorldGen.generate, tick = Armies.siegeTick, newSiege = Powers.newSiege;
	var place = typeof CityStates != 'undefined' && CityStates.place;
	if (place) {
		CityStates.place = function (gen, danger, taken) {
			if (!gen._foundryFrom) return place.apply(CityStates, arguments);
			return Foundry.unmoved(gen, function (before) { return place.call(CityStates, gen, before, taken); });
		};
	}
	WorldGen._foundry = Foundry.place;
	WorldGen.generate = function () {
		var gen = generate.apply(WorldGen, arguments);
		gen.foundry = WorldGen._foundry(gen);
		return gen;
	};
	Powers.newSiege = function (id) {
		var s = newSiege.apply(Powers, arguments);
		if (id === Foundry.ID) s.foundry = true;
		return s;
	};
	Armies.siegeTick = function (siege) {
		return siege.foundry ? Foundry.siegeTick(tick, siege, arguments[1], arguments[2]) : tick.apply(Armies, arguments);
	};
	Powers.LIST.push(Foundry.POWER);
})();

/*
 * The game side: state, the trek's scenes, the siege's hooks, the grenades and the steel. Nothing here
 * runs at load; Foundry.init runs after Powers.init.
 */
(function (game) {
	for (var k in game) Foundry[k] = game[k];
})({
	init: function () {
		if (Foundry._ready) return;
		Foundry._ready = true;
		Foundry.adapt();
		Foundry.cokeSteel();
		$.Dispatch('stateUpdate').subscribe(Foundry.handleStateUpdates);
	},

	state: function () {
		return $SM.get('game.powers["foundry"]') || {};
	},

	set: function (k, v) {
		$SM.set('game.powers["foundry"].' + k, v, true);
	},

	// the gate of its site (the generator's choice: gen.foundry)
	anchor: function () {
		var gen = World.hex && World.hex.gen;
		return gen && gen.foundry >= 0 ? gen.sites[gen.foundry].anchor : null;
	},

	site: function () {
		var gen = World.hex && World.hex.gen;
		return gen && gen.foundry >= 0 ? gen.sites[gen.foundry] : null;
	},

	// the forge-masters of the hill towns are known (blaze-draft scenes 1-2 change a line for it)
	mastersMet: function () {
		return CityStates.list().some(function (c) { return c.t === 'forge_masters' && CityStates.state(c.id).met; });
	},

	/*
	 * Adapters on the framework (script/powers.js, script/events/powers.js are not changed): the trek's
	 * steps and homecomings, the hover, the camp, the breach, the storm, the aftermath
	 */
	adapt: function () {
		var P = Powers, E = Events.Powers, CS = CityStates, A = Armies;
		var onStep = P.onStep, prepare = P.prepare, tellEnd = P.tellEnd, breakIt = P.breakIt, note = Network.hexNote;
		var invest = E.invest, shafts = E.shafts, home = CS.onHome, stance = A.stance, unlock = Network.unlock;
		P.onStep = function (x, y) {
			Foundry.onStep(x, y);
			return onStep.apply(P, arguments);
		};
		CS.onHome = function () {
			Foundry.onHome();
			return home.apply(CS, arguments);
		};
		Network.hexNote = function (x, y) {
			return Foundry.label(x, y) || note.apply(Network, arguments);
		};
		// fed by their own iron; the army's charges are no use on brick (kept, as at the garrison's adits)
		P.prepare = function (a) {
			if (a.power !== Foundry.ID) return prepare.apply(P, arguments);
			a.siege.supplied = true;
			a.siege.keep = true;
		};
		P.tellEnd = function (a) {
			var o = a.siege.over;
			if (a.power === Foundry.ID && o.breach && !o.told) Notifications.notify(null, _('the grenades go over the wall. the brick comes down in a cloud.'));
			return tellEnd.apply(P, arguments);
		};
		// the crew sent away takes nothing with it, and leaves nothing (no coal, as the garrison's notes)
		P.breakIt = function (armyId, way) {
			var a = A.byId(armyId);
			if (!a || a.power !== Foundry.ID) return breakIt.apply(P, arguments);
			var head = P.HEAD_START;
			P.HEAD_START = 0;
			try { return breakIt.apply(P, arguments); } finally { P.HEAD_START = head; }
		};
		E.invest = function (a) {
			return a.power === Foundry.ID ? Events.PowersFoundry.invest() : invest.apply(E, arguments);
		};
		E.shafts = function (id) {
			var a = A.byId(id);
			return a && a.power === Foundry.ID ? Events.PowersFoundry.storm(id) : shafts.apply(E, arguments);
		};
		// waiting them out: they don't eat less (told once a siege)
		A.stance = function (id, s) {
			var a = A.byId(id), r = stance.apply(A, arguments);
			if (a && a.power === Foundry.ID && a.siege && s === 'wait' && !a.siege.toldWait) {
				var now = A.byId(id);
				now.siege.toldWait = true;
				A.set(now);
				Notifications.notify(null, _("the foundry doesn't eat less. they'll outlast us."));
			}
			return r;
		};
		Network.unlock = function (id) {
			var r = unlock.apply(Network, arguments);
			if (id === 'F9') Foundry.cokeSteel();
			return r;
		};
	},

	// out on a trek: the chimney's smoke seen, then its gate
	onStep: function (x, y) {
		var s = Foundry.site(), st = Foundry.state();
		if (!s || Events.activeEvent() || Powers.broken(Foundry.ID)) return;
		if (!st.seen && s.hexes.some(function (h) { return Fire.distance(h, [x, y]) <= World.LIGHT_RADIUS; })) {
			return Events.startEvent(Events.PowersFoundry.sighting());
		}
		if (World.siteAt(x, y) === s && !st.met && !World.state.foundryMet) Events.startEvent(Events.PowersFoundry.gate());
	},

	// what the trek met is known at home (lost with it on a death)
	onHome: function () {
		if (!$SM.get('game.world.foundryMet')) return;
		$SM.remove('game.world.foundryMet', true);
		Foundry.set('met', true);
		$SM.fireUpdate('game.powers');
	},

	label: function (x, y) {
		var s = Foundry.site();
		if (!s || !Foundry.state().seen || World.siteAt(x, y) !== s) return '';
		return _('the&nbsp;foundry.&nbsp;the&nbsp;furnace&nbsp;was&nbsp;never&nbsp;let&nbsp;go&nbsp;out.');
	},

	// with coke (F9) a steelworker makes more steel from the same iron and coal
	cokeSteel: function () {
		var w = Outside._INCOME.steelworker;
		w.stores.steel = Network.has('F9') ? Foundry.COKE_STEEL : 1;
		if ($SM.get('game.workers')) Outside.updateVillageIncome();
	},

	// the first grenades in a military city's stores (blaze-draft scene 4): once, once coke is in
	checkGrenades: function () {
		if (Foundry.state().grenades || !Network.has('F9')) return;
		var cities = $SM.get('game.cities') || {};
		for (var id in cities) {
			if (cities[id].focus !== 'military' || !($SM.get(City.storePath(id, 'grenade'), true) > 0)) continue;
			Foundry.set('grenades', true);
			CityStates.queue(function () { Events.startEvent(Events.PowersFoundry.grenades()); });
			CityStates.playQueued();
			return;
		}
	},

	handleStateUpdates: function (e) {
		// (the village's jobs fill the capital's stores on the income tick)
		if (e.category == 'stores' || e.category == 'income' || (e.stateName && e.stateName.indexOf('game.cities') === 0)) Foundry.checkGrenades();
	}
});

// after the framework's own init (Engine.init calls Powers.init)
(function () {
	var init = Powers.init;
	Powers.init = function () {
		var r = init.apply(Powers, arguments);
		Foundry.init();
		return r;
	};
})();
