// Checking a document (spec 5, 6.23): widget blocks against their inputs, containers, attributes,
// document state, front matter. A document is checked as a synthetic definition, so its state
// blocks and {ref: name} bindings work like any definition's state.

import YAML from 'yaml';
import { Diagnostics, MkpError, Pos, didYouMean } from '../diag';
import type { IRDef, IRNode, IRVal } from '../ir';
import { markdownToNodes } from '../markdown';
import { chunks } from '../syntax/lexer';
import { parseDoc, type DocItem, type DocSyn } from '../syntax/doc';
import { parseExprString, parseMkp, parseValueString, type Arg, type DefSyn } from '../syntax/mkp';
import { fits, resolve, showType, T, Type } from '../types';
import { DefChecker, pos, type Sig, type DefCheckOptions } from './def';
import type { Program } from './program';

export const DOC_PACK = '$doc';

export interface CheckedDoc {
  file: string;
  front: Record<string, unknown>;
  body: IRNode[];
  def: IRDef;
  uses: Set<string>;
}

export function checkDocument(prog: Program, src: string, file: string, diags: Diagnostics, opts: DefCheckOptions): CheckedDoc {
  const syn = parseDoc(src, file, diags);
  // the synthetic definition: state blocks become its state lines
  const states: { line: number; body: string }[] = [];
  const collect = (items: DocItem[]): void => {
    for (const it of items) {
      if (it.k === 'state') states.push({ line: it.line, body: it.body });
      if (it.k === 'container') collect(it.items);
    }
  };
  collect(syn.items);
  const srcLines: string[] = ['document@1 "the document"'];
  for (const s of states) {
    while (srcLines.length < s.line) srcLines.push('');
    for (const l of s.body.split('\n')) srcLines.push(l.trim() ? '  ' + l : '');
  }
  const mk = parseMkp(srcLines.join('\n'), file, diags);
  const defSyn = (mk.items[0] as DefSyn) ?? { item: 'def', kind: 'widget', name: 'document', version: 1, members: [], p: { file, line: 1, col: 1 }, comments: [] };
  for (const m of defSyn.members) {
    if (m.m !== 'state' && m.m !== 'var') diags.error('mkp.doc-state', 'a state block holds state lines only (name = control …)', m.m === 'node' ? m.node.p : m.p);
  }
  defSyn.members = defSyn.members.filter((m) => m.m === 'state' || m.m === 'var');
  const entry = { id: `${DOC_PACK}:document@1`, pack: DOC_PACK, file, syn: defSyn };
  const dc = new DefChecker(prog, entry, diags, opts);
  const def = dc.check();
  const d = new DocChecker(prog, dc, diags, file);
  const body = d.items(syn.items, true);
  dc.runDeferred();
  return { file, front: d.front(syn), body, def, uses: dc.uses };
}

class DocChecker {
  constructor(
    readonly prog: Program,
    readonly dc: DefChecker,
    readonly diags: Diagnostics,
    readonly file: string,
  ) {}

  p(line: number, col = 1): Pos {
    return { file: this.file, line, col };
  }

  front(syn: DocSyn): Record<string, unknown> {
    if (syn.front === null) return {};
    try {
      const v = YAML.parse(syn.front, { strict: true, uniqueKeys: true });
      if (v === null || v === undefined) return {};
      if (typeof v !== 'object' || Array.isArray(v)) {
        this.diags.error('mkp.front-matter', 'front matter must be a YAML mapping', this.p(syn.frontLine));
        return {};
      }
      this.guard(v, this.p(syn.frontLine), 'front matter');
      return v as Record<string, unknown>;
    } catch (e) {
      this.diags.error('mkp.front-matter', `front matter is not valid YAML: ${(e as Error).message.split('\n')[0]}`, this.p(syn.frontLine));
      return {};
    }
  }

