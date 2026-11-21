/**
 * Typed districts (DESIGN.md "Districts", design/CITY.md section 1).
 *
 * A city grows across hexes: every district hex gets a type when it is placed, each type
 * fits only some ground and holds only its own buildings and jobs. The hearth quarter is the
 * centre; fire inside the city falls by Fire.RING_FALLOFF per ring from it, so compact cities
 * burn strong. A few simple adjacency bonuses reward a sensible shape.
 *
 * Pure data and functions (no DOM, no state), like script/fire.js.
 *
 * Type fields:
 *   name     display name
 *   glyph    what the district shows on the hex map
 *   fits(g)  g = { terrain: key, at, terrainAt(x, y), site: bool, city: { 'x,y': type }, capital: bool,
 *            coal: bool (a coal seam under it), spent: 0-1 (how worn a bog cut dug deep is),
 *            well: bool (the black well) };
 *            true if the type can go on that hex
 *   holds    City.Buildings keys this type holds (CITY.md)
 *   jobs     { job: slots(g) } raw jobs a hex of this type opens, from its ground
 *   bonus    [{ next: type, job: key|'*', add: share }] +share output to the job when touching that type
 *   needs    (optional) the fire tier it waits for before it can be placed
 *   stub     true: data only, placed from a later phase
 */
var District = {
	HEARTH: 'hearth quarter',
	MAX_RING: 3,        // districts go up to 3 rings out; past it the fire has nothing left (-25% a ring)
	HEARTH_TOUCH: 0.1,  // provisional: +fire to every district touching the hearth quarter
	DARK_FLOOR: 0.5,    // provisional: a city whose hearth is out still works at half

	TYPES: {},

	land: function (g) {
		return g.terrain !== 'ocean' && g.terrain !== 'lake' && g.terrain !== 'mountains';
	},

	// forest with open ground beside it
	forestEdge: function (g) {
		if (g.terrain !== 'forest') return false;
		return District.neighbours(g.at).some(function (p) {
			var t = g.terrainAt(p[0], p[1]);
			return t && t !== 'forest';
		});
	},

	neighbours: function (at) {
		var out = [];
		for (var d = 0; d < 6; d++) out.push(WorldGen.neighbour(at[0], at[1], d));
		return out;
	},

	touches: function (at, city, type) {
		return District.neighbours(at).some(function (p) { return city[p[0] + ',' + p[1]] === type; });
	},

	/*
	 * How strongly a city's fire reaches one of its districts, as a share of the hearth's own:
	 * -25% a ring from the hearth quarter, + the hearth quarter's touch.
	 */
	fireShare: function (at, hearthAt, city) {
		var ring = Fire.distance(at, hearthAt);
		var share = Math.max(0, 1 - Fire.RING_FALLOFF * ring);
		if (ring > 0 && District.touches(at, city, District.HEARTH)) share += District.HEARTH_TOUCH;
		return share;
	},

	// the output share of one job on one district hex: its fire share plus any adjacency bonus
	jobShare: function (type, job, at, hearthAt, city) {
		var s = District.fireShare(at, hearthAt, city);
		(District.TYPES[type].bonus || []).forEach(function (b) {
			if ((b.job === '*' || b.job === job) && District.touches(at, city, b.next)) s += b.add;
		});
		return s;
	}
};

