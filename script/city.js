/**
 * Module that registers the town: the second tier of the settlement.
 * Unlocks once the village is full (20 huts) and has a trading post.
 *
 * Cities are separate places, each a record in game.cities[<cityId>]:
 *   name        display name
 *   focus       null (hands-on) or one of City.FOCUSES: the city governs itself (script/governor.js)
 *   population  { <tier>: count }; town tiers only, e.g. citizens
 *   buildings   { <City.Buildings key>: count }
 *   workers     { <City._INCOME key>: count }
 *   stores      { <store>: amount }, the city's local stockpile
 *   notices     { <Governor notice>: true } what its governor has already told the player
 *   parent      (founded cities) the city its settlers came from
 *   hex, districts, hearth   its place on the hex map and its fire (script/network.js)
 * Pooled empire-wide resources live in game.empire.treasury. Goods stay in their own city.
 *
 * The original village becomes the 'capital'. Its villagers, huts and
 * stockpile stay where Room and Outside keep them (game.population,
 * game.buildings, stores), so the capital record has no stores of its own
 * and City.storePath() points it at the original stockpile.
 */
var City = {
	name: _("Town"),

	CAPITAL: 'capital',
	FOCUSES: ['fire', 'farming', 'industry', 'trade', 'military'],
	// what a focused city is called in its governor's notices ("the forge town is out of coal.")
	FOCUS_NAMES: {
		fire: _('the fire town'), farming: _('the farm town'), industry: _('the forge town'),
		trade: _('the market town'), military: _('the garrison town')
	},
	// founded cities, in order
	NAMES: [_('second town'), _('third town'), _('fourth town'), _('fifth town'), _('sixth town'),
		_('seventh town'), _('eighth town'), _('ninth town'), _('tenth town')],
	NOTICES: {
		cold: _('the hearth in {0} has gone cold.'),
		fuel: _('{0} is out of {1}.'),
		idle: _('{0} has hands and no work.'),
		spent: _('the bog cuts are spent.')
	},

	/*
	 * Founding a city: people from the parent city, and their supplies (the new city's first stores).
	 * provisional: CITY.md's 40 wood + 20 cured meat made founding almost free; these are tuned with
	 * the simulator (npm run sim) so the ember era holds 2-3 cities, the 2nd ~20 minutes in.
	 */
	SETTLERS: { people: 8, stores: { 'wood': 600, 'cured meat': 300 } },

	_STORES_OFFSET: 0,
	_POP_DELAY: [0.5, 3],
	_UNLOCK_HUTS: 20,

	// the city the town panel shows
	activeCity: 'capital',

	/*
	 * Town buildings. Fields:
	 *   name          display name, through _()
	 *   district      the District type that holds it
	 *   maximum       how many can be built per district of that type
	 *   cost(cityId)  returns { store: amount }, paid from that city's stores
	 *   room          (optional) citizens housed per building
	 *   jobs          (optional) keys of City._INCOME this building opens
	 *   needs         (optional) a fire tier (script/fire.js) it waits for
	 *   later         (optional) true: data for a later phase, never offered
	 *   availableMsg, buildMsg, maxMsg  (optional) notifications
	 * A button shows once half its wood is in and every other cost store has been seen.
	 */
	Buildings: {
		'house': {
			name: _('house'),
			district: 'huts',
			maximum: 10,
			room: 4,
			jobs: ['labourer'],
			cost: function (cityId) {
				var n = $SM.get(City.path(cityId, 'buildings["house"]'), true);
				return {
					'wood': 300 + (n * 50)
				};
			}
		},
		// provisional costs from here down
		'woodshed': {
			name: _('woodshed'),
			district: 'hearth quarter',
			maximum: 1,
			jobs: ['drier', 'seasoner'],
			buildMsg: _('a woodshed against the damp. wood stacked in it dries.'),
			cost: function () { return { 'wood': 100 }; }
		},
		'tannery': {
			name: _('tannery'),
			district: 'tannery row',
			maximum: 1,
			jobs: ['tanner'],
			cost: function () { return { 'wood': 200, 'fur': 50 }; }
		},
		'smokehouse': {
			name: _('smokehouse'),
			district: 'tannery row',
			maximum: 1,
			jobs: ['charcutier'],
			cost: function () { return { 'wood': 250, 'meat': 50 }; }
		},
		'tallow vats': {
			name: _('tallow vats'),
			district: 'burning pits',
			maximum: 2,
			needs: 'F4',
			jobs: ['renderer'],
			cost: function () { return { 'wood': 150 }; }
		},
		'charcoal pits': {
			name: _('charcoal pits'),
			district: 'burning pits',
			maximum: 2,
			needs: 'F5',
			jobs: ['collier'],
			cost: function () { return { 'wood': 200 }; }
		},
		'wall': {
			name: _('wall'),
			district: 'walls',
			maximum: 1,
			cost: function () { return { 'wood': 200 }; }
		}
	},

	/*
	 * Town jobs. Each city pays its own income source '<cityId>:<job>'
	 * through $SM.setIncome: every `delay` seconds each worker adds `stores`
	 * (negative = consumed) to that city's stores.
	 * Unassigned citizens show as 'idle' and produce nothing.
	 *   district  the District type whose fire sets the pace: a district at half fire takes twice as long
	 *   raw       true: a raw job of the land; the city's districts open its places (District.TYPES[].jobs)
	 *   needs     (optional) a fire tier it waits for
	 * The original village's jobs keep working for the capital, outside all this.
	 */
	_INCOME: {
		'labourer': {
			name: _('labourer'),
			district: 'huts',
			delay: 10,
			stores: { 'wood': 1 }
		},
		// provisional rates from here down; the village's own jobs are kept where they exist
		// a founded city's first wood: the village's gatherer, around its hearth quarter
		'gatherer': {
			name: _('gatherer'), district: 'hearth quarter', raw: true, delay: 10,
			stores: { 'wood': 1 }
		},
		'woodcutter': {
			name: _('woodcutter'), district: 'woods', raw: true, delay: 10,
			stores: { 'wood': 2 }
		},
		'oak cutter': {
			name: _('oak cutter'), district: 'woods', raw: true, needs: 'F3', delay: 10,
			stores: { 'oak': 1 }
		},
		'hunter': {
			name: _('hunter'), district: 'hunting grounds', raw: true, delay: 10,
			stores: { 'fur': 0.5, 'meat': 0.5 }
		},
		'trapper': {
			name: _('trapper'), district: 'hunting grounds', raw: true, delay: 10,
			stores: { 'meat': -1, 'bait': 1 }
		},
		'drier': {
			name: _('drier'), district: 'hearth quarter', delay: 10,
			stores: { 'wood': -3, 'dry wood': 2 }
		},
		'seasoner': {
			name: _('seasoner'), district: 'hearth quarter', needs: 'F3', delay: 10,
			stores: { 'oak': -1, 'seasoned oak': 1 }
		},
		'tanner': {
			name: _('tanner'), district: 'tannery row', delay: 10,
			stores: { 'fur': -5, 'leather': 1 }
		},
		'charcutier': {
			name: _('charcutier'), district: 'tannery row', delay: 10,
			stores: { 'meat': -5, 'wood': -5, 'cured meat': 1 }
		},
		'renderer': {
			name: _('renderer'), district: 'burning pits', needs: 'F4', delay: 10,
			stores: { 'meat': -2, 'tallow': 1 }
		},
		// the flame era. collier: the stranger's way (City.WAYS has the builder's); peat cutter: the
		// bog-cutters' way (deep: City.WAYS)
		'collier': {
			name: _('collier'), district: 'burning pits', needs: 'F5', delay: 30,
			stores: { 'wood': -3, 'charcoal': 2 }
		},
		'peat cutter': {
			name: _('peat cutter'), district: 'bog cuts', raw: true, needs: 'F6', delay: 10,
			stores: { 'peat': 1 }
		},
		'resin tapper': {
			name: _('resin tapper'), district: 'woods', raw: true, needs: 'F7', delay: 10,
			stores: { 'resin': 1 }
		},
		'coal miner': {
			name: _('coal miner'), district: 'mines', raw: true, needs: 'F8', delay: 10,
			stores: { 'coal': 1 }
		}
	},

	/*
	 * provisional (flame-draft.md "Notes on varying rewards"): what a story choice changes in a job.
	 * game.network.story.charcoalWay 'own': the builder's pits, 3 wood -> 1 charcoal / 10 s;
	 * game.citystates.beats.F6way 'deep': twice the peat, and the bog cuts wear out (Network.wearBogs).
	 */
	WAYS: {
		collier: { own: { delay: 10, stores: { 'wood': -3, 'charcoal': 1 } } },
		'peat cutter': { deep: { delay: 10, stores: { 'peat': 2 } } }
	},

	// a job's pace and stores, after the story's choices
	income: function (job) {
		var w = City.WAYS[job], base = City._INCOME[job];
		if (!w) return base;
		var way = job === 'collier' ? $SM.get('game.network.story.charcoalWay') : $SM.get('game.citystates.beats.F6way');
		if (!w[way]) return base;
		var out = {};
		for (var k in base) out[k] = k in w[way] ? w[way][k] : base[k];
		return out;
	},

	init: function (options) {
		this.options = $.extend(
			this.options,
			options
		);

		// Create the town tab, between the village and the path
		this.tab = Header.addLocation(_("A Growing Town"), "city", City, 'path');

		if (!$SM.get('features.location.city')) {
			$SM.set('features.location.city', true);
		}
		if (!$SM.get('game.cities["' + City.CAPITAL + '"]')) {
			City.createCity(City.CAPITAL, _('capital'));
		}
		if (!$SM.get('game.empire.treasury')) $SM.set('game.empire.treasury', {}, true);

		// Create the town panel
		this.panel = $('<div>').attr('id', "cityPanel").addClass('location');
		if (Outside.panel) {
			this.panel.insertAfter(Outside.panel);
		} else {
			this.panel.appendTo('div#locationSlider');
		}
		Engine.updateSlider();

		$('<div>').attr({ 'id': 'citySwitch', 'data-legend': _('cities:') }).hide().appendTo(this.panel);
		$('<div>').attr({ 'id': 'cityFocus', 'data-legend': _('focus:') }).hide().appendTo(this.panel);
		$('<div>').attr({ 'id': 'cityBuildBtns', 'data-legend': _('build:') }).appendTo(this.panel);

		//subscribe to stateUpdates
		$.Dispatch('stateUpdate').subscribe(City.handleStateUpdates);

		City.updateSwitcher();
		City.updateTown();
		City.updateWorkersView();
		City.updateIncome();
		City.updateBuildButtons();
		// the land, once the hex map is open
		if (typeof Network != 'undefined') Network.refresh();
	},

	/*
	 * A new city record. opts (founded cities): hex, districts, stores, citizens, parent.
	 * Its hearth starts cold and lights on the next fire tick.
	 */
	createCity: function (cityId, name, opts) {
		opts = opts || {};
		var record = {
			name: name,
			focus: null,
			population: { citizens: opts.citizens || 0 },
			buildings: {},
			workers: {},
			notices: {}
		};
		if (cityId != City.CAPITAL) record.stores = opts.stores || {};
		if (opts.hex) {
			record.hex = opts.hex.slice();
			record.districts = opts.districts;
			record.hearth = { fuel: null, out: 0, stored: 0, fed: 0 };
			record.parent = opts.parent;
		}
		$SM.set('game.cities["' + cityId + '"]', record, true);
	},

	// the id and name for the next founded city
	nextCity: function () {
		var n = Object.keys($SM.get('game.cities') || {}).length;
		var id = 'city' + (n + 1);
		while ($SM.get('game.cities["' + id + '"]')) id = 'city' + (++n + 1);
		return { id: id, name: City.NAMES[n - 1] || _('town {0}', n + 1) };
	},

	// how a city is named in notices: its focus if it has one
	callName: function (cityId) {
		var c = $SM.get('game.cities["' + cityId + '"]');
		return c.focus ? City.FOCUS_NAMES[c.focus] : (cityId == City.CAPITAL ? _('the capital') : c.name);
	},

	// people a city can send away: the capital's villagers, another city's citizens
	people: function (cityId) {
		return cityId == City.CAPITAL ? $SM.get('game.population', true) : $SM.get(City.path(cityId, 'population.citizens'), true);
	},

	// n people leave a city; the jobs they leave go unworked
	removePeople: function (cityId, n) {
		if (cityId == City.CAPITAL) {
			Outside.killVillagers(n);
			return;
		}
		$SM.add(City.path(cityId, 'population.citizens'), -n);
		var gap = -City.getNumIdle(cityId), w = $SM.get(City.path(cityId, 'workers')) || {};
		for (var k in w) {
			if (gap <= 0) break;
			var take = Math.min(w[k], gap);
			$SM.set(City.path(cityId, 'workers["' + k + '"]'), w[k] - take);
			gap -= take;
		}
	},

	// Called on every state update until the town exists.
	checkUnlock: function () {
		if (City.tab) return;
		if ($SM.get('game.buildings["hut"]', true) >= City._UNLOCK_HUTS &&
			$SM.get('game.buildings["trading post"]', true) > 0) {
			City.unlock();
		}
	},

	unlock: function () {
		City.init();
		Notifications.notify(null, _("the village has outgrown its huts."));
		// the world opens up into the hex map; without a compass it waits for World.init
		if (World.panel) World.openHexMap();
		Engine.event('progress', 'city');
	},

	// $SM path of a field in a city record
	path: function (cityId, field) {
		return 'game.cities["' + (cityId || City.activeCity) + '"].' + field;
	},

	// $SM path of a city's stockpile; the capital uses the original one
	storesPath: function (cityId) {
		cityId = cityId || City.activeCity;
		return cityId == City.CAPITAL ? 'stores' : City.path(cityId, 'stores');
	},

	storePath: function (cityId, store) {
		return City.storesPath(cityId) + '["' + store + '"]';
	},

	// the hexes of a city's districts of one type, [[x, y]]
	districtHexes: function (cityId, type) {
		var d = $SM.get(City.path(cityId, 'districts')) || {}, out = [];
		for (var k in d) {
			if (d[k] === type) out.push(k.split(',').map(Number));
		}
		return out;
	},

	tierMet: function (id) {
		return !id || Network.has(id);
	},

	// how many of a building a city can have: its maximum for every district that holds it
	maximum: function (thing, cityId) {
		var b = City.Buildings[thing];
		if (b.later || !City.tierMet(b.needs)) return 0;
		// shortcut: a town whose hex map hasn't opened yet (no compass) builds as if it had one of each
		if (!$SM.get(City.path(cityId, 'hex'))) return b.maximum;
		return b.maximum * City.districtHexes(cityId, b.district).length;
	},

	// places for a raw job: what the land of the city's districts opens; other jobs are not capped
	jobSlots: function (cityId, job) {
		var income = City._INCOME[job];
		if (!City.tierMet(income.needs)) return 0;
		if (!income.raw) return Infinity;
		var slots = 0, fn = District.TYPES[income.district].jobs[job];
		cityId = cityId || City.activeCity;
		City.districtHexes(cityId, income.district).forEach(function (at) {
			slots += fn(Network.ground(cityId, at[0], at[1]));
		});
		return slots;
	},

	/*
	 * How fast a job works in a city, 1 = its listed pace: the fire share of the districts it
	 * works in (-25% a ring from the hearth quarter, plus adjacency bonuses), times how well the
	 * hearth is burning (half pace when it is out).
	 */
	jobShare: function (cityId, job) {
		var c = $SM.get('game.cities["' + cityId + '"]'), income = City._INCOME[job];
		if (!c || !c.hex || !income.district) return 1;
		var hexes = City.districtHexes(cityId, income.district), total = 0, weight = 0;
		var fn = income.raw ? District.TYPES[income.district].jobs[job] : null;
		hexes.forEach(function (at) {
			var w = fn ? fn(Network.ground(cityId, at[0], at[1])) : 1;
			if (!w) return;
			total += w * District.jobShare(income.district, job, at, c.hex, c.districts);
			weight += w;
		});
		if (!weight) return 1;
		var full = Network.hearthOut(cityId), out = c.hearth ? c.hearth.out : 0;
		var burning = District.DARK_FLOOR + (1 - District.DARK_FLOOR) * (full > 0 ? Math.min(1, out / full) : 0);
		return total / weight * burning;
	},

	getMaxCitizens: function (cityId) {
		var room = 0;
		for (var k in City.Buildings) {
			if (City.Buildings[k].room) {
				room += $SM.get(City.path(cityId, 'buildings["' + k + '"]'), true) * City.Buildings[k].room;
			}
		}
		return room;
	},

	increaseCitizens: function () {
		for (var cityId in $SM.get('game.cities')) {
			var citizens = City.path(cityId, 'population.citizens');
			var space = City.getMaxCitizens(cityId) - $SM.get(citizens, true);
			if (space > 0) {
				var num = Math.floor(Math.random() * (space / 2) + space / 2);
				if (num === 0) num = 1;
				$SM.add(citizens, num);
			}
		}
		City.scheduleCitizenIncrease();
	},

	scheduleCitizenIncrease: function () {
		var delay = City._POP_DELAY;
		var next = Math.floor(Math.random() * (delay[1] - delay[0])) + delay[0];
		City._popTimeout = Engine.setTimeout(City.increaseCitizens, next * 60 * 1000);
	},

	buildUnlocked: function (thing) {
		if (City.Buildings[thing].button) return true;
		if (City.maximum(thing) === 0) return false;
		if ($SM.get(City.path(null, 'buildings["' + thing + '"]')) > 0) return true;
		// show once half the wood is in, and every other component has been seen
		var cost = City.Buildings[thing].cost(City.activeCity);
		if ($SM.get(City.storePath(null, 'wood'), true) < cost['wood'] * 0.5) return false;
		for (var c in cost) {
			if (!$SM.get(City.storePath(null, c))) return false;
		}
		if (City.Buildings[thing].availableMsg) Notifications.notify(City, City.Buildings[thing].availableMsg);
		return true;
	},

	updateBuildButtons: function () {
		var section = $('#cityBuildBtns');
		for (var k in City.Buildings) {
			var building = City.Buildings[k];
			var max = $SM.get(City.path(null, 'buildings["' + k + '"]'), true) >= City.maximum(k);
			if (!building.button) {
				if (!City.buildUnlocked(k)) continue;
				building.button = new Button.Button({
					id: 'build_city_' + k.replace(/ /g, '-'),
					cost: building.cost(City.activeCity),
					text: building.name,
					click: City.build,
					width: '80px'
				}).attr('buildThing', k).appendTo(section);
			} else {
				// refresh the tooltip
				var costTooltip = $('.tooltip', building.button);
				costTooltip.empty();
				var cost = building.cost(City.activeCity);
				for (var c in cost) {
					$("<div>").addClass('row_key').text(_(c)).appendTo(costTooltip);
					$("<div>").addClass('row_val').text(cost[c]).appendTo(costTooltip);
				}
				if (max && !building.button.hasClass('disabled') && building.maxMsg) {
					Notifications.notify(City, building.maxMsg);
				}
			}
			Button.setDisabled(building.button, max);
		}
	},

	build: function (buildBtn) {
		return City.buildIn(City.activeCity, $(buildBtn).attr('buildThing'));
	},

	// builds one of a thing in a city, paid from its stores; quiet (its governor): no notifications
	// and no state events, the caller fires one
	buildIn: function (cityId, thing, quiet) {
		var building = City.Buildings[thing];
		var count = City.path(cityId, 'buildings["' + thing + '"]');
		if ($SM.get(count, true) >= City.maximum(thing, cityId)) return false;

		var storeMod = {};
		var cost = building.cost(cityId);
		for (var k in cost) {
			var have = $SM.get(City.storePath(cityId, k), true);
			if (have < cost[k]) {
				if (!quiet) Notifications.notify(City, _("not enough " + k));
				return false;
			}
			storeMod[k] = have - cost[k];
		}
		$SM.setM(City.storesPath(cityId), storeMod, quiet);
		if (building.buildMsg && !quiet) Notifications.notify(City, building.buildMsg);
		$SM.add(count, 1, quiet);
		if (!quiet) AudioEngine.playSound(AudioLibrary.BUILD);
		return true;
	},

	/*
	 * A focused city runs itself once a fire tick (script/governor.js): it sets its workers,
	 * builds what its focus wants when it can, and tells the player once when it needs them.
	 */
	govern: function (cityId) {
		var c = $SM.get('game.cities["' + cityId + '"]');
		if (!c || !c.focus) return;
		City.checkWorkers(cityId);
		var view = { focus: c.focus, citizens: c.population.citizens || 0, jobs: {}, stores: {}, fuels: {}, builds: [] };
		for (var j in c.workers) {
			if (!City._INCOME[j]) continue;
			var income = City.income(j);
			var share = City.jobShare(cityId, j), per = {};
			for (var s in income.stores) per[s] = income.stores[s] * share * 10 / income.delay;
			view.jobs[j] = { slots: City.jobSlots(cityId, j), stores: per };
		}
		var tiers = Network.tiers();
		for (var f in Fire.FUELS) {
			if (tiers[Fire.FUELS[f].tier]) view.fuels[f] = Fire.FUELS[f].fire * Fire.FUELS[f].burn;
		}
		for (var k in view.fuels) view.stores[k] = $SM.get(City.storePath(cityId, k), true);
		for (var b in City.Buildings) {
			if ($SM.get(City.path(cityId, 'buildings["' + b + '"]'), true) >= City.maximum(b, cityId)) continue;
			var cost = City.Buildings[b].cost(cityId);
			for (var ck in cost) view.stores[ck] = $SM.get(City.storePath(cityId, ck), true);
			view.builds.push({ key: b, cost: cost, have: $SM.get(City.path(cityId, 'buildings["' + b + '"]'), true) });
		}
		['meat', 'fur', 'oak', 'bait'].forEach(function (k) { view.stores[k] = $SM.get(City.storePath(cityId, k), true); });
		view.need = Network.hearthNeed(cityId);
		view.cold = !(c.hearth && c.hearth.out > 0);
		view.spent = City.districtHexes(cityId, 'bog cuts').length > 0 && City.jobSlots(cityId, 'peat cutter') === 0 && Network.has('F6');
		var plan = Governor.plan(view);
		for (var w in plan.workers) {
			if ($SM.get(City.path(cityId, 'workers["' + w + '"]')) !== plan.workers[w]) {
				$SM.set(City.path(cityId, 'workers["' + w + '"]'), plan.workers[w], true);
			}
		}
		if (plan.build) City.buildIn(cityId, plan.build, true);
		// a notice once when it starts; again only after it has cleared
		var said = c.notices || {}, now = {};
		plan.notices.forEach(function (n) {
			now[n] = true;
			if (said[n]) return;
			var fuel = (c.hearth && c.hearth.fuel) || 'wood';
			Notifications.notify(null, _(City.NOTICES[n], City.callName(cityId), _(fuel)));
		});
		$SM.set(City.path(cityId, 'notices'), now, true);
	},

	setFocus: function (cityId, focus) {
		$SM.set(City.path(cityId, 'focus'), focus || null);
		$SM.set(City.path(cityId, 'notices'), {});
		if (focus) {
			City.govern(cityId);
			$SM.fireUpdate('game.cities["' + cityId + '"]', true);
		}
	},

	// Opens the worker rows of every building a city has built, and of the raw jobs its land holds.
	checkWorkers: function (cityId) {
		var open = function (j) {
			var job = City.path(cityId, 'workers["' + j + '"]');
			if (typeof $SM.get(job) != 'number' && City.jobSlots(cityId, j) > 0) $SM.set(job, 0, true);
		};
		for (var k in City.Buildings) {
			if ($SM.get(City.path(cityId, 'buildings["' + k + '"]'), true) === 0) continue;
			(City.Buildings[k].jobs || []).forEach(open);
		}
		for (var j in City._INCOME) {
			if (City._INCOME[j].raw) open(j);
		}
	},

	updateTown: function () {
		var town = $('div#town');
		if (town.length === 0) {
			town = $('<div>').attr({ 'id': 'town', 'data-legend': _('town') }).insertAfter('#cityBuildBtns');
			$('<div>').attr('id', 'citizens').appendTo(town);
		}
		for (var k in City.Buildings) {
			var num = $SM.get(City.path(null, 'buildings["' + k + '"]'), true);
			var id = 'city_building_row_' + k.replace(/ /g, '-');
			var row = $('div#' + id, town);
			if (num > 0 && row.length === 0) {
				row = $('<div>').attr('id', id).addClass('storeRow');
				$('<div>').addClass('row_key').text(City.Buildings[k].name).appendTo(row);
				$('<div>').addClass('row_val').appendTo(row);
				$('<div>').addClass('clear').appendTo(row);
				if ($('#cityStores').length) row.insertBefore('#cityStores');
				else row.appendTo(town);
			}
			$('.row_val', row).text(num);
		}
		$('#citizens').text(_('citizens ') + $SM.get(City.path(null, 'population.citizens'), true) + '/' + City.getMaxCitizens());
		City.updateStoresView();

		if (City.getMaxCitizens() > 0 && typeof City._popTimeout == 'undefined') {
			City.scheduleCitizenIncrease();
		}
		City.setTitle();
	},

	getNumIdle: function (cityId) {
		var num = $SM.get(City.path(cityId, 'population.citizens'), true);
		var workers = $SM.get(City.path(cityId, 'workers'));
		for (var k in workers) {
			num -= workers[k];
		}
		return num;
	},

	makeWorkerRow: function (key, num) {
		var row = $('<div>')
			.attr('key', key)
			.attr('id', 'city_workers_row_' + key.replace(/ /g, '-'))
			.addClass('workerRow');
		var income = City._INCOME[key] ? City.income(key) : null;
		$('<div>').addClass('row_key').text(income ? income.name : _(key)).appendTo(row);
		var val = $('<div>').addClass('row_val').appendTo(row);
		$('<span>').text(num).appendTo(val);
		if (income) {
			$('<div>').addClass('upBtn').appendTo(val).click([1], City.increaseWorker);
			$('<div>').addClass('dnBtn').appendTo(val).click([1], City.decreaseWorker);
			$('<div>').addClass('upManyBtn').appendTo(val).click([10], City.increaseWorker);
			$('<div>').addClass('dnManyBtn').appendTo(val).click([10], City.decreaseWorker);
			var tooltip = $('<div>').addClass('tooltip bottom right').appendTo(row);
			for (var s in income.stores) {
				var r = $('<div>').addClass('storeRow');
				$('<div>').addClass('row_key').text(_(s)).appendTo(r);
				$('<div>').addClass('row_val').text(Engine.getIncomeMsg(income.stores[s], income.delay)).appendTo(r);
				r.appendTo(tooltip);
			}
		}
		$('<div>').addClass('clear').appendTo(row);
		return row;
	},

	updateWorkersView: function () {
		City.checkWorkers();
		if ($SM.get(City.path(null, 'population.citizens'), true) === 0 && $('div#cityWorkers').length === 0) return;

		var workers = $('div#cityWorkers');
		if (workers.length === 0) {
			workers = $('<div>').attr('id', 'cityWorkers');
			if ($('#cityLand').length) workers.insertBefore('#cityLand');
			else workers.appendTo(City.panel);
			// idle citizens wait for work, like the village's gatherers
			City.makeWorkerRow('idle', 0).appendTo(workers);
		}
		var assigned = $SM.get(City.path(null, 'workers'));
		for (var k in assigned) {
			var row = $('div#city_workers_row_' + k.replace(/ /g, '-'), workers);
			if (row.length === 0) {
				row = City.makeWorkerRow(k, assigned[k]).appendTo(workers);
			}
			$('.row_val > span', row).text(assigned[k]);
			$('.dnBtn, .dnManyBtn', row).toggleClass('disabled', assigned[k] === 0);
		}
		var idle = City.getNumIdle();
		$('#city_workers_row_idle .row_val > span').text(idle);
		$('.upBtn, .upManyBtn', workers).toggleClass('disabled', idle <= 0);
	},

	increaseWorker: function (btn) {
		var key = $(this).closest('.workerRow').attr('key');
		var worker = City.path(null, 'workers["' + key + '"]');
		// a raw job has only as many places as the land gives it
		var room = Math.min(City.getNumIdle(), City.jobSlots(null, key) - $SM.get(worker, true));
		if (room > 0) {
			$SM.add(worker, Math.min(room, btn.data));
		}
	},

	decreaseWorker: function (btn) {
		var worker = City.path(null, 'workers["' + $(this).closest('.workerRow').attr('key') + '"]');
		var have = $SM.get(worker, true);
		if (have > 0) {
			$SM.add(worker, -Math.min(have, btn.data));
		}
	},

	// Keeps every city's '<cityId>:<job>' income source in step with its workers.
	updateIncome: function () {
		for (var cityId in $SM.get('game.cities')) {
			for (var job in City._INCOME) {
				var num = $SM.get(City.path(cityId, 'workers["' + job + '"]'));
				if (typeof num != 'number') continue;
				var income = City.income(job);
				var source = cityId + ':' + job;
				var stores = {};
				var cur = $SM.getIncome(source);
				var curIncome = cur.stores || {};
				// the fire sets the pace
				var delay = Math.max(1, Math.round(income.delay / Math.max(0.1, City.jobShare(cityId, job))));
				var needsUpdate = cur.delay !== delay;
				for (var store in income.stores) {
					stores[store] = income.stores[store] * num;
					if (curIncome[store] != stores[store]) needsUpdate = true;
				}
				if (needsUpdate) {
					var options = { name: income.name, delay: delay, stores: stores };
					// the capital pays into the original stockpile
					if (cityId != City.CAPITAL) options.city = cityId;
					$SM.setIncome(source, options);
				}
			}
		}
		Room.updateIncomeView();
	},

	setTitle: function () {
		var title = _("A Growing Town");
		if (Engine.activeModule == this) {
			document.title = title;
		}
		$('#location_city').text(title);
	},

	/*
	 * More than one city: the town panel shows one at a time. The capital keeps the village's
	 * own stockpile (the stores on the right); any other city lists its own stores in the panel.
	 */
	updateSwitcher: function () {
		var cities = $SM.get('game.cities') || {}, ids = Object.keys(cities), box = $('#citySwitch');
		if (ids.length < 2) {
			box.hide();
			$('#cityFocus').hide();
			return;
		}
		box.show();
		if (box.children('.button').length !== ids.length) {
			box.find('.button').remove();
			ids.forEach(function (id) {
				new Button.Button({
					id: 'city_switch_' + id, text: cities[id].name, width: '80px',
					click: function () { City.switchTo(id); }
				}).appendTo(box);
			});
		}
		ids.forEach(function (id) { Button.setDisabled($('#city_switch_' + id), id === City.activeCity); });
		City.updateFocusView();
	},

	switchTo: function (cityId) {
		if (!$SM.get('game.cities["' + cityId + '"]') || cityId === City.activeCity) return;
		City.activeCity = cityId;
		// the panel's rows and buttons belong to the city they were made for
		$('#town').remove();
		$('#cityWorkers').remove();
		$('#cityBuildBtns').empty();
		for (var k in City.Buildings) delete City.Buildings[k].button;
		City.updateSwitcher();
		City.updateTown();
		City.updateWorkersView();
		City.updateBuildButtons();
		if (Engine.activeModule == City) {
			$('#storesContainer').css('visibility', cityId == City.CAPITAL ? '' : 'hidden');
			Engine.moveStoresView($('#town'));
		}
		if (typeof Network != 'undefined') Network.focusCity(cityId);
	},

	updateFocusView: function () {
		var box = $('#cityFocus').show(), focus = $SM.get(City.path(null, 'focus')) || null;
		if (!box.children('.button').length) {
			[null].concat(City.FOCUSES).forEach(function (f) {
				new Button.Button({
					id: 'city_focus_' + (f || 'none'), text: f ? _(f) : _('hands-on'), width: '80px',
					click: function () { City.setFocus(City.activeCity, f); }
				}).appendTo(box);
			});
		}
		[null].concat(City.FOCUSES).forEach(function (f) {
			Button.setDisabled($('#city_focus_' + (f || 'none')), f === focus);
		});
	},

	updateStoresView: function () {
		var box = $('#cityStores');
		if (City.activeCity == City.CAPITAL) {
			box.remove();
			return;
		}
		if (!box.length) box = $('<div>').attr('id', 'cityStores').appendTo('#town');
		box.empty();
		var stores = $SM.get(City.storesPath()) || {};
		for (var k in stores) {
			var n = Math.floor(stores[k]);
			if (!n) continue;
			var row = $('<div>').attr('id', 'city_store_' + k.replace(/ /g, '-')).addClass('storeRow');
			$('<div>').addClass('row_key').text(_(k)).appendTo(row);
			$('<div>').addClass('row_val').text(n).appendTo(row);
			$('<div>').addClass('clear').appendTo(row);
			row.appendTo(box);
		}
	},

	onArrival: function (transition_diff) {
		City.setTitle();
		City.updateTown();
		City.updateBuildButtons();
		Engine.moveStoresView($('#town'), transition_diff);
		AudioEngine.playBackgroundMusic(AudioLibrary.MUSIC_RAUCOUS_VILLAGE);
	},

	handleStateUpdates: function (e) {
		if (e.category == 'stores') {
			City.updateBuildButtons();
		} else if (e.category == 'income' && City.activeCity != City.CAPITAL) {
			// a founded city's own stockpile filled
			City.updateStoresView();
			City.updateBuildButtons();
		} else if (e.stateName.indexOf('game.cities') === 0 || e.stateName.indexOf('game.network.tiers') === 0) {
			City.updateSwitcher();
			City.updateTown();
			City.updateWorkersView();
			City.updateIncome();
			City.updateBuildButtons();
		}
	}
};
