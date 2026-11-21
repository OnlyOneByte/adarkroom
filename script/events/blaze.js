/**
 * The blaze era's fixed story events (design/LADDERS.md tiers 9-12), started by Network when their moment
 * comes (Network.blazeStory, onStep):
 *   the drowned harbour  harbour (B11) -> boats (F11), in the first coastal fallen city resettled after the
 *                        charcoal stranger's
 *   the black well       well (a trek, at the drifters' well) -> pumps (F12) -> boilerWrights (H12, once rock
 *                        oil is burned and the drifters have joined: they are the boiler-wrights, pending user)
 *   the bloomery         bloomery (H9), once a forge district touches the forge-masters' hearth
 *   the heliograph       heliograph (B12), once the mirror folk, the lighthouse and the fleet are in
 * The forge-masters' price (F9), the mirror folk (B9) and the tar-keepers' oath (F10) are Phase 4's scenes
 * (script/events/citystates.js); B10 and H11 come from the powers (Fire.unlock).
 *
 * Every line is in Events.Blaze.TEXT, so the approved text (design/text/blaze-draft.md) drops in there.
 */
Events.Blaze = {
	// TEXT PENDING blaze-draft: every line below is a short placeholder until blaze-draft.md is approved
	TEXT: {
		// one line as each tier comes in (Network.unlock)
		tiers: {
			F9: _('coal baked to coke burns hotter. the fire climbs the hills.'),               // TEXT PENDING blaze-draft
			F10: _('the tar pits are safe. pitch comes in from the desert.'),                 // TEXT PENDING blaze-draft
			F11: _('the boats come home heavy. whale oil burns long and bright.'),             // TEXT PENDING blaze-draft
			F12: _('rock oil from the black well. it burns like nothing else.'),               // TEXT PENDING blaze-draft
			B9: _('mirrors on the beacons. by day the light jumps the flats.'),                // TEXT PENDING blaze-draft
			B10: _('the pass is held. the fire goes through it whole.'),                       // TEXT PENDING blaze-draft
			B11: _('the lighthouse burns. the fire crosses the water.'),                       // TEXT PENDING blaze-draft
			B12: _('mirror and lamp together. the light carries further than the eye.'),       // TEXT PENDING blaze-draft
			H9: _('the bloomery stack is fired. the low fuels burn hotter in it.'),            // TEXT PENDING blaze-draft
			H10: _('the city is great now. its hearth is never let die.'),                     // TEXT PENDING blaze-draft
			H11: _("the foundry's furnace is ours. it eats fuel and gives fire."),            // TEXT PENDING blaze-draft
			H12: _('the boilers hiss. the fire holds steady, and asks little.')                // TEXT PENDING blaze-draft
		},
		harbour: {
			title: _('The Drowned Harbour'),                                                   // TEXT PENDING blaze-draft
			text: [_('the old harbour is under the water to its quays.'),                      // TEXT PENDING blaze-draft
				_('a lighthouse stands at the end of the mole, its lamp dark.')],              // TEXT PENDING blaze-draft
			notification: _('there is a lighthouse at the old harbour'),                      // TEXT PENDING blaze-draft
			light: _('light the lamp'),                                                        // TEXT PENDING blaze-draft
			later: _('not now'),                                                               // TEXT PENDING blaze-draft
			lit: [_('the lamp catches. the light goes out over the water.')],                  // TEXT PENDING blaze-draft
			left: [_('the lighthouse stays dark.')]                                            // TEXT PENDING blaze-draft
		},
		boats: {
			title: _('The Hulls'),                                                             // TEXT PENDING blaze-draft
			text: [_('old boats lie on the mud by the new harbour.'),                          // TEXT PENDING blaze-draft
				_('their hulls are sound. they want caulking, and sails.')],                   // TEXT PENDING blaze-draft
			notification: _('the old boats could float again'),                               // TEXT PENDING blaze-draft
			relaunch: _('relaunch them'),                                                      // TEXT PENDING blaze-draft
			later: _('not yet'),                                                               // TEXT PENDING blaze-draft
			done: [_('the boats go out on the tide. they come back with whale fat.')],         // TEXT PENDING blaze-draft
			left: [_('the boats stay on the mud.')]                                            // TEXT PENDING blaze-draft
		},
		// design/content/phase4-citystates.md "The Bloomery" (approved with Phase 4), used as the placeholder
		bloomery: {
			title: _('The Bloomery'),                                                          // TEXT PENDING blaze-draft
			text: [_('the smiths come down the hill to look at the new forge.'),               // TEXT PENDING blaze-draft
				_("say it's too open. iron wants a closed fire, and a slow one."),             // TEXT PENDING blaze-draft
				_('they build a squat clay stack beside it and fire it for a day.')],          // TEXT PENDING blaze-draft
			notification: _('the hill smiths are building something by the forge'),          // TEXT PENDING blaze-draft
			done: [_('the bloom comes out of the stack, black and spitting.'),                 // TEXT PENDING blaze-draft
				_("beaten, it's iron. more of it than the ore should give.")],                 // TEXT PENDING blaze-draft
			go: _('go on'), good: _('good')                                                    // TEXT PENDING blaze-draft
		},
		well: {
			title: _('The Black Well'),                                                        // TEXT PENDING blaze-draft
			text: [_('a black stain on the ice, wider than a hut.'),                           // TEXT PENDING blaze-draft
				_('an iron cap sits in the middle of it. pipes go down.')],                    // TEXT PENDING blaze-draft
			look: _('look closer'),                                                            // TEXT PENDING blaze-draft
			leave: _('leave'),                                                                 // TEXT PENDING blaze-draft
			found: [_('plates on the cap, stamped with old words.'),                           // TEXT PENDING blaze-draft
				_('the wanderer scratches them down to take home.')]                           // TEXT PENDING blaze-draft
		},
		pumps: {
			title: _('The Old Pumps'),                                                         // TEXT PENDING blaze-draft
			text: [_('the old words from the well make a kind of sense.'),                     // TEXT PENDING blaze-draft
				_('a pump, a seal, a way to draw it up. it needs steel.')],                    // TEXT PENDING blaze-draft
			notification: _('the plates from the well can be read'),                          // TEXT PENDING blaze-draft
			build: _('build the pumps'),                                                       // TEXT PENDING blaze-draft
			later: _('not yet'),                                                               // TEXT PENDING blaze-draft
			done: [_('the pumps go down the well. something thick comes up.')],                // TEXT PENDING blaze-draft
			left: [_('the plates go back in a box.')]                                          // TEXT PENDING blaze-draft
		},
		boilerWrights: {
			title: _('The Boiler-Wrights'),                                                    // TEXT PENDING blaze-draft
			// pending user: the boiler-wrights are the drifters
			text: [_('the drifters come in off the ice when they smell the rock oil.'),        // TEXT PENDING blaze-draft
				_('they say they built boilers once. they say they could again.')],            // TEXT PENDING blaze-draft
			notification: _('the drifters have come for the rock oil'),                       // TEXT PENDING blaze-draft
			take: _('take them in'),                                                           // TEXT PENDING blaze-draft
			done: [_('iron drums go up by the hearth. they hiss all night.')]                  // TEXT PENDING blaze-draft
		},
		heliograph: {
			title: _('The Heliograph'),                                                        // TEXT PENDING blaze-draft
			text: [_('the mirror folk come to the lighthouse.'),                               // TEXT PENDING blaze-draft
				_('the keepers show them the lamp. they show the keepers the mirrors.')],      // TEXT PENDING blaze-draft
			notification: _('the mirror folk have gone to the lighthouse'),                   // TEXT PENDING blaze-draft
			done: [_('by morning, a lamp behind a mirror. it flashes to the far hills.')]      // TEXT PENDING blaze-draft
		},
		// shared buttons
		good: _('good'),                                                                       // TEXT PENDING blaze-draft
		goBack: _('go back')                                                                   // TEXT PENDING blaze-draft
	},

	// a simple scene: start (its text, its buttons), then one scene per outcome
	scene: function (t, start, outcomes) {
		var scenes = { start: { text: t.text, notification: t.notification, blink: !!t.notification, buttons: start } };
		for (var k in outcomes) {
			scenes[k] = { text: outcomes[k], buttons: { 'end': { text: Events.Blaze.TEXT.good, nextScene: 'end' } } };
		}
		return { title: t.title, scenes: scenes };
	},

	// the first coastal fallen city resettled after the stranger's: its lighthouse (B11's beat)
	harbour: function () {
		var t = Events.Blaze.TEXT.harbour;
		return Events.Blaze.scene(t, {
			'light': { text: t.light, onChoose: function () { Network.setFlag('lighthouseLit'); }, nextScene: { 1: 'lit' } },
			'later': { text: t.later, nextScene: { 1: 'left' } }
		}, { lit: t.lit, left: t.left });
	},

	// its old boats, once it has a harbour district (F11's beat); provisional cost: caulking and sails
	BOATS: { 'wood': 400, 'cloth': 20 },
	boats: function () {
		var t = Events.Blaze.TEXT.boats;
		return Events.Blaze.scene(t, {
			'relaunch': { text: t.relaunch, cost: Events.Blaze.BOATS, onChoose: function () { Network.setFlag('boatsRelaunched'); }, nextScene: { 1: 'done' } },
			'later': { text: t.later, nextScene: { 1: 'left' } }
		}, { done: t.done, left: t.left });
	},

	// a forge district touches the forge-masters' hearth (H9's beat)
	bloomery: function () {
		var t = Events.Blaze.TEXT.bloomery;
		return Events.Blaze.scene(t, {
			'go': { text: t.go, onChoose: function () { Network.setFlag('bloomery'); }, nextScene: { 1: 'done' } }
		}, { done: t.done });
	},

	// out on a trek, at the drifters' black well: what it finds is the trek's to carry home (Network.onHome)
	well: function () {
		var t = Events.Blaze.TEXT.well;
		var scene = Events.Blaze.scene(t, {
			'look': { text: t.look, onChoose: function () { World.state.wellFound = true; }, nextScene: { 1: 'found' } },
			'leave': { text: t.leave, nextScene: 'end' }
		}, { found: t.found });
		scene.scenes.found.buttons.end.text = Events.Blaze.TEXT.goBack;
		return scene;
	},

	// home with the well's plates: the pumps pieced together (F12's beat); provisional cost
	PUMPS: { 'steel': 50, 'leather': 20 },
	pumps: function () {
		var t = Events.Blaze.TEXT.pumps;
		return Events.Blaze.scene(t, {
			'build': { text: t.build, cost: Events.Blaze.PUMPS, onChoose: function () { Network.setFlag('wellTapped'); }, nextScene: { 1: 'done' } },
			'later': { text: t.later, nextScene: { 1: 'left' } }
		}, { done: t.done, left: t.left });
	},

	// the first rock oil burned in a city, the drifters joined (H12's beat)
	boilerWrights: function () {
		var t = Events.Blaze.TEXT.boilerWrights;
		return Events.Blaze.scene(t, {
			'take': { text: t.take, onChoose: function () { Network.setFlag('boilerWrights'); }, nextScene: { 1: 'done' } }
		}, { done: t.done });
	},

	// the mirror folk joined, the lighthouse in and the fleet broken (B12's beat)
	heliograph: function () {
		var t = Events.Blaze.TEXT.heliograph;
		return Events.Blaze.scene(t, {
			'go': { text: Events.Blaze.TEXT.bloomery.go, onChoose: function () { Network.setFlag('heliograph'); }, nextScene: { 1: 'done' } }
		}, { done: t.done });
	}
};
