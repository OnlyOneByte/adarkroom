/**
 * The powers' scenes (script/powers.js). The garrison of the deep mines: its adits, the shafts and the
 * storm, the captain (design/text/flame-draft.md scenes 3-4 and design/drafts/POWERS.md §4, approved).
 * Lines with no approved text are drafts: design/text/phase6-build.md.
 */
Events.Powers = {
	// out on a trek, at an open adit: a blasting charge from the pack brings it down
	adit: function (id, at) {
		return {
			title: _('An Adit'),
			scenes: {
				start: {
					text: [_('a timber mouth in the hillside, propped with old beams.'), _('a cart track runs into the dark. it is worn bright.')],
					buttons: {
						'blast': {
							text: _('set a charge'), cost: { 'blasting charge': 1 },
							onChoose: function () { Powers.collapse(id, at); }, nextScene: { 1: 'down' }
						},
						'leave': { text: _('leave'), nextScene: 'end' }
					}
				},
				down: {
					text: [_('the charge goes off. the hill settles over the mouth.'), _('dust hangs in the air a long while.')],
					buttons: Events.Armies.go
				}
			}
		};
	},

	// the army at the siege camp blows an adit with one of its charges
	campButtons: function (a, buttons) {
		if (!a.power || !Powers.open(a.power).length || !((a.gear || {})['blasting charge'] > 0)) return;
		buttons.blast = {
			text: _('blast an adit'), nextScene: 'end',
			onChoose: function () {
				var now = Armies.byId(a.id), open = now && now.power && Powers.open(now.power);
				if (!open || !open.length || !(now.gear['blasting charge'] > 0)) return;
				now.gear['blasting charge']--;
				Armies.set(now);
				Powers.collapse(now.power, open[0]);
			}
		};
	},

	// the first scene at the camp: the puzzle told
	invest: function (a) {
		return [_('the army digs in below the walls.'),
			_('three adits feed the stockade from inside the hill. while one stays open, they will not go hungry.')];
	},

	// flame-draft scene 3: the walls are down and the wanderer is with the army; the shafts need the light
	shafts: function (id) {
		var A = Armies, a = A.byId(id), P = Powers.byId(a.power), lit = Network.gateLit(), s = a.siege;
		var start = [_('the wall comes down in an afternoon. the garrison goes down into the mine.'), _("the shafts are black. they know them. you don't.")];
		var scenes = {
			start: lit ? {
				text: start.concat([_('fire is carried down from the beacon, lamp by lamp.'), _('the dark goes back a shaft at a time.'), _('the garrison has nowhere further to go.')]),
				buttons: { 'go': { text: _('go on'), nextScene: { 1: 'storm' } } }
			} : {
				text: start.concat([_('the torches gutter in the bad air.'), _('the soldiers come back up with less than they took down.')]),
				buttons: { 'back': { text: _('fall back'), onChoose: function () { Powers.fail(id); }, nextScene: 'end' } }
			},
			// the storm: the original's fight, the army's squads beside the wanderer's own weapons
			storm: {
				combat: true, enemy: 'garrison', chara: P.storm.chara, health: Powers.stormHp(s),
				damage: P.storm.damage, hit: P.storm.hit, attackDelay: P.storm.delay,
				notification: _('the garrison makes its stand in the last shaft.'),
				deathMessage: _('the flag comes down. no one cheers.'),
				onLoad: function () {
					var now = A.byId(id);
					now.siege.over.storming = true;
					now.siege.stormed = A.soldiers(now);
					A.set(now);
				},
				onCombat: function () { Powers.squadButtons(id); },
				onAttack: function () { Powers.theirVolley(id); },
				buttons: { 'go': { text: _('go on'), nextScene: { 1: 'captain' } } }
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
		return { title: _('Into the Shafts'), scenes: $.extend(scenes, Events.Powers.captain(id)) };
	},

	// starved out, every adit down: they give up without a storm
	yielded: function (id) {
		return {
			title: _('The Captain'),
			scenes: $.extend({
				start: {
					text: [_('the flag comes down. no one cheers.'), _('the last of them sit by the gate and give up their rifles one by one.')],
					buttons: { 'go': { text: _('go on'), nextScene: { 1: 'captain' } } }
				}
			}, Events.Powers.captain(id))
		};
	},

	// flame-draft scene 4: the captain, then the coal (F8)
	captain: function (id) {
		var good = { 'go': { text: _('go on'), nextScene: { 1: 'seams' } } };
		return {
			captain: {
				// (won by the wanderer's own weapon too, or starved: the storm is over either way)
				onLoad: function () { if (Armies.byId(id) && Armies.byId(id).siege) Powers.won(id); },
				text: [_('the captain sits on the slag with a tin box of papers.'), _('the papers are blank. damp got into them years ago.'), _('asks who won the war.'), _('no one here knows.')],
				buttons: {
					'take': { text: _('take them in'), onChoose: function () { Powers.breakIt(id, 'take'); }, nextScene: { 1: 'taken' } },
					'send': { text: _('send them down the hill'), onChoose: function () { Powers.breakIt(id, 'send'); }, nextScene: { 1: 'sent' } }
				}
			},
			taken: { text: [_('the garrison lays down its rifles.'), _('some of them have never seen a town.')], buttons: good },
			sent: { text: [_('they go without a word, in a line, the way soldiers do.'), _('the captain leaves the box behind.')], buttons: good },
			seams: {
				text: [_('the seams run deep in the hill. black and dry.'), _('it burns like nothing before it.')],
				buttons: { 'end': { text: _('good'), nextScene: 'end' } }
			}
		};
	}
};
