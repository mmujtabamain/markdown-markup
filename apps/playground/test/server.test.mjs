// The playground's server: the UI's files and xtmd.wasm, the examples with the packs' files, the
// reports the browser sends and the alerts they make; and every example compiled by the xtmd.wasm
// the page runs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Compiler } from "@extended-mark/wasm";
import { Page } from "@extended-mark/runtime";
import { startServer } from "../server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const example = (name) => readFile(join(app, "examples", name), "utf8");

/** A logger that keeps its lines, to assert on and to keep the test output quiet. */
function memoryLog() {
  const lines = [];
  const add = (level) => (msg, fields = {}) => lines.push(`${level} ${msg} ${JSON.stringify(fields)}`);
  return { lines, info: add("info"), warn: add("warn"), error: add("error") };
}

/** A stand-in for DevBench's notify endpoint: records every request. */
async function fakeNotify() {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { received, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
}

async function waitFor(check, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/** A dist/ with stand-ins for the bundle's files. */
async function fakeDist(files = {}) {
  const dist = await mkdtemp(join(tmpdir(), "pg-dist-"));
  const all = {
    "app.js": "export const monaco = 1;\n".repeat(400),
    "editor.worker.js": "self.onmessage = () => {};\n",
    "compiler.worker.js": "self.onmessage = () => {};\n",
    "xtmd.wasm": Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
    "codicon-ABCD1234.ttf": Buffer.from([0, 1, 0, 0, 0, 10, 0, 128]),
    ...files,
  };
  for (const [name, body] of Object.entries(all)) if (body !== null) await writeFile(join(dist, name), body);
  return dist;
}

function report(url, body) {
  return fetch(`${url}/api/report`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("the server", () => {
  let s;
  let log;
  let notify;
  let dist;

  before(async () => {
    log = memoryLog();
    notify = await fakeNotify();
    dist = await fakeDist();
    s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log, distDir: dist, notifyUrl: notify.url + "/", notifyToken: "secret-token-123", alertIntervalMs: 60_000 });
  });

  after(async () => {
    await s?.close();
    await notify?.close();
    await rm(dist, { recursive: true, force: true });
  });

  test("healthz answers ok when the bundle and xtmd.wasm are there", async () => {
    const res = await fetch(`${s.url}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: "xtmd-playground" });
  });

  test("lists the examples, and the packs with their files' text", async () => {
    const res = await fetch(`${s.url}/api/examples`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.packs, ["graphs"]);
    assert.deepEqual(
      body.examples.map((e) => e.id),
      ["counter", "slider", "list", "release-flow"],
    );
    for (const e of body.examples) assert.ok(e.title && e.source.includes("@@@"), `${e.id} has a title and a source`);
    assert.deepEqual(body.examples.find((e) => e.id === "release-flow").packs, ["graphs"]);
    assert.deepEqual(body.packFiles.graphs.map((f) => f.path), ["graphs/graphs.xtpack"]);
    assert.equal(body.packFiles.graphs[0].text, await readFile(join(app, "../../examples/graphs/graphs.xtpack"), "utf8"));
  });

  test("serves the UI's page", async () => {
    const res = await fetch(`${s.url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const html = await res.text();
    for (const id of ['data-testid="editor"', 'data-testid="preview"', 'data-testid="example-picker"', 'data-testid="tab-markdown"', 'data-testid="tab-diagnostics"', 'data-testid="tab-state"']) {
      assert.ok(html.includes(id), `the page has ${id}`);
    }
  });

  test("serves the bundle's files from dist/: xtmd.wasm and the workers, types, gzip, ETags, and nothing outside it", async () => {
    const js = await fetch(`${s.url}/app.js`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /^text\/javascript/);
    assert.equal(js.headers.get("content-encoding"), "gzip");
    assert.equal(js.headers.get("cache-control"), "no-cache");
    const etag = js.headers.get("etag");
    assert.ok(etag);
    assert.equal((await fetch(`${s.url}/app.js`, { headers: { "if-none-match": etag } })).status, 304, "an unchanged file is not sent again");

    for (const worker of ["editor.worker.js", "compiler.worker.js"]) {
      const w = await fetch(`${s.url}/${worker}`);
      assert.equal(w.status, 200);
      assert.match(w.headers.get("content-type"), /^text\/javascript/);
    }
    const wasm = await fetch(`${s.url}/xtmd.wasm`);
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get("content-type"), "application/wasm", "WebAssembly.compileStreaming needs its type");
    assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer())], [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

    const font = await fetch(`${s.url}/codicon-ABCD1234.ttf`);
    assert.equal(font.headers.get("content-type"), "font/ttf");
    assert.match(font.headers.get("cache-control"), /immutable/, "a hashed name never changes");

    for (const path of ["/../server.mjs", "/%2e%2e/server.mjs", "/%2e%2e%2fserver.mjs", "/sub/app.js", "/.hidden", "/server.mjs"]) {
      assert.equal((await fetch(`${s.url}${path}`)).status, 404, `${path} is not served`);
    }
    assert.equal((await fetch(`${s.url}/app.css`)).status, 503, "a missing bundle says so");
  });

  test("compiles nothing itself: /api/compile is gone", async () => {
    const res = await fetch(`${s.url}/api/compile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "@@@\nHi\n" }) });
    assert.equal(res.status, 405);
    assert.equal((await fetch(`${s.url}/api/compile`)).status, 404);
  });

  test("a report from the browser is logged and alerts the team once per kind, without logging the token", async () => {
    const res = await report(s.url, { kind: "compiler-crash", message: "the compiler stopped on page.xt.md: panicked at lower.rs:12\nindex out of bounds", bytes: 120, agent: "Chromium" });
    assert.equal(res.status, 202);
    assert.ok(await waitFor(() => notify.received.length === 1), "the alert arrived");
    const [alert] = notify.received;
    assert.equal(alert.method, "POST");
    assert.equal(alert.url, "/api/notify/");
    assert.equal(alert.headers.authorization, "Bearer secret-token-123");
    assert.equal(alert.body.level, "error");
    assert.equal(alert.body.source, "xtmd-playground");
    assert.match(alert.body.text, /compiler-crash\*\* in a reader's browser/);
    assert.match(alert.body.text, /panicked at lower\.rs:12 \| index out of bounds/);
    assert.match(alert.body.text, /page 120 B, Chromium/);
    // the same kind again soon after: logged, not told twice
    await report(s.url, { kind: "compiler-crash", message: "again" });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(notify.received.length, 1);
    assert.equal(log.lines.filter((l) => l.startsWith("error ") && l.includes("compiler-crash")).length, 2);
    // another kind is told
    await report(s.url, { kind: "compiler-load", message: "xtmd.wasm couldn't be loaded: 404" });
    assert.ok(await waitFor(() => notify.received.length === 2));
    assert.ok(!log.lines.join("\n").includes("secret-token-123"), "the token is never logged");
  });

  test("refuses a report that isn't one", async () => {
    assert.equal((await report(s.url, "not json")).status, 400);
    assert.equal((await report(s.url, { kind: "Bad Kind!", message: "x" })).status, 400);
    assert.equal((await report(s.url, { kind: "compiler-crash" })).status, 400);
    assert.equal((await report(s.url, { kind: "compiler-crash", message: "x".repeat(20_000) })).status, 413);
    assert.equal((await fetch(`${s.url}/api/report`)).status, 405);
  });
});

test("healthz fails when xtmd.wasm is missing", async () => {
  const dist = await fakeDist({ "xtmd.wasm": null });
  const log = memoryLog();
  const s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log, distDir: dist, notifyUrl: "", notifyToken: "" });
  try {
    const res = await fetch(`${s.url}/healthz`);
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /xtmd\.wasm/);
    assert.ok(log.lines.some((l) => l.startsWith("error no xtmd.wasm")), "said at startup");
  } finally {
    await s.close();
    await rm(dist, { recursive: true, force: true });
  }
});

describe("the examples, compiled by the xtmd.wasm the page runs", () => {
  let compiler;
  let packFiles;
  let examples;

  before(async () => {
    compiler = await Compiler.load();
    const dist = await fakeDist();
    const s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log: memoryLog(), distDir: dist, notifyUrl: "", notifyToken: "" });
    ({ examples, packFiles } = await (await fetch(`${s.url}/api/examples`)).json());
    await s.close();
    await rm(dist, { recursive: true, force: true });
  });

  const build = (source, packs = []) => compiler.build("page.xt.md", source, packs.flatMap((p) => packFiles[p]));

  test("every example compiles, and runs", () => {
    for (const e of examples) {
      const b = build(e.source, e.packs);
      assert.deepEqual(b.diagnostics, [], `${e.id} has no diagnostics`);
      const page = new Page(b.ir, {});
      assert.ok(page.markdown().length > 0, `${e.id} runs`);
    }
    assert.match(new Page(build(examples[0].source).ir, {}).markdown(), /Count: \*\*0\*\*/);
  });

  test("a page with errors gives diagnostics with lines and columns, and no IR", async () => {
    const b = build(["$state {", "    count: int = 0", "}", "@@@", "Hello"].join("\n"));
    assert.equal(b.ir, null);
    assert.equal(b.diagnostics.length, 1);
    const [d] = b.diagnostics;
    assert.deepEqual([d.severity, d.code, d.line, d.column, d.file], ["error", "syntax.missing-semicolon", 2, 19, "page.xt.md"]);
    const types = build(["$state {", "    count: int = 0;", "}", "@@@", "", "Count \\{$state.cuont}", "", "@press(label = 3);"].join("\n"));
    const lines = types.diagnostics.map((x) => x.line).sort();
    assert.ok(lines.includes(6) && lines.includes(8), `errors on lines 6 and 8: ${lines}`);
    assert.equal(types.diagnostics.find((x) => x.line === 6).code, "names.unknown-field");
  });

  test("a page that imports a pack needs its files", async () => {
    const source = await example("release-flow.xt.md");
    assert.ok(build(source).diagnostics.some((d) => d.code === "names.unknown-pack" && d.line === 1));
    const b = build(source, ["graphs"]);
    assert.deepEqual(b.diagnostics, []);
    assert.match(new Page(b.ir, {}).markdown(), /# Release flow/);
  });
});

test("server.mjs as a program reads PORT and the DEVBENCH_NOTIFY_* variables", async () => {
  const notify = await fakeNotify();
  const child = spawn(process.execPath, [join(app, "server.mjs")], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DEVBENCH_NOTIFY_URL: notify.url, DEVBENCH_NOTIFY_TOKEN: "env-token-456" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (b) => (stderr += b));
  try {
    assert.ok(await waitFor(() => /listening url=http:\/\/127\.0\.0\.1:\d+/.test(stderr), 15000), `it started: ${stderr}`);
    const port = /listening url=http:\/\/127\.0\.0\.1:(\d+)/.exec(stderr)[1];
    assert.equal((await report(`http://127.0.0.1:${port}`, { kind: "compiler-load", message: "no xtmd.wasm" })).status, 202);
    assert.ok(await waitFor(() => notify.received.length === 1), "the alert arrived");
    assert.equal(notify.received[0].headers.authorization, "Bearer env-token-456");
    assert.match(stderr, /compiler-load/);
    assert.ok(!stderr.includes("env-token-456"), "the token is never logged");
  } finally {
    child.kill("SIGTERM");
    await new Promise((ok) => child.on("exit", ok));
    await notify.close();
  }
});
