// SPDX-License-Identifier: MIT
// The tools of the fresh-save playthrough (tests/playthrough.spec.js, stages in tests/playthrough-play.js).
// Each stage plays one stretch of the game through its real triggers: button clicks, trek steps, or the module
// call a click makes. Game state is never set, except stores of the original game's basic goods where its
// grind is the only gate; time is sped up with the page's fake clock (page.clock.runFor), which runs every
// game timer in order.

// Ample basic stores: the original's gathering, trapping and trading grind. Given to the capital's stockpile.
export const BASICS = {
  wood: 50000, fur: 10000, meat: 10000, scales: 1000, teeth: 1000, leather: 5000, cloth: 2000, 'cured meat': 5000,
  iron: 5000, steel: 3000, sulphur: 1000, bait: 1000, medicine: 200, bullets: 1000, coal: 500,
};

export const MIN = 60 * 1000;

// Game minutes the fake clock has run since the page loaded.
export const gameMinutes = (page) => page.evaluate(() => (Date.now() - window.__t0) / 60000);

// Runs the clock forward by ms of game time, in slices. Returns true once `until` (a page function, given
// `arg`) is true, false if the time is spent first. Between slices a scene the stage did not ask for is
// settled (settleEvents). The fake clock fires every game timer in order: the income, the fire tick, the
// city-states, the armies. `each` runs before every slice (the player's own clicks).
export async function advance(page, ms, { until, arg, slice = 10000, onEvent, each } = {}) {
  const end = (await page.evaluate(() => Date.now())) + ms;
  for (;;) {
    if (each) await each();
    if (until && (await page.evaluate(until, arg))) return true;
    const now = await page.evaluate(() => Date.now());
    if (now >= end) return !until;
    await page.clock.runFor(Math.min(slice, end - now));
    if (until && (await page.evaluate(until, arg))) return true;
    await settleEvents(page, onEvent);
  }
}

// What the player answers to a scene the stage is not waiting on, by its title: the choice that moves the story
// on. Anything else is left the way a player who only wants to get on would leave it.
export const ANSWERS = {};

// An event panel the stage did not ask for (a sighting, a threshold, a random room event, a fight): recorded
// in page.__seen and answered. onEvent(ev) may handle it first (return true).
export async function settleEvents(page, onEvent) {
  for (let i = 0; i < 30; i++) {
    const ev = await eventNow(page);
    if (!ev) return;
    if (onEvent && (await onEvent(ev))) { await page.clock.runFor(300); continue; }
    if (await page.evaluate(() => !!$('#enemy').length && !Events.won)) {
      seen(page, `fight: ${ev.title}`);
      await fight(page);
      continue;
    }
    const want = ANSWERS[ev.title];
    // (a button's text may run on into its cost: "paycoal300")
    const pick = (want && ev.btns.find((b) => (Array.isArray(want) ? want : [want]).some((w) => b === w || b.startsWith(w)))) ||
      ev.btns.find((b) => /^(take everything|take all you can)$/i.test(b)) ||
      ev.btns.find((b) => /^(go on|good|continue|leave|ignore|not now|ok|go home|move on|close|carry on)$/i.test(b)) ||
      ev.btns[ev.btns.length - 1];
    if (!pick) { await page.clock.runFor(1000); continue; }
    seen(page, `${ev.title}: ${pick}`);
    await clickEvent(page, pick);
  }
}

const seen = (page, s) => { (page.__seen = page.__seen || []).push(s); };

export const eventNow = (page) => page.evaluate(() => {
  const e = Events.activeEvent();
  if (!e) return null;
  const btns = Events.eventPanel().find('.button').toArray().filter((b) => !$(b).hasClass('disabled')).map((b) => $(b).text());
  return { title: e.title, text: Events.eventPanel().find('#description').text().slice(0, 300), btns };
});

