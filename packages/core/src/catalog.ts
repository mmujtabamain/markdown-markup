// The catalog an agent keeps in context (spec 12): one line per widget, and full signatures.

import type { Compiled } from './build';
import type { A, IRDef, IRNode } from './ir';
import { MkpPrinter, valSrc } from './print';
import { canonical } from './syntax/canon';
import { resolve, showType, Type, TypeEnv } from './types';

/**
 * A definition's source to copy into a document and edit (doc #1129 §3.3): renamed, with every
 * part, fn and type of its pack that it uses and the pack doesn't provide, so the copy compiles on
 * its own. The first line says where it came from; nothing links the copy to it.
 */
export function copySource(c: Compiled, d: IRDef, as: string): string {
  const pack = c.prog.packs.get(d.pack);
  const own = (name: string): boolean => !!pack && !pack.builtin && !pack.provides.has(name);
  const defs: IRDef[] = [];
  const seen = new Set<string>([d.id]);
  const fnIds = new Set<string>();
  const typeNames = new Set<string>();
  const visitAst = (a: unknown): void => {
    if (!a || typeof a !== 'object') return;
    if (Array.isArray(a)) return a.forEach(visitAst);
    const x = a as A & Record<string, unknown>;
    if ((x.t === 'call' || x.t === 'fnref') && typeof x.fn === 'string' && x.fn.startsWith(`${d.pack}:`)) {
      const base = x.fn.replace(/<.*$/, '');
      const f = c.prog.irFns[base] ?? c.prog.irFns[x.fn];
      if (f && own(f.name) && !fnIds.has(base)) {
        fnIds.add(base);
        visitAst(f.body);
        for (const t of [...(f.types ?? []), ...(f.ret ? [f.ret] : [])]) visitType(t);
      }
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object') visitAst(v);
  };
  const visitType = (t: Type): void => {
    switch (t.t) {
      case 'named':
        if (c.prog.types.has(`${d.pack}:${t.name}`) && own(t.name) && !typeNames.has(t.name)) {
          typeNames.add(t.name);
          visitType(c.prog.types.get(`${d.pack}:${t.name}`)!.type);
        }
        break;
      case 'list':
      case 'dict':
      case 'ref':
        visitType(t.of);
        break;
      case 'rec':
      case 'records':
        t.fields.forEach(([, f]) => visitType(f));
        break;
      case 'fn':
        t.params.forEach(visitType);
        visitType(t.ret);
        break;
      case 'expr':
        t.vars.forEach(([, v]) => visitType(v));
        visitType(t.ret);
        break;
      case 'path':
        visitType(t.of);
        visitType(t.to);
        break;
    }
  };
  const visitDef = (x: IRDef): void => {
    const nodes = (ns: IRNode[] | undefined): void => {
      for (const n of ns ?? []) {
        if (n.def && !seen.has(n.def)) {
          const u = c.defs.get(n.def);
          if (u && u.pack === d.pack && own(u.name)) {
            seen.add(n.def);
            defs.push(u);
            visitDef(u);
          }
        }
        nodes(n.children);
        nodes(n.records);
        for (const k of n.cases ?? []) nodes(k.children);
        nodes(n.else);
        for (const f of Object.values(n.fills ?? {})) nodes(f);
      }
    };
    nodes(x.view);
    visitAst(x);
    for (const i of x.inputs) visitType(i.type);
    for (const v of x.values ?? []) if ('type' in v && v.type) visitType(v.type);
  };
  visitDef(d);
  const rename = <T>(v: T): T => {
    if (Array.isArray(v)) return v.map(rename) as unknown as T;
    if (!v || typeof v !== 'object') return v;
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = k === 'node' && x === d.name ? as : rename(x);
    return o as T;
  };
  const env = c.prog.typeEnv(d.pack);
  const printer = new MkpPrinter({ defs: Object.fromEntries(c.defs), env });
  const out: string[] = [`# from ${d.pack}:${d.name}@${d.version} ${d.digest ?? ''}`.trimEnd()];
  out.push(printer.def({ ...rename(d), name: as, inline: true, comment: undefined }));
  for (const x of defs) out.push(printer.def({ ...x, inline: true }));
  for (const id of fnIds) {
    const f = c.prog.irFns[id];
    const params = f.params.map((p, i) => `${p}: ${showType(f.types?.[i] ?? { t: 'num' })}`).join(', ');
    out.push(`fn ${f.name}(${params})${f.ret ? ': ' + showType(f.ret) : ''} = ${canonical(f.src)}`);
  }
  for (const n of typeNames) out.push(`type ${n} = ${showType({ ...c.prog.types.get(`${d.pack}:${n}`)!.type, name: undefined } as Type)}`);
  return out.join('\n\n') + '\n';
}

/** roots@1(n: int 2..12 = 5, level: choice(intro|exam) = intro, labels: bool = true) — The n-th roots … */
export function indexLine(d: IRDef, env: TypeEnv): string {
  const args = d.inputs.map((i) => `${i.name}: ${showType(i.type)}${i.default ? ` = ${valSrc(i.default, resolve(i.type, env))}` : ''}`);
  const req = d.requires?.length ? ` [requires ${d.requires.join(', ')}]` : '';
  const kind = d.kind === 'widget' ? '' : `${d.kind} `;
  return `${kind}${d.name}@${d.version}(${args.join(', ')})${req} — ${d.about ?? ''}`.trimEnd();
}

/** The full signature of a definition, for `mkp show`. */
export function signatureText(d: IRDef, env: TypeEnv): string {
  const out = [`${d.kind === 'widget' ? 'widget' : d.kind} ${d.name}@${d.version} (pack ${d.pack})`, d.about ?? ''];
  if (d.requires?.length) out.push(`requires ${d.requires.join(', ')}`);
  if (d.fields?.length) out.push(`fields: ${d.fields.join(' ')}`);
  out.push('inputs:');
  for (const i of d.inputs) {
    // slots and record lists may be left empty: only a value input without a default is required (GAPS 168)
    const rt = resolve(i.type, env).t;
    const req = !i.default && rt !== 'slot' && rt !== 'records';
    out.push(`  ${i.name}: ${showType(i.type)}${i.answer ? ' (an answer)' : ''}${i.default ? ` = ${valSrc(i.default, resolve(i.type, env))}` : req ? ' (required)' : ''}${i.about ? `  — ${i.about}` : ''}`);
  }
  if (d.implements?.length) out.push(`implements: ${d.implements.map((x) => x.slice(x.indexOf(':') + 1)).join(', ')}`);
  if (d.params?.length) out.push(`type parameters: ${d.params.join(', ')} (told from what each use gives)`);
  if (d.outs?.length) out.push('events (out):', ...d.outs.map((o) => `  ${o.name}${o.payload ? ' ' + showType(o.payload) : ''}${o.about ? `  — ${o.about}` : ''}`));
  if (d.signals?.length) out.push('signals:', ...d.signals.map((s) => `  ${s.name} ${showType(s.payload)}${s.about ? `  — ${s.about}` : ''}`));
  const hosts = (d.values ?? []).filter((v) => v.k === 'host');
  if (hosts.length) out.push('host inputs:', ...hosts.map((h) => `  ${h.name}: ${showType((h as { type: import('./types').Type }).type)}`));
  if (d.commands?.length) out.push('commands:', ...d.commands.map((c) => `  ${c.name}${c.payload ? ' ' + showType(c.payload) : ''}${c.about ? `  — ${c.about}` : ''}`));
  if (d.project) out.push(`projections: ${Object.keys(d.project).join(', ')}`);
  return out.filter((l) => l !== '').join('\n');
}
