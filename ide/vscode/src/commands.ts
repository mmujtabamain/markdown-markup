// The commands: the preview, its $state reset, the log, and what the xtmd command does, from
// xtmd.wasm, so with no xtmd binary and in a browser too: the IR, the page as Markdown, a folder
// checked (by the language server, as an open document is) and a migration (planned by xtmd.wasm,
// shown side by side with each file to look over, then written as one edit that Undo takes back).

import { Compiler, type MigrateRequest, type Migration, type PackFile } from "@extended-mark/wasm";
import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import type { Host } from "./common.js";
import type { Log } from "./log.js";
import { configFrom, findConfig, packsFor, packsOf, type Packs } from "./packs.js";
import type { Previews } from "./preview.js";

interface Parts {
  log: Log;
  host: Host;
  previews: Previews;
  /** The language client, once it has started. */
  client: () => BaseLanguageClient | undefined;
}

/** The active editor's Extended Mark document, or a warning. */
function active(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && (doc.languageId === "xtmd" || doc.languageId === "xtmd-prose")) return doc;
  vscode.window.showWarningMessage("Open an Extended Mark document (.xtmd) first.");
  return undefined;
}

/** A page that is no file: the IR or the Markdown, beside the document, which keeps the cursor. */
async function untitled(content: string, language: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true });
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** A file's text as the editor has it: an open document's, unsaved edits and all, else the disk's. */
async function textOf(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function isFolder(uri: vscode.Uri): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

/** The files under a folder that `keep` takes, as `xtmd check` and `xtmd migrate` find them: not in
 * a folder whose name starts with a dot, or node_modules, target or dist. */
async function filesUnder(dir: vscode.Uri, keep: (name: string) => boolean, out: vscode.Uri[] = []): Promise<vscode.Uri[]> {
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return out;
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [name, type] of entries) {
    const at = vscode.Uri.joinPath(dir, name);
    if (type & vscode.FileType.Directory) {
      if (!name.startsWith(".") && !["node_modules", "target", "dist"].includes(name)) await filesUnder(at, keep, out);
    } else if (keep(name)) out.push(at);
  }
  return out;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The text's whole range, to replace it. */
function whole(text: string): vscode.Range {
  const lines = text.split("\n");
  return new vscode.Range(0, 0, lines.length - 1, lines[lines.length - 1].length);
}

export function commands(context: vscode.ExtensionContext, { log, host, previews, client }: Parts): void {
  let loaded: Promise<Compiler> | undefined;
  const compiler = () => (loaded ??= previews.wasmBytes().then((b) => Compiler.load(b)));

  const register = (name: string, run: (...args: never[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(name, run));
  // what a migration would write, shown beside each file before anything is written
  const shown = new Map<string, string>();
  let drafts = 0;
  let migrating = false;
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("xtmd-migrate", { provideTextDocumentContent: (u) => shown.get(u.toString()) ?? "" }));

  // from the editor, its tab's menu or the explorer's, which give the file
  const preview = async (here: boolean, uri?: vscode.Uri) => {
    const doc = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : active();
    if (doc) previews.show(doc, here);
  };
  register("xtmd.preview", (uri?: vscode.Uri) => preview(false, uri));
  register("xtmd.previewHere", (uri?: vscode.Uri) => preview(true, uri));
  register("xtmd.resetState", () => previews.reset(vscode.window.activeTextEditor?.document));
  register("xtmd.showLog", () => log.channel.show());

  /** A document that doesn't compile: said with its first error, and the Problems view has the rest. */
  const doesntCompile = (errors: number, first: { line: number; column: number; message: string } | undefined) =>
    vscode.window.showErrorMessage(`It doesn't compile (${plural(errors, "error")})${first ? `: line ${first.line}: ${first.message}` : ""}`);

  register("xtmd.showIr", async () => {
    const doc = active();
    if (!doc) return;
    const { packs } = await packsFor(doc.uri);
    const built = (await compiler()).build(doc.uri.toString(), doc.getText(), packs);
    if (!built.ir) return void doesntCompile(built.errors, built.diagnostics.find((d) => d.severity === "error"));
    await untitled(JSON.stringify(built.ir, null, 2) + "\n", "json");
  });

  // the page as `xtmd md` writes it, on a page of its own: nothing is saved or written
  register("xtmd.showMarkdown", async () => {
    const doc = active();
    if (!doc) return;
    const { packs } = await packsFor(doc.uri);
    const r = (await compiler()).markdown(doc.uri.toString(), doc.getText(), packs);
    if (r.markdown === null) {
      if (r.why) return void vscode.window.showErrorMessage(r.why);
      return void doesntCompile(r.errors, r.diagnostics.find((d) => d.severity === "error"));
    }
    await untitled(r.markdown, "markdown");
  });

  // every document and pack file under a folder, checked by the language server as it checks an
  // open one: their diagnostics go to the Problems view, and one opened then is checked as it is edited
  register("xtmd.checkFolder", async (given?: vscode.Uri) => {
    const folder = given ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Check" }))?.[0];
    if (!folder) return;
    const c = client();
    if (!c) return void vscode.window.showErrorMessage("Extended Mark's language server isn't running, so nothing can be checked.", "Show the Log").then((a) => a && log.channel.show());
    const files = await filesUnder(folder, (n) => n.endsWith(".xtmd") || n.endsWith(".xtmdpack"));
    const named02 = (await filesUnder(folder, (n) => n.endsWith(".mkp.md"))).length;
    if (!files.length) {
      vscode.window.showInformationMessage(`No Extended Mark files (.xtmd or .xtmdpack) in ${folder.path.split("/").pop()}${named02 ? `, but ${plural(named02, "document")} by MKP's name (.mkp.md): Migrate brings them to Extended Mark` : ""}.`);
      return;
    }
    // each xtmd.toml's packs, read once
    const packsBy = new Map<string, Promise<Packs>>();
    const packsOfFile = async (f: vscode.Uri) => {
      const config = await findConfig(f);
      const k = config?.toString() ?? "";
      if (!packsBy.has(k)) packsBy.set(k, packsOf(config));
      return packsBy.get(k)!;
    };
    let errors = 0;
    let warnings = 0;
    let withErrors = 0;
    let unread = 0;
    const done = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Extended Mark: checking", cancellable: true }, async (progress, token) => {
      for (const f of files) {
        if (token.isCancellationRequested) return false;
        progress.report({ message: vscode.workspace.asRelativePath(f), increment: 100 / files.length });
        const text = await textOf(f);
        if (text === undefined) {
          log.warn(`${f.toString(true)}: can't be read`);
          unread++;
          continue;
        }
        const found = await packsOfFile(f);
        await c.sendNotification("xtmd/packs", { uri: f.toString(), packs: found.packs });
        const r = (await c.sendRequest("xtmd/check", { uri: f.toString(), text })) as { errors: number; warnings: number };
        errors += r.errors;
        warnings += r.warnings;
        withErrors += r.errors > 0 ? 1 : 0;
      }
      return true;
    });
    if (!done) return;
    const summary = `${plural(files.length, "file")}: ${withErrors} with errors, ${files.length - withErrors - unread} without${unread ? `, ${unread} not read` : ""}; ${plural(errors, "error")}, ${plural(warnings, "warning")}`;
    log.info(`checked ${folder.toString(true)}: ${summary}`);
    const by02 = named02 ? ` ${plural(named02, "document")} by MKP's name (.mkp.md) left out: Migrate brings them to Extended Mark.` : "";
    vscode.window.showInformationMessage(`Checked ${summary}.${by02}`);
    if (errors + warnings) await vscode.commands.executeCommand("workbench.actions.view.problems");
  });

  register("xtmd.migrate", async (given?: vscode.Uri) => {
    const target = given ?? vscode.window.activeTextEditor?.document.uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: true, openLabel: "Migrate" }))?.[0];
    if (!target) return;
    await migrate(target);
  });

  /** A file's name in a plan: its path in the workspace folder, as a person reads it, or its URI. */
  const naming = (anchor: vscode.Uri) => {
    const root = vscode.workspace.getWorkspaceFolder(anchor)?.uri;
    const name = (u: vscode.Uri) => (root && u.scheme === root.scheme && u.path.startsWith(root.path + "/") ? u.path.slice(root.path.length + 1) : u.toString());
    const uri = (n: string) => (/^[a-z][a-z0-9+.-]*:/i.test(n) || !root ? vscode.Uri.parse(n) : vscode.Uri.joinPath(root, n));
    return { root, name, uri };
  };

  /** Plans a migration with xtmd.wasm (as `xtmd migrate` plans one), asks its questions, and writes it
   * as one edit, shown first in the refactor preview. */
  const migrate = async (target: vscode.Uri, allow: { todos?: boolean; errors?: boolean } = {}) => {
    const folder = await isFolder(target);
    const docs = folder ? await filesUnder(target, (n) => n.endsWith(".xtmd") || n.endsWith(".mkp.md")) : [target];
    if (!folder && !/\.(xtmd|mkp\.md)$/.test(target.path)) return void vscode.window.showWarningMessage(`${target.path.split("/").pop()}: not a document (.xtmd) or a folder.`);
    const at = folder ? target : vscode.Uri.joinPath(target, "..");
    const { root, name, uri } = naming(target);
    const config = await configFrom(at);
    const found = await packsOf(config);
    for (const p of found.problems) log.warn(p);
    const sources: PackFile[] = [];
    for (const p of found.packs) {
      const u = vscode.Uri.parse(p.path);
      sources.push({ path: name(u), text: (await textOf(u)) ?? p.text });
    }
    const request: MigrateRequest = {
      sources,
      docs: [],
      config: null,
      standIns: name(vscode.Uri.joinPath(at, "stand-ins")),
      answers: { confirm: {}, split: {} },
      allowTodos: allow.todos,
      allowErrors: allow.errors,
    };
    for (const d of docs) {
      const text = await textOf(d);
      if (text === undefined) return void vscode.window.showErrorMessage(`${vscode.workspace.asRelativePath(d)} can't be read.`);
      request.docs!.push({ path: name(d), text });
    }
    if (config) request.config = { path: name(config), text: (await textOf(config)) ?? "" };
    const c = await compiler();
    let plan: Migration = c.migrate(request);
    if (plan.error) return void vscode.window.showErrorMessage(plan.error);

    // documents written for MKP 0.2: its own compiler, frozen, moves them first; it needs Node
    if (plan.needs02.length) {
      const packs02 = root ? (await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/manifest.mkp"), "**/node_modules/**")).map((m) => vscode.Uri.joinPath(m, "..")) : [];
      request.packs02 = packs02.length > 0;
      request.step02 = {};
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Extended Mark: reading the MKP 0.2 documents" }, async () => {
        for (const n of plan.needs02) {
          const doc = uri(n);
          request.step02![n] =
            host.run02 && doc.scheme === "file"
              ? await host.run02(doc.fsPath, packs02.filter((p) => p.scheme === "file").map((p) => p.fsPath)).catch((e: unknown) => ({ notRun: `the 0.2 → 0.3 step didn't run: ${e instanceof Error ? e.message : String(e)}` }))
              : { notRun: "the 0.2 → 0.3 step runs with Node, which VS Code in a browser doesn't have: migrate it in VS Code on the desktop" };
        }
      });
      plan = c.migrate(request);
    }

    // the questions only a person can answer, one at a time; the plan is made again with the answers
    while (plan.questions.length) {
      for (const q of plan.questions) {
        const title = `Extended Mark migrate: question ${q.number}`;
        if (q.options.length) {
          const pick = await vscode.window.showQuickPick(q.options, { title, placeHolder: q.asks, ignoreFocusOut: true });
          if (!pick) return void vscode.window.showInformationMessage("Nothing migrated: not every question was answered.");
          request.answers!.split![q.key] = pick;
        } else {
          const pick = await vscode.window.showQuickPick(["Yes", "No"], { title, placeHolder: q.asks, ignoreFocusOut: true });
          if (!pick) return void vscode.window.showInformationMessage("Nothing migrated: not every question was answered.");
          request.answers!.confirm![q.key] = pick === "Yes";
        }
      }
      plan = c.migrate(request);
      if (plan.error) return void vscode.window.showErrorMessage(plan.error);
    }

    // what it comes to, file by file, in the log
    const moving = plan.files.filter((f) => f.result === "migrate");
    const refused = plan.files.filter((f) => f.result === "refused");
    const fine = plan.files.length - moving.length - refused.length;
    log.info(`migrate ${target.toString(true)}: xtmd ${plan.release.from} → ${plan.release.to}`);
    for (const f of plan.files) {
      const parts = f.result === "refused" ? [`not written: ${f.refused.join("; ")}`] : f.result === "up to date" ? ["up to date"] : [plural(f.changes, "change"), ...(f.to !== f.path ? [`renamed ${f.to.split("/").pop()}`] : [])];
      log.info(`  ${f.path}  ${f.moved.join(", ")}  ${parts.join("; ")}${f.inferred.length ? ` (${f.inferred.join(", ")})` : ""}`);
      for (const n of [...f.changed, ...f.notices, ...f.deletions.map((d) => `dropped: ${d}`), ...f.todos.map((t) => `TODO: ${t}`), ...f.errors.map((e) => `doesn't compile: ${e}`)]) log.info(`    ${n}`);
    }
    const summary = `${plural(plan.files.length, "file")}: ${moving.length} to migrate, ${refused.length} need${refused.length === 1 ? "s" : ""} a person, ${fine} up to date.`;
    log.info(summary);
    if (!moving.length && !plan.config) {
      if (!refused.length) return void vscode.window.showInformationMessage("Nothing to migrate: every file is up to date.");
      // what a person can let through: TODOs left for them, or a file that doesn't compile after
      const reasons = refused.flatMap((f) => f.refused);
      const offers = [...(reasons.some((r) => r.includes("--allow-todos")) && !allow.todos ? ["Write Them with TODOs"] : []), ...(reasons.some((r) => r.includes("--allow-errors")) && !allow.errors ? ["Write Them Anyway"] : []), "Show the Log"];
      const pick = await vscode.window.showWarningMessage(`Nothing migrated: ${summary} ${refused[0].path}: ${refused[0].refused[0]}`, ...offers);
      if (pick === "Show the Log") log.channel.show();
      if (pick === "Write Them with TODOs") await migrate(target, { ...allow, todos: true });
      if (pick === "Write Them Anyway") await migrate(target, { ...allow, errors: true });
      return;
    }

    // what it would write, every file side by side with what it is now, to look over first
    const sides: [vscode.Uri, vscode.Uri | undefined, vscode.Uri][] = [];
    const planned = (n: string, text: string) => {
      const u = vscode.Uri.from({ scheme: "xtmd-migrate", path: `/${n}`, query: String(++drafts) });
      shown.set(u.toString(), text);
      return u;
    };
    const standIns: { at: vscode.Uri; text: string; overwrite: boolean }[] = [];
    for (const s of plan.standIns) {
      const at = uri(s.path);
      const had = await textOf(at);
      if (had !== s.text) standIns.push({ at, text: s.text, overwrite: had !== undefined });
    }
    for (const f of moving) sides.push([uri(f.to), uri(f.path), planned(f.to, f.text)]);
    for (const s of standIns) sides.push([s.at, s.overwrite ? s.at : undefined, planned(name(s.at), s.text)]);
    if (plan.config) sides.push([uri(plan.config.path), uri(plan.config.path), planned(plan.config.path, plan.config.text)]);
    await vscode.commands.executeCommand("vscode.changes", "Extended Mark: migrate", sides);
    const what = [...new Set(moving.flatMap((f) => f.moved))].join(", ");
    const asked = await vscode.window.showInformationMessage(`${summary} Write the changes${what ? ` (${what})` : ""}? They are open to look over.`, "Write Them", "Cancel");
    if (asked !== "Write Them") return void vscode.window.showInformationMessage("Nothing migrated.");

    // one edit, which Undo takes back: each file's new text, a 0.2 name moved, the stand-ins, xtmd.toml
    const edit = new vscode.WorkspaceEdit();
    for (const f of moving) {
      if (f.text !== f.old) edit.replace(uri(f.path), whole(f.old), f.text);
      if (f.to !== f.path) edit.renameFile(uri(f.path), uri(f.to), { overwrite: false });
    }
    for (const s of standIns) edit.createFile(s.at, { overwrite: s.overwrite, contents: encoder.encode(s.text) });
    if (plan.config) edit.replace(uri(plan.config.path), whole(plan.config.old), plan.config.text);
    migrating = true;
    let applied = false;
    try {
      applied = await vscode.workspace.applyEdit(edit, { isRefactoring: true });
    } finally {
      migrating = false;
    }
    if (!applied) return void vscode.window.showErrorMessage("The migration couldn't be written: a file changed while it was planned. Run it again.");
    const todos = moving.reduce((n, f) => n + f.todos.length, 0);
    const left = [...(todos ? [plural(todos, "TODO")] : []), ...(refused.length ? [`${plural(refused.length, "file")} not written (the log says why)`] : [])];
    vscode.window.showInformationMessage(`Migrated ${plural(moving.length, "file")}${left.length ? `; left for a person: ${left.join(", ")}` : ""}. Undo in any of them takes the whole migration back.`, ...(left.length ? ["Show the Log"] : [])).then((a) => a && log.channel.show());
  };

  // a document by MKP's old name, opened in an editor: offer to migrate it
  const offered = new Set<string>();
  const offer = (editor: vscode.TextEditor | undefined) => {
    const doc = editor?.document;
    if (!doc || doc.uri.scheme !== "file" || !doc.uri.path.endsWith(".mkp.md") || offered.has(doc.uri.toString()) || migrating) return;
    offered.add(doc.uri.toString());
    vscode.window.showInformationMessage(`${doc.uri.path.split("/").pop()} is named as MKP named a document. Migrate moves it to Extended Mark (name.xtmd).`, "Migrate It").then((a) => a && vscode.commands.executeCommand("xtmd.migrate", doc.uri));
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(offer));
  offer(vscode.window.activeTextEditor);
}