// Clicks an event button by its exact text (as the player would). Returns false if there is none.
export async function clickEvent(page, text) {
  const ok = await page.evaluate((text) => {
    // a button's text may run on into its cost ("lay the stoneswood200")
    const all = Events.eventPanel().find('.button').toArray().filter((b) => !$(b).hasClass('disabled'));
    const b = all.find((b) => $(b).text() === text) || all.find((b) => $(b).text().startsWith(text));
    if (!b) return false;
    // a click that throws is the game's error (recorded with the page's errors), not the player's
    try {
      $(b).click();
    } catch (e) {
      (window.__qaErrors = window.__qaErrors || []).push(`click "${text}" in ${(Events.activeEvent() || {}).title}: ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
    }
    return true;
  }, text);
  await page.clock.runFor(400);
  return ok;
}

// Waits (game time) for a scene whose title or text matches, leaving it open. Returns the event or null.
export async function waitScene(page, { title, text, ms = 5 * MIN, each }) {
  const ok = await advance(page, ms, {
    arg: { title, text }, slice: 2000, each,
    until: ({ title, text }) => {
      const e = Events.activeEvent();
      return !!e && (!title || e.title === title) && (!text || Events.eventPanel().text().includes(text));
    },
  });
  return ok ? eventNow(page) : null;
}

// Plays a scene through: waits for it, then clicks each button in turn (a later one waits for its scene).
export async function playScene(page, { title, text, ms, buttons }) {
  const ev = await waitScene(page, { title, text, ms });
  if (!ev) return null;
  seen(page, `${ev.title}: ${buttons.join(' > ')}`);
  for (const b of buttons) {
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) {
      ok = await clickEvent(page, b);
      if (!ok) await page.clock.runFor(500);
    }
    if (!ok) return { ...ev, missing: b, btns: (await eventNow(page) || {}).btns };
  }
  return ev;
}

// A fight on the trek, fought as a player would: the first weapon ready, meat when hurt; then the loot taken
// and the scene left.
export async function fight(page) {
  for (let i = 0; i < 600; i++) {
    const st = await page.evaluate(() => {
      if (!Events.activeEvent()) return 'none';
      if (!$('#enemy').length || Events.won) return 'over';
      if (World.health < World.getMaxHealth() * 0.5) $('#eat, #meds, #hypo').filter((i, b) => !$(b).hasClass('disabled')).first().click();
      // every weapon whose cooldown is up (each button keeps its own)
      $('#attackButtons .button').filter((i, b) => !$(b).hasClass('disabled')).each((i, b) => { if (!Events.won && $('#enemy').length) $(b).click(); });
      return 'fighting';
    });
    if (st !== 'fighting') break;
    await page.clock.runFor(250);
  }
  await page.clock.runFor(1500);
  for (let i = 0; i < 6; i++) {
    const ev = await eventNow(page);
    if (!ev || (await page.evaluate(() => World.dead))) return;
    if (await page.evaluate(() => !!$('#enemy').length && !Events.won)) return; // the next fight of a setpiece
    const pick = ev.btns.find((b) => /^take (everything|all you can)/.test(b)) || ev.btns.find((b) => /^(continue|go on)$/.test(b)) ||
      ev.btns.find((b) => /^leave$/.test(b));
    if (!pick) return;
    await clickEvent(page, pick);
    if (!/^take/.test(pick)) return;
  }
}

// A landmark's scene (a cave, a house, an abandoned town) played the way an explorer plays it: in, on, take
// what is there, fight what comes; out only when nothing else is offered.
export async function playSetpiece(page) {
  const prefer = /^(go inside|enter|go in|explore|continue|go on|search|investigate|look around|go deeper|climb down|follow|open|take everything|take all you can|take)/i;
  for (let i = 0; i < 60; i++) {
    const ev = await eventNow(page);
    if (!ev || (await page.evaluate(() => World.dead))) return;
    if (await page.evaluate(() => !!$('#enemy').length && !Events.won)) { await fight(page); continue; }
    const pick = ev.btns.find((b) => prefer.test(b)) || ev.btns.find((b) => /^leave/i.test(b)) || ev.btns[0];
    if (!pick) { await page.clock.runFor(1000); continue; }
    seen(page, `${ev.title}: ${pick}`);
    await clickEvent(page, pick);
  }
}

/*
 * The trek
 */
// to the trek's tab, an outfit packed with the outfitting buttons (as much as fits), then embark
export const OUTFIT = { 'steel sword': 1, rifle: 1, bullets: 50, torch: 10, medicine: 10, 'cured meat': 1000 };
export async function embark(page, outfit = OUTFIT) {
  // torches for the dark places, crafted in the room before setting out (the room's torch button)
  await page.evaluate(() => { for (let i = 0; i < 20 && $SM.get('stores.torch', true) < 10; i++) Room.build($('<div>').attr('buildThing', 'torch')); });
  // after a death the wanderer wakes in the room, and the embark button cools down
  for (let i = 0; i < 60 && (await page.evaluate(() => Engine.keyLock)); i++) await page.clock.runFor(1000);
  if (!(await page.evaluate(() => Engine.activeModule === Path))) {
    await page.locator('#location_path').click({ timeout: 3000 }).catch(() => page.evaluate(() => $('#location_path').click()));
    await page.clock.runFor(1500);
  }
  for (let i = 0; i < 120 && (await page.evaluate(() => $('#embarkButton').hasClass('disabled'))); i++) await page.clock.runFor(1000);
  await page.evaluate((outfit) => {
    Path.updateOutfitting();
    for (const k in outfit) {
      const b = $('#outfit_row_' + k.replace(/ /g, '-') + ' .upBtn')[0];
      if (b) Path.increaseSupply.call(b, { data: outfit[k] });
    }
  }, outfit);
  await page.locator('#embarkButton').click({ timeout: 3000 }).catch(() => page.evaluate(() => $('#embarkButton').click()));
  await page.clock.runFor(1500);
  return page.evaluate(() => !!World.state);
}

// walks the wanderer step by step to a hex (or the nearest of several), settling what the steps bring up.
// Returns 'there', 'home' (the trek ended), 'dead', 'stuck' (no way), or 'event' (stopAt(ev) said stop).
export async function walkTo(page, goals, { stopAt, max = 600, avoid } = {}) {
  if (!Array.isArray(goals[0])) goals = [goals];
  for (let i = 0; i < max; i++) {
    const d = await page.evaluate(({ g, avoid }) => __qa.step(g, avoid), { g: goals, avoid: avoid || [] });
    if (d === -2) return (await page.evaluate(() => World.dead)) ? 'dead' : 'home';
    if (d === -3) return 'there';
    if (d === -1) return 'stuck';
    await page.evaluate((d) => World.moveHex(d), d);
    if (await page.evaluate(() => !!Events.activeEvent())) {
      if (stopAt && (await stopAt(await eventNow(page)))) return 'event';
      await settleEvents(page);
    }
    if (await page.evaluate(() => World.dead)) { await page.clock.runFor(6000); return 'dead'; }
  }
  return 'stuck';
}

// home: the nearest of our cities, walked to
export async function walkHome(page) {
  if (!(await page.evaluate(() => !!World.state))) return 'home';
  const homes = await page.evaluate(() => __qa.homes());
  const r = await walkTo(page, homes);
  await page.clock.runFor(1500);
  if (r === 'there' || r === 'home') return 'home';
  return r;
}

// The log: one row a stage, with the game minutes it took and what blocked it.
export class Log {
  constructor() { this.rows = []; this.blockers = []; this.notes = []; }
  block(stage, what, repro, fix) { this.blockers.push({ stage, what, repro, fix }); }
  note(stage, what) { this.notes.push({ stage, what }); }
}

// Runs a stage: times it (real seconds and game minutes), records ok / blocked / skipped. A stage whose
// prerequisites were blocked is skipped (its row says so) rather than poking the state it needed.
export async function stage(page, log, s) {
  const missing = (s.needs || []).filter((n) => !log.rows.some((r) => r.id === n && r.status === 'ok'));
  if (missing.length) {
    log.rows.push({ id: s.id, name: s.name, status: 'skipped', why: `needs ${missing.join(', ')}`, real: 0, game: 0 });
    return false;
  }
  const t0 = Date.now(), g0 = await gameMinutes(page);
  let status = 'ok', why = '';
  try {
    const r = await s.run({ page, log, id: s.id });
    if (r === false) { status = 'blocked'; why = 'see blockers'; }
  } catch (e) {
    status = 'blocked';
    why = String(e && e.message || e).split('\n')[0].slice(0, 300);
    log.block(s.id, `stage threw: ${why}`, '', '');
  }
  const tiers = await page.evaluate(() => Object.keys((typeof Network != 'undefined' && Network.tiers()) || {}).sort());
  log.rows.push({ id: s.id, name: s.name, status, why, real: (Date.now() - t0) / 1000, game: (await gameMinutes(page)) - g0, tiers });
  return status === 'ok';
}
