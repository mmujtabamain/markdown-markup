// The commands that once ran the xtmd binary, in real VS Code with none installed: Show as
// Markdown, Check a Folder and Migrate, driven as a person would and photographed into test/out.
// The workspace is made in a temporary folder: test/workspace's site, a page with errors beside it,
// and a tree written for kit@1 with an MKP 0.2 document in it. Run it on a screen, or with Xvfb:
//
//   Xvfb :97 -screen 0 1600x1000x24 -nolisten tcp &  DISPLAY=:97 node test/commands.mjs

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, "..");
const out = join(here, "out");
const user = join(tmpdir(), `xtmd-vscode-${process.pid}`);
mkdirSync(out, { recursive: true });
mkdirSync(join(user, "data", "User"), { recursive: true });
writeFileSync(
  join(user, "data", "User", "settings.json"),
  JSON.stringify({
    "workbench.colorTheme": "Default Dark Modern",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.enableExperiments": false,
    "security.workspace.trust.enabled": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.ignoreRecommendations": true,
    "editor.minimap.enabled": false,
    "editor.fontSize": 15,
    "window.titleBarStyle": "custom",
    "window.menuStyle": "custom",
    "window.dialogStyle": "custom",
    "chat.commandCenter.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "git.openRepositoryInParentFolders": "never",
    "git.enabled": false,
    "github.copilot.enable": { "*": false },
  }),
);

// the workspace: site/ (test/workspace, and a page with two slips), old/ (written for kit@1, as the
// CLI's tests have it, and a document of MKP 0.2's)
const workspace = mkdtempSync(join(tmpdir(), "xtmd-commands-"));
cpSync(join(here, "workspace"), join(workspace, "site"), { recursive: true });
writeFileSync(join(workspace, "site", "docs", "broken.xt.md"), 'import kit;\n@@@\n# Broken\n\n@taly(name = "Yes", count = 1);\n\n@press(lable = "Go");\n');
const old = {
  "xtmd.toml": 'packs = ["kit"]\n\n[uses]\nkit = 1\n',
  "kit/kit.xtpack": "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides plot, badge, stat, state, stats;\n}\n\nrecord stat {\n    title: text;\n    value: text;\n    unit: text;\n}\n\nenum state { DONE, OVERDUE }\n\nextern widget plot(values: list<number>, tone: color = color.ACCENT);\nextern widget badge(label: text, size: size = size.M);\nextern widget stats(items: list<stat>);\n",
  "kit/surfaces/kit@1.xtpack": "package kit@1;\n\nrecord stat {\n    label: text;\n    value: text;\n}\n\nenum state { DONE, LATE }\n\nextern widget chart(values: list<number>, color: color = color.ACCENT);\nextern widget badge(label: text, shadow: bool = false);\nextern widget sparkline(values: list<number>);\nextern widget stats(items: list<stat>);\n",
  "kit/migrations/kit@2.xtpack": 'package kit;\n\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n        rename(input = color, to = tone);\n    }\n\n    widget badge {\n        drop(input = shadow, why = "badges have no shadow");\n        set(input = size, value = size.S, when = !given(size), why = "kit@1\'s badges were small");\n    }\n\n    widget sparkline {\n        drop(why = "use plot");\n    }\n\n    record stat {\n        rename(field = label, to = title);\n        add(field = unit, value = "", why = "a stat names its unit");\n    }\n\n    enum state {\n        split(from = state.LATE, to = [state.OVERDUE, state.DONE], why = "late is now overdue, or done");\n    }\n}\n',
  "docs/report.xt.md": 'import kit;\n\n$state {\n    s: state = state.LATE;\n}\n@@@\n# Report\n\n@chart(values = [1, 2], color = color.OK);\n\n@badge(label = "Beta", shadow = true);\n\n@sparkline(values = [3]);\n\n@stats(items = [stat { label = "Deploys", value = "42" }]);\n',
  "docs/counter.mkp.md": '---\nteaches: "reader state, a press and an event"\n---\n# A counter\n\n```mkp\ncounter "A number the reader steps up or down."\n  in start int = 0 "where it begins"\n  var n int = start\n  row gap=m align=center\n    press label="one less"\n      icon name=minus\n      @click set n=(n - 1)\n    text "\\val{n}" font=mono size=large weight=bold\n    press label="one more"\n      icon name=plus\n      @click set n=(n + 1)\n  project md = "Count: " + format(n, 0)\n```\n\n```counter\nstart: 3\nsummary: A counter that starts at 3.\n```\n',
};
for (const [f, t] of Object.entries(old)) {
  mkdirSync(dirname(join(workspace, "old", f)), { recursive: true });
  writeFileSync(join(workspace, "old", f), t);
}

const code = await downloadAndUnzipVSCode("stable");
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
    join(workspace, "site", "docs", "poll.xt.md"),
  ],
  // no xtmd anywhere VS Code could find one
  env: { ...process.env, PATH: "/usr/bin:/bin" },
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
/** A folder or file in the explorer, by its name. */
const row = (name) => win.getByRole("treeitem", { name, exact: true }).first();
async function fromExplorer(name, item) {
  await row(name).click({ button: "right" });
  const it = win.locator(".monaco-menu .action-item", { hasText: item }).first();
  await it.waitFor();
  await pause(400);
  await it.hover();
  await pause(200);
  await it.click();
  await pause(400);
  if (await win.locator(".monaco-menu").count()) await win.keyboard.press("Enter");
}
const fail = (why) => {
  throw new Error(why);
};

