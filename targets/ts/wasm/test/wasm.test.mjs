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
  const files = packs.flatMap((p) => (statSync(p).isDirectory() ? walk(p, (x) => x.endsWith(".xtmdpack")) : [p]));
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
  const bad = compiler.build("page.xtmd", "$state {\n    n: int 0..3 = 9;\n}\n@@@\n\\{$state.nope}\n");
  assert.equal(bad.ir, null);
  assert.ok(bad.errors >= 1);
  assert.ok(bad.diagnostics.every((d) => d.file === "page.xtmd" && d.line >= 1 && typeof d.message === "string"), JSON.stringify(bad.diagnostics));
  const good = compiler.build("page.xtmd", "# Hello\n");
  assert.equal(good.errors, 0);
  assert.equal(good.ir.ir.module, "doc");
});

test("a pack given as text is used, and one the document names but isn't given is an error", () => {
  const pack = { path: "shapes/shapes.xtmdpack", text: "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n" };
  const doc = "import shapes;\n@@@\nTwice: \\{double(4)}\n";
  const ok = compiler.build("page.xtmd", doc, [pack]);
  assert.equal(ok.errors, 0, JSON.stringify(ok.diagnostics));
  assert.ok(JSON.stringify(ok.ir).includes("shapes/double"));
  const missing = compiler.build("page.xtmd", doc);
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
  assert.equal(compiler.build("page.xtmd", "# Hello\n").rir, undefined);
});

test("a draft with errors still has its resolved IR, for an editor", () => {
  const b = compiler.build("page.xtmd", "$state {\n    n: int = 0;\n}\n@@@\n@press(label = 3);\n", [], { rir: true });
  assert.ok(b.errors > 0 && b.ir === null);
  assert.equal(b.rir.files[0].path, "page.xtmd");
  assert.ok(JSON.stringify(b.rir).includes('"core/int"'));
});

test("core's files come first in the resolved IR when asked, resolved, as the binary's --core", async () => {
  const doc = "@@@\n@press(label = \"Go\");\n";
  const got = compiler.build("page.xtmd", doc, [], { rir: true, core: true });
  const files = got.rir.files;
  assert.ok(files.length > 10 && files[0].path.startsWith("core/") && files.at(-1).path === "page.xtmd", files.map((f) => f.path).join(" "));
  const press = files.find((f) => f.path === "core/controls.xtmdpack").declarations.find((d) => d.extern_widget?.id === "core/press").extern_widget;
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
  const bad = compiler.format("page.xtmd", "@@@\n@press(label = \n");
  const notOurs = compiler.format("notes.md", "# Hi\n");
  assert.ok(notOurs.text === null && /not an Extended Mark file/.test(notOurs.diagnostics[0].message));
  assert.ok(typeof bad.text === "string" || bad.diagnostics.length > 0);
});

