// The page the omnicui adapter loads into Chromium for each mount: @mkp/runtime and @mkp/dom,
// bundled by esbuild, with `window.omnicui` for the adapter to call. It mounts one generated MKP
// page with @mkp/dom's `run`, as an app would, and records what the widget under test reports:
// each of its events (`page.event`) with its arguments as fields, and each write to one of its
// `mut` inputs (`page.write`, and the layout's writes, `page.layoutWrite`) as `write<Input>`.

import { Page, toIr } from "@mkp/runtime";
import { run } from "@mkp/dom";

/** What is recorded for the page mounted now: set by mount. */
let current;

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * A value as an event's fields, under a name: a number, a text, a bool or a case's name as it
 * is; an opt as its value, or null; a record's fields each under the name and the field's
 * (`at` → `atX`, `atY`; a region `value` → `valueFromX` …); a list or a range as JSON text.
 */
function fieldsOf(name, v, out) {
  switch (v?.kind) {
    case "num":
      out[name] = v.n.toNumber();
      break;
    case "text":
      out[name] = v.s;
      break;
    case "bool":
      out[name] = v.b;
      break;
    case "case":
      out[name] = v.name;
      for (const [f, x] of v.values ?? []) fieldsOf(name + cap(camel(f)), x, out);
      break;
    case "opt":
      if (v.value === null) out[name] = null;
      else fieldsOf(name, v.value, out);
      break;
    case "record":
      for (const [f, x] of v.fields) fieldsOf(name + cap(camel(f)), x, out);
      break;
    default:
      out[name] = v === undefined ? null : JSON.stringify(toIr(v));
  }
  return out;
}

/** The path of the widget under test: the first one of its kind, in the order it is drawn. */
function targetPath(page, widget) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.widget === widget) return n.path;
      for (const kids of n.slots.values()) {
        const p = walk(kids);
        if (p) return p;
      }
    }
    return undefined;
  };
  return walk(page.tree());
}

function drawnAt(page, path) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.path === path) return n;
      for (const kids of n.slots.values()) {
        const f = walk(kids);
        if (f) return f;
      }
    }
    return undefined;
  };
  return walk(page.tree());
}

function recorder(page) {
  if (!current || (current.page && current.page !== page)) return undefined;
  current.page = page;
  current.path ??= targetPath(page, current.report.widget);
  return current;
}

// Every page made here is the one mounted now, so the page's own methods are wrapped once, before
// @mkp/dom makes it: the writes its first layout makes while mounting are recorded too.
const original = { event: Page.prototype.event, write: Page.prototype.write, layoutWrite: Page.prototype.layoutWrite };
Page.prototype.event = function (path, name, args = []) {
  const r = recorder(this);
  const e = r && path === r.path ? r.report.events[name] : undefined;
  if (e) {
    const fields = {};
    e.params.forEach((p, k) => fieldsOf(camel(p), args[k], fields));
    r.events.push({ name: e.name, fields });
  }
  return original.event.call(this, path, name, args);
};
Page.prototype.write = function (path, input, value) {
  const r = recorder(this);
  const name = r && path === r.path ? r.report.writes[input] : undefined;
  if (name) r.events.push({ name, fields: fieldsOf("value", value, {}) });
  return original.write.call(this, path, input, value);
};
Page.prototype.layoutWrite = function (writes) {
  const r = recorder(this);
  for (const w of r ? writes : []) {
    const name = w.path === r.path ? r.report.writes[w.input] : undefined;
    if (!name) continue;
    // the layout writes every pass: only a change is a write a person could see
    const was = drawnAt(this, w.path)?.props.get(w.input);
    if (was && JSON.stringify(toIr(was)) === JSON.stringify(toIr(w.value))) continue;
    r.events.push({ name, fields: fieldsOf("value", w.value, {}) });
  }
  return original.layoutWrite.call(this, writes);
};

window.omnicui = {
  /** Mounts a page: its IR from the adapter's server, at the theme of the colour scheme asked for. */
  async mount({ ir, report, theme }) {
    const text = await (await fetch(ir)).text();
    current = { report, events: [], page: undefined, path: undefined };
    const root = document.getElementById("page");
    const mounted = run(text, root, { page: { theme } });
    current.page = mounted.page;
    current.path ??= targetPath(mounted.page, report.widget);
    window.mounted = mounted;
    if (!current.path) return `${report.widget} is not on the page`;
    return null;
  },
  /** The events since the last call, mount's own writes included; then forgets them. */
  events() {
    const out = current?.events ?? [];
    if (current) current.events = [];
    return out;
  },
  /** The site of the widget under test, for finding its element. */
  site() {
    return current?.path ?? null;
  },
  /** Failures the page caught since the last call, for the adapter's log. */
  errors() {
    const page = current?.page;
    if (!page) return [];
    const out = page.errors.map((e) => String(e?.stack ?? e));
    page.errors.length = 0;
    const o = page.takeOutcome();
    for (const r of [...o.refused, ...o.failures]) out.push(`refused or failed: ${JSON.stringify(r)}`);
    return out;
  },
};

// Busy while a shade is still working out its pixels: the adapter waits for it before replying.
window.omnicuiBusy = () => document.querySelector("[data-part='shade'][data-state='painting']") !== null;
