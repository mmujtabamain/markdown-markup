// The extension on the desktop: the language server built in (xtmd.wasm in a Node process), or
// `xtmd lsp` when the xtmd.server setting says so; and the xtmd binary for the commands that run it.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { activate as start, type Host } from "./common.js";

/** The xtmd binary: xtmd.path, the workspace's node_modules/.bin/xtmd, or xtmd on the PATH. */
async function xtmdPath(): Promise<string | undefined> {
  const exe = process.platform === "win32" ? "xtmd.exe" : "xtmd";
  const set = vscode.workspace.getConfiguration("xtmd").get<string>("path", "").trim();
  if (set) return existsSync(set) ? set : undefined;
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const p = join(f.uri.fsPath, "node_modules", ".bin", process.platform === "win32" ? "xtmd.cmd" : "xtmd");
    if (existsSync(p)) return p;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, exe);
    if (dir && existsSync(p)) return p;
  }
  return undefined;
}

const host: Host = {
  xtmdPath,
  async runXtmd(args, cwd) {
    const bin = await xtmdPath();
    if (!bin) return undefined;
    return new Promise((done) => {
      execFile(bin, args, { cwd: cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        done({ code: typeof code === "number" ? code : error ? 1 : 0, stdout, stderr });
      });
    });
  },
};

export function activate(context: vscode.ExtensionContext): Promise<void> {
  return start(
    context,
    async (options, log) => {
      if (vscode.workspace.getConfiguration("xtmd").get<string>("server", "built-in") === "xtmd") {
        const bin = await xtmdPath();
        if (bin) return { client: new LanguageClient("xtmd", "Extended Mark", { command: bin, args: ["lsp"] }, options), server: `xtmd lsp (${bin})` };
        log.warn("xtmd.server is xtmd, but no xtmd binary was found: the built-in server answers");
      }
      const module = vscode.Uri.joinPath(context.extensionUri, "dist", "node", "server.js").fsPath;
      const run = { module, transport: TransportKind.ipc };
      return { client: new LanguageClient("xtmd", "Extended Mark", { run, debug: run }, options), server: "built in (xtmd.wasm)" };
    },
    host,
  );
}

export function deactivate(): void {}
