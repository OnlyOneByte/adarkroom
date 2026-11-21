/**
 * Armies and sieges (Phase 5: design/drafts/POWERS.md §1, Option B for city-states; DESIGN.md "Taking
 * city-states", "Aftermath"; the craftsmen who flee, design/drafts/PHASE4.md Q1 b).
 *
 * A military-focus city trains soldiers from its idle people. An army is marched at a city-state on its
 * own: it finds its way (lit land first), spends water and food a hex at a time, and loses stragglers on
 * unlit ground. At the walls the siege is a chain of timed scenes on the 10 s tick: invest, press or
 * wait, a sally or two, then a breach and a storm resolved by numbers, or their stores run out and they
 * yield. A lost storm costs 50-80% of the army and drops its baggage as a cache. A city-state taken joins
 * at a production loss that wears off; a story one's craftsmen flee, and its ladder beat waits until a
 * trek brings them home.
 *
 * An army can march on a power too (a.power, script/powers.js): the same march and siege, with the power's
 * own numbers and puzzle, and a storm the wanderer leads. Boats and fire-ships are later.
 *
 * The rules at the top are pure (no DOM, no state), so the simulator (tools/sim-armies.js) loads this
 * file too. Every number is provisional, tuned with `npm run sim`.
 *
 * Saved state, game.armies:
 *   trained   { <cityId>: soldiers } trained and at home
 *   drill     { <cityId>: ticks } toward the next soldier
 *   list      [army] in the field: { id, from, to (city-state id), squads { weapon: n }, ammo { item: n },
 *             gear { item: n }, food, water, at, path [[x, y]], moves, due { food, lost }, state
 *             'march' | 'siege' | 'camp', home (marching home), siege, loot, warned }
 *   caches    { <army id>: { at, items, left } } the baggage a routed army dropped, one per army
 *   after     { <cityId>: { loss, ticks, left } } a taken city's production loss, wearing off
 *   fled      { <city-state id>: { at, party, people, food, water } } a story city-state's craftsmen
 *   next      ids handed out
 */
