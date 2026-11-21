/**
 * City-states and influence (Phase 4: design/drafts/PHASE4.md, the content pack
 * design/content/phase4-citystates.md, and the fixes in design/text/phase4-fixes.md).
 *
 * Other people's towns on the hex map, each with a temperament. Influence over each one is its own,
 * 0-100: it grows while the fire's glow reaches them, gifts carried by an envoy speed it, a resident
 * envoy keeps it moving outside the glow (up to 25), and the placeholder spheres around the old-world
 * complexes (Π) pull wavering ones back. At 100, or once their price is paid, they join as a city.
 *
 * The rules and data at the top are pure (no DOM, no state), so the simulator (tools/sim.js) loads
 * this file too. Every number is provisional, tuned with `npm run sim`. The rows the user has not
 * decided yet (phase4-fixes.md, kind G) are each one constant or one small function, marked
 * "pending user (G<n>)".
 *
 * Saved state, game.citystates:
 *   seed, gen  the world seed and generator version they were placed for
 *   list     [{ id, t, name, at, land: [[x, y]], site, band }] placed once when the hex map opens
 *   cs       { <id>: { inf, floor, told: { 25: true, ... }, met, envoy, gift: { tick, mult }, city,
 *              pulled, faded, lit } } what each one thinks of us
 *   sighted  { <temperament>: true } first sightings already told
 *   envoy    { to, from, pack, out, fell, picked } the envoy on the road, waiting at home or fallen
 *   beats    { <tier id>: <cs id> } ladder beats a city-state gave, for the era that wires the tier
 *   ticks    city-state ticks run (10 s each): the clock gifts, riders and quests count by
 *   riders   { <Π index>: tick } when riders last went out from each sphere
 */
