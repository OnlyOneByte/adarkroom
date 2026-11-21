/**
 * The ember era's fixed story events (design/LADDERS.md), started by Network when their
 * moment comes rather than drawn from the random pool.
 *   the world is bigger    stoneHearth (H3) -> biggerWorld (B1) -> firstBrazier
 *   the wanderer's cairns  wanderer -> cairn (out on a trek) -> cairnFire (home) (B3)
 * The original's own beats (light fire, the room is warm) unlock F1 and H1 as they always did.
 */
Events.Story = {
	stoneHearth: {
		title: _('The Stone Hearth'),
		scenes: {
			'start': {
				text: [
					_('the builder walks the edge of the huts, counting under her breath.'),
					_('says a town needs a hearth, not a campfire.'),
					_('says the old ones built theirs from stone.')
				],
				notification: _('the builder has an idea about the fire'),
				blink: true,
				buttons: {
					'build': {
						text: _('lay the stones'),
						cost: { 'wood': 200 },
						onChoose: function () { Network.setFlag('stoneHearth'); },
						nextScene: { 1: 'built' }
					},
					'later': {
						text: _('not yet'),
						nextScene: 'end'
					}
				}
			},
			'built': {
				text: [
					_('stone by stone, the hearth goes up around the old fire.'),
					_('it burns steadier. enough to feed more than the town.')
				],
				buttons: {
					'end': {
						text: _('good'),
						nextScene: 'end'
					}
				}
			}
		}
	},

	biggerWorld: {
		title: _('The Bigger World'),
		scenes: {
			'start': {
				text: [
					_('the builder stands by the new hearth, looking east a long time.'),
					_('the land runs on past the wasteland. further than anyone has walked.'),
					_('says a fire on high ground would carry. one brazier, then another, out into the dark.')
				],
				notification: _('the builder is looking at the dark'),
				blink: true,
				buttons: {
					'raise': {
						text: _('raise braziers'),
						onChoose: function () { Network.setFlag('brazier'); },
						notification: _('braziers can go up on the land, no more than three hexes apart.'),
						nextScene: 'end'
					}
				}
			}
		}
	},

	firstBrazier: {
		title: _('The First Brazier'),
		scenes: {
			'start': {
				text: [
					_('the brazier catches.'),
					_('out in the dark, a point of light that is ours.'),
					_('the ground around it feels less watched.')
				],
				buttons: {
					'end': {
						text: _('go back'),
						nextScene: 'end'
					}
				}
			}
		}
	},

	wanderer: {
		title: _('A Wanderer'),
		scenes: {
			'start': {
				text: [
					_('a wanderer sits down by the stone hearth without asking.'),
					_('says the old roads were marked with cairns, and the cairns had fire on them.'),
					_('says one still stands, not far.')
				],
				notification: _('a wanderer warms their hands at the hearth'),
				blink: true,
				buttons: {
					'ask': {
						text: _('ask where'),
						nextScene: { 1: 'told' }
					},
					'away': {
						text: _('send them off'),
						nextScene: 'end'
					}
				}
			},
			'told': {
				onLoad: function () {
					Network.setFlag('cairnTold');
					Network.placeCairn();
				},
				text: [
					_('the wanderer scratches a mark in the dirt by the fire.'),
					_('gone by morning.')
				],
				buttons: {
					'end': {
						text: _('go back'),
						nextScene: 'end'
					}
				}
			}
		}
	},

	cairn: {
		title: _('An Old Cairn'),
		scenes: {
			'start': {
				text: [
					_('a cairn, half fallen, taller than a man.'),
					_('the top stones are black with old soot.'),
					_('stacked so the fire sat high, out of the wind.')
				],
				buttons: {
					'study': {
						text: _('study the stacking'),
						nextScene: { 1: 'studied' }
					},
					'leave': {
						text: _('leave it'),
						nextScene: 'end'
					}
				}
			},
			'studied': {
				// the trek's to carry home, like the axe-head: lost with it on a death (Network.onHome)
				onLoad: function () { World.state.cairnStudied = true; },
				text: [
					_('the shape of it stays in mind.')
				],
				buttons: {
					'end': {
						text: _('go on'),
						nextScene: 'end'
					}
				}
			}
		}
	},

	cairnFire: {
		title: _('The Cairn Fire'),
		scenes: {
			'start': {
				onLoad: function () { Network.setFlag('cairnDone'); },
				text: [
					_('the builder listens, then stacks stones the way the cairn was stacked.'),
					_('the fire sits high and steady on top.'),
					_('it carries further.')
				],
				buttons: {
					'end': {
						text: _('good'),
						nextScene: 'end'
					}
				}
			}
		}
	}
};
