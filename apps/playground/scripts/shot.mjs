#!/usr/bin/env node
// Screenshots of playground cases, for progress reports and reviews.
//   npm run shot -- <target> [<target> …] [--page] [--dark] [--video] [--images --every 400ms] [--wait 600] [--play]
// A target is a fixture case, pack/widget@N/case (e.g. mkp-math/orbit@1/default), or a document,
// folder/path.mkp.md (e.g. examples/spec18/roots.mkp.md). Prints the files it writes, one per line.

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
const targets = args.filter((a, i) => !a.startsWith('--') && !['--every', '--wait', '--width'].includes(args[i - 1]));
if (!targets.length) {
  console.error('usage: npm run shot -- <pack/widget@N/case | folder/doc.mkp.md> [--page] [--dark] [--video] [--images --every 400ms] [--play]');
  process.exit(2);
}
const ms = (s) => (String(s).endsWith('ms') ? Number(String(s).slice(0, -2)) : String(s).endsWith('s') ? Number(String(s).slice(0, -1)) * 1000 : Number(s));

const PORT = 5181;
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
const width = Number(opt('--width', 1100));
try {
  for (const t of targets) {
    const id = t.endsWith('.mkp.md') ? `doc:${t}` : `case:${t}`;
    const name = t.replace(/[^A-Za-z0-9@.-]+/g, '_') + (flag('--dark') ? '-dark' : '');
    const video = flag('--video');
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: flag('--dark') ? 'dark' : 'light', ...(video ? { recordVideo: { dir: out, size: { width, height: 900 } } } : {}) });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const hash = new URLSearchParams({ e: id, ...(flag('--dark') ? { theme: 'dark' } : {}), ...(flag('--play') ? { play: '1' } : {}) });
    await page.goto(`http://localhost:${PORT}/#${hash}`);
    await page.waitForSelector('[data-mkp-ready]', { timeout: 60000 });
    await page.waitForTimeout(Number(opt('--wait', 700)));
    const target = flag('--page') ? page : page.locator('.pg-view').first();
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
  if (server) process.kill(-server.pid);
}
