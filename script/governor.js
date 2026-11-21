/**
 * City focus as governor (DESIGN.md "Cities & economy"): a focused city assigns its own
 * workers, keeps its hearth fuelled and builds its focus's buildings when it can afford them.
 * It sends a terse notice when it needs the player.
 *
 * Pure (no DOM, no state), like script/fire.js: the game (City.govern) and the balance
 * simulator (tools/sim.js) both call Governor.plan on a plain view of one city.
 *
 *   view.focus      one of Governor.FOCUSES
 *   view.citizens   people in the city
 *   view.jobs       { job: { slots, stores: { store: per worker per tick } } } jobs open in the city
 *   view.stores     { store: amount }
 *   view.fuels      { fuel: fire per unit } the unlocked fuels
 *   view.need       fire the hearth wants a tick
 *   view.builds     [{ key, cost: { store: n }, have: n }] buildings it could still build (under their maximum)
 *   view.cold       true if the hearth made no fire last tick
 *   view.spent      true if its bog cuts are all spent (dug deep)
 *   view.room       people its houses hold: with no room left, any focus builds a house first
 * Returns { workers: { job: n }, build: key or null, notices: [code] }.
 */
var Governor = {
	FOCUSES: ['fire', 'farming', 'industry', 'trade', 'military'],
	MARGIN: 1.25,  // provisional: fuel made a tick, over what the hearth wants
	RESERVE: 3,    // provisional: ticks of hearth fuel kept back when it builds

	// what each focus works and builds, in order; military is a stub until armies (Phase 5)
	JOBS: {
		fire: ['woodcutter', 'gatherer', 'drier', 'oak cutter', 'seasoner', 'hunter', 'renderer',
			'collier', 'peat cutter', 'resin tapper', 'coal miner', 'well-hand', 'coker', 'tar gatherer', 'pitch boiler',
			'whaler', 'tryer'],
		farming: ['hunter', 'charcutier', 'trapper', 'woodcutter', 'gatherer'],
		industry: ['hunter', 'tanner', 'charcutier', 'coal miner', 'coker', 'woodcutter', 'gatherer', 'labourer'],
		trade: ['trapper', 'hunter', 'tanner', 'woodcutter', 'gatherer'],
		military: []
	},
	BUILDS: {
		// [key, n]: only while the city has fewer than n of it. A first house, then the fuel buildings, then houses again
		fire: ['woodshed', ['house', 1], 'charcoal pits', 'tallow vats', 'coke ovens', 'pitch boilers', 'try-works', 'house'],
		farming: ['house', 'smokehouse'],
		industry: ['tannery', 'smokehouse', 'coke ovens', 'house'],
		trade: ['house', 'tannery'],
		military: ['wall']
	},

	// fire a worker of a job adds a tick, net of the fuel it burns as input
	fireOf: function (view, job) {
		var s = view.jobs[job].stores, f = 0;
		for (var k in s) {
			if (view.fuels[k]) f += s[k] * view.fuels[k];
		}
		return f;
	},

	// a chain job only works while its inputs come in: what it takes a tick, set against what is made
	inputsMet: function (view, job, made) {
		var s = view.jobs[job].stores;
		for (var k in s) {
			if (s[k] < 0 && (made[k] || 0) + s[k] < 0 && !(view.stores[k] > -s[k] * 10)) return false;
		}
		return true;
	},

	plan: function (view) {
		var workers = {}, made = {}, free = view.citizens, notices = [];
		for (var j in view.jobs) workers[j] = 0;
		var assign = function (job) {
			if (free <= 0 || !view.jobs[job] || workers[job] >= view.jobs[job].slots) return false;
			if (!Governor.inputsMet(view, job, made)) return false;
			workers[job]++;
			free--;
			var s = view.jobs[job].stores;
			for (var k in s) made[k] = (made[k] || 0) + s[k];
			return true;
		};
		var fire = function () {
			var f = 0;
			for (var k in made) if (view.fuels[k]) f += made[k] * view.fuels[k];
			return f;
		};
		// the hearth first: raw fuel until it makes what the hearth wants, with a margin
		var raw = Object.keys(view.jobs).filter(function (j) { return Governor.fireOf(view, j) > 0; })
			.sort(function (a, b) { return Governor.fireOf(view, b) - Governor.fireOf(view, a); });
		var want = view.need * Governor.MARGIN;
		for (var r = 0; r < raw.length && fire() < want; r++) {
			while (fire() < want && assign(raw[r])) { /* fill this job */ }
		}
		var fuelShort = fire() < view.need;
		// then the focus, a round at a time so every job it works gets hands
		var list = (Governor.JOBS[view.focus] || []).filter(function (j) { return view.jobs[j]; });
		var moved = true;
		while (free > 0 && moved) {
			moved = false;
			for (var i = 0; i < list.length; i++) {
				if (assign(list[i])) moved = true;
			}
		}
		// the stock it burns from; nothing is built out of the hearth's reserve
		var stock = 0;
		for (var f in view.fuels) stock += (view.stores[f] || 0) * view.fuels[f];
		var build = null, reserve = view.need * Governor.RESERVE;
		// a governor never starves its own growth: no room left and a house can still go up, it saves
		// for the house and builds nothing else
		var order = Governor.BUILDS[view.focus] || [];
		if (typeof view.room == 'number' && view.citizens >= view.room && view.builds.some(function (x) { return x.key === 'house'; })) order = ['house'];
		order.some(function (item) {
			var key = typeof item == 'string' ? item : item[0];
			var b = view.builds.filter(function (x) { return x.key === key; })[0];
			if (!b || (typeof item != 'string' && (b.have || 0) >= item[1])) return false;
			var fireCost = 0;
			for (var k in b.cost) {
				if ((view.stores[k] || 0) < b.cost[k]) return false;
				if (view.fuels[k]) fireCost += b.cost[k] * view.fuels[k];
			}
			if (stock - fireCost < reserve) return false;
			build = key;
			return true;
		});
		if (view.cold) notices.push('cold');
		else if (fuelShort && stock < view.need) notices.push('fuel');
		if (view.spent) notices.push('spent');
		if (free > 0 && view.focus !== 'military') notices.push('idle');
		return { workers: workers, build: build, notices: notices };
	}
};
