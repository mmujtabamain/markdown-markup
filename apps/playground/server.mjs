// The MKP playground's server: the UI, and the mkp compiler behind a small JSON API.
//
//   GET  /                 the playground (index.html, dist/app.js, dist/app.css)
//   POST /api/compile      {source, packs?} → {diagnostics, ir, markdown}
//   GET  /api/examples     the example pages and the packs a page may import
//   GET  /healthz          whether the server and its compiler binary are there
//
// Node's own modules only: no framework, and nothing to install to run it once the bundle is built.
// Every compile and every failure is logged to stderr; a failure of the server itself (the binary
// crashed or timed out, or an unexpected exception) also alerts the team through DevBench when
// DEVBENCH_NOTIFY_URL and DEVBENCH_NOTIFY_TOKEN are set. A diagnostic in the reader's page is not
// a failure.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants as fsc, existsSync } from "node:fs";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism, hostname, tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

/** The largest page source the server compiles. */
export const MAX_SOURCE_BYTES = 200 * 1024;
/** The largest request body read: the source, escaped as JSON, and a little more. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** The most a compiler run may print before it is stopped. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const SOURCE_NAME = "page.mkp.md";
const SERVICE = "mkp-playground";

/** The packs a page may import, by the name it imports them by. */
export const PACKS = { graphs: join(repo, "examples/graphs") };

/** The page itself; everything else the UI loads is a file in dist/ (build.mjs). */
const PAGES = { "/": "index.html", "/index.html": "index.html" };

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

/** A file in dist/ is named by one path segment: no slashes, so nothing outside it is reachable. */
const DIST_NAME = /^\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
/** esbuild's `[name]-[hash]` assets (the font) never change under their name. */
const HASHED = /-[A-Z0-9]{8}\.[a-z0-9]+$/;

// ---- logging and alerts

