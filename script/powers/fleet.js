/**
 * Power #5, the drowned fleet (design/drafts/POWERS.md #5 and §3 band 3; design/text/blaze-draft.md "Power 5",
 * approved; build notes in design/text/power-fleet.md).
 *
 * A navy's last hulks, chained hull to hull out on the drowned harbour's water (WorldGen._fleet): no army
 * walks there. The harbour's boatyard builds boats once the drowned harbour's chain is done (F11 whale oil,
 * B11 lighthouse), and fire-ships once pitch is in (F10). An army marches to the harbour, takes to the boats
 * and rows out to camp off the hulks; on the water its boats carry it (no thirst, no stragglers). The squads
 * can't wear the tarred hulks: only the fire-ships burn them. Then the storm is a boarding fight the wanderer
 * leads, rowed out from the harbour. Broken, it records the fleet's share of B12 (Fire.unlock), opens the
 * inland seas to armies and to treks (settlers walk with the wanderer), and lifts the coastal city-states'
 * price: influence alone wins them.
 *
 * Its scenes are in script/events/powers-fleet.js. It reaches the framework through adapters, as
 * script/powers.js reaches world.js: nothing in powers.js names the fleet.
 *
 * The rules at the top are pure (no DOM, no state), so the simulator (tools/sim-power-fleet.js) loads this
 * file too. Every number is provisional, tuned with `npm run sim`.
 *
 * Saved state, game.powers.fleet (made lazily): { seen, gate, broken, way }; the boats and fire-ships are
 * stores ('boat', 'fire-ship') of the drowned harbour's city, then gear with the army.
 */
var Fleet = {
	BOAT: { 'wood': 100, 'cloth': 10 },      // provisional (blaze-draft Q: a boat = wood + cloth)
	FIRE_SHIP: { 'boat': 1, 'pitch': 50 },   // provisional (a fire-ship = a boat + pitch)
	CREW: 6,           // provisional: soldiers a boat carries (POWERS §3: 10 boats, 60 boarders)
	BURN: 250,         // provisional: hulks a fire-ship burns (POWERS §3: four of them burn the 1,000)

	// the water an army may cross (pure): any, with boats; the inland seas' open water once the fleet is broken
	water: function (gen, x, y) {
		return WorldGen.isWater(gen.terrain[x][y]);
	},

	inland: function (gen, x, y) {
		var f = gen.formationAt[x + y * gen.cols];
		return f >= 0 && gen.formations[f].kind === 'sea';
	},

	// boats an army of n needs
	boatsFor: function (n) {
		return Math.ceil(n / Fleet.CREW);
	},

	// where the boats lie off the hulks (pure): a water hex beside the site, nearest the harbour by water
	// (steps: WorldGen.waterFrom), or null
	campOf: function (gen, site, steps) {
		var best = null, cols = gen.cols;
		site.hexes.forEach(function (h) {
			for (var d = 0; d < 6; d++) {
				var p = WorldGen.neighbour(h[0], h[1], d), k = p[0] + p[1] * cols;
				if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= gen.rows || gen.siteAt[k] >= 0 || !(steps[k] > 0)) continue;
				if (!best || steps[k] < steps[best[0] + best[1] * cols] || (steps[k] === steps[best[0] + best[1] * cols] && k < best[0] + best[1] * cols)) best = p;
			}
		});
		return best;
	},

	// rowed out (pure): the fewest water hexes from the harbour's shore (a hex of its site, hb) to the camp.
	// Returns { shore: the site's hex they put out from, path } or null
	row: function (gen, hb, camp) {
		var cols = gen.cols, n = cols * gen.rows, prev = new Int32Array(n).fill(-2), queue = [camp], k0 = camp[0] + camp[1] * cols;
		prev[k0] = -1;
		for (var q = 0; q < queue.length; q++) {
			var at = queue[q], k = at[0] + at[1] * cols;
			var shore = hb.hexes.filter(function (h) { return WorldGen.distance(at, h) === 1; })[0];
			if (shore) {
				var path = [];
				for (; k >= 0; k = prev[k]) path.push([k % cols, (k - k % cols) / cols]);
				return { shore: shore, path: path };
			}
			for (var d = 0; d < 6; d++) {
				var p = WorldGen.neighbour(at[0], at[1], d), pk = p[0] + p[1] * cols;
				if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= gen.rows || prev[pk] !== -2 || !Fleet.water(gen, p[0], p[1]) || gen.siteAt[pk] === gen.fleet) continue;
				prev[pk] = k;
				queue.push(p);
			}
		}
		return null;
	},

	// the way there (pure): home to the drowned harbour (its site, hb) by land (sail: the water it may cross
	// before it has the boats), then rowed out to the camp. lit(x, y). Returns { path, camp, harbour: the hexes
	// to the harbour } or null
	way: function (gen, from, hb, site, steps, lit, sail) {
		var camp = Fleet.campOf(gen, site, steps), out = camp && Fleet.row(gen, hb, camp);
		// a pond too small to lie off them on: the army camps on the harbour's shore beside the hulks
		var shore = !camp && hb.hexes.filter(function (h) { return site.hexes.some(function (s) { return WorldGen.distance(h, s) === 1; }); })[0];
		if (shore) {
			camp = shore;
			out = { shore: shore, path: [] };
		}
		var there = out && Armies.route(gen, from, out.shore, lit, sail);
		return there ? { path: there.concat(out.path), camp: camp, harbour: there.length } : null;
	}
};