var CityStates = {
	GLYPH: 'Ω',

	/*
	 * The rules (PHASE4.md §2), provisional
	 */
	// influence per minute per point of glow, × T / S. Tuned with the simulator so the nearest herders on an
	// ember-era line take about the approved feel check's ~17 minutes (at 1.0 they took ~4: an ember line
	// touching them glows ~16, not the feel check's 4 × 2)
	RATE: 0.25,
	GLOW_REACH: 3,         // the glow is read from lit hexes this far from a city-state
	TOUCH: 2,              // a beacon next to them: the glow counts double (fixes C3: gap 0 unhalved, then ×2)
	DECAY: 0.5,            // per minute out of the glow, floored at the last threshold passed
	THRESHOLDS: [25, 50, 75, 100],
	ENVOY_RATE: 0.5,       // per minute while an envoy lives there, glow or not
	ENVOY_CAP: 25,         // what an envoy alone can bring them to
	GIFT_CAP: 75,          // gifts can't push past this (approved Q2 a)
	GIFT_WINDOW: 30,       // ticks (5 minutes): a gift this soon after the last is worth half the one before
	SIDE_ASK: 25,          // pending user (G6, G7): a side ask (fishers' supply, the holdfast's watch fire) is worth this
	// pending user (G8): a price or quest city-state reaches 25 by the glow, but influence alone never wins it
	NO_WIN_CAP: 99,
	RIVAL_REACH: function (band) { return 6 + 2 * band; },
	RIVAL_PULL: function (band) { return 0.25 * (band + 1); },  // per minute, only on wavering ones (50-99)
	RIDER_EVERY: 90,       // ticks (~15 minutes) between rider visits from each sphere
	RIDER_HIT: 10,
	REAVER_REACH: 3,       // reavers this close can take an envoy
	REAVER_EVERY: 60,      // ticks (10 minutes)
	REAVER_CHANCE: 1 / 20,
	LIGHT_HOLD: 60,        // ticks (10 minutes) the ash-faithful's hill must stay lit
	// provisional: no city-state where the capital's own hearth already glows on it (its 3 lit rings and
	// the 3-hex glow reach): the peaceful route is a beacon line (DESIGN "Influence comes from the light")
	MIN_CAPITAL: 7,
	SPACING: 3,            // provisional: no two city-states this close
	FALLEN: 16,            // fallen cities already resettled by city-states (PHASE4 §0)
	REACH: { danger: 2.5, hexes: 15 },  // the ember-era network's reach, for the generator's guarantees
	// pending user (G5): what an envoy costs: a citizen and this, from any city; the water goes from the trek
	ENVOY_COST: { 'cured meat': 10 },
	ENVOY_WATER: 10,
	// pending user (Q3): people a city-state joins with ("many" for herders); not given in PHASE4
	JOIN_PEOPLE: { many: 16, some: 8 },
	// pending user (Q2): a joined city's first stores, what settlers carry to a founded one, so its hearth burns
	joinStores: function () {
		return $.extend({}, City.SETTLERS.stores);
	},

	// pending user (G2): S = 1 + the danger band of their hex (0-4); far is harder
	strength: function (danger) {
		return 1 + Danger.band(danger);
	},

	// pending user (G22): counts scale by land hexes (64 at Huge), never under 16, the 8 story ones always in.
	// shortcut: Huge is the only map size, so the scale is 1; when sizes arrive it is land hexes over Huge's
	scale: function () {
		return 1;
	},

	/*
	 * Gift values (PHASE4 §2c), per unit. The table's goods are as given; the rest are set in line
	 * with it (fixes C13) and the simulator checks every wanted good has one.
	 */
	VALUES: {
		'wood': 1, 'grain': 1, 'fur': 2, 'meat': 2, 'cured meat': 4, 'fish': 4,
		'leather': 5, 'cloth': 5, 'iron': 6, 'tallow': 6, 'steel': 10, 'coal': 10,
		'medicine': 20, 'knowledge fragment': 40,
		// in line with the table (C13)
		'dry wood': 1, 'bait': 2, 'bread': 2, 'smoked fish': 4, 'tools': 6, 'salvage': 6,
		'iron sword': 10, 'steel sword': 10, 'rifle': 10
	},
	// "weapons" in the content pack: any of these (content conventions)
	WEAPONS: ['iron sword', 'steel sword', 'rifle'],

	/*
	 * The 16 temperaments: design/content/phase4-citystates.md §1, as data. Fields as there; `want`
	 * on a story one names the group its two names come from.
	 */
	TEMPERAMENTS: {
		bog_cutters: {
			id: 'bog_cutters', name: _('the bog-cutters'), kind: 'story',
			ways_to_win: ['influence', 'force'], influence_T: 1,
			wants: ['cured meat', 'leather', 'dry wood'], scorned: [],
			gives: [{ at: 50, tier: 'F6', scene: 'story.bog_cutters_50' }, { at: 100, tier: 'B8', scene: 'flame-draft:B8' }],
			spawn: { terrain: ['swamp'], feature: 'great swamp', band: [1, 1], count: 1 },
			price_pool: [], quest_pool: [], on_force: 'find_craftsmen', names: 'story.bog_cutters'
		},
		potters: {
			id: 'potters', name: _('the potters'), kind: 'story',
			ways_to_win: ['influence', 'force'], influence_T: 1,
			wants: ['grain', 'bread', 'wood', 'cloth'], scorned: [],
			gives: [{ at: 100, tier: 'H6', scene: 'flame-draft:H6' }],
			spawn: { terrain: ['field'], near: 'river', band: [1, 1], count: 1, guarantee: true },
			price_pool: [], quest_pool: [], on_force: 'find_craftsmen', names: 'story.potters'
		},
		resin_tappers: {
			id: 'resin_tappers', name: _('the resin-tappers'), kind: 'story',
			ways_to_win: ['quest', 'force'], influence_T: 1,
			wants: ['medicine', 'tools'], scorned: [],
			gives: [{ at: 'quest', tier: 'F7', scene: 'story.resin_tappers_found', also: 'jungle jobs open' }],
			spawn: { terrain: ['jungle'], near: 'jungle edge', band: [1, 1], count: 1 },
			price_pool: [], quest_pool: [{ type: 'find', id: 'find_lost_tappers', party: 'lost tappers', size: 4 }],
			on_force: 'find_craftsmen', names: 'story.resin_tappers'
		},
		forge_masters: {
			id: 'forge_masters', name: _('the forge-masters'), kind: 'story',
			ways_to_win: ['price', 'force'], influence_T: 1,
			wants: ['coal', 'iron', 'steel'], scorned: [],
			gives: [
				{ at: 'price', tier: 'F9', scene: 'story.cold_forges' },
				{ at: 'forge district touches their hearth', tier: 'H9', scene: 'story.bloomery' }
			],
			spawn: { terrain: ['hills'], feature: 'hill towns', band: [2, 2], count: 1 },
			// fixes C9: the scene's 300 coal / 100 iron are the final amounts (base 100 / 33 at band 2)
			price_pool: [{ type: 'tribute', id: 'tribute_forge', fixed: { 'coal': 300, 'iron': 100 } }],
			quest_pool: [], on_force: 'find_craftsmen', names: 'story.forge_masters'
		},
		tar_keepers: {
			id: 'tar_keepers', name: _('the tar-keepers'), kind: 'story',
			ways_to_win: ['quest', 'force'], influence_T: 1,
			wants: ['weapons', 'cured meat'], scorned: [],
			gives: [{ at: 'quest', tier: 'F10', scene: 'story.tar_keepers_sworn' }],
			spawn: { terrain: ['desert'], feature: 'desert pits', band: [2, 2], count: 1 },
			price_pool: [], quest_pool: [{ type: 'clear', id: 'clear_pit_raiders', foe: 'raiders at the pits' }],
			on_force: 'find_craftsmen', names: 'story.tar_keepers'
		},
		mirror_folk: {
			id: 'mirror_folk', name: _('the mirror folk'), kind: 'story',
			ways_to_win: ['influence', 'force'], influence_T: 2, influence_rule: 'glow only; gifts worth 0',
			wants: [], scorned: ['*'],
			gives: [
				{ at: 100, tier: 'B9', scene: 'story.mirrors' },
				{ at: 'joined + lighthouse-keepers (F11/B11 city) joined', tier: 'B12', scene: 'later (blaze)' }
			],
			spawn: { terrain: ['desert', 'barrens'], near: 'open ground', band: [2, 3], count: 1 },
			price_pool: [], quest_pool: [], on_force: 'find_craftsmen', names: 'story.mirror_folk'
		},
		drifters: {
			id: 'drifters', name: _('the drifters'), kind: 'story',
			ways_to_win: ['quest', 'force'], influence_T: 1,
			wants: ['fur', 'cured meat'], scorned: [],
			gives: [{ at: 'quest', tier: 'F12', scene: 'story.smoke_on_the_snow', also: "starts chain 'the black well'" }],
			spawn: { terrain: ['tundra'], band: [3, 3], count: 1, moves: '1 hex per 50 trek steps' },
			price_pool: [], quest_pool: [{ type: 'meet', id: 'meet_drifters', walk_steps: 20 }],
			on_force: 'find_craftsmen', names: 'story.drifters'
		},
		archive_clerks: {
			id: 'archive_clerks', name: _('the archive clerks'), kind: 'story',
			ways_to_win: ['quest', 'force'], influence_T: 1,
			wants: ['knowledge fragment', 'salvage'], scorned: [],
			gives: [{ at: 'quest', tier: 'B13', scene: 'story.archive_clerks', also: 'old maps: reveal Π and Ø sites within 20 hexes' }],
			spawn: { terrain: ['any'], near: 'adjacent to a Π', band: [3, 3], count: 1 },
			price_pool: [], quest_pool: [{ type: 'fetch', id: 'fetch_fragment', thing: 'knowledge fragment', from: 'Π', distance: [6, 20] }],
			on_force: 'find_craftsmen', names: 'story.archive_clerks'
		},
		herders: {
			id: 'herders', name: _('herders'), kind: 'common',
			ways_to_win: ['influence', 'force'], influence_T: 1.5,
			wants: ['leather', 'tools', 'cloth'], scorned: [],
			gives: [{ at: 100, people: 'many', jobs: ['hunter'], districts: ['huts', 'hunting grounds'], focus: 'farming' }],
			spawn: { terrain: ['field'], band: [0, 1], count: 12, guarantee: 2 },
			price_pool: [], quest_pool: [], names: 'herders'
		},
		trappers_lodge: {
			id: 'trappers_lodge', name: _("trappers' lodge"), kind: 'common',
			ways_to_win: ['price', 'force'], influence_T: 1,
			wants: ['bait', 'cured meat'], scorned: [],
			gives: [{ at: 'price', jobs: ['trapper'], trickle: ['scales', 'teeth', 'charm'], focus: 'hunting' }],
			spawn: { terrain: ['forest', 'tundra'], band: [0, 2], count: 8 },
			price_pool: [{ type: 'tribute', id: 'tribute_trappers', base: { 'bait': 40, 'cured meat': 40 }, scale: true }],
			quest_pool: [], names: 'trappers_lodge'
		},
		stilt_fishers: {
			id: 'stilt_fishers', name: _('stilt-town fishers'), kind: 'common',
			ways_to_win: ['influence', 'force'], influence_T: 1,
			wants: ['wood', 'cloth'], scorned: [],
			gives: [{ at: 100, districts: ['harbour'], goods: ['fish', 'smoked fish'], focus: 'fishing' }],
			spawn: { terrain: ['lake/coast'], band: [1, 2], count: 8 },
			// pending user (G6): a side ask worth SIDE_ASK, like a quest; it needs a road or a B6 line
			price_pool: [{ type: 'standing_supply', id: 'supply_fishers', base: { 'wood': 20 }, deliveries: 5, every_min: 10, needs: 'B6', scale: true, side: true }],
			quest_pool: [], names: 'stilt_fishers'
		},
		walled_holdfast: {
			id: 'walled_holdfast', name: _('walled holdfast'), kind: 'common',
			ways_to_win: ['price', 'force'], influence_T: 1,
			wants: ['steel', 'weapons', 'iron'], scorned: [],
			gives: [{ at: 'price', districts: ['walls'], soldiers: true, focus: 'military' }],
			spawn: { terrain: ['hills', 'pass'], band: [1, 3], count: 8 },
			// pending user (G7): the price wins them; the watch fire on their pass is a side ask
			price_pool: [
				{ type: 'tribute', id: 'tribute_holdfast', base: { 'steel': 40, 'weapons': 10 }, scale: true, steep: true },
				{ type: 'a_work', id: 'work_holdfast_watchfire', build: 'B4', side: true }
			],
			quest_pool: [], names: 'walled_holdfast'
		},
		reavers: {
			id: 'reavers', name: _('reavers'), kind: 'common',
			ways_to_win: ['force'], influence_T: 0, influence_rule: "none; shown as 'they will not bend.'",
			wants: [], scorned: ['*'],
			gives: [{ at: 'force', people: 'freed captives', goods: ['weapons'], effect: 'trek encounters within 3 hexes get easier' }],
			spawn: { terrain: ['barrens', 'wastes edge'], band: [2, 4], count: 8 },
			threat: { takes_envoys_within_hexes: 3 },
			price_pool: [], quest_pool: [], names: 'reavers'
		},
		ash_faithful: {
			id: 'ash_faithful', name: _('the ash-faithful'), kind: 'common',
			ways_to_win: ['quest-then-influence', 'force'],
			influence_T: { before_quest: 0, after_quest: 2 },
			wants: { before_quest: [], after_quest: ['dry wood', 'tallow'] },
			scorned: { before_quest: ['*'], after_quest: [] },
			gives: [{ at: 100, effect: '+25% hearth output in that city', jobs: ['fire-keeper'], focus: 'hearth' }],
			spawn: { terrain: ['wastes edge'], band: [3, 3], count: 4 },
			price_pool: [],
			quest_pool: [{ type: 'light', id: 'light_holy_hill', hex: 'their holy hill', hold_min: 10, on_complete: 'unlock influence (no join)' }],
			names: 'ash_faithful'
		},
		scavenger_camp: {
			id: 'scavenger_camp', name: _('scavenger camp'), kind: 'common',
			ways_to_win: ['price', 'force'], influence_T: 1,
			wants: ['bread', 'cured meat', 'medicine'], scorned: [],
			gives: [{ at: 'price', jobs: ['scavenger'], trickle: ['knowledge fragment'], focus: 'salvage' }],
			// fixes C20: on wastes next to a crater
			spawn: { terrain: ['wastes'], near: 'crater', band: [3, 4], count: 4 },
			price_pool: [{ type: 'tribute', id: 'tribute_scavengers', base: { 'bread': 40, 'cured meat': 40, 'medicine': 5 }, scale: true }],
			quest_pool: [], names: 'scavenger_camp'
		},
		the_sworn: {
			id: 'the_sworn', name: _('the sworn'), kind: 'common',
			ways_to_win: ['force-while-power-stands', 'influence-after-power-broken'],
			influence_T: { power_stands: 0, power_broken: 2 },
			wants: { power_stands: [], power_broken: ['steel', 'medicine'] },
			scorned: { power_stands: ['*'], power_broken: [] },
			gives: [{ at: 'joined', goods: ['old-world arms'], hint: "their power's puzzle", focus: 'military' }],
			spawn: { terrain: ['any'], near: 'within 6 hexes of a Π', band: [3, 4], count: 4 },
			price_pool: [], quest_pool: [], names: 'the_sworn'
		}
	},

	// The name pool (content pack §2): drawn without replacement inside a group.
	NAMES: {
		'story.bog_cutters': [_('the black cuts'), _('the cutting bank')],
		'story.potters': [_('the clay pits'), _('kilnford')],
		'story.resin_tappers': [_('the weeping trees'), _('sapwood')],
		'story.forge_masters': [_('the hill towns'), _('anvil rise')],
		'story.tar_keepers': [_('the tar pits'), _('the black pools')],
		'story.mirror_folk': [_('the bright roofs'), _('glass flats')],
		'story.drifters': [_('the long walk'), _('the drift')],
		'story.archive_clerks': [_('the record house'), _('the stacks')],
		herders: [_('low cross'), _('harrow'), _('sheepwash'), _('the far fold'), _('ewe hollow'), _('the wool steads'),
			_('the thin pasture'), _('cold meadow'), _('the drove road'), _('three gates'), _('the shearing'),
			_('broadfield'), _('the stone pens'), _('mill ford'), _('the wether'), _('oxbow'), _('the high common'),
			_('lambsend'), _('the dry field'), _('the old drove'), _('hay barrow'), _('the bell fold'),
			_('the long grass'), _('dunmere')],
		trappers_lodge: [_('the snares'), _('hollow pine'), _('the fur house'), _('deadfall'), _('the black spruce'),
			_('marten lodge'), _('wolfskin'), _('the trap line'), _('cold larch'), _('the bone hut'),
			_('the high snare'), _('lynx hollow'), _('the skinning shed'), _('the pine shelter'),
			_('birchend'), _('the frozen pelts')],
		stilt_fishers: [_('the stilts'), _('salt reach'), _('low water'), _('the eel weirs'), _('gull point'),
			_('the drying racks'), _('net end'), _('the mudflats'), _('wade'), _('the pilings'),
			_('grey shallows'), _('the brine steps'), _('reed harbour'), _('the tide posts'),
			_('the crab pots'), _('the long jetty')],
		walled_holdfast: [_('the keep'), _('stonewall'), _('the high gate'), _('iron hold'), _('the narrows'),
			_('black tower'), _('the watch hill'), _('ridgeholt'), _('the old fort'), _('ward hill'),
			_('the pass fort'), _('grim hold'), _('the barred gate'), _('the cutting wall'),
			_('the stockade'), _('cragmoor')],
		reavers: [_('the burnt camp'), _('red hollow'), _('the pyres'), _('gallows hill'), _('the scrap pens'),
			_('the bone yard'), _('the raw ground'), _('cinder ridge'), _('the take'), _('the hooks'),
			_('rust hollow'), _('the hanging tree'), _('the last well'), _('the gnaw'), _('skull rock'),
			_('the black fires')],
		ash_faithful: [_('the grey hill'), _('ash chapel'), _('the vigil'), _('the cold altar'), _('the smoke stair'),
			_('the ember shrine'), _('the waiting hill'), _('the soot choir')],
		scavenger_camp: [_('the pickings'), _('the wreck'), _('scrap end'), _('the crater lip'), _('the salt glass'),
			_('the tin camp'), _('the strip yard'), _('the salvage')],
		the_sworn: [_('the oath post'), _('the drill yard'), _('the barracks'), _('the muster'), _('the standing guard'),
			_('the colours'), _('the roll call'), _('the outer wire')]
	},

	// story city-states' names are place names; the common ones read "the people of {name}" (fixes C19)
	story: function (t) {
		return CityStates.TEMPERAMENTS[t].kind === 'story';
	},

	/*
	 * Placement (PHASE4 §0, §1; content §1 spawn): pure. gen = WorldGen.generate's output, danger(x, y)
	 * the hex's danger at normal difficulty, taken(x, y) true where a city or beacon of ours already is.
	 * Story city-states first (placement guaranteed), then the guarantees, then the fallen cities, then
	 * the rest. Returns the list as saved.
	 */
	place: function (gen, danger, taken) {
		var CS = CityStates, G = WorldGen, T = G.TERRAIN;
		var rand = G.rng(gen.seed ^ 0xC17E57A7), cols = gen.cols, rows = gen.rows, cap = gen.capital;
		var R = G.SQUARE_RADIUS, ox = gen.coreOffset[0], oy = gen.coreOffset[1];
		taken = taken || function () { return false; };
		var idx = function (x, y) { return x + y * cols; };
		var inside = function (x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; };
		var names0 = {};
		for (var k0 in T) names0[T[k0]] = k0;
		var key = function (x, y) { return inside(x, y) ? names0[gen.terrain[x][y]] || null : null; };
		var near = function (x, y, ok) {
			for (var d = 0; d < 6; d++) {
				var n = G.neighbour(x, y, d);
				if (inside(n[0], n[1]) && ok(n[0], n[1])) return true;
			}
			return false;
		};
		// per hex, worked out once: open land the wanderer can reach, and its danger band
		var landA = new Uint8Array(cols * rows), bandA = new Int8Array(cols * rows);
		for (var ly = 0; ly < rows; ly++) {
			for (var lx = 0; lx < cols; lx++) {
				var lc = gen.terrain[lx][ly];
				landA[idx(lx, ly)] = gen.reachable[idx(lx, ly)] && !G.isWater(lc) && G.isPassable(lc) && names0[gen.map[lx][ly].charAt(0)] ? 1 : 0;
				bandA[idx(lx, ly)] = Danger.band(danger(lx, ly));
			}
		}
		var land = function (x, y) { return landA[idx(x, y)] === 1; };
		var complexes = gen.sites.filter(function (s) { return s.kind === 'complex'; });
		var isSite = function (x, y, kind) { var i = gen.siteAt[idx(x, y)]; return i >= 0 && gen.sites[i].kind === kind; };
		var passes = {};
		gen.passes.forEach(function (p) { passes[p[0] + ',' + p[1]] = true; });
		var TERRAIN_OK = {
			'any': function () { return true; },
			'lake/coast': function (x, y) { return near(x, y, function (a, b) { return G.isWater(gen.terrain[a][b]); }); },
			'pass': function (x, y) { return !!passes[x + ',' + y]; },
			'wastes edge': function (x, y) { return key(x, y) !== 'wastes' && near(x, y, function (a, b) { return key(a, b) === 'wastes'; }); }
		};
		var NEAR_OK = {
			'river': TERRAIN_OK['lake/coast'], // there are no rivers: water beside the fields
			'jungle edge': function (x, y) { return near(x, y, function (a, b) { return key(a, b) !== 'jungle'; }); },
			'adjacent to a Π': function (x, y) { return near(x, y, function (a, b) { return isSite(a, b, 'complex'); }); },
			'within 6 hexes of a Π': function (x, y) {
				return complexes.some(function (s) { return G.distance(s.anchor, [x, y]) <= 6; });
			},
			'crater': function (x, y) { return near(x, y, function (a, b) { return isSite(a, b, 'crater'); }); }
		};
		var fits = function (spawn, x, y) {
			var tOk = spawn.terrain.some(function (t) { return TERRAIN_OK[t] ? TERRAIN_OK[t](x, y) : key(x, y) === t; });
			return tOk && (!spawn.near || !NEAR_OK[spawn.near] || NEAR_OK[spawn.near](x, y));
		};
		var bandOf = function (x, y) { return bandA[idx(x, y)]; };
		var inReach = function (x, y) { return danger(x, y) <= CS.REACH.danger && G.distance(cap, [x, y]) <= CS.REACH.hexes; };

		var list = [], at = {}, blocked = new Uint8Array(cols * rows);
		// open to a city-state at all: land, not ours, not by the capital (worked out once)
		var openA = new Uint8Array(cols * rows);
		for (var oy2 = 0; oy2 < rows; oy2++) {
			for (var ox2 = 0; ox2 < cols; ox2++) {
				openA[idx(ox2, oy2)] = land(ox2, oy2) && !taken(ox2, oy2) && G.distance(cap, [ox2, oy2]) >= CS.MIN_CAPITAL ? 1 : 0;
			}
		}
		var free = function (x, y, fallen) {
			var i = idx(x, y);
			return openA[i] === 1 && !blocked[i] && (fallen || gen.siteAt[i] < 0);
		};
		// every free land hex once, in a seeded order, to pick from
		var all = [];
		for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) if (openA[idx(x, y)] && gen.siteAt[idx(x, y)] < 0) all.push([x, y]);
		for (var i = all.length - 1; i > 0; i--) {
			var j = Math.floor(rand() * (i + 1)), s = all[i];
			all[i] = all[j];
			all[j] = s;
		}
		// the first hex that fits, trying looser windows until one does: the story ones must be placed.
		// extra: a guarantee (inside the reach) that every window keeps
		var find = function (spawn, extra) {
			var inBand = function (p, w) { var b = bandOf(p[0], p[1]); return b >= spawn.band[0] - w && b <= spawn.band[1] + w; };
			var tries = [
				function (p) { return inBand(p, 0) && fits(spawn, p[0], p[1]); },
				function (p) { return inBand(p, 1) && fits(spawn, p[0], p[1]); },
				function (p) { return fits(spawn, p[0], p[1]); },
				function (p) { return inBand(p, 0); },
				function () { return true; }
			];
			// one pass: the first hex in the seeded order for the tightest window any hex meets
			var best = tries.length, pick = null;
			for (var q = 0; q < all.length && best > 0; q++) {
				var p = all[q];
				if (!free(p[0], p[1]) || (extra && !extra(p[0], p[1]))) continue;
				for (var k = 0; k < best; k++) {
					if (tries[k](p)) {
						best = k;
						pick = p;
						break;
					}
				}
			}
			return pick;
		};
		var names = {};
		var nameFor = function (t) {
			var g = CS.TEMPERAMENTS[t].names;
			if (!names[g]) names[g] = CS.NAMES[g].slice();
			return names[g].splice(Math.floor(rand() * names[g].length), 1)[0];
		};
		var add = function (t, p, site) {
			var land0 = site ? site.hexes.map(function (h) { return h.slice(); }) : [p.slice()];
			if (!site) {
				for (var d = 0; d < 6; d++) {
					var n = G.neighbour(p[0], p[1], d);
					if (inside(n[0], n[1]) && land(n[0], n[1]) && gen.siteAt[idx(n[0], n[1])] < 0 && !at[n[0] + ',' + n[1]]) land0.push(n);
				}
			}
			var cs = { id: 'cs' + (list.length + 1), t: t, name: nameFor(t), at: p.slice(), land: land0,
				site: site ? gen.sites.indexOf(site) : -1, band: bandOf(p[0], p[1]) };
			land0.forEach(function (h) { at[h[0] + ',' + h[1]] = cs.id; });
			[p].concat(land0).forEach(function (h) {
				for (var dy = -CS.SPACING; dy <= CS.SPACING; dy++) {
					for (var dx = -CS.SPACING - 1; dx <= CS.SPACING + 1; dx++) {
						var x = h[0] + dx, y = h[1] + dy;
						if (inside(x, y) && G.distance(h, [x, y]) < CS.SPACING) blocked[idx(x, y)] = 1;
					}
				}
			});
			list.push(cs);
			return cs;
		};
		var left = {}, scale = CS.scale(gen);
		for (var t in CS.TEMPERAMENTS) {
			var tt = CS.TEMPERAMENTS[t];
			left[t] = tt.kind === 'story' ? 1 : Math.max(1, Math.round(tt.spawn.count * scale));
		}
		var place1 = function (t, extra) {
			var p = find(CS.TEMPERAMENTS[t].spawn, extra);
			if (!p) return false;
			add(t, p, null);
			left[t]--;
			return true;
		};
		// 1. the story ones, the potters inside the ember network's reach
		for (t in CS.TEMPERAMENTS) {
			if (!CS.story(t)) continue;
			var g = CS.TEMPERAMENTS[t].spawn.guarantee;
			if (!(g && place1(t, inReach))) place1(t);
		}
		// 2. the guarantees: herders inside the reach
		for (t in CS.TEMPERAMENTS) {
			var gn = CS.TEMPERAMENTS[t].spawn.guarantee;
			if (CS.story(t) || !gn) continue;
			for (var k2 = 0; k2 < gn; k2++) place1(t, inReach);
		}
		// 3. the fallen cities nearest the capital, outside the old wasteland, resettled by a common one that fits
		var commons = Object.keys(CS.TEMPERAMENTS).filter(function (t) { return !CS.story(t); });
		var fallen = gen.sites.filter(function (s) {
			var a = s.anchor;
			return s.kind === 'fallenCity' && !(a[0] >= ox && a[0] <= ox + 2 * R && a[1] >= oy && a[1] <= oy + 2 * R);
		}).sort(function (a, b) { return G.distance(a.anchor, cap) - G.distance(b.anchor, cap); });
		var resettled = 0;
		for (var f = 0; f < fallen.length && resettled < CS.FALLEN; f++) {
			var a = fallen[f].anchor;
			if (!free(a[0], a[1], true) || fallen[f].hexes.some(function (h) { return taken(h[0], h[1]) || at[h[0] + ',' + h[1]]; })) continue;
			var b = bandOf(a[0], a[1]);
			var fit = commons.filter(function (t) {
				var sp = CS.TEMPERAMENTS[t].spawn;
				return left[t] > 0 && fits(sp, a[0], a[1]) && b >= sp.band[0] && b <= sp.band[1];
			});
			if (!fit.length) continue;
			var pick = fit[Math.floor(rand() * fit.length)];
			add(pick, a, fallen[f]);
			left[pick]--;
			resettled++;
		}
		// 4. the rest
		for (t in CS.TEMPERAMENTS) {
			while (left[t] > 0 && place1(t)) { /* placed */ }
		}
		return list;
	},

	/*
	 * Influence (PHASE4 §2): pure pieces the game and the simulator share
	 */
	// T for a temperament now; state: { quest } for the ash-faithful (the sworn's power stands in Phase 4)
	rateT: function (t, state) {
		var T = CityStates.TEMPERAMENTS[t].influence_T;
		if (typeof T == 'number') return T;
		if (t === 'ash_faithful') return state && state.quest ? T.after_quest : T.before_quest;
		return T.power_stands;
	},

	// what they want and scorn now: { wants: [], scorned: [] }, "weapons" opened into the real weapons
	wantsOf: function (t, state) {
		var tt = CityStates.TEMPERAMENTS[t], phase = t === 'ash_faithful' ? (state && state.quest ? 'after_quest' : 'before_quest') : 'power_stands';
		var w = Array.isArray(tt.wants) ? tt.wants : tt.wants[phase];
		var s = Array.isArray(tt.scorned) ? tt.scorned : tt.scorned[phase];
		var open = [];
		w.forEach(function (g) { open = open.concat(g === 'weapons' ? CityStates.WEAPONS : [g]); });
		return { wants: open, scorned: s };
	},

	// the glow G on a city-state at `at`: the strongest fire within GLOW_REACH, halved per hex of gap
	// (gap 0 = touching), doubled when a lit beacon stands next to them. fire: Float32Array; beacon(x, y)
	glow: function (fire, cols, rows, at, beacon) {
		var CS = CityStates, best = 0;
		var R = CS.GLOW_REACH;
		for (var dy = -R; dy <= R; dy++) {
			for (var dx = -R - 1; dx <= R + 1; dx++) {
				var x = at[0] + dx, y = at[1] + dy;
				if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
				var f = fire[x + y * cols];
				if (f < Fire.LIT_MIN) continue;
				var d = WorldGen.distance(at, [x, y]);
				if (d > R) continue;
				var g = f * Math.pow(0.5, Math.max(0, d - 1));
				if (g > best) best = g;
			}
		}
		if (best > 0 && beacon) {
			for (var k = 0; k < 6; k++) {
				var n = WorldGen.neighbour(at[0], at[1], k);
				if (n[0] >= 0 && n[1] >= 0 && n[0] < cols && n[1] < rows && beacon(n[0], n[1]) && fire[n[0] + n[1] * cols] >= Fire.LIT_MIN) {
					return best * CS.TOUCH;
				}
			}
		}
		return best;
	},

	// influence a minute from the glow
	perMinute: function (G, T, S) {
		return CityStates.RATE * G * T / S;
	},

	// the influence a gift is worth before the cap and the 5-minute halving: value × want / (10 × S)
	giftWorth: function (t, state, goods, S) {
		var w = CityStates.wantsOf(t, state), total = 0;
		for (var k in goods) {
			if (!(goods[k] > 0)) continue;
			total += goods[k] * (CityStates.VALUES[k] || 0) * CityStates.want(w, k) / (10 * S);
		}
		return total;
	},

	// ×2 wanted, ×1 neutral, ×0 scorned
	want: function (w, good) {
		if (w.scorned.indexOf('*') >= 0 || w.scorned.indexOf(good) >= 0) return 0;
		return w.wants.indexOf(good) >= 0 ? 2 : 1;
	},

	// the highest threshold at or under an influence
	floorOf: function (inf) {
		var f = 0;
		CityStates.THRESHOLDS.forEach(function (t) { if (t < 100 && inf >= t) f = t; });
		return f;
	},

	// the price told at 25: { goods } of a tribute scaled by the band, or null
	tribute: function (t, band) {
		var p = CityStates.TEMPERAMENTS[t].price_pool.filter(function (p) { return p.type === 'tribute'; })[0];
		if (!p) return null;
		var out = {};
		if (p.fixed) for (var k in p.fixed) out[k] = p.fixed[k];
		else for (var j in p.base) out[j] = p.base[j] * (p.scale ? 1 + band : 1);
		return out;
	},

	// can influence alone win them (to 100)?
	influenceWins: function (t, state) {
		var w = CityStates.TEMPERAMENTS[t].ways_to_win;
		if (w.indexOf('influence') >= 0) return true;
		return t === 'ash_faithful' && !!(state && state.quest);
	},

	// force only, as Phase 4 sees them: "they will not bend."
	forceOnly: function (t) {
		return t === 'reavers' || t === 'the_sworn';
	}
};

