#!/usr/bin/env node
// Screenshots of the playground's drawings, for progress reports and reviews.
//   npm run shot -- <target> [<target> …] [--page] [--dark] [--width 1280] [--video] [--images --every 400ms] [--wait 600] [--play]
// A target is an entry of the sidebar: an example (05-counter, ex:05-counter or
// examples/05-counter/doc.mkp.md), a limit (limit:01-yaml-item-type or
// examples/limits/01-yaml-item-type.mkp.md), a widget page (base:08-press, derived:01-card) or a
// conformance case (case:base.actions.1.bumped).
// It shoots the drawing, or the whole page with --page; --play plays a case's steps first.
// Prints the files it writes, one per line.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const out = join(app, '.shots');
mkdirSync(out, { recursive: true });

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const targets = args.filter((a, i) => !a.startsWith('--') && !['--every', '--wait', '--width', '--count', '--length'].includes(args[i - 1]));
if (!targets.length) {
  console.error('usage: npm run shot -- <05-counter | ex:… | limit:… | case:…> [--page] [--dark] [--width 1280] [--video] [--images --every 400ms] [--play]');
  process.exit(2);
}
const ms = (s) => (String(s).endsWith('ms') ? Number(String(s).slice(0, -2)) : String(s).endsWith('s') ? Number(String(s).slice(0, -1)) * 1000 : Number(s));

// MKP_SHOT_PORT lets two copies of the repo shoot at once
const PORT = Number(process.env.MKP_SHOT_PORT) || 5181;
async function up() {
  try {
    const r = await fetch(`http://localhost:${PORT}/`);
    return r.ok;
  } catch {
    return false;
  }
}
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, [join(app, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: app, stdio: 'ignore', detached: true });
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const width = Number(opt('--width', 1280));

/** The sidebar's id for a target. */
function entryId(t) {
  if (/^(ex|base|derived|limit|case|open):/.test(t)) return t;
  const ex = /(?:^|examples\/)(\d\d-[^/]+?)(?:\/doc\.mkp\.md)?$/.exec(t);
  const lim = /limits\/(\d\d-[^/]+)\.mkp\.md$/.exec(t);
  if (lim) return `limit:${lim[1]}`;
  if (ex) return `ex:${ex[1]}`;
  return `case:${t}`;
}
try {
  for (const t of targets) {
    const id = entryId(t);
    const name = t.replace(/[^A-Za-z0-9@.-]+/g, '_') + (flag('--dark') ? '-dark' : '');
    const video = flag('--video');
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: flag('--dark') ? 'dark' : 'light', ...(video ? { recordVideo: { dir: out, size: { width, height: 900 } } } : {}) });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const hash = new URLSearchParams({ e: id, theme: flag('--dark') ? 'dark' : 'light', pane: 'preview' });
    await page.goto(`http://localhost:${PORT}/docs/#${hash}`);
    await page.waitForSelector(`[data-pg-preview][data-pg-entry="${id}"]:is([data-pg-status=drawn], [data-pg-status=failed])`, { state: 'attached', timeout: 60000 });
    if (flag('--play')) {
      const play = page.getByRole('button', { name: /Play the case/ });
      if (await play.count()) await play.click();
      else console.error(`${t} has no play steps`);
    }
    await page.waitForTimeout(Number(opt('--wait', 700)));
    const drawn = page.locator('[data-pg-stage]').locator('xpath=..');
    const target = flag('--page') || !(await drawn.count()) ? page : drawn.first();
    if (flag('--images')) {
      const every = ms(opt('--every', '400ms'));
      const count = Number(opt('--count', 8));
      for (let k = 0; k < count; k++) {
        const f = join(out, `${name}-${String(k).padStart(2, '0')}.png`);
        await target.screenshot({ path: f });
        console.log(f);
        await page.waitForTimeout(every);
      }
    } else if (video) {
      await page.waitForTimeout(ms(opt('--length', '6s')));
    } else {
      const f = join(out, `${name}.png`);
      await target.screenshot({ path: f });
      console.log(f);
    }
    if (errors.length) console.error(`page errors in ${t}:\n${errors.join('\n')}`);
    await ctx.close();
    if (video) {
      const v = await page.video()?.path();
      if (v) console.log(v);
    }
  }
} finally {
  await browser.close();
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
}
