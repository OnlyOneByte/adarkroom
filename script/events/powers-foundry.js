/**
 * The foundry's scenes (script/powers/foundry.js): design/text/blaze-draft.md "Power 4 — the foundry", approved,
 * used as written ("let it go out" dropped). Lines with no approved text are drafts: design/text/power-foundry.md.
 */
Events.PowersFoundry = {
	// 1. first sighting, on a trek: the site is marked (its hover)
	sighting: function () {
		return {
			title: _('A Fire in the Hills'),
			scenes: {
				start: {
					onLoad: function () { Foundry.set('seen', true); },
					text: [_('smoke. a great deal of it, from one chimney.'),
						Foundry.mastersMet() ? _('after the cold hill towns, it looks wrong.') : _('the chimney is taller than any tree.')],
					notification: _("a fire burns in the hills that isn't ours"),
					buttons: Events.Armies.go
				}
			}
		};
	},

	// 2. at the site: the foundry is known (an army may march on it once the trek is home)
	gate: function () {
		var met = function () { World.state.foundryMet = true; };
		var on = { 'go': { text: _('go on'), nextScene: 'end' } };
		var buttons = { 'for': { text: _('ask who the guns are for'), onChoose: met, nextScene: { 1: 'for' } } };
		if (Foundry.mastersMet()) buttons.masters = { text: _('ask about the forge-masters'), onChoose: met, nextScene: { 1: 'masters' } };
		buttons.walk = { text: _('walk away'), onChoose: met, nextScene: { 1: 'walk' } };
		return {
			title: _('The Gate'),
			scenes: {
				start: {
					text: [_('brick walls, black with soot. a gate of iron plate, riveted.'), _('a gun sits over it, short and fat. a cannon.'),
						_("a woman on the wall in a leather apron. says they make guns. says nobody's ordered any in a long time.")],
					buttons: buttons
				},
				'for': { text: [_("says the war. says it'll want them back.")], buttons: on },
				masters: { text: [_("says the hill towns can't keep a fire."), _('says they come and buy, when they have coal.')], buttons: on },
				walk: { text: [_('the hammers start again behind the wall.')], buttons: on }
			}
		};
	},

	// 3. the siege camp's first lines
	invest: function () {
		return [_('the rams ring off the brick.'), _('smoke still goes up from the chimney. they dig their own iron.')];
	},

	// 4. the first grenades in a military city's stores
	grenades: function () {
		return {
			title: _('The First Grenades'),
			scenes: {
				start: {
					text: [_('iron shells packed with black powder, a fuse in each.'), _('the soldiers hold them like eggs.')],
					notification: _('the armoury has made grenades'),
					buttons: Events.Armies.go
				}
			}
		};
	},

	// 5-7. the walls are down and the wanderer is with the army: the breach, the storm at the furnace door, then the
	// crew's surrender, the furnace kept lit, and the crew taken in or sent away; H11's scene follows
	storm: function (id) {
		var A = Armies, a = A.byId(id), P = Powers.byId(a.power), s = a.siege;
		// (or Network.blazeStory plays it at home, whichever is first)
		var done = function () { CityStates.queue(function () { if (!Network.flag('furnaceSeen')) Events.startEvent(Events.Blaze.furnace()); }); };
		return {
			title: _('The Foundry'),
			scenes: {
				// (the fight opens as a second scene: the army's squads are drawn into the panel on the page)
				start: {
					text: [_('the grenades go over the wall. the brick comes down in a cloud.')],
					buttons: { 'go': { text: _('go on'), nextScene: { 1: 'storm' } } }
				},
				storm: {
					combat: true, enemy: 'foundry', chara: P.storm.chara, health: Powers.stormHp(s),
					damage: P.storm.damage, hit: P.storm.hit, attackDelay: P.storm.delay,
					notification: _('they fight at the furnace door, in the heat.'),
					deathMessage: _('the crew lay down hammers, not rifles.'),
					onLoad: function () {
						var now = A.byId(id);
						now.siege.over.storming = true;
						now.siege.stormed = A.soldiers(now);
						A.set(now);
					},
					onCombat: function () { Powers.squadButtons(id); },
					onAttack: function () { Powers.theirVolley(id); },
					buttons: { 'go': { text: _('go on'), nextScene: { 1: 'broken' } } }
				},
				broken: {
					// (won by the wanderer's own weapon too: the storm is over either way)
					onLoad: function () { if (A.byId(id) && A.byId(id).siege) Powers.won(id); },
					text: [_("the woman in the apron says the furnace can't go out. says if it goes out it cracks.")],
					buttons: { 'lit': { text: _('keep it lit'), nextScene: { 1: 'lit' } } }
				},
				lit: {
					text: [_('our stokers go in beside theirs. no one stops feeding it.')],
					buttons: {
						'take': { text: _('take them in'), onChoose: function () { Powers.breakIt(id, 'take'); done(); }, nextScene: 'end' },
						'send': { text: _('send them away'), onChoose: function () { Powers.breakIt(id, 'send'); done(); }, nextScene: 'end' }
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
	}
};