/*
 * The game side: state, the tick, the map, the town panel. Nothing here runs at load.
 */
(function (game) {
	for (var k in game) CityStates[k] = game[k];
})({
	init: function () {
		if (CityStates._ready) return;
		CityStates._ready = true;
		CityStates.adapt();
		$.Dispatch('stateUpdate').subscribe(CityStates.handleStateUpdates);
		// a reload mid-trek wakes at home: an envoy out with the wanderer is home again
		var e = CityStates.envoy();
		if (e && e.out) $SM.set('game.citystates.envoy.out', false, true);
		// and a quest under way on that trek is where it was before it set out
		var all = (CityStates.get() || {}).cs || {};
		for (var id in all) {
			var q = all[id].q;
			if (!q) continue;
			if (q.party === 'with') q.party = 'waiting';
			if (typeof q.walked == 'number') q.walked = null;
			if (all[id].fetched && !all[id].quest) all[id].fetched = false;
		}
		CityStates._well = $SM.get('game.citystates.well') || null;
		CityStates.onHexMap();
		CityStates.scheduleTick();
	},

	/*
	 * Adapters around the fire network (script/network.js is not changed here): nothing of ours goes
	 * on a city-state's land, and no city is founded beside one.
	 */
	adapt: function () {
		var N = Network, found = N.foundingSite, beacon = N.canBeacon, districts = N.districtsFor;
		var near = function (x, y) {
			return CityStates.landAt(x, y) || District.neighbours([x, y]).some(function (p) { return CityStates.landAt(p[0], p[1]); });
		};
		N.foundingSite = function (x, y) {
			var f = found.apply(N, arguments);
			return f && !near(f.at[0], f.at[1]) ? f : null;
		};
		// a beacon can stand next to them (it touches them), not on their hearth
		N.canBeacon = function (x, y) {
			var c = CityStates.landAt(x, y);
			return beacon.apply(N, arguments) && !(c && c.at[0] === x && c.at[1] === y);
		};
		N.districtsFor = function (cityId, x, y) {
			return CityStates.landAt(x, y) ? [] : districts.apply(N, arguments);
		};
	},

	get: function () {
		return $SM.get('game.citystates');
	},

	list: function () {
		return (CityStates.get() || {}).list || [];
	},

	byId: function (id) {
		return CityStates._byId ? CityStates._byId[id] : null;
	},

	state: function (id) {
		return $SM.get('game.citystates.cs["' + id + '"]') || {};
	},

	envoy: function () {
		return $SM.get('game.citystates.envoy') || null;
	},

	tick: function () {
		return $SM.get('game.citystates.ticks', true);
	},

	// Placed once, when the hex map first opens (or on the first load of an older save that has one).
	onHexMap: function () {
		if (!World.hex) return;
		var gen = World.hex.gen, saved = CityStates.get();
		// placed for this world by this generator; another one's places don't fit its land
		if (!saved || saved.seed !== gen.seed || saved.gen !== gen.gen) {
			var field = World.hex.danger, taken = {};
			// what is ours already: cities' districts, beacons, our towns on the map
			Network.cities().forEach(function (c) { for (var k in c.city.districts) taken[k] = true; });
			for (var b in $SM.get('game.network.beacons') || {}) taken[b] = true;
			var list = CityStates.place(gen, function (x, y) { return Danger.at(field, gen.cols, x, y, 'normal'); }, function (x, y) {
				return taken[x + ',' + y] || World.hex.map[x][y] === World.TILE.VILLAGE;
			});
			var cs = {};
			list.forEach(function (c) { cs[c.id] = { inf: 0, floor: 0, told: {} }; });
			$SM.set('game.citystates', { seed: gen.seed, gen: gen.gen, list: list, cs: cs, sighted: {}, beats: {}, ticks: 0, riders: {} }, true);
			Engine.log('placed ' + list.length + ' city-states');
		}
		CityStates.index();
		// what is already seen from home counts as met
		CityStates.meet(World.hex.mask, false);
	},

	// lookups by hex, for the map and the hover (O(1) per hex)
	index: function () {
		var gen = World.hex.gen, land = new Int16Array(gen.cols * gen.rows).fill(-1), by = {};
		CityStates.list().forEach(function (c, i) {
			by[c.id] = c;
			if (CityStates.state(c.id).city) return; // joined: one of our cities now
			c.land.forEach(function (h) { land[h[0] + h[1] * gen.cols] = i; });
		});
		CityStates._land = land;
		CityStates._byId = by;
		CityStates._quests = null;
	},

	// the city-state whose land a hex is (still their own), or null
	landAt: function (x, y) {
		if (!CityStates._land || !World.hex) return null;
		var gen = World.hex.gen;
		if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows) return null;
		var i = CityStates._land[x + y * gen.cols];
		return i < 0 ? null : CityStates.list()[i];
	},

	// what a hex of theirs shows: [glyph, bold], or null
	glyphAt: function (x, y) {
		// a quest's marked hex: its ground, bold
		if (CityStates.questHere(x, y) || CityStates.wellAt(x, y)) return [World.hex.gen.terrain[x][y], true];
		var c = CityStates.landAt(x, y);
		if (!c) return null;
		if (c.at[0] === x && c.at[1] === y) return [CityStates.GLYPH, true];
		return [World.hex.gen.terrain[x][y], false];
	},

	// their land is clear on the map once seen: other people's light
	clearAt: function (x, y) {
		return !!CityStates.landAt(x, y);
	},

	// the hover label of a hex of theirs, or of the envoy waiting where they fell
	label: function (x, y) {
		var e = CityStates.envoy();
		if (e && e.fell && e.fell[0] === x && e.fell[1] === y) return CityStates.nb(_('an envoy, waiting.'));
		var q = CityStates.questLabel(x, y);
		if (q) return q;
		if (CityStates.wellAt(x, y)) return CityStates.nb(Network.flag('wellFound') ? Events.Blaze.TEXT.stain.hover : _('a black stain on the ice.'));
		var c = CityStates.landAt(x, y);
		if (!c) return null;
		if (c.at[0] !== x || c.at[1] !== y) return CityStates.nb(CityStates.fill(_("{name}'s land."), c));
		var st = CityStates.state(c.id);
		var lines = [c.name + '.', CityStates.TEMPERAMENTS[c.t].name + '.', CityStates.status(c)];
		if (!CityStates.forceOnly(c.t)) lines.push(_('influence {0}.', Math.floor(st.inf || 0)));
		if (st.pulled) lines.push(_('someone else is talking to them.'));
		return lines.map(CityStates.nb).join(' ');
	},

	nb: function (s) {
		return s.replace(/ /g, '&nbsp;');
	},

	// {name}, {goods}, {n}, {work}, {place}, ... in a line of the content pack
	fill: function (s, c, vars) {
		vars = $.extend({ name: c ? c.name : '' }, vars || {});
		return s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
	},

	// the status word (content 3.1)
	status: function (c) {
		var st = CityStates.state(c.id), inf = st.inf || 0;
		if (st.city) return _("they're yours.");
		if (CityStates.forceOnly(c.t)) return _('they will not bend.');
		if (inf >= 100) return _("they're yours.");
		if (inf >= 75) return _('they lean your way.');
		if (inf >= 50) return _('they listen.');
		if (inf >= 25) return _('they trade.');
		if (inf > 0) return _("they've seen the light.");
		return _("they don't know you.");
	},

	goods: function (g) {
		var names = Object.keys(g).filter(function (k) { return g[k] > 0; }).map(function (k) { return g[k] + ' ' + _(k); });
		return names.join(', ');
	},

	// city-states whose anchor is in the mask are met; on a trek the first of each temperament is a scene
	meet: function (mask, trek) {
		var changed = false, scene = null;
		CityStates.list().forEach(function (c) {
			var st = CityStates.state(c.id);
			if (st.met || !mask[c.at[0]][c.at[1]]) return;
			$SM.set('game.citystates.cs["' + c.id + '"].met', true, true);
			// their land is clear once seen
			c.land.forEach(function (h) { mask[h[0]][h[1]] = true; });
			changed = true;
			if (trek && !$SM.get('game.citystates.sighted["' + c.t + '"]')) {
				$SM.set('game.citystates.sighted["' + c.t + '"]', true, true);
				scene = scene || c;
			}
		});
		if (changed && !trek) World.saveHex(World.worldFlags());
		if (scene) Events.startEvent(Events.CityStates.sighting(scene));
		return changed;
	},

	/*
	 * The tick: every Fire.TICK (10 s), after the hearths. All writes quiet, one update at the end.
	 */
	scheduleTick: function () {
		CityStates._tickTimeout = Engine.setTimeout(CityStates.doTick, Fire.TICK * 1000);
	},

	doTick: function () {
		CityStates.update();
		CityStates.scheduleTick();
	},

	update: function () {
		if (!World.hex || !World.hex.fire || !CityStates.get()) return;
		var CS = CityStates, gen = World.hex.gen, fire = World.hex.fire, perTick = Fire.TICK / 60;
		var now = CS.tick() + 1;
		$SM.set('game.citystates.ticks', now, true);
		var beacon = function (x, y) { return Network.beaconAt(x, y); };
		var spheres = CS.spheres(), notes = [];
		// what the lit land shows from home counts as met
		if (!World.state) CS.meet(World.hex.mask, false);
		CS.list().forEach(function (c) {
			var path = 'game.citystates.cs["' + c.id + '"]', st = $SM.get(path);
			if (!st || st.city) return;
			var inf = st.inf || 0, start = inf;
			var G = CS.glow(fire.fire, gen.cols, gen.rows, c.at, beacon);
			var S = CS.strength(World.baseDangerAt(c.at[0], c.at[1]));
			var T = CS.rateT(c.t, st), top = CS.influenceWins(c.t, st) ? 100 : (T > 0 ? CS.NO_WIN_CAP : 0);
			var gain = G > 0 ? CS.perMinute(G, T, S) * perTick : 0;
			// a resident envoy, glow or not, up to 25
			if (st.envoy && inf < CS.ENVOY_CAP && T > 0) gain += Math.min(CS.ENVOY_RATE * perTick, CS.ENVOY_CAP - inf);
			if (gain > 0) {
				inf = Math.min(top, inf + gain);
				$SM.set(path + '.floor', Math.max(st.floor || 0, CS.floorOf(inf)), true);
			} else if (inf > st.floor) {
				// out of the glow: it fades, but never below the last threshold passed
				inf = Math.max(st.floor || 0, inf - CS.DECAY * perTick);
				if (!st.faded) {
					notes.push(CS.fill(_('the light has gone from {name}. they stop coming to the gate.'), c));
					$SM.set(path + '.faded', true, true);
				} else if (inf === st.floor && st.faded !== 'floor') {
					notes.push(CS.fill(_('the people of {name} remember the light. they wait.'), c));
					$SM.set(path + '.faded', 'floor', true);
				}
			}
			if (gain > 0 && st.faded) $SM.set(path + '.faded', false, true);
			if (st.envoy && start < CS.ENVOY_CAP && inf >= CS.ENVOY_CAP && G === 0) {
				notes.push(_('the envoy has said all there is to say. the rest is up to the light.'));
			}
			// rivals: the spheres around the Π pull the wavering back, past the floors (pending user G18)
			if (inf >= 50 && inf < 100) {
				spheres.forEach(function (p) {
					if (WorldGen.distance(p.at, c.at) > CS.RIVAL_REACH(p.band)) return;
					var pull = CS.RIVAL_PULL(p.band) * perTick * (G > 0 && CS.touched(c) ? 0.5 : 1);
					inf -= pull;
					if (!st.pulled) {
						notes.push(CS.fill(_('the people of {name} have had other visitors. they listen less now.'), c));
						$SM.set(path + '.pulled', true, true);
					}
				});
			}
			// the ash-faithful's hill, kept lit
			if (c.t === 'ash_faithful' && !st.quest) CS.lightQuest(c, st, path, notes);
			// the holdfast's watch fire on their pass: a side ask (pending user G7)
			if (c.t === 'walled_holdfast' && st.told && st.told[25] && !st.work && Network.has('B4') && CS.touched(c)) {
				$SM.set(path + '.work', true, true);
				inf = Math.min(Math.max(inf, 0) + CS.SIDE_ASK, top);
				notes.push(CS.fill(_('the {work} is up. the people of {name} come out to look at it.'), c, { work: _('watch fire') }));
			}
			// reavers near a resident envoy
			if (st.envoy && now % CS.REAVER_EVERY === 0 && CS.reaversNear(c) && Math.random() < CS.REAVER_CHANCE) {
				$SM.set(path + '.envoy', false, true);
				notes.push(CS.fill(_('the envoy to {name} did not arrive.'), c));
			}
			inf = Math.max(0, inf);
			if (inf < start) $SM.set(path + '.floor', Math.min(st.floor || 0, CS.floorOf(inf)), true);
			$SM.set(path + '.inf', inf, true);
			CS.crossed(c, start, inf);
		});
		CS.riders(spheres, now, notes);
		notes.forEach(function (n) { Notifications.notify(null, n); });
		CS.playQueued();
		// one update a tick; the fire tick's own save keeps it (no second full save)
		$SM.fireUpdate('game.citystates');
	},

	// a lit beacon next to them
	touched: function (c) {
		var fire = World.hex.fire, cols = World.hex.gen.cols;
		return District.neighbours(c.at).some(function (p) {
			return Network.beaconAt(p[0], p[1]) && fire.lit[p[0] + p[1] * cols];
		});
	},

	reaversNear: function (c) {
		return CityStates.list().some(function (r) {
			return r.t === 'reavers' && !CityStates.state(r.id).city && WorldGen.distance(r.at, c.at) <= CityStates.REAVER_REACH;
		});
	},

	// the placeholder spheres (approved Q6 a): one on each old-world complex, its band by its danger
	spheres: function () {
		if (CityStates._spheres && CityStates._spheres.gen === World.hex.gen) return CityStates._spheres.list;
		var list = [];
		World.hex.gen.sites.forEach(function (s, i) {
			if (s.kind !== 'complex') return;
			list.push({ i: i, at: s.anchor, band: Danger.band(World.baseDangerAt(s.anchor[0], s.anchor[1])) });
		});
		CityStates._spheres = { gen: World.hex.gen, list: list };
		return list;
	},

	// every ~15 minutes riders from each sphere visit one wavering city-state in its reach: -10,
	// unless our envoy is there
	riders: function (spheres, now, notes) {
		var CS = CityStates;
		spheres.forEach(function (p) {
			var last = $SM.get('game.citystates.riders["' + p.i + '"]', true);
			if (now - last < CS.RIDER_EVERY) return;
			$SM.set('game.citystates.riders["' + p.i + '"]', now, true);
			var wavering = CS.list().filter(function (c) {
				var st = CS.state(c.id);
				return !st.city && st.inf >= 50 && st.inf < 100 && WorldGen.distance(p.at, c.at) <= CS.RIVAL_REACH(p.band);
			});
			if (!wavering.length) return;
			var c = wavering[Math.floor(Math.random() * wavering.length)], path = 'game.citystates.cs["' + c.id + '"]';
			var st = CS.state(c.id);
			if (st.envoy) {
				notes.push(CS.fill(_("riders came to {name}'s gate. the envoy met them. they went away."), c));
				return;
			}
			var inf = Math.max(0, st.inf - CS.RIDER_HIT);
			$SM.set(path + '.inf', inf, true);
			$SM.set(path + '.floor', Math.min(st.floor || 0, CS.floorOf(inf)), true);
			// fixes C17: from the direction of the rider's Π
			notes.push(CS.fill(_('riders from the {dir} were at the {name} gate. they listen less now.'), c, { dir: CS.direction(c.at, p.at) }));
		});
	},

	direction: function (from, to) {
		var dx = (to[0] + 0.5 * (to[1] & 1)) - (from[0] + 0.5 * (from[1] & 1)), dy = (to[1] - from[1]) * 0.866;
		var a = Math.atan2(-dy, dx), dirs = [_('east'), _('north-east'), _('north'), _('north-west'), _('west'), _('south-west'), _('south'), _('south-east')];
		return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
	},

	// the light quest: their hill (their own hex) lit for LIGHT_HOLD ticks, then influence opens
	lightQuest: function (c, st, path, notes) {
		var CS = CityStates, lit = !!World.hex.fire.lit[c.at[0] + c.at[1] * World.hex.gen.cols];
		if (!CS.talks(st)) return;
		var place = _('the hill');
		if (lit) {
			var n = (st.lit || 0) + 1;
			$SM.set(path + '.lit', n, true);
			if (n === Math.floor(CS.LIGHT_HOLD / 2)) notes.push(CS.fill(_('the fire on {place} still burns.'), c, { place: place }));
			if (n >= CS.LIGHT_HOLD) {
				$SM.set(path + '.quest', true, true);
				notes.push(CS.fill(_('the fire on {place} has burned the night through. the people of {name} have seen it.'), c, { place: place }));
			}
		} else if (st.lit) {
			$SM.set(path + '.lit', 0, true);
			notes.push(CS.fill(_('the fire on {place} has gone out. the people of {name} turn away from it.'), c, { place: place }));
		}
	},

	// a threshold passed upward: its scene or line, once
	crossed: function (c, from, to) {
		var CS = CityStates, path = 'game.citystates.cs["' + c.id + '"]';
		CS.THRESHOLDS.forEach(function (t) {
			if (from >= t || to < t || CS.state(c.id).told[t]) return;
			$SM.set(path + '.told[' + t + ']', true, true);
			if (t === 100) CS.join(c); // its scenes wait their turn
			else CS.queue(function () { CS.threshold(c, t); });
		});
	},

	// scenes wait for a quiet moment: not over another event, not out on the map
	queue: function (fn) {
		(CityStates._queue = CityStates._queue || []).push(fn);
	},

	playQueued: function () {
		var q = CityStates._queue || [];
		while (q.length && !Events.activeEvent() && Engine.activeModule != World && Engine.activeModule != Space) q.shift()();
	},

	threshold: function (c, t) {
		var CS = CityStates, text = Events.CityStates.TEXT[c.t] || {};
		if (t === 25) {
			// the mirror folk never come; a flash instead
			if (c.t === 'mirror_folk') {
				Notifications.notify(null, _('a flash from the flats, aimed at the hearth.'));
				CS.tell(c);
			} else {
				Events.startEvent(Events.CityStates.stranger(c));
			}
		} else if (t === 50) {
			if (c.t === 'bog_cutters') Events.startEvent(Events.CityStates.bogCutters(c));
			else Notifications.notify(null, CS.fill(_('the people of {name} listen when the envoy speaks.'), c));
		} else if (t === 75) {
			Notifications.notify(null, CS.fill(_('the people of {name} lean toward the light.'), c));
		}
		if (text.flavour && text.flavour[t] && !(c.t === 'bog_cutters' && t === 50)) Notifications.notify(null, text.flavour[t]);
	},

	// at 25 (or from an envoy): their wants, price or task are known; barter opens at their gate
	tell: function (c) {
		$SM.set('game.citystates.cs["' + c.id + '"].told.talks', true);
		// a quest's place is fixed and marked now
		if (CityStates.questOf) CityStates.questOf(c);
	},

	/*
	 * Gifts (PHASE4 §2c): a pack left at their gate (or sent by road, from B6). Returns the lines to show.
	 */
	give: function (c, goods) {
		var CS = CityStates, path = 'game.citystates.cs["' + c.id + '"]', st = CS.state(c.id), lines = [];
		var S = CS.strength(World.baseDangerAt(c.at[0], c.at[1]));
		var list = CS.goods(goods);
		if (!list) return lines;
		if (CS.forceOnly(c.t)) return [_('they will not bend.')];
		if (c.t === 'mirror_folk') return [CS.fill(_('the {goods} are left in the sun outside the town. no one touches them.'), c, { goods: list })];
		if (c.t === 'ash_faithful' && !st.quest) return [_("they won't take anything until the hill burns.")];
		// the clerks' page, carried in an envoy's pack
		if (c.t === 'archive_clerks' && goods['knowledge fragment'] > 0 && CS.questOf(c) && !st.quest) {
			CS.questDone(c);
			return [];
		}
		// a price first: told at 25, paid in full, they join
		var price = CS.tribute(c.t, c.band);
		if (price && st.told && st.told[25] && CS.covers(goods, price)) {
			lines.push(CS.fill(_('the {goods} are counted at the gate. the people of {name} open it.'), c, { goods: CS.goods(price) }));
			CS.join(c, 'price');
			return lines;
		}
		var inf = st.inf || 0;
		if (inf >= CS.GIFT_CAP) return [CS.fill(_('the people of {name} thank you. it\'s the light they watch now.'), c)];
		var now = CS.tick(), g = st.gift || { tick: -Infinity, mult: 1 };
		var mult = now - g.tick < CS.GIFT_WINDOW ? g.mult / 2 : 1;
		var w = CS.wantsOf(c.t, st), worth = CS.giftWorth(c.t, st, goods, S) * mult;
		var any = Object.keys(goods).filter(function (k) { return goods[k] > 0; });
		var wanted = any.some(function (k) { return CS.want(w, k) === 2; }), scorned = any.every(function (k) { return CS.want(w, k) === 0; });
		if (scorned) lines.push(CS.fill(_('the people of {name} leave the {goods} at the gate.'), c, { goods: list }));
		else if (mult < 1) lines.push(CS.fill(_("the people of {name} take it. they've had a great deal lately."), c));
		else if (wanted) lines.push(CS.fill(_('the people of {name} take the {goods} gladly.'), c, { goods: list }));
		else lines.push(CS.fill(_('the people of {name} take the {goods}.'), c, { goods: list }));
		var to = Math.min(CS.GIFT_CAP, inf + worth);
		$SM.set(path + '.gift', { tick: now, mult: mult }, true);
		$SM.set(path + '.inf', to);
		CS.crossed(c, inf, to);
		CS.playQueued();
		return lines;
	},

	covers: function (have, price) {
		for (var k in price) {
			var n = k === 'weapons' ? CityStates.WEAPONS.reduce(function (s, w) { return s + (have[w] || 0); }, 0) : have[k] || 0;
			if (n < price[k]) return false;
		}
		return true;
	},

	/*
	 * Joining (PHASE4 §2f): a city of ours, its people, its land as districts by type, its focus;
	 * no production loss. Story city-states play their beat.
	 */
	join: function (c, how) {
		var CS = CityStates, st = CS.state(c.id);
		if (st.city) return;
		var tt = CS.TEMPERAMENTS[c.t], give = tt.gives[0] || {};
		var next = City.nextCity(), d = {};
		d[Network.key(c.at[0], c.at[1])] = District.HEARTH;
		// one of each district it brings, on its own land beside the hearth quarter, where it fits
		(give.districts || []).forEach(function (type) {
			var T = District.TYPES[type];
			var p = c.land.filter(function (h) {
				if (d[Network.key(h[0], h[1])] || Network.districtAt(h[0], h[1]) || Network.beaconAt(h[0], h[1])) return false;
				if (!District.neighbours(h).some(function (q) { return d[Network.key(q[0], q[1])]; })) return false;
				var g = Network.ground(null, h[0], h[1]);
				g.city = d;
				return T.fits(g);
			})[0];
			if (p) d[Network.key(p[0], p[1])] = type;
		});
		City.createCity(next.id, c.name, {
			hex: c.at, districts: d, stores: CS.joinStores(), citizens: CS.JOIN_PEOPLE[give.people === 'many' ? 'many' : 'some'], parent: null
		});
		var focus = CS.focusOf(c.t);
		if (focus) $SM.set(City.path(next.id, 'focus'), focus, true);
		$SM.set('game.citystates.cs["' + c.id + '"].city', next.id, true);
		$SM.set('game.citystates.cs["' + c.id + '"].inf', 100, true);
		$SM.set('game.citystates.cs["' + c.id + '"].envoy', false, true);
		// home: a city of ours on the map
		World.hex.map[c.at[0]][c.at[1]] = World.TILE.VILLAGE;
		if (World.state) World.state.map[c.at[0]][c.at[1]] = World.TILE.VILLAGE;
		else World.saveHex(World.worldFlags());
		CS.index();
		// fixes C19: every name in the pool is a place, so the joining line names its people
		Notifications.notify(null, CS.fill(_('the people of {name} carry their coals to the line. they\'re part of the empire now.'), c));
		var text = Events.CityStates.TEXT[c.t] || {};
		if (text.flavour && text.flavour[100]) Notifications.notify(null, text.flavour[100]);
		if (text.join) Notifications.notify(null, text.join);
		// taken by force (script/armies.js): a story one's beat waits for its craftsmen to come home
		if (how !== 'force') CS.beat(c);
		Engine.event('progress', 'city-state joined');
		$SM.fireUpdate('game.cities["' + next.id + '"]');
		Network.refresh();
		return next.id;
	},

	// pending user: a temperament's focus when City.FOCUSES has it (farming, military); others start hands-on
	focusOf: function (t) {
		var f = (CityStates.TEMPERAMENTS[t].gives[0] || {}).focus;
		return City.FOCUSES.indexOf(f) >= 0 ? f : null;
	},

	// a story city-state's ladder beat on joining: its scene now, the tier a flag the era it belongs
	// to picks up (as Network.resettleStory does for the charcoal stranger)
	beat: function (c) {
		var CS = CityStates, gives = CS.TEMPERAMENTS[c.t].gives, ev = Events.CityStates;
		gives.forEach(function (g) {
			if (!g.tier || typeof g.at == 'string' && g.at !== 'price' && g.at !== 'quest') return;
			$SM.set('game.citystates.beats["' + g.tier + '"]', c.id);
			Engine.event('progress', 'story hook ' + g.tier);
		});
		// (the forge-masters' scene is their price: Events.CityStates.coldForges)
		var scenes = { bog_cutters: [ev.f6, ev.b8], potters: [ev.h6], mirror_folk: [ev.mirrors] }[c.t];
		(scenes || []).forEach(function (s) { CS.queue(function () { Events.startEvent(s(c)); }); });
	},

	/*
	 * Envoys (PHASE4 §2d): one on the road at a time (shortcut: the settlers' pattern; one per
	 * city-state stays true). It waits at home, goes with the next trek, and at their gate stays,
	 * leaves the pack, or comes back.
	 */
	// why an envoy can't go to a city-state now, or null
	cantSend: function (cityId, c) {
		var st = CityStates.state(c.id);
		if (CityStates.forceOnly(c.t)) return _('they will not bend.');
		if (!st.met) return _("they don't know you.");
		if (st.envoy) return _('an envoy is already there');
		var e = CityStates.envoy();
		if (e) return e.to === c.id && !e.out && !e.fell ? _('an envoy is ready to go') : _('an envoy is already on the road');
		if (City.people(cityId) < 1) return _('not enough people');
		for (var k in CityStates.ENVOY_COST) {
			if ($SM.get(City.storePath(cityId, k), true) < CityStates.ENVOY_COST[k]) return _('not enough ' + k);
		}
		return null;
	},

	sendEnvoy: function (cityId, id) {
		var c = CityStates.byId(id), why = CityStates.cantSend(cityId, c);
		if (why) {
			Notifications.notify(City, why);
			return false;
		}
		Network.pay(cityId, CityStates.ENVOY_COST);
		City.removePeople(cityId, 1);
		$SM.set('game.citystates.envoy', { to: id, from: cityId, pack: {}, out: false });
		Notifications.notify(null, _('the envoy takes a pack and a fire-pot and goes.'));
		CityStates.updatePanel();
		return true;
	},

	// n of a good into (or out of) the waiting envoy's pack, from their city's stores
	pack: function (good, n) {
		var e = CityStates.envoy();
		if (!e || e.out) return false;
		var have = $SM.get(City.storePath(e.from, good), true), inPack = e.pack[good] || 0;
		n = n > 0 ? Math.min(n, Math.floor(have)) : Math.max(n, -inPack);
		if (!n) return false;
		$SM.add(City.storePath(e.from, good), -n);
		$SM.set('game.citystates.envoy.pack["' + good + '"]', inPack + n);
		CityStates.updatePanel();
		return true;
	},

	// an envoy who has not left yet unpacks, back into their city
	callOff: function () {
		var e = CityStates.envoy();
		if (!e || e.out) return false;
		$SM.remove('game.citystates.envoy');
		CityStates.backHome(e);
		CityStates.updatePanel();
		return true;
	},

	backHome: function (e) {
		if (!$SM.get('game.cities["' + e.from + '"]')) return;
		if (e.pack) $SM.addM(City.storesPath(e.from), e.pack);
		if (e.from == City.CAPITAL) $SM.add('game.population', 1);
		else $SM.add(City.path(e.from, 'population.citizens'), 1);
	},

	// a resident envoy is called home
	callHome: function (id) {
		var c = CityStates.byId(id);
		var from = CityStates.state(id).envoy;
		if (!from) return false;
		$SM.set('game.citystates.cs["' + id + '"].envoy', false);
		CityStates.backHome({ from: from === true ? City.CAPITAL : from });
		Notifications.notify(null, CityStates.fill(_('the envoy is called home.'), c));
		Notifications.notify(null, CityStates.fill(_('the people of {name} watch them go.'), c));
		CityStates.updatePanel();
		return true;
	},

	// the trek sets out: a waiting envoy falls in, and drinks from the trek's water (pending user G5)
	onEmbark: function () {
		var e = CityStates.envoy();
		if (!e || e.out || e.fell) return;
		$SM.set('game.citystates.envoy.out', true, true);
		World.setWater(Math.max(0, World.water - CityStates.ENVOY_WATER));
	},

	onStep: function (x, y) {
		var CS = CityStates, e = CS.envoy();
		// the envoy waiting where they fell falls in again
		if (e && e.fell && e.fell[0] === x && e.fell[1] === y) {
			$SM.set('game.citystates.envoy', $.extend({}, e, { fell: null, out: true, picked: true }), true);
			Notifications.notify(World, _('the envoy is still here, waiting.'));
			e = CS.envoy();
		}
		CS.meet(World.state.mask, true);
		if (CS.questStep(x, y)) return;
		var c = CS.landAt(x, y);
		if (c && e && e.out && e.to === c.id && c.at[0] === x && c.at[1] === y) Events.startEvent(Events.CityStates.gate(c));
	},

	// the wanderer falls: the envoy waits at the fall hex, like lost settlers; a second fall loses them
	onDie: function () {
		CityStates.questFail(true);
		var e = CityStates.envoy();
		if (!e || !e.out) return;
		var c = CityStates.byId(e.to);
		if (e.picked) {
			$SM.remove('game.citystates.envoy');
			Notifications.notify(null, CityStates.fill(_('the envoy to {name} did not arrive.'), c));
			return;
		}
		$SM.set('game.citystates.envoy', $.extend({}, e, { out: false, fell: World.curPos.slice() }));
		Notifications.notify(null, CityStates.fill(_('the envoy to {name} fell on the road.'), c));
	},

	onHome: function () {
		CityStates.questFail(false);
		var e = CityStates.envoy();
		if (e && e.out) $SM.set('game.citystates.envoy.out', false, true);
		CityStates.playQueued();
	},

	// at the gate (scene 2): stay, leave the pack, or go back
	arrive: function (c, choice) {
		var CS = CityStates, e = CS.envoy(), path = 'game.citystates.cs["' + c.id + '"]', lines = [];
		if (!e) return lines;
		if (choice === 'back') return lines;
		lines = CS.give(c, e.pack || {});
		if (choice === 'stay') {
			$SM.remove('game.citystates.envoy');
			$SM.set(path + '.envoy', e.from); // the city they came from, to go home to
			Notifications.notify(World, CS.fill(_("the envoy has a place by {name}'s fire."), c));
			CS.report(c);
		} else {
			// the pack is in; the envoy comes home with the trek
			$SM.set('game.citystates.envoy.pack', {});
			$SM.remove('game.citystates.envoy');
			CS.backHome({ from: e.from });
		}
		return lines;
	},

	// the envoy sends word: their wants, price or task
	report: function (c) {
		var CS = CityStates, st = CS.state(c.id), w = CS.wantsOf(c.t, st).wants;
		CS.tell(c);
		if (w.length) Notifications.notify(null, CS.fill(_('the envoy sends word. the people of {name} want {goods}.'), c, { goods: w.map(function (g) { return _(g); }).join(', ') }));
		if (CS.tribute(c.t, c.band)) Notifications.notify(null, CS.fill(_('the envoy sends word. {name} would join, for a price.'), c));
		if (CS.TEMPERAMENTS[c.t].quest_pool.length) Notifications.notify(null, CS.fill(_('the envoy sends word. the people of {name} have a task, if anyone will do it.'), c));
		if (st.pulled) Notifications.notify(null, CS.fill(_("the envoy sends word. riders have been at {name}'s gate."), c));
	},

	/*
	 * The town panel: the city-states we know, how they stand, and the envoy.
	 */
	updatePanel: function () {
		if (!City.panel || !CityStates.get()) return;
		var CS = CityStates, met = CS.list().filter(function (c) { var st = CS.state(c.id); return st.met && !st.city; });
		var box = $('#cityStates');
		if (!met.length) {
			box.remove();
			return;
		}
		if (!box.length) {
			// under the land, with the cities and their focus
			box = $('<div>').attr({ id: 'cityStates', 'data-legend': _('the city-states') }).appendTo($('#cityLand').length ? '#cityLand' : City.panel);
		}
		var e = CS.envoy(), key = JSON.stringify([met.map(function (c) { return c.id + CS.status(c) + Math.floor(CS.state(c.id).inf) + !!CS.state(c.id).envoy; }), e, CS.selected]);
		if (box.attr('data-key') === key) return;
		box.attr('data-key', key).empty();
		var cap = World.hex.gen.capital;
		met.sort(function (a, b) { return WorldGen.distance(a.at, cap) - WorldGen.distance(b.at, cap); });
		met.forEach(function (c) {
			var st = CS.state(c.id);
			var row = $('<div>').attr('id', 'cs_row_' + c.id).addClass('storeRow csRow').toggleClass('selected', CS.selected === c.id)
				.click(function () { CS.selected = CS.selected === c.id ? null : c.id; CS.updatePanel(); });
			$('<div>').addClass('row_key').text(c.name).appendTo(row);
			$('<div>').addClass('row_val').text(CS.status(c)).appendTo(row);
			var tip = $('<div>').addClass('tooltip bottom right').appendTo(row);
			$('<div>').text(CS.TEMPERAMENTS[c.t].name + '.').appendTo(tip);
			if (!CS.forceOnly(c.t)) $('<div>').text(_('influence {0}.', Math.floor(st.inf || 0))).appendTo(tip);
			if (st.envoy) $('<div>').text(_('an envoy lives there.')).appendTo(tip);
			$('<div>').addClass('clear').appendTo(row);
			row.appendTo(box);
			if (CS.selected === c.id) CS.actions(c).appendTo(box);
		});
		if (e) CS.envoyBox(e).appendTo(box);
	},

	// what can be done with the selected city-state
	actions: function (c) {
		var CS = CityStates, st = CS.state(c.id), box = $('<div>').addClass('csActions'), cityId = City.activeCity;
		var talks = st.told && (st.told[25] || st.told.talks);
		if (talks) {
			var w = CS.wantsOf(c.t, st);
			$('<div>').addClass('csLine').text(w.wants.length ? CS.fill(_('they want {goods}.'), c, { goods: w.wants.map(function (g) { return _(g); }).join(', ') }) :
				_('they want nothing. they watch the light.')).appendTo(box);
			var price = CS.tribute(c.t, c.band);
			if (price) $('<div>').addClass('csLine').text(CS.fill(_('{name} will join for {goods}.'), c, { goods: CS.goods(price) })).appendTo(box);
			var offer = (Events.CityStates.TEXT[c.t] || {}).offer;
			if (offer) $('<div>').addClass('csLine').text(CS.fill(offer, c)).appendTo(box);
			if (c.t === 'forge_masters') {
				new Button.Button({
					id: 'cs_pay', text: _('pay'), width: '80px', cost: price,
					click: function () { Events.startEvent(Events.CityStates.coldForges(c)); }
				}).appendTo(box);
			}
		}
		if (CS.forceOnly(c.t)) {
			$('<div>').addClass('csLine').text(c.t === 'the_sworn' ? _('the sworn keep their oath to the old works. they will not bend.') :
				_('the reavers watch the light. they will not bend.')).appendTo(box);
		}
		if (st.envoy) {
			new Button.Button({
				id: 'cs_callhome', text: _('call the envoy home'), width: '80px',
				click: function () { CS.callHome(c.id); }
			}).appendTo(box);
		} else {
			var why = CS.cantSend(cityId, c);
			var b = new Button.Button({
				id: 'cs_envoy', text: _('send an envoy'), width: '80px',
				cost: $.extend({ 'citizen': 1 }, CS.ENVOY_COST),
				click: function () { CS.sendEnvoy(City.activeCity, c.id); }
			}).appendTo(box);
			Button.setDisabled(b, !!why);
			if (why) $('<div>').addClass('csLine').text(why).appendTo(box);
		}
		// force (script/armies.js)
		if (typeof Armies != 'undefined' && Armies._ready) Armies.actions(c, box);
		$('<div>').addClass('clear').appendTo(box);
		return box;
	},

	// the envoy waiting to leave: their pack, filled from their city's stores; out on the road; fallen
	envoyBox: function (e) {
		var CS = CityStates, c = CS.byId(e.to), box = $('<div>').attr('id', 'csEnvoy');
		var from = $SM.get('game.cities["' + e.from + '"]');
		var line = e.fell ? CS.fill(_('the envoy to {name} fell on the road.'), c) : e.out ? CS.fill(_('the envoy is on the road to {name}.'), c) :
			CS.fill(_('an envoy is ready to go out to {name}, with the next trek.'), c, {});
		$('<div>').addClass('csLine').text(line).appendTo(box);
		if (e.out || e.fell) return box;
		var st = CS.state(c.id), w = CS.wantsOf(c.t, st).wants, talks = st.told && (st.told[25] || st.told.talks);
		var goods = talks ? w.concat(Object.keys(CS.tribute(c.t, c.band) || {})) : [];
		// before talks, what we hold that anyone wants
		if (!talks) {
			for (var t in CS.TEMPERAMENTS) CS.wantsOf(t, {}).wants.forEach(function (g) { if (goods.indexOf(g) < 0 && $SM.get(City.storePath(e.from, g), true) >= 1) goods.push(g); });
		}
		goods = goods.filter(function (g, i) { return g !== 'weapons' && goods.indexOf(g) === i; });
		goods.forEach(function (g) {
			var row = $('<div>').attr('id', 'cs_pack_' + g.replace(/ /g, '-')).addClass('workerRow csPack');
			$('<div>').addClass('row_key').text(_(g)).appendTo(row);
			var val = $('<div>').addClass('row_val').appendTo(row);
			$('<span>').text(e.pack[g] || 0).appendTo(val);
			$('<div>').addClass('upBtn').toggleClass('disabled', $SM.get(City.storePath(e.from, g), true) < 1).appendTo(val).click(function () { CS.pack(g, 10); });
			$('<div>').addClass('dnBtn').toggleClass('disabled', !(e.pack[g] > 0)).appendTo(val).click(function () { CS.pack(g, -10); });
			$('<div>').addClass('clear').appendTo(row);
			row.appendTo(box);
		});
		new Button.Button({
			id: 'cs_calloff', text: _('call off'), width: '80px',
			click: function () { CS.callOff(); }
		}).appendTo(box);
		$('<div>').addClass('clear').appendTo(box);
		return box;
	},

	handleStateUpdates: function (e) {
		if (!e.stateName) return;
		if (e.stateName.indexOf('game.citystates') === 0) CityStates._quests = null;
		if (e.stateName.indexOf('game.citystates') === 0 || e.stateName.indexOf('game.cities') === 0 || e.category == 'stores') {
			CityStates.updatePanel();
		}
	}
});