test("the language server answers as xtmd lsp does: diagnostics, hover, completion", async () => {
  const { LanguageServer } = await import("../dist/index.js");
  const s = await LanguageServer.load();
  const uri = "vscode-test-web://mount/docs/books.xtmd";
  const pack = { path: "vscode-test-web://mount/shelf/shelf.xtmdpack", text: "package shelf;\n\npack shelf@1 {\n    provides row_of_books;\n}\n\nwidget row_of_books(title: text) {\n    view {\n        @label(value = title);\n    }\n    markdown {\n        \\{title}\n    }\n}\n" };
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

test("every case's Markdown is xtmd md's, and a document that doesn't compile has none", async () => {
  let written = 0;
  for (const c of cases) {
    const got = compiler.markdown(c.source, readFileSync(c.source, "utf8"), c.files);
    const run = await cli.run(["md", c.source, ...c.packs.flatMap((p) => ["--pack", p])]);
    if (run.code === 0) {
      assert.equal(got.markdown, run.stdout, c.id);
      written++;
    } else {
      assert.equal(got.markdown, null, `${c.id}: the binary writes no Markdown, xtmd.wasm did`);
    }
  }
  assert.ok(written >= 50, `${written} written`);
  const bad = compiler.markdown("page.xtmd", "@@@\n@nope();\n");
  assert.ok(bad.markdown === null && bad.errors > 0, JSON.stringify(bad));
});

test("a migration plans what xtmd migrate writes, asks what it asks, and keeps nothing between runs", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  // the CLI's own fixture: kit@2 renames and drops what kit@1 had
  const surface = "package kit@1;\n\nrecord stat {\n    label: text;\n    value: text;\n}\n\nenum state { DONE, LATE }\n\nextern widget chart(values: list<number>, color: color = color.ACCENT);\nextern widget badge(label: text, shadow: bool = false);\nextern widget sparkline(values: list<number>);\nextern widget stats(items: list<stat>);\n";
  const kit = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides plot, badge, stat, state, stats;\n}\n\nrecord stat {\n    title: text;\n    value: text;\n    unit: text;\n}\n\nenum state { DONE, OVERDUE }\n\nextern widget plot(values: list<number>, tone: color = color.ACCENT);\nextern widget badge(label: text, size: size = size.M);\nextern widget stats(items: list<stat>);\n";
  const migration = "package kit;\n\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n        rename(input = color, to = tone);\n    }\n\n    widget badge {\n        drop(input = shadow, why = \"badges have no shadow\");\n        set(input = size, value = size.S, when = !given(size), why = \"kit@1's badges were small\");\n    }\n\n    widget sparkline {\n        drop(why = \"use plot\");\n    }\n\n    record stat {\n        rename(field = label, to = title);\n        add(field = unit, value = \"\", why = \"a stat names its unit\");\n    }\n\n    enum state {\n        split(from = state.LATE, to = [state.OVERDUE, state.DONE], why = \"late is now overdue, or done\");\n    }\n}\n";
  const doc = "import kit;\n\n$state {\n    s: state = state.LATE;\n}\n@@@\n# Report\n\n@chart(values = [1, 2], color = color.OK);\n\n@badge(label = \"Beta\", shadow = true);\n\n@sparkline(values = [3]);\n\n@stats(items = [stat { label = \"Deploys\", value = \"42\" }]);\n";
  const dir = mkdtempSync(join(tmpdir(), "xtmd-wasm-migrate-"));
  const files = { "kit/kit.xtmdpack": kit, "kit/surfaces/kit@1.xtmdpack": surface, "kit/migrations/kit@2.xtmdpack": migration, "xtmd.toml": "packs = [\"kit\"]\n\n[uses]\nkit = 1\n", "docs/report.xtmd": doc };
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), t);
  }
  const docPath = join(dir, "docs/report.xtmd");
  const request = {
    sources: ["kit/kit.xtmdpack", "kit/surfaces/kit@1.xtmdpack", "kit/migrations/kit@2.xtmdpack"].map((f) => ({ path: join(dir, f), text: files[f] })),
    docs: [{ path: docPath, text: doc }],
    config: { path: join(dir, "xtmd.toml"), text: files["xtmd.toml"] },
  };
  // the question first, as the binary asks it
  const asked = compiler.migrate(request);
  const key = `${docPath}:4 LATE`;
  assert.deepEqual(asked.questions.map((q) => [q.number, q.key, q.options]), [[1, key, ["OVERDUE", "DONE"]]]);
  assert.equal(asked.config, null);
  const binaryAsks = await cli.run(["migrate", join(dir, "docs"), "--format", "json"]);
  const said = binaryAsks.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.type === "question");
  assert.deepEqual(said.map((q) => [q.question, q.options]), [[1, ["OVERDUE", "DONE"]]]);
  // answered, it plans the binary's text, and xtmd.toml's [uses] moves with it
  writeFileSync(join(dir, "answers.toml"), `[split]\n"${key}" = "DONE"\n`);
  const want = await cli.run(["migrate", docPath, "--stdout", "--answers", join(dir, "answers.toml")]);
  assert.equal(want.code, 0, want.stderr);
  const planned = compiler.migrate({ ...request, answers: { split: { [key]: "DONE" } } });
  assert.deepEqual(planned.questions, []);
  assert.equal(planned.files[0].result, "migrate");
  assert.equal(planned.files[0].text, want.stdout);
  assert.match(planned.config.text, /\[uses\]\nkit = 2\n/);
  // the same request plans the same again: nothing is kept from one run to the next
  assert.deepEqual(compiler.migrate({ ...request, answers: { split: { [key]: "DONE" } } }), planned);
  assert.equal(compiler.migrate(request).questions.length, 1);
});
