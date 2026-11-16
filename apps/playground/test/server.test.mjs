// The playground's server: its API with the real compiler, its limits, and its alerts when the
// compiler binary misbehaves.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_SOURCE_BYTES, findBinary, startServer } from "../server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const example = (name) => readFile(join(app, "examples", name), "utf8");
const binary = findBinary();

// every temp dir the server makes lands here, so the test can see they are all removed
const scratch = await mkdtemp(join(tmpdir(), "pg-test-"));
process.env.TMPDIR = scratch;

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

function compile(url, body, headers = {}) {
  return fetch(`${url}/api/compile`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("with the real compiler", { skip: binary ? false : "no mkp binary: build targets/rust" }, () => {
  let s;
  let log;
  let notify;

  before(async () => {
    log = memoryLog();
    notify = await fakeNotify();
    s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log, notifyUrl: notify.url, notifyToken: "test-token" });
  });

  after(async () => {
    await s?.close();
    await notify?.close();
  });

  test("healthz answers ok", async () => {
    const res = await fetch(`${s.url}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: "mkp-playground" });
  });

  test("lists the examples with their sources and the packs", async () => {
    const res = await fetch(`${s.url}/api/examples`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.packs, ["graphs"]);
    assert.deepEqual(
      body.examples.map((e) => e.id),
      ["counter", "slider", "list", "release-flow"],
    );
    for (const e of body.examples) {
      assert.ok(e.title && e.source.includes("@@@"), `${e.id} has a title and a source`);
    }
    assert.deepEqual(body.examples.find((e) => e.id === "release-flow").packs, ["graphs"]);
    assert.match(body.examples.find((e) => e.id === "slider").source, /require "/);
  });

  test("compiles a page: no diagnostics, its IR and its Markdown", async () => {
    const res = await compile(s.url, { source: await example("counter.mkp.md") });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.diagnostics, []);
    assert.ok(body.ir?.ir?.templates?.length, "the IR has templates");
    assert.ok(body.ir.ir.templates.some((t) => t.name === "doc/counter"));
    assert.match(body.markdown, /^# A counter/);
    assert.match(body.markdown, /Count: \*\*0\*\*/);
    assert.equal(typeof body.ms, "number");
    assert.ok(log.lines.some((l) => l.startsWith("info compile ok") && l.includes('"errors":0')), "the compile is logged");
  });

  test("every example compiles", async () => {
    const { examples } = await (await fetch(`${s.url}/api/examples`)).json();
    for (const e of examples) {
      const body = await (await compile(s.url, { source: e.source, packs: e.packs })).json();
      assert.deepEqual(body.diagnostics, [], `${e.id} has no diagnostics`);
      assert.ok(body.ir && body.markdown, `${e.id} has its IR and Markdown`);
    }
  });

  test("a page with errors gives diagnostics with lines and columns, and no IR", async () => {
    const source = ["$state {", "    count: int = 0", "}", "@@@", "Hello"].join("\n");
    const res = await compile(s.url, { source });
    assert.equal(res.status, 200, "a mistake in the page is not a server failure");
    const body = await res.json();
    assert.equal(body.ir, null);
    assert.equal(body.markdown, null);
    assert.equal(body.diagnostics.length, 1);
    const [d] = body.diagnostics;
    assert.equal(d.severity, "error");
    assert.equal(d.code, "syntax.missing-semicolon");
    assert.equal(d.line, 2);
    assert.equal(d.col, 19);
    assert.ok(d.message.length > 0);
    assert.ok(!d.message.includes(scratch), "no server paths in the message");
  });

  test("type errors point at their own lines", async () => {
    const source = ["$state {", "    count: int = 0;", "}", "@@@", "", "Count \\{$state.cuont}", "", '@press(label = 3);'].join("\n");
    const body = await (await compile(s.url, { source })).json();
    const lines = body.diagnostics.map((d) => d.line).sort();
    assert.ok(body.diagnostics.length >= 2, JSON.stringify(body.diagnostics));
    assert.ok(lines.includes(6) && lines.includes(8), `errors on lines 6 and 8: ${lines}`);
    const unknown = body.diagnostics.find((d) => d.line === 6);
    assert.equal(unknown.code, "names.unknown-field");
    assert.match(unknown.message, /cuont/);
    assert.deepEqual(Object.keys(unknown.end), ["line", "col"]);
  });

  test("a page that imports a pack needs it named", async () => {
    const source = await example("release-flow.mkp.md");
    const without = await (await compile(s.url, { source })).json();
    assert.ok(without.diagnostics.some((d) => d.code === "names.unknown-pack" && d.line === 1));
    const withPack = await (await compile(s.url, { source, packs: ["graphs"] })).json();
    assert.deepEqual(withPack.diagnostics, []);
    assert.match(withPack.markdown, /# Release flow/);
  });

  test("refuses a source over the size limit", async () => {
    const source = "@@@\n" + "x".repeat(MAX_SOURCE_BYTES);
    const res = await compile(s.url, { source });
    assert.equal(res.status, 413);
    assert.match((await res.json()).error, /limit is 200 KB/);
  });

  test("refuses bodies that aren't a compile request", async () => {
    assert.equal((await compile(s.url, "not json")).status, 400);
    assert.equal((await compile(s.url, { source: 42 })).status, 400);
    const pack = await compile(s.url, { source: "@@@\nhi\n", packs: ["../../etc"] });
    assert.equal(pack.status, 400);
    assert.match((await pack.json()).error, /unknown pack/);
    assert.equal((await fetch(`${s.url}/api/compile`)).status, 405);
    assert.equal((await fetch(`${s.url}/nope`)).status, 404);
  });

  test("gzips a large answer when the client accepts it", async () => {
    const res = await compile(s.url, { source: await example("counter.mkp.md") }, { "accept-encoding": "gzip" });
    assert.equal(res.headers.get("content-encoding"), "gzip");
    assert.ok((await res.json()).ir);
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

  test("serves the bundle's files from dist/: types, gzip, ETags, and nothing outside it", async () => {
    const dist = await mkdtemp(join(tmpdir(), "pg-dist-"));
    const js = "export const monaco = 1;\n".repeat(400);
    await writeFile(join(dist, "app.js"), js);
    await writeFile(join(dist, "editor.worker.js"), "self.onmessage = () => {};\n");
    await writeFile(join(dist, "codicon-ABCD1234.ttf"), Buffer.from([0, 1, 0, 0, 0, 10, 0, 128]));
    const t = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log: memoryLog(), distDir: dist, notifyUrl: "", notifyToken: "" });
    try {
      const app = await fetch(`${t.url}/app.js`, { headers: { "accept-encoding": "gzip" } });
      assert.equal(app.status, 200);
      assert.match(app.headers.get("content-type"), /^text\/javascript/);
      assert.equal(app.headers.get("content-encoding"), "gzip");
      assert.equal(app.headers.get("cache-control"), "no-cache");
      assert.equal(await app.text(), js);
      const etag = app.headers.get("etag");
      assert.ok(etag);
      assert.equal((await fetch(`${t.url}/app.js`, { headers: { "if-none-match": etag } })).status, 304, "an unchanged file is not sent again");

      const worker = await fetch(`${t.url}/editor.worker.js`);
      assert.equal(worker.status, 200);
      assert.match(worker.headers.get("content-type"), /^text\/javascript/);

      const font = await fetch(`${t.url}/codicon-ABCD1234.ttf`);
      assert.equal(font.status, 200);
      assert.equal(font.headers.get("content-type"), "font/ttf");
      assert.match(font.headers.get("cache-control"), /immutable/, "a hashed name never changes");
      assert.deepEqual([...new Uint8Array(await font.arrayBuffer())], [0, 1, 0, 0, 0, 10, 0, 128]);

      for (const path of ["/../server.mjs", "/%2e%2e/server.mjs", "/%2e%2e%2fserver.mjs", "/sub/app.js", "/.hidden", "/server.mjs"]) {
        const res = await fetch(`${t.url}${path}`);
        assert.equal(res.status, 404, `${path} is not served`);
      }
      assert.equal((await fetch(`${t.url}/app.css`)).status, 503, "a missing bundle says so");
    } finally {
      await t.close();
      await rm(dist, { recursive: true, force: true });
    }
  });

  test("removes every temp dir it made", async () => {
    await compile(s.url, { source: await example("list.mkp.md") });
    await compile(s.url, { source: "@@@\n@press(;\n" });
    const left = (await readdir(scratch)).filter((n) => n.startsWith("mkp-playground-"));
    assert.deepEqual(left, []);
  });

  test("a page's own errors never alert the team", async () => {
    await compile(s.url, { source: "$state {\n    n: int = 0\n}\n@@@\n" });
    assert.equal(notify.received.length, 0);
  });
});

describe("when the compiler binary fails", () => {
  let notify;
  let dir;

  before(async () => {
    notify = await fakeNotify();
    dir = await mkdtemp(join(tmpdir(), "pg-bin-"));
  });

  after(async () => {
    await notify.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("a broken binary answers 500 and alerts the team, without logging the token", async () => {
    const log = memoryLog();
    const s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log, binary: "/bin/false", notifyUrl: notify.url + "/", notifyToken: "secret-token-123" });
    try {
      const res = await compile(s.url, { source: "@@@\nHello\n" });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(body.error, /compiler failed/);
      assert.deepEqual(body.diagnostics, []);
      assert.equal(body.ir, null);
      assert.ok(await waitFor(() => notify.received.length === 1), "the alert arrived");
      const [alert] = notify.received;
      assert.equal(alert.method, "POST");
      assert.equal(alert.url, "/api/notify/");
      assert.equal(alert.headers.authorization, "Bearer secret-token-123");
      assert.equal(alert.headers["content-type"], "application/json");
      assert.equal(alert.body.level, "error");
      assert.equal(alert.body.source, "mkp-playground");
      assert.match(alert.body.text, /compile failed/);
      assert.match(alert.body.text, /mkp check exited with 1/);
      assert.ok(log.lines.some((l) => l.startsWith("error ") && l.includes("crash")), "the failure is logged");
      assert.ok(!log.lines.join("\n").includes("secret-token-123"), "the token is never logged");

      // the same failure again soon after: logged, but the team isn't told twice
      await compile(s.url, { source: "@@@\nHello again\n" });
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(notify.received.length, 1);
      assert.equal(log.lines.filter((l) => l.startsWith("error ") && l.includes("compile failed")).length, 2);
    } finally {
      await s.close();
    }
  });

  test("a binary that hangs is killed at the time limit and alerts", async () => {
    notify.received.length = 0;
    const slow = join(dir, "slow-mkp");
    await writeFile(slow, "#!/bin/sh\nsleep 30\n");
    await chmod(slow, 0o755);
    const log = memoryLog();
    const s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log, binary: slow, timeoutMs: 300, notifyUrl: notify.url, notifyToken: "t" });
    try {
      const started = Date.now();
      const res = await compile(s.url, { source: "@@@\nHello\n" });
      assert.equal(res.status, 500);
      assert.ok(Date.now() - started < 5000, "it did not wait for the binary");
      assert.match((await res.json()).error, /timed out after 300 ms/);
      assert.ok(await waitFor(() => notify.received.length === 1));
      assert.match(notify.received[0].body.text, /\(timeout\)/);
    } finally {
      await s.close();
    }
  });

  test("a binary that panics alerts with what it printed", async () => {
    notify.received.length = 0;
    const panics = join(dir, "panicking-mkp");
    await writeFile(panics, "#!/bin/sh\necho \"thread 'main' panicked at src/lower.rs:12: index out of bounds\" >&2\nexit 101\n");
    await chmod(panics, 0o755);
    const s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log: memoryLog(), binary: panics, notifyUrl: notify.url, notifyToken: "t" });
    try {
      assert.equal((await compile(s.url, { source: "@@@\nHi\n" })).status, 500);
      assert.ok(await waitFor(() => notify.received.length === 1));
      assert.match(notify.received[0].body.text, /exited with 101/);
      assert.match(notify.received[0].body.text, /panicked at src\/lower\.rs/);
    } finally {
      await s.close();
    }
  });

  test("with no notify settings, a failure is only logged", async () => {
    notify.received.length = 0;
    const log = memoryLog();
    const s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log, binary: "/bin/false", notifyUrl: "", notifyToken: "" });
    try {
      assert.equal(s.alerter.enabled, false);
      assert.equal((await compile(s.url, { source: "@@@\nHi\n" })).status, 500);
      assert.ok(log.lines.some((l) => l.startsWith("error ")));
      assert.equal(notify.received.length, 0);
    } finally {
      await s.close();
    }
  });

  test("a missing binary fails healthz", async () => {
    const s = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log: memoryLog(), binary: join(dir, "no-such-mkp"), notifyUrl: "", notifyToken: "" });
    try {
      const res = await fetch(`${s.url}/healthz`);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).ok, false);
    } finally {
      await s.close();
    }
  });
});

test("server.mjs as a program reads PORT, MKP_BINARY and the DEVBENCH_NOTIFY_* variables", async () => {
  const notify = await fakeNotify();
  const child = spawn(process.execPath, [join(app, "server.mjs")], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", MKP_BINARY: "/bin/false", DEVBENCH_NOTIFY_URL: notify.url, DEVBENCH_NOTIFY_TOKEN: "env-token-456" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (b) => (stderr += b));
  try {
    assert.ok(await waitFor(() => /listening url=http:\/\/127\.0\.0\.1:\d+/.test(stderr), 15000), `it started: ${stderr}`);
    const port = /listening url=http:\/\/127\.0\.0\.1:(\d+)/.exec(stderr)[1];
    const res = await compile(`http://127.0.0.1:${port}`, { source: "@@@\nHi\n" });
    assert.equal(res.status, 500);
    assert.ok(await waitFor(() => notify.received.length === 1), "the alert arrived");
    assert.equal(notify.received[0].headers.authorization, "Bearer env-token-456");
    assert.match(stderr, /compile failed/);
    assert.ok(!stderr.includes("env-token-456"), "the token is never logged");
  } finally {
    child.kill("SIGTERM");
    await new Promise((ok) => child.on("exit", ok));
    await notify.close();
  }
});
