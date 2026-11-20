/**
 * Module that registers the town: the second tier of the settlement.
 * Unlocks once the village is full (20 huts) and has a trading post.
 *
 * Cities are separate places, each a record in game.cities[<cityId>]:
 *   name        display name
 *   focus       null or one of City.FOCUSES (stored only, no behaviour yet)
 *   happiness   0-100 (stored only, no behaviour yet)
 *   population  { <tier>: count }; town tiers only, e.g. citizens
 *   buildings   { <City.Buildings key>: count }
 *   workers     { <City._INCOME key>: count }
 *   stores      { <store>: amount }, the city's local stockpile
 * Pooled empire-wide resources live in game.empire.treasury.
 *
 * The original village becomes the 'capital'. Its villagers, huts and
 * stockpile stay where Room and Outside keep them (game.population,
 * game.buildings, stores), so the capital record has no stores of its own
 * and City.storePath() points it at the original stockpile.
 */
var City = {
	name: _("Town"),

	CAPITAL: 'capital',
	FOCUSES: ['farming', 'industry', 'trade', 'military'],

	_STORES_OFFSET: 0,
	_POP_DELAY: [0.5, 3],
	_UNLOCK_HUTS: 20,

	// the city the town panel shows; shortcut: always the capital until more cities can be founded
	activeCity: 'capital',

	/*
	 * Town buildings. Fields:
	 *   name          display name, through _()
	 *   maximum       how many can be built per city
	 *   cost(cityId)  returns { store: amount }, paid from that city's stores
	 *   room          (optional) citizens housed per building
	 *   jobs          (optional) keys of City._INCOME this building opens
	 *   availableMsg, buildMsg, maxMsg  (optional) notifications
	 * A button shows once half its wood is in and every other cost store has been seen.
	 */
	Buildings: {
		// placeholder -- pending design
		'house': {
			name: _('house'),
			maximum: 10,
			room: 4,
			jobs: ['labourer'],
			cost: function (cityId) {
				var n = $SM.get(City.path(cityId, 'buildings["house"]'), true);
				return {
					'wood': 300 + (n * 50)
				};
			}
		}
	},

	/*
	 * Town jobs. Each city pays its own income source '<cityId>:<job>'
	 * through $SM.setIncome: every `delay` seconds each worker adds `stores`
	 * (negative = consumed) to that city's stores.
	 * Unassigned citizens show as 'idle' and produce nothing.
	 */
	_INCOME: {
		// placeholder -- pending design
		'labourer': {
			name: _('labourer'),
			delay: 10,
			stores: {
				'wood': 1
			}
		}
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

		$('<div>').attr({ 'id': 'cityBuildBtns', 'data-legend': _('build:') }).appendTo(this.panel);

		//subscribe to stateUpdates
		$.Dispatch('stateUpdate').subscribe(City.handleStateUpdates);

		City.updateTown();
		City.updateWorkersView();
		City.updateIncome();
		City.updateBuildButtons();
	},

	createCity: function (cityId, name) {
		var record = {
			name: name,
			focus: null,
			happiness: 50,
			population: { citizens: 0 },
			buildings: {},
			workers: {}
		};
		if (cityId != City.CAPITAL) record.stores = {};
		$SM.set('game.cities["' + cityId + '"]', record, true);
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
			var max = $SM.get(City.path(null, 'buildings["' + k + '"]'), true) >= building.maximum;
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
		var thing = $(buildBtn).attr('buildThing');
		var building = City.Buildings[thing];
		var count = City.path(null, 'buildings["' + thing + '"]');
		if ($SM.get(count, true) >= building.maximum) return false;

		var storeMod = {};
		var cost = building.cost(City.activeCity);
		for (var k in cost) {
			var have = $SM.get(City.storePath(null, k), true);
			if (have < cost[k]) {
				Notifications.notify(City, _("not enough " + k));
				return false;
			}
			storeMod[k] = have - cost[k];
		}
		$SM.setM(City.storesPath(), storeMod);
		if (building.buildMsg) Notifications.notify(City, building.buildMsg);
		$SM.add(count, 1);
		AudioEngine.playSound(AudioLibrary.BUILD);
		return true;
	},

	// Opens the worker rows of every building a city has built.
	checkWorkers: function (cityId) {
		for (var k in City.Buildings) {
			var jobs = City.Buildings[k].jobs || [];
			if ($SM.get(City.path(cityId, 'buildings["' + k + '"]'), true) === 0) continue;
			for (var i = 0; i < jobs.length; i++) {
				var job = City.path(cityId, 'workers["' + jobs[i] + '"]');
				if (typeof $SM.get(job) != 'number') $SM.set(job, 0, true);
			}
		}
	},

	updateTown: function () {
		var town = $('div#town');
		if (town.length === 0) {
			town = $('<div>').attr({ 'id': 'town', 'data-legend': _('town') }).appendTo(City.panel);
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
				row.appendTo(town);
			}
			$('.row_val', row).text(num);
		}
		$('#citizens').text(_('citizens ') + $SM.get(City.path(null, 'population.citizens'), true) + '/' + City.getMaxCitizens());

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
		var income = City._INCOME[key];
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
			workers = $('<div>').attr('id', 'cityWorkers').appendTo(City.panel);
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
		var worker = City.path(null, 'workers["' + $(this).closest('.workerRow').attr('key') + '"]');
		var idle = City.getNumIdle();
		if (idle > 0) {
			$SM.add(worker, Math.min(idle, btn.data));
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
				var income = City._INCOME[job];
				var source = cityId + ':' + job;
				var stores = {};
				var needsUpdate = false;
				var curIncome = $SM.getIncome(source).stores || {};
				for (var store in income.stores) {
					stores[store] = income.stores[store] * num;
					if (curIncome[store] != stores[store]) needsUpdate = true;
				}
				if (needsUpdate) {
					var options = { name: income.name, delay: income.delay, stores: stores };
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
		} else if (e.stateName.indexOf('game.cities') === 0) {
			City.updateTown();
			City.updateWorkersView();
			City.updateIncome();
			City.updateBuildButtons();
		}
	}
};
