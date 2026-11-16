// The MKP playground: edit a page on the left, see it drawn on the right, and under it its
// Markdown, its diagnostics and its `$state`, all live.

import "./style.css";
import { Num, Page, type Broken, type Outcome, type ir } from "@mkp/runtime";
import { mount } from "@mkp/dom";
import { Editor, type Diagnostic } from "./editor.js";
import { escapeHtml, proseLines } from "./highlight.js";
import { clockExterns, targetFns, themeNow, widthOf } from "./host.js";
import { plainCases, shapeError, stateDecl, typeSignature, typeText, valueHtml, valueText } from "./values.js";

type Mounted = ReturnType<typeof mount>;

interface Example {
  id: string;
  title: string;
  description: string;
  packs: string[];
  source: string;
}

interface CompileResult {
  diagnostics: Diagnostic[];
  ir: ir.File | null;
  markdown: string | null;
  ms?: number;
  error?: string;
}

const DEBOUNCE_MS = 300;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}`);
  return found as T;
}

function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Text with `code` in backticks, as the compiler writes its messages. */
function messageHtml(text: string): string {
  return text
    .split("`")
    .map((part, k) => (k % 2 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part)))
    .join("");
}

// ---- the page's elements

const picker = el<HTMLSelectElement>("example-picker");
const status = el<HTMLButtonElement>("status");
const statusText = status.querySelector<HTMLElement>(".status-text")!;
const previewPane = el("preview-pane");
const previewScroll = el("preview-scroll");
const preview = el("preview");
const staleBanner = el("stale-banner");
const staleText = staleBanner.querySelector<HTMLElement>(".stale-text")!;
const notice = el("notice");
const viewBadge = el("view-badge");
const mdOut = el("markdown-output");
const mdMode = el("markdown-mode");
const diagList = el("diagnostics-list");
const diagCount = el("diagnostics-count");
const stateBody = el("state-body");
const exampleNote = el("example-note");

const editor = new Editor(el("editor"), {
  change: () => scheduleCompile(),
  run: () => void compileNow(),
});

/** What the playground holds, read only, for the tests and the video's take. */
declare global {
  interface Window {
    playground: {
      source(): string;
      caret(): { line: number; col: number } | null;
      hasFocus(): boolean;
      visibleLines(): { first: number; last: number };
      markers(): ReturnType<Editor["markers"]>;
      tokens(line: number): ReturnType<Editor["tokens"]>;
      language(): string;
      /** Selects the first place `text` is: a test's way to point at something before typing. */
      select(text: string): boolean;
    };
  }
}

window.playground = {
  source: () => editor.value,
  caret: () => {
    const p = editor.view.getPosition();
    return p ? { line: p.lineNumber, col: p.column } : null;
  },
  hasFocus: () => editor.view.hasTextFocus(),
  visibleLines: () => {
    const r = editor.view.getVisibleRanges();
    return { first: r[0]?.startLineNumber ?? 0, last: r[r.length - 1]?.endLineNumber ?? 0 };
  },
  markers: () => editor.markers(),
  tokens: (line) => editor.tokens(line),
  language: () => editor.model.getLanguageId(),
  select: (text) => {
    const [found] = editor.model.findMatches(text, false, false, true, null, false, 1);
    if (!found) return false;
    editor.view.setSelection(found.range);
    editor.view.revealRangeInCenterIfOutsideViewport(found.range);
    editor.focus();
    return true;
  },
};

// ---- what the playground holds

let examples: Example[] = [];
let knownPacks: string[] = [];
let mounted: Mounted | undefined;
let currentIr: ir.File | undefined;
let width = widthOf(preview.clientWidth || 800);
let theme = themeNow();
let compileTimer: ReturnType<typeof setTimeout> | undefined;
let compileSeq = 0;
let inflight: AbortController | undefined;
let lastMarkdown = "";
let compiledMarkdown: string | null = null;
let markdownView: "live" | "compiled" = "live";
let errorsLogged = 0;
/** Stops the live view following the page drawn now. */
let unfollow: (() => void) | undefined;

// ---- status

type StatusKind = "loading" | "pending" | "compiling" | "ok" | "warnings" | "errors" | "error";

