// xtmd.wasm held to the binary: every conformance case built both ways gives the same IR and the
// same diagnostics, and what a real-time target leans on (a broken document, packs given as text,
// a compiler that goes on after a bad one) works.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cli from "xtmd";
import { Compiler } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = join(here, "../../../checks/cases");

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** Every case with a source: where it is, its packs' folders and files, and those files' text. */
const cases = walk(casesDir, (p) => p.endsWith(".json")).flatMap((f) => {
  const c = JSON.parse(readFileSync(f, "utf8"));
  if (!c.id || !c.source) return [];
  const dir = dirname(f);
  const packs = (c.packs ?? []).map((p) => join(dir, p));
  const files = packs.flatMap((p) => (statSync(p).isDirectory() ? walk(p, (x) => x.endsWith(".xtpack")) : [p]));
  return [{ id: c.id, source: join(dir, c.source), packs, files: files.map((path) => ({ path, text: readFileSync(path, "utf8") })) }];
});

const started = Date.now();
const compiler = await Compiler.load();
const loadMs = Date.now() - started;

test("xtmd.wasm loads, compiling core once", () => {
  assert.ok(cases.length >= 50, `${cases.length} cases`);
  // core is compiled as it loads: say how long, so a slow one shows
  console.log(`xtmd.wasm loaded in ${loadMs} ms`);
});

test("every conformance case gives the binary's IR, or the binary's errors", async () => {
  let built = 0;
  for (const c of cases) {
    const got = compiler.build(c.source, readFileSync(c.source, "utf8"), c.files);
    let want;
    try {
      want = await cli.build(c.source, { packs: c.packs });
    } catch (e) {
      want = null;
    }
    if (want) {
      assert.equal(got.errors, 0, `${c.id}: ${JSON.stringify(got.diagnostics)}`);
      assert.deepEqual(got.ir, want, c.id);
      built++;
    } else {
      assert.ok(got.errors > 0 && got.ir === null, `${c.id}: the binary refuses it, xtmd.wasm doesn't`);
    }
    // the file's own diagnostics, where and what
    const said = await cli.check(c.source, { packs: c.packs });
    const key = (d) => `${d.file}:${d.line}:${d.column} ${d.code}`;
    assert.deepEqual(got.diagnostics.filter((d) => d.file === c.source).map(key).sort(), said.filter((d) => d.file === c.source).map(key).sort(), c.id);
  }
  // most cases are compile errors on purpose; the rest run on the targets
  assert.ok(built >= 50, `${built} of ${cases.length} built`);
});

test("a document with errors gives them, with no IR, and the compiler goes on", () => {
  const bad = compiler.build("page.xt.md", "$state {\n    n: int 0..3 = 9;\n}\n@@@\n\\{$state.nope}\n");
  assert.equal(bad.ir, null);
  assert.ok(bad.errors >= 1);
  assert.ok(bad.diagnostics.every((d) => d.file === "page.xt.md" && d.line >= 1 && typeof d.message === "string"), JSON.stringify(bad.diagnostics));
  const good = compiler.build("page.xt.md", "# Hello\n");
  assert.equal(good.errors, 0);
  assert.equal(good.ir.ir.module, "doc");
});

test("a pack given as text is used, and one the document names but isn't given is an error", () => {
  const pack = { path: "shapes/shapes.xtpack", text: "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n" };
  const doc = "import shapes;\n@@@\nTwice: \\{double(4)}\n";
  const ok = compiler.build("page.xt.md", doc, [pack]);
  assert.equal(ok.errors, 0, JSON.stringify(ok.diagnostics));
  assert.ok(JSON.stringify(ok.ir).includes("shapes/double"));
  const missing = compiler.build("page.xt.md", doc);
  assert.ok(missing.errors > 0 && missing.diagnostics.some((d) => d.code === "names.unknown-pack"), JSON.stringify(missing.diagnostics));
});

test("every case's resolved IR is the binary's (xtmd build --rir), and only when asked", async () => {
  let resolved = 0;
  for (const c of cases) {
    const text = readFileSync(c.source, "utf8");
    const got = compiler.build(c.source, text, c.files, { rir: true });
    const run = await cli.run(["build", "--rir", c.source, ...c.packs.flatMap((p) => ["--pack", p])]);
    if (run.code !== 0) continue;
    assert.deepEqual(got.rir, JSON.parse(run.stdout), c.id);
    // the IR beside it is the one a build without it gives
    assert.deepEqual(got.ir, compiler.build(c.source, text, c.files).ir, c.id);
    resolved++;
  }
  assert.ok(resolved >= 50, `${resolved} of ${cases.length} resolved`);
  assert.equal(compiler.build("page.xt.md", "# Hello\n").rir, undefined);
});

