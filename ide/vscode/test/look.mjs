// Every control the preview draws, photographed, to hold against VS Code's own components: the page
// docs/controls.xtmd in the preview, in the editor's dark theme or, with THEME="Default Light
// Modern", its light one. Screenshots in test/out/look/<dark|light>:
//
//   xvfb-run -a -s "-screen 0 1600x1000x24" node test/look.mjs

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, "..");
const workspace = join(here, "workspace");
const out = join(here, "out", "look", (process.env.THEME ?? "dark").toLowerCase().includes("light") ? "light" : "dark");
const user = join(tmpdir(), `xtmd-vscode-${process.pid}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(join(user, "data", "User"), { recursive: true });
writeFileSync(
  join(user, "data", "User", "settings.json"),
  JSON.stringify({
    "workbench.colorTheme": process.env.THEME ?? "Default Dark Modern",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.enableExperiments": false,
    "security.workspace.trust.enabled": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.ignoreRecommendations": true,
    "editor.minimap.enabled": false,
    "editor.fontSize": 15,
    "editor.hover.delay": 200,
    "window.titleBarStyle": "custom",
    "chat.commandCenter.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "git.openRepositoryInParentFolders": "never",
    "git.enabled": false,
    "github.copilot.enable": { "*": false },
  }),
);

const code = await downloadAndUnzipVSCode("stable");
const app = await electron.launch({
  executablePath: code,
  args: [
    `--extensionDevelopmentPath=${extension}`,
    `--user-data-dir=${join(user, "data")}`,
    `--extensions-dir=${process.env.EXTENSIONS ?? join(user, "extensions")}`,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-gpu",
    "--no-sandbox",
    workspace,
    join(workspace, "docs", "controls.xtmd"),
  ],
  timeout: 120000,
});
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1600, 1000);
  w.center();
});
const steps = [];
const pause = (ms) => win.waitForTimeout(ms);
async function shot(name, what) {
  await pause(400);
  await win.screenshot({ path: join(out, `${name}.png`) });
  steps.push({ name, what });
  console.log(`${name}: ${what}`);
}
async function palette(command) {
  await win.keyboard.press("Control+Shift+P");
  await win.locator(".quick-input-widget input").waitFor();
  await win.keyboard.type(command, { delay: 15 });
  await pause(500);
  await win.keyboard.press("Enter");
}
/** The editor line holding `text`, as an element. */
const line = (text) => win.locator(".view-line", { hasText: text }).first();
/** The token on a line that is exactly `word`. */
const word = (l, w) => line(l).locator("span[class*='mtk']", { hasText: new RegExp(`^${w}$`) }).first();

/** The page in the preview's webview. */
const page = () => win.frameLocator("iframe.webview").first().frameLocator("iframe");

try {
  await win.locator(".monaco-workbench").waitFor({ timeout: 60000 });
  await win.locator(".view-line", { hasText: "Controls" }).first().waitFor({ timeout: 30000 });
  await pause(5000);
  await win.locator(".view-line", { hasText: "Controls" }).first().click();
  await win.keyboard.press("Control+Shift+V");
  await page().locator("[data-xtmd-root]").waitFor({ timeout: 30000 });
  await pause(3000);
  await shot("1-buttons-choices", "Buttons, a checkbox, a switch, radios, tabs and list options");
  // the slider: hovered, then focused by the keyboard
  const slider = page().locator("input[type=range]").first();
  await slider.scrollIntoViewIfNeeded();
  await slider.hover();
  await pause(500);
  await shot("2-input-hover", "Input boxes and the slider, the pointer over the slider");
  await slider.focus();
  await win.keyboard.press("ArrowRight");
  await pause(400);
  await shot("3-slider-focus", "The slider focused from the keyboard and moved one step");
  await page().locator("text=Show more").first().click();
  await pause(800);
  await shot("4-overlay", "The popover open over the page");
  await page().locator("table").first().scrollIntoViewIfNeeded();
  await pause(400);
  await shot("5-text", "Markdown's blocks: text, a quote, a list, a table and code");
} catch (e) {
  await win.screenshot({ path: join(out, "failed.png") }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await app.close();
}
