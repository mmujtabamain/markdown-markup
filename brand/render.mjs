// Draws the brand's PNGs and favicon.ico from its SVGs, in Chromium: node brand/render.mjs
// Chromium is XTMD_CHROMIUM's, as the target checks use, or Playwright's own.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const { chromium } = createRequire(join(repo, "ide/vscode/package.json"))("playwright-core");

// [svg, png, width, height]
const PNGS = [
  ["icon.svg", "png/icon-128.png", 128, 128],
  ["icon.svg", "png/icon-256.png", 256, 256],
  ["icon.svg", "png/icon-512.png", 512, 512],
  ["icon.svg", "png/icon-1024.png", 1024, 1024],
  ["logo.svg", "png/logo.png", 786, 104],
  ["logo-dark.svg", "png/logo-dark.png", 786, 104],
  ["github/avatar.svg", "github/avatar.png", 1024, 1024],
  ["github/social-preview.svg", "github/social-preview.png", 1280, 640],
  ["github/avatar.svg", "apple-touch-icon.png", 180, 180],
  ["icon.svg", "../ide/vscode/media/icon.png", 256, 256],
];
// [svg, size]: at 16 px the whole mark is too small to read, so it is the call sign alone.
const ICO = [["favicon-16.svg", 16], ["icon.svg", 32], ["icon.svg", 48]];

const browser = await chromium.launch({ executablePath: process.env.XTMD_CHROMIUM || undefined, args: ["--disable-gpu"] });
const page = await browser.newPage();

async function draw(svg, width, height) {
  await page.setViewportSize({ width, height });
  const source = readFileSync(join(here, svg), "utf8").replace("<svg ", `<svg width="${width}" height="${height}" `);
  await page.setContent(`<!doctype html><body style="margin:0">${source}</body>`);
  return page.screenshot({ omitBackground: true });
}

for (const [svg, png, width, height] of PNGS) {
  const out = join(here, png);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await draw(svg, width, height));
  console.log(png);
}

// favicon.ico: each size a PNG, which every browser since 2007 reads in an .ico.
const images = [];
for (const [svg, size] of ICO) images.push(await draw(svg, size, size));
const head = Buffer.alloc(6 + 16 * images.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(images.length, 4);
let offset = head.length;
images.forEach((png, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(ICO[i][1], at);
  head.writeUInt8(ICO[i][1], at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(png.length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
writeFileSync(join(here, "favicon.ico"), Buffer.concat([head, ...images]));
console.log("favicon.ico");
await browser.close();
