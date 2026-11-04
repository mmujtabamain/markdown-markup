// The expanded IR (spec 13): the document with every definition inlined down to base widgets and
// built-ins. Inputs are substituted and input-only conditions decided; each over input-only lists
// is unrolled; only reader state, compute and events remain. Runtimes render it like a bundle.

import type { A, IRBundle, IRExpr, IRNode, IRVal } from './ir';
import { compileAst, Env, Programme, toJson, V, withBudget, fromJson } from './eval';

class NotStatic extends Error {}

interface Ctx {
  /** literal input values of the instance being inlined (undefined: not known at build) */
  inputs: Map<string, unknown>;
  /** each variables bound to literal values */
  locals: Map<string, unknown>;
  depth: number;
}

function litAst(v: unknown): A {
  if (typeof v === 'number') return Number.isFinite(v) ? { t: 'num', v } : { t: 'builtin', fn: Number.isNaN(v) ? 'nan' : 'inf', args: [] };
  if (typeof v === 'boolean') return { t: 'bool', v };
  if (typeof v === 'string') return { t: 'str', v };
  if (Array.isArray(v)) return { t: 'list', items: v.map(litAst) };
  if (v && typeof v === 'object') return { t: 'rec', fields: Object.entries(v).map(([k, x]) => [k, litAst(x)]) };
  return { t: 'num', v: 0 };
}

