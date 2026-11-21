var World = {
  RADIUS: 30,
  VILLAGE_POS: [30, 30],
  TILE: {
    VILLAGE: 'A',
    IRON_MINE: 'I',
    COAL_MINE: 'C',
    SULPHUR_MINE: 'S',
    FOREST: ';',
    FIELD: ',',
    BARRENS: '.',
    ROAD: '#',
    HOUSE: 'H',
    CAVE: 'V',
    TOWN: 'O',
    CITY: 'Y',
    OUTPOST: 'P',
    SHIP: 'W',
    BOREHOLE: 'B',
    BATTLEFIELD: 'F',
    SWAMP: 'M',
    CACHE: 'U',
    EXECUTIONER: 'X'
  },
  TILE_PROBS: {},
  LANDMARKS: {},
  STICKINESS: 0.5, // 0 <= x <= 1
  LIGHT_RADIUS: 2,
  BASE_WATER: 10,
  MOVES_PER_FOOD: 2,
  MOVES_PER_WATER: 1,
  DEATH_COOLDOWN: 120,
  FIGHT_CHANCE: 0.20,
  BASE_HEALTH: 10,
  BASE_HIT_CHANCE: 0.8,
  MEAT_HEAL: 8,
  MEDS_HEAL: 20,
  HYPO_HEAL: 30,
  FIGHT_DELAY: 3, // At least three moves between fights
  warned: { food: false, water: false }, // stages of hunger and thirst brought this step
  NORTH: [ 0, -1],
  SOUTH: [ 0,  1],
  WEST:  [-1,  0],
  EAST:  [ 1,  0],

  Weapons: {
    'fists': {
      verb: _('punch'),
      type: 'unarmed',
      damage: 1,
      cooldown: 2
    },
    'bone spear': {
      verb: _('stab'),
      type: 'melee',
      damage: 2,
      cooldown: 2
    },
    'iron sword': {
      verb: _('swing'),
      type: 'melee',
      damage: 4,
      cooldown: 2
    },
    'steel sword': {
      verb: _('slash'),
      type: 'melee',
      damage: 6,
      cooldown: 2
    },
    'bayonet': {
      verb: _('thrust'),
      type: 'melee',
      damage: 8,
      cooldown: 2
    },
    'rifle': {
      verb: _('shoot'),
      type: 'ranged',
      damage: 5,
      cooldown: 1,
      cost: { 'bullets': 1 }
    },
    'laser rifle': {
      verb: _('blast'),
      type: 'ranged',
      damage: 8,
      cooldown: 1,
      cost: { 'energy cell': 1 }
    },
    'grenade': {
      verb: _('lob'),
      type: 'ranged',
      damage: 15,
      cooldown: 5,
      cost: { 'grenade': 1 }
    },
    'bolas': {
      verb: _('tangle'),
      type: 'ranged',
      damage: 'stun',
      cooldown: 15,
      cost: { 'bolas': 1 }
    },
    'plasma rifle': {
      verb: _('disintegrate'),
      type: 'ranged',
      damage: 12,
      cooldown: 1,
      cost: { 'energy cell': 1 }
    },
    'energy blade': {
      verb: _('slice'),
      type: 'melee',
      damage: 10,
      cooldown: 2
    },
    'disruptor': {
      verb: _('stun'),
      type: 'ranged',
      damage: 'stun',
      cooldown: 15
    }
  },

  name: 'World',
  options: {}, // Nothing for now
  init: function(options) {
    this.options = $.extend(
      this.options,
      options
    );

    World.setupLandmarks();

    if(typeof $SM.get('features.location.world') == 'undefined') {
      $SM.set('features.location.world', true);
      $SM.set('features.executioner', true);
      var seed = WorldGen.newSeed();
      $SM.setM('game.world', {
        seed: seed,
        map: World.generateMap(WorldGen.rng(seed)),
        mask: World.newMask()
      });
    }
    else if (!$SM.get('features.executioner')) {
      // Place the Executioner in previously generated maps that don't have it
      const map = $SM.get('game.world.map');
      const landmark = World.LANDMARKS[World.TILE.EXECUTIONER]
      for(let l = 0; l < landmark.num; l++) {
        World.placeLandmark(landmark.minRadius, landmark.maxRadius, World.TILE.EXECUTIONER, map);
      }
      $SM.set('game.world.map', map);
      $SM.set('features.executioner', true);
    }

    // Create the World panel
    this.panel = $('<div>').attr('id', "worldPanel").addClass('location').appendTo('#outerSlider');

    // Create the shrink wrapper
    var outer = $('<div>').attr('id', 'worldOuter').appendTo(this.panel);

    // Create the bag panel
    $('<div>').attr('id', 'bagspace-world').append($('<div>')).appendTo(outer);
    $('<div>').attr('id', 'backpackTitle').appendTo(outer);
    $('<div>').attr('id', 'backpackSpace').appendTo(outer);
    $('<div>').attr('id', 'healthCounter').appendTo(outer);

    Engine.updateOuterSlider();

    if($SM.get('features.location.city')) {
      // the town is open: the world is the hex map
      World.openHexMap();
    } else {
      World.pointCompass($SM.get('game.world.map'));
    }

    // Check if everything has been seen
    World.testMap();

    //subscribe to stateUpdates
    $.Dispatch('stateUpdate').subscribe(World.handleStateUpdates);
  },

  // the square map's ground probabilities and landmarks (no DOM, so the balance simulator can use them)
  setupLandmarks: function() {
    // Setup probabilities. Sum must equal 1.
    World.TILE_PROBS[World.TILE.FOREST] = 0.15;
    World.TILE_PROBS[World.TILE.FIELD] = 0.35;
    World.TILE_PROBS[World.TILE.BARRENS] = 0.5;

    // Setpiece definitions
    World.LANDMARKS[World.TILE.OUTPOST] = { num: 0, minRadius: 0, maxRadius: 0, scene: 'outpost', label: _('An&nbsp;Outpost') };
    World.LANDMARKS[World.TILE.IRON_MINE] = { num: 1, minRadius: 5, maxRadius: 5, scene: 'ironmine', label:  _('Iron&nbsp;Mine') };
    World.LANDMARKS[World.TILE.COAL_MINE] = { num: 1, minRadius: 10, maxRadius: 10, scene: 'coalmine', label:  _('Coal&nbsp;Mine') };
    World.LANDMARKS[World.TILE.SULPHUR_MINE] = { num: 1, minRadius: 20, maxRadius: 20, scene: 'sulphurmine', label:  _('Sulphur&nbsp;Mine') };
    World.LANDMARKS[World.TILE.HOUSE] = { num: 10, minRadius: 0, maxRadius: World.RADIUS * 1.5, scene: 'house', label:  _('An&nbsp;Old&nbsp;House') };
    World.LANDMARKS[World.TILE.CAVE] = { num: 5, minRadius: 3, maxRadius: 10, scene: 'cave', label:  _('A&nbsp;Damp&nbsp;Cave') };
    World.LANDMARKS[World.TILE.TOWN] = { num: 10, minRadius: 10, maxRadius: 20, scene: 'town', label:  _('An&nbsp;Abandoned&nbsp;Town') };
    World.LANDMARKS[World.TILE.CITY] = { num: 20, minRadius: 20, maxRadius: World.RADIUS * 1.5, scene: 'city', label:  _('A&nbsp;Ruined&nbsp;City') };
    World.LANDMARKS[World.TILE.SHIP] = { num: 1, minRadius: 28, maxRadius: 28, scene: 'ship', label:  _('A&nbsp;Crashed&nbsp;Starship')};
    World.LANDMARKS[World.TILE.BOREHOLE] = { num: 10, minRadius: 15, maxRadius: World.RADIUS * 1.5, scene: 'borehole', label:  _('A&nbsp;Borehole')};
    World.LANDMARKS[World.TILE.BATTLEFIELD] = { num: 5, minRadius: 18, maxRadius: World.RADIUS * 1.5, scene: 'battlefield', label:  _('A&nbsp;Battlefield')};
    World.LANDMARKS[World.TILE.SWAMP] = { num: 1, minRadius: 15, maxRadius: World.RADIUS * 1.5, scene: 'swamp', label:  _('A&nbsp;Murky&nbsp;Swamp')};
    World.LANDMARKS[World.TILE.EXECUTIONER] = { num: 1, minRadius: 28, maxRadius: 28, scene: 'executioner', 'label': _('A&nbsp;Ravaged&nbsp;Battleship')};

    // Only add the cache if there is prestige data
    if($SM.get('previous.stores')) {
      World.LANDMARKS[World.TILE.CACHE] = { num: 1, minRadius: 10, maxRadius: World.RADIUS * 1.5, scene: 'cache', label:  _('A&nbsp;Destroyed&nbsp;Village')};
    }
  },

  // Map the ship and show compass tooltip
  pointCompass: function(map) {
    World.ship = World.mapSearch(World.TILE.SHIP, map, 1);
    World.dir = World.compassDir(World.ship[0]);
    // compass tooltip text
    Room.compassTooltip(World.dir);
  },

  /*
   * The hex map. When the town opens, the same world re-projects onto hexes
   * (WorldGen.generate): the square map becomes its core and stays in the save,
   * frozen, as the generator's input. The save then holds only
   *   game.world.seed   the world's seed
   *   game.world.hex    { gen, delta: { 'x,y': tile }, mask: <bits> }
   * and everything else is regenerated on load. World.hex keeps the live copy.
   */
  openHexMap: function() {
    if(World.state) {
      // out on a trek: the world opens up when the wanderer gets home
      World._hexPending = true;
      return;
    }
    var w = $SM.get('game.world');
    var first = !w.hex;
    if(typeof w.seed != 'number') {
      w.seed = WorldGen.newSeed();
    }
    // the deltas only fit the generator that made them; from another one, project the wasteland afresh
    var stale = !first && w.hex.gen !== WorldGen.VERSION;
    if(stale) Engine.log('hex map from generator ' + w.hex.gen + ', now ' + WorldGen.VERSION + ': re-projected');
    var gen = WorldGen.generate(w.seed, w.map, w.clearedMines);
    var map = gen.map.map(function(col) { return col.slice(); });
    var mask;
    if(first || stale) {
      mask = World.newHexMask(gen);
      for(var x = 0; x < w.map.length; x++) {
        for(var y = 0; y < w.map[x].length; y++) {
          if(w.mask[x][y]) mask[x + gen.coreOffset[0]][y + gen.coreOffset[1]] = true;
        }
      }
    } else {
      for(var k in w.hex.delta) {
        var p = k.split(',');
        map[+p[0]][+p[1]] = w.hex.delta[k];
      }
      mask = WorldGen.decodeMask(w.hex.mask, gen.cols, gen.rows);
    }
    var passes = {};
    gen.passes.forEach(function(p) { passes[p[0] + ',' + p[1]] = true; });
    World.hex = { gen: gen, map: map, mask: mask, passes: passes, danger: Danger.field(gen) };
    World.VILLAGE_POS = gen.capital.slice();
    World.seenAll = false;
    if(stale) World.saveHex(w);
    if(first) {
      World.saveHex(w);
      Notifications.notify(null, _('the world is bigger than the wasteland.'));
      Engine.event('progress', 'hex map');
    }
    World.pointCompass(map);
    if(typeof Network != 'undefined') Network.refresh();
  },

  newHexMask: function(gen) {
    var mask = new Array(gen.cols);
    for(var i = 0; i < gen.cols; i++) {
      mask[i] = new Array(gen.rows);
    }
    return mask;
  },

  // Commits World.hex to the save as seed + deltas. flags: the trek's other world state.
  saveHex: function(flags) {
    var gen = World.hex.gen, map = World.hex.map, delta = {};
    for(var x = 0; x < gen.cols; x++) {
      for(var y = 0; y < gen.rows; y++) {
        if(map[x][y] !== gen.map[x][y]) delta[x + ',' + y] = map[x][y];
      }
    }
    var old = $SM.get('game.world');
    var world = $.extend({}, flags, {
      seed: gen.seed,
      map: old.map,
      mask: old.mask,
      hex: { gen: gen.gen, delta: delta, mask: WorldGen.encodeMask(World.hex.mask, gen.cols, gen.rows) }
    });
    $SM.setM('game.world', world);
  },

  isHex: function() {
    return !!World.hex;
  },

  // map size: the hex world's, or the prologue's 61x61
  cols: function() {
    return World.hex ? World.hex.gen.cols : World.RADIUS * 2 + 1;
  },

  rows: function() {
    return World.hex ? World.hex.gen.rows : World.RADIUS * 2 + 1;
  },

  // Hex data for later phases (yields, movement, city-states): nothing reads them for rules yet.
  terrainAt: function(x, y) {
    return World.hex.gen.terrain[x][y];
  },

  siteAt: function(x, y) {
    var i = World.hex.gen.siteAt[x + y * World.hex.gen.cols];
    return i < 0 ? null : World.hex.gen.sites[i];
  },

  formationAt: function(x, y) {
    var i = World.hex.gen.formationAt[x + y * World.hex.gen.cols];
    return i < 0 ? null : World.hex.gen.formations[i];
  },

  /*
   * Danger (script/danger.js): 0-10 per hex, scaled by the game's difficulty.
   * Everything on the hex map that gets harder further out reads it.
   */
  difficulty: function() {
    var d = $SM.get('game.difficulty');
    return Danger.DIFFICULTY[d] ? d : Danger.DEFAULT_DIFFICULTY;
  },

  // lit land is safer (script/fire.js): one less while the fire reaches it, never under 0
  dangerAt: function(x, y) {
    var d = World.baseDangerAt(x, y), fire = World.hex.fire;
    return fire && fire.lit[x + y * World.hex.gen.cols] ? Math.max(0, d - Fire.LIT_DANGER) : d;
  },

  // the danger before any light: what a fuel's reach is measured against
  baseDangerAt: function(x, y) {
    return World.baseField()[x + y * World.hex.gen.cols];
  },

  // that danger for every hex, worked out once for the world and its difficulty and kept (perf:
  // fights, the fire network and the painter read it per hex). Danger.at's values, unrounded.
  baseField: function() {
    var hex = World.hex, d = World.difficulty();
    if(!hex.base || hex.baseFor !== d) {
      var cols = hex.gen.cols, base = new Float64Array(hex.danger.length);
      for(var i = 0; i < base.length; i++) base[i] = Danger.at(hex.danger, cols, i % cols, (i - i % cols) / cols, d);
      hex.base = base;
      hex.baseFor = d;
    }
    return hex.base;
  },

  // the distance the prologue's encounters are picked by; on the hex map, danger stands in for it
  dangerDistance: function() {
    if(!World.hex) return World.getDistance();
    return Danger.encounterDistance(World.dangerAt(World.curPos[0], World.curPos[1]));
  },

  // one line the first time the wanderer walks into each band
  BAND_HINTS: [
    null,
    _('the quiet out here feels watched.'),
    _('the air tastes of ash.'),
    _('spent shells crunch underfoot.'),
    _('nothing grows here. nothing should.')
  ],

  checkBand: function() {
    var band = Danger.band(World.dangerAt(World.curPos[0], World.curPos[1]));
    if(band > $SM.get('game.danger.band', true)) {
      $SM.set('game.danger.band', band);
      if(World.BAND_HINTS[band]) Notifications.notify(World, World.BAND_HINTS[band]);
    }
  },

  clearDungeon: function() {
    Engine.event('progress', 'dungeon cleared');
    // a mine cleared in the prologue is remembered, so the hex map keeps its deposit
    var cleared = World.state.map[World.curPos[0]][World.curPos[1]].charAt(0);
    if(!World.hex && (cleared === World.TILE.IRON_MINE || cleared === World.TILE.COAL_MINE || cleared === World.TILE.SULPHUR_MINE)) {
      World.state.clearedMines = World.state.clearedMines || {};
      World.state.clearedMines[World.curPos[0] + ',' + World.curPos[1]] = cleared;
    }
    World.state.map[World.curPos[0]][World.curPos[1]] = World.TILE.OUTPOST;
    World.drawRoad();
  },

  drawRoad: function() {
    var findClosestRoad = function(startPos) {
      // We'll search in a spiral to find the closest road tile
      // We spiral out along manhattan distance contour
      // lines to ensure we draw the shortest road possible.
      // No attempt is made to reduce the search space for
      // tiles outside the map.
      var searchX, searchY, dtmp,
        x = 0,
        y = 0,
        dx = 1,
        dy = -1;
      for (var i = 0; i < Math.pow(World.getDistance(startPos, World.VILLAGE_POS) + 2, 2); i++) {
        searchX = startPos[0] + x;
        searchY = startPos[1] + y;
        if (0 < searchX && searchX < World.cols() - 1 && 0 < searchY && searchY < World.rows() - 1) {
          // check for road
          var tile = World.state.map[searchX][searchY];
          if (
             tile === World.TILE.ROAD ||
            (tile === World.TILE.OUTPOST && !(x === 0 && y === 0))  || // outposts are connected to roads
            tile === World.TILE.VILLAGE // all roads lead home
           ) {
            return [searchX, searchY];
          }
        }
        if (x === 0 || y === 0) {
          // Turn the corner
          dtmp = dx;
          dx = -dy;
          dy =  dtmp;
        }
        if (x === 0 && y <= 0) {
          x++;
        } else {
          x += dx;
          y += dy;
        }
      }
      return World.VILLAGE_POS;
    };
    var closestRoad = findClosestRoad(World.curPos);
    var xDist = World.curPos[0] - closestRoad[0];
    var yDist = World.curPos[1] - closestRoad[1];
    var xDir = Math.abs(xDist)/xDist;
    var yDir = Math.abs(yDist)/yDist;
    var xIntersect, yIntersect;
    if(Math.abs(xDist) > Math.abs(yDist)) {
      xIntersect = closestRoad[0];
      yIntersect = closestRoad[1] + yDist;
    } else {
      xIntersect = closestRoad[0] + xDist;
      yIntersect = closestRoad[1];
    }

    for(var x = 0; x < Math.abs(xDist); x++) {
      if(World.roadCanCross(World.state.map[closestRoad[0] + (xDir*x)][yIntersect])) {
        World.state.map[closestRoad[0] + (xDir*x)][yIntersect] = World.TILE.ROAD;
      }
    }
    for(var y = 0; y < Math.abs(yDist); y++) {
      if(World.roadCanCross(World.state.map[xIntersect][closestRoad[1] + (yDir*y)])) {
        World.state.map[xIntersect][closestRoad[1] + (yDir*y)] = World.TILE.ROAD;
      }
    }
    World.drawMap();
  },

  // roads go over open ground only; on the hex map they don't bridge seas or climb mountains
  roadCanCross: function(tile) {
    return World.isTerrain(tile) && WorldGen.isPassable(tile);
  },

  updateSupplies: function() {
    var supplies = $('div#bagspace-world > div');

    if(!Path.outfit) {
      Path.outfit = {};
    }

    // Add water
    var water = $('div#supply_water');
    if(World.water > 0 && water.length === 0) {
      water = World.createItemDiv('water', World.water);
      water.prependTo(supplies);
    } else if(World.water > 0) {
      $('div#supply_water', supplies).text(_('water:{0}' , World.water));
    } else {
      water.remove();
    }

    var total = 0;
    for(var k in Path.outfit) {
      var item = $('div#supply_' + k.replace(' ', '-'), supplies);
      var num = Path.outfit[k];
      total += num * Path.getWeight(k);
      if(num > 0 && item.length === 0) {
        item = World.createItemDiv(k, num);
        if(k == 'cured meat' && World.water > 0) {
          item.insertAfter(water);
        } else if(k == 'cured meat') {
          item.prependTo(supplies);
        } else {
          item.appendTo(supplies);
        }
      } else if(num > 0) {
        $('div#' + item.attr('id'), supplies).text(_(k) + ':' + num);
      } else {
        item.remove();
      }
    }

    // settlers walking with the wanderer (they carry their own supplies)
    var settlers = World.hex && typeof Network != 'undefined' && Network.settlers();
    $('div#supply_settlers', supplies).remove();
    if(settlers && settlers.out) World.createItemDiv('settlers', settlers.people).appendTo(supplies);

    // Update label
    var t = _('pockets');
    if($SM.get('stores.rucksack', true) > 0) {
      t = _('rucksack');
    }
    $('#backpackTitle').text(t);

    // Update bagspace
    $('#backpackSpace').text(_('free {0}/{1}', Math.floor(Path.getCapacity() - total) , Path.getCapacity()));
  },

  setWater: function(w) {
    World.water = w;
    if(World.water > World.getMaxWater()) {
      World.water = World.getMaxWater();
    }
    World.updateSupplies();
  },

  setHp: function(hp) {
    if(typeof hp == 'number' && !isNaN(hp)) {
      World.health = hp;
      if(World.health > World.getMaxHealth()) {
        World.health = World.getMaxHealth();
      }
      $('#healthCounter').text(_('hp: {0}/{1}', World.health , World.getMaxHealth()));
    }
  },

  createItemDiv: function(name, num) {
    var div = $('<div>').attr('id', 'supply_' + name.replace(' ', '-'))
      .addClass('supplyItem')
      .text(_('{0}:{1}',_(name), num));

    return div;
  },

  moveNorth: function() {
    Engine.log('North');
    if(World.curPos[1] > 0) World.move(World.NORTH);
  },

  moveSouth: function() {
    Engine.log('South');
    if(World.curPos[1] < World.rows() - 1) World.move(World.SOUTH);
  },

  moveWest: function() {
    Engine.log('West');
    if(World.curPos[0] > 0) World.move(World.WEST);
  },

  moveEast: function() {
    Engine.log('East');
    if(World.curPos[0] < World.cols() - 1) World.move(World.EAST);
  },

  // one of the hex directions, WorldGen._DIRS order: E, SE, SW, W, NW, NE
  moveHex: function(dir) {
    var to = WorldGen.neighbour(World.curPos[0], World.curPos[1], dir);
    if(to[0] >= 0 && to[1] >= 0 && to[0] < World.cols() && to[1] < World.rows()) {
      World.move([to[0] - World.curPos[0], to[1] - World.curPos[1]]);
    }
  },

  /*
   * Movement on the hex map. Open ocean waits for boats; mountains can only be
   * crossed at their passes (which are hills); rough ground costs two moves.
   */
  ROUGH: ['hills', 'forest', 'jungle', 'swamp'],

  canEnter: function(tile) {
    if(!World.hex) return true;
    if(tile === WorldGen.TERRAIN.ocean) return World.canSail();
    return WorldGen.isPassable(tile);
  },

  // hook: boats (a later phase) open the sea
  canSail: function() {
    return false;
  },

  // moves a step onto this tile costs; each move eats food and water like a prologue step
  moveCost: function(tile) {
    if(!World.hex) return 1;
    for(var i = 0; i < World.ROUGH.length; i++) {
      if(tile === WorldGen.TERRAIN[World.ROUGH[i]]) return 2;
    }
    return 1;
  },

  move: function(direction) {
    var oldTile = World.state.map[World.curPos[0]][World.curPos[1]];
    var to = World.state.map[World.curPos[0] + direction[0]][World.curPos[1] + direction[1]];
    if(!World.canEnter(to)) {
      Notifications.notify(World, to === WorldGen.TERRAIN.ocean ?
        _('the sea is too deep to wade.') : _('the mountains are too steep to climb.'));
      return;
    }
    World.curPos[0] += direction[0];
    World.curPos[1] += direction[1];
    World.narrateMove(oldTile, World.state.map[World.curPos[0]][World.curPos[1]]);
    World.lightMap(World.curPos[0], World.curPos[1], World.state.mask);
    if(World.hex && World.follow) World.cam = World.hexCentre(World.curPos[0], World.curPos[1]);
    if(World.hex) {
      World.checkBand();
      World.scavengePack();
      if(typeof Network != 'undefined') Network.onStep(World.curPos[0], World.curPos[1]);
    }
    World.drawMap();
    World.doSpace();

    // play random footstep
    var randomFootstep = Math.floor(Math.random() * 5) + 1;
    AudioEngine.playSound(AudioLibrary['FOOTSTEPS_' + randomFootstep]);

    if(World.checkDanger()) {
      if(World.danger) {
        Notifications.notify(World, _('dangerous to be this far from the village without proper protection'));
      } else {
        Notifications.notify(World, _('safer here'));
      }
    }
  },

  keyDown: function(event) {
    switch(event.which) {
      case 38: // Up
      case 87:
        World.moveNorth();
        break;
      case 40: // Down
      case 83:
        World.moveSouth();
        break;
      case 37: // Left
      case 65:
        World.moveWest();
        break;
      case 39: // Right
      case 68:
        World.moveEast();
        break;
      // on hexes, up and down zig-zag; these step along the other diagonals
      case 81: // Q
        if(World.hex) World.moveHex(4);
        break;
      case 69: // E
        if(World.hex) World.moveHex(5);
        break;
      case 90: // Z
        if(World.hex) World.moveHex(2);
        break;
      case 67: // C
        if(World.hex) World.moveHex(1);
        break;
      case 32: // space: back to the wanderer
        if(World.hex) {
          event.preventDefault();
          World.recentre();
        }
        break;
      default:
        break;
    }
  },

  swipeLeft: function(e) {
    World.moveWest();
  },

  swipeRight: function(e) {
    World.moveEast();
  },

  swipeUp: function(e) {
    World.moveNorth();
  },

  swipeDown: function(e) {
    World.moveSouth();
  },

  click: function(event) {
    if(World.hex) {
      if(!World._dragged) World.clickHex(event);
      return;
    }
    var map = $('#map'),
      // measure clicks relative to the centre of the current location
      centreX = map.offset().left + map.width() * World.curPos[0] / (World.RADIUS * 2),
      centreY = map.offset().top + map.height() * World.curPos[1] / (World.RADIUS * 2),
      clickX = event.pageX - centreX,
      clickY = event.pageY - centreY;
    if (clickX > clickY && clickX < -clickY) {
      World.moveNorth();
    }
    if (clickX < clickY && clickX > -clickY) {
      World.moveSouth();
    }
    if (clickX < clickY && clickX < -clickY) {
      World.moveWest();
    }
    if (clickX > clickY && clickX > -clickY) {
      World.moveEast();
    }
  },

  checkDanger: function() {
    World.danger = typeof World.danger == 'undefined' ? false: World.danger;
    if(!World.danger) {
      if($SM.get('stores["i armour"]', true) === 0 && World.dangerDistance() >= 8) {
        World.danger = true;
        return true;
      }
      if($SM.get('stores["s armour"]', true) === 0 && World.dangerDistance() >= 18) {
        World.danger = true;
        return true;
      }
    } else {
      if(World.dangerDistance() < 8) {
        World.danger = false;
        return true;
      }
      if(World.getDistance < 18 && $SM.get('stores["i armour"]', true) > 0) {
        World.danger = false;
        return true;
      }
    }
    return false;
  },

  useSupplies: function() {
    World.foodMove++;
    World.waterMove++;
    // Food
    var movesPerFood = World.MOVES_PER_FOOD;
    movesPerFood *= $SM.hasPerk('slow metabolism') ? 2 : 1;
    if(World.foodMove >= movesPerFood) {
      World.foodMove = 0;
      var num = Path.outfit['cured meat'];
      num--;
      if(num === 0) {
        Notifications.notify(World, _('the meat has run out'));
      } else if(num < 0) {
        // Starvation! Hooray!
        num = 0;
        if(!World.starvation) {
          Notifications.notify(World, _('starvation sets in'));
          World.starvation = true;
          World.warned.food = true;
        } else if(World.warned.food) {
          // rough ground: the second move of a step that just brought the warning doesn't kill
        } else {
          $SM.set('character.starved', $SM.get('character.starved', true));
          $SM.add('character.starved', 1);
          if($SM.get('character.starved') >= 10 && !$SM.hasPerk('slow metabolism')) {
            $SM.addPerk('slow metabolism');
          }
          World.die();
          return false;
        }
      } else {
        World.starvation = false;
        World.setHp(World.health + World.meatHeal());
      }
      Path.outfit['cured meat'] = num;
    }
    // Water
    var movesPerWater = World.MOVES_PER_WATER;
    movesPerWater *= $SM.hasPerk('desert rat') ? 2 : 1;
    if(World.waterMove >= movesPerWater) {
      World.waterMove = 0;
      var water = World.water;
      water--;
      if(water === 0) {
        Notifications.notify(World, _('there is no more water'));
      } else if(water < 0) {
        water = 0;
        if(!World.thirst) {
          Notifications.notify(World, _('the thirst becomes unbearable'));
          World.thirst = true;
          World.warned.water = true;
        } else if(World.warned.water) {
          // as for food: at most one stage of thirst per step
        } else {
          $SM.set('character.dehydrated', $SM.get('character.dehydrated', true));
          $SM.add('character.dehydrated', 1);
          if($SM.get('character.dehydrated') >= 10 && !$SM.hasPerk('desert rat')) {
            $SM.addPerk('desert rat');
          }
          World.die();
          return false;
        }
      } else {
        World.thirst = false;
      }
      World.setWater(water);
      World.updateSupplies();
    }
    return true;
  },

  meatHeal: function() {
    return World.MEAT_HEAL * ($SM.hasPerk('gastronome') ? 2 : 1);
  },

  medsHeal: function() {
    return World.MEDS_HEAL;
  },

  hypoHeal: () => World.HYPO_HEAL,

  checkFight: function() {
    World.fightMove = typeof World.fightMove == 'number' ? World.fightMove : 0;
    World.fightMove++;
    if(World.fightMove > World.FIGHT_DELAY) {
      var chance = World.hex ? Danger.fightChance(World.dangerAt(World.curPos[0], World.curPos[1])) : World.FIGHT_CHANCE;
      chance *= $SM.hasPerk('stealthy') ? 0.5 : 1;
      if(Math.random() < chance) {
        World.fightMove = 0;
        Events.triggerFight();
      }
    }
  },

  doSpace: function() {
    var curTile = World.state.map[World.curPos[0]][World.curPos[1]];

    var pack = World.state.pack;
    if(World.hex && pack && pack.at[0] === World.curPos[0] && pack.at[1] === World.curPos[1]) {
      World.recoverPack();
    }

    if(curTile == World.TILE.VILLAGE) {
      World.goHome();
    } else if(curTile === World.TILE.EXECUTIONER) {
      const scene = World.state.executioner ? 'executioner-antechamber' : 'executioner-intro';
      const sceneData = Events.Executioner[scene];
      Events.startEvent(sceneData);
    } else if(typeof World.LANDMARKS[curTile] != 'undefined') {
      if(curTile != World.TILE.OUTPOST || !World.outpostUsed()) {
        Events.startEvent(Events.Setpieces[World.LANDMARKS[curTile].scene]);
      }
    } else {
      // a step on rough ground eats twice, but brings at most one stage of thirst or starvation
      World.warned = { food: false, water: false };
      for(var i = World.moveCost(curTile); i > 0; i--) {
        if(!World.useSupplies()) return;
      }
      World.checkFight();
    }
  },

  getDistance: function(from, to) {
    from = from || World.curPos;
    to = to || World.VILLAGE_POS;
    if(World.hex) return WorldGen.distance(from, to);
    return Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
  },

  getTerrain: function() {
    var tile = World.state.map[World.curPos[0]][World.curPos[1]];
    return World.hex ? World.encounterTerrain(tile) : tile;
  },

  // Encounters are written for the three wasteland grounds; the new terrains borrow theirs.
  encounterTerrain: function(tile) {
    var T = WorldGen.TERRAIN;
    switch(tile) {
      case T.jungle:
      case T.swamp:
        return World.TILE.FOREST;
      case T.hills:
      case T.tundra:
      case T.lake:
      case T.ocean:
        return World.TILE.FIELD;
      case T.desert:
      case T.wastes:
      case T.mountains:
        return World.TILE.BARRENS;
    }
    return tile;
  },

  getDamage: function(thing) {
    return World.Weapons[thing].damage;
  },

  narrateMove: function(oldTile, newTile) {
    var msg = null;
    switch(oldTile) {
      case World.TILE.FOREST:
        switch(newTile) {
          case World.TILE.FIELD:
            msg = _("the trees yield to dry grass. the yellowed brush rustles in the wind.");
            break;
          case World.TILE.BARRENS:
            msg = _("the trees are gone. parched earth and blowing dust are poor replacements.");
            break;
        }
        break;
      case World.TILE.FIELD:
        switch(newTile) {
          case World.TILE.FOREST:
            msg = _("trees loom on the horizon. grasses gradually yield to a forest floor of dry branches and fallen leaves.");
            break;
          case World.TILE.BARRENS:
            msg = _("the grasses thin. soon, only dust remains.");
            break;
        }
        break;
      case World.TILE.BARRENS:
        switch(newTile) {
          case World.TILE.FIELD:
            msg = _("the barrens break at a sea of dying grass, swaying in the arid breeze.");
            break;
          case World.TILE.FOREST:
            msg = _("a wall of gnarled trees rises from the dust. their branches twist into a skeletal canopy overhead.");
            break;
        }
        break;
    }
    if(msg != null) {
      Notifications.notify(World, msg);
    }
  },

  newMask: function() {
    var mask = new Array(World.RADIUS * 2 + 1);
    for(var i = 0; i <= World.RADIUS * 2; i++) {
      mask[i] = new Array(World.RADIUS * 2 + 1);
    }
    World.lightMap(World.RADIUS, World.RADIUS, mask);
    return mask;
  },

  lightMap: function(x, y, mask) {
    var r = World.LIGHT_RADIUS;
    r *= $SM.hasPerk('scout') ? 2 : 1;
    World.uncoverMap(x, y, r, mask);
    return mask;
  },

  uncoverMap: function(x, y, r, mask) {
    mask[x][y] = true;
    if(World.hex) {
      var cols = World.cols(), rows = World.rows();
      for(var dy = -r; dy <= r; dy++) {
        for(var dx = -r - 1; dx <= r + 1; dx++) {
          var hx = x + dx, hy = y + dy;
          if(hx >= 0 && hy >= 0 && hx < cols && hy < rows && WorldGen.distance([x, y], [hx, hy]) <= r) {
            mask[hx][hy] = true;
          }
        }
      }
      return;
    }
    for(var i = -r; i <= r; i++) {
      for(var j = -r + Math.abs(i); j <= r - Math.abs(i); j++) {
        if(y + j >= 0 && y + j <= World.RADIUS * 2 &&
            x + i <= World.RADIUS * 2 &&
            x + i >= 0) {
          mask[x+i][y+j] = true;
        }
      }
    }
  },

  testMap: function() {
    if(!World.seenAll) {
      var dark; 
      var mask = World.committedMask();
      loop:
      for(var i = 0; i < mask.length; i++) {
        for(var j = 0; j < mask[i].length; j++) {
          if(!mask[i][j]) {
            dark = true;
            break loop;
          }
        }
      }
      World.seenAll = !dark;
    }
  },

  applyMap: function() {
    if(!World.seenAll){
      // on a trek (the executioner's maps) the reveal goes into the trek's map, which is what gets committed
      var x,y,mask = World.state ? World.state.mask : World.committedMask();
      do {
        x = Math.floor(Math.random() * World.cols());
        y = Math.floor(Math.random() * World.rows());
      } while (mask[x][y]);
      World.uncoverMap(x, y, 5, mask);
      if(World.hex && !World.state) World.saveHex(World.worldFlags());
    }
    World.testMap();
  },

  committedMask: function() {
    return World.hex ? World.hex.mask : $SM.get('game.world.mask');
  },

  // game.world without the maps: the flags treks set (ship, mines, executioner...)
  worldFlags: function() {
    var flags = $.extend(true, {}, $SM.get('game.world'));
    delete flags.map;
    delete flags.mask;
    delete flags.hex;
    delete flags.seed;
    return flags;
  },

  generateMap: function(rand) {
    rand = rand || Math.random;
    var map = new Array(World.RADIUS * 2 + 1);
    for(var i = 0; i <= World.RADIUS * 2; i++) {
      map[i] = new Array(World.RADIUS * 2 + 1);
    }
    // The Village is always at the exact center
    // Spiral out from there
    map[World.RADIUS][World.RADIUS] = World.TILE.VILLAGE;
    for(var r = 1; r <= World.RADIUS; r++) {
      for(var t = 0; t < r * 8; t++) {
        var x, y;
        if(t < 2 * r) {
          x = World.RADIUS - r + t;
          y = World.RADIUS - r;
        } else if(t < 4 * r) {
          x = World.RADIUS + r;
          y = World.RADIUS - (3 * r) + t;
        } else if(t < 6 * r) {
          x = World.RADIUS + (5 * r) - t;
          y = World.RADIUS + r;
        } else {
          x = World.RADIUS - r;
          y = World.RADIUS + (7 * r) - t;
        }

        map[x][y] = World.chooseTile(x, y, map, rand);
      }
    }

    // Place landmarks
    for(var k in World.LANDMARKS) {
      var landmark = World.LANDMARKS[k];
      for(var l = 0; l < landmark.num; l++) {
        var pos = World.placeLandmark(landmark.minRadius, landmark.maxRadius, k, map, rand);
      }
    }

    return map;
  },

  mapSearch: function(target,map,required){
    var max = World.LANDMARKS[target].num;
    if(!max){
      // this restrict the research to numerable landmarks
      return null;
    }
    // restrict research if only a fixed number (usually 1) is required
    max = (required) ? Math.min(required,max) : max;
    var index = 0;
    var targets = [];
    search: // label for coordinate research
    for(var i = 0; i < map.length; i++){
      for(var j = 0; j < map[i].length; j++){
        if(map[i][j].charAt(0) === target){
          // search result is stored as an object;
          // items are listed as they appear in the map, tl-br
          // each item has relative coordinates and a compass-type direction
          targets[index] = {
            x : i - World.VILLAGE_POS[0],
            y : j - World.VILLAGE_POS[1],
          };
          index++;
          if(index === max){
            // optimisation: stop the research if maximum number of items has been reached
            break search;
          }
        }
      }
    }
    return targets;
  },

  compassDir: function(pos){
    var dir = '';
    var horz = pos.x < 0 ? 'west' : 'east';
    var vert = pos.y < 0 ? 'north' : 'south';
    if(Math.abs(pos.x) / 2 > Math.abs(pos.y)) {
      dir = horz;
    } else if(Math.abs(pos.y) / 2 > Math.abs(pos.x)){
      dir = vert;
    } else {
      dir = vert + horz;
    }
    return dir;
  },

  placeLandmark: function(minRadius, maxRadius, landmark, map, rand) {
    rand = rand || Math.random;

    var x = World.RADIUS, y = World.RADIUS;
    while(!World.isTerrain(map[x][y])) {
      var r = Math.floor(rand() * (maxRadius - minRadius)) + minRadius;
      var xDist = Math.floor(rand() * r);
      var yDist = r - xDist;
      if(rand() < 0.5) xDist = -xDist;
      if(rand() < 0.5) yDist = -yDist;
      x = World.RADIUS + xDist;
      if(x < 0) x = 0;
      if(x > World.RADIUS * 2) x = World.RADIUS * 2;
      y = World.RADIUS + yDist;
      if(y < 0) y = 0;
      if(y > World.RADIUS * 2) y = World.RADIUS * 2;
    }
    map[x][y] = landmark;
    return [x, y];
  },

  isTerrain: function(tile) {
    return WorldGen.isTerrain(tile);
  },

  chooseTile: function(x, y, map, rand) {

    var adjacent = [
      y > 0 ? map[x][y-1] : null,
      y < World.RADIUS * 2 ? map[x][y+1] : null,
      x < World.RADIUS * 2 ? map[x+1][y] : null,
      x > 0 ? map[x-1][y] : null
    ];

    var chances = {};
    var nonSticky = 1;
    var cur;
    for(var i in adjacent) {
      if(adjacent[i] == World.TILE.VILLAGE) {
        // Village must be in a forest to maintain thematic consistency, yo.
        return World.TILE.FOREST;
      } else if(typeof adjacent[i] == 'string') {
        cur = chances[adjacent[i]];
        cur = typeof cur == 'number' ? cur : 0;
        chances[adjacent[i]] = cur + World.STICKINESS;
        nonSticky -= World.STICKINESS;
      }
    }
    for(var t in World.TILE) {
      var tile = World.TILE[t];
      if(World.isTerrain(tile)) {
        cur = chances[tile];
        cur = typeof cur == 'number' ? cur : 0;
        cur += World.TILE_PROBS[tile] * nonSticky;
        chances[tile] = cur;
      }
    }

    var list = [];
    for(var j in chances) {
      list.push(chances[j] + '' + j);
    }
    list.sort(function(a, b) {
      var n1 = parseFloat(a.substring(0, a.length - 1));
      var n2 = parseFloat(b.substring(0, b.length - 1));
      return n2 - n1;
    });

    var c = 0;
    var r = (rand || Math.random)();
    for(var l in list) {
      var prob = list[l];
      c += parseFloat(prob.substring(0,prob.length - 1));
      if(r < c) {
        return prob.charAt(prob.length - 1);
      }
    }

    return World.TILE.BARRENS;
  },

  markVisited: function(x, y) {
    World.state.map[x][y] = World.state.map[x][y] + '!';
  },

  drawMap: function() {
    if(World.hex) {
      World.drawHexMap();
      return;
    }
    var map = $('#map');
    if(map.length === 0) {
      map = new $('<div>').attr('id', 'map').appendTo('#worldOuter');
      // register click handler
      map.click(World.click);
    }
    var mapString = "";
    for(var j = 0; j <= World.RADIUS * 2; j++) {
      for(var i = 0; i <= World.RADIUS * 2; i++) {
        var ttClass = "";
        if(i > World.RADIUS) {
          ttClass += " left";
        } else {
          ttClass += " right";
        }
        if(j > World.RADIUS) {
          ttClass += " top";
        } else {
          ttClass += " bottom";
        }
        if(World.curPos[0] == i && World.curPos[1] == j) {
          mapString += '<span class="landmark">@<div class="tooltip ' + ttClass + '">'+_('Wanderer')+'</div></span>';
        } else if(World.state.mask[i][j]) {
          var c = World.state.map[i][j];
          switch(c) {
            case World.TILE.VILLAGE:
              mapString += '<span class="landmark">' + c + '<div class="tooltip' + ttClass + '">'+_('The&nbsp;Village')+'</div></span>';
              break;
            default:
              if(typeof World.LANDMARKS[c] != 'undefined' && (c != World.TILE.OUTPOST || !World.outpostUsed(i, j))) {
                mapString += '<span class="landmark">' + c + '<div class="tooltip' + ttClass + '">' + World.LANDMARKS[c].label + '</div></span>';
              } else {
                if(c.length > 1) {
                  c = c[0];
                }
                mapString += c;
              }
              break;
          }
        } else {
          mapString += '&nbsp;';
        }
      }
      mapString += '<br/>';
    }
    map.html(mapString);
  },

  /*
   * Hex map rendering: thin monochrome outlines, one glyph per hex, the map's own
   * font, fog left blank. Only the hexes inside the viewport are drawn.
   */
  HEX_SIZE: 9,          // centre to corner, px
  VIEW: [600, 420],     // viewport, px

  hexCentre: function(x, y) {
    var w = Math.sqrt(3) * World.HEX_SIZE;
    return [w * (x + 0.5 * (y & 1)) + w / 2, 1.5 * World.HEX_SIZE * y + World.HEX_SIZE];
  },

  // the hex under a point in map pixels
  hexAt: function(px, py) {
    var s = World.HEX_SIZE, w = Math.sqrt(3) * s;
    px -= w / 2;
    py -= s;
    // pixel -> axial (pointy-top), then round in cube coordinates
    var q = (Math.sqrt(3) / 3 * px - py / 3) / s, r = (2 / 3 * py) / s;
    var cx = q, cz = r, cy = -cx - cz;
    var rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
    var ex = Math.abs(rx - cx), ey = Math.abs(ry - cy), ez = Math.abs(rz - cz);
    if(ex > ey && ex > ez) rx = -ry - rz;
    else if(ey <= ez) rz = -rx - ry;
    return [rx + (rz - (rz & 1)) / 2, rz];
  },

  setupHexView: function() {
    var map = $('#map');
    if(map.length === 0) {
      map = $('<div>').attr('id', 'map').appendTo('#worldOuter');
      map.click(World.click);
    }
    if(map.hasClass('hex')) return map;
    map.empty().addClass('hex');
    var dpr = window.devicePixelRatio || 1;
    var canvas = $('<canvas>').attr({ width: World.VIEW[0] * dpr, height: World.VIEW[1] * dpr })
      .css({ width: World.VIEW[0] + 'px', height: World.VIEW[1] + 'px' }).appendTo(map);
    $('<span>').addClass('landmark hexProbe').appendTo(map);
    $('<div>').attr('id', 'hexInfo').html('&nbsp;').insertAfter(map);
    $('<div>').attr('id', 'hexHint').text(_('drag to look around. space to come back.')).insertAfter('#hexInfo');

    // drag or scroll to look around; a click without a drag steps toward it
    var start = null;
    canvas.on('mousedown', function(e) {
      start = { x: e.pageX, y: e.pageY, cam: World.cam.slice() };
      World._dragged = false;
    });
    $(document).on('mousemove', function(e) {
      if(!start) return;
      var dx = e.pageX - start.x, dy = e.pageY - start.y;
      if(Math.abs(dx) + Math.abs(dy) > 4) World._dragged = true;
      if(World._dragged) {
        World.cam = [start.cam[0] - dx, start.cam[1] - dy];
        World.follow = false; // looking around: the view stays put until space
        World.drawHexMap();
      }
    }).on('mouseup', function() {
      start = null;
    });
    canvas.on('mousemove', function(e) { World.hoverHex(e); });
    canvas[0].addEventListener('wheel', function(e) {
      e.preventDefault();
      World.cam = [World.cam[0] + (e.shiftKey ? e.deltaY : e.deltaX), World.cam[1] + (e.shiftKey ? 0 : e.deltaY)];
      World.follow = false;
      World.drawHexMap();
    }, { passive: false });
    return map;
  },

  // the view follows the wanderer again
  recentre: function() {
    World.follow = true;
    World.cam = World.hexCentre(World.curPos[0], World.curPos[1]);
    World.drawHexMap();
  },

  // viewport origin in map pixels
  viewOrigin: function() {
    return [World.cam[0] - World.VIEW[0] / 2, World.cam[1] - World.VIEW[1] / 2];
  },

  clickHex: function(event) {
    var off = $('#map canvas').offset(), o = World.viewOrigin();
    var me = World.hexCentre(World.curPos[0], World.curPos[1]);
    var px = event.pageX - off.left + o[0], py = event.pageY - off.top + o[1];
    // a click on the wanderer's own hex goes nowhere
    var h = World.hexAt(px, py);
    if(h[0] === World.curPos[0] && h[1] === World.curPos[1]) return;
    var dx = px - me[0], dy = py - me[1];
    var a = Math.atan2(dy, dx) * 180 / Math.PI;
    World.moveHex(((Math.round(a / 60) % 6) + 6) % 6);
  },

  hoverHex: function(event) {
    if(!World.state) return;
    var off = $('#map canvas').offset(), o = World.viewOrigin();
    var h = World.hexAt(event.pageX - off.left + o[0], event.pageY - off.top + o[1]);
    $('#hexInfo').html(World.hexLabel(h[0], h[1]) || '&nbsp;');
  },

  TERRAIN_NAMES: {
    field: _('field'), forest: _('forest'), barrens: _('barrens'), hills: _('hills'),
    mountains: _('mountains'), lake: _('lake'), ocean: _('ocean'), desert: _('desert'),
    swamp: _('swamp'), tundra: _('tundra'), jungle: _('jungle'), wastes: _('wastes')
  },

  // st: { map, mask, pack } to read, the trek's by default
  hexLabel: function(x, y, st) {
    st = st || World.state;
    if(x < 0 || y < 0 || x >= World.cols() || y >= World.rows()) return null;
    var pack = st.pack;
    if(pack && pack.at[0] === x && pack.at[1] === y) return World.packLabel(pack);
    if(!st.mask[x][y]) return null;
    var c = st.map[x][y];
    var fire = typeof Network != 'undefined' ? Network.hexNote(x, y) : '';
    // a beacon on a landmark or a site: the landmark's name, then the beacon's
    var under = !!fire && Network.beaconAt(x, y) && World.markedAt(x, y, st.map);
    if(fire && !under) return fire;
    if(c == World.TILE.VILLAGE) return _('the&nbsp;capital');
    var site = World.siteAt(x, y);
    var mark = World.LANDMARKS[c.charAt(0)] ? World.LANDMARKS[c.charAt(0)].label : (site ? WorldGen.SITES[site.kind].label : null);
    if(mark) return under ? mark + ',&nbsp;' + fire : mark;
    if(World.hex.passes[x + ',' + y]) return WorldGen.PASS_LABEL;
    var f = World.formationAt(x, y);
    if(f) return WorldGen.FORMATIONS[f.kind];
    for(var k in WorldGen.TERRAIN) {
      if(WorldGen.TERRAIN[k] === c) return World.TERRAIN_NAMES[k];
    }
    return null;
  },

  // a landmark or a site is on this hex: its glyph shows over a beacon raised there, and no
  // district goes on it. A resettled fallen city's other hexes are plain ground again.
  markedAt: function(x, y, map) {
    map = map || World.hex.map;
    if(World.LANDMARKS[map[x][y].charAt(0)]) return true;
    var site = World.siteAt(x, y);
    return !!site && map[site.anchor[0]][site.anchor[1]].charAt(0) !== World.TILE.VILLAGE;
  },

  // what a hex shows: [glyph, bold]; map: the tiles to read, the trek's by default
  hexGlyph: function(x, y, map) {
    map = map || World.state.map;
    var c = map[x][y];
    var district = typeof Network != 'undefined' && Network.districtAt(x, y);
    if(district && district != District.HEARTH) return [District.TYPES[district].glyph, true];
    if(c == World.TILE.VILLAGE) return [c, true];
    if(typeof World.LANDMARKS[c] != 'undefined' && (c != World.TILE.OUTPOST || !World.outpostUsed(x, y))) return [c, true];
    if(typeof Network != 'undefined' && Network.isCairn(x, y)) return [Network.CAIRN_GLYPH, true];
    var site = World.siteAt(x, y);
    if(site && WorldGen.isTerrain(c)) {
      // a site shows its own glyph across all its hexes; the wasteland's towns keep theirs
      var a = map[site.anchor[0]][site.anchor[1]].charAt(0);
      // a resettled site is a city of ours now: its other hexes are plain ground again
      if(a === World.TILE.VILLAGE) return [c.charAt(0), false];
      return [WorldGen.isTerrain(a) ? WorldGen.SITES[site.kind].glyph : a, false];
    }
    return [c.charAt(0), false];
  },

  drawHexMap: function() {
    var map = World.setupHexView();
    if(!World.cam) World.cam = World.hexCentre(World.curPos[0], World.curPos[1]);
    World.paintHex(map, {
      cam: World.cam, view: World.VIEW, map: World.state.map, mask: World.state.mask,
      me: World.curPos, pack: World.state.pack
    });
  },

  /*
   * Paints a hex view into the canvas inside `el` (a .hex map element with a .hexProbe).
   *   o.cam     centre of the view, map pixels
   *   o.view    [w, h] px
   *   o.map     tiles; o.mask what has been seen
   *   o.me      the wanderer's hex, or null; o.pack the dropped pack, or null
   *   o.select  a hex to ring, or null
   * Over the land: the fire network (Network.result): lit hexes faintly filled, beacon lines
   * as thin lines, beacons as points of light, the cities' districts outlined.
   */
  paintHex: function(el, o) {
    var canvas = el.find('canvas')[0], ctx = canvas.getContext('2d');
    var gen = World.hex.gen, mask = o.mask;
    var s = World.HEX_SIZE, w = Math.sqrt(3) * s, rh = 1.5 * s;
    var dpr = canvas.width / o.view[0];
    var o0 = [o.cam[0] - o.view[0] / 2, o.cam[1] - o.view[1] / 2];
    var c0 = Math.max(0, Math.floor(o0[0] / w) - 1), c1 = Math.min(gen.cols - 1, Math.ceil((o0[0] + o.view[0]) / w));
    var r0 = Math.max(0, Math.floor(o0[1] / rh) - 1), r1 = Math.min(gen.rows - 1, Math.ceil((o0[1] + o.view[1]) / rh));
    var style = window.getComputedStyle(el[0]);
    var dim = style.color, bright = window.getComputedStyle(el.find('.hexProbe')[0]).color;
    var corners = [];
    for(var i = 0; i < 6; i++) {
      var ang = Math.PI / 180 * (60 * i - 30);
      corners.push([s * Math.cos(ang), s * Math.sin(ang)]);
    }
    var x, y, p;
    var hexPath = function(p, scale) {
      ctx.moveTo(p[0] + corners[0][0] * scale, p[1] + corners[0][1] * scale);
      for(var i = 1; i < 6; i++) ctx.lineTo(p[0] + corners[i][0] * scale, p[1] + corners[i][1] * scale);
      ctx.closePath();
    };
    var inView = function(p, m) {
      return p[0] > o0[0] - m && p[0] < o0[0] + o.view[0] + m && p[1] > o0[1] - m && p[1] < o0[1] + o.view[1] + m;
    };

    ctx.setTransform(dpr, 0, 0, dpr, -o0[0] * dpr, -o0[1] * dpr);
    ctx.clearRect(o0[0], o0[1], o.view[0], o.view[1]);

    var net = World.hex.fire, lightsOn = !$SM.get('config.lightsOff');
    // lights on, the dark creeps in: a grey wash over the view, cut back out of the lit land and
    // the fog (one fill and one cut, so a whole seen viewport costs no more than a few lit hexes)
    if(net && lightsOn) {
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = dim;
      ctx.fillRect(o0[0], o0[1], o.view[0], o.view[1]);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      for(y = r0; y <= r1; y++) {
        for(x = c0; x <= c1; x++) {
          if(!mask[x][y] || net.lit[x + y * gen.cols]) hexPath(World.hexCentre(x, y), 1.06);
        }
      }
      ctx.fill();
      ctx.restore();
    }
    // outlines of every seen hex, in one stroke
    ctx.beginPath();
    for(y = r0; y <= r1; y++) {
      for(x = c0; x <= c1; x++) {
        if(mask[x][y]) hexPath(World.hexCentre(x, y), 1);
      }
    }
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = dim;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // lights off, the light: every lit hex in view faintly filled
    if(net && !lightsOn) {
      ctx.beginPath();
      for(y = r0; y <= r1; y++) {
        for(x = c0; x <= c1; x++) {
          if(net.lit[x + y * gen.cols]) hexPath(World.hexCentre(x, y), 0.92);
        }
      }
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = bright;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // edges where a multi-hex feature ends: solid for sites, dashed for natural formations
    var edges = function(at, bold) {
      ctx.beginPath();
      for(y = r0; y <= r1; y++) {
        for(x = c0; x <= c1; x++) {
          var id = at(x, y);
          if(id < 0 || !mask[x][y]) continue;
          p = World.hexCentre(x, y);
          for(var d = 0; d < 6; d++) {
            var n = WorldGen.neighbour(x, y, d);
            var nid = n[0] < 0 || n[1] < 0 || n[0] >= gen.cols || n[1] >= gen.rows ? -1 : at(n[0], n[1]);
            if(nid === id) continue;
            ctx.moveTo(p[0] + corners[d][0], p[1] + corners[d][1]);
            ctx.lineTo(p[0] + corners[(d + 1) % 6][0], p[1] + corners[(d + 1) % 6][1]);
          }
        }
      }
      ctx.strokeStyle = bold ? bright : dim;
      ctx.lineWidth = bold ? 1.5 : 1;
      ctx.setLineDash(bold ? [] : [2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    edges(function(x, y) { return gen.formationAt[x + y * gen.cols]; }, false);
    edges(function(x, y) { return gen.siteAt[x + y * gen.cols]; }, true);
    // a city's districts: its shape on the map
    if(typeof Network != 'undefined') edges(function(x, y) { return Network.cityIndexAt(x, y); }, true);

    // the capital: a second ring
    var cap = World.hexCentre(gen.capital[0], gen.capital[1]);
    if(inView(cap, w)) {
      ctx.beginPath();
      hexPath(cap, 1.35);
      ctx.strokeStyle = bright;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if(o.select) {
      ctx.beginPath();
      hexPath(World.hexCentre(o.select[0], o.select[1]), 0.8);
      ctx.strokeStyle = bright;
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // beacon lines: thin, brighter where the fire is stronger
    var points = {};
    if(net) {
      ctx.strokeStyle = bright;
      ctx.lineWidth = 1;
      net.links.forEach(function(l) {
        var a = World.hexCentre(net.nodes[l[0]].at[0], net.nodes[l[0]].at[1]);
        var b = World.hexCentre(net.nodes[l[1]].at[0], net.nodes[l[1]].at[1]);
        if(!inView(a, 4 * w) && !inView(b, 4 * w)) return;
        ctx.globalAlpha = Math.min(0.9, 0.3 + l[2] / 20);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      // the beacons: a point of light each; a dark one is only a ring. On a landmark or a site
      // the landmark's glyph shows instead (the hover names the beacon too)
      net.nodes.forEach(function(n) {
        if(n.hearth || World.markedAt(n.at[0], n.at[1], o.map)) return;
        var c = World.hexCentre(n.at[0], n.at[1]);
        points[n.at[0] + ',' + n.at[1]] = true;
        if(!inView(c, w)) return;
        ctx.beginPath();
        ctx.arc(c[0], c[1], n.s >= Fire.LIT_MIN ? 2.2 : 1.8, 0, 2 * Math.PI);
        if(n.s >= Fire.LIT_MIN) {
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = bright;
          ctx.beginPath();
          ctx.arc(c[0], c[1], 5.5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(c[0], c[1], 2.2, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          ctx.strokeStyle = dim;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
    }

    // glyphs
    var family = style.fontFamily;
    var plain = '11px ' + family, bold = 'bold 12px ' + family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // the dropped pack shows even in the fog: the trek that saw that hex was lost
    var pack = o.pack;
    for(y = r0; y <= r1; y++) {
      for(x = c0; x <= c1; x++) {
        var me = o.me && o.me[0] == x && o.me[1] == y;
        var atPack = pack && pack.at[0] === x && pack.at[1] === y;
        if(!mask[x][y] && !me && !atPack) continue;
        if(!me && !atPack && points[x + ',' + y]) continue; // a beacon is its own light
        var g = me ? ['@', true] : (atPack ? [World.PACK_GLYPH, true] : World.hexGlyph(x, y, o.map));
        p = World.hexCentre(x, y);
        ctx.font = g[1] ? bold : plain;
        ctx.fillStyle = g[1] || me ? bright : dim;
        ctx.fillText(g[0], p[0], p[1] + 1);
      }
    }
  },

  /*
   * The corpse run, on the hex map. Dying on a trek drops the pack where the wanderer
   * fell, in the committed world: game.world.pack = { at: [x, y], items: { thing: n }, left }.
   * One at a time, a new death replaces it. Scavengers take a share (left shrinks) every
   * step the wanderer walks, faster where it's more dangerous; reaching it takes back the rest.
   */
  PACK_GLYPH: '+',

  // what is left in a pack: { thing: n }, or null once the scavengers have had it all
  packLeft: function(pack) {
    var out = null;
    for(var k in pack.items) {
      var n = Math.floor(pack.items[k] * pack.left);
      if(n > 0) {
        out = out || {};
        out[k] = n;
      }
    }
    return out;
  },

  dropPack: function() {
    var items = null;
    for(var k in Path.outfit) {
      if(Path.outfit[k] > 0) {
        items = items || {};
        items[k] = Path.outfit[k];
      }
    }
    // settlers on the trek stay with the pack: it is their supplies (Network.settlers)
    var settlers = typeof Network != 'undefined' && Network.settlers();
    if(settlers && settlers.out) {
      $SM.remove('game.network.settlers', true);
    } else {
      settlers = null;
    }
    if(items || settlers) {
      var pack = { at: World.curPos.slice(), items: items || {}, left: 1 };
      if(settlers) pack.settlers = settlers;
      $SM.set('game.world.pack', pack);
    } else {
      $SM.remove('game.world.pack');
    }
  },

  scavengePack: function() {
    var pack = World.state.pack;
    if(!pack) return;
    pack.left *= 1 - Danger.scavengeRate(World.dangerAt(pack.at[0], pack.at[1]));
    if(!World.packLeft(pack) && !World.settlersLeft(pack)) delete World.state.pack;
  },

  // the settlers still holding out by a pack as the scavengers come: { people, stores }, or null
  settlersLeft: function(pack) {
    var s = pack.settlers;
    if(!s) return null;
    var people = Math.floor(s.people * pack.left);
    if(people <= 0) return null;
    var stores = {};
    for(var k in s.stores) stores[k] = Math.floor(s.stores[k] * pack.left);
    return { people: people, stores: stores };
  },

  recoverPack: function() {
    var pack = World.state.pack, left = World.packLeft(pack), rest = null, settlers = World.settlersLeft(pack);
    delete World.state.pack;
    if(settlers) {
      // the settlers who held out fall in again, with what is left of their supplies
      $SM.set('game.network.settlers', $.extend({}, pack.settlers, settlers, { out: true }));
      Notifications.notify(World, _('the settlers are still here, huddled by the pack.'));
    }
    if(!left) return;
    for(var k in left) {
      var n = Math.max(0, Math.min(left[k], Math.floor(Path.getFreeSpace() / Path.getWeight(k))));
      Path.outfit[k] = (Path.outfit[k] || 0) + n;
      if(n < left[k]) {
        rest = rest || {};
        rest[k] = left[k] - n;
      }
    }
    if(rest) {
      World.state.pack = { at: World.curPos.slice(), items: rest, left: 1 };
      Notifications.notify(World, _('the pack lies where it fell. there is more than can be carried.'));
    } else {
      Notifications.notify(World, _('the pack lies where it fell. took what the scavengers left.'));
    }
    World.updateSupplies();
  },

  packLabel: function(pack) {
    var left = World.packLeft(pack), list = [], settlers = World.settlersLeft(pack);
    if(settlers) list.push(_('settlers') + '&nbsp;' + settlers.people);
    for(var k in left) list.push(_(k) + '&nbsp;' + left[k]);
    return _('the&nbsp;pack:') + '&nbsp;' + list.join(',&nbsp;');
  },

  die: function() {
    if(!World.dead) {
      World.dead = true;
      Engine.log('player death');
      Engine.event('game event', 'death');
      Engine.keyLock = true;
      // Dead! Discard any world changes and go home
      Notifications.notify(World, _('the world fades'));
      if(World.hex) World.dropPack();
      World.state = null;
      Path.outfit = {};
      $SM.remove('outfit');
      AudioEngine.playSound(AudioLibrary.DEATH);
      $('#outerSlider').animate({opacity: '0'}, 600, 'linear', function() {
        $('#outerSlider').css('left', '0px');
        $('#locationSlider').css('left', '0px');
        $('#storesContainer').css({'top': '0px', 'right': '0px'});
        Engine.activeModule = Room;
        $('div.headerButton').removeClass('selected');
        Room.tab.addClass('selected');
        Engine.setTimeout(function(){
          Room.onArrival();
          $('#outerSlider').animate({opacity:'1'}, 600, 'linear');
          Button.cooldown($('#embarkButton'));
          Engine.keyLock = false;
          Engine.tabNavigation = true;
        }, 2000, true);
      });
    }
  },

  goHome: function() {
    // Home safe! Commit the changes.
    if(World.hex) {
      World.hex.map = World.state.map;
      World.hex.mask = World.state.mask;
      var flags = $.extend({}, World.state);
      delete flags.map;
      delete flags.mask;
      World.saveHex(flags);
    } else {
      $SM.setM('game.world', World.state);
    }
    World.testMap();

    if(World.state.sulphurmine && $SM.get('game.buildings["sulphur mine"]', true) === 0) {
      $SM.add('game.buildings["sulphur mine"]', 1);
      Engine.event('progress', 'sulphur mine');
    }
    if(World.state.ironmine && $SM.get('game.buildings["iron mine"]', true) === 0) {
      $SM.add('game.buildings["iron mine"]', 1);
      Engine.event('progress', 'iron mine');
    }
    if(World.state.coalmine && $SM.get('game.buildings["coal mine"]', true) === 0) {
      $SM.add('game.buildings["coal mine"]', 1);
      Engine.event('progress', 'coal mine');
    }
    if(World.state.ship && !$SM.get('features.location.spaceShip')) {
      Ship.init();
      Engine.event('progress', 'ship');
    }
    if (World.state.executioner && !$SM.get('features.location.fabricator')) {
      Fabricator.init();
      Notifications.notify(null, _('builder knows the strange device when she sees it. takes it for herself real quick. doesn’t ask where it came from.'));
      Engine.event('progress', 'fabricator');
    }
    World.redeemBlueprints();
    var hexTrek = !!World.hex;
    World.state = null;
    if(hexTrek && typeof Network != 'undefined') {
      Network.settlersHome();
      Network.onHome();
    }
    if(World._hexPending) {
      World._hexPending = false;
      World.openHexMap();
    }

    if(Path.outfit['cured meat'] > 0) {
      Button.setDisabled($('#embarkButton'), false);
    }

    World.returnOutfit();

    $('#outerSlider').animate({left: '0px'}, 300);
    Engine.activeModule = Path;
    Path.onArrival();
    Engine.restoreNavigation = true;
  },

  redeemBlueprints: () => {
    let redeemed = false;
    const redeem = (blueprint, item) => {
      if (Path.outfit[blueprint]) {
        $SM.set(`character.blueprints['${item}']`, true);
        delete Path.outfit[blueprint];
        redeemed = true;
      }
    };

    redeem('hypo blueprint', 'hypo');
    redeem('kinetic armour blueprint', 'kinetic armour');
    redeem('disruptor blueprint', 'disruptor');
    redeem('plasma rifle blueprint', 'plasma rifle');
    redeem('stim blueprint', 'stim');
    redeem('glowstone blueprint', 'glowstone');

    if (redeemed) {
      Notifications.notify(null, 'blueprints feed into the fabricator data port. possibilities grow.');
    }
  },

  returnOutfit: () => {
    for(var k in Path.outfit) {
      $SM.add('stores["'+k+'"]', Path.outfit[k]);
      if(World.leaveItAtHome(k)) {
        Path.outfit[k] = 0;
      }
    }
  },

  leaveItAtHome: function(thing) {
     return thing != 'cured meat' && thing != 'bullets' && thing != 'energy cell'  && 
      thing != 'charm' && thing != 'medicine' && thing != 'stim' && thing != 'hypo' &&
      typeof World.Weapons[thing] == 'undefined' && typeof Room.Craftables[thing] == 'undefined';
  },

  getMaxHealth: function() {
    if($SM.get('stores["kinetic armour"]', true) > 0) {
      return World.BASE_HEALTH + 75;
    } else if($SM.get('stores["s armour"]', true) > 0) {
      return World.BASE_HEALTH + 35;
    } else if($SM.get('stores["i armour"]', true) > 0) {
      return World.BASE_HEALTH + 15;
    } else if($SM.get('stores["l armour"]', true) > 0) {
      return World.BASE_HEALTH + 5;
    }
    return World.BASE_HEALTH;
  },

  getHitChance: function() {
    if($SM.hasPerk('precise')) {
      return World.BASE_HIT_CHANCE + 0.1;
    }
    return World.BASE_HIT_CHANCE;
  },

  getMaxWater: function() {

    if($SM.get('stores["fluid recycler"]', true) > 0) {
      return World.BASE_WATER + 100;
    } else if($SM.get('stores["water tank"]', true) > 0) {
      return World.BASE_WATER + 50;
    } else if($SM.get('stores.cask', true) > 0) {
      return World.BASE_WATER + 20;
    } else if($SM.get('stores.waterskin', true) > 0) {
      return World.BASE_WATER + 10;
    }
    return World.BASE_WATER;
  },

  outpostUsed: function(x, y) {
    x = typeof x == 'number' ? x : World.curPos[0];
    y = typeof y == 'number' ? y : World.curPos[1];
    var used = World.usedOutposts[x + ',' + y];
    return typeof used != 'undefined' && used === true;
  },

  useOutpost: function() {
    Notifications.notify(null, _('water replenished'));
    World.setWater(World.getMaxWater());
    // Mark this outpost as used
    World.usedOutposts[World.curPos[0] + ',' + World.curPos[1]] = true;
  },

  onArrival: function() {
    Engine.tabNavigation = false;
    // Clear the embark cooldown
    Button.clearCooldown($('#embarkButton'));
    Engine.keyLock = false;
    // Explore in a temporary world-state. We'll commit the changes if you return home safe.
    if(World.hex) {
      World.state = World.worldFlags();
      World.state.map = World.hex.map.map(function(col) { return col.slice(); });
      World.state.mask = World.hex.mask.map(function(col) { return col.slice(); });
    } else {
      World.state = $.extend(true, {}, $SM.get('game.world'));
    }
    World.setWater(World.getMaxWater());
    World.setHp(World.getMaxHealth());
    World.foodMove = 0;
    World.waterMove = 0;
    World.starvation = false;
    World.thirst = false;
    World.usedOutposts = {};
    // settlers waiting to found a city come along; the trek sets out from their city
    var from = World.hex && typeof Network != 'undefined' ? Network.onEmbark() : null;
    World.curPos = World.copyPos(from || World.VILLAGE_POS);
    World.cam = null;
    World.follow = true;
    World.drawMap();
    World.setTitle();
    AudioEngine.playBackgroundMusic(AudioLibrary.MUSIC_WORLD);
    World.dead = false;
    $('div#bagspace-world > div').empty();
    World.updateSupplies();
    $('#bagspace-world').width($('#map').width());
  },

  setTitle: function() {
    document.title = _('A Barren World');
  },

  copyPos: function(pos) {
    return [pos[0], pos[1]];
  },

  handleStateUpdates: function(e){

  }
};
