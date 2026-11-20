// The preview: the document's page, drawn beside it by the vscode target (src/target) in a webview,
// as it is edited. A widget that fails while drawn is marked in the editor on the call that placed
// it, as an error "when the page was drawn", until it draws again.

import * as vscode from "vscode";
import type { Log } from "./log.js";
import { packsFor } from "./packs.js";

interface Written {
  line: number;
  column: number;
  end: { line: number; column: number };
}

/** xtmd's line and column, from 1, the column in characters, as VS Code's position. */
function position(doc: vscode.TextDocument, line: number, column: number): vscode.Position {
  const l = Math.min(Math.max(line - 1, 0), doc.lineCount - 1);
  const text = doc.lineAt(l).text;
  let units = 0;
  let chars = 0;
  for (const c of text) {
    if (chars >= column - 1) break;
    units += c.length;
    chars++;
  }
  return new vscode.Position(l, units);
}

export class Previews {
  private readonly open = new Map<string, Preview>();
  readonly failures = vscode.languages.createDiagnosticCollection("xtmd preview");
  private wasm: Promise<Uint8Array> | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: Log) {
    context.subscriptions.push(this.failures);
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.open.get(e.document.uri.toString())?.changed()),
      vscode.workspace.onDidSaveTextDocument((d) => {
        // a pack or xtmd.toml saved: every preview reads its packs again
        if (d.uri.path.endsWith(".xtpack") || d.uri.path.endsWith("/xtmd.toml")) for (const p of this.open.values()) p.reloadPacks();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("xtmd.preview.theme")) for (const p of this.open.values()) p.sendTheme();
      }),
    );
  }

  /** xtmd.wasm's bytes, read once. */
  wasmBytes(): Promise<Uint8Array> {
    this.wasm ??= Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.context.extensionUri, "dist", "xtmd.wasm")));
    return this.wasm;
  }

  show(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const had = this.open.get(key);
    if (had) {
      had.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const p = new Preview(this, doc, this.context, this.log);
    this.open.set(key, p);
    vscode.commands.executeCommand("setContext", "xtmd.previewOpen", true);
    p.panel.onDidDispose(() => {
      this.open.delete(key);
      this.failures.delete(doc.uri);
      vscode.commands.executeCommand("setContext", "xtmd.previewOpen", this.open.size > 0);
    });
  }

  /** $state and every widget's own variables at their start, in the preview of `doc` (or every one). */
  reset(doc?: vscode.TextDocument): void {
    for (const [k, p] of this.open) if (!doc || k === doc.uri.toString()) p.post({ type: "reset" });
  }
}

class Preview {
  readonly panel: vscode.WebviewPanel;
  private packs: { path: string; text: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;

  constructor(private readonly all: Previews, private readonly doc: vscode.TextDocument, context: vscode.ExtensionContext, private readonly log: Log) {
    const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
    this.panel = vscode.window.createWebviewPanel("xtmd.preview", `Preview ${doc.uri.path.split("/").pop()}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist],
    });
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "xtmd-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "xtmd-dark.svg"),
    };
    const w = this.panel.webview;
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const uri = (p: string) => w.asWebviewUri(vscode.Uri.joinPath(dist, p)).toString();
    w.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} https: data:; style-src ${w.cspSource} 'unsafe-inline'; font-src ${w.cspSource}; script-src 'nonce-${nonce}' 'wasm-unsafe-eval';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("preview.css")}">
<title>Preview</title></head><body><div id="status" role="status"></div><main id="page"></main>
<script nonce="${nonce}" src="${uri("preview.js")}"></script></body></html>`;
    w.onDidReceiveMessage((m) => this.received(m));
  }

  post(m: unknown): void {
    this.panel.webview.postMessage(m);
  }

  private async received(m: { type: string; items?: { message: string; written: Written }[]; text?: string }): Promise<void> {
    if (m.type === "ready") {
      this.ready = true;
      const bytes = await this.all.wasmBytes();
      this.post({ type: "wasm", bytes: bytes.slice().buffer });
      this.sendTheme();
      await this.reloadPacks();
    } else if (m.type === "failures") {
      const items = m.items ?? [];
      this.all.failures.set(
        this.doc.uri,
        items.map((f) => {
          const d = new vscode.Diagnostic(new vscode.Range(position(this.doc, f.written.line, f.written.column), position(this.doc, f.written.end.line, f.written.end.column)), `${f.message}, when the page was drawn`, vscode.DiagnosticSeverity.Error);
          d.source = "xtmd preview";
          return d;
        }),
      );
      if (items.length) this.log.info(`preview of ${this.doc.uri.toString(true)}: ${items.length} widget${items.length === 1 ? "" : "s"} failed: ${items.map((f) => f.message).join("; ")}`);
    } else if (m.type === "log") {
      this.log.warn(`preview of ${this.doc.uri.toString(true)}: ${m.text}`);
    }
  }

  sendTheme(): void {
    const t = vscode.workspace.getConfiguration("xtmd").get<string>("preview.theme", "editor");
    const kind = vscode.window.activeColorTheme.kind;
    const editor = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "LIGHT" : "DARK";
    this.post({ type: "theme", theme: t === "light" ? "LIGHT" : t === "dark" ? "DARK" : editor, follow: t === "editor" });
  }

  async reloadPacks(): Promise<void> {
    const found = await packsFor(this.doc.uri);
    for (const p of found.problems) this.log.warn(p);
    this.packs = found.packs;
    this.send();
  }

  changed(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.send(), 150);
  }

  private send(): void {
    if (!this.ready) return;
    this.post({ type: "source", path: this.doc.uri.toString(), text: this.doc.getText(), packs: this.packs });
  }
}