try {
  await win.locator(".monaco-workbench").waitFor({ timeout: 60000 });
  await win.locator(".statusbar-item", { hasText: "Extended Mark" }).first().waitFor({ timeout: 60000 });
  await pause(9000);

  // 1. Show as Markdown: a page of its own, beside the document, nothing saved
  await palette("Extended Mark: Show as Markdown");
  await win.locator(".tab.active", { hasText: "Untitled" }).waitFor({ timeout: 30000 });
  await win.locator(".view-line", { hasText: "# Should the team ship on Fridays?" }).first().waitFor({ timeout: 15000 });
  await shot("sc-1-markdown", "Show as Markdown, with no xtmd binary: the page as xtmd md writes it, on an untitled Markdown page beside the document");
  await palette("View: Close All Editors");
  await pause(500);
  // a "don't save" dialog for the untitled page
  const dontSave = win.locator(".monaco-dialog-box .monaco-button", { hasText: "Don't Save" });
  if (await dontSave.count()) await dontSave.first().click();
  await pause(800);

  // 2. Check a Folder, from the explorer: every file under it, into Problems
  await palette("View: Show Explorer");
  await pause(800);
  await fromExplorer("site", "Check a Folder");
  await win.locator(".notifications-toasts", { hasText: "Checked 3 files" }).first().waitFor({ timeout: 60000 });
  await win.locator(".markers-panel .monaco-list-row", { hasText: "did you mean" }).first().waitFor({ timeout: 15000 });
  await shot("sc-2-check-folder", "Check a Folder on site/: 3 files checked by the built-in language server, broken.xt.md's two slips in Problems with did you mean");
  await win.keyboard.press("Control+Shift+M");
  await pause(500);

  // 3. Migrate a folder written for kit@1: its question first, then the edit to look over
  await fromExplorer("old", "Migrate");
  await win.locator(".quick-input-widget", { hasText: "migrate: question 1" }).first().waitFor({ timeout: 60000 });
  await shot("sc-3-migrate-question", "Migrate on old/: kit@2 splits LATE, so it asks which this one is, as xtmd migrate asks in a terminal");
  await win.locator(".quick-input-widget .monaco-list-row", { hasText: "DONE" }).first().click();
  await win.locator(".notifications-toasts", { hasText: "Write the changes" }).first().waitFor({ timeout: 90000 });
  await pause(2000);
  await shot("sc-4-migrate-changes", "The plan side by side with each file before anything is written: report.xt.md to kit@2, counter.mkp.md moved from MKP 0.2 by its frozen step (run with VS Code's own Node) and renamed, xtmd.toml's [uses]");
  await win.locator(".notifications-toasts .monaco-button", { hasText: "Write Them" }).first().click();
  await win.locator(".notifications-toasts", { hasText: "Migrated" }).first().waitFor({ timeout: 60000 });
  await pause(1500);
  const report = readFileSync(join(workspace, "old", "docs", "report.xt.md"), "utf8");
  if (!report.includes("s: state = state.DONE;") || !report.includes("@plot(values = [1, 2], tone = color.OK);")) fail(`report.xt.md isn't migrated:\n${report}`);
  if (!existsSync(join(workspace, "old", "docs", "counter.xt.md")) || existsSync(join(workspace, "old", "docs", "counter.mkp.md"))) fail("counter.mkp.md isn't moved to counter.xt.md");
  if (!readFileSync(join(workspace, "old", "xtmd.toml"), "utf8").includes("kit = 2")) fail("xtmd.toml's [uses] isn't kit = 2");
  await win.keyboard.press("Control+P");
  await win.keyboard.type("report.xt.md", { delay: 20 });
  await pause(600);
  await win.keyboard.press("Enter");
  await pause(1500);
  await shot("sc-5-migrated", "Applied: report.xt.md now uses plot, size and title, DONE as answered; counter.xt.md beside it; the notification says how many moved");

  // 4. Undo takes the whole migration back: Ctrl+Z in any file it wrote
  await win.locator(".view-line", { hasText: "state.DONE" }).first().click();
  await win.keyboard.press("Control+Z");
  await win.locator(".view-line", { hasText: "state.LATE" }).first().waitFor({ timeout: 15000 });
  if (!existsSync(join(workspace, "old", "docs", "counter.mkp.md"))) fail("Undo didn't move counter.xt.md back");
  await pause(1500);
  await shot("sc-6-undone", "Ctrl+Z in report.xt.md: the whole migration undone, in every file it wrote (unsaved until saved), counter.mkp.md back under its old name");
} catch (e) {
  await win.screenshot({ path: join(out, "sc-failed.png") });
  console.error(`failed after ${steps.length} steps: ${e.message}`);
  await app.close();
  process.exit(1);
}
writeFileSync(join(out, "commands.json"), JSON.stringify(steps, null, 2));
await app.close();
rmSync(user, { recursive: true, force: true });
rmSync(workspace, { recursive: true, force: true });
