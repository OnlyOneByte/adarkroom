/**
 * The fire network in the game (rules and numbers: script/fire.js).
 *
 * Saved state, game.network:
 *   tiers     { F1: true, ... } the ladder tiers unlocked
 *   beacons   { 'x,y': true } beacons standing on the hex map
 *   story     flags of the ember story chains and milestones
 *   cairn     [x, y] the old cairn the wanderer tells of, once told
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
		}
	},

	// one line when a milestone tier arrives (story tiers have their own scenes)
	MESSAGES: {
		F2: _('wood dried in the shed burns hotter. the fire reaches a little further.'),
		F3: _('the old axe-head bites into oak. seasoned, it burns long and far.'),
		F4: _('fat from the smokehouse renders down to tallow. it burns slow and bright.'),
		B2: _('the trek came home. torch-posts go up where the braziers stood.'),
		B4: _('a waystation in the light. watch fires there can see a long way.'),
		H2: _('the builder digs the fire into a pit, ringed with stones.'),
		H4: _('the hearth grows with the town. it keeps some fire back.')
	},

	init: function () {
		if (!$SM.get('game.network')) $SM.set('game.network', { tiers: {}, beacons: {}, story: {} }, true);
		Network.checkUnlocks();
		$.Dispatch('stateUpdate').subscribe(Network.handleStateUpdates);
		Network.refresh();
		Network.scheduleTick();
	},

	flag: function (k) {
		return !!$SM.get('game.network.story.' + k);
	},

	setFlag: function (k) {
		$SM.set('game.network.story.' + k, true);
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

	districtAt: function (x, y) {
		var cs = Network.cities(), k = Network.key(x, y);
		for (var i = 0; i < cs.length; i++) {
			if (cs[i].city.districts[k]) return cs[i].city.districts[k];
		}
		return null;
	},

	// the index of the city a hex belongs to, -1 if none (for outlining cities on the map)
	cityIndexAt: function (x, y) {
		var cs = Network.cities(), k = Network.key(x, y);
		for (var i = 0; i < cs.length; i++) {
			if (cs[i].city.districts[k]) return i;
		}
		return -1;
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
		Network.ensureCapital();
		var gen = World.hex.gen, cs = Network.cities();
		var hid = Network.hearthTier(), H = Fire.HEARTHS[hid];
		var beacons = Object.keys($SM.get('game.network.beacons') || {}).map(function (k) {
			return k.split(',').map(Number);
		});
		var bt = Network.beaconTier();
		var result = Fire.compute({
			cols: gen.cols, rows: gen.rows,
			danger: World.baseDangerAt,
			hills: function (x, y) { return gen.terrain[x][y] === WorldGen.TERRAIN.hills; },
			hearths: cs.map(function (c) {
				var h = c.city.hearth || {}, f = h.fuel && Fire.FUELS[h.fuel];
				return {
					at: c.city.hex, out: h.out || 0, share: H.share, cap: f ? f.cap : 0,
					hexes: Object.keys(c.city.districts).map(function (k) { return k.split(',').map(Number); })
				};
			}),
			beacons: beacons,
			beacon: bt ? Fire.BEACONS[bt] : null
		});
		World.hex.fire = result;
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

	// how many beacons each city's hearth fed (s >= 1), by city index
	fed: function (result) {
		var n = 0;
		result.nodes.forEach(function (node) { if (!node.hearth && node.s >= Fire.LIT_MIN) n++; });
		return n;
	},

	scheduleTick: function () {
		Network._tickTimeout = Engine.setTimeout(Network.tick, Fire.TICK * 1000);
	},

	// The fire tick: every city's hearth burns its fuel, then the network is worked out again.
	tick: function () {
		if ($SM.get('features.location.city')) {
			var hid = Network.hearthTier(), H = Fire.HEARTHS[hid], tiers = Network.tiers();
			Network.cities().forEach(function (c) {
				var h = c.city.hearth || {};
				var fuel = Fire.pickFuel(tiers, function (k) { return $SM.get(City.storePath(c.id, k), true); });
				var need = H.out + (H.share ? Fire.UPKEEP * (h.fed || 0) : 0);
				var stock = fuel ? $SM.get(City.storePath(c.id, fuel), true) : 0;
				var r = Fire.burn(hid, fuel, need, stock, h.stored || 0);
				if (r.burn) $SM.add(City.storePath(c.id, fuel), -r.burn);
				$SM.set(City.path(c.id, 'hearth'), {
					fuel: r.out > 0 ? fuel : null, out: Math.round(r.out * 100) / 100, stored: r.stored, fed: h.fed || 0
				});
			});
			Network.refresh();
			if (World.hex && World.hex.fire) {
				var fed = Network.fed(World.hex.fire);
				Network.cities().forEach(function (c) { $SM.set(City.path(c.id, 'hearth.fed'), fed, true); });
			}
			City.updateIncome();
			Network.checkStory();
		}
		Network.scheduleTick();
	},

	/*
	 * Placing things on the land
	 */
	// a beacon goes on seen, open ground, up to Fire.HOP hexes from a hearth or another beacon
	canBeacon: function (x, y) {
		if (!World.hex || !Network.beaconTier()) return false;
		var gen = World.hex.gen;
		if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || !World.hex.mask[x][y]) return false;
		if (!WorldGen.isPassable(World.hex.map[x][y]) || World.hex.map[x][y] === WorldGen.TERRAIN.ocean) return false;
		if (Network.beaconAt(x, y) || Network.districtAt(x, y)) return false;
		var nodes = Network.cities().map(function (c) { return c.city.hex; })
			.concat(Object.keys($SM.get('game.network.beacons') || {}).map(function (k) { return k.split(',').map(Number); }));
		return nodes.some(function (n) { return Fire.distance(n, [x, y]) <= Fire.HOP; });
	},

	raiseBeacon: function (x, y) {
		if (!Network.canBeacon(x, y)) return false;
		var cost = Fire.BEACONS[Network.beaconTier()].cost;
		if (!Network.pay(City.CAPITAL, cost)) return false;
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
		var f = World.formationAt(x, y);
		return {
			at: [x, y],
			terrain: Network.terrainKey(x, y),
			terrainAt: Network.terrainKey,
			site: !!World.siteAt(x, y),
			deep: !!f && f.kind === 'forest',
			city: $SM.get(City.path(cityId, 'districts')) || {}
		};
	},

	// district types that can go on this hex for a city
	districtsFor: function (cityId, x, y) {
		var c = $SM.get('game.cities["' + cityId + '"]');
		if (!World.hex || !c || !c.hex) return [];
		var gen = World.hex.gen;
		if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || !World.hex.mask[x][y]) return [];
		if (Network.districtAt(x, y) || Network.beaconAt(x, y)) return [];
		if (Fire.distance(c.hex, [x, y]) > District.MAX_RING) return [];
		// a city grows outward: next to one of its own districts
		if (!District.neighbours([x, y]).some(function (p) { return c.districts[Network.key(p[0], p[1])]; })) return [];
		var g = Network.ground(cityId, x, y), out = [];
		for (var t in District.TYPES) {
			var T = District.TYPES[t];
			if (T.stub || t === District.HEARTH) continue;
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

	// one line about a hex's fire, for the hover label
	hexNote: function (x, y) {
		var d = Network.districtAt(x, y);
		if (d) return District.TYPES[d].name.replace(/ /g, '&nbsp;');
		if (Network.isCairn(x, y)) return _('an&nbsp;old&nbsp;cairn');
		if (Network.beaconAt(x, y)) {
			var bt = Network.beaconTier(), lit = World.hex.fire && World.hex.fire.lit[x + y * World.hex.gen.cols];
			var name = bt ? Fire.tier(bt).name : _('beacon');
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
		var c = $SM.get('game.cities["' + City.CAPITAL + '"]');
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
	},

	updateActions: function () {
		var box = $('#landActions').empty(), h = Network.selected;
		if (!h) return;
		var bt = Network.beaconTier();
		if (Network.beaconAt(h[0], h[1])) {
			new Button.Button({
				id: 'land_putout', text: _('put out'), width: '80px',
				click: function () { Network.putOut(h[0], h[1]); Network.updateActions(); }
			}).appendTo(box);
		} else if (bt && Network.canBeacon(h[0], h[1])) {
			new Button.Button({
				id: 'land_beacon', text: _('raise {0}', Fire.tier(bt).name), width: '80px',
				cost: Fire.BEACONS[bt].cost,
				click: function () { Network.raiseBeacon(h[0], h[1]); Network.updateActions(); }
			}).appendTo(box);
		}
		Network.districtsFor(City.CAPITAL, h[0], h[1]).forEach(function (t) {
			new Button.Button({
				id: 'land_district_' + t.replace(/ /g, '-'), text: District.TYPES[t].name, width: '80px',
				cost: Network.DISTRICT_COST,
				click: function () { Network.placeDistrict(City.CAPITAL, h[0], h[1], t); Network.updateActions(); }
			}).appendTo(box);
		});
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
		}
	},

	storyFirstBrazier: function () {
		Network.setFlag('firstBrazier');
		Events.startEvent(Events.Story.firstBrazier);
	},

	onStep: function (x, y) {
		// F3: the first forest walked after the woodshed turns up the old axe-head
		if (Network.has('F2') && !$SM.get('game.world.axeHead') && !World.state.axeHead &&
			World.state.map[x][y].charAt(0) === WorldGen.TERRAIN.forest) {
			World.state.axeHead = true;
			Notifications.notify(World, _('half buried in the leaf litter, an old axe-head. still keen.'));
		}
		if (Network.isCairn(x, y) && Network.flag('cairnTold') && !Network.flag('cairnStudied')) {
			Events.startEvent(Events.Story.cairn);
		}
	},

	onHome: function () {
		if (Network.has('B1')) Network.setFlag('trekHome');
		if (Network.flag('cairnStudied') && !Network.flag('cairnDone')) {
			Engine.setTimeout(function () { Events.startEvent(Events.Story.cairnFire); }, 1500);
		}
		Network.refresh();
	},

	// the cairn the wanderer tells of: open ground 7-9 hexes from the capital, hills first
	placeCairn: function () {
		var gen = World.hex.gen, cap = gen.capital, best = null, score = -1;
		for (var y = Math.max(0, cap[1] - 9); y <= Math.min(gen.rows - 1, cap[1] + 9); y++) {
			for (var x = Math.max(0, cap[0] - 10); x <= Math.min(gen.cols - 1, cap[0] + 10); x++) {
				var d = Fire.distance(cap, [x, y]);
				if (d < 7 || d > 9 || !gen.reachable[x + y * gen.cols] || World.siteAt(x, y)) continue;
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

	handleStateUpdates: function (e) {
		if (e.category == 'stores' || (e.stateName && (e.stateName.indexOf('game.cities') === 0 ||
			e.stateName.indexOf('game.workers') === 0 || e.stateName.indexOf('game.builder') === 0 ||
			e.stateName.indexOf('game.temperature') === 0 || e.stateName.indexOf('game.world') === 0))) {
			Network.checkUnlocks();
		}
	}
};