// its entry in the powers' registry (script/powers.js)
Powers.LIST.push({
	id: 'fleet', name: _('the drowned fleet'), unlock: 'B12',
	// its Π: out on the drowned harbour's water (WorldGen._fleet); armies may be ordered there once it is seen
	anchor: function () { var gen = World.hex.gen; return Fleet.place() >= 0 ? gen.sites[gen.fleet].anchor : null; },
	known: function () { return !!Powers.state('fleet').seen; },
	// POWERS §3, band 3: garrison 100, a gunship (20), hulks 1,000, 120 ticks of stores
	garrison: 100, walls: 1000, kind: 'hulks', stores: 120,
	might: 0.75,           // provisional: a band 3 city-state's (0.3 + 0.15 × 3)
	// the boarding fight (POWERS §1 Option C): sailors on a burning deck; provisional, the garrison's numbers
	storm: { chara: 'D', damage: 5, hit: 0.4, delay: 2 },
	joiners: 20,           // provisional: sailors who join you when you take them in (blaze-draft scene 7)
	headStart: null        // put ashore, they leave nothing (blaze-draft scene 7)
});

/*
 * The game side: state, the adapters, the boatyard. Nothing here runs at load but the adapters' wiring.
 */
(function (game) {
	for (var k in game) Fleet[k] = game[k];
})({
	state: function () {
		return Powers.state('fleet');
	},

	set: function (k, v) {
		$SM.set(Powers.path('fleet') + '.' + k, v, true);
	},

	site: function () {
		return World.hex ? Powers.site('fleet') : null;
	},

	// its complex put out on the drowned harbour's water (WorldGen._fleet), once a world: the generator makes the
	// world afresh on each load, and the harbour, once picked, is kept, so it lands where it did. Returns its index
	place: function () {
		var hex = World.hex, gen = hex.gen;
		if (gen.fleet !== undefined) return gen.fleet;
		gen.fleet = -1; // (Network.harbourSite asks nothing of the fleet, but no second pass while it runs)
		var hb = Network.harbourSite();
		gen.fleet = WorldGen._fleet(gen, hb);
		if (gen.fleet < 0) return -1;
		// the world's live copies: a shallows hex made deep, its danger, what was worked out from the sites
		gen.sites[gen.fleet].hexes.forEach(function (h) {
			hex.map[h[0]][h[1]] = gen.map[h[0]][h[1]];
			if (World.state) World.state.map[h[0]][h[1]] = gen.map[h[0]][h[1]];
		});
		hex.danger = Danger.field(gen);
		hex.base = null;
		delete CityStates._spheres;
		Network._ground = Network._kinds = null;
		return gen.fleet;
	},

	// the drowned harbour's city, once resettled
	harbourCity: function () {
		var id = $SM.get('game.network.story["the drowned harbour"]');
		return id && $SM.get('game.cities["' + id + '"]') ? id : null;
	},

	// the fleet's water: every hex joined to the drowned harbour's shore (kept per world)
	steps: function () {
		var gen = World.hex.gen, hb = Network.harbourSite();
		if (!hb) return null;
		if (!Fleet._steps || Fleet._steps.gen !== gen) Fleet._steps = { gen: gen, steps: WorldGen.waterFrom(gen, hb) };
		return Fleet._steps.steps;
	},

	// the boatyard: a harbour district in the drowned harbour's city, once its chain is done (F11 and B11)
	boatyard: function () {
		var id = Fleet.harbourCity();
		return id && Network.has('F11') && Network.has('B11') && City.districtHexes(id, 'harbour').length ? id : null;
	},

	build: function (item) {
		var id = Fleet.boatyard();
		if (!id || (item === 'fire-ship' && !Network.has('F10'))) return false;
		if (!Network.pay(id, item === 'boat' ? Fleet.BOAT : Fleet.FIRE_SHIP)) return false;
		$SM.add(City.storePath(id, item), 1);
		AudioEngine.playSound(AudioLibrary.BUILD);
		return true;
	},

	have: function (item) {
		var id = Fleet.harbourCity();
		return id ? Math.floor($SM.get(City.storePath(id, item), true)) : 0;
	},

	// the coastal city-states: their land on the fleet's water (POWERS §2: they trade only with it)
	coastal: function () {
		var steps = Fleet.steps(), cols = World.hex.gen.cols;
		if (!steps || !CityStates.get()) return [];
		return CityStates.list().filter(function (c) {
			return c.land.some(function (h) {
				return District.neighbours(h).some(function (p) { return steps[p[0] + p[1] * cols] > 0; });
			});
		});
	},

	// fed while a coastal town that isn't ours still brings them food (blaze-draft scene 3: "what the coast
	// towns bring. they bring it every month.")
	fed: function () {
		return Fleet.coastal().some(function (c) { return !CityStates.state(c.id).city; });
	},

	/*
	 * Adapters: the framework's hooks, for the fleet's army; everyone else's go on as they were.
	 * wire: at load (the powers' and armies' own: a reload's siege ends are told before Powers.init);
	 * init: once the game is up (the trek, the map's hover, the city-states, the town panel)
	 */
	wrap: function (o, k, f) {
		var old = o[k];
		o[k] = function () { return f.call(this, old, arguments); };
	},

	mine: function (a) {
		return !!a && a.power === 'fleet';
	},

	wire: function () {
		var P = Powers, A = Armies, fn = Fleet.wrap, mine = Fleet.mine;
		// the siege: fed by the coast towns; the charges are no use on the water; only fire-ships burn the hulks
		fn(P, 'prepare', function (old, args) {
			var a = args[0];
			if (!mine(a)) return old.apply(P, args);
			a.siege.supplied = Fleet.fed();
			a.siege.keep = true;
		});
		fn(P, 'tellEnd', function (old, args) {
			var a = args[0], o = a.siege && a.siege.over;
			if (!mine(a) || !o || !o.breach) return old.apply(P, args);
			if (o.told) return;
			o.told = true;
			A.set(a);
			Notifications.notify(null, Events.Fleet.TEXT.burning);
		});
		fn(P, 'onStep', function (old, args) {
			Fleet.onStep(args[0], args[1]);
			return old.apply(P, args);
		});
		fn(P, 'cantMarch', function (old, args) {
			return old.apply(P, args) || (args[1] === 'fleet' ? Fleet.cantMarch(args[0]) : null);
		});
		// (the army box redraws when the boatyard's boats change: they decide the march)
		fn(P, 'key', function (old, args) {
			return old.apply(P, args).concat([[Fleet.have('boat'), Fleet.have('fire-ship')]]);
		});
		fn(P, 'marchOn', function (old, args) {
			return args[1] === 'fleet' ? Fleet.marchOn(args[0]) : old.apply(P, args);
		});
		fn(P, 'breakIt', function (old, args) {
			var was = mine(A.byId(args[0])), out = old.apply(P, args);
			if (was && out) Fleet.lift();
			return out;
		});
		// boats: over any water with them, over the inland seas once the fleet is broken
		A.sails = function (a) {
			var boats = !!a && ((a.gear || {}).boat > 0), open = P.broken('fleet'), gen = World.hex.gen;
			if (!boats && !open) return null;
			return function (x, y) { return Fleet.water(gen, x, y) && (boats || Fleet.inland(gen, x, y)); };
		};
		A.afloat = function (a, at) {
			var s = A.sails(a);
			return !!s && s(at[0], at[1]);
		};
		// the squads can't wear the tarred hulks (the sim's siege too): only the fire-ships burn them (Fleet.burn)
		var tick = A.siegeTick;
		A.siegeTick = function (siege, army) {
			if (siege.kind !== 'hulks') return tick.apply(A, arguments);
			var walls = siege.walls, out = tick.apply(A, arguments);
			siege.walls = walls;
			out.worn = 0;
			out.breach = walls <= 0;
			out.yield = !out.breach && siege.stores <= 0;
			out.broken = !out.breach && !out.yield && A.soldiers(army) < A.ROUT_AT * siege.invested;
			return out;
		};
	},

	init: function () {
		var P = Powers, CS = CityStates, fn = Fleet.wrap;
		// the fleet put out on the water as soon as the world is up (it is made afresh on each load)
		fn(World, 'openHexMap', function (old, args) {
			var out = old.apply(World, args);
			if (World.hex) Fleet.place();
			return out;
		});
		if (World.hex) Fleet.place();
		// the trek: the inland seas open to the wanderer (and the settlers with them) once it is broken
		fn(World, 'move', function (old, args) {
			Fleet._to = [World.curPos[0] + args[0][0], World.curPos[1] + args[0][1]];
			try { return old.apply(World, args); } finally { Fleet._to = null; }
		});
		fn(World, 'canSail', function (old, args) {
			var to = Fleet._to;
			return (!!to && !!World.hex && P.broken('fleet') && Fleet.inland(World.hex.gen, to[0], to[1])) || old.apply(World, args);
		});
		// the hover once seen; the coastal city-states' price lifted (influence wins them)
		fn(Network, 'hexNote', function (old, args) {
			var s = Fleet.site(), at = World.siteAt(args[0], args[1]);
			return s && at === s && Fleet.state().seen ? Events.Fleet.TEXT.hover.replace(/ /g, '&nbsp;') : old.apply(Network, args);
		});
		fn(CS, 'influenceWins', function (old, args) { return (!!args[1] && !!args[1].priceLifted) || old.apply(CS, args); });
		// the boatyard, in the drowned harbour's town panel
		$.Dispatch('stateUpdate').subscribe(Fleet.handleStateUpdates);
		fn(City, 'switchTo', function (old, args) { var out = old.apply(City, args); Fleet.updatePanel(); return out; });
	},

	/*
	 * Out on a trek: seen from the shore (or from the harbour's lit tower); rowed out to from the harbour, its
	 * gate (once its boats are up); and the storm, when the hulks burn and the army waits for the wanderer
	 */
	onStep: function (x, y) {
		var s = Fleet.site();
		if (!s || Events.activeEvent() || Powers.broken('fleet')) return;
		var st = Fleet.state(), hb = Network.harbourSite(), atHarbour = !!hb && World.siteAt(x, y) === hb;
		var near = s.hexes.some(function (h) { return WorldGen.distance(h, [x, y]) <= World.LIGHT_RADIUS; });
		if (!st.seen && (near || (atHarbour && Network.flag('lighthouseLit')))) return Events.startEvent(Events.Fleet.sighting());
		if (!atHarbour) return;
		var a = Armies.list().filter(function (a) { return a.power === 'fleet' && a.siege && a.siege.over && a.siege.over.breach; })[0];
		if (a) return Events.startEvent(Events.Fleet.storm(a.id));
		if (st.seen && !st.gate && Network.flag('boatsRaised')) return Events.startEvent(Events.Fleet.gate());
	},

	// seen: marked on the map, every hex of it
	sight: function () {
		var s = Fleet.site(), mask = World.state ? World.state.mask : World.hex.mask;
		s.hexes.forEach(function (h) { World.uncoverMap(h[0], h[1], 0, mask); });
		if (!World.state) World.saveHex(World.worldFlags());
		Fleet.set('seen', true);
		Engine.event('progress', 'fleet seen');
	},

	/*
	 * The march: to the harbour, into the boats, out to the hulks
	 */
	cantMarch: function (cityId) {
		var yard = Fleet.boatyard();
		if (!yard || !Fleet.have('boat')) return Events.Fleet.TEXT.noBoats;
		var need = Fleet.boatsFor(Armies.trained(cityId));
		if (Fleet.have('boat') < need) return _('the boatyard has {0} boats. the army needs {1}.', Fleet.have('boat'), need);
		return null;
	},

	marchOn: function (cityId) {
		var why = Powers.cantMarch(cityId, 'fleet');
		if (why) {
			Notifications.notify(City, why);
			return false;
		}
		var gen = World.hex.gen, yard = Fleet.boatyard();
		var way = Fleet.way(gen, $SM.get(City.path(cityId, 'hex')), Network.harbourSite(), Fleet.site(), Fleet.steps(), Armies.lit(), Armies.sails(null));
		if (!way) {
			Notifications.notify(City, _('there is no way there on foot.'));
			return false;
		}
		if (!Armies.send(cityId, Powers.target('fleet'), { power: 'fleet' }, way)) return false;
		// the boats and fire-ships go with them from the harbour
		// shortcut: they leave the boatyard as the army sets out, not when it reaches the harbour; fine while the
		// boatyard has no other use
		var list = Armies.list(), a = list[list.length - 1], boats = Fleet.boatsFor(Armies.soldiers(a)), fire = Fleet.have('fire-ship');
		a.gear.boat = boats;
		if (fire) a.gear['fire-ship'] = fire;
		$SM.add(City.storePath(yard, 'boat'), -boats);
		if (fire) $SM.add(City.storePath(yard, 'fire-ship'), -fire);
		Armies.set(a);
		$SM.fireUpdate('game.armies');
		return true;
	},

	// the camp's "send in the fire-ships": each one burns BURN of the hulks
	burn: function (id) {
		var a = Armies.byId(id);
		if (!a || !a.siege || a.siege.over || !((a.gear || {})['fire-ship'] > 0)) return 0;
		var n = a.gear['fire-ship'];
		a.siege.walls = Math.max(0, a.siege.walls - n * Fleet.BURN);
		delete a.gear['fire-ship'];
		Armies.set(a);
		$SM.fireUpdate('game.armies');
		return n;
	},

	// the aftermath beyond the framework's: the coastal city-states' price is lifted
	lift: function () {
		Fleet.coastal().forEach(function (c) {
			var path = 'game.citystates.cs["' + c.id + '"]', st = $SM.get(path);
			var w = CityStates.TEMPERAMENTS[c.t].ways_to_win;
			if (st && !st.city && w.indexOf('price') >= 0 && w.indexOf('influence') < 0) $SM.set(path + '.priceLifted', true, true);
		});
		Notifications.notify(null, Events.Fleet.TEXT.keepers);
	},

	/*
	 * The boatyard: the drowned harbour's town panel, under its land
	 */
	updatePanel: function () {
		if (!City.panel || !World.hex) return;
		var id = Fleet.boatyard(), box = $('#cityBoatyard');
		if (!id || id !== City.activeCity) {
			box.remove();
			return;
		}
		var pitch = Network.has('F10'), key = JSON.stringify([id, pitch, Fleet.have('boat'), Fleet.have('fire-ship')]);
		if (!box.length) {
			box = $('<div>').attr({ id: 'cityBoatyard', 'data-legend': _('the boatyard') });
			if ($('#cityArmies').length) box.insertAfter('#cityArmies');
			else if ($('#cityStates').length) box.insertBefore('#cityStates');
			else box.appendTo($('#cityLand').length ? '#cityLand' : City.panel);
		}
		if (box.attr('data-key') === key) return;
		box.attr('data-key', key).empty();
		$('<div>').attr('id', 'boatyardStock').addClass('csLine').text(_('boats {0}. fire-ships {1}.', Fleet.have('boat'), Fleet.have('fire-ship'))).appendTo(box);
		new Button.Button({ id: 'fleet_boat', text: _('boat'), width: '80px', cost: Fleet.BOAT, click: function () { Fleet.build('boat'); } }).appendTo(box);
		if (pitch) new Button.Button({ id: 'fleet_fireship', text: _('fire-ship'), width: '80px', cost: Fleet.FIRE_SHIP, click: function () { Fleet.build('fire-ship'); } }).appendTo(box);
		$('<div>').addClass('clear').appendTo(box);
	},

	handleStateUpdates: function (e) {
		if (!e.stateName) return;
		if (e.stateName.indexOf('game.cities') === 0 || e.stateName.indexOf('game.network') === 0 || e.category == 'stores') Fleet.updatePanel();
	}
});

Fleet.wire();
// the game's own adapters once the powers are up (Engine: Powers.init, after Armies.init)
Fleet.wrap(Powers, 'init', function (old, args) {
	var first = !Powers._ready;
	old.apply(Powers, args);
	if (first) Fleet.init();
});
