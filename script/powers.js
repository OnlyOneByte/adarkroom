/**
 * The war-remnant powers (Phase 6: design/drafts/POWERS.md, approved; DESIGN.md "Powers"; LADDERS.md).
 *
 * A power is passive and yields only to force. Each is one entry in Powers.LIST, so the powers after the
 * first are content: its site, its walls and garrison (POWERS §3), its puzzle (the hooks a siege and a trek
 * call), its storm (an original-style fight the wanderer leads, with the army's squads as weapon buttons)
 * and its aftermath (the ladder beat it unlocks, Fire.unlock). The march and the siege are the armies'
 * (script/armies.js, a.power on the army); powers never return once broken (POWERS §5 Q10).
 *
 * The first power is the garrison of the deep mines (F8 coal). Its puzzle: the stockade is fed through
 * three adits; while one is open the siege can't starve them (POWERS §2), and the shafts can't be stormed
 * without a lit beacon next to the site (design/text/flame-draft.md, "Into the Shafts").
 *
 * The rules at the top are pure (no DOM, no state), so the simulator (tools/sim-powers.js) loads this file
 * too. Every number is provisional, tuned with `npm run sim`.
 *
 * Saved state, game.powers:
 *   <power id>  { broken, way (the aftermath's choice), adits [[x, y]], closed { 'x,y': true } }
 */
var Powers = {
	// the powers, in the order they are met (POWERS §2: #1 is fixed first, #8 last)
	LIST: [
		{
			id: 'garrison', name: _('the garrison of the deep mines'), unlock: 'F8',
			// its Π: the flame era's choice (Network.garrison); armies may march on it once its gate is met
			anchor: function () { return $SM.get('game.network.garrison'); },
			known: function () { return Network.flag('gateMet'); },
			// POWERS §3, band 1-2: garrison 40, rifles with few bullets, 300 of timber walls, 60 ticks of stores
			garrison: 40, walls: 300, kind: 'timber', stores: 60,
			might: 0.5,            // provisional: damage a defender a second (a city-state's at band 1-2 is 0.45-0.6)
			adits: 3,              // POWERS §2: the stockade is fed through 3 adits
			// the storm (POWERS §1 Option C): the original's soldier, rifle in hand
			storm: { chara: 'D', damage: 5, hit: 0.4, delay: 2 },  // provisional: the rifle's damage, few bullets
			joiners: 10            // provisional: soldiers who join you when you take them in (flame-draft scene 4)
		}
	],

	byId: function (id) {
		return Powers.LIST.filter(function (p) { return p.id === id; })[0] || null;
	},

	// a power's siege at the walls (pure): Armies.siegeTick runs it, with the power's own might
	newSiege: function (id, soldiers) {
		var P = Powers.byId(id);
		return {
			band: 0, might: P.might, walls: P.walls, wallsMax: P.walls, kind: P.kind,
			garrison: P.garrison, garrisonMax: P.garrison, stores: P.stores,
			sallies: 0, ticks: 0, stance: 'press', invested: soldiers
		};
	},

	// the adits (pure): the site's hexes furthest from its gate (the anchor) first; a small site's next ones
	// are the open ground around it
	aditsOf: function (gen, site, n) {
		var key = function (h) { return h[0] * gen.rows + h[1]; };
		var far = function (a, b) { return WorldGen.distance(b, site.anchor) - WorldGen.distance(a, site.anchor) || key(a) - key(b); };
		var own = site.hexes.filter(function (h) { return h[0] !== site.anchor[0] || h[1] !== site.anchor[1]; }).sort(far);
		var out = own.slice(0, n), seen = {};
		site.hexes.forEach(function (h) { seen[key(h)] = true; });
		site.hexes.forEach(function (h) {
			for (var d = 0; d < 6 && out.length < n; d++) {
				var p = WorldGen.neighbour(h[0], h[1], d);
				if (p[0] < 0 || p[1] < 0 || p[0] >= gen.cols || p[1] >= gen.rows || seen[key(p)]) continue;
				seen[key(p)] = true;
				if (WorldGen.isPassable(gen.terrain[p[0]][p[1]]) && gen.terrain[p[0]][p[1]] !== WorldGen.TERRAIN.ocean) out.push(p);
			}
		});
		return out;
	},

	/*
	 * The storm (pure pieces the fight and the simulator share). The garrison is one block on the fight
	 * screen, HP a man; each squad is a weapon button: a volley = the weapon's damage × its soldiers with a
	 * shot left, on the weapon's cooldown. Each of their attacks finds the army: men standing × might ×
	 * delay, in soldiers' health (mantlets halve it, as at the walls).
	 */
	stormHp: function (siege) {
		return Math.max(1, Math.round(siege.garrison)) * Armies.HP;
	},

	// a squad's volley: { dmg (a number or 'stun'), n }; spends a shot a soldier
	volley: function (army, weapon) {
		var s = Armies.squadOf(weapon), n = army.squads[weapon] || 0;
		if (s && s.ammo) n = Math.min(n, (army.ammo || {})[s.ammo] || 0);
		if (n <= 0) return { dmg: 0, n: 0 };
		if (s && s.ammo) army.ammo[s.ammo] -= n;
		var W = World.Weapons[weapon] || {};
		return { dmg: W.damage === 'stun' ? 'stun' : (typeof W.damage == 'number' ? W.damage : 0) * n, n: n };
	},

	// their attack on the army, hp: what is left of the garrison's block. Returns the soldiers lost
	hitArmy: function (army, hp, P) {
		var men = Math.ceil(hp / Armies.HP);
		return Armies.kill(army, men * P.might * P.storm.delay / Armies.HP * Armies.shield(army));
	},

	// the storm fought as a player who fires every squad the moment it is ready (the simulator's, and the
	// numbers' check). Returns { won, seconds, start, left }
	autoStorm: function (P, siege, army) {
		var A = Armies, hp = Powers.stormHp(siege), start = A.soldiers(army), ready = {}, t = 0, step = 0.5;
		var stun = 0;
		for (; t < 600 && hp > 0 && A.soldiers(army) >= A.ROUT_AT * start; t += step) {
			for (var w in army.squads) {
				if ((ready[w] || 0) > t) continue;
				var v = Powers.volley(army, w);
				ready[w] = t + A.weapon(w).cd;
				if (v.dmg === 'stun') stun = t + 4;
				else hp -= v.dmg;
			}
			if (hp > 0 && t > 0 && Math.abs(t % P.storm.delay) < 1e-9 && t >= stun) Powers.hitArmy(army, hp, P);
		}
		siege.garrison = Math.max(0, hp / A.HP);
		return { won: hp <= 0, seconds: t, start: start, left: A.soldiers(army) };
	}
};

