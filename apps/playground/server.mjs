// The MKP playground's server: the UI and the examples. The page compiles in the browser, with
// mkp.wasm in a worker, so there is no compiler here.
//
//   GET  /                 the playground (index.html, and dist/: app.js, app.css, the workers, mkp.wasm)
//   GET  /api/examples     the example pages, and the packs a page may import with their files' text
//   POST /api/report       {kind, message, bytes?, agent?}: a failure in the browser (the compiler
//                          couldn't load, or stopped on a page), logged and told to the team
//   GET  /healthz          whether the bundle and mkp.wasm are there
//
// Node's own modules only: no framework, and nothing to install to run it once the bundle is built.
// Every failure is logged to stderr; a failure of the server itself (an unexpected exception) or
// one the browser reports also alerts the team through DevBench when DEVBENCH_NOTIFY_URL and
// DEVBENCH_NOTIFY_TOKEN are set. A diagnostic in the reader's page is not a failure.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

/** The largest report the browser may send. */
const MAX_REPORT_BYTES = 16 * 1024;
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
  ".wasm": "application/wasm",
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
 * compiler that won't load fails every page; the team needs one message, not one per keystroke). Does
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

// ---- the packs

/** A pack's files, each as the compiler is given it: its path (`graphs/graphs.mkp`) and its text. */
async function packFiles(name, dir) {
  const out = [];
  async function walk(d, rel) {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.isDirectory()) await walk(join(d, e.name), `${rel}/${e.name}`);
      else if (e.name.endsWith(".mkp")) out.push({ path: `${rel}/${e.name}`, text: await readFile(join(d, e.name), "utf8") });
    }
  }
  await walk(dir, name);
  return out;
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
  const port = options.port ?? Number(env.PORT ?? 8080);
  const host = options.host ?? env.HOST ?? "0.0.0.0";
  const examplesDir = options.examplesDir ?? join(here, "examples");
  const distDir = options.distDir ?? join(here, "dist");
  const files = fileCache();
  const alerter =
    options.alerter ??
    makeAlerter({ url: options.notifyUrl ?? env.DEVBENCH_NOTIFY_URL, token: options.notifyToken ?? env.DEVBENCH_NOTIFY_TOKEN, log, intervalMs: options.alertIntervalMs });
  const where = hostname();

  if (options.buildBundle !== false) await ensureBundle(log, distDir);
  if (!existsSync(join(distDir, "mkp.wasm"))) log.error("no mkp.wasm in dist/: run targets/rust/wasm/build.sh, then npm run build; no page will compile");
  log.info("alerts", { enabled: alerter.enabled ? "yes" : "no (DEVBENCH_NOTIFY_URL and DEVBENCH_NOTIFY_TOKEN not both set)" });

  async function failed(kind, text, fields) {
    log.error(text, fields);
    await alerter.send(kind, text);
  }

  /** A failure in the reader's browser: the compiler couldn't be loaded, or stopped on a page. */
  async function handleReport(req, res, id) {
    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_REPORT_BYTES));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "the body is not JSON");
    }
    const kind = typeof body?.kind === "string" && /^[a-z][a-z-]{0,39}$/.test(body.kind) ? body.kind : undefined;
    if (!kind || typeof body.message !== "string") throw new HttpError(400, "send {kind, message}: kind in lowercase words joined by -");
    const message = body.message.replace(/\s*\n\s*/g, " | ").slice(0, 600);
    const agent = typeof body.agent === "string" ? body.agent.slice(0, 160) : undefined;
    const bytes = Number.isInteger(body.bytes) ? body.bytes : undefined;
    const text = [`**MKP playground: ${kind}** in a reader's browser`, `- ${message.replace(/`/g, "'")}`, `- report ${id} on ${where}${bytes === undefined ? "" : `, page ${bytes} B`}${agent ? `, ${agent}` : ""}`].join("\n");
    await failed(`browser:${kind}`, text, { id, kind, error: message, bytes, agent });
    await send(req, res, 202, { ok: true });
  }

  async function handle(req, res) {
    const id = randomBytes(4).toString("hex");
    res.setHeader("x-request-id", id);
    const url = new URL(req.url ?? "/", "http://playground");
    const path = url.pathname;
    try {
      if (path === "/api/report") {
        if (req.method !== "POST") throw new HttpError(405, "POST a {kind, message} body");
        await handleReport(req, res, id);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "only GET here");
      if (path === "/healthz") {
        const missing = ["app.js", "compiler.worker.js", "mkp.wasm"].filter((f) => !existsSync(join(distDir, f)));
        const ok = !missing.length;
        await send(req, res, ok ? 200 : 503, ok ? { ok: true, service: SERVICE } : { ok: false, service: SERVICE, error: `dist/ has no ${missing.join(", ")}: run npm run build` });
        return;
      }
      if (path === "/api/examples") {
        const examples = await listExamples(examplesDir);
        const files = Object.fromEntries(await Promise.all(Object.entries(PACKS).map(async ([name, dir]) => [name, await packFiles(name, dir)])));
        await send(req, res, 200, { examples, packs: Object.keys(PACKS), packFiles: files });
        return;
      }
      const page = PAGES[path];
      const name = page ? undefined : DIST_NAME.exec(path)?.[1];
      if (page || name) {
        const file = page ? join(here, page) : join(distDir, name);
        const found = await files.get(file);
        if (!found) {
          const bundle = ["/app.js", "/app.css", "/editor.worker.js", "/compiler.worker.js", "/mkp.wasm"].includes(path);
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