function setStatus(kind: StatusKind, text: string, title = ""): void {
  status.dataset.state = kind;
  statusText.textContent = text;
  status.title = title || text;
}

function setStale(stale: boolean, text = ""): void {
  previewPane.dataset.stale = String(stale);
  staleBanner.hidden = !stale;
  staleText.textContent = text;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** A line over the page: a refused write, or a failure while it ran. */
function showNotice(kind: "refused" | "failure" | "info", html: string): void {
  notice.dataset.kind = kind;
  notice.querySelector(".notice-text")!.innerHTML = html;
  notice.hidden = false;
  notice.classList.remove("pop");
  void notice.offsetWidth;
  notice.classList.add("pop");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.hidden = true), 7000);
}
notice.querySelector(".notice-close")!.addEventListener("click", () => (notice.hidden = true));

function brokenHtml(b: Broken): string {
  if (b.rule) return escapeHtml(b.rule);
  const where = b.site ? ` <span class="muted">at ${escapeHtml(b.site)}</span>` : "";
  if (b.code === "contracts.outside") return `the value is outside its type${where}`;
  return `<code>${escapeHtml(b.code ?? "failure")}</code>${where}`;
}

/** Refused writes and failures since the last look: shown over the page, and in the console. */
function drainOutcome(o: Outcome = mounted ? mounted.page.takeOutcome() : { refused: [], failures: [] }): Outcome {
  if (o.refused.length) showNotice("refused", `<strong>Refused:</strong> ${o.refused.map(brokenHtml).join("; ")}`);
  else if (o.failures.length) showNotice("failure", `<strong>Failed:</strong> ${o.failures.map(brokenHtml).join("; ")}`);
  if (o.refused.length || o.failures.length) console.info("[playground] outcome", o);
  return o;
}

// ---- compiling

function packsFor(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/^\s*import\s+([a-z_][a-z0-9_]*)\b/gm)) if (knownPacks.includes(m[1])) found.add(m[1]);
  return [...found];
}

function scheduleCompile(): void {
  clearTimeout(compileTimer);
  if (status.dataset.state !== "compiling") setStatus("pending", "Editing…");
  compileTimer = setTimeout(() => void compileNow(), DEBOUNCE_MS);
}

