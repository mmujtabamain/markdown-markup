// Making a page from the app's props, with no DOM: shared by the bindings and by html.ts, which
// a server runs.

import { Page, type Outcome, type PageOptions, type Value, type ir } from "@extended-mark/runtime";

/** A page's IR: the file `xtmd build` writes, as `import page from "./x.xtmd"` gives it. */
export type Ir = ir.File | ir.Module;

/** A value the app gives: in the IR's form (`{ "num": "3" }`), or a runtime value. */
export type Given = ir.Expr | Value;

export const empty = (): Outcome => ({ refused: [], failures: [] });

/** Whether a value the app gave is already a runtime value rather than one in the IR's form. */
export function isValue(x: Given): x is Value {
  return typeof x === "object" && x !== null && "kind" in x;
}

/** `$state`'s fields in a module, by name. */
export function stateFields(module: ir.Module): Map<string, ir.Type> {
  const out = new Map<string, ir.Type>();
  for (const d of module.declarations) {
    const decl = d.declare as Record<string, unknown>;
    if ("$state" in decl) for (const f of (decl["$state"] as ir.State).fields) out.set(f.name, f.type);
  }
  return out;
}

/** A channel's full name: `app` is the document's own `doc/app`, as `extern app` and `expose app`
 * declare it; a name with a module (`doc/app`, `core/page`) is kept as it is. */
export function channelName(module: ir.Module, name: string): string {
  if (name.includes("/")) return name;
  const full = `${module.module}/${name}`;
  for (const d of module.declarations) {
    const decl = d.declare as Record<string, unknown>;
    if ("expose" in decl && (decl.expose as ir.Expose).channel === full) return full;
    if ("extern" in decl) {
      const x = decl.extern as Record<string, unknown>;
      if ("channel" in x && (x.channel as ir.ExternChannel).name === full) return full;
    }
  }
  return name;
}

/** Each channel's values with its full name. */
export function channelsOf(module: ir.Module, given: Record<string, Record<string, ir.Expr>> | undefined): Record<string, Record<string, ir.Expr>> {
  const out: Record<string, Record<string, ir.Expr>> = {};
  for (const [c, v] of Object.entries(given ?? {})) {
    const full = channelName(module, c);
    out[full] = { ...out[full], ...v };
  }
  return out;
}

export function moduleOf(irFile: Ir): ir.Module {
  return "ir" in irFile ? irFile.ir : irFile;
}

/**
 * A page made from its IR with `$state` given by the app, checked as an app's write is (page 6,
 * "Keeping things"): a field the page doesn't have, or a value that doesn't fit, keeps its
 * starting value, and so does a field whose value breaks a `require` that the others keep. What
 * was refused is in the outcome. The page is made with the values that passed, so every widget
 * starts from them.
 */
export function makePage(irFile: Ir, options: Omit<PageOptions, "state">, given?: Record<string, ir.Expr>, report = true): { page: Page; outcome: Outcome } {
  const opts = { ...options, externs: channelsOf(moduleOf(irFile), options.externs) };
  const outcome = empty();
  if (!given || Object.keys(given).length === 0) return { page: new Page(irFile, opts), outcome };
  const probe = new Page(irFile, opts);
  const fields = stateFields(probe.module);
  const values: Record<string, Value> = {};
  for (const [k, x] of Object.entries(given)) {
    if (!fields.has(k)) {
      if (report) outcome.refused.push({ code: "contracts.outside", site: `$state.${k}` });
      continue;
    }
    try {
      values[k] = probe.value(x);
    } catch {
      outcome.refused.push({ code: "contracts.outside", site: `$state.${k}` });
    }
  }
  let kept = Object.keys(values);
  probe.set(values);
  if (probe.takeOutcome().refused.length) {
    // not all together: each field that fits, and keeps the rules, one at a time
    kept = [];
    for (const [k, v] of Object.entries(values)) {
      probe.set({ [k]: v });
      const o = probe.takeOutcome();
      if (o.refused.length) outcome.refused.push(...o.refused);
      else kept.push(k);
    }
  }
  const state = Object.fromEntries(kept.map((k) => [k, given[k]]));
  return { page: new Page(irFile, { ...opts, state }), outcome };
}

