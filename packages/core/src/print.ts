// The canonical printers (spec 12.1): IR back to .mkp and .mkp.md, in the formatter's form.
// Comments come back from meta.comment; blank lines are normalised. Printing then parsing gives
// the same IR (13: IR-identical, not byte-identical source).

import YAML from 'yaml';
import type { IRAction, IRDef, IRExpr, IRNode, IRState, IRTokenSet, IRVal, IRValue } from './ir';
import { encodeText } from './syntax/lexer';
import { showType, resolve, Type, TypeEnv } from './types';
import type { MkpFile } from './syntax/mkp';
import { canonical } from './syntax/canon';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Wraps an expression in parentheses when it has spaces outside brackets (6.2 bare values). */
export function bare(src: string): string {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === '$') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ' ' && depth === 0) return `(${src})`;
  }
  if (src.startsWith('-') && !/^-[\d.]+$/.test(src)) return `(${src})`;
  return src;
}

function litSrc(v: unknown, asPoint = false): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return encodeText(v);
  if (Array.isArray(v)) {
    if (asPoint && v.length === 2 && v.every((x) => typeof x === 'number')) return `(${litSrc(v[0])}, ${litSrc(v[1])})`;
    return `[${v.map((x) => litSrc(x)).join(', ')}]`;
  }
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    return e.length ? `{${e.map(([k, x]) => `${k}: ${litSrc(x)}`).join(', ')}}` : '{}';
  }
  return '0';
}

