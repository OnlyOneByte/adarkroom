/**
 * The pass wardens' scenes (script/powers/wardens.js): design/text/blaze-draft.md "Power 3", approved and used
 * as written; "The Pass Held" is Events.Blaze.TEXT.passHeld. Lines the draft doesn't have are drafts:
 * design/text/power-wardens.md.
 */
Events.Powers.Wardens = {
	// scene 1: on a trek, the battery in sight
	sighted: function () {
		return {
			title: _('The Great Pass'),
			scenes: {
				start: {
					text: [_('the pass climbs between two walls of rock.'), _('at the top, a wall of sandbags gone hard as stone. long barrels over it.'),
						_('something flashes on the heights. a moment later, the sound.')],
					notification: _('guns on the great pass'),
					buttons: Events.Armies.go
				}
			}
		};
	},

	// scene 2: at the foot of the pass, on the battery's own hex; once met, an army may march on them
	gate: function () {
		var met = function () { Wardens.set('gate'); };
		var go = { 'go': { text: _('go on'), nextScene: 'end' } };
		return {
			title: _('The Gate'),
			scenes: {
				start: {
					text: [_('a voice comes down off the rock, through a tin horn.'), _('says the battery holds the pass. says no one has been relieved.'), _("asks if you're the relief.")],
					buttons: {
						'yes': { text: _('say yes'), onChoose: met, nextScene: { 1: 'yes' } },
						'no': { text: _('say no'), onChoose: met, nextScene: { 1: 'no' } },
						'away': { text: _('walk away'), onChoose: met, nextScene: { 1: 'away' } }
					}
				},
				yes: { text: [_('a long quiet.'), _('then a shell lands short, on purpose.'), _("the voice says they've heard that before.")], buttons: go },
				no: { text: [_('says then go back down.'), _("says they'll know if you don't.")], buttons: go },
				away: { text: [_('the guns watch you all the way down.')], buttons: go }
			}
		};
	},

	// scene 4: on foot, on the hidden ledge beside the battery
	goat: function () {
		return {
			title: _('The Goat Path'),
			scenes: {
				start: {
					text: [_('droppings on a ledge no one should stand on.'), _('a path, a hand wide, along the cliff and up.'), _('it comes out above the guns, behind them.')],
					notification: _("there's a way up behind the battery"),
					onLoad: function () { Wardens.set('path'); },
					buttons: Events.Armies.go
				}
			}
		};
	},

	// scene 5: the camp's "march the goat path"
	dark: function (id) {
		return {
			title: _('The Dark March'),
			scenes: {
				start: {
					text: [_('the army leaves its fires burning below, and climbs in the dark.'), _('no light. one hand on the rock, one on the man in front.')],
					buttons: {
						'climb': { text: _('climb'), onChoose: function () { Wardens.climbOut(id); }, nextScene: 'end' },
						'not': { text: _('not tonight'), nextScene: { 1: 'not' } }
					}
				},
				not: { text: [_('the fires burn down.')], buttons: { 'back': { text: _('go back'), nextScene: 'end' } } }
			}
		};
	},

	// scene 6: the wanderer with the army on the cliff, the storm; then scene 7, the counter-siege begun
	storm: function (id) {
		var A = Armies, a = A.byId(id), P = Powers.byId(a.power), s = a.siege;
		var hold = function () { Wardens.begin(id); };
		return {
			title: _('The Battery'),
			scenes: {
				// (a scene before the fight: the squads' buttons need the event panel on the page)
				start: {
					text: [_('the army comes down off the cliff, behind the guns.')],
					buttons: { 'go': { text: _('go on'), nextScene: { 1: 'storm' } } }
				},
				storm: {
					combat: true, enemy: 'gun crew', chara: P.storm.chara, health: Powers.stormHp(s),
					damage: P.storm.damage, hit: P.storm.hit, attackDelay: P.storm.delay,
					notification: _("they turn the guns. the guns don't turn far enough."),
					deathMessage: _('the guns go quiet.'),
					onLoad: function () {
						var now = A.byId(id);
						now.siege.over.storming = true;
						now.siege.stormed = A.soldiers(now);
						A.set(now);
					},
					onCombat: function () { Powers.squadButtons(id); },
					onAttack: function () { Powers.theirVolley(id); },
					buttons: { 'go': { text: _('go on'), nextScene: { 1: 'counter' } } }
				},
				counter: {
					text: [_('the battery is ours. the guns point the wrong way.'), _('below, on the far side, the rest of them are coming up.')],
					buttons: {
						'light': { text: _('light the beacon on the pass'), onChoose: hold, nextScene: 'end' },
						'hold': { text: _('hold the guns'), onChoose: hold, nextScene: 'end' }
					}
				},
				routed: {
					text: [],
					onLoad: function () {
						var left = A.rout(id);
						this.text = [_('the line breaks. the army runs for the light.'), (left === 1 ? _('1 soldier comes away from the walls. the baggage stays where it fell.') : _('{0} soldiers come away from the walls. the baggage stays where it fell.', left))];
					},
					buttons: Events.Armies.go
				}
			}
		};
	},

	// the counter-siege survived: B10's scene (Events.Blaze.TEXT.passHeld), then scene 8, the wardens broken
	held: function (id) {
		var T = Events.Blaze.TEXT.passHeld, good = { 'go': { text: _('go on'), nextScene: { 1: 'far' } } };
		return {
			title: T.title,
			scenes: {
				start: { text: T.text, notification: T.notification, blink: true, buttons: { 'go': { text: T.end, nextScene: { 1: 'broken' } } } },
				broken: {
					text: [_('the last of them come up the pass with their hands open.'), _("their officer looks east a long time. says there's nothing there now. says there wasn't for years.")],
					buttons: {
						'take': { text: _('take them in'), onChoose: function () { Powers.breakIt(id, 'take'); }, nextScene: { 1: 'taken' } },
						'send': { text: _('send them down the far side'), onChoose: function () { Powers.breakIt(id, 'send'); }, nextScene: { 1: 'sent' } }
					}
				},
				taken: { text: [_('they bring their range cards. no one else can read them.')], buttons: good },
				sent: { text: [_('they go down into the east, where they were watching.')], buttons: good },
				far: {
					text: [_('past the range, land no one here has seen.')],
					buttons: { 'end': { text: _('good'), nextScene: 'end' } }
				}
			}
		};
	}
};

// the siege camp at the battery: its first lines, and the goat path once it is found (blaze-draft scene 3)
(function () {
	var P = Events.Powers, invest = P.invest, campButtons = P.campButtons;
	P.invest = function (a) {
		if (a.power !== Wardens.ID) return invest.apply(P, arguments);
		return [_('the guns find the camp from the heights.'), _('every tick under them costs a squad.')];
	};
	P.campButtons = function (a, buttons) {
		if (a.power !== Wardens.ID) return campButtons.apply(P, arguments);
		if (!Wardens.state().path || !a.siege || a.siege.dark || a.siege.over) return;
		buttons.goat = {
			text: _('march the goat path'), nextScene: 'end',
			onChoose: function () { CityStates.queue(function () { Events.startEvent(Events.Powers.Wardens.dark(a.id)); }); }
		};
	};
})();
