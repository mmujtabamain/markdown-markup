// The packs a document is built with, as `xtmd check` finds them: the `xtmd.toml` in its folder or a
// folder above, and its `packs = [...]`, each a folder of `.xtpack` files or one file, relative to
// it. Read through VS Code's file system, so it works in vscode.dev too; the language server is
// given them (`xtmd/packs`), since in a browser it can't read them itself.

import { parse } from "smol-toml";
import * as vscode from "vscode";

export interface PackFile {
  path: string;
  text: string;
}

export interface Packs {
  packs: PackFile[];
  /** The xtmd.toml they came from. */
  config?: vscode.Uri;
  /** What couldn't be read, to say in the log. */
  problems: string[];
}

const decoder = new TextDecoder();

async function read(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function kind(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type;
  } catch {
    return undefined;
  }
}

/** The folder above, or none at the root. */
function parent(uri: vscode.Uri): vscode.Uri | undefined {
  const up = vscode.Uri.joinPath(uri, "..");
  return up.path === uri.path ? undefined : up;
}

async function walk(dir: vscode.Uri, out: vscode.Uri[]): Promise<void> {
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return;
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [name, type] of entries) {
    const at = vscode.Uri.joinPath(dir, name);
    if (type & vscode.FileType.Directory) {
      if (!name.startsWith(".") && !["node_modules", "target", "dist"].includes(name)) await walk(at, out);
    } else if (name.endsWith(".xtpack")) out.push(at);
  }
}

/** The xtmd.toml for a document: in its folder, or a folder above, inside the workspace's folder. */
export async function findConfig(doc: vscode.Uri): Promise<vscode.Uri | undefined> {
  const top = vscode.workspace.getWorkspaceFolder(doc)?.uri;
  for (let dir = parent(doc); dir; dir = parent(dir)) {
    const c = vscode.Uri.joinPath(dir, "xtmd.toml");
    if ((await kind(c)) === vscode.FileType.File) return c;
    if (top && dir.path === top.path) break;
  }
  return undefined;
}

export async function packsFor(doc: vscode.Uri): Promise<Packs> {
  const config = await findConfig(doc);
  if (!config) return { packs: [], problems: [] };
  const text = await read(config);
  const problems: string[] = [];
  let names: unknown[] = [];
  try {
    const t = parse(text ?? "") as { packs?: unknown };
    names = Array.isArray(t.packs) ? t.packs : [];
  } catch (e) {
    return { packs: [], config, problems: [`${config.toString(true)}: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const dir = parent(config)!;
  const files: vscode.Uri[] = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    const at = vscode.Uri.joinPath(dir, n);
    const k = await kind(at);
    if (k !== undefined && k & vscode.FileType.Directory) await walk(at, files);
    else if (k === vscode.FileType.File && n.endsWith(".xtpack")) files.push(at);
    else problems.push(`${config.toString(true)}: packs = ["${n}"]: not a folder or a .xtpack file`);
  }
  const packs: PackFile[] = [];
  for (const f of files) {
    const t = await read(f);
    if (t === undefined) problems.push(`${f.toString(true)}: can't be read`);
    else packs.push({ path: f.toString(), text: t });
  }
  return { packs, config, problems };
}
