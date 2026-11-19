// The commands: the preview, its $state reset, the IR (from xtmd.wasm, so in a browser too), the
// page as Markdown, a folder checked and a migration (from the xtmd binary, on the desktop), and
// the log.

import { Compiler } from "@extended-mark/wasm";
import * as vscode from "vscode";
import type { Host } from "./common.js";
import type { Log } from "./log.js";
import { packsFor } from "./packs.js";
import type { Previews } from "./preview.js";

interface Parts {
  log: Log;
  host: Host;
  previews: Previews;
}

/** The active editor's Extended Mark document, or a warning. */
function active(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && (doc.languageId === "xtmd" || doc.languageId === "xtmd-prose")) return doc;
  vscode.window.showWarningMessage("Open an Extended Mark document (.xt.md) first.");
  return undefined;
}

/** A file's path for the binary, from a `file:` URI. */
function fsPath(uri: vscode.Uri): string | undefined {
  return uri.scheme === "file" ? uri.fsPath : undefined;
}

async function untitled(content: string, language: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

export function commands(context: vscode.ExtensionContext, { log, host, previews }: Parts): void {
  let compiler: Promise<Compiler> | undefined;
  const checked = vscode.languages.createDiagnosticCollection("xtmd check");
  context.subscriptions.push(checked);

  /** The binary's run, or a message saying how to get it. */
  const xtmd = async (args: string[], cwd?: string) => {
    const r = await host.runXtmd?.(args, cwd);
    if (!r) {
      const pick = await vscode.window.showErrorMessage("This needs the xtmd binary: install it with `npm i -g xtmd`, or set xtmd.path.", "Copy the Command", "Open Settings");
      if (pick === "Copy the Command") await vscode.env.clipboard.writeText("npm i -g xtmd");
      if (pick === "Open Settings") await vscode.commands.executeCommand("workbench.action.openSettings", "xtmd.path");
      return undefined;
    }
    log.info(`xtmd ${args.join(" ")}: exit ${r.code}`);
    if (r.stderr.trim()) log.info(r.stderr.trim());
    return r;
  };

  const register = (name: string, run: (...args: never[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(name, run));

  register("xtmd.preview", () => {
    const doc = active();
    if (doc) previews.show(doc);
  });
  register("xtmd.resetState", () => previews.reset(vscode.window.activeTextEditor?.document));
  register("xtmd.showLog", () => log.channel.show());

  register("xtmd.showIr", async () => {
    const doc = active();
    if (!doc) return;
    compiler ??= previews.wasmBytes().then((b) => Compiler.load(b));
    const { packs } = await packsFor(doc.uri);
    const built = (await compiler).build(doc.uri.toString(), doc.getText(), packs);
    if (!built.ir) {
      vscode.window.showErrorMessage(`It doesn't compile (${built.errors} error${built.errors === 1 ? "" : "s"}): the Problems view has them.`);
      return;
    }
    await untitled(JSON.stringify(built.ir, null, 2) + "\n", "json");
  });

  register("xtmd.showMarkdown", async () => {
    const doc = active();
    const path = doc && fsPath(doc.uri);
    if (!doc || !path) return;
    if (doc.isDirty) await doc.save();
    const r = await xtmd(["md", path]);
    if (!r) return;
    if (r.code !== 0) vscode.window.showErrorMessage(`xtmd md: ${r.stderr.trim().split("\n")[0] ?? `exit ${r.code}`}`);
    else await untitled(r.stdout, "markdown");
  });

  register("xtmd.checkFolder", async (given?: vscode.Uri) => {
    const folder = given ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Check" }))?.[0];
    const path = folder && fsPath(folder);
    if (!path) return;
    const r = await xtmd(["check", "--format", "json", path]);
    if (!r) return;
    checked.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    let files = 0;
    for (const line of r.stdout.split("\n")) {
      if (!line.trim()) continue;
      let v: { type?: string; file?: string; line?: number; column?: number; end?: { line: number; column: number }; message?: string; code?: string; severity?: string };
      try {
        v = JSON.parse(line);
      } catch {
        continue;
      }
      if (v.type === "file") files++;
      if (v.type !== "diagnostic" || !v.file) continue;
      const at = new vscode.Position((v.line ?? 1) - 1, (v.column ?? 1) - 1);
      const end = v.end ? new vscode.Position(v.end.line - 1, v.end.column - 1) : at;
      const d = new vscode.Diagnostic(new vscode.Range(at, end), v.message ?? "", v.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      d.source = "xtmd check";
      d.code = v.code;
      byFile.set(v.file, [...(byFile.get(v.file) ?? []), d]);
    }
    for (const [f, ds] of byFile) checked.set(vscode.Uri.file(f), ds);
    const found = [...byFile.values()].flat();
    const errors = found.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    vscode.window.showInformationMessage(`xtmd check: ${files} file${files === 1 ? "" : "s"}, ${errors} error${errors === 1 ? "" : "s"}, ${found.length - errors} warning${found.length - errors === 1 ? "" : "s"}.`);
    if (found.length) await vscode.commands.executeCommand("workbench.actions.view.problems");
  });

  register("xtmd.migrate", async (given?: vscode.Uri) => {
    const target = given ?? vscode.window.activeTextEditor?.document.uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: true, openLabel: "Migrate" }))?.[0];
    const path = target && fsPath(target);
    if (!path) return;
    // what would change first, as a diff; nothing is written until it is asked for
    const look = await xtmd(["migrate", path, "--diff"]);
    if (!look) return;
    if (!look.stdout.trim()) {
      vscode.window.showInformationMessage(look.stderr.includes("question") ? "xtmd migrate has questions to ask: run it in a terminal." : "Nothing to migrate: every file is up to date.", ...(look.stderr.includes("question") ? ["Open a Terminal"] : [])).then((a) => {
        if (a) openTerminal(path);
      });
      return;
    }
    await untitled(look.stdout, "diff");
    const pick = await vscode.window.showInformationMessage(`xtmd migrate would make these changes. ${look.stderr.trim().split("\n").slice(-1)[0] ?? ""}`, { modal: true }, "Write Them", "Open in a Terminal");
    if (pick === "Open in a Terminal") return openTerminal(path);
    if (pick !== "Write Them") return;
    const r = await xtmd(["migrate", path, "--yes"]);
    if (!r) return;
    if (r.code === 0) vscode.window.showInformationMessage(r.stdout.trim().split("\n").slice(-1)[0] || "Migrated.");
    else vscode.window.showWarningMessage(`xtmd migrate left something for a person: ${(r.stdout + r.stderr).trim().split("\n").slice(-1)[0]}`, "Open in a Terminal").then((a) => a && openTerminal(path));
  });

  const openTerminal = (path: string) => {
    const t = vscode.window.createTerminal({ name: "xtmd migrate" });
    t.show();
    t.sendText(`xtmd migrate ${JSON.stringify(path)}`);
  };

  // a document by MKP's old name: offer to migrate it
  const offered = new Set<string>();
  const offer = (doc: vscode.TextDocument) => {
    if (!doc.uri.path.endsWith(".mkp.md") || offered.has(doc.uri.toString()) || !host.runXtmd) return;
    offered.add(doc.uri.toString());
    vscode.window.showInformationMessage(`${doc.uri.path.split("/").pop()} is named as MKP named a document. xtmd migrate moves it to Extended Mark (name.xt.md).`, "Migrate It").then((a) => a && vscode.commands.executeCommand("xtmd.migrate", doc.uri));
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(offer));
  vscode.workspace.textDocuments.forEach(offer);
}