var Armies = {
	GLYPH: 'Δ',            // provisional: an army on the map
	HP: 50,                // a soldier, as the original's (POWERS §3)
	TRAIN_TICKS: 3,        // POWERS §1: 1 soldier / 30 s
	PER_WALLS: 10,         // POWERS §1: up to 10 per walls district

	// POWERS §1, squads by weapon (damage and cooldown are the original's, World.Weapons). ammo: spent per
	// soldier per volley; thrown: the ammo is the weapon, nothing else is carried
	SQUADS: [
		{ id: 'blades', weapon: 'energy blade' },
		{ id: 'lancers', weapon: 'laser rifle', ammo: 'energy cell' },
		{ id: 'bombers', weapon: 'grenade', ammo: 'grenade', thrown: true },
		{ id: 'bayonets', weapon: 'bayonet' },
		{ id: 'sword line', weapon: 'steel sword' },
		{ id: 'riflemen', weapon: 'rifle', ammo: 'bullets' },
		{ id: 'sword line', weapon: 'iron sword' },
		{ id: 'tanglers', weapon: 'bolas', ammo: 'bolas', thrown: true },
		{ id: 'spear line', weapon: 'bone spear' }
	],
	CARRY: 5,              // provisional: ammo each soldier of an ammo squad takes along

	// POWERS §1: three siege items. provisional costs; the doc names the goods only
	GEAR: {
		'ram': { 'oak': 40, 'steel': 10 },
		'blasting charge': { 'sulphur': 10, 'cloth': 5 },
		'mantlet': { 'oak': 20, 'leather': 10 }
	},
	RAM_HIT: 40,           // provisional: walls a ram wears a press tick; timber gates only (POWERS §1)
	CHARGE_HIT: 100,       // provisional: walls a blasting charge brings down; one spent a press tick
	MANTLET_MEN: 10,       // provisional: soldiers one mantlet shields; their losses halved

	// a city-state's defence by its danger band (POWERS §3: garrison 10 at band 0 to 60 at band 4, timber
	// to brick walls, no puzzle). provisional
	garrison: function (band) { return Math.round(10 + 12.5 * band); },
	walls: function (band) { return 100 * (1 + band); },
	wallKind: function (band) { return band <= 1 ? 'timber' : 'brick'; },
	stores: function (band) { return 30 + 15 * band; },        // siege ticks they can eat
	defMight: function (band) { return 0.3 + 0.15 * band; },  // damage per defender per second
	// ... or a power's own (POWERS §3), when its siege names one
	theirMight: function (siege) { return siege.might != null ? siege.might : Armies.defMight(siege.band); },

	// the siege chain (POWERS §1 Option B). provisional
	WEAR: 0.05,            // share of the army's might that wears the walls a press tick
	AT_WALLS: 0.2,         // share of their fire that finds the army while it presses
	WAITING: 0.02,         // ... while it waits them out
	SALLY: 1 / 12,         // chance a tick that they strike out; at most SALLIES a siege
	SALLIES: 2,
	CHOICE_EVERY: 6,       // ticks between the camp's choices (press / wait / fall back)
	ROUND: 5,              // seconds a round of the storm
	ROUNDS: 20,            // a storm that hasn't broken by then is lost
	ROUT_AT: 0.5,          // the army breaks (in the storm, or under the walls) when down to this share of who went in
	LOSS: [0.5, 0.8],      // POWERS §1: a lost storm costs 50-80% of the army, by how badly
	DESERT: 0.1,           // provisional: share of the army that slips away a step or tick without water or food

	// supply (POWERS §1 table): water free on lit land, 1 per soldier a step off it, ×2 on the wastes;
	// food 1 per soldier per 2 steps; stragglers 1% of soldiers a step × danger/5 off lit land, ×2 on the wastes
	WATER_EACH: 10,        // provisional: water a soldier carries (a waterskin, the original's)
	WASTES: 7,
	STRAGGLE: 0.01,
	LIT_PREF: 1.5,         // provisional: an unlit hex costs this much more when the army picks its way
	FOOD_TICKS: 60,        // provisional: an army packs food for the way there and back and this many siege ticks

	// POWERS §1 / §5 Q8: production loss and how long it takes to wear off (minutes)
	AFTERMATH: { force: { loss: 0.5, minutes: 10 }, sack: { loss: 0.75, minutes: 20 }, yield: { loss: 0.25, minutes: 5 } },
	CRAFTSMEN: 4,          // provisional: craftsmen who flee a story city-state

	weapon: function (w) {
		var W = World.Weapons[w] || {};
		return { dmg: typeof W.damage == 'number' ? W.damage : 0, cd: W.cooldown || 1 };
	},

	squadOf: function (weapon) {
		return Armies.SQUADS.filter(function (s) { return s.weapon === weapon; })[0];
	},

	// "1 soldier", "{n} soldiers"
	men: function (n) {
		return n === 1 ? _('1 soldier') : _('{0} soldiers', n);
	},

	soldiers: function (army) {
		var n = 0;
		for (var k in army.squads) n += army.squads[k];
		return n;
	},

	// the army's might, damage a second (POWERS §3: Σ dmg × soldiers / cooldown); an ammo squad fights with
	// as many as have a shot left
	might: function (army) {
		var m = 0;
		for (var w in army.squads) {
			var s = Armies.squadOf(w), n = army.squads[w];
			if (s && s.ammo) n = Math.min(n, (army.ammo || {})[s.ammo] || 0);
			var W = Armies.weapon(w);
			m += W.dmg * n / W.cd;
		}
		return m;
	},

	// a volley: every ammo squad spends a shot a soldier
	spend: function (army) {
		for (var w in army.squads) {
			var s = Armies.squadOf(w);
			if (!s || !s.ammo || !army.ammo) continue;
			army.ammo[s.ammo] = Math.max(0, (army.ammo[s.ammo] || 0) - army.squads[w]);
		}
	},

	// share of the enemy's fire that gets through: mantlets halve it for the soldiers behind them
	shield: function (army) {
		var n = Armies.soldiers(army);
		if (!n) return 1;
		return 1 - 0.5 * Math.min(1, ((army.gear || {}).mantlet || 0) * Armies.MANTLET_MEN / n);
	},

	// k soldiers fall (k can be fractional: the rest is carried in army.hurt); from the biggest squads first.
	// Returns the whole soldiers lost
	kill: function (army, k) {
		var lost = 0;
		army.hurt = (army.hurt || 0) + k;
		while (army.hurt >= 1 && Armies.soldiers(army) > 0) {
			var big = null;
			for (var w in army.squads) if (army.squads[w] > 0 && (!big || army.squads[w] > army.squads[big])) big = w;
			army.squads[big]--;
			if (!army.squads[big]) delete army.squads[big];
			army.hurt -= 1;
			lost++;
		}
		if (!Armies.soldiers(army)) army.hurt = 0;
		return lost;
	},

	/*
	 * Outfitting (pure): soldiers take the best weapons the city holds, one each; an ammo squad carries
	 * CARRY shots a soldier; all the siege gear goes. stores(k) = what the city holds. Returns
	 * { squads, ammo, gear, take } (take: what leaves the stores)
	 */
	outfit: function (soldiers, stores) {
		var A = Armies, out = { squads: {}, ammo: {}, gear: {}, take: {} }, left = soldiers;
		var add = function (k, n) { out.take[k] = (out.take[k] || 0) + n; };
		var order = A.SQUADS.slice().sort(function (a, b) {
			var x = A.weapon(a.weapon), y = A.weapon(b.weapon);
			return y.dmg / y.cd - x.dmg / x.cd;
		});
		order.forEach(function (s) {
			if (left <= 0) return;
			var have = Math.floor(stores(s.weapon) - (out.take[s.weapon] || 0));
			var n = s.thrown ? Math.floor(have / A.CARRY) : have;
			if (s.ammo && !s.thrown) n = Math.min(n, Math.floor((stores(s.ammo) - (out.take[s.ammo] || 0)) / A.CARRY));
			n = Math.min(n, left);
			if (n <= 0) return;
			out.squads[s.weapon] = n;
			left -= n;
			if (s.thrown) {
				out.ammo[s.ammo] = n * A.CARRY;
				add(s.weapon, n * A.CARRY);
			} else {
				add(s.weapon, n);
				if (s.ammo) {
					out.ammo[s.ammo] = (out.ammo[s.ammo] || 0) + n * A.CARRY;
					add(s.ammo, n * A.CARRY);
				}
			}
		});
		for (var g in A.GEAR) {
			var n = Math.floor(stores(g));
			if (n > 0) {
				out.gear[g] = n;
				add(g, n);
			}
		}
		return out;
	},

	/*
	 * The march (pure). cost of entering a hex: 2 on rough ground, as the wanderer's; route: the cheapest
	 * way from one hex to another, an unlit hex counted LIT_PREF times (lit land first). gen: the world;
	 * lit(x, y). Returns [[x, y]] (the hexes after `from`, ending on `to`) or null.
	 */
	moveCost: function (gen, x, y) {
		var t = gen.terrain[x][y];
		return World.ROUGH.some(function (k) { return WorldGen.TERRAIN[k] === t; }) ? 2 : 1;
	},

	route: function (gen, from, to, lit) {
		var cols = gen.cols, rows = gen.rows, n = cols * rows;
		var dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
		var heap = [], push = function (d, i) {
			heap.push([d, i]);
			for (var c = heap.length - 1; c > 0;) {
				var p = (c - 1) >> 1;
				if (heap[p][0] <= heap[c][0]) break;
				var s = heap[p]; heap[p] = heap[c]; heap[c] = s; c = p;
			}
		};
		var pop = function () {
			var top = heap[0], last = heap.pop();
			if (heap.length) {
				heap[0] = last;
				for (var c = 0; ;) {
					var l = 2 * c + 1, r = l + 1, m = c;
					if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
					if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
					if (m === c) break;
					var s = heap[m]; heap[m] = heap[c]; heap[c] = s; c = m;
				}
			}
			return top;
		};
		var start = from[0] + from[1] * cols, goal = to[0] + to[1] * cols;
		dist[start] = 0;
		push(0, start);
		while (heap.length) {
			var top = pop(), i = top[1];
			if (top[0] > dist[i]) continue;
			if (i === goal) break;
			var x = i % cols, y = (i - x) / cols;
			for (var d = 0; d < 6; d++) {
				var nb = WorldGen.neighbour(x, y, d), nx = nb[0], ny = nb[1];
				if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !WorldGen.isPassable(gen.terrain[nx][ny])) continue;
				var j = nx + ny * cols, w = Armies.moveCost(gen, nx, ny) * (lit(nx, ny) ? 1 : Armies.LIT_PREF);
				if (dist[i] + w < dist[j]) {
					dist[j] = dist[i] + w;
					prev[j] = i;
					push(dist[j], j);
				}
			}
		}
		if (dist[goal] === Infinity) return null;
		var path = [];
		for (var k = goal; k !== start; k = prev[k]) path.unshift([k % cols, (k - k % cols) / cols]);
		return path;
	},

	// the hex the army camps on (pure): next to their hearth, the best by score(x, y) (lit land first), then
	// nearest home
	campFor: function (gen, c, from, score) {
		return [0, 1, 2, 3, 4, 5].map(function (d) { return WorldGen.neighbour(c.at[0], c.at[1], d); }).filter(function (p) {
			return p[0] >= 0 && p[1] >= 0 && p[0] < gen.cols && p[1] < gen.rows && WorldGen.isPassable(gen.terrain[p[0]][p[1]]);
		}).sort(function (a, b) {
			return (score(b[0], b[1]) - score(a[0], a[1])) || WorldGen.distance(a, from) - WorldGen.distance(b, from);
		})[0] || null;
	},

	// what entering a hex costs an army of n (POWERS §1 table): { water, food, stragglers }, all fractional
	stepNeeds: function (n, lit, danger, cost) {
		var A = Armies, wastes = danger >= A.WASTES ? 2 : 1;
		return {
			water: lit ? 0 : n * cost * wastes,
			food: n * cost / 2,
			stragglers: lit ? 0 : n * A.STRAGGLE * danger / 5 * wastes * cost
		};
	},

	// food packed for a march of `steps` there, the way back and FOOD_TICKS of siege
	foodFor: function (n, steps) {
		return Math.ceil(n * (2 * steps + Armies.FOOD_TICKS) / 2);
	},

	/*
	 * The siege (pure). newSiege(band, soldiers): the walls, garrison and stores they hold, and the army that
	 * invested them. siegeTick: one 10 s tick at the walls, stance 'press' or 'wait', roll in [0, 1). Changes
	 * siege and army; returns { lost, worn, sally: { lost, killed } | null, breach, yield, broken }
	 */
	newSiege: function (band, soldiers) {
		var A = Armies;
		return {
			band: band, walls: A.walls(band), wallsMax: A.walls(band), kind: A.wallKind(band),
			garrison: A.garrison(band), garrisonMax: A.garrison(band), stores: A.stores(band),
			sallies: 0, ticks: 0, stance: 'press', invested: soldiers
		};
	},

	siegeTick: function (siege, army, roll) {
		var A = Armies, out = { lost: 0, worn: 0, sally: null, breach: false, yield: false }, tick = Fire.TICK;
		siege.ticks++;
		var fire = siege.garrison * A.theirMight(siege) * tick / A.HP * A.shield(army);
		if (siege.stance === 'press') {
			var worn = A.WEAR * A.might(army) * tick;
			A.spend(army);
			var gear = army.gear || {};
			if (gear.ram && siege.kind === 'timber') worn += A.RAM_HIT * gear.ram;
			if (gear['blasting charge'] > 0 && !siege.keep) { // (kept back for a power's puzzle: siege.keep)
				worn += A.CHARGE_HIT;
				gear['blasting charge']--;
			}
			out.worn = Math.min(siege.walls, worn);
			siege.walls -= out.worn;
			out.lost = A.kill(army, fire * A.AT_WALLS);
		} else {
			out.lost = A.kill(army, fire * A.WAITING);
		}
		// a power still fed from outside (siege.supplied: an adit open) eats nothing of its own
		if (!siege.supplied) siege.stores = Math.max(0, siege.stores - 1);
		// a sally: half of them strike out, one round of the storm, then back behind the walls
		if (siege.sallies < A.SALLIES && siege.walls > 0 && roll < A.SALLY) {
			siege.sallies++;
			var half = siege.garrison / 2;
			var killed = Math.min(half, A.might(army) * A.ROUND / A.HP);
			out.sally = { lost: A.kill(army, half * A.theirMight(siege) * A.ROUND / A.HP * A.shield(army)), killed: Math.round(killed) };
			siege.garrison -= killed;
		}
		out.breach = siege.walls <= 0;
		out.yield = !out.breach && siege.stores <= 0;
		// worn down under the walls, it breaks as a lost storm does
		out.broken = !out.breach && !out.yield && A.soldiers(army) < A.ROUT_AT * siege.invested;
		return out;
	},

	// the storm, resolved by numbers (POWERS §1): rounds until they are all down, or the army breaks.
	// Returns { rounds: [{ ours, theirs }], won, start, left }
	storm: function (siege, army) {
		var A = Armies, start = A.soldiers(army), rounds = [];
		for (var r = 0; r < A.ROUNDS && siege.garrison > 0 && A.soldiers(army) > 0; r++) {
			var theirs = Math.min(siege.garrison, A.might(army) * A.ROUND / A.HP);
			A.spend(army);
			var ours = A.kill(army, siege.garrison * A.theirMight(siege) * A.ROUND / A.HP * A.shield(army));
			siege.garrison -= theirs;
			if (siege.garrison < 0.5) siege.garrison = 0;
			rounds.push({ ours: ours, theirs: Math.round(theirs) });
			if (siege.garrison > 0 && A.soldiers(army) < A.ROUT_AT * start) break;
		}
		return { rounds: rounds, won: siege.garrison <= 0, start: start, left: A.soldiers(army) };
	},

	// a lost storm: 50-80% of who went in, by how many of them still stand. Returns the soldiers who walk away
	routed: function (start, garrisonLeft, garrisonMax) {
		var L = Armies.LOSS, frac = L[0] + (L[1] - L[0]) * Math.min(1, Math.max(0, garrisonLeft / garrisonMax));
		return Math.max(0, start - Math.round(frac * start));
	},

	// a taken city's production, as a share of its own, `left` ticks of `ticks` into the loss
	output: function (after) {
		return after ? 1 - after.loss * after.left / after.ticks : 1;
	},

	// where a story city-state's craftsmen hide (pure): free land in the find quest's window, its own ground first
	fleeSite: function (gen, c, list) {
		var CS = CityStates, win = CS.QUEST.FIND, taken = {}, best = null, score = -1;
		list.forEach(function (o) { o.land.forEach(function (h) { taken[h[0] + ',' + h[1]] = true; }); });
		var rand = WorldGen.rng(gen.seed ^ (c.at[0] * 104729 + c.at[1] * 7919) ^ 0xF1EE);
		for (var dy = -win[1]; dy <= win[1]; dy++) {
			for (var dx = -win[1] - 1; dx <= win[1] + 1; dx++) {
				var x = c.at[0] + dx, y = c.at[1] + dy, d = WorldGen.distance([x, y], c.at);
				if (d < win[0] || d > win[1] || !CS.freeLand(gen, x, y, taken)) continue;
				var sc = (gen.terrain[x][y] === gen.terrain[c.at[0]][c.at[1]] ? 2 : 0) + rand();
				if (sc > score) {
					score = sc;
					best = [x, y];
				}
			}
		}
		return best;
	}
};

