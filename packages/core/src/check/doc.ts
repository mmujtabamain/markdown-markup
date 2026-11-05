// Checking a document (spec 5, 6.23): widget blocks against their inputs, containers, attributes,
// document state, front matter. A document is checked as a synthetic definition, so its state
// blocks and {ref: name} bindings work like any definition's state.

import YAML from 'yaml';
import { Diagnostics, MkpError, Pos, didYouMean } from '../diag';
import type { IRDef, IRNode, IRVal } from '../ir';
import { markdownToNodes } from '../markdown';
import { chunks } from '../syntax/lexer';
import { parseDoc, type DocItem, type DocSyn } from '../syntax/doc';
import { yamlPositions, type YamlAt } from '../syntax/yamlpos';
import { parseExprString, parseMkp, parseValueString, type Arg, type DefSyn, type MkpFile } from '../syntax/mkp';
import { fits, resolve, showType, T, Type } from '../types';
import { DefChecker, instantiate, pos, signatureOf, unify, yamlType, type Sig, type DefCheckOptions } from './def';
import type { PackInfo, Program } from './program';

export const DOC_PACK = '$doc';

/** A document's definitions, inline and in its file together, are capped at this many lines. */
export const DOC_DEF_LINES = 800;

export interface CheckedDoc {
  file: string;
  front: Record<string, unknown>;
  body: IRNode[];
  def: IRDef;
  uses: Set<string>;
  /** the program the document was checked with: its own definitions on top of the packs' */
  prog: Program;
  /** the document's own definitions (inline and its file), checked */
  defs: IRDef[];
  /** where each front-matter key is written */
  frontAt: (key: string) => Pos | undefined;
}

/** The document's file: name.mkp beside name.mkp.md, holding its definitions moved out of it. */
export interface DocFile {
  text: string;
  file: string;
}

export interface DocCheckOptions extends DefCheckOptions {
  docFile?: DocFile;
  /** a pack whose private definitions the document may use (its fixture cases) */
  privateOf?: string;
}

/** Every mkp fence of a document, containers included. */
function fences(items: DocItem[]): Extract<DocItem, { k: 'defs' }>[] {
  const out: Extract<DocItem, { k: 'defs' }>[] = [];
  for (const it of items) {
    if (it.k === 'defs') out.push(it);
    if (it.k === 'container') out.push(...fences(it.items));
  }
  return out;
}

/** Names a document's definition may not take: they would hide what the reader means (6.4). */
const DOC_RESERVED = new Set(['document']);

/**
 * The document's own definitions (6.25): parsed with the document's own line numbers, added to an
 * overlay of the program and checked. A name a pack or core already gives is refused (mkp.shadow).
 */