  /** The YAML maths guard (5): control characters in text mean a backslash was eaten by "…". */
  guard(v: unknown, p: Pos, where: string): void {
    if (typeof v === 'string') {
      // eslint-disable-next-line no-control-regex
      const m = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.exec(v);
      if (m) {
        const names: Record<string, string> = { '\t': '\\t', '\b': '\\b', '\f': '\\f', '\v': '\\v', '\r': '\\r' };
        const c = names[m[0]] ?? `U+${m[0].charCodeAt(0).toString(16).padStart(4, '0')}`;
        throw new MkpError('mkp.yaml-control-char', `${where} holds a control character (${c}); a backslash in "double quotes" is an escape, so write LaTeX in 'single quotes' (e.g. '\\theta')`, p);
      }
    } else if (Array.isArray(v)) v.forEach((x) => this.guard(x, p, where));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => this.guard(x, p, where));
  }

  items(items: DocItem[], top: boolean): IRNode[] {
    const out: IRNode[] = [];
    let blockNo = 0;
    for (const it of items) {
      try {
        switch (it.k) {
          case 'md': {
            const warns: { line: number; message: string }[] = [];
            const nodes = markdownToNodes(it.text, it.line, warns);
            for (const w of warns) this.diags.warn('mkp.markdown', w.message, this.p(w.line));
            if (it.attrs && nodes.length) this.applyAttrs(nodes[nodes.length - 1], it.attrs.id, it.attrs.props, it.attrs.line, null);
            out.push(...nodes);
            break;
          }
          case 'state': {
            const names = this.stateNames(it.body);
            out.push({ node: 'controls', names, pos: [it.line, 1] });
            break;
          }
          case 'block': {
            const n = this.block(it);
            if (n) {
              (n.meta ??= {}).block = top ? blockNo++ : undefined;
              if (n.meta.block === undefined) delete n.meta.block;
              out.push(n);
            }
            break;
          }
          case 'container': {
            const n = this.container(it);
            if (n) out.push(n);
            break;
          }
        }
      } catch (e) {
        this.dc.err(e);
      }
    }
    return out;
  }

  private stateNames(body: string): string[] {
    return body
      .split('\n')
      .map((l) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+=/.exec(l)?.[1])
      .filter((x): x is string => !!x);
  }

  private widgetSig(name: string, p: Pos): Sig {
    const sig = this.dc.resolveDef(name, p);
    if (sig.kind === 'part' && !this.dc.opts.allowParts) throw new MkpError('mkp.part-in-document', `${sig.name} is a part; parts are used inside definitions, not in documents`, p);
    this.dc.uses.add(sig.id);
    return sig;
  }

  private block(it: Extract<DocItem, { k: 'block' }>): IRNode | null {
    const p = this.p(it.line);
    // a fence whose info string is not a visible widget stays a code block
    const bare = it.name.replace(/@\d+$/, '');
    if (!this.prog.lookupDefs(bare, DOC_PACK).length) {
      if (it.id || it.name.includes('@') || /[.:]/.test(it.name) === false && this.looksLikeWidget(it.yaml)) {
        this.diags.error('mkp.unknown-widget', `there is no widget "${bare}"${didYouMean(bare, [...this.prog.defs.values()].filter((d) => d.syn.kind !== 'part').map((d) => d.syn.name))}`, p);
        return null;
      }
      return { node: 'code', def: 'core:code@1', props: { src: { text: it.yaml }, lang: { text: it.info } }, pos: [it.line, 1] };
    }
    const sig = this.widgetSig(it.name, p);
    let data: unknown;
    try {
      data = it.yaml.trim() ? YAML.parse(it.yaml, { strict: true, uniqueKeys: true }) : {};
    } catch (e) {
      throw new MkpError('mkp.yaml', `the ${sig.name} block is not valid YAML: ${(e as Error).message.split('\n')[0]}`, this.p(it.line + 1));
    }
    if (data === null || data === undefined) data = {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new MkpError('mkp.yaml', `the ${sig.name} block must be a YAML mapping of its inputs`, p);
    const obj = data as Record<string, unknown>;
    this.guard(obj, this.p(it.line + 1), `the ${sig.name} block`);
    const node: IRNode = { node: sig.name, def: sig.id, props: {}, pos: [it.line, 1] };
    const summary = obj.summary;
    if (typeof summary !== 'string' || !summary.trim()) {
      this.diags.error('mkp.missing-summary', `the ${sig.name} block needs a summary: line (what it shows, for readers without the widget and for Markdown output)`, p);
    } else (node.meta ??= {}).summary = summary;
    if (it.id) (node.meta ??= {}).anchor = it.id;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'summary') continue;
      try {
        this.setProp(node, sig, k, v, this.p(this.lineOf(it, k)));
      } catch (e) {
        this.dc.err(e);
      }
    }
    if (it.attrs) this.applyAttrs(node, it.attrs.id, it.attrs.props, it.attrs.line, sig);
    this.requireInputs(node, sig, p);
    return node;
  }

  private looksLikeWidget(yaml: string): boolean {
    return /^summary:/m.test(yaml);
  }

  private lineOf(it: { line: number; yaml: string }, key: string): number {
    const i = it.yaml.split('\n').findIndex((l) => l.startsWith(key + ':'));
    return it.line + 1 + Math.max(0, i);
  }

  private requireInputs(node: IRNode, sig: Sig, p: Pos): void {
    for (const [name, inp] of sig.inputs) {
      if (inp.hasDefault || node.props?.[name] !== undefined) continue;
      if (resolve(inp.type, this.prog.typeEnv(sig.pack)).t === 'records' && node.records?.length) continue;
      this.diags.error('mkp.missing-input', `${sig.name} needs ${name} (${showType(inp.type)})`, p);
    }
  }

  private setProp(node: IRNode, sig: Sig, k: string, v: unknown, p: Pos): void {
    const inp = sig.inputs.get(k);
    if (!inp) throw new MkpError('mkp.unknown-prop', `${sig.name} has no input "${k}"${didYouMean(k, [...sig.inputs.keys(), 'summary'])}`, p);
    const env = this.prog.typeEnv(sig.pack);
    const t = resolve(inp.type, env);
    if (t.t === 'slot') {
      if (typeof v !== 'string') throw new MkpError('mkp.input-type', `${k} is a slot: give it a Markdown string`, p);
      const nodes = markdownToNodes(v, p.line);
      if (sig.slots[0] === k) node.children = nodes;
      else (node.fills ??= {})[k] = nodes;
      return;
    }
    if (t.t === 'records') {
      if (!Array.isArray(v)) throw new MkpError('mkp.input-type', `${k} is a list of ${t.kind} records: give a YAML list of objects`, p);
      for (const r of v) node.records = [...(node.records ?? []), this.yamlRecord(r, t, sig, p, k)];
      return;
    }
    node.props![k] = this.yamlValue(v, inp.type, sig.pack, p, k);
  }

  private yamlRecord(r: unknown, t: Extract<Type, { t: 'records' }>, sig: Sig, p: Pos, input: string): IRNode {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new MkpError('mkp.input-type', `each ${t.kind} is an object of its fields`, p);
    const obj = r as Record<string, unknown>;
    const props: Record<string, IRVal> = {};
    const out: IRNode = { node: '$record', record: t.kind, input, props, pos: [p.line, p.col] };
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'slot' && t.slot) {
        if (typeof v !== 'string') throw new MkpError('mkp.input-type', `the ${t.kind} slot is a Markdown string`, p);
        out.children = markdownToNodes(v, p.line);
        continue;
      }
      const f = t.fields.find((x) => x[0] === k);
      if (!f) throw new MkpError('mkp.unknown-field', `${t.kind} has no field "${k}"${didYouMean(k, t.fields.map((x) => x[0]))}`, p);
      const ft = resolve(f[1], this.prog.typeEnv(sig.pack));
      if (ft.t === 'records') {
        if (!Array.isArray(v)) throw new MkpError('mkp.input-type', `${k} is a list of ${ft.kind} records`, p);
        for (const x of v) (out.records ??= []).push(this.yamlRecord(x, ft, sig, p, k));
        continue;
      }
      props[k] = this.yamlValue(v, f[1], sig.pack, p, `${t.kind}.${k}`);
    }
    for (const [k, ft] of t.fields) {
      if (props[k] !== undefined || resolve(ft, this.prog.typeEnv(sig.pack)).t === 'records') continue;
      const d = t.defaults?.[k];
      if (d === undefined) throw new MkpError('mkp.missing-input', `${t.kind} needs ${k} (${showType(ft)})`, p);
      props[k] = this.dc.staticValue(parseValueString(d, this.file, p.line, p.col), ft, p);
    }
    return out;
  }

  /** A YAML value as an IR value of the given type (5: inputs are type-checked everywhere). */
  yamlValue(v: unknown, type: Type, pack: string, p: Pos, what: string): IRVal {
    const env = this.prog.typeEnv(pack);
    const t = resolve(type, env);
    const bad = (want: string): never => {
      throw new MkpError('mkp.input-type', `${what} is ${want}; found ${JSON.stringify(v)}`, p);
    };
    switch (t.t) {
      case 'num':
      case 'int': {
        if (typeof v !== 'number') return bad(t.t === 'int' ? 'a whole number' : 'a number');
        if (t.t === 'int' && !Number.isInteger(v)) return bad('a whole number');
        if (t.lo !== undefined && (v < t.lo || v > t.hi!)) throw new MkpError('mkp.input-range', `${what} is ${v}, outside ${t.lo}..${t.hi}`, p);
        return { lit: v };
      }
      case 'bool':
        return typeof v === 'boolean' ? { lit: v } : bad('true or false');
      case 'text':
        if (typeof v === 'number') return { text: String(v) };
        return typeof v === 'string' ? { text: v } : bad('text');
      case 'latex': {
        if (typeof v !== 'string') return bad('maths');
        const m = /^\$\$?([\s\S]*?)\$?\$$/.exec(v.trim());
        return { tex: m ? m[1] : v };
      }
      case 'choice':
        if (typeof v === 'string' && t.opts.includes(v)) return { lit: v };
        throw new MkpError('mkp.enum', `${what} is one of ${t.opts.join(', ')}; found ${JSON.stringify(v)}`, p);
      case 'point':
        if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')) return { lit: v };
        return bad('a point [x, y]');
      case 'duration': {
        const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)(ms|s)$/.exec(v) : null;
        return m ? { ms: Number(m[1]) * (m[2] === 's' ? 1000 : 1) } : bad('a duration such as 6s');
      }
      case 'range': {
        if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')) return { range: [{ lit: v[0] }, { lit: v[1] }] };
        if (typeof v === 'string' && /^-?[\d.]+\.\.-?[\d.]+$/.test(v)) {
          const [a, b] = v.split('..').map(Number);
          return { range: [{ lit: a }, { lit: b }] };
        }
        return bad('a range [a, b] or "a..b"');
      }
      case 'token':
        if (typeof v === 'string' && (v === 'none' || this.dc.opts.tokenNames(t.kind).has(v))) return { tok: v, kind: t.kind };
        throw new MkpError('mkp.unknown-token', `${what} is a ${t.kind} token; "${String(v)}" is not one${didYouMean(String(v), this.dc.opts.tokenNames(t.kind))}`, p);
      case 'ref': {
        const r = v as { ref?: unknown };
        if (!r || typeof r !== 'object' || typeof r.ref !== 'string') return bad('{ref: name} of a state line in a state block');
        const b = this.dc.scope.get(r.ref);
        if (!b || (b.kind !== 'state' && b.kind !== 'var')) throw new MkpError('mkp.not-state', `"${r.ref}" is not declared in a state block of this document`, p);
        if (!fits(b.type, t.of, env)) throw new MkpError('mkp.input-type', `${what} is ${showType(t.of)}, but ${r.ref} is ${showType(b.type)}`, p);
        return { ref: r.ref };
      }
      case 'expr': {
        if (typeof v !== 'string' && typeof v !== 'number') return bad(`an expression in ${t.vars.map((x) => x[0]).join(', ')}`);
        const e = parseExprString(String(v), this.file, p.line, p.col);
        return this.dc.value({ v: 'expr', e, src: String(v), p }, type, this.dc.scope, p);
      }
      case 'list': {
        if (!Array.isArray(v)) return bad(`a list of ${showType(t.of)}`);
        const items = v.map((x, i) => this.yamlData(x, t.of, env, p, `${what}[${i}]`));
        return { lit: items, type };
      }
      default:
        return { lit: this.yamlData(v, type, env, p, what), type };
    }
  }

  /** Plain data values (inside lists and records): the runtime representation. */
  private yamlData(v: unknown, type: Type, env: (n: string) => Type | undefined, p: Pos, what: string): unknown {
    const t = resolve(type, env);
    const bad = (want: string): never => {
      throw new MkpError('mkp.input-type', `${what} is ${want}; found ${JSON.stringify(v)}`, p);
    };
    switch (t.t) {
      case 'num':
      case 'int':
        if (typeof v !== 'number' || (t.t === 'int' && !Number.isInteger(v))) return bad(t.t === 'int' ? 'a whole number' : 'a number');
        if (t.lo !== undefined && (v < t.lo || v > t.hi!)) throw new MkpError('mkp.input-range', `${what} is ${v}, outside ${t.lo}..${t.hi}`, p);
        return v;
      case 'bool':
        return typeof v === 'boolean' ? v : bad('true or false');
      case 'text':
      case 'latex':
        return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : bad('text');
      case 'choice':
        return typeof v === 'string' && t.opts.includes(v) ? v : bad(`one of ${t.opts.join(', ')}`);
      case 'point':
        return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') ? v : bad('a point [x, y]');
      case 'list':
        return Array.isArray(v) ? v.map((x, i) => this.yamlData(x, t.of, env, p, `${what}[${i}]`)) : bad('a list');
      case 'dict': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('a mapping');
        const o: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) o[k] = this.yamlData(x, t.of, env, p, `${what}.${k}`);
        return o;
      }
      case 'rec': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return bad(`a record {${t.fields.map((f) => f[0]).join(', ')}}`);
        const o: Record<string, unknown> = {};
        const src = v as Record<string, unknown>;
        for (const k of Object.keys(src)) if (!t.fields.some((f) => f[0] === k)) throw new MkpError('mkp.unknown-field', `${what} has no field "${k}"${didYouMean(k, t.fields.map((f) => f[0]))}`, p);
        for (const [k, ft] of t.fields) {
          if (!(k in src)) {
            const d = t.defaults?.[k];
            if (d !== undefined) {
              const dv = this.dc.staticValue(parseValueString(d), ft, p) as { lit?: unknown };
              o[k] = dv.lit;
              continue;
            }
            throw new MkpError('mkp.missing-field', `${what} needs ${k} (${showType(ft)})`, p);
          }
          o[k] = this.yamlData(src[k], ft, env, p, `${what}.${k}`);
        }
        return o;
      }
      default:
        return bad(`a ${showType(type)} (which YAML can't give)`);
    }
  }

  private container(it: Extract<DocItem, { k: 'container' }>): IRNode | null {
    const p = this.p(it.line);
    const sig = this.widgetSig(it.name, p);
    const args = this.args(it.args, it.line, it.name.length + it.colons + 1);
    const { props, meta } = this.dc.fillArgs(args, new Map([...sig.inputs].map(([k, v]) => [k, v.type])), sig.fields, this.dc.scope, sig.name, new Set(sig.slots));
    const node: IRNode = { node: sig.name, def: sig.id, props, pos: [it.line, 1] };
    if (Object.keys(meta).length) node.meta = meta;
    // inner containers may be records (:::tab "Title") or fills (:::fill other)
    const plain: DocItem[] = [];
    for (const inner of it.items) {
      if (inner.k === 'container' && inner.name === 'fill') {
        const nm = inner.args.trim();
        if (!sig.slots.includes(nm)) throw new MkpError('mkp.unknown-slot', `${sig.name} has no slot "${nm}"${didYouMean(nm, sig.slots)}`, this.p(inner.line));
        (node.fills ??= {})[nm] = this.items(inner.items, false);
        continue;
      }
      const rec = inner.k === 'container' ? sig.records.get(inner.name) : undefined;
      if (rec && inner.k === 'container') {
        const rargs = this.args(inner.args, inner.line, inner.name.length + inner.colons + 1);
        const t = rec.type;
        const order = t.fields.filter(([, ft]) => resolve(ft, this.prog.typeEnv(sig.pack)).t !== 'records').map(([n]) => n);
        const filled = this.dc.fillArgs(rargs, new Map(t.fields), order, this.dc.scope, `${t.kind} record`, new Set());
        for (const [f, ft] of t.fields) {
          if (filled.props[f] !== undefined || resolve(ft, this.prog.typeEnv(sig.pack)).t === 'records') continue;
          const d = t.defaults?.[f];
          if (d === undefined) throw new MkpError('mkp.missing-input', `the ${t.kind} record needs ${f}`, this.p(inner.line));
          filled.props[f] = this.dc.staticValue(parseValueString(d), ft, this.p(inner.line));
        }
        const r: IRNode = { node: '$record', record: t.kind, input: rec.input, props: filled.props, pos: [inner.line, 1] };
        if (Object.keys(filled.meta).length) r.meta = filled.meta;
        if (t.slot) r.children = this.items(inner.items, false);
        (node.records ??= []).push(r);
        continue;
      }
      plain.push(inner);
    }
    const content = this.items(plain, false);
    if (content.length) {
      if (!sig.slots.length) throw new MkpError('mkp.no-slot', `${sig.name} has no slot to hold the container's Markdown`, p);
      node.children = content;
    }
    if (it.attrs) this.applyAttrs(node, it.attrs.id, it.attrs.props, it.attrs.line, sig);
    this.requireInputs(node, sig, p);
    return node;
  }

  private args(text: string, line: number, col: number): Arg[] {
    if (!text.trim()) return [];
    return chunks(text).map((c) => {
      const p = this.p(line, col + c.at);
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(?!=)/.exec(c.text);
      if (m) return { key: m[1], value: parseValueString(c.text.slice(m[0].length), this.file, line, col + c.at + m[0].length), p };
      return { value: parseValueString(c.text, this.file, line, col + c.at), p };
    });
  }

  private applyAttrs(node: IRNode, id: string | undefined, props: Record<string, string>, line: number, sig: Sig | null): void {
    if (id) (node.meta ??= {}).anchor = id;
    for (const [k, v] of Object.entries(props)) {
      const p = this.p(line);
      if (!sig) {
        this.diags.warn('mkp.attrs', `attribute ${k} on a Markdown block is ignored; only #id applies`, p);
        continue;
      }
      const inp = sig.inputs.get(k);
      if (!inp) throw new MkpError('mkp.unknown-prop', `${sig.name} has no input "${k}"`, p);
      node.props![k] = this.dc.value(parseValueString(v, this.file, line, 1), inp.type, this.dc.scope, p);
    }
    void pos;
    void T;
  }
}