function msSrc(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

function isExpr(v: IRVal): v is IRExpr {
  return 'ast' in v && 'expr' in v;
}

/** A value as it is written in an argument. */
export function valSrc(v: IRVal, type?: Type): string {
  if ('lit' in v) {
    if (typeof v.lit === 'string' && (type?.t === 'choice' || (!type && IDENT.test(v.lit)))) return v.lit;
    if (type?.t === 'text' && typeof v.lit === 'string') return encodeText(v.lit);
    return litSrc(v.lit, type?.t === 'point');
  }
  if (isExpr(v)) return bare(v.expr);
  if ('text' in v) return encodeText((v as { text: string }).text);
  if ('tex' in v) return (v as { display?: boolean }).display ? `$$${(v as { tex: string }).tex}$$` : `$${(v as { tex: string }).tex}$`;
  if ('tok' in v) return v.tok;
  if ('ref' in v) return v.ref;
  if ('ms' in v) return msSrc(v.ms);
  if ('range' in v) {
    const end = (x: IRVal): string => {
      const s = 'lit' in x ? litSrc(x.lit) : isExpr(x) ? x.expr : valSrc(x);
      return /^-?[\d.]+(e-?\d+)?$/.test(s) ? s : `(${s})`;
    };
    return `${end(v.range[0])}..${end(v.range[1])}`;
  }
  return '';
}

export interface PrintContext {
  defs: Record<string, IRDef>;
  env: TypeEnv;
}

function comments(c: string[] | undefined, ind: string): string[] {
  return (c ?? []).map((x) => `${ind}# ${x}`.trimEnd());
}

export class MkpPrinter {
  constructor(readonly ctx: PrintContext) {}

  def(d: IRDef): string {
    const out: string[] = [...comments(d.comment, '')];
    const head = d.kind === 'widget' ? '' : `${d.kind} `;
    out.push(`${head}${d.name}@${d.version}${d.about !== undefined ? ' ' + encodeText(d.about) : ''}`);
    const i = '  ';
    for (const r of d.requires ?? []) out.push(`${i}requires ${r}`);
    if (d.budget) out.push(`${i}budget ${d.budget}`);
    if (d.fields?.length) out.push(`${i}fields ${d.fields.join(' ')}`);
    for (const inp of d.inputs) {
      out.push(...comments(inp.comment, i));
      out.push(`${i}in ${inp.name} ${showType(inp.type)}${inp.default ? ` = ${valSrc(inp.default, resolve(inp.type, this.ctx.env))}` : ''}${inp.about !== undefined ? ' ' + encodeText(inp.about) : ''}`);
    }
    for (const o of d.outs ?? []) out.push(...comments(o.comment, i), `${i}out ${o.name}${o.payload ? ' ' + showType(o.payload) : ''}${o.about !== undefined ? ' ' + encodeText(o.about) : ''}`);
    for (const s of d.signals ?? []) out.push(...comments(s.comment, i), `${i}signal ${s.name} ${showType(s.payload)}${s.about !== undefined ? ' ' + encodeText(s.about) : ''}`);
    for (const v of d.values ?? []) out.push(...this.value(v, i));
    for (const c of d.commands ?? []) {
      out.push(...comments(c.comment, i), `${i}command ${c.name}${c.payload ? ' ' + showType(c.payload) : ''}${c.about !== undefined ? ' ' + encodeText(c.about) : ''}`);
      for (const a of c.actions) out.push(`${i}  ${this.action(a)}`);
    }
    for (const n of d.view ?? []) out.push(...this.node(n, i, null));
    if (d.project?.md) out.push(`${i}project md = ${d.project.md.expr}`);
    if (d.project?.mermaid) out.push(`${i}project mermaid = ${d.project.mermaid.expr}`);
    return out.join('\n');
  }

  value(v: IRValue, i: string): string[] {
    const c = comments(v.comment, i);
    switch (v.k) {
      case 'host':
        return [...c, `${i}host ${v.name} ${showType(v.type)} = ${valSrc(v.default, resolve(v.type, this.ctx.env))}${v.about !== undefined ? ' ' + encodeText(v.about) : ''}`];
      case 'var':
        return [...c, `${i}var ${v.name} ${showType(v.type)} = ${valSrc(v.default, resolve(v.type, this.ctx.env))}${v.about !== undefined ? ' ' + encodeText(v.about) : ''}`];
      case 'derived':
        return [...c, `${i}${v.name} = ${v.value.expr}`];
      case 'fn':
        return [...c, `${i}fn ${v.name}(${v.params.map((p) => (p.type ? `${p.name}: ${showType(p.type)}` : p.name)).join(', ')})${v.ret ? ': ' + showType(v.ret) : ''} = ${v.body}`];
      case 'state':
        return [...c, ...this.state(v, i)];
    }
  }

  state(s: IRState, i: string): string[] {
    const parts: string[] = [];
    switch (s.control) {
      case 'slider':
        parts.push('slider', valSrc({ range: [s.args.min, s.args.max] }));
        if (s.args.step) parts.push(`step=${valSrc(s.args.step)}`);
        break;
      case 'choice':
        parts.push(`choice(${((s.args.opts as { lit: string[] }).lit ?? []).join('|')})`);
        break;
      case 'toggle':
        parts.push('toggle');
        break;
      case 'steps':
        parts.push('steps', valSrc(s.args.n));
        break;
      case 'drag':
        parts.push('drag', `x=${valSrc(s.args.x)}`, `y=${valSrc(s.args.y)}`);
        break;
    }
    if (s.play) parts.push(`play=${msSrc(s.play)}`);
    if (s.loop) parts.push(`loop=${s.loop}`);
    if (s.default) parts.push('=', valSrc(s.default, s.type));
    if (s.label !== undefined) parts.push(encodeText(s.label));
    const out = [`${i}${s.name} = ${parts.join(' ')}`];
    for (const [ev, acts] of Object.entries(s.on ?? {})) out.push(`${i}  @${ev} ${acts.map((a) => this.action(a)).join(' ')}`);
    return out;
  }

  action(a: IRAction): string {
    const id = (x: string | IRExpr): string => (typeof x === 'string' ? x : `(${x.expr})`);
    switch (a.a) {
      case 'set':
        return `set ${a.name}=${bare(a.value.expr)}`;
      case 'play':
      case 'pause':
        return `${a.a} ${a.name}`;
      case 'reset':
        return ['reset', ...a.names].join(' ');
      case 'reveal':
      case 'hide':
      case 'open':
      case 'close':
        return `${a.a} ${id(a.id)}`;
      case 'emit':
      case 'send':
        return [a.a, a.name, ...a.payload.map(([k, e]) => `${k}=${bare(e.expr)}`)].join(' ');
    }
  }

  private sigOf(n: IRNode): IRDef | undefined {
    return n.def ? this.ctx.defs[n.def] : undefined;
  }

  /** Record types available under a definition (its record lists), by record kind. */
  private recordTypes(d: IRDef | undefined): Map<string, Extract<Type, { t: 'records' }>> {
    const m = new Map<string, Extract<Type, { t: 'records' }>>();
    for (const inp of d?.inputs ?? []) {
      const t = resolve(inp.type, this.ctx.env);
      if (t.t === 'records') m.set(t.kind, t);
    }
    return m;
  }

  private args(props: Record<string, IRVal> | undefined, fields: string[], types: Map<string, Type>, defaults?: Record<string, string>): string[] {
    const out: string[] = [];
    const ps = { ...(props ?? {}) };
    // omit record fields equal to their defaults
    if (defaults) for (const [k, d] of Object.entries(defaults)) if (ps[k] && valSrc(ps[k], types.get(k)) === d.trim()) delete ps[k];
    // positional: the leading fields, as long as each is present and not a flag or token
    for (const f of fields) {
      const v = ps[f];
      if (!v) break;
      const t = types.get(f) ? resolve(types.get(f)!, this.ctx.env) : undefined;
      if ('tok' in v || 'ref' in v || (t?.t === 'bool')) break;
      let s = valSrc(v, t);
      if (IDENT.test(s)) s = `(${s})`;
      out.push(s);
      delete ps[f];
    }
    for (const [k, v] of Object.entries(ps)) {
      const t = types.get(k) ? resolve(types.get(k)!, this.ctx.env) : undefined;
      out.push(`${k}=${valSrc(v, t)}`);
    }
    return out;
  }

  private meta(n: IRNode): string[] {
    const m = n.meta;
    if (!m) return [];
    const out: string[] = [];
    if (m.id !== undefined) out.push(typeof m.id === 'string' ? `id=${m.id}` : `id=(${m.id.expr})`);
    if (m.if) out.push(`if=(${m.if.expr})`);
    if (m.hidden) out.push('hidden');
    if (m.grow) out.push('grow');
    if (m.basis) out.push(`basis=${m.basis}`);
    if (m.span) out.push(`span=${valSrc(m.span)}`);
    return out;
  }

  node(n: IRNode, i: string, recs: Map<string, Extract<Type, { t: 'records' }>> | null): string[] {
    const out: string[] = [...comments(n.meta?.comment, i)];
    const line = (parts: string[]): string => `${i}${parts.filter(Boolean).join(' ')}`;
    const kids = (ns: IRNode[] | undefined, r: Map<string, Extract<Type, { t: 'records' }>> | null): string[] => (ns ?? []).flatMap((c) => this.node(c, i + '  ', r));
    switch (n.node) {
      case 'each': {
        out.push(line(['each', n.var!, 'in', valSrc(n.in!), n.key ? `key=${bare(n.key.expr)}` : '']));
        out.push(...kids(n.records, recs), ...kids(n.children, recs));
        return out;
      }
      case 'switch': {
        out.push(line(['switch', `on=${bare(n.subject!.expr)}`]));
        for (const c of n.cases ?? []) {
          out.push(`${i}  case ${valSrc(c.value, n.subject!.type)}`);
          out.push(...c.children.flatMap((x) => this.node(x, i + '    ', recs)));
        }
        if (n.else) {
          out.push(`${i}  else`);
          out.push(...n.else.flatMap((x) => this.node(x, i + '    ', recs)));
        }
        return out;
      }
      case 'slot':
        out.push(line(['slot', bare(n.value!.expr)]));
        return out;
      case 'controls':
        out.push(line(['controls', ...(n.names ?? [])]));
        return out;
      case 'arrow':
        out.push(line(['arrow', `from=${valSrc(n.from!)}`, `to=${valSrc(n.to!)}`, n.label ? ('text' in n.label && !('ast' in n.label) ? valSrc(n.label, { t: 'text' }) : `label=${valSrc(n.label, { t: 'text' })}`) : '', n.via ? `via=${valSrc(n.via)}` : '', n.curve ? 'curve' : '', ...this.meta(n)]));
        return out;
      case '$record': {
        const t = recs?.get(n.record!);
        const types = new Map<string, Type>(t?.fields ?? []);
        const order = (t?.fields ?? []).filter(([, ft]) => resolve(ft, this.ctx.env).t !== 'records').map(([k]) => k);
        out.push(line([n.record!, ...this.args(n.props, order, types, t?.defaults), ...this.meta(n)]));
        // nested record kinds come from the record type's own record-list fields
        const inner = new Map<string, Extract<Type, { t: 'records' }>>();
        for (const [, ft] of t?.fields ?? []) {
          const r = resolve(ft, this.ctx.env);
          if (r.t === 'records') inner.set(r.kind, r);
        }
        out.push(...kids(n.records, inner), ...kids(n.children, null));
        return out;
      }
    }
    const d = this.sigOf(n);
    const types = new Map<string, Type>((d?.inputs ?? []).map((x) => [x.name, x.type]));
    const name = d && d.version > 1 ? `${n.node}@${d.version}` : n.node;
    out.push(line([name, ...this.args(n.props, d?.fields ?? [], types), ...this.meta(n)]));
    const r = this.recordTypes(d);
    out.push(...kids(n.records, r), ...kids(n.children, null));
    for (const [slot, ns] of Object.entries(n.fills ?? {})) {
      out.push(`${i}  fill ${slot}`);
      out.push(...ns.flatMap((x) => this.node(x, i + '    ', null)));
    }
    for (const [ev, acts] of Object.entries(n.on ?? {})) out.push(`${i}  @${ev} ${acts.map((a) => this.action(a)).join(' ')}`);
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// Whole .mkp files: definitions plus the top-level items they sit among

export type FileItem =
  | { def: IRDef }
  | { type: string; of: Type; comment?: string[] }
  | { fn: string; params: { name: string; type?: Type }[]; ret?: Type; body: string; op?: boolean; comment?: string[] }
  | { const: string; type?: Type; expr: string; comment?: string[] }
  | { macro: string; tex: string; comment?: string[] }
  | { tokens: IRTokenSet; comment?: string[] }
  | { pack: { kind: string; name: string; version: number; about?: string; requires: string[]; depends: string[]; provides: string[]; front: { name: string; type: Type; def?: string; about?: string }[]; roles: string[]; rules: { rule: string; path: string; args: string[]; message?: string }[] }; comment?: string[] };

export function fileItems(file: MkpFile, defs: Map<string, IRDef>, pack: string, tokenIR: (name: string) => IRTokenSet | undefined): FileItem[] {
  const norm = canonical;
  const cm = (c: string[]): { comment?: string[] } => (c.length ? { comment: c } : {});
  return file.items.map((it): FileItem => {
    switch (it.item) {
      case 'def':
        return { def: defs.get(`${pack}:${it.name}@${it.version}`)! };
      case 'type':
        return { type: it.name, of: it.type, ...cm(it.comments) };
      case 'fn':
      case 'op':
        return { fn: it.item === 'op' ? (it as { symbol: string }).symbol : it.name, params: it.params.map((p) => (p.type ? { name: p.name, type: p.type } : { name: p.name })), ret: it.ret, body: norm(it.src), op: it.item === 'op' || undefined, ...cm(it.comments) };
      case 'const':
        return { const: it.name, type: it.type, expr: norm(it.src), ...cm(it.comments) };
      case 'macro':
        return { macro: it.name, tex: it.tex, ...cm(it.comments) };
      case 'tokens':
        return { tokens: tokenIR(it.name)!, ...cm(it.comments) };
      case 'manifest':
        return {
          pack: {
            kind: it.kind,
            name: it.name,
            version: it.version,
            about: it.about,
            requires: it.requires,
            depends: it.depends,
            provides: it.provides,
            front: it.front.map((f) => ({ name: f.name, type: f.type, def: f.def?.src, about: f.about })),
            roles: it.roles,
            rules: it.rules.map((r) => ({ rule: r.rule, path: r.path, args: r.args.map((a) => a.value.src), message: r.message })),
          },
          ...cm(it.comments),
        };
    }
  });
}

function tokenLines(t: IRTokenSet): string[] {
  const out: string[] = [];
  const v = (x: unknown): string => (typeof x === 'string' ? encodeText(x) : String(x));
  for (const [kind, names] of Object.entries(t.tokens)) {
    const entries = Object.entries(names);
    const simple = entries.every(([, e]) => Object.keys(e).length === 1 && 'value' in e && typeof e.value !== 'string');
    if (simple && kind !== 'color' && kind !== 'font' && kind !== 'shadow') {
      out.push(`  ${kind} ${entries.map(([n, e]) => `${n}=${kind === 'motion' ? msSrc(e.value as number) : v(e.value)}`).join(' ')}`);
      continue;
    }
    for (const [n, e] of entries) {
      const rest = Object.entries(e).filter(([k]) => k !== 'value').map(([k, x]) => `${k}=${v(x)}`);
      out.push(`  ${kind} ${n}${'value' in e ? ' ' + v(e.value) : ''}${rest.length ? ' ' + rest.join(' ') : ''}`);
    }
  }
  return out;
}

export function printFile(items: FileItem[], ctx: PrintContext): string {
  const p = new MkpPrinter(ctx);
  const blocks = items.map((it) => {
    const c = 'comment' in it && it.comment ? comments(it.comment, '') : [];
    if ('def' in it) return p.def(it.def);
    if ('const' in it) return [...c, `const ${it.const}${it.type ? ': ' + showType(it.type) : ''} = ${it.expr}`].join('\n');
    if ('fn' in it) return [...c, `${it.op ? 'op' : 'fn'} ${it.fn}(${it.params.map((q) => (q.type ? `${q.name}: ${showType(q.type)}` : q.name)).join(', ')})${it.ret ? ': ' + showType(it.ret) : ''} = ${it.body}`].join('\n');
    if ('type' in it) return [...c, `type ${it.type} = ${showType(it.of)}`].join('\n');
    if ('macro' in it) return [...c, `macro ${it.macro} = $${it.tex}$`].join('\n');
    if ('tokens' in it) return [...c, `tokens ${it.tokens.name}@${it.tokens.version}${it.tokens.about !== undefined ? ' ' + encodeText(it.tokens.about) : ''}`, ...tokenLines(it.tokens)].join('\n');
    const m = it.pack;
    const lines = [...c, `${m.kind} ${m.name}@${m.version}${m.about !== undefined ? ' ' + encodeText(m.about) : ''}`];
    if (m.requires.length) lines.push(`  requires ${m.requires.join(' ')}`);
    if (m.depends.length) lines.push(`  depends ${m.depends.join(' ')}`);
    if (m.provides.length) lines.push(`  provides ${m.provides.join(' ')}`);
    for (const f of m.front) lines.push(`  front ${f.name} ${showType(f.type)}${f.def ? ' = ' + f.def : ''}${f.about !== undefined ? ' ' + encodeText(f.about) : ''}`);
    if (m.roles.length) lines.push(`  roles ${m.roles.join(' ')}`);
    for (const r of m.rules) lines.push(`  rule ${r.rule} ${r.path}${r.args.length ? ' ' + r.args.join(' ') : ''}${r.message !== undefined ? ' ' + encodeText(r.message) : ''}`);
    return lines.join('\n');
  });
  return blocks.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Documents (.mkp.md)

export class DocPrinter {
  private readonly p: MkpPrinter;
  constructor(readonly ctx: PrintContext) {
    this.p = new MkpPrinter(ctx);
  }

  doc(front: Record<string, unknown>, body: IRNode[], docDef?: IRDef): string {
    const parts: string[] = [];
    if (Object.keys(front).length) parts.push(`---\n${yamlText(front).trimEnd()}\n---`);
    parts.push(...this.blocks(body, 3, docDef));
    return parts.join('\n\n') + '\n';
  }

  blocks(ns: IRNode[], colons: number, docDef?: IRDef): string[] {
    return ns.map((n) => this.block(n, colons, docDef)).filter((s) => s !== '');
  }

  private inlineText(v: IRVal | undefined): string {
    if (!v) return '';
    if ('text' in v) return (v as { text: string }).text;
    if ('lit' in v) return String(v.lit);
    return '';
  }

  block(n: IRNode, colons: number, docDef?: IRDef): string {
    const p = n.props ?? {};
    const attrs = (n.meta?.anchor || n.meta?.role) && !n.meta.summary ? `\n{${[n.meta.anchor ? `#${n.meta.anchor}` : '', n.meta.role ? `role=${n.meta.role}` : ''].filter(Boolean).join(' ')}}` : '';
    switch (n.node) {
      case 'paragraph':
        return this.inlineText(p.text) + attrs;
      case 'heading':
        return `${'#'.repeat(Number((p.level as { lit: number }).lit) || 2)} ${this.inlineText(p.text)}${attrs}`;
      case 'divider':
        return '---';
      case 'code': {
        const src = this.inlineText(p.src);
        const fence = src.includes('```') ? '````' : '```';
        return `${fence}${this.inlineText(p.lang)}\n${src}\n${fence}`;
      }
      case 'math':
        return `$$\n${(p.tex as { tex: string }).tex}\n$$`;
      case 'quote': {
        const alert = String((p.alert as { lit: string } | undefined)?.lit ?? 'none');
        const body = this.blocks(n.children ?? [], colons).join('\n\n');
        const text = alert !== 'none' ? `[!${alert.toUpperCase()}]\n${body}` : body;
        return text
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n');
      }
      case 'list': {
        const ordered = !!(p.ordered as { lit: boolean })?.lit;
        let k = Number((p.start as { lit: number })?.lit ?? 1);
        return (n.records ?? [])
          .map((it) => {
            const mark = ordered ? `${k++}.` : '-';
            const checked = String((it.props?.checked as { lit: string } | undefined)?.lit ?? 'none');
            const box = checked === 'yes' ? '[x] ' : checked === 'no' ? '[ ] ' : '';
            const body = this.blocks(it.children ?? [], colons).join('\n\n');
            const pad = ' '.repeat(mark.length + 1);
            return `${mark} ${box}${body.split('\n').map((l, i) => (i && l ? pad + l : l)).join('\n')}`;
          })
          .join('\n');
      }
      case 'table': {
        const head = (p.head as { lit: string[] }).lit;
        const rows = (p.rows as { lit: string[][] }).lit;
        const align = ((p.align as { lit: string[] } | undefined)?.lit ?? []) as string[];
        const sep = head.map((_, i) => (align[i] === 'center' ? ':---:' : align[i] === 'right' ? '---:' : align[i] === 'left' ? ':---' : '---'));
        return [head, sep, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
      }
      case 'footnote':
        return `[^${this.inlineText(p.label)}]: ${this.blocks(n.children ?? [], colons).join('\n\n    ')}`;
      case 'controls': {
        const vals = (docDef?.values ?? []).filter((v) => (v.k === 'state' || v.k === 'var') && (n.names ?? []).includes(v.name));
        return '```state\n' + vals.flatMap((v) => this.p.value(v, '')).join('\n') + '\n```';
      }
    }
    return this.widget(n, colons);
  }

  /** A widget: a fenced block with YAML inputs, or a container when it holds Markdown. */
  private widget(n: IRNode, colons: number): string {
    const d = n.def ? this.ctx.defs[n.def] : undefined;
    const name = d && d.pack !== 'core' ? `${d.name}${d.version > 1 ? '@' + d.version : ''}` : n.node;
    const containerish = !n.meta?.summary && (n.children?.length || n.fills || (n.records ?? []).some((r) => r.children?.length));
    if (containerish && d) {
      const types = new Map<string, Type>(d.inputs.map((x) => [x.name, x.type]));
      const recs = new Map<string, Extract<Type, { t: 'records' }>>();
      for (const inp of d.inputs) {
        const t = resolve(inp.type, this.ctx.env);
        if (t.t === 'records') recs.set(t.kind, t);
      }
      const args = this.p['args'](n.props, d.fields ?? [], types);
      const inner: string[] = [];
      const hasNested = (n.records ?? []).length > 0 || !!n.fills;
      const c = hasNested ? colons + 1 : colons;
      for (const r of n.records ?? []) {
        const t = recs.get(r.record!);
        const order = (t?.fields ?? []).filter(([, ft]) => resolve(ft, this.ctx.env).t !== 'records').map(([k]) => k);
        const rargs = this.p['args'](r.props, order, new Map(t?.fields ?? []), t?.defaults);
        inner.push(`${':'.repeat(colons)}${r.record}${rargs.length ? ' ' + rargs.join(' ') : ''}\n${this.blocks(r.children ?? [], colons).join('\n\n')}\n${':'.repeat(colons)}`);
      }
      for (const [slot, ns] of Object.entries(n.fills ?? {})) inner.push(`${':'.repeat(colons)}fill ${slot}\n${this.blocks(ns, colons).join('\n\n')}\n${':'.repeat(colons)}`);
      if (n.children?.length) inner.push(this.blocks(n.children, colons).join('\n\n'));
      const attrs = n.meta?.anchor ? `\n{#${n.meta.anchor}}` : '';
      return `${':'.repeat(c)}${name}${args.length ? ' ' + args.join(' ') : ''}\n${inner.join('\n\n')}\n${':'.repeat(c)}${attrs}`;
    }
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n.props ?? {})) obj[k] = this.yamlValue(v, d?.inputs.find((x) => x.name === k)?.type);
    // records as YAML lists of mappings, with records nested in records as lists of their own
    const recordObj = (r: IRNode): Record<string, unknown> => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.props ?? {})) o[k] = this.yamlValue(v);
      for (const x of r.records ?? []) ((o[x.input!] ??= []) as unknown[]).push(recordObj(x));
      if (r.children?.length) o.slot = this.blocks(r.children, 3).join('\n\n');
      return o;
    };
    const recLists = new Map<string, unknown[]>();
    for (const r of n.records ?? []) {
      const list = recLists.get(r.input!) ?? [];
      list.push(recordObj(r));
      recLists.set(r.input!, list);
    }
    for (const [k, v] of recLists) obj[k] = v;
    const firstSlot = d?.inputs.find((x) => resolve(x.type, this.ctx.env).t === 'slot')?.name;
    if (n.children?.length && firstSlot) obj[firstSlot] = this.blocks(n.children, 3).join('\n\n');
    for (const [slot, ns] of Object.entries(n.fills ?? {})) obj[slot] = this.blocks(ns, 3).join('\n\n');
    if (n.meta?.summary !== undefined) obj.summary = n.meta.summary;
    const info = `${name}${n.meta?.anchor ? ` #${n.meta.anchor}` : ''}`;
    return '```' + info + '\n' + yamlText(obj).trimEnd() + '\n```';
  }

  private yamlValue(v: IRVal, type?: Type): unknown {
    if ('lit' in v) return v.lit;
    if ('ast' in v && 'expr' in v) return (v as IRExpr).expr;
    if ('text' in v) return (v as { text: string }).text;
    if ('tex' in v) return (v as { tex: string }).tex;
    if ('tok' in v) return v.tok;
    if ('ref' in v) return { ref: v.ref };
    if ('ms' in v) return msSrc(v.ms);
    if ('range' in v) return [this.yamlValue(v.range[0]), this.yamlValue(v.range[1])];
    void type;
    return null;
  }
}

/** YAML with the maths guard (5): strings holding backslashes are written in single quotes. */
export function yamlText(v: unknown): string {
  const doc = new YAML.Document(v);
  YAML.visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && (node.value.includes('\\') || node.value.includes('$'))) node.type = node.value.includes('\n') ? 'BLOCK_LITERAL' : 'QUOTE_SINGLE';
    },
  });
  return doc.toString({ lineWidth: 0 });
}
