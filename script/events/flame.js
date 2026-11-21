/**
 * The flame era's fixed story events (design/LADDERS.md tiers 5-8, design/text/flame-draft.md,
 * approved text), started by Network when their moment comes (Network.flameStory, onStep, onHome).
 *   the charcoal stranger            oldChimney (H5) -> stranger -> pits (a trek) -> burningPits (F5)
 *   the garrison of the deep mines   smoke -> gate (a trek); the siege and the captain are Phase 6's
 * The city-states' scenes (F6, B8, H6) are Phase 4's (script/events/citystates.js).
 * Each is a function, so a scene can name its city or its road.
 */
Events.Flame = {
	// the resettled fallen city the chain plays in
	city: function () {
		return $SM.get('game.network.story["the charcoal stranger"]');
	},

	oldChimney: function () {
		var choose = function (way) {
			return function () {
				$SM.set('game.network.story.strangerTicks', Network.STRANGER_WAIT);
				Network.setFlag('oldChimney', way);
			};
		};
		return {
			title: _('The Old Chimney'),
			scenes: {
				'start': {
					text: [
						_('the settlers clear the rubble from the old square.'),
						_('under it, a hearth. above it, a chimney, still standing.'),
						_('the soot inside is older than anyone here.')
					],
					notification: _('there is an old hearth under the rubble'),
					blink: true,
					buttons: {
						'rebuild': { text: _('rebuild the chimney'), onChoose: choose('rebuild'), nextScene: { 1: 'rebuilt' } },
						'new': { text: _('build a new hearth beside it'), onChoose: choose('new'), nextScene: { 1: 'new' } }
					}
				},
				'rebuilt': {
					text: [_('the smoke goes up, not out.'), _('the fire draws hard. the room around it is warm.')],
					buttons: { 'end': { text: _('good'), nextScene: 'end' } }
				},
				'new': {
					text: [_('the new hearth catches. the old chimney stands over it, cold.')],
					buttons: { 'end': { text: _('good'), nextScene: 'end' } }
				}
			}
		};
	},

	stranger: function () {
		return {
			title: _('A Stranger in the Ruins'),
			scenes: {
				'start': {
					text: [
						_('someone is living in the cellars under the old city.'),
						_('hands black to the wrist. soot in the lines of the face.'),
						_('says they never left. says the fire never left either, not all of it.')
					],
					notification: _('someone was already living in the ruins'),
					blink: true,
					buttons: {
						'sit': {
							text: _('sit with them'),
							onChoose: function () {
								Network.setFlag('strangerSat');
								Network.placePits(Events.Flame.city());
							},
							nextScene: { 1: 'sat' }
						},
						'leave': {
							text: _('leave them be'),
							onChoose: function () {
								// they come back once, a while later, then stop asking
								$SM.add('game.network.story.strangerAsked', 1);
								$SM.set('game.network.story.strangerTicks', Network.STRANGER_WAIT);
							},
							nextScene: { 1: 'left' }
						}
					}
				},
				'sat': {
					text: [
						_('says wood burns twice, if you burn it first without air.'),
						_('says the pits are out in the trees, where the old city kept them.'),
						_('scratches a mark in the ash.')
					],
					buttons: { 'end': { text: _('go back'), nextScene: 'end' } }
				},
				'left': {
					text: [_('the stranger goes back down into the dark.')],
					buttons: { 'end': { text: _('go back'), nextScene: 'end' } }
				}
			}
		};
	},

	// out on a trek, at the old pits. What it finds is the trek's to carry home (Network.onHome)
	pits: function () {
		var found = function (how) { return function () { World.state.pitsFound = how; }; };
		return {
			title: _('The Old Pits'),
			scenes: {
				'start': {
					text: [
						_('round hollows in the forest floor, a dozen or more.'),
						_('the earth around them is black, and nothing grows in it.'),
						_('something has made a den in the largest.')
					],
					buttons: {
						'clear': { text: _('clear it out'), nextScene: { 1: 'fight' } },
						'take': { text: _("take what's here"), nextScene: { 1: 'took' } },
						'leave': { text: _('leave'), nextScene: 'end' }
					}
				},
				// a forest beast a tier harder than the ones near home: the original's man-eater
				'fight': {
					combat: true,
					enemy: 'man-eater',
					enemyName: _('man-eater'),
					deathMessage: _('the man-eater is dead'),
					chara: 'T',
					damage: 3,
					hit: 0.8,
					attackDelay: 1,
					health: 25,
					loot: {
						'fur': { min: 5, max: 10, chance: 1 },
						'meat': { min: 5, max: 10, chance: 1 },
						'teeth': { min: 5, max: 10, chance: 0.8 }
					},
					notification: _('a large creature attacks, claws freshly bloodied'),
					buttons: { 'continue': { text: _('continue'), nextScene: { 1: 'cleared' } } }
				},
				'cleared': {
					onLoad: found('cleared'),
					text: [_('the den was dug over an old stack, still covered in turf.'), _('under the turf, charcoal. light as bark, black as the pit.')],
					// provisional: a larger stock to start with
					loot: { 'charcoal': { min: 20, max: 30, chance: 1 } },
					buttons: { 'end': { text: _('go on'), nextScene: 'end' } }
				},
				'took': {
					onLoad: found('took'),
					text: [_('a few lumps of charcoal, half buried.'), _('the stranger will want to know the pit is still there.')],
					loot: { 'charcoal': { min: 3, max: 6, chance: 1 } },
					buttons: { 'end': { text: _('go on'), nextScene: 'end' } }
				}
			}
		};
	},

	burningPits: function () {
		var choose = function (way) {
			return function () {
				$SM.set('game.network.story.codaTicks', Network.CODA_WAIT);
				Network.setFlag('charcoalWay', way); // F5; the collier works the way chosen (City.WAYS)
			};
		};
		return {
			title: _('The Burning Pits'),
			scenes: {
				'start': {
					text: [
						_('the stranger turns the charcoal over in black hands.'),
						_('says the pits are slow. stack the wood, cover it with turf, light it, and wait.'),
						_('says three days. no more air than a breath.')
					],
					buttons: {
						'their': { text: _('learn it their way'), onChoose: choose('their'), nextScene: { 1: 'their' } },
						'own': { text: _('learn it your own way'), onChoose: choose('own'), nextScene: { 1: 'own' } }
					}
				},
				'their': {
					text: [
						_('three days. the smoke is thin and blue the whole time.'),
						_('when the turf comes off, the wood is gone and the charcoal is there.'),
						_('it burns hot and far, and makes no smoke.')
					],
					buttons: { 'end': { text: _('good'), nextScene: 'end' } }
				},
				'own': {
					text: [
						_('the builder opens the pits early. more air, a hotter burn.'),
						_('less of it comes out of the earth.'),
						_('but it comes out in a day.')
					],
					buttons: { 'end': { text: _('good'), nextScene: 'end' } }
				}
			}
		};
	},

	smoke: function () {
		return {
			title: _('Smoke in the Hills'),
			scenes: {
				'start': {
					onLoad: function () { Network.garrison(); },
					text: [
						_('a trek comes back from the hills with a story.'),
						_("there's fire up there. not ours."),
						_('men and women in old coats, standing watch over a hole in the hill.')
					],
					notification: _('a trek saw fire in the hills'),
					blink: true,
					buttons: {
						'look': {
							text: _('go and look'),
							onChoose: function () {
								Network.setFlag('smoke', 'look');
								Network.markGarrison();
							},
							nextScene: { 1: 'look' }
						},
						'leave': {
							text: _('leave them to it'),
							// the site is marked anyway the next time a trek passes within sight (Network.onStep)
							onChoose: function () { Network.setFlag('smoke', 'leave'); },
							nextScene: { 1: 'leave' }
						}
					}
				},
				'look': {
					text: [_('the site is marked on the map.')],
					buttons: { 'end': { text: _('go back'), nextScene: 'end' } }
				},
				'leave': {
					text: [_('the fire in the hills is still there.')],
					buttons: { 'end': { text: _('go back'), nextScene: 'end' } }
				}
			}
		};
	},

	// out on a trek, at the garrison's site: the garrison is known, and the light won't win it
	// (powers yield only to force). The siege is Phase 6's
	gate: function () {
		var met = function () { World.state.gateMet = true; };
		var on = { 'end': { text: _('go on'), nextScene: 'end' } };
		return {
			title: _('The Gate'),
			scenes: {
				'start': {
					text: [
						_('a wall of slag across the pit head, higher than a man.'),
						_('a sentry on top, in a coat that was a uniform once.'),
						_('calls down that the mines are held. by order.'),
						_('asks whose order you march under.')
					],
					buttons: {
						'ask': { text: _('ask whose order they keep'), onChoose: met, nextScene: { 1: 'ask' } },
						'show': { text: _('show them the fire'), onChoose: met, nextScene: { 1: 'show' } },
						'walk': { text: _('walk away'), onChoose: met, nextScene: { 1: 'walk' } }
					}
				},
				'ask': {
					text: [_("the sentry doesn't know."), _('says the captain knows. says the captain has the papers.'), _('says no one comes up here anymore.')],
					buttons: on
				},
				'show': {
					text: [_('the sentry looks at it a long time.'), _('says the war needed fire too.'), _('says to take it back down the hill.')],
					buttons: on
				},
				'walk': {
					text: [_('a shout follows, and then nothing.')],
					buttons: on
				}
			}
		};
	},

	/*
	 * Carts along a road (B6, provisional; its lines are drafts, design/text/flame-build.md): a
	 * cart of up to Network.CART of a store at a time, from a city to one a road joins it to.
	 */
	carts: function (from, to) {
		var name = $SM.get('game.cities["' + to + '"].name'), buttons = {};
		// the goods it holds most of first, as many as fit
		Network.goods().map(function (k) { return [k, $SM.get(City.storePath(from, k), true)]; })
			.filter(function (g) { return g[1] >= 1; })
			.sort(function (a, b) { return b[1] - a[1]; })
			.slice(0, 6)
			.forEach(function (g) {
				buttons['send ' + g[0]] = {
					text: _('send {0}', _(g[0])),
					onChoose: function () {
						var n = Network.sendCart(from, to, g[0]);
						if (n) Notifications.notify(null, _('a cart of {0} {1} goes down the road to {2}.', n, _(g[0]), name));
					},
					nextScene: 'end'
				};
			});
		buttons['end'] = { text: _('not now'), nextScene: 'end' };
		return {
			title: _('The Road'),
			scenes: {
				'start': {
					text: [_('carts stand ready on the road to {0}.', name)],
					buttons: buttons
				}
			}
		};
	}
};
