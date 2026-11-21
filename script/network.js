/**
 * The fire network in the game (rules and numbers: script/fire.js).
 *
 * Saved state, game.network:
 *   tiers     { F1: true, ... } the ladder tiers unlocked
 *   beacons   { 'x,y': true } beacons standing on the hex map
 *   story     flags of the ember story chains and milestones
 *   cairn     [x, y] the old cairn the wanderer tells of, once told
 *   settlers  { from, to: [x, y], people, stores, resettle, out } settlers sent to found a city:
 *             waiting at home, or out on the trek with the wanderer (out); see Network.sendSettlers
 * Each city record adds:
 *   hex        [x, y] its hearth quarter
 *   districts  { 'x,y': District type }
 *   hearth     { fuel, out, stored, fed } what the hearth burned last tick, the fire it made,
 *              held over, and how many beacons it fed
 * World.hex.fire holds the network as last computed (Fire.compute), not saved.
 *
 * The hearths burn on the fire tick (10 s) once the town is open; the tiers unlock as
 * their story beats happen, from the very start of the game.
 */
var Network = {
	CAIRN_GLYPH: '|',
	DISTRICT_COST: { wood: 50 }, // provisional
	// provisional: a founded city's hearth wants its full fire only once it has this many people
	HEARTH_PEOPLE: 32,
	// provisional: old districts a resettled fallen city starts with, by the site's size in hexes
	OLD_DISTRICTS: function (size) { return size <= 4 ? 1 : size <= 6 ? 2 : 3; },
	// what an old district can have been, in the order it is tried on each hex of the site
	OLD_TYPES: ['huts', 'woods', 'hunting grounds', 'burning pits', 'walls'],
	// story hooks of resettled fallen cities, in the order the sites are resettled (flame-era chains)
	RESETTLE_STORIES: ['the charcoal stranger'],
	PITS_GLYPH: 'o',
	// provisional (flame era, design/text/flame-build.md)
	STRANGER_WAIT: 30,   // fire ticks (5 min) from the old chimney to the stranger, and to the stranger's second ask
	CODA_WAIT: 30,       // fire ticks from the burning pits to the coda
	SECOND_TIER: 64,     // people in a city: its second population tier (H7)
	BAND2: 4,            // the danger where band 2 starts (Danger.BAND_SIZE * 2): the garrison's hills
	ROAD_REACH: 12,      // a founded city's road looks this far for a road or a city to join
	CART: 100,           // what one cart carries along a road (B6)
	BOG_WEAR: 0.004,     // a bog cut dug deep, worn a fire tick by four cutters (spent in ~40 min)
	BOG_REST: 0.002,     // and rested a tick while it is spent (back in ~80 min)
	// the beats that come from outside the ladders' own checks (Fire.unlock), and the flag each sets
	BEATS: { F8: 'garrisonBroken' },

	// what unlocks each ember tier (Fire.TIERS[].when)
	UNLOCKS: {
		'fire lit': function () {
			return $SM.get('game.fire.value', true) > 0 || $SM.get('game.builder.level') >= 0 || $SM.get('stores.wood') !== undefined;
		},
		'room warm': function () {
			return $SM.get('game.temperature.value', true) >= Room.TempEnum.Warm.value || $SM.get('game.builder.level') >= 1;
		},
		'builder stays': function () {
			return $SM.get('game.builder.level') >= 4;
		},
		'woodshed': function () {
			return Network.anyCity(function (c) { return (c.buildings || {}).woodshed > 0; });
		},
		'axe-head': function () {
			return !!$SM.get('game.world.axeHead');
		},
		'tannery and smokehouse': function () {
			var running = function (w) { return w && w.tanner > 0 && w.charcutier > 0; };
			return running($SM.get('game.workers')) || Network.anyCity(function (c) { return running(c.workers); });
		},
		'stone hearth': function () { return Network.flag('stoneHearth'); },
		'brazier': function () { return Network.flag('brazier'); },
		'trek home': function () { return Network.flag('trekHome'); },
		'cairn': function () { return Network.flag('cairnDone'); },
		'waystation lit': function () {
			if (!World.hex || !World.hex.fire) return false;
			var map = World.hex.map, fire = World.hex.fire, cols = World.hex.gen.cols;
			return Network.outposts().some(function (p) {
				return map[p[0]][p[1]] === World.TILE.OUTPOST && fire.lit[p[0] + p[1] * cols];
			});
		},
		'first district': function () {
			return Network.anyCity(function (c) { return Object.keys(c.districts || {}).length > 1; });
		},
		// the flame era. Beats from the city-states (Phase 4) are read from game.citystates.beats,
		// if it is there; without it those tiers stay locked
		'burning pits': function () { return !!$SM.get('game.network.story.charcoalWay'); },
		'bog cutters': function () { return Network.csBeat('F6'); },
		'resin tappers': function () { return Network.csBeat('F7'); },
		'garrison broken': function () { return Network.flag('garrisonBroken'); },
		'waystation held': function () { return Network.flag('towerHeld'); },
		'road joins': function () { return Network.roadJoined(); },
		'water crossed': function () { return !!Network._facing; },
		'lantern-keepers': function () { return Network.csBeat('B8'); },
		'old chimney': function () { return !!$SM.get('game.network.story.oldChimney'); },
		'potters': function () { return Network.csBeat('H6'); },
		'second tier': function () {
			return Network.cities().some(function (c) { return Network.people(c.id) >= Network.SECOND_TIER; });
		},
		'coal burned': function () { return Network.flag('coalBurned'); }
	},

	// one line when a milestone tier arrives (story tiers have their own scenes)
	MESSAGES: {
		F2: _('wood dried in the shed burns hotter. the fire reaches a little further.'),
		F3: _('the old axe-head bites into oak. seasoned, it burns long and far.'),
		F4: _('fat from the smokehouse renders down to tallow. it burns slow and bright.'),
		B2: _('the trek came home. torch-posts go up where the braziers stood.'),
		B4: _('a waystation in the light. watch fires there can see a long way.'),
		H2: _('the builder digs the fire into a pit, ringed with stones.'),
		H4: _('the hearth grows with the town. it keeps some fire back.'),
		F7: _('the jungle folk cut the bark and wait. the trees weep resin. it burns fierce.'),
		B5: _('the waystation held through the night. a tower goes up where the fires stood.'),
		B6: _('a road between two cities. lamps along it, one after another. goods can move now.'),
		B7: _('a bridge across the water. a light on either bank.'),
		H7: _('the city is big enough to need bread. the oven is never let go cold.'),
		H8: _('coke burns clean and hot. the forge hearth roars.')
	},

	init: function () {
		if (!$SM.get('game.network')) $SM.set('game.network', { tiers: {}, beacons: {}, story: {} }, true);
		// a reload mid-trek wakes at home: settlers out with the wanderer are home again, unless
		// they were lost with a pack that was never picked up (the pack is what the save kept)
		var s = Network.settlers();
		if (s && s.out) {
			var pack = $SM.get('game.world.pack');
			if (pack && pack.settlers) $SM.remove('game.network.settlers', true);
			else $SM.set('game.network.settlers.out', false, true);
		}
		Fire.onUnlock = Network.beat;
		Network.checkUnlocks();
		$.Dispatch('stateUpdate').subscribe(Network.handleStateUpdates);
		Network.refresh();
		Network.scheduleTick();
	},

	flag: function (k) {
		return !!$SM.get('game.network.story.' + k);
	},

	setFlag: function (k, v) {
		$SM.set('game.network.story.' + k, v === undefined ? true : v);
		Network.checkUnlocks();
	},

	// a ladder beat a city-state gave (Phase 4 records game.citystates.beats[tier]); false while
	// the city-states aren't in the game
	csBeat: function (id) {
		var b = $SM.get('game.citystates.beats');
		return !!b && b[id] !== undefined && b[id] !== null && b[id] !== false;
	},

	// Fire.unlock: a beat that happened outside the ladders (Network.BEATS); the tier comes in in
	// ladder order. Returns true if the beat is known.
	beat: function (id) {
		var k = Network.BEATS[id];
		if (!k) return false;
		Network.setFlag(k);
		return true;
	},

	// everyone in a city: the capital's villagers and its town citizens, another city's citizens
	people: function (cityId) {
		var c = $SM.get('game.cities["' + cityId + '"]'), n = (c && c.population && c.population.citizens) || 0;
		return cityId == City.CAPITAL ? n + $SM.get('game.population', true) : n;
	},

	has: function (id) {
		return !!$SM.get('game.network.tiers.' + id);
	},

	tiers: function () {
		return $SM.get('game.network.tiers') || {};
	},

	anyCity: function (fn) {
		var cities = $SM.get('game.cities') || {};
		for (var k in cities) {
			if (fn(cities[k], k)) return true;
		}
		return false;
	},

	// tiers unlock in ladder order, each once the one before it is in and its beat has happened
	checkUnlocks: function () {
		if (Network._checking) return;
		Network._checking = true;
		Fire.TIERS.forEach(function (t) {
			if (!t.when || Network.has(t.id)) return;
			if (t.n > 1 && !Network.has(t.id.charAt(0) + (t.n - 1))) return;
			if (Network.UNLOCKS[t.when]()) Network.unlock(t.id);
		});
		Network._checking = false;
	},

	unlock: function (id) {
		$SM.set('game.network.tiers.' + id, true);
		if (Network.MESSAGES[id]) Notifications.notify(null, Network.MESSAGES[id]);
		Engine.event('progress', 'fire tier ' + id);
		Network.refresh();
	},

	/*
	 * The hex map side
	 */
	key: function (x, y) {
		return x + ',' + y;
	},

	terrainKey: function (x, y) {
		if (x < 0 || y < 0 || x >= World.hex.gen.cols || y >= World.hex.gen.rows) return null;
		var c = World.hex.gen.terrain[x][y];
		for (var k in WorldGen.TERRAIN) {
			if (WorldGen.TERRAIN[k] === c) return k;
		}
		return null;
	},

	// the capital takes its place on the hex map: its hearth quarter on the capital's hex
	ensureCapital: function () {
		if (!World.hex || !$SM.get('game.cities["' + City.CAPITAL + '"]')) return;
		if ($SM.get(City.path(City.CAPITAL, 'hex'))) return;
		var at = World.hex.gen.capital, d = {};
		d[Network.key(at[0], at[1])] = District.HEARTH;
		$SM.setM('game.cities["' + City.CAPITAL + '"]', {
			hex: at.slice(), districts: d, hearth: { fuel: null, out: 0, stored: 0, fed: 0 }
		});
	},

	cities: function () {
		var out = [], cities = $SM.get('game.cities') || {};
		for (var k in cities) {
			if (cities[k].hex) out.push({ id: k, city: cities[k] });
		}
		return out;
	},

	// every district hex, { 'x,y': [index in Network.cities(), type] }, built once and kept until the
	// cities change (an update to game.cities, or a refresh): the painter asks for every hex (perf)
	districts: function () {
		if (Network._districts) return Network._districts;
		var index = {};
		Network.cities().forEach(function (c, i) {
			for (var k in c.city.districts) {
				if (!index[k]) index[k] = [i, c.city.districts[k]];
			}
		});
		return (Network._districts = index);
	},

	districtAt: function (x, y) {
		var d = Network.districts()[Network.key(x, y)];
		return d ? d[1] : null;
	},

	// the index of the city a hex belongs to, -1 if none (for outlining cities on the map)
	cityIndexAt: function (x, y) {
		var d = Network.districts()[Network.key(x, y)];
		return d ? d[0] : -1;
	},

	isCairn: function (x, y) {
		var c = $SM.get('game.network.cairn');
		return !!c && c[0] === x && c[1] === y && !Network.flag('cairnDone');
	},

	beaconAt: function (x, y) {
		return !!$SM.get('game.network.beacons["' + Network.key(x, y) + '"]');
	},

	beaconTier: function () {
		var t = Fire.best('beacon', Network.tiers());
		return t && Fire.BEACONS[t.id] ? t.id : null;
	},

	hearthTier: function () {
		var t = Fire.best('hearth', Network.tiers());
		return t && Fire.HEARTHS[t.id] ? t.id : 'H1';
	},

	outposts: function () {
		if (Network._outposts && Network._outposts.map === World.hex.map) return Network._outposts.list;
		var list = [], map = World.hex.map;
		for (var x = 0; x < map.length; x++) {
			for (var y = 0; y < map[x].length; y++) {
				if (map[x][y] === World.TILE.OUTPOST) list.push([x, y]);
			}
		}
		Network._outposts = { map: map, list: list };
		return list;
	},

	// Recomputes the network from the saved state into World.hex.fire, reveals what it lights.
	refresh: function () {
		if (!World.hex) return;
		Network._districts = null;
		Network._pits = Network.flag('pitsFound') ? null : $SM.get('game.network.pits') || null;
		Network.ensureCapital();
		var gen = World.hex.gen, cs = Network.cities();
		var hid = Network.hearthTier(), H = Fire.HEARTHS[hid];
		var beacons = Object.keys($SM.get('game.network.beacons') || {}).map(function (k) {
			return k.split(',').map(Number);
		});
		var bt = Network.beaconTier();
		var net = {
			cols: gen.cols, rows: gen.rows,
			field: World.baseField(),
			kind: Network.kinds(),
			hills: function (x, y) { return gen.terrain[x][y] === WorldGen.TERRAIN.hills; },
			open: function (x, y) { return WorldGen.isPassable(gen.terrain[x][y]) && !WorldGen.isWater(gen.terrain[x][y]); },
			hearths: cs.map(function (c) {
				var h = c.city.hearth || {}, f = h.fuel && Fire.FUELS[h.fuel];
				return { at: c.city.hex, out: h.out || 0, share: Network.shares(c.id), cap: f ? f.cap : 0, holds: f ? f.holds || 0 : 0, wet: f ? f.wet : 0 };
			}),
			beacons: beacons,
			beacon: bt ? Fire.BEACONS[bt] : null
		};
		var result = Fire.compute(net);
		World.hex.fire = result;
		Network.roads();
		if (Network.has('B6') && !Network.has('B7')) Network.facing(net, result);
		if (!Network.flag('smoke')) Network.seeSmoke(result);
		// lit land can be seen from home
		if (!World.state) {
			var mask = World.hex.mask, changed = false;
			for (var i = 0; i < result.lit.length; i++) {
				if (!result.lit[i]) continue;
				var x = i % gen.cols, y = (i - x) / gen.cols;
				if (!mask[x][y]) {
					mask[x][y] = true;
					changed = true;
				}
			}
			if (changed) World.saveHex(World.worldFlags());
		}
		Network.checkUnlocks();
		Network.draw();
		if (World.state && Engine.activeModule == World) World.drawHexMap();
	},

	// how many beacons the sharing hearths fed (s >= 1)
	fed: function (result) {
		var n = 0;
		result.nodes.forEach(function (node) { if (!node.hearth && node.s >= Fire.LIT_MIN) n++; });
		return n;
	},

	// a hearth feeds the beacon lines from the stone hearth on; before the chimney hearth (H5,
	// "a second city can feed the line") only the capital's does, and a founded city lights its own ground
	shares: function (cityId) {
		return Fire.HEARTHS[Network.hearthTier()].share && (cityId == City.CAPITAL || Network.has('H5'));
	},

	/*
	 * Fire a city's hearth wants a tick: its output, plus the upkeep of its share of the beacons
	 * it fed. A founded city wants its full fire only once it has Network.HEARTH_PEOPLE people,
	 * so a small town can put some wood by.
	 */
	hearthNeed: function (cityId) {
		var c = $SM.get('game.cities["' + cityId + '"]');
		return Network.hearthOut(cityId) + (Network.shares(cityId) ? Fire.UPKEEP * ((c.hearth && c.hearth.fed) || 0) : 0);
	},

	// the fire a city's hearth makes when it is fully fed; from the bread oven (H7) it grows with
	// the city's people, past the tier's own fire, up to H.grow times it
	hearthOut: function (cityId) {
		var H = Fire.HEARTHS[Network.hearthTier()];
		if (!H.grow) return H.out * Network.hearthScale(cityId);
		var s = Math.min(H.grow, Network.people(cityId) / Network.HEARTH_PEOPLE);
		return H.out * (cityId == City.CAPITAL ? Math.max(1, s) : s);
	},

	// the fire a city's hearth can hold over; a kiln of stone holds half (flame-draft H6)
	hearthStore: function (cityId) {
		var hid = Network.hearthTier(), store = Fire.HEARTHS[hid].store * Network.hearthScale(cityId);
		return hid === 'H6' && $SM.get('game.citystates.beats.H6build') === 'stone' ? store / 2 : store;
	},

	// how much of its tier's fire and store a city's hearth works with: all for the capital,
	// for a founded city its people over Network.HEARTH_PEOPLE
	hearthScale: function (cityId) {
		if (cityId == City.CAPITAL) return 1;
		var c = $SM.get('game.cities["' + cityId + '"]');
		return Math.min(1, (c.population.citizens || 0) / Network.HEARTH_PEOPLE);
	},

	scheduleTick: function () {
		Network._tickTimeout = Engine.setTimeout(Network.tick, Fire.TICK * 1000);
	},

	// The fire tick: every city's hearth burns its fuel, then the network is worked out again,
	// then the focused cities govern themselves.
	tick: function () {
		if ($SM.get('features.location.city')) {
			var hid = Network.hearthTier(), H = Fire.HEARTHS[hid], tiers = Network.tiers(), home = false, coal = false;
			if (Network.has('F6') && $SM.get('game.citystates.beats.F6way') === 'deep') Network.wearBogs();
			// every write quiet; one update (and one save) for the whole tick below (perf: ticks grow with cities)
			Network.cities().forEach(function (c) {
				var h = c.city.hearth || {};
				var need = Network.hearthNeed(c.id);
				var r = Fire.burnAll(hid, tiers, function (k) { return $SM.get(City.storePath(c.id, k), true); },
					need, h.stored || 0, Network.hearthStore(c.id));
				for (var k in r.burn) {
					if (!r.burn[k]) continue;
					$SM.add(City.storePath(c.id, k), -r.burn[k], true);
					if (c.id == City.CAPITAL) home = true;
					if (k === 'coal') coal = true;
				}
				// the fire made, as a share of what it wanted
				var out = need > 0 ? r.out * need / H.out : 0;
				// a sharing hearth makes its whole fire (the line's upkeep is in what it burned)
				if (Network.shares(c.id)) out = r.out * Network.hearthOut(c.id) / H.out;
				// burning only its store, it keeps the last fuel's reach
				$SM.set(City.path(c.id, 'hearth'), {
					fuel: out > 0 ? (r.fuel || h.fuel || null) : null, out: Math.round(out * 100) / 100, stored: r.stored, fed: h.fed || 0
				}, true);
			});
			Network.refresh();
			if (World.hex && World.hex.fire) {
				// the sharing hearths split the upkeep of the beacons they fed
				var sharing = Network.cities().filter(function (c) { return Network.shares(c.id); });
				var fed = Network.fed(World.hex.fire) / Math.max(1, sharing.length);
				Network.cities().forEach(function (c) {
					$SM.set(City.path(c.id, 'hearth.fed'), Network.shares(c.id) ? fed : 0, true);
				});
			}
			Network.cities().forEach(function (c) { if (c.city.focus) City.govern(c.id); });
			if (home) $SM.fireUpdate('stores'); // the capital's stores are the top-level ones
			$SM.fireUpdate('game.cities', true); // the town panel and every city's income, once
			if (coal && !Network.flag('coalBurned')) Network.setFlag('coalBurned');
			Network.flameTick();
			Network.checkStory();
		}
		Network.scheduleTick();
	},

	/*
	 * Placing things on the land
	 */
	// a beacon goes on seen, open dry ground, up to Fire.HOP hexes from a hearth or a lit beacon
	canBeacon: function (x, y) {
		if (!World.hex || !Network.beaconTier()) return false;
		var gen = World.hex.gen;
		if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || !World.hex.mask[x][y]) return false;
		if (!WorldGen.isPassable(World.hex.map[x][y]) || World.hex.map[x][y] === WorldGen.TERRAIN.ocean) return false;
		if (WorldGen.isWater(gen.terrain[x][y])) return false; // crossing water is for later beacons (B7, B11)
		if (Network.beaconAt(x, y) || Network.districtAt(x, y) || Network.isCairn(x, y) || Network.isPits(x, y)) return false;
		// a hearth, lit or cold (a cold one must not lock the player out), or a lit beacon:
		// a dark beacon is no anchor to build out from
		return !!World.hex.fire && World.hex.fire.nodes.some(function (n) {
			return (n.hearth || n.s >= Fire.LIT_MIN) && Fire.distance(n.at, [x, y]) <= Fire.HOP;
		});
	},

	raiseBeacon: function (x, y) {
		if (!Network.canBeacon(x, y)) return false;
		var cost = Fire.BEACONS[Network.beaconTier()].cost;
		if (!Network.pay(City.activeCity, cost)) return false;
		var first = !Network.flag('firstBrazier');
		$SM.set('game.network.beacons["' + Network.key(x, y) + '"]', true);
		AudioEngine.playSound(AudioLibrary.BUILD);
		Network.refresh();
		if (first) Network.storyFirstBrazier();
		return true;
	},

	putOut: function (x, y) {
		if (!Network.beaconAt(x, y)) return false;
		$SM.remove('game.network.beacons["' + Network.key(x, y) + '"]');
		Notifications.notify(null, _('the beacon is put out. the dark comes back past it.'));
		Network.refresh();
		return true;
	},

	pay: function (cityId, cost) {
		var mod = {};
		for (var k in cost) {
			var have = $SM.get(City.storePath(cityId, k), true);
			if (have < cost[k]) {
				Notifications.notify(City, _('not enough ' + k));
				return false;
			}
			mod[k] = have - cost[k];
		}
		$SM.setM(City.storesPath(cityId), mod);
		return true;
	},

	// what District.TYPES[].fits sees of a hex
	ground: function (cityId, x, y) {
		var f = World.formationAt(x, y), bog = cityId && $SM.get(City.path(cityId, 'bogs["' + Network.key(x, y) + '"]'));
		return {
			at: [x, y],
			terrain: Network.terrainKey(x, y),
			terrainAt: Network.terrainKey,
			site: !!World.siteAt(x, y),
			deep: !!f && f.kind === 'forest',
			coal: Network.coalAt(x, y),
			spent: bog ? (bog.spent ? 1 : bog.w) : 0,
			city: $SM.get(City.path(cityId, 'districts')) || {},
			capital: cityId == City.CAPITAL
		};
	},

	// a coal seam: a prologue coal mine's deposit, or once the garrison is broken the hills by its
	// deep mines ("coal mines district on the site's hills": the site itself takes no district)
	coalAt: function (x, y) {
		var gen = World.hex.gen;
		if (gen.deposits.some(function (d) { return d.kind === 'coal' && d.at[0] === x && d.at[1] === y; })) return true;
		var g = $SM.get('game.network.garrison');
		if (!g || !Network.flag('garrisonBroken')) return false;
		var t = gen.terrain[x][y];
		if (t !== WorldGen.TERRAIN.hills && t !== WorldGen.TERRAIN.mountains) return false;
		var site = World.siteAt(g[0], g[1]);
		return !!site && site.hexes.some(function (h) { return Fire.distance(h, [x, y]) <= 1; });
	},

	// district types that can go on this hex for a city
	districtsFor: function (cityId, x, y) {
		var c = $SM.get('game.cities["' + cityId + '"]');
		if (!World.hex || !c || !c.hex) return [];
		var gen = World.hex.gen;
		if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || !World.hex.mask[x][y]) return [];
		if (Network.districtAt(x, y) || Network.beaconAt(x, y) || Network.isCairn(x, y) || Network.isPits(x, y)) return [];
		if (World.markedAt(x, y)) return []; // not on a landmark or a site (old-world works will be, later)
		if (!World.hex.fire || !World.hex.fire.lit[x + y * gen.cols]) return []; // only where the fire reaches
		if (Fire.distance(c.hex, [x, y]) > District.MAX_RING) return [];
		// a city grows outward: next to one of its own districts
		if (!District.neighbours([x, y]).some(function (p) { return c.districts[Network.key(p[0], p[1])]; })) return [];
		var g = Network.ground(cityId, x, y), out = [];
		for (var t in District.TYPES) {
			var T = District.TYPES[t];
			if (T.stub || t === District.HEARTH || !City.tierMet(T.needs)) continue;
			if (T.fits(g)) out.push(t);
		}
		return out;
	},

	placeDistrict: function (cityId, x, y, type) {
		if (Network.districtsFor(cityId, x, y).indexOf(type) < 0) return false;
		if (!Network.pay(cityId, Network.DISTRICT_COST)) return false;
		$SM.set(City.path(cityId, 'districts["' + Network.key(x, y) + '"]'), type);
		AudioEngine.playSound(AudioLibrary.BUILD);
		Network.refresh();
		return true;
	},

	/*
	 * Founding (DESIGN.md "Founding cities"): only on lit land, two steps: light the way, then
	 * settle. Settlers leave a city with City.SETTLERS and trek to the site with the wanderer;
	 * on arrival the city is made. A fallen city that is lit can be resettled instead: it starts
	 * with some of its old districts, and may have a story.
	 */
	settlers: function () {
		return $SM.get('game.network.settlers') || null;
	},

	// where a city could be founded from this hex: { at, site } (site: the fallen city resettled), or null
	foundingSite: function (x, y) {
		if (!World.hex || !World.hex.fire) return null;
		var gen = World.hex.gen;
		if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || !World.hex.mask[x][y]) return null;
		var site = World.siteAt(x, y), at = [x, y];
		if (site && site.kind !== 'fallenCity') return null;
		if (site) at = site.anchor.slice(); // a fallen city is resettled from its old centre
		if (!World.hex.fire.lit[at[0] + at[1] * gen.cols] || !gen.reachable[at[0] + at[1] * gen.cols]) return null;
		if (!District.land(Network.ground(null, at[0], at[1])) || Network.beaconAt(at[0], at[1])) return null;
		// not next to another city
		var near = [at].concat(District.neighbours(at));
		if (near.some(function (p) { return Network.districtAt(p[0], p[1]); })) return null;
		return { at: at, site: site };
	},

	// why a city can't send settlers now, or null
	cantSend: function (cityId) {
		var s = Network.settlers(), pack = $SM.get('game.world.pack');
		if (s || (pack && pack.settlers)) return _('settlers are already on their way');
		if (City.people(cityId) < City.SETTLERS.people) return _('not enough people');
		var st = City.SETTLERS.stores;
		for (var k in st) {
			if ($SM.get(City.storePath(cityId, k), true) < st[k]) return _('not enough ' + k);
		}
		return null;
	},

	sendSettlers: function (cityId, x, y) {
		var f = Network.foundingSite(x, y), why = Network.cantSend(cityId);
		if (!f || why) {
			if (why) Notifications.notify(City, why);
			return false;
		}
		Network.pay(cityId, City.SETTLERS.stores);
		City.removePeople(cityId, City.SETTLERS.people);
		$SM.set('game.network.settlers', {
			from: cityId, to: f.at, people: City.SETTLERS.people,
			stores: $.extend({}, City.SETTLERS.stores), resettle: !!f.site, out: false
		});
		Notifications.notify(null, _('eight settlers wait at the edge of town, packs on their backs.'));
		Network.draw();
		return true;
	},

	// settlers who have not left yet unpack, back into their city
	callOff: function () {
		var s = Network.settlers();
		if (!s || s.out) return false;
		$SM.remove('game.network.settlers');
		if ($SM.get('game.cities["' + s.from + '"]')) {
			$SM.addM(City.storesPath(s.from), s.stores);
			if (s.from == City.CAPITAL) $SM.add('game.population', s.people);
			else $SM.add(City.path(s.from, 'population.citizens'), s.people);
		}
		Notifications.notify(null, _('the settlers unpack.'));
		Network.draw();
		return true;
	},

	// the trek begins: waiting settlers fall in behind the wanderer; it sets out from their city
	onEmbark: function () {
		var s = Network.settlers();
		if (!s || !World.hex) return null;
		$SM.set('game.network.settlers.out', true, true);
		Notifications.notify(World, _('the settlers fall in behind.'));
		var from = $SM.get(City.path(s.from, 'hex'));
		return from ? from.slice() : null;
	},

	// home without reaching the site: they wait for the next trek
	settlersHome: function () {
		if (!Network.settlers()) return;
		$SM.set('game.network.settlers.out', false, true);
		Notifications.notify(null, _('the settlers wait at home for the next trek.'));
	},

	// the settlers reach their site: if the fire still reaches it, the city is made there
	settle: function () {
		var s = Network.settlers();
		$SM.remove('game.network.settlers', true);
		var f = Network.foundingSite(s.to[0], s.to[1]);
		if (!f) {
			Notifications.notify(World, _("the fire doesn't reach here any more. the settlers won't stay."));
			// they go back to the city they came from, with what they carried
			if ($SM.get('game.cities["' + s.from + '"]')) {
				if (s.from == City.CAPITAL) $SM.add('game.population', s.people);
				else $SM.add(City.path(s.from, 'population.citizens'), s.people);
				$SM.addM(City.storesPath(s.from), s.stores);
			}
			return null;
		}
		var next = City.nextCity(), d = {};
		d[Network.key(f.at[0], f.at[1])] = District.HEARTH;
		if (f.site) {
			// the old districts closest to the old centre, where something still fits
			var hexes = f.site.hexes.filter(function (h) { return !(h[0] === f.at[0] && h[1] === f.at[1]); })
				.sort(function (a, b) { return Fire.distance(a, f.at) - Fire.distance(b, f.at); });
			var n = Network.OLD_DISTRICTS(f.site.hexes.length);
			hexes.forEach(function (h) {
				if (n <= 0 || Fire.distance(h, f.at) > District.MAX_RING || Network.districtAt(h[0], h[1])) return;
				if (!District.neighbours(h).some(function (p) { return d[Network.key(p[0], p[1])]; })) return;
				var g = Network.ground(null, h[0], h[1]);
				g.city = d;
				var t = Network.OLD_TYPES.filter(function (t) { return District.TYPES[t].fits(g); })[0];
				if (!t) return;
				d[Network.key(h[0], h[1])] = t;
				n--;
			});
		}
		City.createCity(next.id, next.name, {
			hex: f.at, districts: d, stores: s.stores, citizens: s.people, parent: s.from
		});
		$SM.fireUpdate('game.cities["' + next.id + '"]');
		World.state.map[f.at[0]][f.at[1]] = World.TILE.VILLAGE; // a city of ours: home
		Network.layRoad(f.at, World.state.map);
		Notifications.notify(World, f.site ? _('old walls, old hearths. the settlers clear the ash and move in.') :
			_('the settlers stop. they light a fire from the one they carried.'));
		Engine.event('progress', f.site ? 'city resettled' : 'city founded');
		if (f.site) Network.resettleStory(next.id);
		Network.refresh();
		return next.id;
	},

	/*
	 * A resettled fallen city's story hook. The first is the charcoal stranger (F5), a
	 * flame-era chain: only its trigger is here, as a flag the flame era picks up.
	 */
	resettleStory: function (cityId) {
		var n = $SM.get('game.network.story.resettled', true);
		$SM.set('game.network.story.resettled', n + 1);
		var story = Network.RESETTLE_STORIES[n];
		if (!story) return;
		$SM.set('game.network.story["' + story + '"]', cityId);
		Engine.event('progress', 'story hook ' + story);
	},

	// the land view follows the town panel's city
	focusCity: function (cityId) {
		var at = $SM.get(City.path(cityId, 'hex'));
		if (!at || !Network.cam) return;
		Network.cam = World.hexCentre(at[0], at[1]);
		Network.selected = null;
		Network.draw();
		Network.updateActions();
	},

	// one line about a hex's fire, for the hover label
	hexNote: function (x, y) {
		var s = Network.settlers();
		if (s && s.to[0] === x && s.to[1] === y) return _('where&nbsp;the&nbsp;settlers&nbsp;are&nbsp;bound');
		var d = Network.districtAt(x, y);
		// a city's centre is the city itself (home: World.hexLabel names the capital)
		var ci = Network.cityIndexAt(x, y), city = ci >= 0 ? Network.cities()[ci] : null;
		if (d === District.HEARTH) d = city.id != City.CAPITAL ? city.city.name : null;
		else if (d) d = District.TYPES[d].name;
		if (d) return d.replace(/ /g, '&nbsp;');
		if (Network.isCairn(x, y)) return _('an&nbsp;old&nbsp;cairn');
		if (Network.isPits(x, y)) return _('the&nbsp;old&nbsp;pits');
		if (Network.isGarrison(x, y)) {
			return Network.flag('gateMet') ? _('the&nbsp;garrison&nbsp;of&nbsp;the&nbsp;deep&nbsp;mines.&nbsp;the&nbsp;shafts&nbsp;go&nbsp;down&nbsp;into&nbsp;the&nbsp;dark.') :
				_('the&nbsp;garrison&nbsp;of&nbsp;the&nbsp;deep&nbsp;mines');
		}
		if (Network.beaconAt(x, y)) {
			var bt = Network.beaconTier(), lit = World.hex.fire && World.hex.fire.lit[x + y * World.hex.gen.cols];
			var name = bt ? Fire.BEACONS[bt].name : _('beacon');
			return (lit ? _('a&nbsp;{0}', name) : _('a&nbsp;dark&nbsp;{0}', name)).replace(/ /g, '&nbsp;');
		}
		return '';
	},

	/*
	 * The land: a hex view in the town panel, to raise beacons and place districts.
	 */
	VIEW: [460, 300],

	setupView: function () {
		if (!City.panel || !World.hex) return null;
		var land = $('#cityLand');
		if (land.length) return land;
		land = $('<div>').attr({ id: 'cityLand', 'data-legend': _('the land') }).appendTo(City.panel);
		$('<div>').attr('id', 'fireStatus').appendTo(land);
		var map = $('<div>').attr('id', 'landMap').addClass('hex').appendTo(land);
		var dpr = window.devicePixelRatio || 1;
		var canvas = $('<canvas>').attr({ width: Network.VIEW[0] * dpr, height: Network.VIEW[1] * dpr })
			.css({ width: Network.VIEW[0] + 'px', height: Network.VIEW[1] + 'px' }).appendTo(map);
		$('<span>').addClass('landmark hexProbe').appendTo(map);
		$('<div>').attr('id', 'landInfo').html('&nbsp;').appendTo(land);
		$('<div>').attr('id', 'landActions').appendTo(land);
		// the cities and their focus sit under the land, once there is more than one
		$('<div>').addClass('clear').appendTo(land);
		$('#citySwitch, #cityFocus').appendTo(land);
		Network.cam = World.hexCentre(World.hex.gen.capital[0], World.hex.gen.capital[1]);

		var start = null, dragged = false;
		var hexOf = function (e) {
			var off = canvas.offset();
			return World.hexAt(e.pageX - off.left + Network.cam[0] - Network.VIEW[0] / 2, e.pageY - off.top + Network.cam[1] - Network.VIEW[1] / 2);
		};
		canvas.on('mousedown', function (e) {
			start = { x: e.pageX, y: e.pageY, cam: Network.cam.slice() };
			dragged = false;
		});
		$(document).on('mousemove', function (e) {
			if (!start) return;
			var dx = e.pageX - start.x, dy = e.pageY - start.y;
			if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
			if (dragged) {
				Network.cam = [start.cam[0] - dx, start.cam[1] - dy];
				Network.draw();
			}
		}).on('mouseup', function () {
			start = null;
		});
		canvas.on('click', function (e) {
			if (dragged) return;
			Network.select(hexOf(e));
		});
		canvas.on('mousemove', function (e) {
			var h = hexOf(e);
			$('#landInfo').html(World.hexLabel(h[0], h[1], { map: World.hex.map, mask: World.hex.mask }) || '&nbsp;');
		});
		return land;
	},

	select: function (h) {
		Network.selected = h;
		Network.draw();
		Network.updateActions();
	},

	draw: function () {
		var land = Network.setupView();
		if (!land) return;
		World.paintHex($('#landMap'), {
			cam: Network.cam, view: Network.VIEW, map: World.hex.map, mask: World.hex.mask,
			me: null, pack: null, select: Network.selected || null
		});
		Network.updateStatus();
	},

	updateStatus: function () {
		var c = $SM.get('game.cities["' + City.activeCity + '"]');
		if (!c || !c.hearth) return;
		var h = c.hearth, hearth = Fire.tier(Network.hearthTier()).name;
		var line = h.fuel ? _('the {0} burns {1}. fire {2}.', hearth, _(h.fuel), Math.round(h.out)) : _('the {0} is cold.', hearth);
		var fire = World.hex.fire, lit = 0, all = 0;
		if (fire) {
			fire.nodes.forEach(function (n) {
				if (n.hearth) return;
				all++;
				if (n.s >= Fire.LIT_MIN) lit++;
			});
		}
		if (all) line += ' ' + _('beacons lit: {0} of {1}.', lit, all);
		$('#fireStatus').text(line);
		Network.updateSettlers();
		Network.updateRoads();
	},

	// the settlers waiting to leave, with a way to call them off
	updateSettlers: function () {
		var s = Network.settlers(), box = $('#landSettlers');
		if (!s) {
			box.remove();
			return;
		}
		if (!box.length) box = $('<div>').attr('id', 'landSettlers').insertAfter('#fireStatus');
		var key = s.from + s.to + s.out;
		if (box.attr('data-key') === key) return;
		box.attr('data-key', key).empty();
		var from = $SM.get('game.cities["' + s.from + '"]');
		$('<div>').addClass('settlersLine').text(s.out ? _('the settlers are out on the trek.') :
			_('settlers wait to leave {0}. they go with the next trek.', from ? from.name : '')).appendTo(box);
		if (!s.out) {
			new Button.Button({
				id: 'land_calloff', text: _('call off'), width: '80px',
				click: function () { Network.callOff(); }
			}).appendTo(box);
		}
	},

	updateActions: function () {
		var box = $('#landActions').empty(), h = Network.selected, cityId = City.activeCity;
		if (!h) return;
		var bt = Network.beaconTier();
		if (Network.beaconAt(h[0], h[1])) {
			new Button.Button({
				id: 'land_putout', text: _('put out'), width: '80px',
				click: function () { Network.putOut(h[0], h[1]); Network.updateActions(); }
			}).appendTo(box);
		} else if (bt && Network.canBeacon(h[0], h[1])) {
			new Button.Button({
				id: 'land_beacon', text: _('raise {0}', Fire.BEACONS[bt].name), width: '80px',
				cost: Fire.BEACONS[bt].cost,
				click: function () { Network.raiseBeacon(h[0], h[1]); Network.updateActions(); }
			}).appendTo(box);
		}
		Network.districtsFor(cityId, h[0], h[1]).forEach(function (t) {
			new Button.Button({
				id: 'land_district_' + t.replace(/ /g, '-'), text: District.TYPES[t].name, width: '80px',
				cost: Network.DISTRICT_COST,
				click: function () { Network.placeDistrict(cityId, h[0], h[1], t); Network.updateActions(); }
			}).appendTo(box);
		});
		var f = Network.foundingSite(h[0], h[1]);
		if (f && !Network.settlers()) {
			var cost = $.extend({ 'settlers': City.SETTLERS.people }, City.SETTLERS.stores);
			new Button.Button({
				id: 'land_found', text: f.site ? _('resettle') : _('found a town'), width: '80px', cost: cost,
				click: function () { Network.sendSettlers(cityId, h[0], h[1]); Network.updateActions(); }
			}).appendTo(box);
		}
	},

	/*
	 * The ember story: the two chains (the world is bigger, the wanderer's cairns) and the
	 * axe-head and first hex trek milestones. Events are in script/events/story.js.
	 */
	checkStory: function () {
		if (Events.activeEvent() || Engine.activeModule == World || Engine.activeModule == Space) return;
		if (Network._nextAsk && Date.now() < Network._nextAsk) return;
		var start = function (e) {
			Network._nextAsk = Date.now() + 3 * 60 * 1000; // asked again in a while if put off
			Events.startEvent(e);
		};
		if (City.tab && !Network.flag('stoneHearth')) {
			start(Events.Story.stoneHearth);
		} else if (Network.has('H3') && World.hex && !Network.flag('brazier')) {
			start(Events.Story.biggerWorld);
		} else if (Network.has('B2') && !Network.flag('cairnTold')) {
			start(Events.Story.wanderer);
		} else {
			var e = Network.flameStory();
			if (e) start(e);
		}
	},

	storyFirstBrazier: function () {
		Network.setFlag('firstBrazier');
		Events.startEvent(Events.Story.firstBrazier);
	},

	onStep: function (x, y) {
		var s = Network.settlers();
		if (s && s.out && s.to[0] === x && s.to[1] === y) Network.settle();
		// F3: the first forest walked after the woodshed turns up the old axe-head
		if (Network.has('F2') && !$SM.get('game.world.axeHead') && !World.state.axeHead &&
			World.state.map[x][y].charAt(0) === WorldGen.TERRAIN.forest) {
			World.state.axeHead = true;
			Notifications.notify(World, _('half buried in the leaf litter, an old axe-head. still keen.'));
		}
		if (Network.isCairn(x, y) && Network.flag('cairnTold') && !Network.flag('cairnStudied') && !World.state.cairnStudied) {
			Events.startEvent(Events.Story.cairn);
		}
		// the flame era: the old pits, and the garrison's site (seen in passing, then its gate)
		if (Network.isPits(x, y) && Network.flag('strangerSat') && !World.state.pitsFound) {
			Events.startEvent(Events.Flame.pits());
		}
		var g = $SM.get('game.network.garrison');
		if (g && Network.flag('smoke')) {
			var site = World.siteAt(g[0], g[1]);
			if (!Network.flag('garrisonMarked') && site.hexes.some(function (h) { return Fire.distance(h, [x, y]) <= World.LIGHT_RADIUS; })) {
				Network.markGarrison();
			}
			if (World.siteAt(x, y) === site && !Network.flag('gateMet') && !World.state.gateMet) {
				Events.startEvent(Events.Flame.gate());
			}
		}
	},

	onHome: function () {
		if (Network.has('B1')) Network.setFlag('trekHome');
		// the cairn studied on this trek (committed with the trek's other finds) is known at home now
		if ($SM.get('game.world.cairnStudied')) {
			$SM.remove('game.world.cairnStudied', true);
			Network.setFlag('cairnStudied');
		}
		if (Network.flag('cairnStudied') && !Network.flag('cairnDone')) {
			Engine.setTimeout(function () { Events.startEvent(Events.Story.cairnFire); }, 1500);
		}
		// what this trek found for the flame era, known at home now (lost with it on a death)
		['pitsFound', 'gateMet', 'towerHeld'].forEach(function (k) {
			var v = $SM.get('game.world.' + k);
			if (!v) return;
			$SM.remove('game.world.' + k, true);
			Network.setFlag(k, v);
		});
		if (Network.flag('pitsFound') && !Network.flag('charcoalWay')) {
			Engine.setTimeout(function () { if (!Events.activeEvent()) Events.startEvent(Events.Flame.burningPits()); }, 1500);
		}
		Network.refresh();
	},

	// the cairn the wanderer tells of: open ground 7-9 hexes from the capital, hills first, a hex of its own
	placeCairn: function () {
		var gen = World.hex.gen, cap = gen.capital, best = null, score = -1;
		for (var y = Math.max(0, cap[1] - 9); y <= Math.min(gen.rows - 1, cap[1] + 9); y++) {
			for (var x = Math.max(0, cap[0] - 10); x <= Math.min(gen.cols - 1, cap[0] + 10); x++) {
				var d = Fire.distance(cap, [x, y]);
				if (d < 7 || d > 9 || !gen.reachable[x + y * gen.cols] || World.siteAt(x, y) ||
					Network.beaconAt(x, y) || Network.districtAt(x, y)) continue;
				var t = World.hex.map[x][y];
				if (!WorldGen.isTerrain(t) || !WorldGen.isPassable(t) || t === WorldGen.TERRAIN.ocean) continue;
				var s = (t === WorldGen.TERRAIN.hills ? 2 : 0) + (World.hex.mask[x][y] ? 0 : 1);
				if (s > score) {
					score = s;
					best = [x, y];
				}
			}
		}
		if (!best) best = [cap[0] + 7, cap[1]];
		$SM.set('game.network.cairn', best);
		World.uncoverMap(best[0], best[1], 1, World.hex.mask);
		World.saveHex(World.worldFlags());
		Network.draw();
	},

	/*
	 * The flame era (design/LADDERS.md tiers 5-8, design/text/flame-draft.md). Its fixed events
	 * are in script/events/flame.js:
	 *   the charcoal stranger  oldChimney (H5) -> stranger -> pits (on a trek) -> burningPits (F5) -> coda
	 *   the garrison of the deep mines  smoke -> gate (on a trek); the siege is Phase 6's, which
	 *                          calls Fire.unlock('F8') when the garrison is broken
	 * The city-states' beats (F6 peat, B8 marsh lantern, H6 kiln, F7 resin) play in Phase 4's
	 * scenes; here they are only read.
	 */
	// what kind of ground every hex is for a line (Fire.compute's net.kind): the terrain's bits
	// once per world, the roads (a road, a waystation or a city's hex) again when the map changes
	kinds: function () {
		var gen = World.hex.gen, map = World.hex.map, cols = gen.cols, T = WorldGen.TERRAIN;
		if (Network._kinds && Network._kinds.map === map && Network._kinds.gen === gen) return Network._kinds.bits;
		var bits = new Uint8Array(cols * gen.rows);
		for (var x = 0; x < cols; x++) {
			for (var y = 0; y < gen.rows; y++) {
				var t = gen.terrain[x][y], c = map[x][y], k = x + y * cols;
				if (t === T.swamp) bits[k] = Fire.SWAMP;
				else if (t === T.jungle) bits[k] = Fire.JUNGLE;
				else if (t === T.lake) bits[k] = Fire.LAKE;
				if (c === World.TILE.ROAD || c === World.TILE.VILLAGE || c === World.TILE.OUTPOST) bits[k] |= Fire.ROAD;
			}
		}
		Network._kinds = { map: map, gen: gen, bits: bits };
		Network._roadsFor = null;
		return bits;
	},

	// which cities a road joins: { cityId: the road's number }, kept until the map or the cities change
	roads: function () {
		var bits = Network.kinds(), cs = Network.cities(), key = cs.map(function (c) { return c.id; }).join();
		if (Network._roadsFor && Network._roadsFor.bits === bits && Network._roadsFor.key === key) return Network._roadsFor.comp;
		var gen = World.hex.gen, cols = gen.cols, seen = {}, comp = {}, n = 0;
		cs.forEach(function (c) {
			var at = c.city.hex, k0 = at[0] + at[1] * cols;
			if (seen[k0] === undefined) {
				var queue = [at];
				seen[k0] = ++n;
				for (var qi = 0; qi < queue.length; qi++) {
					for (var d = 0; d < 6; d++) {
						var p = WorldGen.neighbour(queue[qi][0], queue[qi][1], d), k = p[0] + p[1] * cols;
						if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= gen.rows || seen[k] !== undefined || !(bits[k] & Fire.ROAD)) continue;
						seen[k] = n;
						queue.push(p);
					}
				}
			}
			comp[c.id] = seen[k0];
		});
		Network._roadsFor = { bits: bits, key: key, comp: comp };
		return comp;
	},

	roadJoined: function () {
		if (!World.hex) return false;
		var comp = Network.roads(), count = {};
		for (var id in comp) {
			if ((count[comp[id]] = (count[comp[id]] || 0) + 1) > 1) return true;
		}
		return false;
	},

	// the other cities a road runs to from this one
	joinedTo: function (cityId) {
		var comp = Network.roads();
		return Object.keys(comp).filter(function (id) { return id != cityId && comp[id] === comp[cityId]; });
	},

	/*
	 * A new city's road (provisional, flame-build.md): its settlers' track to the nearest road, waystation
	 * or city within Network.ROAD_REACH, over open dry ground, as the wanderer's track joins a cleared
	 * waystation to the roads (World.drawRoad). Not across a site, unless it's one of ours.
	 */
	layRoad: function (at, map) {
		var gen = World.hex.gen, cols = gen.cols, from = {}, start = at[0] + at[1] * cols, queue = [at], end = null;
		var ok = function (x, y) {
			var t = gen.terrain[x][y], site = World.siteAt(x, y);
			if (!WorldGen.isPassable(t) || WorldGen.isWater(t)) return false;
			return !site || map[site.anchor[0]][site.anchor[1]] === World.TILE.VILLAGE;
		};
		from[start] = -1;
		for (var qi = 0; qi < queue.length && !end; qi++) {
			var q = queue[qi];
			if (Fire.distance(q, at) >= Network.ROAD_REACH) continue;
			for (var d = 0; d < 6 && !end; d++) {
				var p = WorldGen.neighbour(q[0], q[1], d), k = p[0] + p[1] * cols;
				if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= gen.rows || from[k] !== undefined || !ok(p[0], p[1])) continue;
				from[k] = q[0] + q[1] * cols;
				var c = map[p[0]][p[1]];
				if (c === World.TILE.ROAD || c === World.TILE.VILLAGE || c === World.TILE.OUTPOST) end = k;
				else if (World.roadCanCross(c)) queue.push(p); // a road goes round a landmark
			}
		}
		if (end === null) return false;
		for (var s = from[end]; s !== start; s = from[s]) {
			var x = s % cols;
			map[x][(s - x) / cols] = World.TILE.ROAD;
		}
		return true;
	},

	// the ford light's beat (provisional): two lit nodes a hop apart with only lake water between them
	facing: function (net, result) {
		var gen = World.hex.gen, cols = gen.cols, bits = net.kind;
		var lit = result.nodes.filter(function (n) { return n.s >= Fire.LIT_MIN; });
		for (var i = 0; i < lit.length; i++) {
			for (var j = i + 1; j < lit.length; j++) {
				if (Fire.distance(lit[i].at, lit[j].at) > Fire.HOP) continue;
				var l = Fire.line(lit[i].at, lit[j].at), lake = false, ok = true;
				for (var m = 1; m < l.length - 1 && ok; m++) {
					var k = l[m][0] + l[m][1] * cols;
					if (bits[k] & Fire.LAKE) lake = true;
					else if (!net.open(l[m][0], l[m][1])) ok = false;
				}
				if (ok && lake) {
					Network._facing = true;
					return;
				}
			}
		}
	},

	// "smoke in the hills": a lit hex within two hexes of band 2 hills (seen on this refresh, not saved)
	seeSmoke: function (result) {
		var gen = World.hex.gen, cols = gen.cols, field = World.baseField(), T = WorldGen.TERRAIN;
		Network._smoke = false;
		for (var k = 0; k < result.lit.length; k++) {
			// danger changes by about a tenth a hex out there: nothing far under band 2 is two hexes from it
			if (!result.lit[k] || field[k] < Network.BAND2 - 1) continue;
			var x = k % cols, y = (k - x) / cols;
			var near = Fire.around(x, y, 2).some(function (p) {
				return p[0] >= 0 && p[1] >= 0 && p[0] < cols && p[1] < gen.rows &&
					gen.terrain[p[0]][p[1]] === T.hills && field[p[0] + p[1] * cols] >= Network.BAND2;
			});
			if (near) {
				Network._smoke = true;
				return;
			}
		}
	},

	// the garrison of the deep mines (provisional): the old-world complex nearest the capital, once asked
	garrison: function () {
		var g = $SM.get('game.network.garrison');
		if (g) return g;
		var gen = World.hex.gen, best = null;
		gen.sites.forEach(function (s) {
			if (s.kind !== 'complex') return;
			if (!best || Fire.distance(s.anchor, gen.capital) < Fire.distance(best, gen.capital)) best = s.anchor;
		});
		if (best) $SM.set('game.network.garrison', best.slice());
		return best;
	},

	isGarrison: function (x, y) {
		var g = $SM.get('game.network.garrison');
		if (!g || !Network.flag('garrisonMarked')) return false;
		var site = World.siteAt(x, y);
		return !!site && site === World.siteAt(g[0], g[1]);
	},

	// the site marked on the map: every hex of it seen, at home or on the trek
	markGarrison: function () {
		var g = Network.garrison();
		if (!g || Network.flag('garrisonMarked')) return;
		var mask = World.state ? World.state.mask : World.hex.mask;
		World.siteAt(g[0], g[1]).hexes.forEach(function (h) { World.uncoverMap(h[0], h[1], 0, mask); });
		if (!World.state) World.saveHex(World.worldFlags());
		Network.setFlag('garrisonMarked');
	},

	// the siege's puzzle (flame-draft: "the garrison needs a lit beacon at its gate"), for Phase 6:
	// a lit beacon on a hex next to the garrison's site
	gateLit: function () {
		var g = $SM.get('game.network.garrison'), fire = World.hex && World.hex.fire;
		if (!g || !fire) return false;
		var site = World.siteAt(g[0], g[1]), cols = World.hex.gen.cols;
		return site.hexes.some(function (h) {
			return District.neighbours(h).some(function (p) {
				return World.siteAt(p[0], p[1]) !== site && Network.beaconAt(p[0], p[1]) && fire.lit[p[0] + p[1] * cols];
			});
		});
	},

	// the painter asks for every hex (perf): the pits as of the last refresh or placing, null once found
	isPits: function (x, y) {
		var p = Network._pits;
		return !!p && p[0] === x && p[1] === y;
	},

	// the old pits the stranger tells of: forest 3-6 hexes from their city, nearest first, a hex of its own
	placePits: function (cityId) {
		var at = $SM.get(City.path(cityId, 'hex')), gen = World.hex.gen, best = null;
		if (!at) return;
		Fire.around(at[0], at[1], 6).forEach(function (p) {
			var x = p[0], y = p[1], d = Fire.distance(p, at);
			if (d < 3 || x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || !gen.reachable[x + y * gen.cols]) return;
			if (gen.terrain[x][y] !== WorldGen.TERRAIN.forest || World.hex.map[x][y] !== WorldGen.TERRAIN.forest) return;
			if (World.siteAt(x, y) || Network.beaconAt(x, y) || Network.districtAt(x, y) || Network.isCairn(x, y)) return;
			if (!best || d < Fire.distance(best, at)) best = p;
		});
		// no forest near: the nearest open ground will do
		if (!best) best = [at[0] + 3, at[1]];
		$SM.set('game.network.pits', best);
		Network._pits = best;
		World.uncoverMap(best[0], best[1], 1, World.hex.mask);
		World.saveHex(World.worldFlags());
		Network.draw();
	},

	// the bog cuts of a city dug deep (game.citystates.beats.F6way 'deep') wear out as they are
	// cut, and rest once spent: { 'x,y': { w: 0-1, spent } } in the city's record
	wearBogs: function () {
		Network.cities().forEach(function (c) {
			var hexes = City.districtHexes(c.id, 'bog cuts');
			if (!hexes.length) return;
			var bogs = $.extend({}, c.city.bogs), cutters = (c.city.workers || {})['peat cutter'] || 0, spentNow = false;
			var open = hexes.filter(function (h) { var b = bogs[h.join(',')]; return !b || !b.spent; });
			var per = open.length ? cutters / open.length : 0;
			hexes.forEach(function (h) {
				var k = h.join(','), b = $.extend({ w: 0, spent: false }, bogs[k]);
				if (b.spent) {
					b.w = Math.max(0, b.w - Network.BOG_REST);
					if (b.w === 0) b.spent = false;
				} else {
					b.w = Math.min(1, b.w + Network.BOG_WEAR * per / 4);
					if (b.w >= 1) b.spent = spentNow = true;
				}
				bogs[k] = b;
			});
			$SM.set(City.path(c.id, 'bogs'), bogs, true);
			if (spentNow) {
				var slots = City.jobSlots(c.id, 'peat cutter');
				if (cutters > slots) $SM.set(City.path(c.id, 'workers["peat cutter"]'), slots, true);
			}
		});
	},

	// once a fire tick: the chain's waits, and the first resin
	flameTick: function () {
		var st = $SM.get('game.network.story') || {};
		['strangerTicks', 'codaTicks'].forEach(function (k) {
			if (st[k] > 0) $SM.set('game.network.story.' + k, st[k] - 1, true);
		});
		if (st.charcoalWay && !st.coda && st.codaTicks === 1) {
			Notifications.notify(null, _("the stranger has taken a place at the pits. doesn't say much. doesn't need to."));
			$SM.set('game.network.story.coda', true, true);
		}
		if (Network.has('F7') && !st.resinTraded && Network.anyCity(function (c, id) { return $SM.get(City.storePath(id, 'resin'), true) > 0; })) {
			Notifications.notify(null, _('they hand it over in leaf cups, still soft.'));
			$SM.set('game.network.story.resinTraded', true, true);
		}
	},

	// the flame era's scenes at home, one at a time (Network.checkStory)
	flameStory: function () {
		var st = $SM.get('game.network.story') || {};
		if (st['the charcoal stranger'] && !st.oldChimney && Network.has('H4')) return Events.Flame.oldChimney();
		if (st.oldChimney && !st.strangerSat && (st.strangerAsked || 0) < 2 && !(st.strangerTicks > 0)) return Events.Flame.stranger();
		if (st.pitsFound && !st.charcoalWay) return Events.Flame.burningPits();
		if (Network._smoke && !st.smoke) return Events.Flame.smoke();
		return null;
	},

	// the wanderer won a fight: on or next to a lit waystation, the waystation held (B5, provisional)
	onFightWon: function () {
		if (!World.state || !World.hex || !World.hex.fire || Network.flag('towerHeld') || World.state.towerHeld) return;
		var at = World.curPos, cols = World.hex.gen.cols, map = World.state.map;
		var held = [at].concat(District.neighbours(at)).some(function (p) {
			return map[p[0]] && map[p[0]][p[1]] === World.TILE.OUTPOST && World.hex.fire.lit[p[0] + p[1] * cols];
		});
		if (held) World.state.towerHeld = true;
	},

	// goods along a road (B6): what a city can send, the stores its jobs, fuels and settlers deal in
	goods: function () {
		if (Network._goods) return Network._goods;
		var g = {};
		for (var j in City._INCOME) for (var k in City._INCOME[j].stores) g[k] = true;
		for (var f in Fire.FUELS) g[f] = true;
		for (var s in City.SETTLERS.stores) g[s] = true;
		['leather', 'iron', 'steel', 'sulphur', 'cloth', 'scales', 'teeth'].forEach(function (k) { g[k] = true; });
		return (Network._goods = Object.keys(g));
	},

	// a cart of one store from a city to one a road joins it to; returns what it carried
	// shortcut: carts arrive at once, at no cost; give them a road's travel time if the user wants it
	sendCart: function (from, to, store) {
		if (!Network.has('B6') || Network.joinedTo(from).indexOf(to) < 0) return 0;
		var have = $SM.get(City.storePath(from, store), true), n = Math.min(Network.CART, Math.floor(have));
		if (n <= 0) return 0;
		$SM.add(City.storePath(from, store), -n);
		$SM.add(City.storePath(to, store), n);
		return n;
	},

	// the road box under the land: a button to every city a road joins this one to
	updateRoads: function () {
		var box = $('#landRoads'), to = Network.has('B6') ? Network.joinedTo(City.activeCity) : [];
		if (!to.length) {
			box.remove();
			return;
		}
		if (!box.length) box = $('<div>').attr('id', 'landRoads').insertAfter('#fireStatus');
		var key = City.activeCity + ':' + to.join();
		if (box.attr('data-key') === key) return;
		box.attr('data-key', key).empty();
		to.forEach(function (id) {
			new Button.Button({
				id: 'land_road_' + id, text: _('send to {0}', $SM.get('game.cities["' + id + '"].name')), width: '80px',
				click: function () { Events.startEvent(Events.Flame.carts(City.activeCity, id)); }
			}).appendTo(box);
		});
	},

	handleStateUpdates: function (e) {
		if (e.category == 'all' || (e.stateName && e.stateName.indexOf('game.cities') === 0)) Network._districts = null;
		if (e.category == 'stores' || (e.stateName && (e.stateName.indexOf('game.cities') === 0 ||
			e.stateName.indexOf('game.workers') === 0 || e.stateName.indexOf('game.builder') === 0 ||
			e.stateName.indexOf('game.temperature') === 0 || e.stateName.indexOf('game.world') === 0 ||
			e.stateName.indexOf('game.network') === 0 || e.stateName.indexOf('game.citystates') === 0 ||
			e.stateName.indexOf('game.population') === 0))) {
			Network.checkUnlocks();
		}
	}
};