function documentDefs(prog: Program, syn: DocSyn, src: string, file: string, diags: Diagnostics, opts: DocCheckOptions): { prog: Program; defs: IRDef[]; sigs: Map<string, Sig> } {
  const fs = fences(syn.items);
  if (!fs.length && !opts.docFile) return { prog, defs: [], sigs: opts.sigs };
  const files: MkpFile[] = [];
  let lines = 0;
  if (fs.length) {
    // each fence's lines where they are in the document, so positions are the document's own
    const total = src.split('\n').length;
    const text: string[] = Array.from({ length: total }, () => '');
    for (const f of fs) {
      const body = f.body.split('\n');
      body.forEach((l, i) => (text[f.line + i] = l));
      lines += body.filter((l) => l.trim()).length;
    }
    files.push(parseMkp(text.join('\n'), file, diags, { inline: true }));
  }
  if (opts.docFile) {
    files.push(parseMkp(opts.docFile.text, opts.docFile.file, diags, { inline: true }));
    lines += opts.docFile.text.split('\n').filter((l) => l.trim()).length;
  }
  const at = (p?: Pos): Pos => p ?? { file, line: fs[0]?.line ?? 1, col: 1 };
  if (lines > DOC_DEF_LINES) diags.error('mkp.doc-size', `the document's own definitions are ${lines} lines; at most ${DOC_DEF_LINES} — a definition used this much belongs in a pack`, at());
  const names = new Set<string>();
  for (const f of files) {
    f.items = f.items.filter((it) => {
      if (it.item === 'def' || it.item === 'type' || it.item === 'fn' || it.item === 'op' || it.item === 'const') return true;
      diags.error('mkp.doc-item', `a document defines widgets, parts, types and fns; ${it.item === 'manifest' ? 'a manifest' : it.item === 'tokens' ? 'tokens' : it.item === 'macro' ? 'a macro' : 'an interface'} belongs in a pack`, at(it.p));
      return false;
    });
    for (const it of f.items) {
      const name = 'symbol' in it ? (it as { symbol: string }).symbol : (it as { name: string }).name;
      if (it.item !== 'op') names.add(name);
      if (it.item !== 'def' && it.item !== 'type') continue;
      if (DOC_RESERVED.has(name)) {
        diags.error('mkp.shadow', `"${name}" is reserved for the document itself; name the definition something else`, it.p);
        continue;
      }
      // a pack's or core's name: a copy must be renamed (mkp show --source --as)
      const hit = it.item === 'def' ? prog.lookupDefs(name, DOC_PACK)[0] : prog.lookupType(name, DOC_PACK);
      if (hit) diags.error('mkp.shadow', `${name} is already ${hit.pack === 'core' ? 'a base widget or type' : `provided by ${hit.pack}`}; give this one its own name${it.item === 'def' ? ' (mkp show --source --as copies one renamed)' : ''}`, it.p);
    }
  }
  const info: PackInfo = {
    name: DOC_PACK,
    version: 1,
    kind: 'pack',
    requires: ['core@1'],
    depends: [],
    provides: names,
    manifest: { item: 'manifest', kind: 'pack', name: DOC_PACK, version: 1, requires: ['core@1'], depends: [], provides: [...names], front: [], attrs: [], roles: [], rules: [], p: { file, line: 1, col: 1 }, comments: [] },
    files,
    fixtures: [],
    assets: new Map(),
    documents: [],
    digest: '',
  };
  const p2 = prog.overlay(diags);
  p2.addPack(info);
  const sigs = new Map(opts.sigs);
  const entries = [...p2.defs.values()].filter((d) => d.pack === DOC_PACK);
  for (const d of entries) sigs.set(d.id, signatureOf(p2, d));
  const defs: IRDef[] = [];
  const checkers: DefChecker[] = [];
  for (const d of entries) {
    const dc = new DefChecker(p2, d, diags, { ...opts, sigs });
    try {
      const ir = dc.check();
      ir.inline = true;
      // a document's widget is read without it by any reader of the Markdown (6.25); one that holds
      // content (a slot) writes that content, so it needs none of its own
      const holds = ir.inputs.some((i) => i.type.t === 'slot' || (i.type.t === 'records' && i.type.slot));
      if (d.syn.kind === 'widget' && !ir.project?.md && !holds) diags.error('mkp.no-project', `${d.syn.name} has no project md: a document's widget says in Markdown what it shows, for readers without it`, d.syn.p);
      defs.push(ir);
      checkers.push(dc);
    } catch (e) {
      dc.err(e);
    }
  }
  for (const dc of checkers) dc.runDeferred();
  return { prog: p2, defs, sigs };
}

export function checkDocument(prog0: Program, src: string, file: string, diags: Diagnostics, opts: DocCheckOptions): CheckedDoc {
  const syn = parseDoc(src, file, diags);
  if (opts.privateOf) {
    prog0 = prog0.overlay(diags);
    prog0.privateFor = opts.privateOf;
  }
  const own = documentDefs(prog0, syn, src, file, diags, opts);
  const prog = own.prog;
  opts = { ...opts, sigs: own.sigs };
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
  duplicateAnchors(body, file, diags);
  const fp = syn.front !== null ? yamlPositions(syn.front) : new Map<string, YamlAt>();
  const frontAt = (k: string): Pos | undefined => {
    const hit = fp.get(k);
    return hit ? { file, line: syn.frontLine + hit.line - 1, col: hit.col } : undefined;
  };
  return { file, front: d.front(syn), body, def, uses: dc.uses, prog, defs: own.defs, frontAt };
}

/** An anchor names one block: links, a host's ids and progress keyed by it would reach only the first. */
function duplicateAnchors(body: IRNode[], file: string, diags: Diagnostics): void {
  const seen = new Map<string, number>();
  const walk = (nodes: IRNode[]): void => {
    for (const n of nodes) {
      const id = n.meta?.anchor;
      const line = n.pos?.[0] ?? 1;
      if (id) {
        const first = seen.get(id);
        if (first === undefined) seen.set(id, line);
        else diags.error('mkp.duplicate-anchor', `#${id} is already the anchor of the block on line ${first}; give this one another`, { file, line, col: n.pos?.[1] ?? 1 });
      }
      walk(n.children ?? []);
      for (const kids of Object.values(n.fills ?? {})) walk(kids);
    }
  };
  walk(body);
}