(function () {
	var on = function () {
		var kinds = Array.prototype.slice.call(arguments);
		return function (g) { return kinds.indexOf(g.terrain) >= 0; };
	};
	var any = District.land;
	var T = District.TYPES;
	// provisional slot counts: raw jobs per held hex
	T['hearth quarter'] = {
		name: _('hearth quarter'), glyph: 'A', fits: any, holds: ['woodshed'],
		// a founded city's first wood, picked up around its fire (the capital has the village's gatherers)
		jobs: { 'gatherer': function (g) { return g.capital ? 0 : 8; } }
	};
	T['huts'] = {
		name: _('huts'), glyph: 'n', holds: ['house'], jobs: {},
		fits: function (g) { return g.terrain === 'field' || g.terrain === 'barrens' || District.forestEdge(g); }
	};
	T['woods'] = {
		name: _('woods'), glyph: 'w', fits: on('forest', 'jungle'), holds: [],
		jobs: {
			'woodcutter': function () { return 4; },
			// the old forests are where the oak is
			'oak cutter': function (g) { return g.deep ? 2 : 0; },
			// the jungle's trees are bled for resin (F7)
			'resin tapper': function (g) { return g.terrain === 'jungle' ? 2 : 0; }
		},
		bonus: [{ next: 'huts', job: 'woodcutter', add: 0.25 }]
	};
	T['hunting grounds'] = {
		name: _('hunting grounds'), glyph: 'h', fits: on('forest', 'field', 'tundra'), holds: [],
		jobs: {
			'hunter': function () { return 4; },
			'trapper': function (g) { return g.terrain === 'forest' || g.terrain === 'tundra' ? 2 : 0; }
		},
		bonus: [{ next: 'woods', job: 'hunter', add: 0.25 }]
	};
	T['fields'] = { name: _('fields'), glyph: 'f', fits: on('field'), holds: [], jobs: {}, stub: true };
	T['tannery row'] = {
		name: _('tannery row'), glyph: 't', holds: ['tannery', 'smokehouse'], jobs: {},
		fits: function (g) { return any(g) && District.touches(g.at, g.city, 'hunting grounds'); },
		bonus: [{ next: 'hunting grounds', job: '*', add: 0.25 }]
	};
	T['burning pits'] = {
		name: _('burning pits'), glyph: 'b', holds: ['tallow vats', 'charcoal pits'], jobs: {},
		fits: function (g) { return g.terrain === 'barrens' || District.forestEdge(g); },
		bonus: [{ next: 'woods', job: '*', add: 0.25 }]
	};
	T['bog cuts'] = {
		name: _('bog cuts'), glyph: 'c', fits: on('swamp'), holds: [], needs: 'F6',
		// a bog cut deep is spent for a while (Network.wearBogs)
		jobs: { 'peat cutter': function (g) { return g.spent >= 1 ? 0 : 4; } },
		// damp: a bog cut beside the hearth quarter takes fire from it, more than the touch gives
		bonus: [{ next: 'hearth quarter', job: '*', add: -0.2 }]
	};
	T['mines'] = {
		name: _('mines'), glyph: 'm', fits: on('hills', 'mountains'), holds: [], needs: 'F8',
		// shortcut: only coal is mined here for now; iron and sulphur stay the village's mines until a tier needs them
		jobs: { 'coal miner': function (g) { return g.coal ? 4 : 0; } }
	};
	// the blaze era: forge and harbour open with coal (F8: the bloomery's and the boats' beats need them; coke
	// ovens F9, whaling F11), tar pits (F10), old-world works (F12)
	T['forge'] = {
		name: _('forge'), glyph: 'g', fits: on('hills', 'barrens'), holds: ['coke ovens'], jobs: {}, needs: 'F8',
		// next to the hearth: more fire (CITY.md: +fire and +steel; shortcut: steel stays the village's steelworks)
		bonus: [{ next: 'hearth quarter', job: '*', add: 0.25 }]
	};
	T['trading post'] = { name: _('trading post'), glyph: 'p', fits: any, holds: [], jobs: {}, stub: true };
	var water = function (g) {
		return District.neighbours(g.at).filter(function (p) {
			var t = g.terrainAt(p[0], p[1]);
			return t === 'lake' || t === 'ocean';
		}).length;
	};
	T['harbour'] = {
		name: _('harbour'), glyph: 'r', holds: ['try-works'], needs: 'F8',
		// provisional: a whaler's boat to every two sides on the water, at least one
		jobs: { 'whaler': function (g) { var n = water(g); return n ? Math.max(1, Math.floor(n / 2)) : 0; } },
		fits: function (g) { return any(g) && water(g) > 0; }
	};
	T['tar pits'] = {
		name: _('tar pits'), glyph: 'k', holds: ['pitch boilers'], needs: 'F10',
		jobs: { 'tar gatherer': function () { return 4; } },
		fits: function (g) {
			return g.terrain === 'desert' || (any(g) && District.neighbours(g.at).some(function (p) {
				return g.terrainAt(p[0], p[1]) === 'wastes';
			}));
		},
		// fumes: tar pits beside huts work slower
		bonus: [{ next: 'huts', job: '*', add: -0.2 }]
	};
	// shortcut: every new district is on the city's edge when placed, so walls fit any land for now
	T['walls'] = { name: _('walls'), glyph: '#', fits: any, holds: ['wall'], jobs: {} };
	T['workshop'] = { name: _('workshop'), glyph: 'o', fits: any, holds: [], jobs: {}, stub: true };
	// shortcut: only the black well for now; the refinery, cell-works and engine hall come with the old fire
	T['old-world works'] = {
		name: _('old-world works'), glyph: 'x', holds: [], needs: 'F12',
		fits: function (g) { return !!g.well; },
		jobs: { 'well-hand': function (g) { return g.well ? 4 : 0; } }
	};
})();