/*
 * The game side: state, the hooks the siege and the trek call, the fight. Nothing here runs at load.
 */
(function (game) {
	for (var k in game) Powers[k] = game[k];
})({
	init: function () {
		if (Powers._ready) return;
		Powers._ready = true;
		if (!$SM.get('game.powers')) $SM.set('game.powers', {}, true);
		// a reload mid-storm wakes at home: the storm waits for the wanderer again
		Armies.list().forEach(function (a) {
			if (a.power && a.siege && a.siege.over && a.siege.over.storming) {
				a.siege.over.storming = false;
				Armies.set(a);
			}
		});
		// a save from before the garrison moved (v2.8) picks it again; a marked one is seen where it now stands
		if (World.hex && Network.flag('smoke') && !$SM.get('game.network.garrison')) {
			var g = Network.garrison(), site = g && World.siteAt(g[0], g[1]);
			if (site && Network.flag('garrisonMarked')) {
				site.hexes.forEach(function (h) { World.uncoverMap(h[0], h[1], 0, World.hex.mask); });
				World.saveHex(World.worldFlags());
			}
		}
		Powers.adapt();
	},

	/*
	 * Adapters (world.js and the city-states' code are not changed): the trek's steps and falls reach the
	 * powers; a broken power's sphere no longer pulls; its site can be resettled; adits are named on hover.
	 */
	adapt: function () {
		var CS = CityStates, step = CS.onStep, die = CS.onDie, spheres = CS.spheres, note = Network.hexNote;
		CS.onStep = function (x, y) {
			Powers.onStep(x, y);
			return step.apply(CS, arguments);
		};
		CS.onDie = function () {
			Powers.onDie();
			return die.apply(CS, arguments);
		};
		CS.spheres = function () {
			return spheres.apply(CS, arguments).filter(function (p) { return !Powers.brokenAt(p.at); });
		};
		Network.hexNote = function (x, y) {
			return Powers.label(x, y) || note.apply(Network, arguments);
		};
	},

	state: function (id) {
		return $SM.get('game.powers["' + id + '"]') || {};
	},

	path: function (id) {
		return 'game.powers["' + id + '"]';
	},

	broken: function (id) {
		return !!Powers.state(id).broken;
	},

	// the power's site (its Π)
	site: function (id) {
		var P = Powers.byId(id), g = P && World.hex && P.anchor();
		return g ? World.siteAt(g[0], g[1]) : null;
	},

	// the power at this site anchor, broken
	brokenAt: function (at) {
		return Powers.LIST.some(function (P) {
			var s = Powers.broken(P.id) && Powers.site(P.id);
			return !!s && s.anchor[0] === at[0] && s.anchor[1] === at[1];
		});
	},

	// what an army marches on: { id, name, at, band }
	target: function (id) {
		var P = Powers.byId(id), s = Powers.site(id);
		return P && s ? { id: id, name: P.name, at: s.anchor, band: 0, power: true } : null;
	},

	// an army may march on it
	known: function (id) {
		var P = Powers.byId(id);
		return !!P && P.known() && !!Powers.site(id);
	},

	/*
	 * The garrison's puzzle: the adits
	 */
	adits: function (id) {
		var st = Powers.state(id);
		if (st.adits) return st.adits;
		var s = Powers.site(id);
		if (!s) return [];
		var list = Powers.aditsOf(World.hex.gen, s, Powers.byId(id).adits || 0);
		$SM.set(Powers.path(id) + '.adits', list, true);
		return list;
	},

	open: function (id) {
		var closed = Powers.state(id).closed || {};
		return Powers.adits(id).filter(function (h) { return !closed[h[0] + ',' + h[1]]; });
	},

	// { id (the power's), at, closed } of an adit on this hex, once its power is known
	aditAt: function (x, y) {
		for (var j = 0; j < Powers.LIST.length; j++) {
			var id = Powers.LIST[j].id;
			if (!Powers.LIST[j].adits || !Powers.known(id) || Powers.broken(id)) continue;
			var st = Powers.state(id), a = st.adits || Powers.adits(id);
			for (var i = 0; i < a.length; i++) {
				if (a[i][0] === x && a[i][1] === y) return { id: id, at: a[i], closed: !!(st.closed || {})[x + ',' + y] };
			}
		}
		return null;
	},

	// an adit blown in (a trek's charge, or the army's)
	collapse: function (id, at) {
		$SM.set(Powers.path(id) + '.closed["' + at[0] + ',' + at[1] + '"]', true);
		var left = Powers.open(id).length;
		Notifications.notify(null, left ? _('an adit is down. {0} still open.', left) : _('the last adit is down. nothing goes in to them now.'));
	},

	// the siege's hooks, each tick before Armies.siegeTick: still fed while an adit is open; the army's
	// charges are kept for the adits until they are all down
	prepare: function (a) {
		var open = Powers.open(a.power).length > 0;
		a.siege.supplied = open;
		a.siege.keep = open;
	},

	label: function (x, y) {
		var ad = Powers.aditAt(x, y);
		if (!ad) return '';
		return ad.closed ? _('a&nbsp;fallen&nbsp;adit') : _('an&nbsp;adit');
	},

	/*
	 * The siege's ends (Armies.tellEnd): the walls down (the storm waits for the wanderer), they starve
	 * (the captain), or the army breaks under the walls
	 */
	tellEnd: function (a) {
		var o = a.siege.over, id = a.id, P = Powers.byId(a.power);
		if (o.breach) {
			if (!o.told) {
				o.told = true;
				Armies.set(a);
				Notifications.notify(null, _('the walls of {0} are down. the army waits for the wanderer.', P.name));
			}
			return;
		}
		CityStates.queue(function () {
			if (!Armies.byId(id)) return;
			Events.startEvent(o.yield ? Events.Powers.yielded(id) : Events.Armies.broken(id));
		});
	},

	// out on a trek: an adit, or the army waiting at the broken walls
	onStep: function (x, y) {
		if (!$SM.get('game.powers') || Events.activeEvent()) return;
		var ad = Powers.aditAt(x, y);
		if (ad && !ad.closed) return Events.startEvent(Events.Powers.adit(ad.id, ad.at));
		Armies.list().forEach(function (a) {
			if (Events.activeEvent() || !a.power || !a.siege || !a.siege.over || !a.siege.over.breach) return;
			var s = Powers.site(a.power);
			if (WorldGen.distance(a.at, [x, y]) <= 1 || (s && World.siteAt(x, y) === s)) Events.startEvent(Events.Powers.shafts(a.id));
		});
	},

	// the wanderer falls leading the storm: the army breaks off and retreats (POWERS §1 aftermath)
	onDie: function () {
		Armies.list().forEach(function (a) {
			if (a.power && a.siege && a.siege.over && a.siege.over.storming) Armies.rout(a.id);
		});
	},

	/*
	 * The storm: the fight screen with the army's squads as weapon buttons (Events.Powers.shafts' fight
	 * scene calls these through its onCombat and onAttack)
	 */
	squadButtons: function (id) {
		// (looked up in the event's panel: a storm that is an event's first scene draws before the panel is shown)
		var a = Armies.byId(id), panel = Events.eventPanel(), box = $('#attackButtons', panel);
		$('<div>').attr('id', 'stormArmy').text(Armies.men(Armies.soldiers(a))).prependTo($('#buttons', panel));
		Armies.SQUADS.forEach(function (s) {
			if (!a.squads[s.weapon] || $('#squad_' + s.weapon.replace(/ /g, '-'), panel).length) return;
			var W = Armies.weapon(s.weapon);
			new Button.Button({
				id: 'squad_' + s.weapon.replace(/ /g, '-'), text: _(s.id), cooldown: W.cd,
				click: function () { Powers.fire(id, s.weapon); }
			}).addClass('weaponButton').appendTo(box);
		});
		$('.clear', box).appendTo(box);
		Powers.stormLine(a);
	},

	stormLine: function (a) {
		$('#stormArmy').text(Armies.men(Armies.soldiers(a)) + '.');
		Armies.SQUADS.forEach(function (s) {
			var b = $('#squad_' + s.weapon.replace(/ /g, '-'));
			if (!b.length) return;
			var n = a.squads[s.weapon] || 0;
			if (s.ammo) n = Math.min(n, (a.ammo || {})[s.ammo] || 0);
			if (!n) Button.setDisabled(b, true);
		});
	},

	fire: function (id, weapon) {
		var a = Armies.byId(id);
		if (!a || !Events.activeEvent() || Events.won) return;
		var v = Powers.volley(a, weapon);
		Armies.set(a);
		Powers.stormLine(a);
		if (!v.n) return;
		var W = World.Weapons[weapon] || {}, anim = W.type == 'ranged' ? Events.animateRanged : Events.animateMelee;
		anim($('#wanderer'), v.dmg, function () {
			if ($('#enemy').data('hp') <= 0 && !Events.won) {
				Events.won = true;
				Powers.won(id);
				Events.winFight();
			}
		});
	},

	// their attack also finds the army; the line breaks at half of who went in
	theirVolley: function (id) {
		var a = Armies.byId(id), P = a && Powers.byId(a.power), enemy = $('#enemy');
		if (!a || Events.won || enemy.data('stunned')) return;
		Powers.hitArmy(a, enemy.data('hp'), P);
		Armies.set(a);
		Powers.stormLine(a);
		if (Armies.soldiers(a) < Armies.ROUT_AT * a.siege.stormed) {
			a.siege.garrison = enemy.data('hp') / Armies.HP;
			Armies.set(a);
			Events.endFight();
			Events.loadScene('routed');
		}
	},

	// the storm won: the garrison is down; the captain comes next
	won: function (id) {
		var a = Armies.byId(id);
		a.siege.garrison = 0;
		a.siege.over.storming = false;
		Armies.set(a);
	},

	// the shafts are dark: the storm fails, losses as a lost fight
	fail: function (id) {
		var a = Armies.byId(id);
		if (a && a.siege) a.siege.stormed = Armies.soldiers(a);
		return Armies.rout(id);
	},

	/*
	 * The aftermath (POWERS §1): broken for good, its beat, its stronghold a prize, its neighbours waver
	 * toward you. way: the captain's choice ('take' | 'send')
	 */
	breakIt: function (armyId, way) {
		var a = Armies.byId(armyId), P = a && Powers.byId(a.power);
		if (!P || Powers.broken(P.id)) return false;
		var id = P.id, home = $SM.get('game.cities["' + a.from + '"]') ? a.from : City.CAPITAL;
		$SM.set(Powers.path(id) + '.broken', true, true);
		$SM.set(Powers.path(id) + '.way', way, true);
		if (way === 'take') {
			// the garrison's soldiers join the nearest military-focus city, at a conquest's production loss
			var to = Powers.nearestMilitary(Powers.site(id).anchor) || home, M = Armies.AFTERMATH.force;
			var ticks = Math.round(M.minutes * 60 / Fire.TICK);
			$SM.set('game.armies.trained["' + to + '"]', Armies.trained(to) + P.joiners, true);
			$SM.set('game.armies.after["' + to + '"]', { loss: M.loss, ticks: ticks, left: ticks }, true);
		} else if (P.headStart !== null) {
			// the old miners' notes: a head start on the coal (provisional: a store of it in the army's city);
			// a power whose entry says headStart: null leaves nothing behind
			$SM.add(City.storePath(home, 'coal'), Powers.HEAD_START);
		}
		Powers.waver(id);
		a.siege = null;
		a.power = null;
		a.state = 'camp';
		Armies.set(a);
		Fire.unlock(P.unlock);
		Engine.event('progress', 'power broken ' + id);
		$SM.fireUpdate('game.armies');
		if (typeof Network != 'undefined') Network.refresh();
		return true;
	},
	HEAD_START: 100,   // provisional: coal the old miners' notes are worth
	WAVER: 25,         // provisional: influence each city-state in the power's reach gains when it falls

	nearestMilitary: function (at) {
		var best = null, d = Infinity, cities = $SM.get('game.cities') || {};
		for (var id in cities) {
			var hex = cities[id].hex;
			if (cities[id].focus !== 'military' || !hex) continue;
			var dd = WorldGen.distance(hex, at);
			if (dd < d) { d = dd; best = id; }
		}
		return best;
	},

	// "they waver toward you when it falls" (POWERS §2): the city-states in its reach, short of joining
	waver: function (id) {
		var s = Powers.site(id), CS = CityStates;
		if (!s || !CS.get()) return;
		var band = Danger.band(World.baseDangerAt(s.anchor[0], s.anchor[1]));
		CS.list().forEach(function (c) {
			var path = 'game.citystates.cs["' + c.id + '"]', st = $SM.get(path);
			if (!st || st.city || WorldGen.distance(c.at, s.anchor) > CS.RIVAL_REACH(band) || !(CS.rateT(c.t, st) > 0)) return;
			$SM.set(path + '.inf', Math.max(st.inf || 0, Math.min(99, (st.inf || 0) + Powers.WAVER)), true);
		});
	},

	/*
	 * The town panel: march the active city's army on a known power
	 */
	cantMarch: function (cityId, id) {
		if (Powers.broken(id)) return _("they're yours.");
		if (Armies.armyOf(cityId)) return _('the army is already out');
		if (Armies.trained(cityId) < 1) return _('no soldiers');
		if (!Armies.soldiersArmed(cityId)) return _('no weapons');
		if (Armies.list().some(function (a) { return a.power === id; })) return _('an army is already there');
		return null;
	},

	marchOn: function (cityId, id) {
		var why = Powers.cantMarch(cityId, id);
		if (why) {
			Notifications.notify(City, why);
			return false;
		}
		return Armies.send(cityId, Powers.target(id), { power: id });
	},

	// what the panel shows of the powers, for its redraw key
	key: function (cityId) {
		return Powers.LIST.map(function (P) { return [Powers.known(P.id), Powers.broken(P.id)]; });
	},

	actions: function (cityId, box) {
		var city = $SM.get('game.cities["' + cityId + '"]');
		if (!city || city.focus !== 'military') return;
		Powers.LIST.forEach(function (P) {
			if (!Powers.known(P.id) || Powers.broken(P.id)) return;
			$('<div>').addClass('clear').appendTo(box);
			$('<div>').addClass('csLine').text(P.name + '.').appendTo(box);
			var why = Powers.cantMarch(cityId, P.id);
			var b = new Button.Button({
				id: 'power_march_' + P.id, text: _('march on them'), width: '80px',
				click: function () { Powers.marchOn(City.activeCity, P.id); }
			}).appendTo(box);
			Button.setDisabled(b, !!why);
			if (why) $('<div>').addClass('clear').add($('<div>').addClass('csLine').text(why)).appendTo(box);
		});
	}
});
