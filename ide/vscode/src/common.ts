// The extension, on the desktop and in a browser: the language client (its server is ide/lsp,
// built into xtmd.wasm or `xtmd lsp`), the packs each document is built with, core's own source,
// the language a document is read in, the preview, the status bar and the commands. What only the
// desktop can do (run the xtmd binary) comes in as `Host`.

import * as vscode from "vscode";
import type { BaseLanguageClient, LanguageClientOptions } from "vscode-languageclient";
import { commands } from "./commands.js";
import { languageFor } from "./language.js";
import { Log } from "./log.js";
import { packsFor } from "./packs.js";
import { Previews } from "./preview.js";

/** What the desktop gives the extension that a browser can't. */
export interface Host {
  /** Runs the xtmd binary; none in a browser, or when it can't be found. */
  runXtmd?(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string } | undefined>;
  /** Where the binary is, for the status bar; undefined when there is none. */
  xtmdPath?(): Promise<string | undefined>;
}

export type ClientMaker = (options: LanguageClientOptions, log: Log) => Promise<{ client: BaseLanguageClient; server: string }>;

const XTMD = [{ language: "xtmd" }, { language: "xtmd-prose" }];

export async function activate(context: vscode.ExtensionContext, makeClient: ClientMaker, host: Host): Promise<void> {
  const log = new Log();
  context.subscriptions.push(log.channel);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = "Extended Mark";
  status.command = "xtmd.showLog";
  context.subscriptions.push(status);

  // the client: each document's packs go to the server before the document does
  let client: BaseLanguageClient | undefined;
  const sendPacks = async (doc: vscode.TextDocument) => {
    if (!client || !XTMD.some((s) => s.language === doc.languageId)) return;
    const found = await packsFor(doc.uri);
    for (const p of found.problems) log.warn(p);
    log.info(`${doc.uri.toString(true)}: ${found.packs.length} pack file${found.packs.length === 1 ? "" : "s"}${found.config ? ` from ${found.config.toString(true)}` : ""}`);
    await client.sendNotification("xtmd/packs", { uri: doc.uri.toString(), packs: found.packs });
  };
  const options: LanguageClientOptions = {
    documentSelector: XTMD,
    outputChannel: log.channel,
    middleware: {
      didOpen: async (doc, next) => {
        await sendPacks(doc).catch((e) => log.error(`packs of ${doc.uri.toString(true)}: ${e}`));
        return next(doc);
      },
    },
  };
  try {
    const made = await makeClient(options, log);
    client = made.client;
    await client.start();
    log.info(`language server: ${made.server}`);
    status.tooltip = `Extended Mark: ${made.server}`;
  } catch (e) {
    log.error(`the language server didn't start: ${e instanceof Error ? e.message : String(e)}`);
    vscode.window.showErrorMessage(`Extended Mark's language server didn't start: ${e instanceof Error ? e.message : String(e)}`, "Show the Log").then((a) => a && log.channel.show());
  }
  context.subscriptions.push({ dispose: () => void client?.stop() });

  // a pack or xtmd.toml that changes: every open document's packs again
  const resend = () => vscode.workspace.textDocuments.forEach((d) => void sendPacks(d));
  const watcher = vscode.workspace.createFileSystemWatcher("**/{xtmd.toml,*.xtpack}");
  context.subscriptions.push(watcher, watcher.onDidChange(resend), watcher.onDidCreate(resend), watcher.onDidDelete(resend));

  // core's own source, read only, where go to definition lands in core
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("xtmd-core", {
      async provideTextDocumentContent(uri) {
        const r = (await client?.sendRequest("xtmd/core", { path: uri.path.replace(/^\//, "") })) as { text?: string } | null;
        return r?.text ?? `// ${uri.path}: not part of core`;
      },
    }),
  );

  // a .xt.md with no @@@ line is prose all through: read in the prose language
  const pick = (doc: vscode.TextDocument) => {
    if (!doc.uri.path.endsWith(".xt.md") || !XTMD.some((s) => s.language === doc.languageId)) return;
    const want = languageFor(doc.uri.path, doc.getText());
    if (want !== doc.languageId) void vscode.languages.setTextDocumentLanguage(doc, want);
  };
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(pick),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const k = e.document.uri.toString();
      clearTimeout(timers.get(k));
      timers.set(k, setTimeout(() => pick(e.document), 400));
    }),
  );
  vscode.workspace.textDocuments.forEach(pick);

  // the status bar: the active document's errors, and which server answers
  const showStatus = () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || !XTMD.some((s) => s.language === doc.languageId)) return status.hide();
    const ds = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === "xtmd" || d.source === "xtmd preview");
    const errors = ds.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = ds.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
    status.text = errors || warnings ? `$(symbol-structure) Extended Mark $(error) ${errors} $(warning) ${warnings}` : "$(symbol-structure) Extended Mark $(check)";
    status.show();
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(showStatus), vscode.languages.onDidChangeDiagnostics(showStatus));
  showStatus();

  const previews = new Previews(context, log);
  commands(context, { log, host, previews });
}
