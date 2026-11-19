// The extension in real VS Code, driven as a person would and photographed: VS Code (downloaded by
// @vscode/test-electron into .vscode-test) opens test/workspace with this extension loaded, and
// Playwright types, hovers, completes, goes to a definition, opens the outline and the preview and
// presses a button in it. Each step is a screenshot in test/out. Run it on a screen, or under
// xvfb-run on a box without one:
//
//   xvfb-run -a -s "-screen 0 1600x1000x24" node test/vscode.mjs

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, "..");
const workspace = join(here, "workspace");
const out = join(here, "out");
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
const poll = readFileSync(join(workspace, "docs", "poll.xt.md"), "utf8");
const app = await electron.launch({
  executablePath: code,
  args: [
    `--extensionDevelopmentPath=${extension}`,
    `--user-data-dir=${join(user, "data")}`,
    `--extensions-dir=${join(user, "extensions")}`,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-gpu",
    "--no-sandbox",
    workspace,
    join(workspace, "docs", "poll.xt.md"),
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

try {
  await win.locator(".monaco-workbench").waitFor({ timeout: 60000 });
  await pause(3000);

  // 1. the document: highlighting, and the server's errors (none)
  await line("@tally").waitFor({ timeout: 30000 });
  // the server compiles core once as it starts, then the document
  await win.locator(".statusbar-item", { hasText: "Extended Mark" }).first().waitFor({ timeout: 30000 });
  await pause(9000);
  await shot("01-document", "poll.xt.md open: code above @@@, Markdown and widget calls below, highlighted; the status bar says no errors");

  // 2. hover: a pack's widget, how it is declared and its doc
  // the cursor on the name, then Show Hover (Ctrl+K Ctrl+I), as the keyboard does it
  await word('@tally(name = "Yes"', "tally").click();
  await win.keyboard.press("Control+K");
  await win.keyboard.press("Control+I");
  await win.locator(".monaco-hover-content:visible", { hasText: "widget tally" }).first().waitFor({ timeout: 30000 });
  await shot("02-hover-widget", "Hover on @tally: the widget kit declares, with its inputs and defaults, and its doc comment");

  // 3. hover: core's press
  await win.keyboard.press("Escape");
  await pause(300);
  await word("@press(", "press").click();
  await win.keyboard.press("Control+K");
  await win.keyboard.press("Control+I");
  await win.locator(".monaco-hover-content:visible", { hasText: "extern widget press" }).first().waitFor({ timeout: 30000 });
  await shot("03-hover-core", "Hover on @press: core's own declaration and its doc, from the resolved IR with core in it");

  // 4. completion after @: the widgets there are, each with what it needs
  await win.keyboard.press("Escape");
  await win.keyboard.press("Control+End");
  await win.keyboard.press("Enter");
  await win.keyboard.press("Enter");
  await win.keyboard.type("@tal", { delay: 60 });
  await win.keyboard.press("Control+Space");
  await win.locator(".suggest-widget .monaco-list-row").first().waitFor({ timeout: 15000 });
  await shot("04-complete-widget", "Typing @tal: completion offers tally, kit's widget, with how it is declared");
  await win.keyboard.press("Enter");
  await pause(500);
  await shot("05-complete-snippet", "Accepting it writes the call with its required input as a stop to fill in");

  // 5. an error as you type, with its rule's link
  await win.keyboard.type("3", { delay: 60 });
  await pause(2500);
  await win.keyboard.press("Control+Shift+M");
  await pause(1500);
  await shot("06-error", "name = 3: the server's error under it and in Problems, with its code linking to the spec's rule");
  await win.keyboard.press("Control+Shift+M");

  // back to the document as it was
  await palette("File: Revert File");
  await pause(1500);

  // 6. go to definition: into the pack
  await word('@tally(name = "No"', "tally").click();
  await win.keyboard.press("F12");
  await win.locator(".tab.active", { hasText: "kit.xtpack" }).waitFor({ timeout: 15000 });
  await shot("07-definition", "F12 on tally: kit.xtpack opens at the widget's declaration");

  // 7. the outline of the pack
  await palette("Explorer: Focus on Outline View");
  await pause(1500);
  await shot("08-outline", "The outline of kit.xtpack: its pack and widget, and the widget's inputs");

  // 8. format document
  await win.keyboard.press("Control+Home");
  await win.keyboard.press("Control+End");
  await win.keyboard.press("Control+Shift+Tab");
  await win.keyboard.press("Control+P");
  await win.keyboard.type("poll.xt.md", { delay: 20 });
  await pause(500);
  await win.keyboard.press("Enter");
  await pause(800);
  await line("yes: int").click();
  await win.keyboard.press("Home");
  await win.keyboard.type("      ", { delay: 20 });
  await pause(800);
  await shot("09-messy", "Indentation broken by hand");
  await palette("Format Document");
  await pause(1500);
  await shot("10-formatted", "Format Document: xtmd's own layout back");

  // 9. the preview: the vscode target, VS Code's components in the editor's theme
  await palette("Extended Mark: Open Preview to the Side");
  const webview = async () => {
    for (let k = 0; k < 60; k++) {
      for (const f of win.frames()) {
        try {
          if (await f.locator("[data-xtmd-root]").count()) return f;
        } catch {}
      }
      await pause(500);
    }
    throw new Error("the preview didn't draw");
  };
  const preview = await webview();
  await pause(1500);
  await shot("11-preview", "The preview beside the editor: the page drawn by the vscode target");
  await preview.locator("button", { hasText: "Add 1" }).first().click();
  await preview.locator("button", { hasText: "Add 1" }).first().click();
  await preview.locator("button", { hasText: "I have read the rules" }).first().click();
  await pause(1000);
  await shot("12-preview-pressed", "Pressing Add 1 twice and the checkbox: the count and the share follow, the checkbox ticks");

  // 10. a draft that doesn't compile: the preview keeps the last page that did, and says why
  await line("Should the team").click();
  await win.keyboard.press("End");
  await win.keyboard.type(" \\{$state.nope}", { delay: 30 });
  await pause(2000);
  await shot("13-preview-broken", "A broken draft: the preview keeps the last page and says why at its top");
  await palette("File: Revert File");
  await pause(1500);

  // 11. the light theme: the preview follows the editor
  const settingsFile = join(user, "data", "User", "settings.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  writeFileSync(settingsFile, JSON.stringify({ ...settings, "workbench.colorTheme": "Default Light Modern" }));
  await pause(4000);
  await shot("14-light", "The editor in Light Modern: the preview's components follow its theme");
} catch (e) {
  await win.screenshot({ path: join(out, "failed.png") });
  console.error(`failed after ${steps.length} steps: ${e.message}`);
  await app.close();
  process.exit(1);
}
writeFileSync(join(out, "steps.json"), JSON.stringify(steps, null, 2));
// leave the files as they were, unsaved changes dropped
writeFileSync(join(workspace, "docs", "poll.xt.md"), poll);
await app.close();
rmSync(user, { recursive: true, force: true });