/*
 * The game side: state, the tick, the march, the siege, the panel. Nothing here runs at load.
 */
(function (game) {
	for (var k in game) Armies[k] = game[k];
})({
	init: function () {
		if (Armies._ready) return;
		Armies._ready = true;
		if (!$SM.get('game.armies')) $SM.set('game.armies', { trained: {}, drill: {}, list: [], caches: {}, after: {}, fled: {}, next: 0 }, true);
		// a reload mid-trek wakes at home: craftsmen out with the wanderer wait where they were found
		var fled = $SM.get('game.armies.fled') || {};
		for (var id in fled) if (fled[id].party === 'with') fled[id].party = 'waiting';
		Armies._after = $SM.get('game.armies.after');
		// a siege whose end was not yet told when the game was saved tells it again
		Armies.list().forEach(function (a) { if (a.siege && a.siege.over) Armies.tellEnd(a); });
		Armies.adapt();
		$.Dispatch('stateUpdate').subscribe(Armies.handleStateUpdates);
		Armies.scheduleTick();
	},

	/*
	 * Adapters (city.js and world.js are not changed): a taken city's jobs run slower while the loss wears
	 * off; the map shows armies, caches and the craftsmen's hex through the city-states' glyphs and lines;
	 * the trek's steps, falls and homecomings reach the craftsmen and the caches.
	 */
	adapt: function () {
		var share = City.jobShare, CS = CityStates;
		// (asked per job of every city on each fire tick: the table is held, not looked up)
		City.jobShare = function (cityId) {
			var after = Armies._after && Armies._after[cityId];
			return after ? share.apply(City, arguments) * Armies.output(after) : share.apply(City, arguments);
		};
		var glyph = CS.glyphAt, label = CS.label, step = CS.onStep, die = CS.onDie, home = CS.onHome;
		var pName = CS.partyName, pBack = CS.partyBack;
		// (the map asks per hex drawn: one lookup kept by Armies.marks)
		CS.glyphAt = function (x, y) {
			var m = Armies._marks === undefined ? Armies.marks() : Armies._marks;
			if (m) {
				var k = m[x + ',' + y];
				if (k) return k === 'army' ? [Armies.GLYPH, true] : k === 'cache' ? [World.PACK_GLYPH, true] : [World.hex.gen.terrain[x][y], true];
			}
			return glyph.call(CS, x, y);
		};
		CS.label = function (x, y) {
			var m = Armies.marks();
			return (m && m[x + ',' + y] && Armies.label(x, y)) || label.apply(CS, arguments);
		};
		CS.onStep = function (x, y) {
			Armies.onStep(x, y);
			return step.apply(CS, arguments);
		};
		CS.onDie = function () {
			Armies.onDie();
			return die.apply(CS, arguments);
		};
		CS.onHome = function () {
			Armies.onHome();
			return home.apply(CS, arguments);
		};
		CS.partyName = function (pack) {
			return pack.party.craftsmen ? _('craftsmen') : pName.apply(CS, arguments);
		};
		CS.partyBack = function (pack) {
			return pack.party.craftsmen ? Armies.craftsmenBack(pack) : pBack.apply(CS, arguments);
		};
	},

	get: function (k) {
		return $SM.get('game.armies' + (k ? '.' + k : ''));
	},

	list: function () {
		return Armies.get('list') || [];
	},

	byId: function (id) {
		return Armies.list().filter(function (a) { return a.id === id; })[0] || null;
	},

	set: function (army) {
		var list = Armies.list(), i = list.indexOf(army);
		$SM.set('game.armies.list[' + i + ']', army, true);
	},

	trained: function (cityId) {
		return $SM.get('game.armies.trained["' + cityId + '"]', true);
	},

	// soldiers a city can hold: 10 for each walls district it has
	room: function (cityId) {
		return Armies.PER_WALLS * City.districtHexes(cityId, 'walls').length;
	},

	// soldiers of a city, at home and out with its army
	strength: function (cityId) {
		var n = Armies.trained(cityId);
		Armies.list().forEach(function (a) { if (a.from === cityId) n += Armies.soldiers(a); });
		return n;
	},

	armyOf: function (cityId) {
		return Armies.list().filter(function (a) { return a.from === cityId; })[0] || null;
	},

	// what the army marches on: a city-state, or a power (Powers.target: { id, name, at, band }); null when none
	target: function (a) {
		return a.power ? Powers.target(a.power) : a.to ? CityStates.byId(a.to) : null;
	},

	// it is ours (taken) or broken already, or gone
	taken: function (a) {
		var t = Armies.target(a);
		return !t || (a.power ? Powers.broken(a.power) : !!CityStates.state(t.id).city);
	},

	armyAt: function (x, y) {
		return Armies.list().filter(function (a) { return a.at[0] === x && a.at[1] === y; })[0] || null;
	},

	cacheAt: function (x, y) {
		var c = Armies.get('caches') || {};
		for (var k in c) if (c[k].at[0] === x && c[k].at[1] === y && Armies.cacheLeft(c[k])) return k;
		return null;
	},

	// what armies put on the map, by hex: 'army', 'cache' or 'fled'; null when nothing (rebuilt on a change)
	marks: function () {
		if (Armies._marks !== undefined) return Armies._marks;
		var m = {}, any = false, caches = Armies.get('caches') || {}, fled = Armies.get('fled') || {};
		var put = function (at, k) { if (at && !m[at[0] + ',' + at[1]]) { m[at[0] + ',' + at[1]] = k; any = true; } };
		Armies.list().forEach(function (a) { put(a.at, 'army'); });
		for (var c in caches) if (Armies.cacheLeft(caches[c])) put(caches[c].at, 'cache');
		for (var f in fled) if (fled[f].party === 'waiting') put(fled[f].at, 'fled');
		Armies._marks = any ? m : null;
		return Armies._marks;
	},

	cacheLeft: function (cache) {
		var out = {}, any = false;
		for (var k in cache.items) {
			var n = Math.floor(cache.items[k] * cache.left);
			if (n > 0) {
				out[k] = n;
				any = true;
			}
		}
		return any ? out : null;
	},

	fledAt: function (x, y) {
		var f = Armies.get('fled') || {};
		for (var k in f) if (f[k].party === 'waiting' && f[k].at && f[k].at[0] === x && f[k].at[1] === y) return k;
		return null;
	},

	label: function (x, y) {
		var a = Armies.armyAt(x, y), nb = CityStates.nb;
		if (a) {
			var city = $SM.get('game.cities["' + a.from + '"]');
			return nb(_('the army of {0}.', city ? city.name : '')) + ' ' + nb(Armies.men(Armies.soldiers(a)) + '.');
		}
		var k = Armies.cacheAt(x, y);
		if (k) {
			var left = Armies.cacheLeft(Armies.get('caches')[k]);
			return nb(_("an army's baggage.")) + ' ' + Object.keys(left).map(function (g) { return nb(_(g) + ' ' + left[g]); }).join(' ');
		}
		var f = Armies.fledAt(x, y);
		if (f) return nb(CityStates.fill(_('the craftsmen of {name}.'), CityStates.byId(f)));
		return null;
	},

	/*
	 * The tick: every Fire.TICK (10 s), after the hearths. All writes quiet, one update at the end.
	 */
	scheduleTick: function () {
		Armies._tickTimeout = Engine.setTimeout(Armies.doTick, Fire.TICK * 1000);
	},

	doTick: function () {
		Armies.update();
		Armies.scheduleTick();
	},

	update: function () {
		if (!$SM.get('game.armies')) return;
		delete Armies._marks;
		var moved = false;
		Armies.drill();
		Armies.list().slice().forEach(function (a) {
			if (a.state === 'march') moved = Armies.march(a) || moved;
			else if (a.state === 'siege') Armies.besiege(a);
		});
		// the production losses wear off
		var after = Armies.get('after') || {};
		for (var id in after) {
			if (after[id].left <= 1) $SM.remove('game.armies.after["' + id + '"]', true);
			else $SM.set('game.armies.after["' + id + '"].left', after[id].left - 1, true);
		}
		Armies._after = $SM.get('game.armies.after');
		if (moved && World.hex && typeof Network != 'undefined') Network.draw();
		CityStates.playQueued();
		$SM.fireUpdate('game.armies');
	},

	// military-focus cities train their idle people, a soldier every TRAIN_TICKS, up to their walls' room
	drill: function () {
		var cities = $SM.get('game.cities') || {};
		for (var id in cities) {
			var path = 'game.armies.drill["' + id + '"]';
			if (cities[id].focus !== 'military' || City.getNumIdle(id) < 1 || Armies.strength(id) >= Armies.room(id)) {
				if ($SM.get(path)) $SM.set(path, 0, true);
				continue;
			}
			var n = $SM.get(path, true) + 1;
			if (n < Armies.TRAIN_TICKS) {
				$SM.set(path, n, true);
				continue;
			}
			$SM.set(path, 0, true);
			$SM.add(City.path(id, 'population.citizens'), -1, true);
			var first = !Armies.strength(id);
			$SM.set('game.armies.trained["' + id + '"]', Armies.trained(id) + 1, true);
			if (first) Notifications.notify(null, _('{0} drills its first soldiers by the wall.', City.callName(id)));
			$SM.fireUpdate('game.cities["' + id + '"]', true);
		}
	},

	/*
	 * The march order: a city's soldiers, outfitted from its stores, set out for a city-state's walls.
	 */
	// why a city can't march on a city-state now, or null
	cantMarch: function (cityId, c) {
		var st = CityStates.state(c.id);
		if (st.city) return _("they're yours.");
		if (!st.met) return _("they don't know you.");
		if (Armies.armyOf(cityId)) return _('the army is already out');
		if (Armies.trained(cityId) < 1) return _('no soldiers');
		if (!Armies.soldiersArmed(cityId)) return _('no weapons');
		if (Armies.list().some(function (a) { return a.to === c.id; })) return _('an army is already there');
		return null;
	},

	soldiersArmed: function (cityId) {
		var o = Armies.outfit(Armies.trained(cityId), function (k) { return $SM.get(City.storePath(cityId, k), true); });
		return Object.keys(o.squads).length > 0;
	},


	lit: function () {
		var fire = World.hex.fire, cols = World.hex.gen.cols;
		return function (x, y) { return !!(fire && fire.lit[x + y * cols]); };
	},

	marchOn: function (cityId, csId) {
		var A = Armies, c = CityStates.byId(csId), why = A.cantMarch(cityId, c);
		if (why) {
			Notifications.notify(City, why);
			return false;
		}
		return A.send(cityId, c, { to: csId });
	},

	// the march itself, on a target { at, name } (a city-state or a power); extra: the army's own fields
	send: function (cityId, c, extra) {
		var A = Armies;
		// lit land, off the beacons' own hexes (where the map shows the beacon, not the army), and off a site
		var lit = A.lit(), from = $SM.get(City.path(cityId, 'hex'));
		var camp = A.campFor(World.hex.gen, c, from, function (x, y) {
			return (lit(x, y) ? (Network.beaconAt(x, y) ? 1 : 2) : 0) - (extra.power && World.siteAt(x, y) ? 3 : 0);
		});
		var path = camp && A.route(World.hex.gen, from, camp, A.lit());
		if (!path) {
			Notifications.notify(City, _('there is no way there on foot.'));
			return false;
		}
		var n = A.trained(cityId), o = A.outfit(n, function (k) { return $SM.get(City.storePath(cityId, k), true); });
		var armed = 0;
		for (var w in o.squads) armed += o.squads[w];
		var steps = path.reduce(function (s, p) { return s + A.moveCost(World.hex.gen, p[0], p[1]); }, 0);
		var food = Math.min(Math.floor($SM.get(City.storePath(cityId, 'cured meat'), true)), A.foodFor(armed, steps));
		o.take['cured meat'] = food;
		var mod = {};
		for (var k in o.take) mod[k] = $SM.get(City.storePath(cityId, k), true) - o.take[k];
		$SM.setM(City.storesPath(cityId), mod);
		$SM.set('game.armies.trained["' + cityId + '"]', n - armed, true);
		var id = 'army' + ($SM.get('game.armies.next', true) + 1);
		$SM.set('game.armies.next', $SM.get('game.armies.next', true) + 1, true);
		var army = {
			id: id, from: cityId, to: null, power: null, squads: o.squads, ammo: o.ammo, gear: o.gear, food: food,
			water: armed * A.WATER_EACH, at: from.slice(), path: path, moves: 0, due: { food: 0, lost: 0 },
			state: 'march', home: false, siege: null, loot: {}, warned: false
		};
		$.extend(army, extra);
		$SM.set('game.armies.list[' + A.list().length + ']', army, true);
		Notifications.notify(null, CityStates.fill(_('the army marches on {name}.'), c));
		Engine.event('progress', 'army marched');
		$SM.fireUpdate('game.armies');
		if (typeof Network != 'undefined') Network.draw();
		return true;
	},

	// a march tick: a move point, spent on the next hex when it is enough. true if it moved
	march: function (a) {
		var A = Armies, gen = World.hex.gen, moved = false;
		a.moves += 1;
		while (a.path.length && a.moves >= A.moveCost(gen, a.path[0][0], a.path[0][1]) && A.soldiers(a) > 0) {
			var next = a.path.shift();
			a.moves -= A.moveCost(gen, next[0], next[1]);
			A.supply(a, next, A.moveCost(gen, next[0], next[1]));
			a.at = next.slice();
			moved = true;
			A.pickUp(a);
		}
		if (!A.soldiers(a)) return A.lostArmy(a) || moved;
		if (!a.path.length) A.arrive(a);
		else A.set(a);
		return moved;
	},

	// what a hex costs the army (POWERS §1 table); without water or food, soldiers slip away
	supply: function (a, at, cost) {
		var A = Armies, n = A.soldiers(a), lit = A.lit()(at[0], at[1]);
		var need = A.stepNeeds(n, lit, World.dangerAt(at[0], at[1]), cost);
		a.due.food += need.food;
		var food = Math.floor(a.due.food);
		a.due.food -= food;
		var short = a.water < need.water || a.food < food;
		a.water = Math.max(0, a.water - need.water);
		a.food = Math.max(0, a.food - food);
		if (short) {
			A.kill(a, Math.max(1, A.DESERT * n));
			Notifications.notify(null, _('soldiers slip away from the army in the night. there is nothing to eat or drink.'));
		} else if (need.stragglers) {
			a.due.lost += need.stragglers;
			var lost = Math.floor(a.due.lost);
			if (lost) {
				a.due.lost -= lost;
				A.kill(a, lost);
				Notifications.notify(null, _('stragglers fall behind the army. no one goes back for them.'));
			}
		}
		// the thirst warning comes a step early, as on the wanderer's rough ground
		var next = A.stepNeeds(A.soldiers(a), lit, World.dangerAt(at[0], at[1]), cost);
		if (!a.warned && (a.water < next.water || a.food < next.food)) {
			a.warned = true;
			Notifications.notify(null, _("the army's water and meat won't last another day."));
		} else if (a.warned && a.water >= next.water && a.food >= next.food) {
			a.warned = false;
		}
	},

	// an army marching over a cache takes back what the scavengers left
	pickUp: function (a) {
		var k = Armies.cacheAt(a.at[0], a.at[1]);
		if (!k) return;
		var left = Armies.cacheLeft(Armies.get('caches')[k]);
		for (var g in left) {
			if (g === 'cured meat') a.food += left[g];
			else if (Armies.GEAR[g]) a.gear[g] = (a.gear[g] || 0) + left[g];
			else a.ammo[g] = (a.ammo[g] || 0) + left[g];
		}
		$SM.remove('game.armies.caches["' + k + '"]', true);
		Notifications.notify(null, _('the army finds its old baggage. takes what the scavengers left.'));
	},

	arrive: function (a) {
		var A = Armies;
		if (a.home) return A.disband(a);
		var c = A.target(a);
		if (A.taken(a)) {
			a.state = 'camp';
			a.to = a.power = null;
			A.set(a);
			return;
		}
		// invest: the camp is pitched, both sides' clocks start
		a.state = 'siege';
		a.siege = a.power ? Powers.newSiege(a.power, A.soldiers(a)) : A.newSiege(c.band, A.soldiers(a));
		a.siege.asked = 0;
		A.set(a);
		Engine.event('progress', 'siege');
		CityStates.queue(function () { Events.startEvent(Events.Armies.camp(a.id)); });
	},

	// a siege tick at the walls (POWERS §1 Option B 2-4)
	besiege: function (a) {
		var A = Armies, c = A.target(a), s = a.siege;
		if (A.taken(a)) {
			A.fallBack(a, true);
			return;
		}
		if (s.over) return; // the storm's scene is waiting
		A.supply(a, a.at, 1);
		if (!A.soldiers(a)) return A.lostArmy(a);
		if (a.power) Powers.prepare(a);
		var r = A.siegeTick(s, a, Math.random());
		if (!A.soldiers(a)) return A.lostArmy(a);
		if (r.sally) CityStates.queue(function () { Events.startEvent(Events.Armies.sally(c, r.sally)); });
		if (r.breach && a.power) {
			// a power's storm is a fight the wanderer leads (Powers.onStep): it waits for them
			s.over = { breach: true };
		} else if (r.breach) {
			s.stormed = A.soldiers(a);
			s.over = { storm: A.storm(s, a) };
		} else if (r.yield) {
			s.over = { yield: true };
		} else if (r.broken) {
			s.stormed = s.invested;
			s.over = { broken: true };
		}
		if (s.over) {
			A.set(a);
			A.tellEnd(a);
			return;
		}
		// the camp's choices, every few ticks (one at a time: they wait while the wanderer is out)
		if (s.ticks - s.asked >= A.CHOICE_EVERY && !A._asking[a.id]) {
			s.asked = s.ticks;
			A._asking[a.id] = true;
			CityStates.queue(function () {
				A._asking[a.id] = false;
				var now = A.byId(a.id);
				if (now && now.state === 'siege' && !now.siege.over) Events.startEvent(Events.Armies.camp(a.id));
			});
		}
		A.set(a);
	},
	_asking: {},

	// the siege's end, told by its scene: the storm, they yield, or the army breaks under the walls
	tellEnd: function (a) {
		if (a.power) return Powers.tellEnd(a);
		var o = a.siege.over, id = a.id;
		CityStates.queue(function () {
			if (!Armies.byId(id)) return;
			Events.startEvent(o.storm ? Events.Armies.storm(id, o.storm) : o.yield ? Events.Armies.yielded(id) : Events.Armies.broken(id));
		});
	},

	// press / wait (the camp's choice, or the panel's)
	stance: function (id, stance) {
		var a = Armies.byId(id);
		if (!a || a.state !== 'siege') return;
		a.siege.stance = stance;
		Armies.set(a);
		$SM.fireUpdate('game.armies');
	},

	// the army leaves the walls for the nearest lit hex and camps there
	fallBack: function (a, quiet) {
		var A = Armies, lit = A.lit(), gen = World.hex.gen, best = null;
		if (typeof a == 'string') a = A.byId(a);
		if (!a || (a.siege && a.siege.over && !quiet)) return;
		for (var r = 0; r <= 20 && !best; r++) {
			(r ? Fire.ring(a.at[0], a.at[1], r) : [a.at]).forEach(function (p) {
				if (!best && p[0] >= 0 && p[1] >= 0 && p[0] < gen.cols && p[1] < gen.rows && lit(p[0], p[1]) && WorldGen.isPassable(gen.terrain[p[0]][p[1]])) best = p;
			});
		}
		a.siege = null;
		a.to = a.power = null;
		a.state = 'march';
		a.path = best ? (A.route(gen, a.at, best, lit) || []) : [];
		if (!a.path.length) a.state = 'camp';
		A.set(a);
		if (!quiet) Notifications.notify(null, _('the army falls back to the light.'));
		$SM.fireUpdate('game.armies');
	},

	// the camped army goes home
	goHome: function (id) {
		var A = Armies, a = A.byId(id);
		if (!a || a.state === 'siege') return false;
		var home = $SM.get(City.path(a.from, 'hex')) || $SM.get(City.path(City.CAPITAL, 'hex'));
		a.path = A.route(World.hex.gen, a.at, home, A.lit()) || [];
		a.home = true;
		a.state = 'march';
		A.set(a);
		if (!a.path.length) A.disband(a);
		$SM.fireUpdate('game.armies');
		return true;
	},

	// home: the soldiers, their weapons and what they carry go back into their city
	disband: function (a) {
		var A = Armies, cityId = $SM.get('game.cities["' + a.from + '"]') ? a.from : City.CAPITAL, back = {};
		var add = function (k, n) { if (n > 0) back[k] = (back[k] || 0) + Math.floor(n); };
		for (var w in a.squads) {
			var s = A.squadOf(w);
			if (!s.thrown) add(w, a.squads[w]);
		}
		for (var m in a.ammo) add(m, a.ammo[m]);
		for (var g in a.gear) add(g, a.gear[g]);
		add('cured meat', a.food);
		for (var l in a.loot) add(l, a.loot[l]);
		$SM.addM(City.storesPath(cityId), back);
		$SM.set('game.armies.trained["' + cityId + '"]', A.trained(cityId) + A.soldiers(a), true);
		A.remove(a);
		Notifications.notify(null, _('the army comes home.'));
	},

	remove: function (a) {
		$SM.set('game.armies.list', Armies.list().filter(function (x) { return x.id !== a.id; }), true);
	},

	lostArmy: function (a) {
		Armies.remove(a);
		Notifications.notify(null, _('the army is gone. no one comes home.'));
		return true;
	},

	/*
	 * How a siege ends (the scenes in script/events/armies.js call these)
	 */
	// the storm won: the city-state is ours, taken or sacked
	take: function (id, sack) {
		var A = Armies, a = A.byId(id), c = a && CityStates.byId(a.to);
		if (!c || CityStates.state(c.id).city) return null;
		if (sack) {
			var loot = CityStates.joinStores();
			for (var k in loot) a.loot[k] = (a.loot[k] || 0) + loot[k] * (1 + c.band);
		}
		return A.won(a, c, sack ? 'sack' : 'force');
	},

	// their stores are gone: they yield
	yieldTo: function (id) {
		var a = Armies.byId(id), c = a && CityStates.byId(a.to);
		if (!c || CityStates.state(c.id).city) return null;
		return Armies.won(a, c, 'yield');
	},

	won: function (a, c, how) {
		var A = Armies, cityId = CityStates.join(c, 'force'), M = A.AFTERMATH[how];
		var ticks = Math.round(M.minutes * 60 / Fire.TICK);
		$SM.set('game.armies.after["' + cityId + '"]', { loss: M.loss, ticks: ticks, left: ticks }, true);
		if (CityStates.story(c.t)) A.flee(c);
		a.siege = null;
		a.to = null;
		a.state = 'camp';
		A.set(a);
		Engine.event('progress', 'city-state taken');
		$SM.fireUpdate('game.armies');
		return cityId;
	},

	// the storm lost: the army is cut to the survivors, who walk back to the light; its baggage stays
	rout: function (id) {
		var A = Armies, a = A.byId(id);
		if (!a) return 0;
		var s = a.siege, start = s.stormed || A.soldiers(a);
		var left = Math.min(A.soldiers(a), A.routed(start, s.garrison, s.garrisonMax));
		A.kill(a, A.soldiers(a) - left);
		var items = {};
		for (var m in a.ammo) if (a.ammo[m] > 0) items[m] = a.ammo[m];
		for (var g in a.gear) if (a.gear[g] > 0) items[g] = a.gear[g];
		if (a.food > 0) items['cured meat'] = a.food;
		a.ammo = {};
		a.gear = {};
		a.food = 0;
		if (Object.keys(items).length) $SM.set('game.armies.caches["' + a.id + '"]', { at: a.at.slice(), items: items, left: 1 }, true);
		if (!left) return A.lostArmy(a) && 0;
		A.set(a);
		A.fallBack(a, true);
		return left;
	},

	/*
	 * The craftsmen (PHASE4 Q1 b, content 3.5): a story city-state taken by force keeps its beat back
	 * until a trek finds the ones who knew the craft and brings them home.
	 */
	flee: function (c) {
		var at = Armies.fleeSite(World.hex.gen, c, CityStates.list());
		// shortcut: a world with no free land in reach of them to hide on; the beat plays now
		if (!at) {
			CityStates.extras(c);
			CityStates.beat(c);
			return;
		}
		$SM.set('game.armies.fled["' + c.id + '"]', { at: at, party: 'waiting', people: Armies.CRAFTSMEN, food: 0, water: 0 }, true);
		World.hex.mask[at[0]][at[1]] = true;
		if (World.state) World.state.mask[at[0]][at[1]] = true;
		else World.saveHex(World.worldFlags());
		Notifications.notify(null, CityStates.fill(_('the craftsmen of {name} have fled'), c));
	},

	onStep: function (x, y) {
		var A = Armies, fled = A.get('fled') || {};
		delete A._marks;
		// the caches are thinned by the scavengers a step the wanderer walks, like the pack
		var caches = A.get('caches') || {};
		for (var k in caches) {
			var left = caches[k].left * (1 - Danger.scavengeRate(World.dangerAt(caches[k].at[0], caches[k].at[1])));
			if (!A.cacheLeft({ items: caches[k].items, left: left })) $SM.remove('game.armies.caches["' + k + '"]', true);
			else $SM.set('game.armies.caches["' + k + '"].left', left, true);
		}
		for (var id in fled) {
			var f = fled[id], path = 'game.armies.fled["' + id + '"]';
			if (f.party === 'with') A.craftsmenEat(id, f);
			else if (f.party === 'waiting' && f.at && f.at[0] === x && f.at[1] === y) {
				$SM.set(path + '.party', 'with', true);
				Notifications.notify(World, _('the craftsmen fall in behind.'));
			}
		}
	},

	// they eat and drink from the trek's supplies as the wanderer does, one share each (as the find party)
	craftsmenEat: function (id, f) {
		var path = 'game.armies.fled["' + id + '"]', food = (f.food || 0) + 1, water = (f.water || 0) + 1;
		if (food >= World.MOVES_PER_FOOD * ($SM.hasPerk('slow metabolism') ? 2 : 1)) {
			food = 0;
			Path.outfit['cured meat'] = Math.max(0, (Path.outfit['cured meat'] || 0) - f.people);
		}
		if (water >= World.MOVES_PER_WATER * ($SM.hasPerk('desert rat') ? 2 : 1)) {
			water = 0;
			World.setWater(Math.max(0, World.water - f.people));
		}
		$SM.set(path + '.food', food, true);
		$SM.set(path + '.water', water, true);
		World.updateSupplies();
	},

	// the trek falls: they wait by the dropped pack, thinned like lost settlers; a second fall loses them
	onDie: function () {
		var fled = Armies.get('fled') || {};
		for (var id in fled) {
			var f = fled[id];
			if (f.party !== 'with') continue;
			if (f.picked) {
				Armies.craftsmenGone(id);
				continue;
			}
			var pack = $SM.get('game.world.pack') || { at: World.curPos.slice(), items: {}, left: 1 };
			pack.party = { cs: id, people: f.people, craftsmen: true };
			$SM.set('game.world.pack', pack);
			$SM.set('game.armies.fled["' + id + '"].party', 'fallen', true);
		}
	},

	craftsmenBack: function (pack) {
		var id = pack.party.cs, n = CityStates.partyLeft(pack), path = 'game.armies.fled["' + id + '"]';
		if (!$SM.get(path)) return;
		if (!n) return Armies.craftsmenGone(id);
		$SM.set(path + '.party', 'with', true);
		$SM.set(path + '.people', n, true);
		$SM.set(path + '.picked', true, true);
		Notifications.notify(World, _('the craftsmen fall in behind.'));
	},

	// lost: the find quest's fail line; they hide again where they were first found
	craftsmenGone: function (id) {
		var path = 'game.armies.fled["' + id + '"]';
		$SM.set(path + '.party', 'waiting', true);
		$SM.set(path + '.people', Armies.CRAFTSMEN, true);
		$SM.set(path + '.picked', false, true);
		Notifications.notify(null, _('the lost party is gone. scavengers got there first.'));
	},

	// home with the trek: the craftsmen show the craft; the city-state's beat plays now
	onHome: function () {
		var fled = Armies.get('fled') || {};
		for (var id in fled) {
			if (fled[id].party !== 'with') continue;
			var c = CityStates.byId(id);
			$SM.remove('game.armies.fled["' + id + '"]', true);
			CityStates.queue(function () { Events.startEvent(Events.Armies.craftsmen(c)); });
		}
	},

	/*
	 * Siege gear, built in a military-focus city from its stores
	 */
	buildGear: function (cityId, item) {
		if (!Network.pay(cityId, Armies.GEAR[item])) return false;
		$SM.add(City.storePath(cityId, item), 1);
		AudioEngine.playSound(AudioLibrary.BUILD);
		return true;
	},

	/*
	 * The town panel: the active city's soldiers, its gear, and its army in the field.
	 */
	status: function (a) {
		var c = Armies.target(a), n = Armies.soldiers(a);
		if (a.state === 'siege' && c) {
			var s = a.siege;
			return CityStates.fill(_('the army is camped below the walls of {name}. {n}. walls {w}. their stores {s}.'), c,
				{ n: Armies.men(n), w: Math.ceil(s.walls), s: s.stores });
		}
		if (a.state === 'march') {
			if (a.home) return _('the army is marching home. {0}.', Armies.men(n));
			if (c) return CityStates.fill(_('the army is on the march to {name}. {n}. {h} hexes to go.'), c, { n: Armies.men(n), h: a.path.length });
			return _('the army falls back to the light. {0}.', Armies.men(n));
		}
		return _('the army is camped. {0}.', Armies.men(n));
	},

	updatePanel: function () {
		if (!City.panel || !$SM.get('game.armies')) return;
		var A = Armies, cityId = City.activeCity, city = $SM.get('game.cities["' + cityId + '"]');
		var box = $('#cityArmies'), a = A.armyOf(cityId), military = city && city.focus === 'military';
		if (!city || (!military && !A.strength(cityId))) {
			box.remove();
			return;
		}
		if (!box.length) {
			box = $('<div>').attr({ id: 'cityArmies', 'data-legend': _('the army') });
			// under the land, above the city-states it marches on
			if ($('#cityStates').length) box.insertBefore('#cityStates');
			else box.appendTo($('#cityLand').length ? '#cityLand' : City.panel);
		}
		var key = JSON.stringify([cityId, military, A.trained(cityId), A.room(cityId), a && [A.status(a), a.state, a.siege && a.siege.stance], Powers.key(cityId)]);
		if (box.attr('data-key') === key) return;
		box.attr('data-key', key).empty();
		$('<div>').attr('id', 'armySoldiers').addClass('csLine').text(_('soldiers at home {0}. room for {1}.', A.trained(cityId), A.room(cityId))).appendTo(box);
		if (military && !A.room(cityId)) $('<div>').addClass('csLine').text(_('soldiers drill by a wall. the town has none.')).appendTo(box);
		if (military) {
			for (var g in A.GEAR) {
				(function (g) {
					new Button.Button({
						id: 'army_gear_' + g.replace(/ /g, '-'), text: _(g), width: '80px', cost: A.GEAR[g],
						click: function () { A.buildGear(City.activeCity, g); }
					}).appendTo(box);
				})(g);
			}
		}
		if (a) {
			$('<div>').attr('id', 'armyStatus').addClass('csLine').text(A.status(a)).appendTo(box);
			if (a.power && a.siege && a.siege.over && a.siege.over.breach) $('<div>').addClass('csLine').text(_('the army waits for the wanderer.')).appendTo(box);
			if (a.state === 'siege') {
				new Button.Button({ id: 'army_press', text: _('press the walls'), width: '80px', click: function () { A.stance(a.id, 'press'); } }).appendTo(box);
				new Button.Button({ id: 'army_wait', text: _('wait them out'), width: '80px', click: function () { A.stance(a.id, 'wait'); } }).appendTo(box);
				new Button.Button({ id: 'army_fallback', text: _('fall back'), width: '80px', click: function () { A.fallBack(a.id); } }).appendTo(box);
				Button.setDisabled($('#army_press'), a.siege.stance === 'press');
				Button.setDisabled($('#army_wait'), a.siege.stance === 'wait');
			} else if (a.state === 'camp') {
				new Button.Button({ id: 'army_home', text: _('march home'), width: '80px', click: function () { A.goHome(a.id); } }).appendTo(box);
			}
		}
		// the powers it can march on (script/powers.js)
		Powers.actions(cityId, box);
		$('<div>').addClass('clear').appendTo(box);
	},

	// the city-state panel's action for force: march the selected city's soldiers on them
	actions: function (c, box) {
		var A = Armies, cityId = City.activeCity;
		if (!A.trained(cityId) && !A.armyOf(cityId)) return;
		var why = A.cantMarch(cityId, c);
		var b = new Button.Button({
			id: 'cs_march', text: _('march on them'), width: '80px',
			click: function () { A.marchOn(City.activeCity, c.id); }
		}).appendTo(box);
		Button.setDisabled(b, !!why);
		if (why) $('<div>').addClass('csLine').text(why).appendTo(box);
	},

	handleStateUpdates: function (e) {
		if (!e.stateName) return;
		if (e.stateName.indexOf('game.armies') === 0) {
			delete Armies._marks;
			Armies._after = $SM.get('game.armies.after');
		}
		if (e.stateName.indexOf('game.armies') === 0 || e.stateName.indexOf('game.cities') === 0 || e.stateName.indexOf('game.powers') === 0 || e.category == 'stores') {
			Armies.updatePanel();
		}
		// the city-state rows carry the march button
		if (e.stateName.indexOf('game.armies') === 0 && CityStates.selected) {
			$('#cityStates').removeAttr('data-key');
			CityStates.updatePanel();
		}
	}
});
