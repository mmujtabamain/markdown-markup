// The ways in to the preview, and the file icons, in real VS Code: the preview button in a document's
// title, Ctrl+Shift+V, Extended Mark Preview among the editors a document can be reopened with, and
// the explorer's menu. Each step is a screenshot in test/out/preview. As test/vscode.mjs:
//
//   xvfb-run -a -s "-screen 0 1600x1000x24" node test/preview.mjs     (THEME="Default Light Modern" for light)
//
// The file icons show in an icon theme that shows a language's own icon where it has none of its
// own, as Seti and Material Icon Theme do (VS Code's Minimal and Modern icons don't), so the run picks
// ICON_THEME (default Seti) as a person would. For Material Icon Theme, install it into a folder:
// EXTENSIONS=<that folder> ICON_THEME="Material Icon Theme".

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, "..");
const workspace = join(here, "workspace");
const out = join(here, "out", "preview");
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
    join(workspace, "docs", "poll.xtmd"),
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

const fail = (why) => {
  throw new Error(why);
};
/** The editor group's tab that reads `text`. */
const tab = (text) => win.locator(".tab", { hasText: text });

try {
  await win.locator(".monaco-workbench").waitFor({ timeout: 60000 });
  await win.locator(".view-line", { hasText: "@tally" }).first().waitFor({ timeout: 30000 });
  await pause(6000);

  // 1. the file icons: a page for a document, a box for a pack, in an icon theme that shows them
  await win.keyboard.press("Control+Shift+P");
  await win.locator(".quick-input-widget input").waitFor();
  await win.keyboard.type("Preferences: File Icon Theme", { delay: 15 });
  await pause(600);
  await win.keyboard.press("Enter");
  await pause(1000);
  await win.keyboard.type(process.env.ICON_THEME ?? "Seti", { delay: 30 });
  await pause(1200);
  await win.keyboard.press("Enter");
  await pause(3000);
  for (const folder of ["kit", "docs"]) {
    const row = win.locator(".explorer-folders-view .monaco-list-row", { hasText: new RegExp(`^${folder}$`) }).first();
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  }
  await win.locator(".explorer-folders-view .monaco-list-row", { hasText: "kit.xtmdpack" }).waitFor();
  {
    const icons = await win.locator(".explorer-folders-view .monaco-list-row .monaco-icon-label").evaluateAll((ls) =>
      ls.map((l) => [l.getAttribute("aria-label")?.split(",")[0] ?? "", getComputedStyle(l, "::before").backgroundImage]),
    );
    for (const [name, image] of icons.filter(([n]) => /\.xtmd(pack)?$/.test(n))) {
      const want = name.endsWith("pack") ? "xtmdpack-" : "xtmd-";
      if (!image.includes(want)) fail(`${name}'s icon is ${image}, not media/${want}*.svg`);
    }
  }
  await win.locator(".explorer-folders-view .monaco-list-row", { hasText: "poll.xtmd" }).first().click();
  await shot("p1-file-icons", "The explorer: poll.xtmd has the document's icon, a page with the @; kit.xtmdpack the pack's, a box with the @");

  // 2. the preview button at the top right of the document
  const button = win.locator(".editor-actions .action-label[aria-label^='Open Preview to the Side']").first();
  await button.waitFor({ timeout: 10000 });
  await button.hover();
  await pause(1200);
  await shot("p2-button", "The preview button at the document's top right, its tooltip showing");
  await button.click();
  await tab("Preview poll.xtmd").waitFor({ timeout: 15000 });
  await pause(5000);
  await shot("p3-beside", "The button opens the preview beside the document");
  await tab("Preview poll.xtmd").click();
  await win.keyboard.press("Control+W");
  await pause(800);

  // 3. Ctrl+Shift+V: the preview in the document's place, as Markdown's own
  await win.locator(".view-line", { hasText: "@tally" }).first().click();
  await win.keyboard.press("Control+Shift+V");
  await tab("Preview poll.xtmd").waitFor({ timeout: 15000 });
  await pause(5000);
  await shot("p4-ctrl-shift-v", "Ctrl+Shift+V: the preview opens in the document's place");
  await win.keyboard.press("Control+W");
  await pause(800);

  // 4. Reopen Editor With…: Extended Mark Preview is one of the document's editors. The editor's own
  // menu of them (Text Editor ⌄, right of the breadcrumbs, there for an editor opened once the
  // extension runs) lists the same; it is a native menu, which a screenshot doesn't catch.
  await win.locator(".explorer-folders-view .monaco-list-row", { hasText: "poll.xtmd" }).first().click();
  await win.locator(".breadcrumbs-editor-type").first().waitFor({ timeout: 10000 });
  await win.keyboard.press("Control+Shift+P");
  await win.locator(".quick-input-widget input").waitFor();
  await win.keyboard.type("View: Reopen Editor With...", { delay: 15 });
  await pause(600);
  await win.locator(".quick-input-list .monaco-list-row", { hasText: "Reopen Editor With..." }).first().click();
  const choice = win.locator(".quick-input-list .monaco-list-row", { hasText: "Extended Mark Preview" }).first();
  await choice.waitFor({ timeout: 10000 });
  await pause(600);
  await shot("p5-reopen-with", "Reopen Editor With…: Extended Mark Preview among the document's editors (the Text Editor ⌄ menu at the top right lists the same)");
  await choice.click();
  await pause(6000);
  if (!(await win.frameLocator("iframe.webview").first().frameLocator("iframe").locator("[data-xtmd-root]").count())) fail("the preview editor drew nothing");
  await shot("p6-preview-editor", "Extended Mark Preview as the document's editor: the page, drawn in VS Code's own components");
  await win.keyboard.press("Control+W");
  await pause(800);

  // 5. the explorer's menu on a document
  await win.locator(".explorer-folders-view .monaco-list-row", { hasText: "poll.xtmd" }).first().click({ button: "right" });
  const item = win.locator(".context-view .action-label", { hasText: "Open Preview to the Side" });
  await item.waitFor({ timeout: 10000 });
  await item.hover();
  await shot("p7-explorer-menu", "The explorer's menu on poll.xtmd: Open Preview to the Side");
  await win.keyboard.press("Escape");

  writeFileSync(join(out, "steps.json"), JSON.stringify(steps, null, 2));
  console.log(`${steps.length} steps, all passed`);
} catch (e) {
  await win.screenshot({ path: join(out, "failed.png") }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await app.close();
}