class DocChecker {
  /** the block being checked: where its YAML starts, and where each key and item is in it */
  private yamlAt: { line: number; map: Map<string, YamlAt> } | null = null;

  constructor(
    readonly prog: Program,
    readonly dc: DefChecker,
    readonly diags: Diagnostics,
    readonly file: string,
  ) {}

  p(line: number, col = 1): Pos {
    return { file: this.file, line, col };
  }

  /** The position of a YAML key or item ("items[1].city") in the block, or the fallback. */
  at(what: string, fallback: Pos): Pos {
    const y = this.yamlAt;
    if (!y) return fallback;
    // "the picklist block" and record kinds are not paths
    const hit = y.map.get(what) ?? y.map.get(what.replace(/^[^.[]+\./, ''));
    return hit ? this.p(y.line + hit.line - 1, hit.col) : fallback;
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
      const m = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.exec(v);
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
          case 'defs':
            break;
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
      .map((l) => /^\s*(?:var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+(?:=|[a-z(])/.exec(l)?.[1])
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
    let sig = this.widgetSig(it.name, p);
    let data: unknown;
    try {
      data = it.yaml.trim() ? YAML.parse(it.yaml, { strict: true, uniqueKeys: true }) : {};
    } catch (e) {
      throw new MkpError('mkp.yaml', `the ${sig.name} block is not valid YAML: ${(e as Error).message.split('\n')[0]}`, this.p(it.line + 1));
    }
    if (data === null || data === undefined) data = {};
    this.yamlAt = { line: it.line + 1, map: yamlPositions(it.yaml) };
    if (typeof data !== 'object' || Array.isArray(data)) throw new MkpError('mkp.yaml', `the ${sig.name} block must be a YAML mapping of its inputs`, p);
    const obj = data as Record<string, unknown>;
    this.guard(obj, this.p(it.line + 1), `the ${sig.name} block`);
    if (sig.params?.length) sig = this.bindYaml(sig, obj, it);
    const node: IRNode = { node: sig.name, def: sig.id, props: {}, pos: [it.line, 1] };
    const summary = obj.summary;
    if (typeof summary !== 'string' || !summary.trim()) {
      this.diags.error('mkp.missing-summary', `the ${sig.name} block needs a summary: line (what it shows, for readers without the widget and for Markdown output)`, p);
    } else (node.meta ??= {}).summary = summary;
    if (it.id) (node.meta ??= {}).anchor = it.id;
    const failed = new Set<string>();
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'summary') continue;
      try {
        this.setProp(node, sig, k, v, this.p(this.lineOf(it, k)));
      } catch (e) {
        failed.add(k);
        this.dc.err(e);
      }
    }
    if (it.attrs) this.applyAttrs(node, it.attrs.id, it.attrs.props, it.attrs.line, sig);
    this.requireInputs(node, sig, p, failed);
    this.yamlAt = null;
    return node;
  }

  /** A block's type parameters, told from its YAML: items: [{city: Lisbon, …}] makes T {city: text, …}. */
  private bindYaml(sig: Sig, obj: Record<string, unknown>, it: { line: number; yaml: string }): Sig {
    const params = sig.params!;
    const bound: Record<string, Type> = {};
    const env = this.prog.typeEnv(sig.pack);
    // only data tells a parameter (rows: list(R)); a path or an expression in R only reads it
    const holds = (t: Type): boolean => {
      if ((t.t === 'named' || t.t === 'param') && params.includes(t.name)) return true;
      if (t.t === 'list' || t.t === 'dict') return holds(t.of);
      if (t.t === 'rec') return t.fields.some(([, f]) => holds(f));
      return false;
    };
    for (const [k, v] of Object.entries(obj)) {
      const inp = sig.inputs.get(k);
      if (!inp || !holds(inp.type)) continue;
      let got: Type;
      try {
        got = yamlType(v, k);
      } catch (e) {
        throw new MkpError('mkp.input-type', (e as Error).message, this.p(this.lineOf(it, k)));
      }
      const err = unify(inp.type, got, params, bound, env);
      if (err) throw new MkpError('mkp.input-type', err, this.p(this.lineOf(it, k)));
    }
    const missing = params.filter((x) => !bound[x]);
    if (missing.length) throw new MkpError('mkp.input-type', `${sig.name} can't tell what ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'}: give the inputs that hold ${missing.length > 1 ? 'them' : 'it'}`, this.p(it.line));
    return instantiate(sig, bound);
  }

  private looksLikeWidget(yaml: string): boolean {
    return /^summary:/m.test(yaml);
  }

  private lineOf(it: { line: number; yaml: string }, key: string): number {
    const hit = this.yamlAt?.map.get(key);
    if (hit) return it.line + hit.line;
    const i = it.yaml.split('\n').findIndex((l) => l.startsWith(key + ':'));
    return it.line + 1 + Math.max(0, i);
  }

  private requireInputs(node: IRNode, sig: Sig, p: Pos, failed = new Set<string>()): void {
    for (const [name, inp] of sig.inputs) {
      if (inp.hasDefault || node.props?.[name] !== undefined || failed.has(name)) continue;
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
      // a slot may hold a fragment of a document, widget blocks and containers too (GAPS 88)
      const fragment = /^(`{3,}|~{3,}|:{3,})/m.test(v);
      const nodes = fragment ? this.items(parseDoc('\n'.repeat(Math.max(0, p.line)) + v, this.file, this.diags).items, false) : markdownToNodes(v, p.line);
      if (sig.slots[0] === k) node.children = nodes;
      else (node.fills ??= {})[k] = nodes;
      return;
    }
    if (t.t === 'records') {
      if (!Array.isArray(v)) throw new MkpError('mkp.input-type', `${k} is a list of ${t.kind} records: give a YAML list of objects`, p);
      v.forEach((r, i) => (node.records = [...(node.records ?? []), this.yamlRecord(r, t, sig, this.at(`${k}[${i}]`, p), k, `${k}[${i}]`)]));
      return;
    }
    node.props![k] = this.yamlValue(v, inp.type, sig.pack, p, k);
  }

  private yamlRecord(r: unknown, t: Extract<Type, { t: 'records' }>, sig: Sig, p: Pos, input: string, path = input): IRNode {
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
      if (!f) throw new MkpError('mkp.unknown-field', `${t.kind} has no field "${k}"${didYouMean(k, t.fields.map((x) => x[0]))}`, this.at(`${path}.${k}`, p));
      const ft = resolve(f[1], this.prog.typeEnv(sig.pack));
      if (ft.t === 'records') {
        if (!Array.isArray(v)) throw new MkpError('mkp.input-type', `${k} is a list of ${ft.kind} records`, this.at(`${path}.${k}`, p));
        v.forEach((x, i) => (out.records ??= []).push(this.yamlRecord(x, ft, sig, this.at(`${path}.${k}[${i}]`, p), k, `${path}.${k}[${i}]`)));
        continue;
      }
      props[k] = this.yamlValue(v, f[1], sig.pack, this.at(`${path}.${k}`, p), `${path}.${k}`);
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
      throw new MkpError('mkp.input-type', `${what} is ${want}; found ${JSON.stringify(v)}`, this.at(what, p));
    };
    switch (t.t) {
      case 'num':
      case 'int': {
        if (typeof v !== 'number') return bad(t.t === 'int' ? 'a whole number' : 'a number');
        if (t.t === 'int' && !Number.isInteger(v)) return bad('a whole number');
        if (t.lo !== undefined && (v < t.lo || v > t.hi!)) throw new MkpError('mkp.input-range', `${what} is ${v}, outside ${t.lo}..${t.hi}`, this.at(what, p));
        return { lit: v };
      }
      case 'bool':
        if (typeof v === 'string' && /^(yes|no|on|off|y|n)$/i.test(v)) throw new MkpError('mkp.input-type', `${what} is true or false; "${v}" is text in YAML 1.2: write ${/^(yes|on|y)$/i.test(v) ? 'true' : 'false'}`, this.at(what, p));
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
        throw new MkpError('mkp.enum', `${what} is one of ${t.opts.join(', ')}; found ${JSON.stringify(v)}`, this.at(what, p));
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
        throw new MkpError('mkp.unknown-token', `${what} is a ${t.kind} token; "${String(v)}" is not one${didYouMean(String(v), this.dc.opts.tokenNames(t.kind))}`, this.at(what, p));
      case 'ref': {
        const r = v as { ref?: unknown };
        if (!r || typeof r !== 'object' || typeof r.ref !== 'string') return bad('{ref: name} of a state line in a state block');
        const b = this.dc.scope.get(r.ref);
        if (!b || (b.kind !== 'state' && b.kind !== 'var')) throw new MkpError('mkp.not-state', `"${r.ref}" is not declared in a state block of this document`, this.at(what, p));
        if (!fits(b.type, t.of, env)) throw new MkpError('mkp.input-type', `${what} is ${showType(t.of)}, but ${r.ref} is ${showType(b.type)}`, this.at(what, p));
        return { ref: r.ref };
      }
      case 'path':
        if (typeof v !== 'string') return bad('a field name');
        return this.dc.pathTo(v, t, this.at(what, p));
      case 'expr': {
        if (typeof v !== 'string' && typeof v !== 'number') return bad(`an expression in ${t.vars.map((x) => x[0]).join(', ')}`);
        const e = parseExprString(String(v), this.file, p.line, p.col);
        return this.dc.value({ v: 'expr', e, src: String(v), p }, type, this.dc.scope, p);
      }
      case 'list': {
        if (!Array.isArray(v)) return bad(`a list of ${showType(t.of)}`);
        const items = v.map((x, i) => this.yamlData(x, t.of, env, p, `${what}[${i}]`));
        return { lit: items };
      }
      default:
        return { lit: this.yamlData(v, type, env, p, what) };
    }
  }

  /** Plain data values (inside lists and records): the runtime representation. */
  private yamlData(v: unknown, type: Type, env: (n: string) => Type | undefined, p: Pos, what: string): unknown {
    const t = resolve(type, env);
    const bad = (want: string): never => {
      throw new MkpError('mkp.input-type', `${what} is ${want}; found ${JSON.stringify(v)}`, this.at(what, p));
    };
    switch (t.t) {
      case 'num':
      case 'int':
        if (typeof v !== 'number' || (t.t === 'int' && !Number.isInteger(v))) return bad(t.t === 'int' ? 'a whole number' : 'a number');
        if (t.lo !== undefined && (v < t.lo || v > t.hi!)) throw new MkpError('mkp.input-range', `${what} is ${v}, outside ${t.lo}..${t.hi}`, this.at(what, p));
        return v;
      case 'bool':
        return typeof v === 'boolean' ? v : bad('true or false');
      case 'text':
      case 'latex':
        return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : bad('text');
      case 'choice':
        return typeof v === 'string' && t.opts.includes(v) ? v : bad(`one of ${t.opts.join(', ')}`);
      case 'token':
        // a colour in a YAML record is a token name (GAPS 155)
        if (typeof v === 'string' && (v === 'none' || this.dc.opts.tokenNames(t.kind).has(v))) return v;
        throw new MkpError('mkp.unknown-token', `${what} is a ${t.kind} token; "${String(v)}" is not one${didYouMean(String(v), this.dc.opts.tokenNames(t.kind))}`, this.at(what, p));
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
        for (const k of Object.keys(src)) if (!t.fields.some((f) => f[0] === k)) throw new MkpError('mkp.unknown-field', `${what} has no field "${k}"${didYouMean(k, t.fields.map((f) => f[0]))}`, this.at(what, p));
        for (const [k, ft] of t.fields) {
          if (!(k in src)) {
            const d = t.defaults?.[k];
            if (d !== undefined) {
              const dv = this.dc.staticValue(parseValueString(d), ft, p) as Record<string, unknown>;
              o[k] = 'lit' in dv ? dv.lit : 'text' in dv ? dv.text : 'tex' in dv ? dv.tex : 'tok' in dv ? dv.tok : 'ms' in dv ? dv.ms : dv.lit;
              continue;
            }
            throw new MkpError('mkp.missing-field', `${what} needs ${k} (${showType(ft)})`, this.at(what, p));
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
      // a profile's block attribute (16), on any block; a widget's own input of that name wins
      if (this.dc.opts.blockAttrs?.has(k) && !sig?.inputs.has(k)) {
        ((node.meta ??= {}).attrs ??= {})[k] = v.replace(/^"(.*)"$/s, '$1');
        continue;
      }
      if (!sig) {
        // section roles for profiles (16): {role=example} on a heading
        if (k === 'role' && node.node === 'heading') {
          (node.meta ??= {}).role = v.replace(/^"|"$/g, '');
          continue;
        }
        this.diags.warn('mkp.attrs', `attribute ${k} on a Markdown block is ignored; only #id, role= (on headings) and the profile's block attributes apply`, p);
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