/*
 * Quests (PHASE4 §3; content §1 quest_pool, §3.5, §3.8): find, clear, meet and fetch, the four story
 * city-states that join on a quest (fixes C10, G14, C21). Each is told when talks open (25, or an
 * envoy's report), and its place is fixed then and saved in the city-state's state, `q`:
 *   find    { at, party: 'waiting' | 'with' }      a lost party on a marked hex, walked to their gate
 *   clear   { at }                                  a fight one band hard on a marked hex near them
 *   meet    { walked }                              walk QUEST.MEET_STEPS steps with the moving camp
 *   fetch   { site, at }                            a knowledge fragment from a Π, carried to their gate
 * A quest that fails stays open (pending user): the party waits again, the raiders stay, the camp moves
 * on, the fragment lies in the dropped pack.
 */
(function (more) {
	for (var k in more) CityStates[k] = more[k];
})({
	QUEST: {
		// provisional (not in PHASE4): how far the find party and the clear fight are from the city-state
		FIND: [4, 8], CLEAR: [2, 4],
		FETCH: [6, 20],          // PHASE4 §3: fetch from a site 6-20 hexes off, at least a band above them
		MEET_STEPS: 20,          // fixes C21
		DRIFT_STEPS: 50,         // the drifters move a hex every 50 trek steps (content spawn.moves)
		CHAIN: 'the black well', // the drifters start this chain (F12)
		MAPS: 20,                // the clerks' old maps show the Π and Ø this far around
		WELL: 6                  // provisional: the black well, this far north of the drifters' camp
	},

	// the quest of a temperament, or null (the ash-faithful's light quest has its own rules)
	questType: function (t) {
		var q = CityStates.TEMPERAMENTS[t].quest_pool[0];
		return q && q.type !== 'light' ? q : null;
	},

	/*
	 * Where a quest is (pure, for the simulator too): gen, danger(x, y) at normal, c the city-state, list all
	 * of them. Returns { at } or { site, at } (fetch), or null when the world has no such place.
	 */
	questSite: function (gen, danger, c, list) {
		var CS = CityStates, G = WorldGen, q = CS.questType(c.t);
		if (!q || q.type === 'meet') return null;
		var cols = gen.cols, taken = {};
		list.forEach(function (o) { o.land.forEach(function (h) { taken[h[0] + ',' + h[1]] = true; }); });
		if (q.type === 'fetch') {
			var band = function (s) { return Danger.band(danger(s.anchor[0], s.anchor[1])); };
			var byDist = function (a, b) { return G.distance(a.anchor, c.at) - G.distance(b.anchor, c.at); };
			var far = gen.sites.filter(function (s) {
				var d = G.distance(s.anchor, c.at);
				return s.kind === 'complex' && d >= CS.QUEST.FETCH[0] && d <= CS.QUEST.FETCH[1];
			}).sort(byDist);
			// a band above them if there is one; else the nearest in the window; else the nearest past 6
			var s = far.filter(function (s) { return band(s) >= c.band + 1; })[0] || far[0] ||
				gen.sites.filter(function (s) { return s.kind === 'complex' && G.distance(s.anchor, c.at) >= CS.QUEST.FETCH[0]; }).sort(byDist)[0];
			return s ? { site: gen.sites.indexOf(s), at: s.anchor.slice() } : null;
		}
		var win = q.type === 'find' ? CS.QUEST.FIND : CS.QUEST.CLEAR;
		// the deep trees for the tappers, the far side of the pits for the tar-keepers: their own ground first
		var ground = q.type === 'find' ? G.TERRAIN.jungle : G.TERRAIN.desert;
		var best = null, score = -1, rand = G.rng(gen.seed ^ (c.at[0] * 7919 + c.at[1] * 104729));
		for (var dy = -win[1]; dy <= win[1]; dy++) {
			for (var dx = -win[1] - 1; dx <= win[1] + 1; dx++) {
				var x = c.at[0] + dx, y = c.at[1] + dy;
				if (x < 0 || y < 0 || x >= cols || y >= gen.rows) continue;
				var d = G.distance([x, y], c.at), t = gen.terrain[x][y];
				if (d < win[0] || d > win[1] || !gen.reachable[x + y * cols] || taken[x + ',' + y] || gen.siteAt[x + y * cols] >= 0) continue;
				if (G.isWater(t) || !G.isPassable(t) || !G.isTerrain(gen.map[x][y].charAt(0))) continue;
				var sc = (t === ground ? 2 : 0) + rand();
				if (sc > score) {
					score = sc;
					best = [x, y];
				}
			}
		}
		return best ? { at: best } : null;
	},

	// open land the wanderer can reach, outside any site and any other city-state's land
	freeLand: function (gen, x, y, taken) {
		if (x < 0 || y < 0 || x >= gen.cols || y >= gen.rows || taken[x + ',' + y] || gen.siteAt[x + y * gen.cols] >= 0) return false;
		var t = gen.terrain[x][y];
		return !!gen.reachable[x + y * gen.cols] && !WorldGen.isWater(t) && WorldGen.isPassable(t) && WorldGen.isTerrain(gen.map[x][y].charAt(0));
	},

	// the drifters' next hex (pure): a free land neighbour, tundra first; null to stay put. roll in [0, 1)
	driftTo: function (gen, c, list, roll) {
		var G = WorldGen, taken = {}, opts = [];
		list.forEach(function (o) { if (o !== c) o.land.forEach(function (h) { taken[h[0] + ',' + h[1]] = true; }); });
		for (var d = 0; d < 6; d++) {
			var n = G.neighbour(c.at[0], c.at[1], d);
			if (CityStates.freeLand(gen, n[0], n[1], taken)) opts.push({ at: n, tundra: gen.terrain[n[0]][n[1]] === G.TERRAIN.tundra });
		}
		var tundra = opts.filter(function (o) { return o.tundra; }), pick = tundra.length ? tundra : opts;
		return pick.length ? pick[Math.floor(roll * pick.length)].at : null;
	},

	// talks are open: at 25, or once an envoy has reported
	talks: function (st) {
		return !!(st.told && (st.told[25] || st.told.talks));
	},

	// the quest's state, its place fixed and marked on the map the first time it is asked for
	questOf: function (c) {
		var CS = CityStates, st = CS.state(c.id), q = CS.questType(c.t);
		if (!q || st.city || !CS.talks(st)) return null;
		if (st.q) return st.q;
		var gen = World.hex.gen, field = World.hex.danger;
		var site = CS.questSite(gen, function (x, y) { return Danger.at(field, gen.cols, x, y, 'normal'); }, c, CS.list());
		var s = { type: q.type };
		if (q.type === 'find') s.party = 'waiting';
		if (q.type === 'meet') s.walked = null;
		if (site) {
			s.at = site.at;
			if (site.site !== undefined) s.site = site.site;
			var mask = World.state ? World.state.mask : World.hex.mask;
			mask[s.at[0]][s.at[1]] = true;
			if (!World.state) World.saveHex(World.worldFlags());
		}
		$SM.set('game.citystates.cs["' + c.id + '"].q', s, true);
		CS._quests = null;
		return s;
	},

	// the city-state whose find party or clear fight waits on a hex, or null (the map asks per hex drawn:
	// a lookup kept by questIndex)
	questHere: function (x, y) {
		if (!CityStates._quests) CityStates.questIndex();
		return CityStates._quests[x + ',' + y] || null;
	},

	questIndex: function () {
		var CS = CityStates, map = {};
		CS.list().forEach(function (c) {
			var st = CS.state(c.id), q = st.q;
			if (q && !st.city && !st.quest && q.at && (q.type === 'clear' || (q.type === 'find' && q.party === 'waiting'))) map[q.at[0] + ',' + q.at[1]] = c;
		});
		CS._quests = map;
	},

	// its hover line: the party or the foe the content names
	questLabel: function (x, y) {
		var c = CityStates.questHere(x, y);
		if (!c) return null;
		var q = CityStates.questType(c.t);
		return CityStates.nb(_(q.party || q.foe) + '.');
	},

	// every trek step: quest places, the camp on the move, the walk, the gate. true if a scene started
	questStep: function (x, y) {
		var CS = CityStates, started = false;
		$SM.set('game.citystates.steps', $SM.get('game.citystates.steps', true) + 1, true);
		CS.list().forEach(function (c) {
			var st = CS.state(c.id), path = 'game.citystates.cs["' + c.id + '"].q';
			if (started || st.city || st.quest || !CS.questType(c.t)) return;
			var q = CS.questOf(c), type = CS.questType(c.t).type, home = c.at[0] === x && c.at[1] === y;
			if (type === 'meet') {
				started = CS.meetStep(c, q, home);
				return;
			}
			if (!q) return;
			var on = q.at && q.at[0] === x && q.at[1] === y;
			if (type === 'find') {
				if (q.party === 'with') CS.partySupplies(c, q);
				if (on && q.party === 'waiting') {
					// they walk with you, like lost settlers
					$SM.set(path + '.party', 'with', true);
					CS._quests = null;
					Notifications.notify(World, CS.fill(_('the {party} fall in behind.'), c, { party: _(CS.questType(c.t).party) }));
				} else if (home && q.party === 'with') {
					started = CS.questDone(c);
				}
			} else if (type === 'clear' && on) {
				CS._fighting = c.id;
				Events.startEvent(Events.CityStates.clearFight(c));
				started = true;
			} else if (type === 'fetch') {
				var site = q.site >= 0 && World.siteAt(x, y) === World.hex.gen.sites[q.site];
				if (site && !(Path.outfit['knowledge fragment'] > 0) && !st.fetched && Path.getFreeSpace() >= Path.getWeight('knowledge fragment')) {
					Path.outfit['knowledge fragment'] = 1;
					$SM.set('game.citystates.cs["' + c.id + '"].fetched', true, true);
					World.updateSupplies();
				} else if (home && Path.outfit['knowledge fragment'] > 0) {
					Path.outfit['knowledge fragment']--;
					World.updateSupplies();
					started = CS.questDone(c);
				}
			}
		});
		return started;
	},

	// the find party eats and drinks from the trek's supplies as the wanderer does, one share each
	partySupplies: function (c, q) {
		var CS = CityStates, n = q.people || CS.questType(c.t).size, path = 'game.citystates.cs["' + c.id + '"].q';
		var food = (q.food || 0) + 1, water = (q.water || 0) + 1;
		var perFood = World.MOVES_PER_FOOD * ($SM.hasPerk('slow metabolism') ? 2 : 1);
		var perWater = World.MOVES_PER_WATER * ($SM.hasPerk('desert rat') ? 2 : 1);
		if (food >= perFood) {
			food = 0;
			Path.outfit['cured meat'] = Math.max(0, (Path.outfit['cured meat'] || 0) - n);
		}
		if (water >= perWater) {
			water = 0;
			World.setWater(Math.max(0, World.water - n));
		}
		$SM.set(path + '.food', food, true);
		$SM.set(path + '.water', water, true);
		World.updateSupplies();
	},

	// a fallen party waits with the dropped pack, thinned by the scavengers like lost settlers (3b):
	// how many still hold out, or null
	partyLeft: function (pack) {
		if (!pack || !pack.party) return null;
		var n = Math.floor(pack.party.people * pack.left);
		return n > 0 ? n : null;
	},

	// the party's name, for the pack's hover line
	partyName: function (pack) {
		var c = CityStates.byId(pack.party.cs);
		return c ? _(CityStates.questType(c.t).party) : '';
	},

	// the corpse run reaches the pack: who held out fall in again; none, and the party is gone
	partyBack: function (pack) {
		var CS = CityStates, c = CS.byId(pack.party.cs), n = CS.partyLeft(pack);
		if (!c) return;
		if (!n) {
			CS.partyGone(c);
			return;
		}
		var path = 'game.citystates.cs["' + c.id + '"].q';
		$SM.set(path + '.party', 'with', true);
		$SM.set(path + '.people', n, true);
		$SM.set(path + '.picked', true, true);
		Notifications.notify(World, CS.fill(_('the {party} fall in behind.'), c, { party: _(CS.questType(c.t).party) }));
	},

	// the party is lost: the content's fail line; the quest stays open, a new party waits on the marked hex
	partyGone: function (c) {
		var CS = CityStates, path = 'game.citystates.cs["' + c.id + '"].q';
		$SM.set(path + '.party', 'waiting', true);
		$SM.set(path + '.people', CS.questType(c.t).size, true);
		$SM.set(path + '.picked', false, true);
		CS._quests = null;
		Notifications.notify(null, CS.fill(_('the lost party is gone. scavengers got there first.'), c));
	},

	// the black well the drifters point to: a hex north of their camp, marked on the map (F12's chain)
	markWell: function (c) {
		var CS = CityStates, gen = World.hex.gen, at = c.at.slice(), taken = {};
		CS.list().forEach(function (o) { o.land.forEach(function (h) { taken[h[0] + ',' + h[1]] = true; }); });
		for (var i = 0; i < CS.QUEST.WELL; i++) {
			var n = WorldGen.neighbour(at[0], at[1], i % 2 ? 5 : 4); // north-west, north-east: due north
			if (n[1] < 0) break;
			at = n;
		}
		// the open land nearest that spot and still north of the camp (the north edge can be sea), on the
		// ice where it can be; failing that, the open land nearest it anywhere
		var land = Fire.around(c.at[0], c.at[1], 2 * CS.QUEST.WELL).filter(function (p) {
			return !(p[0] === c.at[0] && p[1] === c.at[1]) && CS.freeLand(gen, p[0], p[1], taken);
		});
		var byNear = function (a, b) {
			return Fire.distance(a, at) - Fire.distance(b, at) ||
				(gen.terrain[b[0]][b[1]] === WorldGen.TERRAIN.tundra) - (gen.terrain[a[0]][a[1]] === WorldGen.TERRAIN.tundra);
		};
		var near = land.filter(function (p) { return p[1] < c.at[1]; }).sort(byNear)[0] || land.sort(byNear)[0] || c.at.slice();
		$SM.set('game.citystates.well', near.slice());
		CS._well = near.slice();
		var mask = World.state ? World.state.mask : World.hex.mask;
		mask[near[0]][near[1]] = true;
		if (!World.state) World.saveHex(World.worldFlags());
		return near;
	},

	wellAt: function (x, y) {
		var w = CityStates._well;
		return !!w && w[0] === x && w[1] === y;
	},

	// the drifters move a hex every DRIFT_STEPS trek steps; caught at their camp, sample scene 6; then the walk
	meetStep: function (c, q, home) {
		var CS = CityStates, path = 'game.citystates.cs["' + c.id + '"].q';
		if (q && typeof q.walked == 'number') {
			var n = q.walked + 1;
			$SM.set(path + '.walked', n, true);
			if (n < CS.QUEST.MEET_STEPS) return false;
			$SM.set(path + '.walked', null, true);
			Events.startEvent(Events.CityStates.walkEnd(c));
			return true;
		}
		if ($SM.get('game.citystates.steps', true) % CS.QUEST.DRIFT_STEPS === 0) CS.drift(c);
		if (!q || !home) return false;
		Events.startEvent(Events.CityStates.smokeOnSnow(c));
		return true;
	},

	drift: function (c) {
		var CS = CityStates, gen = World.hex.gen, list = CS.list(), to = CS.driftTo(gen, c, list, Math.random());
		if (!to) return false;
		var taken = {}, land = [to.slice()];
		list.forEach(function (o) { if (o !== c) o.land.forEach(function (h) { taken[h[0] + ',' + h[1]] = true; }); });
		District.neighbours(to).forEach(function (n) { if (CS.freeLand(gen, n[0], n[1], taken)) land.push(n); });
		var i = list.indexOf(c);
		$SM.set('game.citystates.list[' + i + '].at', to.slice(), true);
		$SM.set('game.citystates.list[' + i + '].land', land, true);
		CS.index();
		return true;
	},

	// walk with them: the next MEET_STEPS steps count, if the trek doesn't end first
	walkWith: function (c) {
		$SM.set('game.citystates.cs["' + c.id + '"].q.walked', 0, true);
	},

	// the trek ends without the quest done (died: the wanderer fell): it fails, and stays open
	questFail: function (died) {
		var CS = CityStates;
		CS.list().forEach(function (c) {
			var st = CS.state(c.id), q = st.q, path = 'game.citystates.cs["' + c.id + '"]';
			if (!q || st.city || st.quest) return;
			var t = CS.questType(c.t);
			if (q.type === 'find' && q.party === 'with' && died) {
				// fallen once, they wait by the pack (World.dropPack has just made it); a second fall loses them
				if (q.picked) {
					CS.partyGone(c);
					return;
				}
				var pack = $SM.get('game.world.pack') || { at: World.curPos.slice(), items: {}, left: 1 };
				pack.party = { cs: c.id, people: q.people || t.size };
				$SM.set('game.world.pack', pack);
				$SM.set(path + '.q.party', 'fallen', true);
			} else if (q.type === 'clear' && died && CS._fighting === c.id) {
				Notifications.notify(null, CS.fill(_('the {foe} are still there. the people of {name} stay behind their walls.'), c, { foe: _(t.foe) }));
			} else if (q.type === 'meet' && typeof q.walked == 'number') {
				$SM.set(path + '.q.walked', null, true);
				Notifications.notify(null, CS.fill(_('the people of {name} have moved on. the tracks are filling with snow.'), c));
			} else if (q.type === 'fetch' && died && st.fetched) {
				// it went into the dropped pack with the rest of the bag; the site gives another
				$SM.set(path + '.fetched', false, true);
				Notifications.notify(null, CS.fill(_('the {thing} lies where the trek fell.'), c, { thing: _(t.thing) }));
			}
		});
		CS._fighting = null;
	},

	// a quest done: its line, then its scene, whose last button joins them (content 3.5)
	questDone: function (c) {
		var CS = CityStates, q = CS.questType(c.t), ev = Events.CityStates;
		$SM.set('game.citystates.cs["' + c.id + '"].quest', true, true);
		CS._quests = null;
		var line = {
			find: _('the lost walk in through the gate. the people of {name} come out to meet them.'),
			clear: _("the {foe} won't trouble {name} again."),
			fetch: _('the {thing} is handed over. the people of {name} look at it a long time.')
		}[q.type];
		if (line) Notifications.notify(null, CS.fill(line, c, { foe: _(q.foe || ''), thing: _(q.thing || '') }));
		var scene = { resin_tappers: ev.lostTappers, tar_keepers: ev.tarSwear, archive_clerks: ev.archiveClerks }[c.t];
		if (scene) Events.startEvent(scene(c));
		else CS.questJoin(c);
		return !!scene;
	},

	// they join at the end of the quest's scene, with the beat's extras
	questJoin: function (c) {
		CityStates.extras(c);
		return CityStates.join(c, 'quest');
	},

	// what a quest city-state's beat brings besides its tier (also when its craftsmen come home, Phase 5)
	extras: function (c) {
		var CS = CityStates;
		if (c.t === 'resin_tappers') $SM.set('game.citystates.beats["jungle jobs"]', c.id);
		if (c.t === 'drifters') {
			$SM.set('game.citystates.beats["' + CS.QUEST.CHAIN + '"]', c.id);
			CS.markWell(c);
		}
		if (c.t === 'archive_clerks') CS.oldMaps(c);
	},

	// the clerks' old maps: the old works and the craters far around show on the map
	oldMaps: function (c) {
		var CS = CityStates, gen = World.hex.gen, mask = World.state ? World.state.mask : World.hex.mask, n = 0;
		gen.sites.forEach(function (s) {
			if ((s.kind !== 'complex' && s.kind !== 'crater') || WorldGen.distance(s.anchor, c.at) > CS.QUEST.MAPS) return;
			s.hexes.forEach(function (h) { mask[h[0]][h[1]] = true; });
			n++;
		});
		if (!World.state) World.saveHex(World.worldFlags());
		return n;
	}
});
