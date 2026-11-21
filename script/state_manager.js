/*
 * Module for handling States
 *
 * All states should be get and set through the StateManager ($SM).
 *
 * The manager is intended to handle all needed checks and error catching.
 * This includes creating the parents of layered/deep states so undefined states
 * do not need to be tested for and created beforehand.
 *
 * When a state is changed, an update event is sent out containing the name of the state
 * changed or in the case of multiple changes (.setM, .addM) the parent class changed.
 * Event: type: 'stateUpdate', stateName: <path of state or parent state>
 *
 * Original file created by: Michael Galusha
 */

var StateManager = {

	MAX_STORE: 99999999999999,

	options: {},

	init: function(options) {
		this.options = $.extend(
				this.options,
				options
		);

		//create categories
		var cats = [
			'features',     // big features like buildings, location availability, unlocks, etc
			'stores',       // little stuff, items, weapons, etc
			'character',    // this is for player's character stats such as perks
			'income',
			'timers',
			'game',         // mostly location related: fire temp, workers, population, world map, etc
			'playStats',    // anything play related: play time, loads, etc
			'previous',     // prestige, score, trophies (in future), achievements (again, not yet), etc
			'outfit',      	// used to temporarily store the items to be taken on the path
			'config',
			'wait',			// mysterious wanderers are coming back
			'cooldown'      // residual values for cooldown buttons
		];

		for(var which in cats) {
			if(!$SM.get(cats[which])) $SM.set(cats[which], {});
		}

		//subscribe to stateUpdates
		$.Dispatch('stateUpdate').subscribe($SM.handleStateUpdates);
	},

	//create all parents and then set state
	createState: function(stateName, value) {
		var words = stateName.split(/[.\[\]'"]+/);
		//for some reason there are sometimes empty strings
		for (var j = 0; j < words.length; j++) {
			if (words[j] === '') {
				words.splice(j, 1);
				j--;
			}
		}
		var obj = State;
		var w = null;
		for(var i=0, len=words.length-1;i<len;i++){
			w = words[i];
			if(obj[w] === undefined ) obj[w] = {};
			obj = obj[w];
		}
		obj[words[i]] = value;
		return obj;
	},

	//set single state
	//if noEvent is true, the update event won't trigger, useful for setting multiple states first
	set: function(stateName, value, noEvent) {
		//make sure the value isn't over the engine maximum
		if(typeof value == 'number' && value > $SM.MAX_STORE) value = $SM.MAX_STORE;

		$SM.assign(stateName, value);

		//stores values can not be negative
		if(stateName.indexOf('stores') === 0 && $SM.get(stateName, true) < 0) {
			$SM.assign(stateName, 0);
			Engine.log('WARNING: state:' + stateName + ' can not be a negative value. Set to 0 instead.');
		}

		if(!noEvent) {
			Engine.saveGame();
			$SM.fireUpdate(stateName);
		}
	},

	//sets a list of states
	setM: function(parentName, list, noEvent) {
		$SM.buildPath(parentName);

		//make sure the state exists to avoid errors,
		if($SM.get(parentName) === undefined) $SM.set(parentName, {}, true);

		for(var k in list){
			$SM.set(parentName+'["'+k+'"]', list[k], true);
		}

		if(!noEvent) {
			Engine.saveGame();
			$SM.fireUpdate(parentName);
		}
	},

	//shortcut for altering number values, return 1 if state wasn't a number
	add: function(stateName, value, noEvent) {
		var err = 0;
		//0 if undefined, null (but not {}) should allow adding to new objects
		//could also add in a true = 1 thing, to have something go from existing (true)
		//to be a count, but that might be unwanted behavior (add with loose eval probably will happen anyways)
		var old = $SM.get(stateName, true);

		//check for NaN (old != old) and non number values
		if(old != old){
			Engine.log('WARNING: '+stateName+' was corrupted (NaN). Resetting to 0.');
			old = 0;
			$SM.set(stateName, old + value, noEvent);
		} else if(typeof old != 'number' || typeof value != 'number'){
			Engine.log('WARNING: Can not do math with state:'+stateName+' or value:'+value+' because at least one is not a number.');
			err = 1;
		} else {
			$SM.set(stateName, old + value, noEvent); //setState handles event and save
		}

		return err;
	},

	//alters multiple number values, return number of fails
	addM: function(parentName, list, noEvent) {
		var err = 0;

		//make sure the parent exists to avoid errors
		if($SM.get(parentName) === undefined) $SM.set(parentName, {}, true);

		for(var k in list){
			if($SM.add(parentName+'["'+k+'"]', list[k], true)) err++;
		}

		if(!noEvent) {
			Engine.saveGame();
			$SM.fireUpdate(parentName);
		}
		return err;
	},

	//return state, undefined or 0
	get: function(stateName, requestZero) {
		var whichState = null;
		var k = $SM.keys(stateName);

		if(k) {
			//walk the path; a missing parent reads as undefined
			whichState = State;
			for(var i = 0; i < k.length && whichState != null; i++) whichState = whichState[k[i]];
			if(i < k.length) whichState = undefined;
		} else {
			//catch errors if parent of state doesn't exist
			try{
				eval('whichState = ('+$SM.buildPath(stateName)+')');
			} catch (e) {
				whichState = undefined;
			}
		}

		//prevents repeated if undefined, null, false or {}, then x = 0 situations
		if((!whichState || whichState == {}) && requestZero) return 0;
		else return whichState;
	},

	//mainly for local copy use, add(M) can fail so we can't shortcut them
	//since set does not fail, we know state exists and can simply return the object
	setget: function(stateName, value, noEvent){
		$SM.set(stateName, value, noEvent);
		return $SM.keys(stateName) ? $SM.get(stateName) : eval('('+$SM.buildPath(stateName)+')');
	},

	remove: function(stateName, noEvent) {
		var k = $SM.keys(stateName), parent = k ? $SM.parentOf(k) : null;
		if(k && parent != null) {
			delete parent[k[k.length - 1]];
		} else {
			try{
				if(k) throw 'no parent';
				eval('(delete '+$SM.buildPath(stateName)+')');
			} catch (e) {
				//it didn't exist in the first place
				Engine.log('WARNING: Tried to remove non-existant state \''+stateName+'\'.');
			}
		}
		if(!noEvent){
			Engine.saveGame();
			$SM.fireUpdate(stateName);
		}
	},

	removeBranch: function(stateName, noEvent) {
		for(var i in $SM.get(stateName)){
			if(typeof $SM.get(stateName)[i] == 'object'){
				$SM.removeBranch(stateName +'["'+ i +'"]');
			}
		}
		if($.isEmptyObject($SM.get(stateName))){
			$SM.remove(stateName);
		}
		if(!noEvent){
			Engine.saveGame();
			$SM.fireUpdate(stateName);
		}
	},

	/*
	 * A state name as the keys it walks: 'game.cities["x"].stores[\'wood\']' -> ['game', 'cities',
	 * 'x', 'stores', 'wood']. Split once per name and kept, so a read is a walk, not an eval (perf).
	 * null when the name isn't a plain path; then eval reads and writes it, as it always did.
	 */
	_keys: {},
	_nKeys: 0,
	KEY: /(\.)?([A-Za-z_$][\w$]*)|\["([^"\\]*)"\]|\['([^'\\]*)'\]|\[(\d+)\]/g,
	keys: function(stateName) {
		var k = $SM._keys[stateName];
		if(k !== undefined) return k;
		k = stateName ? [] : null;
		for(var pos = 0, re = $SM.KEY, m; k && pos < stateName.length; pos = re.lastIndex) {
			re.lastIndex = pos;
			m = re.exec(stateName);
			// a name after a dot, the first one without; or a quoted or numbered key in brackets
			if(!m || m.index !== pos || (m[2] !== undefined && !m[1] !== (pos === 0))) k = null;
			else k.push(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]);
		}
		// shortcut: the cache only grows with distinct names (stores x cities, hexes); dropped past a bound
		if(++$SM._nKeys > 50000) {
			$SM._keys = {};
			$SM._nKeys = 0;
		}
		return ($SM._keys[stateName] = k);
	},

	//the object holding the last key, or undefined/null if a parent is missing
	parentOf: function(k) {
		var o = State;
		for(var i = 0; i < k.length - 1 && o != null; i++) o = o[k[i]];
		return i < k.length - 1 ? undefined : o;
	},

	//State[path] = value, making any missing parents
	assign: function(stateName, value) {
		var k = $SM.keys(stateName), parent = k ? $SM.parentOf(k) : null;
		if(k && parent != null) {
			parent[k[k.length - 1]] = value;
			return;
		}
		try{
			if(k) throw 'no parent';
			eval('('+$SM.buildPath(stateName)+') = value');
		} catch (e) {
			//parent doesn't exist, so make parent
			$SM.createState(stateName, value);
		}
	},

	//creates full reference from input
	//hopefully this won't ever need to be more complicated
	buildPath: function(input){
		var dot = (input.charAt(0) == '[')? '' : '.'; //if it starts with [foo] no dot to join
		return 'State' + dot + input;
	},

	fireUpdate: function(stateName, save){
		var category = $SM.getCategory(stateName);
		if(stateName === undefined) stateName = category = 'all'; //best if this doesn't happen as it will trigger more stuff
		$.Dispatch('stateUpdate').publish({'category': category, 'stateName':stateName});
		if(save) Engine.saveGame();
	},

	getCategory: function(stateName){
		var firstOB = stateName.indexOf('[');
		var firstDot = stateName.indexOf('.');
		var cutoff = null;
		if(firstOB == -1 || firstDot == -1){
			cutoff = firstOB > firstDot ? firstOB : firstDot;
		} else {
			cutoff = firstOB < firstDot ? firstOB : firstDot;
		}
		if (cutoff == -1){
			return stateName;
		} else {
			return stateName.substr(0,cutoff);
		}
	},

	//Use this function to make old save games compatible with new version
	updateOldState: function(){
		var version = $SM.get('version');
		if(typeof version != 'number') version = 1.0;
		if(version == 1.0) {
			// v1.1 introduced the Lodge, so get rid of lodgeless hunters
			$SM.remove('outside.workers.hunter', true);
			$SM.remove('income.hunter', true);
			Engine.log('upgraded save to v1.1');
			version = 1.1;
		}
		if(version == 1.1) {
			//v1.2 added the Swamp to the map, so add it to already generated maps
			if($SM.get('world')) {
				World.placeLandmark(15, World.RADIUS * 1.5, World.TILE.SWAMP, $SM.get('world.map'));
			}
			Engine.log('upgraded save to v1.2');
			version = 1.2;
		}
		if(version == 1.2) {
			//StateManager added, so move data to new locations
			$SM.remove('room.fire');
			$SM.remove('room.temperature');
			$SM.remove('room.buttons');
			if($SM.get('room')){
				$SM.set('features.location.room', true);
				$SM.set('game.builder.level', $SM.get('room.builder'));
				$SM.remove('room');
			}
			if($SM.get('outside')){
				$SM.set('features.location.outside', true);
				$SM.set('game.population', $SM.get('outside.population'));
				$SM.set('game.buildings', $SM.get('outside.buildings'));
				$SM.set('game.workers', $SM.get('outside.workers'));
				$SM.set('game.outside.seenForest', $SM.get('outside.seenForest'));
				$SM.remove('outside');
			}
			if($SM.get('world')){
				$SM.set('features.location.world', true);
				$SM.set('game.world.map', $SM.get('world.map'));
				$SM.set('game.world.mask', $SM.get('world.mask'));
				$SM.set('starved', $SM.get('character.starved', true));
				$SM.set('dehydrated', $SM.get('character.dehydrated', true));
				$SM.remove('world');
				$SM.remove('starved');
				$SM.remove('dehydrated');
			}
			if($SM.get('ship')){
				$SM.set('features.location.spaceShip', true);
				$SM.set('game.spaceShip.hull', $SM.get('ship.hull', true));
				$SM.set('game.spaceShip.thrusters', $SM.get('ship.thrusters', true));
				$SM.set('game.spaceShip.seenWarning', $SM.get('ship.seenWarning'));
				$SM.set('game.spaceShip.seenShip', $SM.get('ship.seenShip'));
				$SM.remove('ship');
			}
			if($SM.get('punches')){
				$SM.set('character.punches', $SM.get('punches'));
				$SM.remove('punches');
			}
			if($SM.get('perks')){
				$SM.set('character.perks', $SM.get('perks'));
				$SM.remove('perks');
			}
			if($SM.get('thieves')){
				$SM.set('game.thieves', $SM.get('thieves'));
				$SM.remove('thieves');
			}
			if($SM.get('stolen')){
				$SM.set('game.stolen', $SM.get('stolen'));
				$SM.remove('stolen');
			}
			if($SM.get('cityCleared')){
				$SM.set('character.cityCleared', $SM.get('cityCleared'));
				$SM.remove('cityCleared');
			}
			$SM.set('version', 1.3);
			version = 1.3;
		}
		if(version == 1.3) {
			// v2.0 added the town; its state (game.city) is created when it unlocks
			Engine.log('upgraded save to v2.0');
			$SM.set('version', 2.0);
			version = 2.0;
		}
		if(version == 2.0) {
			// v2.1 grows the world from a seed; maps made before it get one now.
			// A town that is already open gets its hex map when World.init runs.
			if($SM.get('game.world') && typeof $SM.get('game.world.seed') != 'number') {
				$SM.set('game.world.seed', WorldGen.newSeed(), true);
			}
			Engine.log('upgraded save to v2.1');
			$SM.set('version', 2.1);
			version = 2.1;
		}
		if(version == 2.1) {
			// v2.2 adds danger and a difficulty; games made before it play at normal.
			// Their bands start unseen, so the wanderer hears each hint once.
			if($SM.get('game.difficulty') === undefined) $SM.set('game.difficulty', Danger.DEFAULT_DIFFICULTY, true);
			Engine.log('upgraded save to v2.2');
			$SM.set('version', 2.2);
			version = 2.2;
		}
		if(version == 2.2) {
			// v2.3 has no happiness: only the fire matters (DESIGN.md "Cities & economy").
			// The fire network (game.network) and each city's place on the map start on load.
			var cities = $SM.get('game.cities') || {};
			for(var id in cities) {
				delete cities[id].happiness;
			}
			Engine.log('upgraded save to v2.3');
			$SM.set('version', 2.3);
			version = 2.3;
		}
		if(version == 2.3) {
			// v2.4 founds more cities: each city's governor remembers what it has told the player,
			// and a focus from before the governors (no 'fire' then) is kept only if it is still one.
			var cs = $SM.get('game.cities') || {};
			for(var cid in cs) {
				if(!cs[cid].notices) cs[cid].notices = {};
				if(cs[cid].focus && City.FOCUSES.indexOf(cs[cid].focus) < 0) cs[cid].focus = null;
			}
			Engine.log('upgraded save to v2.4');
			$SM.set('version', 2.4);
			version = 2.4;
		}
		if(version == 2.4) {
			// v2.5 has city-states (game.citystates): a world already on hexes gets them when it loads,
			// placed around the cities and beacons it has
			Engine.log('upgraded save to v2.5');
			$SM.set('version', 2.5);
			version = 2.5;
		}
		if(version == 2.5) {
			// v2.6 has armies and sieges (game.armies): it starts empty on load
			Engine.log('upgraded save to v2.6');
			$SM.set('version', 2.6);
			version = 2.6;
		}
		if(version == 2.6) {
			// v2.7 is the flame era (script/network.js): tiers 5-8 unlock from the story the save already
			// has; carts on the road (game.network.carts) start empty
			if($SM.get('game.network') && !$SM.get('game.network.carts')) $SM.set('game.network.carts', [], true);
			Engine.log('upgraded save to v2.7');
			$SM.set('version', 2.7);
			version = 2.7;
		}
		if(version == 2.7) {
			// v2.8 has the war-remnant powers (game.powers, script/powers.js): it starts empty on load; a save
			// that already has F8 (coal) had its garrison broken some other way, so the garrison stays broken
			if($SM.get('game.network.tiers.F8')) $SM.set('game.powers', { garrison: { broken: true, way: null } }, true);
			// the generator's version 2 moved only the garrison's complex (WorldGen._garrison): the hex map's
			// deltas and mask still fit, so it is marked version 2, not re-projected; the garrison is picked
			// again where it now stands (and seen again, if it was marked: Powers.init)
			if($SM.get('game.world.hex.gen') === 1) $SM.set('game.world.hex.gen', 2, true);
			if($SM.get('game.network.garrison')) $SM.remove('game.network.garrison', true);
			Engine.log('upgraded save to v2.8');
			$SM.set('version', 2.8);
			version = 2.8;
		}
		if(version == 2.8) {
			// v2.9 is the blaze era (script/network.js, script/events/blaze.js): tiers 9-12 unlock from the story
			// the save already has (the city-states' F9 / B9 / F10 beats). A save that resettled fallen cities
			// may already hold the drowned harbour's: Network looks for it once the hex map is up
			if($SM.get('game.network.story.resettled', true) > 1) $SM.set('game.network.story.harbourScan', true, true);
			Engine.log('upgraded save to v2.9');
			$SM.set('version', 2.9);
			version = 2.9;
		}
	},

	/******************************************************************
	 * Start of specific state functions
	 ******************************************************************/
	//PERKS
	addPerk: function(name) {
		$SM.set('character.perks["'+name+'"]', true);
		Notifications.notify(null, Engine.Perks[name].notify);
	},

	hasPerk: function(name) {
		return $SM.get('character.perks["'+name+'"]');
	},

	//INCOME
	setIncome: function(source, options) {
		var existing = $SM.get('income["'+source+'"]');
		if(typeof existing != 'undefined') {
			options.timeLeft = existing.timeLeft;
		}
		$SM.set('income["'+source+'"]', options);
	},

	getIncome: function(source) {
		var existing = $SM.get('income["'+source+'"]');
		if(typeof existing != 'undefined') {
			return existing;
		}
		return {};
	},

	collectIncome: function() {
		var changed = false;
		if(typeof $SM.get('income') != 'undefined' && Engine.activeModule != Space) {
			for(var source in $SM.get('income')) {
				var income = $SM.get('income["'+source+'"]');
				if(typeof income.timeLeft != 'number')
				{
					income.timeLeft = 0;
				}
				income.timeLeft--;

				if(income.timeLeft <= 0) {
					Engine.log('collection income from ' + source);
					if(source == 'thieves') $SM.addStolen(income.stores);

					// city-scoped sources (income.city) pay into that city's own stores
					var target = income.city ? 'game.cities["' + income.city + '"].stores' : 'stores';
					var cost = income.stores;
					var ok = true;
					if (source != 'thieves') {
						for (var k in cost) {
							var have = $SM.get(target + '["' + k + '"]', true);
							if (have + cost[k] < 0) {
								ok = false;
								break;
							}
						}
					}

					if(ok){
						$SM.addM(target, income.stores, true);
					}
					changed = true;
					if(typeof income.delay == 'number') {
						income.timeLeft = income.delay;
					}
				}
			}
		}
		if(changed){
			$SM.fireUpdate('income', true);
		}
		Engine._incomeTimeout = Engine.setTimeout($SM.collectIncome, 1000);
	},

	//Thieves
	addStolen: function(stores) {
		for(var k in stores) {
			var old = $SM.get('stores["'+k+'"]', true);
			var short = old + stores[k];
			//if they would steal more than actually owned
			if(short < 0){
				$SM.add('game.stolen["'+k+'"]', (stores[k] * -1) + short);
			} else {
				$SM.add('game.stolen["'+k+'"]', stores[k] * -1);
			}
		}
	},

	startThieves: function() {
		$SM.set('game.thieves', 1);
		$SM.setIncome('thieves', {
			delay: 10,
			stores: {
				'wood': -10,
				'fur': -5,
				'meat': -5
			}
		});
	},

	//Misc
	num: function(name, craftable) {
		switch(craftable.type) {
		case 'good':
		case 'tool':
		case 'weapon':
		case 'upgrade':
		case 'special':
			return $SM.get('stores["'+name+'"]', true);
		case 'building':
			return $SM.get('game.buildings["'+name+'"]', true);
		}
	},

	handleStateUpdates: function(e){

	}
};

//alias
var $SM = StateManager;