function line(level, msg, fields = {}) {
  const kv = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" && /[\s"]/.test(v) ? JSON.stringify(v) : v}`)
    .join(" ");
  return `${new Date().toISOString()} ${level} ${msg}${kv ? " " + kv : ""}`;
}

/** Logs to stderr: one line per event, `key=value` after the message. */
export const stderrLog = {
  info: (msg, fields) => process.stderr.write(line("info", msg, fields) + "\n"),
  warn: (msg, fields) => process.stderr.write(line("warn", msg, fields) + "\n"),
  error: (msg, fields) => process.stderr.write(line("error", msg, fields) + "\n"),
};

/**
 * Posts an alert to DevBench's notify endpoint, at most once per kind every `intervalMs` (a
 * broken binary fails every compile; the team needs one message, not one per keystroke). Does
 * nothing unless both the URL and the token are set. Never logs the token.
 */
export function makeAlerter({ url, token, log, intervalMs = 5 * 60 * 1000, fetchImpl = globalThis.fetch }) {
  const last = new Map();
  const suppressed = new Map();
  const enabled = Boolean(url && token);
  return {
    enabled,
    /** Resolves once the alert is sent, skipped or has failed: it never throws. */
    async send(kind, text) {
      if (!enabled) return false;
      const now = Date.now();
      const prev = last.get(kind);
      if (prev !== undefined && now - prev < intervalMs) {
        suppressed.set(kind, (suppressed.get(kind) ?? 0) + 1);
        return false;
      }
      last.set(kind, now);
      const more = suppressed.get(kind) ?? 0;
      suppressed.delete(kind);
      const body = {
        text: more ? `${text}\n- ${more} more like this since the last alert` : text,
        level: "error",
        source: SERVICE,
      };
      const endpoint = `${url.replace(/\/+$/, "")}/api/notify/`;
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) log.error("alert not accepted", { kind, status: res.status });
        else log.info("alert sent", { kind });
        return res.ok;
      } catch (e) {
        log.error("alert failed", { kind, error: e?.message ?? String(e) });
        return false;
      }
    },
  };
}

// ---- the compiler binary

/** The mkp binary: MKP_BINARY, else the repo's release build, else its debug build. */
export function findBinary(env = process.env) {
  if (env.MKP_BINARY) return env.MKP_BINARY;
  for (const kind of ["release", "debug"]) {
    const p = join(repo, "targets/rust/target", kind, "mkp");
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** A failure of the server, not of the reader's page: it is logged, alerted and answered 500. */
class ServerFailure extends Error {
  constructor(kind, message, detail = "") {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * Runs the binary once. Resolves with its exit code, signal and output; a run that passes its
 * time limit is killed and rejects, and so does one that can't start. A run aborted because its
 * answer is no longer needed resolves with `aborted`.
 */
function runBinary(binary, args, { timeoutMs, signal }) {
  return new Promise((done, fail) => {
    const started = Date.now();
    const name = `mkp ${args[0]}`;
    let child;
    try {
      // its own process group, so a kill takes anything it started too
      child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (e) {
      fail(new ServerFailure("spawn", `${name} could not start: ${e.message}`));
      return;
    }
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      how();
    };
    const killAll = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    };
    const result = (code, sig, aborted) => ({
      code,
      signal: sig,
      aborted,
      ms: Date.now() - started,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
    });
    child.stdout.on("data", (b) => {
      outBytes += b.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        killAll();
        finish(() => fail(new ServerFailure("crash", `${name} printed more than ${MAX_OUTPUT_BYTES >> 20} MB and was killed`)));
        return;
      }
      out.push(b);
    });
    child.stderr.on("data", (b) => {
      // keep the start of stderr only: it is for diagnostics and the alert
      if (errBytes < 64 * 1024) err.push(b);
      errBytes += b.length;
    });
    // past the time limit, the answer is a failure now: don't wait for the pipes to close
    const timer = setTimeout(() => {
      killAll();
      finish(() => fail(new ServerFailure("timeout", `${name} timed out after ${timeoutMs} ms and was killed`)));
    }, timeoutMs);
    function onAbort() {
      killAll();
      finish(() => done(result(null, "SIGKILL", true)));
    }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", (e) => finish(() => fail(new ServerFailure("spawn", `${name} could not start: ${e.message}`))));
    child.on("close", (code, sig) => finish(() => done(result(code, sig, false))));
  });
}

/** `file:line:col: severity[code]: message`, as mkp prints a diagnostic in text. */
const TEXT_DIAGNOSTIC = /^(.*?):(\d+):(\d+): (error|warning|note|info)\[([^\]]+)\]: (.*)$/;

function sanitize(text, dir) {
  // the temp dir and the server's paths mean nothing to the reader
  return text.split(dir + sep).join("").split(repo + sep).join("");
}

function fromJson(d, file, dir) {
  const out = { line: d.line, col: d.column, severity: d.severity, code: d.code, message: sanitize(String(d.message ?? ""), dir) };
  if (d.end && typeof d.end.line === "number") out.end = { line: d.end.line, col: d.end.column };
  if (d.file && resolve(d.file) !== file) out.file = sanitize(String(d.file), dir);
  return out;
}

function fromText(stderr, file, dir) {
  const found = [];
  for (const l of stderr.split("\n")) {
    const m = TEXT_DIAGNOSTIC.exec(l.trim());
    if (!m) continue;
    const d = { line: Number(m[2]), col: Number(m[3]), severity: m[4], code: m[5], message: sanitize(m[6], dir) };
    if (resolve(m[1]) !== file) d.file = sanitize(m[1], dir);
    found.push(d);
  }
  return found;
}

function describeExit(name, r) {
  const how = r.signal ? `was killed by ${r.signal}` : `exited with ${r.code}`;
  const tail = r.stderr.trim().split("\n").slice(-6).join("\n").slice(0, 600);
  return { message: `mkp ${name} ${how}`, detail: tail };
}

/** `mkp check --format json`'s lines: a JSON object each, its summary last. Throws on a line that isn't one. */
function checkLines(stdout) {
  return stdout.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Whether `mkp check --format json` output lists an error. */
function hasError(stdout) {
  try {
    return checkLines(stdout).some((d) => d?.type === "diagnostic" && d.severity === "error");
  } catch {
    return false;
  }
}

/** A process that died rather than answered: a panic (101), a signal, or no exit code. */
function crashed(r) {
  return r.signal !== null || r.code === null || r.code > 1;
}

/**
 * Compiles a page: `mkp check --format json`, `mkp build` and `mkp md`, at once, in a temp dir of its
 * own that is always removed. Resolves with the result; rejects with a ServerFailure when the
 * binary misbehaves.
 */
export async function compile({ binary, source, packs = [], timeoutMs, signal }) {
  if (!binary) throw new ServerFailure("binary", "no mkp binary: set MKP_BINARY or build targets/rust");
  const dir = await mkdtemp(join(tmpdir(), "mkp-playground-"));
  const stop = new AbortController();
  const cancel = () => stop.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const file = join(dir, SOURCE_NAME);
    const out = join(dir, "page.ir.json");
    await writeFile(file, source, "utf8");
    // an empty config beside the page, so mkp looks no further up for one
    await writeFile(join(dir, "mkp.toml"), "", "utf8");
    const packArgs = packs.length ? ["--pack", packs.map((p) => PACKS[p]).join(",")] : [];
    const opts = { timeoutMs, signal: stop.signal };

    const check = runBinary(binary, ["check", "--format", "json", ...packArgs, file], opts).then((r) => {
      // a page with errors builds nothing: stop the other two rather than wait for them
      if (!r.aborted && hasError(r.stdout)) stop.abort();
      return r;
    });
    const build = runBinary(binary, ["build", file, ...packArgs, "--out", out], opts);
    const md = runBinary(binary, ["md", file, ...packArgs], opts);
    // settle all three, so none is left running when the temp dir goes
    const [c, b, m] = await Promise.allSettled([check, build, md]);
    if (c.status === "rejected") throw c.reason;
    if (signal?.aborted) return { aborted: true };

    const cr = c.value;
    if (cr.aborted) return { aborted: true };
    if (crashed(cr)) {
      const { message, detail } = describeExit("check", cr);
      throw new ServerFailure("crash", message, detail);
    }
    let parsed;
    try {
      parsed = checkLines(cr.stdout);
    } catch {
      parsed = undefined;
    }
    // its lines end with its summary; anything else is a binary that didn't answer
    if (parsed?.at(-1)?.type !== "summary") {
      const { message, detail } = describeExit("check", cr);
      throw new ServerFailure("crash", `${message} and printed no JSON`, detail);
    }
    const diagnostics = parsed.filter((d) => d.type === "diagnostic").map((d) => fromJson(d, file, dir));
    const hasErrors = diagnostics.some((d) => d.severity === "error");
    const result = { diagnostics, ir: null, markdown: null, ms: { check: cr.ms } };
    if (hasErrors) return result;

    // the page checked: build and md have to have worked too
    for (const [name, s] of [["build", b], ["md", m]]) {
      if (s.status === "rejected") throw s.reason;
      const r = s.value;
      result.ms[name] = r.ms;
      if (r.aborted) return { aborted: true };
      if (r.code === 0) continue;
      const more = !crashed(r) ? fromText(r.stderr, file, dir) : [];
      if (more.some((d) => d.severity === "error")) {
        // an error only this step reports: the reader's to fix, not the server's
        for (const d of more) if (!diagnostics.some((x) => x.line === d.line && x.col === d.col && x.code === d.code)) diagnostics.push(d);
        return { ...result, ir: null, markdown: null };
      }
      const { message, detail } = describeExit(name, r);
      throw new ServerFailure("crash", message, detail);
    }
    try {
      result.ir = JSON.parse(await readFile(out, "utf8"));
    } catch (e) {
      throw new ServerFailure("crash", `mkp build exited 0 but its IR could not be read: ${e.message}`);
    }
    result.markdown = m.value.stdout;
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- requests

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        fail(new HttpError(413, `the request is over ${Math.round(limit / 1024)} KB`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!over) done(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", fail);
  });
}

async function send(req, res, status, body, headers = {}) {
  let data = Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  const h = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers };
  if (typeof body !== "string") h["content-type"] = "application/json; charset=utf-8";
  if (data.length > 2048 && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
    data = await gzipAsync(data, { level: 6 });
    h["content-encoding"] = "gzip";
    h["vary"] = "accept-encoding";
  }
  h["content-length"] = data.length;
  res.writeHead(status, h);
  res.end(data);
}

/**
 * The UI's files, read once and kept with their gzip and an ETag, until the file changes on disk:
 * app.js is a few MB with Monaco in it, too much to read and compress for every request.
 */
function fileCache() {
  const cache = new Map();
  return {
    async get(file) {
      let st;
      try {
        st = await stat(file);
      } catch {
        return undefined;
      }
      if (!st.isFile()) return undefined;
      const hit = cache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
      const body = await readFile(file);
      const type = TYPES[extname(file)] ?? "application/octet-stream";
      const entry = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        body,
        type,
        etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
        gz: body.length > 2048 ? await gzipAsync(body, { level: 9 }) : undefined,
      };
      cache.set(file, entry);
      return entry;
    },
  };
}

function sendFile(req, res, f, cacheControl) {
  const h = { "content-type": f.type, "cache-control": cacheControl, etag: f.etag, "x-content-type-options": "nosniff", vary: "accept-encoding" };
  if (req.headers["if-none-match"] === f.etag) {
    res.writeHead(304, h);
    res.end();
    return;
  }
  const gz = f.gz && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  const body = gz ? f.gz : f.body;
  if (gz) h["content-encoding"] = "gzip";
  h["content-length"] = body.length;
  res.writeHead(200, h);
  res.end(req.method === "HEAD" ? undefined : body);
}

/** A tiny counting semaphore: at most `n` compiles at once, the rest wait their turn. */
function limiter(n, maxWaiting) {
  let running = 0;
  const waiting = [];
  return {
    async run(fn) {
      if (running >= n) {
        if (waiting.length >= maxWaiting) throw new HttpError(503, "the playground is busy: try again in a moment");
        await new Promise((go) => waiting.push(go));
      }
      running++;
      try {
        return await fn();
      } finally {
        running--;
        waiting.shift()?.();
      }
    },
  };
}

async function listExamples(dir) {
  const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
  return Promise.all(
    index.map(async (e) => ({
      id: e.id,
      title: e.title,
      description: e.description ?? "",
      packs: e.packs ?? [],
      source: await readFile(join(dir, e.file), "utf8"),
    })),
  );
}

/** Makes the bundle when it isn't there: dev convenience; `npm run build` makes it ahead of time. */
async function ensureBundle(log, distDir) {
  if (existsSync(join(distDir, "app.js"))) return;
  log.info("bundle missing: building it with esbuild");
  try {
    const { buildBundle } = await import("./build.mjs");
    await buildBundle();
    log.info("bundle built");
  } catch (e) {
    log.error("bundle build failed: the UI will not load", { error: e?.message ?? String(e) });
  }
}

/**
 * Starts the server. Every option falls back to its environment variable; `port: 0` picks a free
 * port. Resolves with the server, its URL and a close().
 */
export async function startServer(options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? stderrLog;
  const binary = options.binary !== undefined ? options.binary : findBinary(env);
  const port = options.port ?? Number(env.PORT ?? 8080);
  const host = options.host ?? env.HOST ?? "0.0.0.0";
  const timeoutMs = options.timeoutMs ?? Number(env.MKP_TIMEOUT_MS ?? 10000);
  const examplesDir = options.examplesDir ?? join(here, "examples");
  const distDir = options.distDir ?? join(here, "dist");
  const files = fileCache();
  const alerter =
    options.alerter ??
    makeAlerter({ url: options.notifyUrl ?? env.DEVBENCH_NOTIFY_URL, token: options.notifyToken ?? env.DEVBENCH_NOTIFY_TOKEN, log, intervalMs: options.alertIntervalMs });
  const compiles = limiter(options.maxCompiles ?? Math.max(2, Math.min(8, availableParallelism())), 32);
  const where = hostname();

  if (options.buildBundle !== false) await ensureBundle(log, distDir);
  if (!binary) log.error("no mkp binary found: set MKP_BINARY or build targets/rust; every compile will fail");
  else log.info("compiler", { binary: relative(repo, binary).startsWith("..") ? binary : relative(repo, binary) });
  log.info("alerts", { enabled: alerter.enabled ? "yes" : "no (DEVBENCH_NOTIFY_URL and DEVBENCH_NOTIFY_TOKEN not both set)" });

  async function failed(kind, text, fields) {
    log.error(text, fields);
    await alerter.send(kind, text);
  }

  async function handleCompile(req, res, id) {
    const started = Date.now();
    const raw = await readBody(req, MAX_BODY_BYTES);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "the body is not JSON");
    }
    if (!body || typeof body.source !== "string") throw new HttpError(400, "`source` must be a string");
    const bytes = Buffer.byteLength(body.source, "utf8");
    if (bytes > MAX_SOURCE_BYTES) throw new HttpError(413, `the source is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_SOURCE_BYTES / 1024} KB`);
    const packs = body.packs ?? [];
    if (!Array.isArray(packs) || packs.some((p) => typeof p !== "string")) throw new HttpError(400, "`packs` must be a list of pack names");
    const unknown = packs.filter((p) => !Object.hasOwn(PACKS, p));
    if (unknown.length) throw new HttpError(400, `unknown pack ${unknown.join(", ")}: the packs are ${Object.keys(PACKS).join(", ")}`);

    // the reader moved on (a newer compile replaced this one): stop the binary
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) gone.abort();
    });

    let result;
    try {
      result = await compiles.run(() => compile({ binary, source: body.source, packs: [...new Set(packs)], timeoutMs, signal: gone.signal }));
    } catch (e) {
      if (!(e instanceof ServerFailure)) throw e;
      const ms = Date.now() - started;
      const text = [
        `**MKP playground: compile failed** (${e.kind})`,
        `- ${e.message}`,
        e.detail ? `- stderr: \`${e.detail.replace(/`/g, "'").replace(/\s*\n\s*/g, " | ").slice(0, 400)}\`` : "",
        `- request ${id} on ${where}, source ${bytes} B${packs.length ? `, packs ${packs.join(",")}` : ""}`,
      ]
        .filter(Boolean)
        .join("\n");
      await failed(e.kind, text, { id, kind: e.kind, error: e.message, detail: e.detail, ms });
      await send(req, res, 500, { error: `The compiler failed: ${e.message}`, diagnostics: [], ir: null, markdown: null });
      return;
    }
    const ms = Date.now() - started;
    if (result.aborted) {
      log.info("compile cancelled", { id, ms });
      return;
    }
    const errors = result.diagnostics.filter((d) => d.severity === "error").length;
    const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
    log.info(`compile ${errors ? "errors" : "ok"}`, { id, ms, errors, warnings, bytes, packs: packs.join(","), steps: Object.entries(result.ms).map(([k, v]) => `${k}:${v}`).join(",") });
    await send(req, res, 200, { diagnostics: result.diagnostics, ir: result.ir, markdown: result.markdown, ms });
  }

  async function handle(req, res) {
    const id = randomBytes(4).toString("hex");
    res.setHeader("x-request-id", id);
    const url = new URL(req.url ?? "/", "http://playground");
    const path = url.pathname;
    try {
      if (path === "/api/compile") {
        if (req.method !== "POST") throw new HttpError(405, "POST a {source, packs?} body");
        await handleCompile(req, res, id);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "only GET here");
      if (path === "/healthz") {
        let ok = Boolean(binary);
        if (ok) ok = await access(binary, fsc.X_OK).then(() => true, () => false);
        await send(req, res, ok ? 200 : 503, ok ? { ok: true, service: SERVICE } : { ok: false, service: SERVICE, error: "the mkp binary is missing or not executable" });
        return;
      }
      if (path === "/api/examples") {
        const examples = await listExamples(examplesDir);
        await send(req, res, 200, { examples, packs: Object.keys(PACKS) });
        return;
      }
      const page = PAGES[path];
      const name = page ? undefined : DIST_NAME.exec(path)?.[1];
      if (page || name) {
        const file = page ? join(here, page) : join(distDir, name);
        const found = await files.get(file);
        if (!found) {
          const bundle = ["/app.js", "/app.css", "/editor.worker.js"].includes(path);
          throw new HttpError(bundle ? 503 : 404, bundle ? "the bundle is not built: run npm run build" : "not found");
        }
        sendFile(req, res, found, name && HASHED.test(name) ? "public, max-age=31536000, immutable" : "no-cache");
        return;
      }
      throw new HttpError(404, "not found");
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status >= 500) log.warn("request refused", { id, path, status: e.status, error: e.message });
        else if (path.startsWith("/api/")) log.info("bad request", { id, path, status: e.status, error: e.message });
        if (!res.headersSent) await send(req, res, e.status, { error: e.message });
        return;
      }
      await failed("exception", `**MKP playground: unexpected exception** on ${req.method} ${path}\n- ${e?.message ?? e}\n- request ${id} on ${where}`, {
        id,
        path,
        error: e?.stack ?? String(e),
      });
      if (!res.headersSent) await send(req, res, 500, { error: "Something went wrong on the server." });
      else res.destroy();
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error("response failed", { error: e?.stack ?? String(e) });
      res.destroy();
    });
  });
  server.requestTimeout = 60_000;
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, ok);
  });
  const actual = server.address().port;
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${actual}`;
  log.info("listening", { url: `http://${host}:${actual}` });
  return {
    server,
    url,
    port: actual,
    alerter,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

// ---- run as a program

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = stderrLog;
  const env = process.env;
  const alerter = makeAlerter({ url: env.DEVBENCH_NOTIFY_URL, token: env.DEVBENCH_NOTIFY_TOKEN, log });
  // a crash the handlers didn't catch: tell the team, then let the platform restart us
  const fatal = (what) => async (e) => {
    log.error(what, { error: e?.stack ?? String(e) });
    await alerter.send("fatal", `**MKP playground: ${what}**, the server is exiting\n- ${e?.message ?? e}\n- on ${hostname()}`);
    process.exit(1);
  };
  process.on("uncaughtException", fatal("uncaught exception"));
  process.on("unhandledRejection", fatal("unhandled rejection"));
  const started = await startServer({ alerter, log }).catch(async (e) => {
    await fatal("could not start")(e);
  });
  const stop = (sig) => {
    log.info("stopping", { signal: sig });
    started?.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
