/**
 * The drowned fleet's scenes (script/powers/fleet.js): design/text/blaze-draft.md "Power 5", approved, every
 * line as written and all in Events.Fleet.TEXT. Lines the draft doesn't have are drafts, listed in
 * design/text/power-fleet.md. The framework's own scenes reach these through adapters (at the bottom).
 */
Events.Fleet = {
	TEXT: {
		title: _('The Drowned Fleet'),
		// 1. first sighting (a trek on the shore, or at the drowned harbour once its light is lit)
		sighting: {
			text: [_('hulks out on the water, chained together, hull to hull.'), _('one of them is iron, and has a gun on it as long as a tree.'),
				_('at night, lamps on every deck.')],
			notification: _('a fleet lies out on the inland sea')
		},
		hover: _("the drowned fleet. it hasn't moved in years."),
		// 2. an army ordered there before the harbour has boats
		noBoats: _("the fleet is out on the water. an army can't march there."),
		// 3. the gate (a boat rows out from the drowned harbour)
		gate: {
			title: _('The Gate'),
			text: [_('a rope ladder hangs down the side of the nearest hulk.'), _("a sailor at the top, in what's left of a blue coat. says this is the navy."),
				_("says the land lost the war. says the sea didn't.")],
			buttons: { eat: _('ask what they eat'), boats: _('ask about the boats that never came back'), away: _('row away') },
			after: {
				eat: [_('fish, and what the coast towns bring. they bring it every month.')],
				boats: [_("says the harbour's boats came out to trade, once."), _('says they came too close.')],
				away: [_("the big gun turns to follow the boat. it doesn't fire.")]
			},
			end: _('go on')
		},
		// 4. the siege camp on the water (first lines)
		camp: [_("the boats lie off the hulks, out of the big gun's reach."), _("the hulks' sides are tarred thick.")],
		// 5. the fire-ships (the camp's "send in the fire-ships")
		fireShips: {
			title: _('The Fire-Ships'),
			button: _('send in the fire-ships'),
			text: [_('the old boats are packed with pitch and rowed out by two men each.'), _('halfway, the men go over the side. the boats go on.')],
			buttons: { send: _('send them in'), wait: _('not yet') },
			after: [_("the first one strikes, and the tar on the hulk's side goes up."), _('then another.')],
			end: _('go on')
		},
		burning: _('the hulks are burning. the boats can board.'),
		// 6. the storm's opening line (a boarding fight)
		storm: _('over the rail, onto a burning deck.'),
		// 7. the fleet broken (straight after a won storm)
		broken: {
			title: _('The Fleet Broken'),
			text: [_('the iron ship lists, and settles in the shallows, and stays.'), _('the sailors are pulled out of the water one by one.'),
				_("the one in the blue coat asks where the harbour's boats went. someone tells them they're still on the bottom.")],
			buttons: { take: _('take them in'), ashore: _('put them ashore') },
			after: {
				take: [_("they know the sea. the harbour's boats will go further now.")],
				ashore: [_("they stand on the beach a long time, like it's moving under them.")]
			},
			go: _('go on'),
			open: [_('the inland sea is open.')],
			end: _('good')
		},
		keepers: _('the keepers on the point say the light can reach the flats now.')
	},

	// 1: seen, and marked
	sighting: function () {
		var T = Events.Fleet.TEXT;
		return {
			title: T.title,
			scenes: {
				start: {
					text: T.sighting.text, notification: T.sighting.notification,
					onLoad: function () { Fleet.sight(); },
					buttons: Events.Armies.go
				}
			}
		};
	},

	// 3: rowed out from the drowned harbour, the gate met
	gate: function () {
		var T = Events.Fleet.TEXT.gate, scenes = {
			start: { text: T.text, onLoad: function () { Fleet.set('gate', true); }, buttons: {} }
		};
		['eat', 'boats', 'away'].forEach(function (k) {
			scenes.start.buttons[k] = { text: T.buttons[k], nextScene: { 1: k } };
			scenes[k] = { text: T.after[k], buttons: { 'go': { text: T.end, nextScene: 'end' } } };
		});
		return { title: T.title, scenes: scenes };
	},

	// 4: the camp's first lines
	invest: function () {
		return Events.Fleet.TEXT.camp;
	},

	// 5: the fire-ships, from the camp (scenes added to the camp's own event)
	fireScenes: function (id, ev) {
		var T = Events.Fleet.TEXT.fireShips;
		ev.scenes.start.buttons.fire = { text: T.button, nextScene: { 1: 'fire' } };
		ev.scenes.fire = {
			text: T.text,
			buttons: {
				'send': { text: T.buttons.send, onChoose: function () { Fleet.burn(id); }, nextScene: { 1: 'burnt' } },
				'wait': { text: T.buttons.wait, nextScene: 'end' }
			}
		};
		ev.scenes.burnt = { text: T.after, buttons: { 'go': { text: T.end, nextScene: 'end' } } };
		return ev;
	},

	// 6: the boarding fight the wanderer leads: the army's squads beside the wanderer's own weapons
	storm: function (id) {
		var A = Armies, a = A.byId(id), P = Powers.byId('fleet'), T = Events.Fleet.TEXT;
		var scenes = {
			start: {
				combat: true, enemy: 'fleet', chara: P.storm.chara, health: Powers.stormHp(a.siege),
				damage: P.storm.damage, hit: P.storm.hit, attackDelay: P.storm.delay,
				notification: T.storm,
				deathMessage: T.broken.text[0],
				onLoad: function () {
					var now = A.byId(id);
					now.siege.over.storming = true;
					now.siege.stormed = A.soldiers(now);
					A.set(now);
				},
				onCombat: function () { Powers.squadButtons(id); },
				onAttack: function () { Powers.theirVolley(id); },
				buttons: { 'go': { text: T.broken.go, nextScene: { 1: 'broken' } } }
			},
			// (the armies' approved lines, as the garrison's)
			routed: {
				text: [],
				onLoad: function () {
					var left = A.rout(id);
					this.text = [_('the line breaks. the army runs for the light.'), (left === 1 ? _('1 soldier comes away from the walls. the baggage stays where it fell.') : _('{0} soldiers come away from the walls. the baggage stays where it fell.', left))];
				},
				buttons: Events.Armies.go
			}
		};
		return { title: T.title, scenes: $.extend(scenes, Events.Fleet.aftermath(id, 1)) };
	},

	// starved out (no coast town feeds them any more): straight to the fleet broken
	yielded: function (id) {
		var scenes = Events.Fleet.aftermath(id, 0);
		scenes.start = scenes.broken;
		return { title: Events.Fleet.TEXT.broken.title, scenes: scenes };
	},

	// 7: the sailors, then the sea open. from: the first of its lines to show (the storm's win shows the first)
	aftermath: function (id, from) {
		var T = Events.Fleet.TEXT.broken, open = { 'go': { text: T.go, nextScene: { 1: 'open' } } };
		return {
			broken: {
				// (won by the wanderer's own weapon too, or starved: the storm is over either way)
				onLoad: function () { if (Armies.byId(id) && Armies.byId(id).siege) Powers.won(id); },
				text: T.text.slice(from),
				buttons: {
					'take': { text: T.buttons.take, onChoose: function () { Powers.breakIt(id, 'take'); }, nextScene: { 1: 'taken' } },
					'ashore': { text: T.buttons.ashore, onChoose: function () { Powers.breakIt(id, 'ashore'); }, nextScene: { 1: 'ashore' } }
				}
			},
			taken: { text: T.after.take, buttons: open },
			ashore: { text: T.after.ashore, buttons: open },
			open: { text: T.open, buttons: { 'end': { text: T.end, nextScene: 'end' } } }
		};
	}
};

// the framework's scenes, for the fleet's army (script/events/powers.js, script/events/armies.js)
(function (E, F) {
	var mine = function (id) { return Fleet.mine(Armies.byId(id)); };
	Fleet.wrap(E.Powers, 'invest', function (old, args) { return Fleet.mine(args[0]) ? F.invest() : old.apply(E.Powers, args); });
	Fleet.wrap(E.Powers, 'shafts', function (old, args) { return mine(args[0]) ? F.storm(args[0]) : old.apply(E.Powers, args); });
	Fleet.wrap(E.Powers, 'yielded', function (old, args) { return mine(args[0]) ? F.yielded(args[0]) : old.apply(E.Powers, args); });
	Fleet.wrap(E.Armies, 'camp', function (old, args) {
		var ev = old.apply(E.Armies, args), a = Armies.byId(args[0]);
		return Fleet.mine(a) && (a.gear || {})['fire-ship'] > 0 && a.siege.walls > 0 ? F.fireScenes(a.id, ev) : ev;
	});
})(Events, Events.Fleet);
