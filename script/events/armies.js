/**
 * The siege chain's scenes (design/drafts/POWERS.md §1 Option B and §4; the craftsmen's lines from
 * design/content/phase4-citystates.md 3.5). Started by Armies (script/armies.js) when their moment
 * comes, not drawn from the random pool. Lines with no approved text are drafts: design/text/phase5-text.md.
 */
Events.Armies = {
	go: { 'go': { text: _('go on'), nextScene: 'end' } },

	// invest, and the choices every few ticks (POWERS §4 "the siege camp")
	camp: function (id) {
		var A = Armies, a = A.byId(id);
		var text = a.siege.ticks ? [A.status(a)] : a.power ? Events.Powers.invest(a) :
			[_('the army digs in below the walls.'), _("the soldiers eat in silence. the meat won't last the week.")];
		var buttons = {
			'press': { text: _('press the walls'), onChoose: function () { A.stance(id, 'press'); }, nextScene: 'end' },
			'wait': { text: _('wait them out'), onChoose: function () { A.stance(id, 'wait'); }, nextScene: 'end' },
			'back': { text: _('fall back'), onChoose: function () { A.fallBack(id); }, nextScene: 'end' }
		};
		// a power's puzzle can add its own (Events.Powers.campButtons)
		if (a.power) Events.Powers.campButtons(a, buttons);
		return { title: _('The Siege Camp'), scenes: { start: { text: text, buttons: buttons } } };
	},

	// POWERS §4 "a sally in the night", resolved by numbers
	sally: function (c, r) {
		return {
			title: _('A Sally'),
			scenes: {
				start: {
					text: [_('the gate opens in the dark.'), _('shapes come down the slope, fast and quiet.'),
						_('{0} of ours fall. {1} of theirs.', r.lost, r.killed)],
					notification: CityStates.fill(_('the people of {name} strike out at the camp'), c),
					buttons: Events.Armies.go
				}
			}
		};
	},

	// the walls are down: the storm, a line a round; then the town is taken or sacked, or the army breaks
	storm: function (id, res) {
		var A = Armies, a = A.byId(id), c = CityStates.byId(a.to), s = a.siege;
		var lines = [_('the walls are down. the army goes in through the gap.')];
		res.rounds.forEach(function (r) { lines.push(_('{0} of ours fall. {1} of theirs.', r.ours, r.theirs)); });
		var story = CityStates.story(c.t), fled = _('the ones who knew the craft are gone. out the back, in the night.');
		var scenes = { start: { text: lines, buttons: {} } };
		if (res.won) {
			scenes.start.buttons.go = { text: _('go on'), nextScene: { 1: 'gate' } };
			scenes.gate = {
				text: [_('the gate falls. the town is ours.')],
				buttons: {
					'take': { text: _('take it'), onChoose: function () { A.take(id, false); }, nextScene: { 1: 'taken' } },
					'sack': { text: _('sack it'), onChoose: function () { A.take(id, true); }, nextScene: { 1: 'sacked' } }
				}
			};
			scenes.taken = { text: [_('the soldiers stand back from the doors. the people come out, slowly.')].concat(story ? [fled] : []), buttons: Events.Armies.go };
			scenes.sacked = { text: [_('the soldiers go house to house. what can be carried is carried.')].concat(story ? [fled] : []), buttons: Events.Armies.go };
		} else {
			var left = Math.min(res.left, A.routed(res.start, s.garrison, s.garrisonMax));
			scenes.start.buttons.go = { text: _('go on'), onChoose: function () { A.rout(id); }, nextScene: { 1: 'routed' } };
			scenes.routed = {
				text: [_('the line breaks. the army runs for the light.'), (left === 1 ? _('1 soldier comes away from the walls. the baggage stays where it fell.') : _('{0} soldiers come away from the walls. the baggage stays where it fell.', left))],
				buttons: Events.Armies.go
			};
		}
		return { title: _('The Storm'), scenes: scenes };
	},

	// worn down under the walls: the army breaks before the walls do
	broken: function (id) {
		var A = Armies, a = A.byId(id), s = a.siege;
		var left = Math.min(A.soldiers(a), A.routed(s.invested, s.garrison, s.garrisonMax));
		return {
			title: A.target(a).name,
			scenes: {
				start: {
					text: [_('the army breaks under the walls. it runs for the light.'), (left === 1 ? _('1 soldier comes away from the walls. the baggage stays where it fell.') : _('{0} soldiers come away from the walls. the baggage stays where it fell.', left))],
					buttons: { 'go': { text: _('go on'), onChoose: function () { A.rout(id); }, nextScene: 'end' } }
				}
			}
		};
	},

	// their stores are gone: they yield
	yielded: function (id) {
		var A = Armies, a = A.byId(id), c = CityStates.byId(a.to), story = CityStates.story(c.t);
		return {
			title: _('The Gate Opens'),
			scenes: {
				start: {
					text: [_('a rag goes up on a pole over the gate.'), _('they have eaten the last of it.')],
					buttons: { 'in': { text: _('go in'), onChoose: function () { A.yieldTo(id); }, nextScene: { 1: 'in' } } }
				},
				'in': {
					text: [_('the army goes in. no one stops them.')].concat(story ? [_('the ones who knew the craft are gone. out the back, in the night.')] : []),
					buttons: Events.Armies.go
				}
			}
		};
	},

	// content 3.5: the craftsmen brought home; the city-state's beat plays now
	craftsmen: function (c) {
		return {
			title: c.name,
			scenes: {
				start: {
					text: [_('the craftsmen come back under guard.'), _("they don't look at the soldiers."), _('they show the craft anyway.')],
					buttons: {
						'go': {
							text: _('go on'), nextScene: 'end',
							onChoose: function () { CityStates.extras(c); CityStates.beat(c); }
						}
					}
				}
			}
		};
	}
};