export function expand(b: IRBundle): IRBundle {
  const prog = new Programme(b.fns, b.consts);
  const evalStatic = (a: A, ctx: Ctx): unknown => {
    const lookup = {
      get(name: string): V {
        if (ctx.inputs.has(name) && ctx.inputs.get(name) !== undefined) return fromJson(ctx.inputs.get(name));
        throw new NotStatic(name);
      },
    };
    const vars = Object.create(null) as Record<string, V>;
    for (const [k, v] of ctx.locals) vars[k] = fromJson(v);
    const env = new Env(vars, null, lookup, prog);
    return toJson(withBudget(1_000_000, 'expand', () => compileAst(a)(env)));
  };
  const tryStatic = (a: A, ctx: Ctx): { ok: true; v: unknown } | { ok: false } => {
    try {
      const v = evalStatic(a, ctx);
      if (typeof v === 'function' || v === '<fn>') return { ok: false };
      return { ok: true, v };
    } catch {
      return { ok: false };
    }
  };
  /** Replaces reads of literal inputs and each variables with their values. */
  const subst = (a: A, ctx: Ctx, bound: Set<string> = new Set()): A => {
    if (a.t === 'var' && a.from !== 'const' && !bound.has(a.name)) {
      if (a.from === 'inst' && ctx.inputs.get(a.name) !== undefined) return litAst(ctx.inputs.get(a.name));
      if (a.from === 'local' && ctx.locals.has(a.name)) return litAst(ctx.locals.get(a.name));
      return a;
    }
    if (a.t === 'lam') {
      const nb = new Set(bound);
      a.params.forEach((p) => nb.add(p));
      return { ...a, body: subst(a.body, ctx, nb) };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) {
      if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === 'object' && 't' in x ? subst(x as A, ctx, bound) : Array.isArray(x) ? x.map((y) => (y && typeof y === 'object' && 't' in y ? subst(y as A, ctx, bound) : y)) : x));
      else if (v && typeof v === 'object' && 't' in v) out[k] = subst(v as A, ctx, bound);
      else out[k] = v;
    }
    return out as A;
  };
  const expr = (e: IRExpr, ctx: Ctx): IRExpr => ({ ...e, ast: subst(e.ast, ctx) });
  const val = (v: IRVal, ctx: Ctx): IRVal => {
    if ('ast' in v && 'expr' in v) {
      const s = tryStatic(v.ast, ctx);
      if (s.ok && (v as IRExpr).type.t !== 'expr') return { lit: s.v };
      return expr(v as IRExpr, ctx);
    }
    if ('range' in v) return { range: [val(v.range[0], ctx), val(v.range[1], ctx)] };
    return v;
  };
  const literalOf = (v: IRVal | undefined, ctx: Ctx): unknown => {
    if (!v) return undefined;
    if ('lit' in v) return v.lit;
    if ('text' in v && !('ast' in v)) return (v as { text: string }).text;
    if ('tex' in v && !('ast' in v)) return (v as { tex: string }).tex;
    if ('tok' in v) return (v as { tok: string }).tok;
    if ('ms' in v) return (v as { ms: number }).ms;
    if ('ast' in v) {
      const s = tryStatic((v as IRExpr).ast, ctx);
      return s.ok ? s.v : undefined;
    }
    return undefined;
  };

  const nodes = (ns: IRNode[] | undefined, ctx: Ctx): IRNode[] => (ns ?? []).flatMap((n) => node(n, ctx));

  const node = (n: IRNode, ctx: Ctx): IRNode[] => {
    // input-only conditions are decided here
    let meta = n.meta;
    if (meta?.if) {
      const s = tryStatic(meta.if.ast, ctx);
      if (s.ok) {
        if (!s.v) return [];
        meta = { ...meta };
        delete meta.if;
      } else meta = { ...meta, if: expr(meta.if, ctx) };
    }
    const base: IRNode = { ...n };
    if (meta) base.meta = meta;
    if (meta?.id && typeof meta.id !== 'string') base.meta = { ...meta, id: expr(meta.id, ctx) };
    switch (n.node) {
      case 'each': {
        const lst = n.in && 'range' in n.in ? (() => {
          const a = literalOf(n.in.range[0], ctx);
          const z = literalOf(n.in.range[1], ctx);
          if (typeof a !== 'number' || typeof z !== 'number') return undefined;
          const out: number[] = [];
          for (let v = Math.ceil(a); v <= z && out.length <= 200; v++) out.push(v);
          return out;
        })() : literalOf(n.in, ctx);
        if (Array.isArray(lst) && lst.length <= 200) {
          // unrolled: an input-only list
          return lst.flatMap((item) => {
            const c2: Ctx = { ...ctx, locals: new Map(ctx.locals).set(n.var!, item) };
            return [...nodes(n.children, c2), ...nodes(n.records, c2)];
          });
        }
        const c2: Ctx = { ...ctx, locals: new Map(ctx.locals) };
        c2.locals.delete(n.var!);
        return [{ ...base, in: n.in ? val(n.in, ctx) : n.in, key: n.key ? expr(n.key, c2) : undefined, children: n.children ? nodes(n.children, c2) : undefined, records: n.records ? nodes(n.records, c2) : undefined }];
      }
      case 'switch': {
        const s = tryStatic(n.subject!.ast, ctx);
        if (s.ok) {
          for (const c of n.cases ?? []) if (JSON.stringify(literalOf(c.value, ctx)) === JSON.stringify(s.v)) return nodes(c.children, ctx);
          return nodes(n.else, ctx);
        }
        return [{ ...base, subject: expr(n.subject!, ctx), cases: (n.cases ?? []).map((c) => ({ value: c.value, children: nodes(c.children, ctx) })), else: n.else ? nodes(n.else, ctx) : undefined }];
      }
      case 'slot':
        return [{ ...base, value: expr(n.value!, ctx) }];
      case 'arrow':
        return [{ ...base, from: n.from ? val(n.from, ctx) : n.from, to: n.to ? val(n.to, ctx) : n.to }];
      case 'controls':
        return [base];
    }
    const props: Record<string, IRVal> = {};
    for (const [k, v] of Object.entries(n.props ?? {})) props[k] = val(v, ctx);
    const out: IRNode = { ...base, props };
    if (n.children) out.children = nodes(n.children, ctx);
    if (n.records) out.records = nodes(n.records, ctx);
    if (n.fills) out.fills = Object.fromEntries(Object.entries(n.fills).map(([k, v]) => [k, nodes(v, ctx)]));
    if (n.on) out.on = n.on;
    const def = n.def ? b.defs[n.def] : undefined;
    if (def && def.kind !== 'extern' && n.node !== '$record') {
      if (ctx.depth >= 12) return [out];
      const inputs = new Map<string, unknown>();
      for (const inp of def.inputs) {
        const given = n.props?.[inp.name];
        if (given && 'ref' in given) continue;
        inputs.set(inp.name, literalOf(given ? props[inp.name] : inp.default, given ? ctx : { inputs: new Map(), locals: new Map(), depth: 0 }));
      }
      const inner: Ctx = { inputs, locals: new Map(), depth: ctx.depth + 1 };
      out.inst = { def: def.id, inputs: props, view: nodes(def.view, inner) };
    }
    return [out];
  };

  const root: Ctx = { inputs: new Map(), locals: new Map(), depth: 0 };
  return { ...b, level: 'expanded', doc: { ...b.doc, body: nodes(b.doc.body, root) } };
}
