#!/usr/bin/env node
// The test target's check adapter: `mkp target check` drives @mkp/runtime through it over
// JSON-RPC 2.0, one message per line on standard input and output (plan tab 16). Logs go to
// standard error only.
//
// The test target draws nothing. It lays widgets out with fixed sizes (sizes.mjs), so a check can
// say exactly which boxes a plane's spots must write, and MKP_TEST_DEFECT switches on defects, so
// each check is shown to catch a broken target.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Page, layout, regionOf, toIr } from "@mkp/runtime";
import { measure, targetFns } from "./sizes.mjs";
import { DEFECTS } from "./defects.mjs";


const defects = (process.env.MKP_TEST_DEFECT ?? "").split(",").filter(Boolean);
for (const d of defects) {
  if (!(d in DEFECTS)) {
    process.stderr.write(`test target: no defect ${d}; the defects are ${Object.keys(DEFECTS).join(", ")}\n`);
    process.exit(2);
  }
}

let page;

/** Lays the planes out after every change, as a screen would after drawing. */
function settle() {
  layout(page, measure(page));
}

function values(p, xs = []) {
  return xs.map((x) => p.value(x));
}

function record(p, o = {}) {
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, p.value(x)]));
}

/** Where each spot landed, by its path, as the observation reports it. */
function boxes(nodes, out = {}) {
  for (const n of nodes) {
    if (n.widget === "core/spot") {
      const r = regionOf(n.props.get("box"));
      if (r) out[n.path] = { from: { x: num(r.from.x), y: num(r.from.y) }, to: { x: num(r.to.x), y: num(r.to.y) } };
    }
    for (const kids of n.slots.values()) boxes(kids, out);
  }
  return out;
}

function num(n) {
  return toIr({ kind: "num", n });
}

const methods = {
  advertise() {
    return { name: "test", protocol: "1", levels: ["core.draw", "core.live", "core.gfx"], supplies: ["core/*", "core/can_draw_tex", "core/moment.local"] };
  },
  load({ ir, page: values = {}, state, externs }) {
    const file = JSON.parse(readFileSync(ir, "utf8"));
    page = new Page(file, { page: defects.includes("ignores-page") ? {} : values, state, externs, fns: targetFns(() => page), defects });
    settle();
    return {};
  },
  event({ site, name, args }) {
    page.event(site, name, values(page, args));
    settle();
    return {};
  },
  write({ site, input, value }) {
    page.write(site, input, page.value(value));
    settle();
    return {};
  },
  set(params) {
    page.set(record(page, params["$state"]));
    settle();
    return {};
  },
  expose({ channel, name, args }) {
    page.expose(channel, name, values(page, args));
    settle();
    return {};
  },
  extern({ channel, values: given }) {
    page.setExtern(channel, record(page, given));
    settle();
    return {};
  },
  page({ page: values }) {
    if (!defects.includes("ignores-page")) page.setPage(values);
    settle();
    return {};
  },
  observe() {
    const found = boxes(page.tree());
    const o = { tree: page.observeTree(), state: page.observeState(), calls: page.takeCalls(), outcome: page.takeOutcome(), markdown: page.markdown() };
    if (Object.keys(found).length) o.boxes = found;
    return o;
  },
  quit() {
    setImmediate(() => process.exit(0));
    return {};
  },
};

function reply(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    process.stderr.write(`test target: not JSON: ${line}\n`);
    return;
  }
  const run = methods[req.method];
  if (!run) return reply({ id: req.id, error: { code: -32601, message: `no method ${req.method}` } });
  if (req.method !== "advertise" && req.method !== "load" && req.method !== "quit" && !page) {
    return reply({ id: req.id, error: { code: -32000, message: "no page is loaded" } });
  }
  try {
    reply({ id: req.id, result: run(req.params ?? {}) });
  } catch (e) {
    process.stderr.write(`test target: ${req.method}: ${e?.stack ?? e}\n`);
    reply({ id: req.id, error: { code: -32000, message: String(e?.message ?? e) } });
  }
});
