// The extension on the desktop: the language server built in, xtmd.wasm in a Node process; and MKP
// 0.2's frozen step (dist/migrate-0.2.cjs), run with the Node VS Code itself runs on, for a 0.2
// document that is migrated. Nothing needs to be installed.

import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { activate as start, type Host } from "./common.js";

export function activate(context: vscode.ExtensionContext): Promise<void> {
  const step02 = vscode.Uri.joinPath(context.extensionUri, "dist", "migrate-0.2.cjs").fsPath;
  const host: Host = {
    // as `xtmd migrate` runs it: the document and its 0.2 packs in, one JSON object out
    run02: existsSync(step02)
      ? (doc, packs) =>
          new Promise((done) => {
            const child = fork(step02, [doc, ...packs.flatMap((p) => ["--pack", p])], { silent: true, execArgv: [] });
            let out = "";
            let err = "";
            child.stdout?.on("data", (b: Buffer) => (out += b.toString()));
            child.stderr?.on("data", (b: Buffer) => (err += b.toString()));
            child.on("error", (e) => done({ notRun: `the 0.2 → 0.3 step can't be run: ${e.message}` }));
            child.on("close", () => {
              try {
                done(JSON.parse(out));
              } catch {
                done({ notRun: `the 0.2 → 0.3 step failed: ${err.split("\n")[0] || "no output"}` });
              }
            });
          })
      : undefined,
  };
  return start(
    context,
    async (options) => {
      const module = vscode.Uri.joinPath(context.extensionUri, "dist", "node", "server.js").fsPath;
      const run = { module, transport: TransportKind.ipc };
      return { client: new LanguageClient("xtmd", "Extended Mark", { run, debug: run }, options), server: "built in (xtmd.wasm)" };
    },
    host,
  );
}

export function deactivate(): void {}
