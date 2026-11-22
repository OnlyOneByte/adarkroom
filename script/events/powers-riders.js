/**
 * The cinder riders' scenes (script/powers/riders.js): design/text/blaze-draft.md "Power 2", approved, its
 * lines as written. Lines with no approved text are drafts: design/text/power-riders.md.
 */
Events.PowersRiders = {
	go: { 'go': { text: _('go on'), nextScene: 'end' } },

	// 1. first sighting, on a trek: the camp seen
	dust: function () {
		return {
			title: _('Dust'),
			scenes: {
				start: {
					onLoad: function () { Riders.set('seen', true); },
					text: [_("dust on the horizon. it doesn't settle."), _('riders come out of it, circle once, and go back.')],
					notification: _('riders out on the desert. they saw you.'),
					buttons: Events.PowersRiders.go
				}
			}
		};
	},

	// 2. the camp, on a trek at its site: they are known (an army may march on them)
	camp: function () {
		var go = Events.PowersRiders.go;
		return {
			title: _('The Camp'),
			scenes: {
				start: {
					onLoad: function () { Riders.set('met', true); },
					text: [_('no wall. tents of old canvas around a well, and fires.'), _('a rider in a burnt coat sits a mount just out of throw.'),
						_('says the desert is theirs. says the water is.')],
					buttons: {
						'war': { text: _('ask about the war'), nextScene: { 1: 'war' } },
						'water': { text: _('ask about the water'), nextScene: { 1: 'water' } },
						'away': { text: _('walk away'), nextScene: { 1: 'away' } }
					}
				},
				war: { text: [_('laughs. says they walked away from it. says it can find its own way home.')], buttons: go },
				water: { text: [_('points at the well, then at the sand all round.'), _("says there are three. says you'll find them dry before you find them.")], buttons: go },
				away: { text: [_("they follow, a long way, and then don't.")], buttons: go }
			}
		};
	},

	// 4. a well, on a trek or when a beacon is lit on it
	well: function (w) {
		return {
			title: _('A Well'),
			scenes: {
				start: {
					text: [_('a ring of stones in the sand. a bucket on a rope. the water is cold.')],
					buttons: {
						'light': { text: _('light a fire on it'), onChoose: function () { Riders.found(w); }, nextScene: { 1: 'lit' } },
						'leave': { text: _('leave'), nextScene: 'end' }
					}
				},
				lit: { text: [_('the fire is seen a long way off.'), _('by morning the riders know.')], buttons: Events.PowersRiders.go }
			}
		};
	},

	// 3. the army at the camp while a well is still theirs; 5. once they are all ours
	siegeCamp: function (id) {
		var A = Armies, text = Riders.allHeld() ? [_("the riders don't run now. they wait at the camp, mounted.")] :
			[_('the camp is empty when the army gets there. the fires are warm.'), _('tracks go off toward the wells.')];
		return {
			title: _('The Siege Camp'),
			scenes: {
				start: {
					text: text,
					buttons: {
						'go': { text: _('go on'), nextScene: 'end' },
						'back': { text: _('fall back'), onChoose: function () { A.fallBack(id); }, nextScene: 'end' }
					}
				}
			}
		};
	},

	// 6. the storm, the wanderer with the army: the bolas go out after them, or they get away
	storm: function (id) {
		var A = Armies, a = A.byId(id), P = Powers.byId(a.power), s = a.siege;
		var tanglers = (a.squads.bolas || 0) > 0 && ((a.ammo || {}).bolas || 0) > 0; // (thrown: the squad is its bolas)
		var scenes = {
			start: tanglers ? {
				text: [_('they break for the open sand. the bolas go out after them.')],
				buttons: { 'go': { text: _('go on'), nextScene: { 1: 'storm' } } }
			} : {
				text: [_('they break for the open sand. nothing goes out after them.'), _('by dusk they are back at the tents, watching.')],
				onLoad: function () { Riders.escaped(id); },
				buttons: { 'back': { text: _('go back'), nextScene: 'end' } }
			},
			storm: {
				combat: true, enemy: 'riders', chara: P.storm.chara, health: Powers.stormHp(s),
				damage: P.storm.damage, hit: P.storm.hit, attackDelay: P.storm.delay,
				deathMessage: _('the last of them come down off their mounts.'),
				onLoad: function () {
					var now = A.byId(id);
					if (now.siege.over.storming) return;
					now.siege.over.storming = true;
					now.siege.stormed = A.soldiers(now);
					Riders.caught(now);
					A.set(now);
				},
				// the army's squads beside the wanderer's own weapons; caught, they start the fight tangled
				onCombat: function () {
					Powers.squadButtons(id);
					var enemy = $('#enemy');
					enemy.data('stunned', true);
					Engine.setTimeout(function () { enemy.data('stunned', false); }, Events.STUN_DURATION);
				},
				onAttack: function () { Powers.theirVolley(id); },
				buttons: { 'go': { text: _('go on'), nextScene: { 1: 'broken' } } }
			},
			routed: {
				text: [],
				onLoad: function () {
					var left = A.rout(id);
					this.text = [_('the line breaks. the army runs for the light.'), (left === 1 ? _('1 soldier comes away from the walls. the baggage stays where it fell.') : _('{0} soldiers come away from the walls. the baggage stays where it fell.', left))];
				},
				buttons: Events.Armies.go
			}
		};
		return { title: _('The Cinder Riders'), scenes: $.extend(scenes, Events.PowersRiders.broken(id)) };
	},

	// 7. the riders broken, straight after the storm; then the tar pits (F10)
	broken: function (id) {
		var good = { 'go': { text: _('go on'), nextScene: { 1: 'pits' } } };
		return {
			broken: {
				onLoad: function () { if (Armies.byId(id) && Armies.byId(id).siege) Powers.won(id); },
				text: [_('the mounts are hobbled in a line. the riders sit in the sand.'), _("their chief takes off the burnt coat. under it, the same coat as the garrison's."),
					_('says they were the ones who left first. says someone had to.')],
				buttons: {
					'take': { text: _('take them in'), onChoose: function () { Powers.breakIt(id, 'take'); }, nextScene: { 1: 'taken' } },
					'send': { text: _('send them into the desert'), onChoose: function () { Powers.breakIt(id, 'send'); }, nextScene: { 1: 'sent' } }
				}
			},
			taken: { text: [_('they come in on foot, leading the mounts.')], buttons: good },
			sent: { text: [_("they go east, small in the heat. they don't look back.")], buttons: good },
			pits: {
				text: [_('the tar pits are quiet. the keepers come out on the planks to look.')],
				buttons: { 'end': { text: _('good'), nextScene: 'end' } }
			}
		};
	}
};

// the siege camp and its first lines are the riders' own (Events.Armies.camp, Events.Powers' hooks)
(function (EA, EP) {
	var camp = EA.camp, buttons = EP.campButtons;
	EA.camp = function (id) {
		var a = Armies.byId(id);
		return a && a.power === Riders.ID ? Events.PowersRiders.siegeCamp(id) : camp.apply(EA, arguments);
	};
	EP.campButtons = function (a) {
		if (a.power !== Riders.ID) return buttons.apply(EP, arguments);
	};
})(Events.Armies, Events.Powers);
