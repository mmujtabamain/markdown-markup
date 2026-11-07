#!/usr/bin/env node
// Puts a release's web files and the lesson into each recipe, where its code imports them:
// <recipe>/src/vendor/mkp/ and <recipe>/src/lesson.mkp.md (plain/ has no src/).
//
//   node scripts/setup.mjs                         the web files built from this checkout (scripts/dist.mjs)
//   node scripts/setup.mjs --zip mkp-web-0.1.2.zip a release's zip, as an app would use it
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPES = ['vue', 'svelte', 'solid', 'angular', 'astro', 'plain'];
const args = process.argv.slice(2);
const zip = args.includes('--zip') ? resolve(args[args.indexOf('--zip') + 1]) : null;

const tmp = mkdtempSync(join(tmpdir(), 'mkp-recipes-'));
let web;
if (zip) {
  web = join(tmp, 'web');
  mkdirSync(web);
  execFileSync('unzip', ['-q', '-j', zip, '-d', web]);
} else {
  execFileSync(process.execPath, [join(here, '../scripts/dist.mjs'), '--out', join(tmp, 'dist')], { stdio: 'inherit' });
  web = join(tmp, 'dist/web');
}
for (const r of RECIPES) {
  const src = join(here, r, r === 'plain' ? '' : 'src');
  rmSync(join(src, 'vendor/mkp'), { recursive: true, force: true });
  cpSync(web, join(src, 'vendor/mkp'), { recursive: true });
  cpSync(join(here, 'lesson.mkp.md'), join(src, 'lesson.mkp.md'));
}
rmSync(tmp, { recursive: true, force: true });
console.log(`recipes: ${readdirSync(join(here, 'vue/src/vendor/mkp')).join(', ')} in ${RECIPES.join(', ')}`);