async function compileNow(opts: { fresh?: boolean } = {}): Promise<void> {
  clearTimeout(compileTimer);
  const source = editor.value;
  const seq = ++compileSeq;
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  setStatus("compiling", "Compiling…");
  let result: CompileResult;
  try {
    const res = await fetch("/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, packs: packsFor(source) }),
      signal: ctl.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Partial<CompileResult>;
    if (seq !== compileSeq) return;
    if (!res.ok) {
      serverFailed(body.error ?? `The server answered ${res.status}.`, source);
      return;
    }
    result = body as CompileResult;
  } catch (e) {
    if ((e as Error).name === "AbortError" || seq !== compileSeq) return;
    serverFailed("The playground's server can't be reached.", source);
    return;
  }
  applyResult(result, source, opts.fresh ?? false);
}

function serverFailed(message: string, source: string): void {
  setStatus("error", "Server error", message);
  editor.setDiagnostics([], source);
  renderDiagnostics([], message);
  if (mounted) setStale(true, "The server could not compile this version: the page is the last one that did.");
  else showEmpty("The compiler did not answer", message);
}

function applyResult(result: CompileResult, source: string, fresh: boolean): void {
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = result.diagnostics.length - errors;
  editor.setDiagnostics(result.diagnostics, source);
  renderDiagnostics(result.diagnostics);
  const took = result.ms ? ` in ${result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} s`}` : "";
  if (errors || !result.ir) {
    setStatus("errors", errors ? plural(errors, "error") + (warnings ? ` · ${plural(warnings, "warning")}` : "") : "Nothing to draw");
    if (mounted) setStale(true, `Showing the last page that compiled. Fix ${errors === 1 ? "the error" : `the ${errors} errors`} to update it.`);
    else showEmpty("This page has errors", "Fix them, and the page is drawn here.");
    return;
  }
  compiledMarkdown = result.markdown;
  const ran = showPage(result.ir, fresh);
  if (!ran.ok) {
    setStatus("error", "Runtime error", ran.error);
    setStale(Boolean(mounted), `This version compiled but could not run: ${ran.error}`);
    if (!mounted) showEmpty("The page could not run", ran.error);
    return;
  }
  setStale(false);
  setStatus(warnings ? "warnings" : "ok", warnings ? `Compiled · ${plural(warnings, "warning")}` : "Compiled", `Compiled${took}`);
  if (markdownView === "compiled") renderMarkdown();
}

// ---- the page

function makePage(file: ir.File, state: Record<string, ir.Expr>): Page {
  let page: Page | undefined;
  page = new Page(file, {
    state,
    page: { width, theme },
    externs: clockExterns(),
    fns: targetFns(() => page!),
  });
  return page;
}

/** The old page's `$state` values whose fields the new page still has, with the same type. */
function carriedState(file: ir.File): Record<string, ir.Expr> {
  if (!mounted || !currentIr) return {};
  const before = stateDecl(currentIr);
  const after = stateDecl(file);
  if (!before || !after) return {};
  const values = mounted.page.observeState();
  const out: Record<string, ir.Expr> = {};
  for (const f of after.fields) {
    const was = before.fields.find((o) => o.name === f.name);
    if (!was || !(f.name in values)) continue;
    if (typeSignature(currentIr, was.type) !== typeSignature(file, f.type)) continue;
    out[f.name] = values[f.name];
  }
  return out;
}

/** The new page, with the old `$state` where it still fits; its first outcome kept to show. */
function startPage(file: ir.File, fresh: boolean): { page: Page; outcome: Outcome; kept: string[] } {
  const carried = fresh ? {} : carriedState(file);
  const fields = stateDecl(file)?.fields ?? [];
  if (Object.keys(carried).length) {
    try {
      let page = makePage(file, carried);
      // a value outside the field's new contract goes back to its default
      const outside = Object.keys(carried).filter((k) => {
        const f = fields.find((x) => x.name === k);
        const v = page.stateValue(k);
        return !f || !v || !page.machine.fits(v, f.type);
      });
      if (outside.length) {
        for (const k of outside) delete carried[k];
        page = makePage(file, carried);
      }
      const outcome = page.takeOutcome();
      // ... and so do all of them when together they break one of $state's rules
      page.set({});
      const check = page.takeOutcome();
      if (!check.refused.length) return { page, outcome, kept: Object.keys(carried) };
    } catch (e) {
      console.warn("[playground] the kept $state did not fit the new page; starting from its defaults", e);
    }
  }
  const page = makePage(file, {});
  return { page, outcome: page.takeOutcome(), kept: [] };
}

function showEmpty(title: string, text: string): void {
  unfollow?.();
  mounted?.unmount();
  mounted = undefined;
  currentIr = undefined;
  preview.innerHTML = `<div class="empty"><div class="empty-title">${escapeHtml(title)}</div><div class="empty-text">${escapeHtml(text)}</div></div>`;
  stateView.clear();
  lastMarkdown = "";
  mdOut.innerHTML = "";
}

function showPage(file: ir.File, fresh: boolean): { ok: true } | { ok: false; error: string } {
  let started: ReturnType<typeof startPage>;
  try {
    started = startPage(file, fresh);
  } catch (e) {
    console.error("[playground] the page could not start", e);
    return { ok: false, error: (e as Error).message ?? String(e) };
  }
  const { page, outcome } = started;
  const scroll = previewScroll.scrollTop;
  unfollow?.();
  unfollow = undefined;
  mounted?.unmount();
  mounted = undefined;
  const root = document.createElement("div");
  root.className = "page-root";
  root.id = "page-root";
  preview.replaceChildren(root);
  try {
    mounted = mount(page, root, {});
  } catch (e) {
    console.error("[playground] the page could not be drawn", e);
    currentIr = undefined;
    return { ok: false, error: (e as Error).message ?? String(e) };
  }
  currentIr = file;
  errorsLogged = 0;
  unfollow = page.onChange(liveChanged);
  previewScroll.scrollTop = scroll;
  stateView.rebuild(file);
  // the Markdown before stays, so the lines this version changed flash
  renderLive();
  drainOutcome(outcome);
  return { ok: true };
}

// every change to the page, from the reader or the app, redraws these once

let liveQueued = false;
function liveChanged(): void {
  if (liveQueued) return;
  liveQueued = true;
  queueMicrotask(() => {
    liveQueued = false;
    renderLive();
    drainOutcome();
  });
}

function renderLive(): void {
  if (!mounted) return;
  const page = mounted.page;
  if (markdownView === "live") renderMarkdown();
  stateView.update(page.observeState());
  for (; errorsLogged < page.errors.length; errorsLogged++) console.warn("[playground] the page caught", page.errors[errorsLogged]);
}

// keep the page told where it is read

new ResizeObserver(() => {
  const w = widthOf(preview.clientWidth);
  if (w !== width) {
    width = w;
    mounted?.page.setPage({ width });
  }
  viewBadge.textContent = `${width.toLowerCase()} · ${theme.toLowerCase()}`;
}).observe(preview);

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  theme = themeNow();
  mounted?.page.setPage({ theme });
  viewBadge.textContent = `${width.toLowerCase()} · ${theme.toLowerCase()}`;
});

// ---- Markdown

function renderMarkdown(): void {
  const md = markdownView === "live" ? (mounted?.page.markdown() ?? "") : (compiledMarkdown ?? "");
  if (md === lastMarkdown && mdOut.childElementCount) return;
  // lines that are new since the last time flash, so a press in the page shows what it changed
  const before = new Map<string, number>();
  if (lastMarkdown) for (const l of lastMarkdown.split("\n")) before.set(l, (before.get(l) ?? 0) + 1);
  const flash = lastMarkdown !== "";
  const lines = md.replace(/\n$/, "").split("\n");
  const html = proseLines(lines);
  mdOut.innerHTML = lines
    .map((l, k) => {
      const n = before.get(l) ?? 0;
      if (n > 0) before.set(l, n - 1);
      const changed = flash && n === 0 && l.trim() !== "";
      // the newline inside the line, so the text reads (and copies) as the Markdown it is
      return `<span class="md-line${changed ? " changed" : ""}">${html[k]}\n</span>`;
    })
    .join("");
  lastMarkdown = md;
}

for (const b of mdMode.querySelectorAll<HTMLButtonElement>("button[data-mode]")) {
  b.addEventListener("click", () => {
    markdownView = b.dataset.mode === "compiled" ? "compiled" : "live";
    for (const o of mdMode.querySelectorAll("button")) o.setAttribute("aria-pressed", String(o === b));
    lastMarkdown = "";
    renderMarkdown();
  });
}

el("markdown-copy").addEventListener("click", async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
});

// ---- diagnostics

function renderDiagnostics(list: Diagnostic[], serverError?: string): void {
  const errors = list.filter((d) => d.severity === "error").length;
  diagCount.textContent = list.length ? String(list.length) : "";
  diagCount.dataset.kind = errors ? "error" : list.length ? "warning" : "";
  if (serverError) {
    diagList.innerHTML = `<div class="empty small"><div class="empty-title">The compiler did not answer</div><div class="empty-text">${escapeHtml(serverError)}</div></div>`;
    return;
  }
  if (!list.length) {
    diagList.innerHTML = `<div class="empty small ok"><div class="empty-title">No problems</div><div class="empty-text">The page compiled with no errors or warnings.</div></div>`;
    return;
  }
  const sorted = [...list].sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.line - b.line || a.col - b.col);
  diagList.innerHTML = `<ul class="diag-list">${sorted
    .map((d) => {
      const sev = d.severity === "error" ? "error" : "warning";
      const where = d.file ? `${escapeHtml(d.file)}:${d.line}:${d.col}` : `${d.line}:${d.col}`;
      return (
        `<li><button type="button" class="diag" data-testid="diagnostic" data-severity="${sev}" data-line="${d.line}" data-col="${d.col}"${d.file ? " disabled" : ""}>` +
        `<span class="sev ${sev}" aria-label="${sev}"></span><span class="loc">${where}</span> ` +
        `<span class="msg">${messageHtml(d.message)}</span> <span class="code">${escapeHtml(d.code)}</span></button></li>`
      );
    })
    .join("")}</ul>`;
}

diagList.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("button.diag");
  if (!b || b.disabled) return;
  editor.goTo(Number(b.dataset.line), Number(b.dataset.col));
});

// ---- $state

class StateView {
  private file: ir.File | undefined;
  private shown = new Map<string, string>();

  clear(): void {
    this.file = undefined;
    this.shown.clear();
    stateBody.innerHTML = "";
  }

  /** Rows for the page's fields: a name, a type, and a way to change the value. */
  rebuild(file: ir.File): void {
    this.file = file;
    this.shown.clear();
    const decl = stateDecl(file);
    if (!decl || !decl.fields.length) {
      stateBody.innerHTML = `<div class="empty small"><div class="empty-title">No <code>$state</code></div><div class="empty-text">Declare it above the <code>@@@</code> line, for example <code>$state { count: int = 0; }</code>, and it shows here.</div></div>`;
      return;
    }
    const rules = decl.requires.map((r) => `<li>${escapeHtml(r.message)}</li>`).join("");
    stateBody.innerHTML =
      decl.fields.map((f) => this.rowHtml(f)).join("") + (rules ? `<div class="state-rules"><div class="state-rules-title">Rules</div><ul>${rules}</ul></div>` : "");
    for (const row of stateBody.querySelectorAll<HTMLElement>(".state-row")) this.wire(row, decl.fields.find((f) => f.name === row.dataset.field)!);
  }

  private kind(f: ir.Field): "int" | "number" | "text" | "bool" | "enum" | "other" {
    switch (f.type.name) {
      case "core/int":
        return "int";
      case "core/number":
        return "number";
      case "core/text":
        return "text";
      case "core/bool":
        return "bool";
    }
    return this.file && plainCases(this.file, f.type.name) ? "enum" : "other";
  }

  private rowHtml(f: ir.Field): string {
    const kind = this.kind(f);
    const id = `state-${f.name}`;
    let control = "";
    if (kind === "int" || kind === "number") {
      control = `<div class="num-control">
        <button type="button" class="step" data-step="-1" aria-label="${escapeHtml(f.name)} minus one">−</button>
        <input id="${id}" class="value-input" type="text" inputmode="decimal" spellcheck="false" autocomplete="off">
        <button type="button" class="step" data-step="1" aria-label="${escapeHtml(f.name)} plus one">+</button>
      </div>`;
    } else if (kind === "text") {
      control = `<input id="${id}" class="value-input text" type="text" spellcheck="false" autocomplete="off">`;
    } else if (kind === "bool") {
      control = `<label class="switch"><input id="${id}" type="checkbox" role="switch"><span class="track"></span><span class="switch-text"></span></label>`;
    } else if (kind === "enum") {
      const cases = plainCases(this.file!, f.type.name)!;
      control = `<select id="${id}" class="value-select">${cases.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>`;
    } else {
      control = `<pre class="value" id="${id}"></pre>
        <div class="json-edit" hidden>
          <textarea class="json-input" spellcheck="false" aria-label="${escapeHtml(f.name)} as IR JSON"></textarea>
          <div class="json-actions"><button type="button" class="btn primary json-apply">Apply</button><button type="button" class="btn json-cancel">Cancel</button><span class="hint">The value in the IR's JSON form</span></div>
        </div>
        <button type="button" class="btn small json-open">Edit</button>`;
    }
    return `<div class="state-row" data-field="${escapeHtml(f.name)}" data-kind="${kind}" data-testid="state-${escapeHtml(f.name)}">
      <label class="state-head" for="${id}"><span class="state-name">${escapeHtml(f.name)}</span><span class="state-type">${escapeHtml(typeText(f.type))}</span></label>
      <div class="state-value">${control}</div>
      <div class="state-msg" role="alert" hidden></div>
    </div>`;
  }

  private wire(row: HTMLElement, f: ir.Field): void {
    const kind = row.dataset.kind;
    const msg = row.querySelector<HTMLElement>(".state-msg")!;
    const commit = (x: ir.Expr | string): boolean => {
      const refusal = typeof x === "string" ? x : this.apply(f, x);
      msg.hidden = !refusal;
      msg.innerHTML = refusal ?? "";
      row.classList.toggle("refused", Boolean(refusal));
      if (refusal) this.update(mounted?.page.observeState() ?? {}, true);
      return !refusal;
    };
    if (kind === "int" || kind === "number") {
      const input = row.querySelector<HTMLInputElement>("input")!;
      const parse = (s: string): ir.Expr | string => {
        const t = s.trim().replace(/_/g, "");
        const n = Num.parse(t);
        if (!n) return `<strong>Not a number:</strong> <code>${escapeHtml(s)}</code>`;
        if (kind === "int" && !/^-?\d+$/.test(t)) return `<strong>Not a whole number:</strong> <code>${escapeHtml(s)}</code>`;
        return { num: t };
      };
      input.addEventListener("change", () => commit(parse(input.value)));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          input.value = this.shown.get(f.name) ?? input.value;
          input.blur();
        }
      });
      for (const b of row.querySelectorAll<HTMLButtonElement>("button.step")) {
        b.addEventListener("click", () => {
          const now = mounted?.page.observeState()[f.name];
          const n = now && "num" in now ? Num.parse(now.num) : null;
          if (!n) return;
          commit({ num: n.add(Num.int(Number(b.dataset.step))).show() });
        });
      }
    } else if (kind === "text") {
      const input = row.querySelector<HTMLInputElement>("input")!;
      input.addEventListener("change", () => commit({ text: input.value }));
    } else if (kind === "bool") {
      const input = row.querySelector<HTMLInputElement>("input")!;
      input.addEventListener("change", () => commit({ bool: input.checked }));
    } else if (kind === "enum") {
      const select = row.querySelector<HTMLSelectElement>("select")!;
      select.addEventListener("change", () => commit({ case: { enum: f.type.name, name: select.value } }));
    } else {
      const open = row.querySelector<HTMLButtonElement>(".json-open")!;
      const box = row.querySelector<HTMLElement>(".json-edit")!;
      const area = row.querySelector<HTMLTextAreaElement>(".json-input")!;
      const close = () => {
        box.hidden = true;
        open.hidden = false;
        row.classList.remove("editing");
      };
      open.addEventListener("click", () => {
        const now = mounted?.page.observeState()[f.name];
        area.value = JSON.stringify(now ?? null, null, 2);
        box.hidden = false;
        open.hidden = true;
        row.classList.add("editing");
        area.focus();
      });
      row.querySelector(".json-cancel")!.addEventListener("click", () => {
        close();
        msg.hidden = true;
      });
      row.querySelector(".json-apply")!.addEventListener("click", () => {
        let x: ir.Expr;
        try {
          x = JSON.parse(area.value);
        } catch (e) {
          commit(`<strong>Not JSON:</strong> ${escapeHtml((e as Error).message)}`);
          return;
        }
        if (commit(x)) close();
      });
    }
  }

  /** An app write to `$state`: checked by the page, and refused with the rule it would break. */
  private apply(f: ir.Field, x: ir.Expr): string | undefined {
    const page = mounted?.page;
    if (!page || !this.file) return "There is no page running.";
    // Page.set checks contracts, not shapes: a list given a number would break the page
    const wrong = shapeError(x, f.type, this.file);
    if (wrong) return `<strong>Refused:</strong> ${messageHtml(wrong)}`;
    let value;
    try {
      value = page.value(x);
    } catch (e) {
      return `<strong>Not a value:</strong> ${escapeHtml((e as Error).message)}`;
    }
    page.set({ [f.name]: value });
    const o = page.takeOutcome();
    if (o.refused.length) {
      drainOutcome(o);
      const r = o.refused[0];
      return r.rule ? `<strong>Refused by a rule:</strong> ${escapeHtml(r.rule)}` : `<strong>Refused:</strong> <code>${escapeHtml(valueText(x))}</code> is outside <code>${escapeHtml(typeText(f.type))}</code>`;
    }
    if (o.failures.length) drainOutcome(o);
    return undefined;
  }

  /** The values now; the ones that changed since the last time flash. */
  update(values: Record<string, ir.Expr>, force = false): void {
    for (const row of stateBody.querySelectorAll<HTMLElement>(".state-row")) {
      const name = row.dataset.field!;
      const x = values[name];
      if (!x) continue;
      const key = JSON.stringify(x);
      const before = this.shown.get(name + "\u0000json");
      if (before === key && !force) continue;
      this.shown.set(name + "\u0000json", key);
      this.shown.set(name, "num" in x ? x.num : "text" in x ? x.text : valueText(x, this.file));
      const kind = row.dataset.kind;
      const input = row.querySelector<HTMLInputElement>("input.value-input");
      if (input && (document.activeElement !== input || force)) input.value = this.shown.get(name)!;
      if (kind === "bool") {
        const box = row.querySelector<HTMLInputElement>("input[type=checkbox]")!;
        box.checked = "bool" in x && x.bool;
        row.querySelector(".switch-text")!.textContent = String(box.checked);
      }
      if (kind === "enum" && "case" in x) row.querySelector<HTMLSelectElement>("select")!.value = x.case.name;
      if (kind === "other") row.querySelector<HTMLElement>("pre.value")!.innerHTML = valueHtml(x, this.file);
      if (before !== undefined && before !== key) {
        row.classList.remove("changed");
        void row.offsetWidth;
        row.classList.add("changed");
      }
    }
  }
}

const stateView = new StateView();

el("state-reset").addEventListener("click", () => {
  if (!currentIr) return;
  const file = currentIr;
  for (const m of stateBody.querySelectorAll<HTMLElement>(".state-msg")) m.hidden = true;
  const ran = showPage(file, true);
  if (ran.ok) showNotice("info", "<code>$state</code> is back to its starting values.");
});

// ---- tabs

const tabs = [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")];

function selectTab(tab: HTMLButtonElement, focus = false): void {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    el(t.getAttribute("aria-controls")!).hidden = !on;
  }
  if (focus) tab.focus();
}

for (const t of tabs) {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    const k = tabs.indexOf(t);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      selectTab(tabs[(k + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length], true);
    }
  });
}

status.addEventListener("click", () => selectTab(el<HTMLButtonElement>("tab-diagnostics")));
staleBanner.querySelector("button")!.addEventListener("click", () => selectTab(el<HTMLButtonElement>("tab-diagnostics")));

// ---- examples

function loadExample(id: string): void {
  const ex = examples.find((e) => e.id === id) ?? examples[0];
  if (!ex) return;
  picker.value = ex.id;
  exampleNote.textContent = ex.description;
  notice.hidden = true;
  editor.value = ex.source;
  const url = new URL(location.href);
  url.searchParams.set("example", ex.id);
  history.replaceState(null, "", url);
  unfollow?.();
  unfollow = undefined;
  mounted?.unmount();
  mounted = undefined;
  currentIr = undefined;
  stateView.clear();
  lastMarkdown = "";
  mdOut.innerHTML = "";
  setStale(false);
  preview.innerHTML = `<div class="empty loading"><div class="spinner"></div><div class="empty-text">Compiling ${escapeHtml(ex.title)}…</div></div>`;
  void compileNow({ fresh: true });
}

picker.addEventListener("change", () => loadExample(picker.value));

// The name in the bar starts again, visibly: the first example as written, with its $state as it
// first was, and a note saying so. A plain link to "/" only reloaded the page, which on a fresh
// page changes nothing a reader can see. A new tab or window still opens the start as a link.
el<HTMLAnchorElement>("brand").addEventListener("click", (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const first = examples[0];
  if (!first) return;
  loadExample(first.id);
  showNotice("info", `Started again with <strong>${escapeHtml(first.title)}</strong>: its source and its <code>$state</code> as they first were.`);
});

async function init(): Promise<void> {
  setStatus("loading", "Loading…");
  try {
    const res = await fetch("/api/examples");
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    const body = (await res.json()) as { examples: Example[]; packs: string[] };
    examples = body.examples;
    knownPacks = body.packs;
  } catch (e) {
    setStatus("error", "Server error", `The examples could not be loaded: ${(e as Error).message}`);
    return;
  }
  picker.innerHTML = examples.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title)}</option>`).join("");
  const wanted = new URLSearchParams(location.search).get("example") ?? examples[0]?.id ?? "";
  loadExample(wanted);
}

void init();
