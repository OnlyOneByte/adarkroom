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
 *   fits(g)  g = { terrain: key, at, terrainAt(x, y), site: bool, city: { 'x,y': type }, capital: bool };
 *            true if the type can go on that hex
 *   holds    City.Buildings keys this type holds (CITY.md)
 *   jobs     { job: slots(g) } raw jobs a hex of this type opens, from its ground
 *   bonus    [{ next: type, job: key|'*', add: share }] +share output to the job when touching that type
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
			'oak cutter': function (g) { return g.deep ? 2 : 0; }
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
	T['bog cuts'] = { name: _('bog cuts'), glyph: 'c', fits: on('swamp'), holds: [], jobs: {}, stub: true };
	T['mines'] = { name: _('mines'), glyph: 'm', fits: on('hills', 'mountains'), holds: [], jobs: {}, stub: true };
	T['forge'] = { name: _('forge'), glyph: 'g', fits: on('hills', 'barrens'), holds: [], jobs: {}, stub: true };
	T['trading post'] = { name: _('trading post'), glyph: 'p', fits: any, holds: [], jobs: {}, stub: true };
	T['harbour'] = {
		name: _('harbour'), glyph: 'r', holds: [], jobs: {}, stub: true,
		fits: function (g) {
			return any(g) && District.neighbours(g.at).some(function (p) {
				var t = g.terrainAt(p[0], p[1]);
				return t === 'lake' || t === 'ocean';
			});
		}
	};
	T['tar pits'] = {
		name: _('tar pits'), glyph: 'k', holds: [], jobs: {}, stub: true,
		fits: function (g) {
			return g.terrain === 'desert' || (any(g) && District.neighbours(g.at).some(function (p) {
				return g.terrainAt(p[0], p[1]) === 'wastes';
			}));
		}
	};
	// shortcut: every new district is on the city's edge when placed, so walls fit any land for now
	T['walls'] = { name: _('walls'), glyph: '#', fits: any, holds: ['wall'], jobs: {} };
	T['workshop'] = { name: _('workshop'), glyph: 'o', fits: any, holds: [], jobs: {}, stub: true };
	T['old-world works'] = { name: _('old-world works'), glyph: 'x', fits: function (g) { return g.site; }, holds: [], jobs: {}, stub: true };
})();