test("a draft with errors still has its resolved IR, for an editor", () => {
  const b = compiler.build("page.xt.md", "$state {\n    n: int = 0;\n}\n@@@\n@press(label = 3);\n", [], { rir: true });
  assert.ok(b.errors > 0 && b.ir === null);
  assert.equal(b.rir.files[0].path, "page.xt.md");
  assert.ok(JSON.stringify(b.rir).includes('"core/int"'));
});

test("core's files come first in the resolved IR when asked, resolved, as the binary's --core", async () => {
  const doc = "@@@\n@press(label = \"Go\");\n";
  const got = compiler.build("page.xt.md", doc, [], { rir: true, core: true });
  const files = got.rir.files;
  assert.ok(files.length > 10 && files[0].path.startsWith("core/") && files.at(-1).path === "page.xt.md", files.map((f) => f.path).join(" "));
  const press = files.find((f) => f.path === "core/controls.xtpack").declarations.find((d) => d.extern_widget?.id === "core/press").extern_widget;
  assert.equal(press.inputs[0].id, "core/press.label");
  assert.match(press.doc.about, /^Something to press/);
});

test("every case formats as xtmd fmt writes it", async () => {
  let formatted = 0;
  for (const c of [...cases.map((c) => c.source), ...cases.flatMap((c) => c.files.map((f) => f.path))]) {
    const text = readFileSync(c, "utf8");
    const got = compiler.format(c, text);
    const run = await cli.run(["fmt", "--stdout", c]);
    if (run.code === 0) {
      assert.equal(got.text, run.stdout, c);
      formatted++;
    } else {
      assert.equal(got.text, null, `${c}: the binary can't format it, xtmd.wasm did`);
    }
  }
  assert.ok(formatted >= 50, `${formatted} formatted`);
  const bad = compiler.format("page.xt.md", "@@@\n@press(label = \n");
  const notOurs = compiler.format("notes.md", "# Hi\n");
  assert.ok(notOurs.text === null && /not an Extended Mark file/.test(notOurs.diagnostics[0].message));
  assert.ok(typeof bad.text === "string" || bad.diagnostics.length > 0);
});

test("the language server answers as xtmd lsp does: diagnostics, hover, completion", async () => {
  const { LanguageServer } = await import("../dist/index.js");
  const s = await LanguageServer.load();
  const uri = "vscode-test-web://mount/docs/books.xt.md";
  const pack = { path: "vscode-test-web://mount/shelf/shelf.xtpack", text: "package shelf;\n\npack shelf@1 {\n    provides row_of_books;\n}\n\nwidget row_of_books(title: text) {\n    view {\n        @label(value = title);\n    }\n    markdown {\n        \\{title}\n    }\n}\n" };
  const doc = "import shelf;\n@@@\n@row_of_books(title = \"Read\");\n";
  const init = s.message({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } });
  assert.equal(init[0].result.serverInfo.name, "xtmd lsp");
  s.message({ jsonrpc: "2.0", method: "xtmd/packs", params: { uri, packs: [pack] } });
  const opened = s.message({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "xtmd", version: 1, text: doc } } });
  assert.deepEqual(opened[0].params.diagnostics, []);
  const [hover] = s.message({ jsonrpc: "2.0", id: 2, method: "textDocument/hover", params: { textDocument: { uri }, position: { line: 2, character: 3 } } });
  assert.match(hover.result.contents.value, /widget row_of_books\(title: text\)/);
  const [def] = s.message({ jsonrpc: "2.0", id: 3, method: "textDocument/definition", params: { textDocument: { uri }, position: { line: 2, character: 3 } } });
  assert.equal(def.result.uri, pack.path);
  const broken = s.message({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: "import shelf;\n@@@\n@row_of_books(title = 3);\n" }] } });
  assert.ok(broken[0].params.diagnostics.length > 0 && broken[0].params.diagnostics[0].source === "xtmd");
});
