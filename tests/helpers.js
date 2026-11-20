// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';

const JQUERY = fs.readFileSync(path.resolve('lib/jquery.min.js'), 'utf8');

// Opens the game with the given save (or a fresh one) and collects errors.
// Every non-local request is answered locally: the jQuery CDN is served from
// lib/jquery.min.js, anything else is aborted, so tests never touch the network.
export async function openGame(page, { save } = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    if (route.request().url().includes('jquery.min.js')) {
      return route.fulfill({ contentType: 'application/javascript', body: JQUERY });
    }
    return route.abort();
  });

  if (save) {
    // Seed storage once, before any game script runs.
    await page.addInitScript((state) => {
      if (!sessionStorage.seeded) {
        sessionStorage.seeded = '1';
        localStorage.clear();
        localStorage.gameState = state;
      }
    }, JSON.stringify(save));
  }

  await page.goto('/index.html');
  await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);
  return errors;
}

export const getState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(State)));
