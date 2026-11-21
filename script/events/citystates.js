/**
 * The city-states' scenes and lines (design/content/phase4-citystates.md §3; the flame-era beats
 * from design/text/flame-draft.md). Started by CityStates (script/citystates.js) when their moment
 * comes, not drawn from the random pool. Each builder takes a placed city-state { id, t, name, ... }.
 */
Events.CityStates = {
	/*
	 * Per temperament (content 3.2-3.10): the first sighting, the gate line, the stranger at 25 (dress,
	 * where, token), the threshold lines, the offer once talks open, the joining line.
	 */
	TEXT: {
		bog_cutters: {
			sighting: [_("smoke lies low over the bog. it doesn't rise."), _('squares of black earth are stacked on the banks to dry.'), _('someone is out on the water, cutting.')],
			gate: _('the way in is a plank laid over the black water.'),
			dress: _('mud to the knee'), where: _('the bog'), token: _('a square of black peat'),
			flavour: { 25: _('they cut a path through the reeds toward the light.'), 75: _('lanterns are seen on the marsh at dusk, low.') }
		},
		potters: {
			sighting: [_('the river bends around a town of red roofs.'), _('smoke from a dozen low ovens.'), _('shards in the mud everywhere. some of them painted.')],
			gate: _('the gate is a wall of broken pots, stacked like bricks.'),
			dress: _('clay to the elbow'), where: _('the river'), token: _('a small pot, still warm'),
			flavour: { 25: _('pots appear at the gate, left for whoever wants them.'), 50: _('they ask what the fire is built of.'), 75: _('the ovens burn later into the night.') }
		},
		resin_tappers: {
			sighting: [_('the trees here are scored in long lines, cut to the white.'), _('cups hang under the cuts, brimming.'), _('no one has come to empty them in a long time.')],
			gate: _('the huts are empty. sap has run over the doorsteps.'), noGate: true, empty: true,
			dress: _('with sap on their hands'), where: _('the trees'), token: _('a leaf cup of resin'),
			offer: _("the tappers went out for the deep trees and didn't come back.")
		},
		forge_masters: {
			sighting: [_('a town on every hilltop, joined by paths of black slag.'), _('the chimneys are tall.'), _('none of them smoke.')],
			gate: _('the gate is an anvil on a cart, chained to the wall.'),
			dress: _('with burnt arms'), where: _('the hill towns'), token: _('an unfinished blade')
		},
		tar_keepers: {
			sighting: [_('black pools on the sand, skinned over and shining.'), _('fires on both sides of the pits.'), _('the keepers on one side. someone else on the other.')],
			gate: _('the way in is a path of planks laid across the tar.'),
			dress: _('smelling of pitch'), where: _('the pits'), token: _('a stick wound with tar'),
			offer: _('raiders sit on the far side of the pits. the keepers want them gone.')
		},
		mirror_folk: {
			sighting: [_('a flash out on the flats. then another.'), _('a town of pale roofs, every roof turned to the sky.'), _('the flashing stops while you watch.')],
			gate: _('there is no gate. a mirror on the first roof turns to follow you.'), noGate: true,
			flavour: { 50: _('two flashes now, each night.'), 75: _("the flashing doesn't stop until dawn.") }
		},
		drifters: {
			sighting: [_('tracks in the snow, a great many, all going one way.'), _('a fire pit, still warm.'), _('no camp.')],
			gate: _('the camp is already moving.'), noGate: true, empty: true,
			dress: _("in furs, who won't sit"), where: _('the snow'), token: _('a strip of dried meat'),
			offer: _("{name} don't stay put. walk with them, if you can catch them.")
		},
		archive_clerks: {
			sighting: [_('a low stone house in the shadow of the old works.'), _('inside, shelves. on the shelves, paper.'), _('someone is counting it.')],
			gate: _('the door is low and iron and has a slot in it.'),
			dress: _('with ink on their fingers'), where: _('the old works'), token: _('a page with a map on it'),
			offer: _("the clerks want a page from the old works. it's missing from the count.")
		},
		herders: {
			sighting: [_('sheep scattered over the grass, and a fold of piled stone.'), _("a child on the wall watches, and doesn't run.")],
			gate: _('the gate is a cart turned on its side.'),
			dress: _("in herder's wool"), where: _('the hills'), token: _('a bundle of meat'),
			flavour: { 25: _('they bring their flocks closer to the light.'), 50: _('the children come to look at the beacons.'), 75: _("they've stopped folding the sheep at night."), 100: _('they drive the flocks toward the hearth.') },
			join: _('the flocks come in with them.')
		},
		trappers_lodge: {
			sighting: [_('snares strung between the trunks, so many the path is hard to find.'), _('a lodge under the trees, pelts on every wall.')],
			gate: _('the way in is a gap in the snares, if you know where to look.'),
			dress: _('in a coat of pelts'), where: _('the trees'), token: _('a clutch of teeth on a string'),
			offer: _("the trappers want bait and cured meat. a winter's worth."),
			join: _('the snare lines are ours to walk now.')
		},
		stilt_fishers: {
			sighting: [_('huts on poles over the water, joined by planks.'), _('nets drying in the wind. the smell carries.')],
			gate: _('the gate is a ladder, pulled up.'),
			dress: _('smelling of the water'), where: _('the shore'), token: _('a fish, dried flat'),
			flavour: { 25: _('boats come closer to shore at night.'), 50: _('they hang a light at the end of the jetty.'), 75: _('they mend nets by the light, not by day.'), 100: _('they bring their boats in under the line.') },
			offer: _('the fishers want wood for the stilts. load after load.'),
			join: _('the boats tie up under our lamps.')
		},
		walled_holdfast: {
			sighting: [_('a wall across the pass. no gate that can be seen.'), _('a horn sounds once from the top.')],
			gate: _('a basket comes down on a rope.'),
			dress: _('in a helmet too big for them'), where: _('the wall'), token: _('an arrowhead'),
			offer: _('the holdfast want steel and weapons. a lot of both.') + ' ' + _('the holdfast want a watch fire on their pass. so they can see who comes.'),
			join: _('the horn on the wall sounds for us now.')
		},
		reavers: {
			sighting: [_('bones by the path, tied up in bundles, like a sign.'), _('smoke ahead, and laughing.')]
		},
		ash_faithful: {
			sighting: [_('grey robes on a grey hill.'), _('they kneel around a pile of cold stones at the top.'), _('singing, very low. no one looks up.')],
			gate: _('no gate. the singing goes quiet as you climb.'), noGate: true,
			dress: _('in grey'), where: _('the grey hill'), token: _('a handful of ash'),
			flavour: { 25: _('they sing facing the hearth now.'), 50: _('they carry ash from their hill to the beacon.'), 75: _('they keep the beacon nearest them lit themselves.'), 100: _('the faithful come down from the hill.') },
			offer: _('the faithful want their hill lit. it has been cold a long time.'),
			join: _('they take their place beside the hearth, and keep it.')
		},
		scavenger_camp: {
			sighting: [_('a camp on the lip of the crater, made of what came out of it.'), _('someone is lowered down on a rope. someone else pulls up a sack.')],
			gate: _('the gate is the door of something that used to move.'),
			dress: _('in patched oilcloth'), where: _("the crater's lip"), token: _('a bent piece of old metal'),
			offer: _("the scavengers want bread, meat and medicine. they're hungry, and some of them are sick."),
			join: _('the ropes go down into the crater for us now.')
		},
		the_sworn: {
			sighting: [_('a fence of old wire, kept mended.'), _('a sentry walks it, there and back.'), _('the coat is clean. the buttons shine.')],
			join: _('they put down the oath and pick up the work.')
		}
	},

	text: function (c) {
		return Events.CityStates.TEXT[c.t] || {};
	},

	// 3.2: the first sighting of each temperament, out on a trek
	sighting: function (c) {
		return {
			title: CityStates.TEMPERAMENTS[c.t].name,
			scenes: {
				start: {
					text: Events.CityStates.text(c).sighting.slice(),
					buttons: { 'go': { text: _('go on'), nextScene: 'end' } }
				}
			}
		};
	},

	// 3.4, sample scene 1: a stranger at the hearth, at 25
	stranger: function (c) {
		var t = Events.CityStates.text(c), fill = function (s) { return CityStates.fill(s, c, t); };
		var talk = function () {
			CityStates.tell(c);
			// the forge-masters' price is their own scene
			if (c.t === 'forge_masters') CityStates.queue(function () { Events.startEvent(Events.CityStates.coldForges(c)); });
		};
		return {
			title: _('A Stranger at the Hearth'),
			scenes: {
				start: {
					text: [fill(_('a stranger {dress} waits by the hearth.')), fill(_('says their people watch the light at night, from {where}.')),
						_("says they'd trade, while the light holds.")],
					notification: _('a stranger has come from the edge of the light'),
					blink: true,
					buttons: {
						'trade': { text: _('trade'), onChoose: talk, nextScene: { 1: 'traded' } },
						'home': { text: _('send them home'), onChoose: talk, nextScene: { 1: 'sent' } }
					}
				},
				traded: {
					text: [fill(_('the stranger nods. leaves {token} by the fire.'))],
					buttons: { 'go': { text: _('go on'), nextScene: 'end' } }
				},
				sent: {
					text: [_('the stranger goes back the way they came.')],
					buttons: { 'go': { text: _('go on'), nextScene: 'end' } }
				}
			}
		};
	},

	// 3.3, sample scene 2: the envoy reaches their gate
	gate: function (c) {
		var t = Events.CityStates.text(c);
		var after = function (choice) {
			return function () {
				CityStates.arrive(c, choice).forEach(function (l) { Notifications.notify(World, l); });
				// the bog-cutters offer the cutting again at the next visit
				if (c.t === 'bog_cutters' && CityStates.state(c.id).told[50] && !CityStates.state(c.id).cutting) {
					CityStates.queue(function () { Events.startEvent(Events.CityStates.bogCutters(c)); });
				}
			};
		};
		var buttons = {};
		if (!t.empty) {
			buttons.stay = { text: _('leave the envoy'), onChoose: after('stay'), nextScene: { 1: 'stayed' } };
			buttons.pack = { text: _('leave the pack'), onChoose: after('pack'), nextScene: { 1: 'packed' } };
		}
		buttons.back = { text: _('go back'), onChoose: after('back'), nextScene: { 1: 'back' } };
		var go = { 'go': { text: _('go on'), nextScene: 'end' } };
		return {
			title: c.name,
			scenes: {
				start: {
					text: t.noGate ? [t.gate] : [t.gate, _('faces watch over it a long time.'), _('then it opens.')],
					buttons: buttons
				},
				stayed: { text: [_('the envoy goes in. it closes behind them.')], buttons: go },
				packed: { text: [_('the pack is taken in.')], buttons: go },
				back: { text: [_('no one calls after you.')], buttons: go }
			}
		};
	},

	// sample scene 3: the bog-cutters at 50, a lead-in to F6 (F6 itself when they join: fixes C16)
	bogCutters: function (c) {
		return {
			title: _('The Bog-Cutters'),
			scenes: {
				start: {
					text: [_("the bog-cutters' eldest comes to the hearth, mud to the knee."), _("says peat burns low and long, if it's cut right and dried slow.")],
					notification: _('the bog-cutters have something to show'),
					blink: true,
					buttons: {
						'learn': {
							text: _('learn the cutting'),
							onChoose: function () { $SM.set('game.citystates.cs["' + c.id + '"].cutting', true); },
							nextScene: 'end'
						},
						'later': { text: _('not now'), nextScene: { 1: 'later' } }
					}
				},
				later: {
					text: [_('the eldest goes back to the bog. says the bog will keep.')],
					buttons: { 'go': { text: _('go on'), nextScene: 'end' } }
				}
			}
		};
	},

	// flame-draft F6: when the bog-cutters join. The tier is the flame era's (CityStates.beat).
	f6: function (c) {
		var choose = function (way) { return function () { $SM.set('game.citystates.beats.F6way', way); }; };
		var good = { 'good': { text: _('good'), nextScene: { 1: 'racks' } } };
		return {
			title: _('The Bog Cutters'),
			scenes: {
				start: {
					text: [_('a woman with a long thin spade stands up to her knees in the bog.'), _('cuts the black earth into squares, stacks them on the bank to dry.'),
						_('says the bog burns, if you let it dry. says it gives back slow.')],
					notification: _('the bog cutters will show you the cutting'),
					blink: true,
					buttons: {
						'way': { text: _('cut it their way'), onChoose: choose('their way'), nextScene: { 1: 'way' } },
						'deep': { text: _('cut it deep'), onChoose: choose('deep'), nextScene: { 1: 'deep' } }
					}
				},
				way: { text: [_('a few squares from each cut, no more.'), _('the bog closes over the cuts by spring.')], buttons: good },
				deep: { text: [_('the spade goes in to the handle.'), _('the stacks on the bank are tall.'), _('the bog is slow to close.')], buttons: good },
				racks: { text: [_('peat dries on the racks. it smokes, but it holds.')], buttons: { 'end': { text: _('good'), nextScene: 'end' } } }
			}
		};
	},

	// flame-draft B8: the same swamp city-state's lantern-keepers, after F6
	b8: function (c) {
		var good = { 'good': { text: _('good'), nextScene: 'end' } };
		return {
			title: _('The Lantern-Keepers'),
			scenes: {
				start: {
					text: [_('at dusk the keepers go out on the water in flat boats.'), _('lanterns hung low on poles, under the mist, not above it.'),
						_('says the mist eats a high light. a low one walks across the water.')],
					notification: _('lanterns are moving out over the marsh'),
					blink: true,
					buttons: {
						'take': { text: _('take up the lanterns'), nextScene: { 1: 'take' } },
						'ask': { text: _('ask about the other lights'), nextScene: { 1: 'ask' } }
					}
				},
				ask: {
					text: [_("says some lights out there aren't theirs."), _('says not to follow them.'), _("doesn't say what they are.")],
					buttons: { 'take': { text: _('take up the lanterns'), nextScene: { 1: 'take' } } }
				},
				take: { text: [_('the lanterns go out across the marsh, one after another.'), _('the line holds over the water.')], buttons: good }
			}
		};
	},

	// flame-draft H6: the potters join
	h6: function (c) {
		var good = { 'good': { text: _('good'), nextScene: 'end' } };
		var choose = function (how) { return function () { $SM.set('game.citystates.beats.H6build', how); }; };
		return {
			title: _('The Potters'),
			scenes: {
				start: {
					text: [_('the potters fire their pots in a closed oven of clay.'), _('they open it the next morning. the pots are still too hot to hold.'),
						_("says the heat stays, if you don't let it out.")],
					notification: _('the potters have a closed fire'),
					blink: true,
					buttons: {
						'clay': { text: _('build it of clay, their way'), onChoose: choose('clay'), nextScene: { 1: 'clay' } },
						'stone': { text: _('build it of stone'), onChoose: choose('stone'), nextScene: { 1: 'stone' } }
					}
				},
				clay: { text: [_('it takes a season to dry and fire the kiln itself.'), _('afterwards it holds heat for days.')], buttons: good },
				stone: { text: [_('up in a week.'), _('it holds heat, for a while.')], buttons: good }
			}
		};
	},

	// sample scene 5: the mirror folk reach 100
	mirrors: function (c) {
		return {
			title: _('Mirrors'),
			scenes: {
				start: {
					text: [_('the mirror folk never came to trade.'), _('they watched the fire cross the flats, one beacon at a time.'),
						_('tonight every mirror on their roofs turns toward the hearth.')],
					notification: _('light flashes from the mirror town'),
					blink: true,
					buttons: { 'go': { text: _('go on'), nextScene: { 1: 'sent' } } }
				},
				sent: {
					text: [_('they send a mirror, and someone who knows how to tilt it.')],
					buttons: { 'good': { text: _('good'), nextScene: 'end' } }
				}
			}
		};
	},

	// sample scene 4: the forge-masters' price (F9 when paid)
	coldForges: function (c) {
		var price = CityStates.tribute(c.t, c.band);
		return {
			title: _('Cold Forges'),
			scenes: {
				start: {
					text: [_('smoke over the hill towns, but no fire in the forges.'), _('the forge-masters want coal. a great deal of it.'),
						_('say the garrison in the deep mines kept it from them for years.')],
					buttons: {
						'pay': {
							text: _('pay'), cost: price,
							onChoose: function () { CityStates.join(c, 'price'); },
							nextScene: { 1: 'paid' }
						},
						'later': { text: _('not yet'), nextScene: { 1: 'later' } }
					}
				},
				paid: {
					text: [_('the forges catch.'), _('they show how coal is baked to coke. it burns hotter than anything.')],
					buttons: { 'good': { text: _('good'), nextScene: 'end' } }
				},
				later: {
					text: [_('the hammers stay on the walls.')],
					buttons: { 'go': { text: _('go on'), nextScene: 'end' } }
				}
			}
		};
	}
};
