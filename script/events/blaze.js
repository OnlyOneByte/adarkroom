/**
 * The blaze era's fixed story events (design/LADDERS.md tiers 9-12, design/text/blaze-draft.md, approved),
 * started by Network when their moment comes (Network.blazeStory, onStep):
 *   the drowned harbour  harbour (a trek sees its site) -> keepers (resettled: B11) -> sunkenBoats (a harbour
 *                        district there) -> whales (F11)
 *   the black well       stain (a trek at the drifters' well) -> missingPlates (home: the plates fetched) ->
 *                        opened (a trek at the well with the plates: F12)
 *   single scenes        bloomery (H9, phase4-citystates' text), passHeld (B10), twoLights (B12), furnace (H11),
 *                        wrights (H12)
 * The forge-masters' price (F9), the mirror folk (B9) and the tar-keepers' oath (F10) are Phase 4's scenes
 * (script/events/citystates.js). The powers' own scenes (2-5) come with the powers.
 *
 * Every line is in Events.Blaze.TEXT.
 */
Events.Blaze = {
	TEXT: {
		// one line as a tier comes in (Network.unlock): the milestone, and the keepers' notice after B11
		tiers: {
			B11: _('the light on the point reaches across the water now.'),
			H10: _('the city is too big for one fire. they build a hearth the size of a square, and it holds.')
		},
		harbour: {
			title: _('The Drowned Harbour'),
			text: [_('a town on the shore, gone into the sea to its roofs.'), _('masts stand up out of the water in rows.'),
				_('on the point, a tower. a light at the top of it, small and yellow.')],
			notification: _('a light burns out on the point'),
			buttons: { tower: _('go to the tower'), leave: _('leave it') },
			after: {
				tower: [_('a door, barred from inside.'), _('someone moves at the top. the light goes out.'),
					_("when it comes back, it's aimed at you.")],
				leave: [_('the light turns slowly, out over the water.')]
			},
			end: _('go back'),
			hover: _('the drowned harbour. a light on the point.')
		},
		keepers: {
			title: _('The Keepers'),
			text: [_('the settlers make camp in the drowned streets.'),
				_('at night the tower door opens. two old people come down, a man and a woman, with a lamp.'),
				_("says they've kept the light since the water came. for the boats."), _('says the boats never came back.')],
			buttons: { keep: _('ask them to keep it'), teach: _('ask them to teach it') },
			after: {
				keep: [_('they go back up. the light burns all night, and the night after.')],
				teach: [_('the woman takes a settler up the stairs.'), _('they come down at dawn, smelling of oil.')]
			},
			end: _('good')
		},
		sunkenBoats: {
			title: _('The Sunken Boats'),
			text: [_('the old boats are down there, in the mud of the harbour.'), _('the keepers know where each one lies.'),
				_('divers go down on ropes. one hull, then another.')],
			notification: _("they're raising the boats in the drowned harbour"),
			go: _('go on'),
			after: [_('a boat comes up streaming, black with weed.'), _('it floats.'), _('by spring there are three on the water.')],
			end: _('good')
		},
		whales: {
			title: _('The Whales'),
			text: [_('the boats go out past the point, further than anyone has gone.'),
				_('they come back low in the water, towing something huge.'), _('the keepers cut it on the beach. the fat comes off in sheets.')],
			buttons: { render: _('render it all'), keep: _('keep some back for the lamps') },
			after: {
				render: [_('the vats boil for a week.'), _("the oil burns clean. it doesn't stink, like tallow.")],
				keep: [_('the lamp at the top of the tower burns brighter that night.'), _('the rest goes to the vats.')]
			},
			end: _('good')
		},
		stain: {
			title: _('The Black Stain'),
			text: [_('the snow is black here, in a ring.'), _('in the middle, an iron head on a pipe, big as a hut. rust to the bolts.'),
				_('the ice around it smells of the lamps.'), _('plates on the side, stamped with words. half of them sheared away.')],
			buttons: { rubbing: _('take a rubbing of the plates'), light: _('light the stain'), leave: _('leave') },
			after: {
				rubbing: [_('the words make no sense on their own.'), _('they tell how to open it. not how to keep it shut.')],
				light: [_('the snow catches, and burns blue, and goes out.'), _('something down there is still full.')],
				leave: [_('the wind fills the ring with white again.')]
			},
			end: _('go on'),
			hover: _('the black well. the ground here burns.')
		},
		missingPlates: {
			title: _('The Missing Plates'),
			text: [_('the drifters look at the rubbing a long time.'),
				_('the old woman says her mother worked the well. says it was never shut. it was capped, in the war.'),
				_('says the rest of the plates went south with the crews.')],
			notification: _("the drifters know where the rest of the well's words went"),
			buttons: { send: _('send a trek for them'), ask: _('ask what else her mother said') },
			after: {
				ask: [_('she says the oil came up hot, and the men who kept it fed fire to iron pots, all day.'),
					_('she says they were called wrights. no one now remembers why.')]
			},
			end: _('go on')
		},
		// the fetch's fail line (phase4-citystates: "the {thing} lies where the trek fell."), for the plates
		platesLost: _('the plates lie where the trek fell.'),
		opened: {
			title: _('The Black Well Opened'),
			text: [_('the plates fit the bolts. the words read through, top to bottom.'), _('the cap comes off with a sound like breath.'),
				_('it comes up black and slow, then fast.')],
			buttons: { run: _('let it run'), cap: _('cap it again, half way') },
			after: {
				run: [_('it runs over the snow all day before they get it into barrels.'), _('it burns hotter than coke, and longer.')],
				cap: [_('it comes up in a steady thread. barrels fill one by one.')]
			},
			end: _('good')
		},
		passHeld: {
			title: _('The Pass Held'),
			text: [_('dawn on the pass. the last of them have gone back down the far side.'),
				_('the beacon at the top is still burning. no one let it go out.'), _('from here the fire can see both ways.')],
			notification: _('the pass is held'),
			end: _('good')
		},
		twoLights: {
			title: _('The Two Lights'),
			text: [_('a keeper from the point and a woman from the flats meet at the hearth.'),
				_("neither has seen the other's light. both have heard of it."),
				_('the keeper says a light should turn. the woman says it should flash.')],
			buttons: { work: _('let them work it out'), argue: _('let them argue it out') },
			after: {
				work: [_('they build a mirror that turns, with a shutter in front.'), _('it speaks across six hills.')],
				argue: [_('they argue three days.'), _("on the fourth there's a mirror on the tower, turning, with a shutter.")]
			},
			end: _('good')
		},
		furnace: {
			title: _('The Furnace'),
			text: [_('the furnace stands three men high. it was never let go out.'),
				_("the crew's foremen show how it's fed: ore and coke and lime, all day, all night."), _('it eats fuel like a city.')],
			go: _('go on'),
			after: [_('the iron comes out of it running, like water.')],
			end: _('good')
		},
		wrights: {
			title: _('The Wrights'),
			text: [_('a drifter comes to the well with a hammer and an iron pot.'),
				_("says she's a wright. says her mother was. says this is what they did."),
				_('she fills the pot with water and sets the oil under it, and shuts the lid.')],
			notification: _('a drifter is building something at the black well'),
			buttons: { watch: _('watch'), help: _('help') },
			after: {
				watch: [_('the lid lifts, and screams, and the pot shakes on its legs.'), _("she laughs. says that's the fire, held in.")],
				help: [_('the pot is the size of a hut by nightfall.'), _("it hums. it doesn't need feeding for a long time.")]
			},
			end: _('good')
		},
		// design/content/phase4-citystates.md "The Bloomery" (approved with Phase 4)
		bloomery: {
			title: _('The Bloomery'),
			text: [_('the smiths come down the hill to look at the new forge.'),
				_("say it's too open. iron wants a closed fire, and a slow one."),
				_('they build a squat clay stack beside it and fire it for a day.')],
			notification: _('the hill smiths are building something by the forge'),
			go: _('go on'),
			after: [_('the bloom comes out of the stack, black and spitting.'), _("beaten, it's iron. more of it than the ore should give.")],
			end: _('good')
		}
	},

	/*
	 * A scene from its TEXT entry t: the start (its text and notification) with one button per t.buttons, each
	 * going to its t.after lines, ended by t.end; or, with no buttons, a t.go button to t.after (or straight
	 * t.end when there is no after). done(key) runs on the chosen button.
	 */
	scene: function (t, done) {
		var start = { text: t.text, notification: t.notification, blink: !!t.notification, buttons: {} }, scenes = { start: start };
		var after = function (k, lines) {
			scenes[k] = { text: lines, buttons: { 'end': { text: t.end, nextScene: 'end' } } };
		};
		if (t.buttons) {
			Object.keys(t.buttons).forEach(function (k) {
				var lines = t.after && t.after[k];
				start.buttons[k] = { text: t.buttons[k], onChoose: function () { done(k); }, nextScene: lines ? { 1: k } : 'end' };
				if (lines) after(k, lines);
			});
		} else if (t.after) {
			start.buttons.go = { text: t.go, onChoose: function () { done('go'); }, nextScene: { 1: 'after' } };
			after('after', t.after);
		} else {
			start.buttons.end = { text: t.end, onChoose: function () { done('end'); }, nextScene: 'end' };
		}
		return { title: t.title, scenes: scenes };
	},

	flag: function (k) {
		return function () { Network.setFlag(k); };
	},

	// on a trek, the drowned harbour's site in sight: marked either way
	harbour: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.harbour, function () { Network.markHarbour(); });
	},

	// the drowned harbour resettled: B11 (both choices the same)
	keepers: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.keepers, Events.Blaze.flag('lighthouseLit'));
	},

	// a harbour district in the drowned harbour: its boats come up (the district is the whole cost), then the whales
	sunkenBoats: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.sunkenBoats, function () {
			Network.setFlag('boatsRaised');
			Network._nextAsk = 0; // the whales straight after
		});
	},

	// the boats' first time out: F11 (both choices the same)
	whales: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.whales, Events.Blaze.flag('boatsRelaunched'));
	},

	// on a trek, at the drifters' well: a rubbing is what the trek carries home (Network.onHome)
	stain: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.stain, function (k) { if (k === 'rubbing') World.state.wellFound = true; });
	},

	// home with the rubbing: the plates are fetched from a site south of the well (Network.platesSite)
	missingPlates: function () {
		var t = Events.Blaze.TEXT.missingPlates, send = function () {
			var site = Network.platesSite();
			if (site) site.hexes.forEach(function (h) { World.uncoverMap(h[0], h[1], 0, World.hex.mask); });
			World.saveHex(World.worldFlags());
			Network.setFlag('platesSent');
		};
		var e = Events.Blaze.scene(t, function (k) { if (k === 'send') send(); });
		// "ask" tells the rest, then the same as "send"
		e.scenes.ask.buttons.end.onChoose = send;
		return e;
	},

	// at the well with the plates: F12 (both choices the same)
	opened: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.opened, function () {
			World.state.plates = false;
			Network.setFlag('plates', false);
			Network.setFlag('wellTapped');
		});
	},

	// a forge district touches the forge-masters' hearth (H9's beat)
	bloomery: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.bloomery, Events.Blaze.flag('bloomery'));
	},

	// the pass wardens' counter-siege survived (B10 comes with their beat, Network.BEATS)
	passHeld: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.passHeld, Events.Blaze.flag('passSeen'));
	},

	// both peoples ours and the fleet broken (B12's beat; both choices the same)
	twoLights: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.twoLights, Events.Blaze.flag('heliograph'));
	},

	// straight after the foundry's aftermath (H11 comes with its beat)
	furnace: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.furnace, Events.Blaze.flag('furnaceSeen'));
	},

	// F12 in and the drifters joined: they are the boiler-wrights (H12's beat; both choices the same)
	wrights: function () {
		return Events.Blaze.scene(Events.Blaze.TEXT.wrights, Events.Blaze.flag('boilerWrights'));
	}
};
