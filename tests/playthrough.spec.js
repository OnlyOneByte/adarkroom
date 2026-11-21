// SPDX-License-Identifier: MIT
// @slow: a fresh save played the way a player plays it, prologue to the blaze era, every beat through its real
// trigger (tests/playthrough-play.js has the stages). Game state is never set: only stores of the original's
// basic goods (its grind) are topped up, and time runs on a fake clock. Each stage logs its time and what
// blocked it; the findings are in design/text/qa-playthrough.md (Teehee's workspace).
// Kept out of the default run (playwright.config.js): `npm run test:slow` runs it (about 7 minutes).
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openPlay } from './playthrough-open.js';
import { Log, stage } from './playthrough-stages.js';
import { STAGES } from './playthrough-play.js';

// the stages that play through today; a regression in one of them fails the run. The rest are known blockers
// (design/text/qa-playthrough.md), recorded but not failed on
const PLAYS = ['prologue', 'village', 'stoneHearth', 'brazier', 'woodshed', 'axeHead', 'tallow', 'district', 'cairn',
  'waystation', 'found', 'economy', 'influence', 'force', 'resettle', 'chimney', 'charcoal', 'potters', 'tower', 'forgeMasters', 'powers'];

test('@slow a fresh save played from the prologue to the blaze era, every beat through its own trigger', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const errors = await openPlay(page);
  const log = new Log();
  let game = 0;
  for (const s of STAGES) {
    await stage(page, log, s);
    const r = log.rows[log.rows.length - 1];
    game += r.game || 0;
    r.at = game;
    console.log(`${r.status.padEnd(7)} ${s.id.padEnd(13)} ${r.real.toFixed(1).padStart(6)} s real ${r.game.toFixed(1).padStart(6)} game min (at ${game.toFixed(0)}) ${r.why || ''}`);
  }
  fs.mkdirSync('test-results', { recursive: true });
  errors.push(...(await page.evaluate(() => window.__qaErrors || [])));
  const out = { rows: log.rows, blockers: log.blockers, notes: log.notes, seen: page.__seen || [], errors };
  fs.writeFileSync('test-results/playthrough.json', JSON.stringify(out, null, 1));
  const table = ['| stage | status | real s | game min | at game min | tiers after | why |', '|---|---|---|---|---|---|---|']
    .concat(log.rows.map((r) => `| ${r.name} | ${r.status} | ${r.real.toFixed(1)} | ${(r.game || 0).toFixed(1)} | ${(r.at || 0).toFixed(0)} | ${(r.tiers || []).join(' ')} | ${r.why || ''} |`));
  fs.writeFileSync('test-results/playthrough.md', table.join('\n') + '\n\n' + log.blockers.map((b) => `- **${b.stage}**: ${b.what}`).join('\n') + '\n');
  await test.info().attach('playthrough', { path: 'test-results/playthrough.json', contentType: 'application/json' });

  for (const id of PLAYS) {
    const r = log.rows.find((x) => x.id === id);
    expect.soft(r && r.status, `stage ${id}: ${r && r.why}`).toBe('ok');
  }
});
