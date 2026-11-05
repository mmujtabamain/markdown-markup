// Checking a document (spec 5, 6.23): widget blocks against their inputs, containers, attributes,
// document state, front matter. A document is checked as a synthetic definition, so its state
// blocks and {ref: name} bindings work like any definition's state.

import YAML from 'yaml';
import { Diagnostics, MkpError, Pos, closest } from '../diag';
import { compileAst, Env, type Programme } from '../eval';
import type { IRDef, IRExpr, IRNode, IRVal } from '../ir';
import { markdownToNodes } from '../markdown';
import { chunks } from '../syntax/lexer';
import { parseDoc, type DocItem, type DocSyn } from '../syntax/doc';
import { yamlPositions, type YamlAt } from '../syntax/yamlpos';
import { parseExprString, parseMkp, parseValueString, type Arg, type DefSyn, type MkpFile } from '../syntax/mkp';
import { fits, join, resolve, showType, T, Type, type TypeEnv } from '../types';
import { DefChecker, instantiate, pos, signatureOf, unify, yamlType, type Sig, type DefCheckOptions } from './def';
import type { PackInfo, Program } from './program';

/** A record field's default written as an expression, such as a point (1, 2), as the data it stands for. */
function constant(e: IRExpr, what: string, p: Pos): unknown {
  try {
    return compileAst(e.ast)(new Env(null, null, null, {} as Programme));
  } catch {
    const dot = what.lastIndexOf('.');
    const field = what.slice(dot + 1);
    const parent = dot > 0 ? what.slice(0, dot) : 'the block';
    throw new MkpError('mkp.missing-field', `${what} is left out, and its default ${e.expr} is a calculation that YAML data can't work out. Write ${field} yourself in ${parent}, e.g. {…, ${field}: 4}, or make the default a plain value in the type`, p);
  }
}

// ---- wording helpers: what a value is, what was written, a short example ----

/** A value as the author wrote it, short: "big", [a, b], nothing. */
function shown(v: unknown): string {
  if (v === null || v === undefined) return 'nothing';
  const s = typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) || typeof v === 'object' ? JSON.stringify(v).replace(/"([A-Za-z_][\w]*)":/g, '$1: ') : String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

/** What sort of YAML value this is: a list, text, a number… */
function sortOf(v: unknown): string {
  if (v === null || v === undefined) return 'nothing';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'a mapping';
  if (typeof v === 'string') return `the text ${shown(v)}`;
  if (typeof v === 'boolean') return `${v}`;
  return `the number ${v}`;
}

/** Names joined for a message, cut short when there are many. */
function names(xs: Iterable<string>, max = 12): string {
  const a = [...xs];
  return a.length > max ? a.slice(0, max).join(', ') + ', …' : a.join(', ');
}

/** A type in plain words: "a whole number from 1 to 5", "true or false", "a list of text". */
function words(type: Type, env: TypeEnv): string {
  const t = resolve(type, env);
  switch (t.t) {
    case 'num':
    case 'int': {
      const n = t.t === 'int' ? 'a whole number' : 'a number';
      return t.lo !== undefined && t.hi !== undefined ? `${n} from ${t.lo} to ${t.hi}` : n;
    }
    case 'bool':
      return 'true or false';
    case 'text':
      return 'text';
    case 'latex':
      return 'maths';
    case 'choice':
      return `one of ${t.opts.join(', ')}`;
    case 'token':
      return `a ${t.kind} token`;
    case 'point':
      return 'a point [x, y]';
    case 'duration':
      return 'a duration such as 6s';
    case 'range':
      return 'a range [a, b]';
    case 'slot':
      return 'Markdown';
    case 'list':
      return `a list of ${words(t.of, env).replace(/^an? /, '')}`;
    case 'ref':
      return `a reference to ${words(t.of, env).replace(/^an? /, '')} state`;
    case 'records':
      return `a list of ${t.kind} records`;
    case 'rec':
      return t.name ? `a ${t.name}` : `a record {${t.fields.map((f) => f[0]).join(', ')}}`;
    default:
      return showType(type);
  }
}

/** A short example value of a type, as YAML (or, with arg, as a ::: line argument). */
function example(type: Type, env: TypeEnv, tokens: (kind: string) => Set<string>, arg = false, depth = 0): string {
  const t = resolve(type, env);
  switch (t.t) {
    case 'num':
    case 'int':
      return String(t.lo ?? 1);
    case 'bool':
      return 'true';
    case 'text':
      return arg ? '"Some text"' : 'Some text';
    case 'latex':
      return `'$x^2$'`;
    case 'choice':
      return t.opts[0];
    case 'token':
      return [...tokens(t.kind)][0] ?? 'none';
    case 'point':
      return '[0, 1]';
    case 'duration':
      return '6s';
    case 'range':
      return '[0, 10]';
    case 'slot':
      return arg ? '"Some words."' : 'Some words.';
    case 'records':
    case 'rec': {
      if (depth > 1) return '{…}';
      const req = t.fields.filter(([n]) => t.defaults?.[n] === undefined);
      const body = `{${(req.length ? req : t.fields).map(([n, f]) => `${n}: ${example(f, env, tokens, false, depth + 1)}`).join(', ')}}`;
      return t.t === 'records' ? `[${body}]` : body;
    }
    case 'list':
      return depth > 1 ? '[…]' : `[${example(t.of, env, tokens, false, depth + 1)}]`;
    case 'ref':
      return '{ref: name}';
    default:
      return '…';
  }
}

/** "Write … e.g. size: 3" for a top-level key, "e.g. 3" inside a list or record. */
function eg(what: string, value: string): string {
  return /[.[]/.test(what) ? value : `${what}: ${value}`;
}

/** A control for a state line of this type, for an example declaration. */
function controlFor(type: Type, env: TypeEnv): string {
  const t = resolve(type, env);
  if (t.t === 'bool') return 'toggle';
  if (t.t === 'choice') return `choice(${t.opts.join('|')})`;
  if (t.t === 'num' || t.t === 'int') return `slider ${t.lo ?? 0}..${t.hi ?? 10}`;
  return `slider 0..10`;
}

/**
 * A YAML library error in plain words, at its place in the file: what is wrong on which line, what
 * was written, and how to fix it (often: quote the value).
 */
function yamlProblem(e: unknown, text: string, firstLine: number, file: string, where: string): { message: string; pos: Pos } {
  const err = e as { code?: string; message?: string; linePos?: { line: number; col: number }[] };
  const raw = String(err.message ?? e).split('\n')[0];
  const lib = raw.replace(/ at line \d+, column \d+:?$/, '');
  const lines = text.split('\n');
  let line = err.linePos?.[0]?.line ?? 1;
  let col = err.linePos?.[0]?.col ?? 1;
  const src = (n: number): string => lines[n - 1] ?? '';
  const here = (): string => src(line).trim();
  const keyOf = (s: string): string | undefined => /^\s*(?:-\s+)?([^\s:#'"][^:]*?|"[^"]*"|'[^']*'):(?:\s|$)/.exec(s)?.[1];
  let message: string;
  if (err.code === 'BLOCK_AS_IMPLICIT_KEY' && /Nested mappings/.test(lib)) {
    const l = src(line);
    const key = keyOf(l);
    const value = l.slice(col - 1).trim();
    if (key && /:(\s|$)/.test(value)) {
      message = `${where} has a value with ": " (a colon and a space) in it, which YAML reads as a second key; found ${key}: ${value}. Quote the value: ${key}: "${value.replace(/"/g, '\\"')}"`;
    } else {
      message = `${where} has a line indented under ${key ?? 'a key'}: ${value}, which YAML reads as a nested key inside that value. Indent it like the lines around it, or quote the value if the colon is part of the text`;
    }
  } else if (err.code === 'BLOCK_AS_IMPLICIT_KEY') {
    message = `${where} has a list item where YAML expects key: value; found ${here()}. Indent the item under the key it belongs to, e.g. items: and then   ${here()} on the next line`;
  } else if (err.code === 'DUPLICATE_KEY') {
    const key = /^["']?([^:"',}\s]+)/.exec(src(line).slice(col - 1))?.[1] ?? 'a key';
    message = `${where} gives ${key} twice, and each key may appear once; found a second ${key}: here. Remove one of them, or rename it`;
  } else if (err.code === 'MISSING_CHAR' && /^Missing closing ["']quote/.test(lib)) {
    const q = lib.includes('"') ? '"' : "'";
    // the line that opens the quote: the first one, up to the error, with an odd number of them
    for (let n = 1; n <= Math.min(line, lines.length); n++) {
      const count = q === '"' ? (src(n).match(/(?<!\\)"/g) ?? []).length : (src(n).replace(/''/g, '').match(/'/g) ?? []).length;
      if (count % 2) {
        line = n;
        col = src(n).indexOf(q) + 1;
        break;
      }
    }
    message = `${where} has a value that opens with ${q} but never closes it; found ${here()}. Add the closing ${q} at the end of the value, e.g. ${here()}${q}`;
  } else if (err.code === 'BAD_INDENT' && /^Flow (sequence|map)/.test(lib)) {
    const open = lib.startsWith('Flow sequence') ? '[' : '{';
    const close = open === '[' ? ']' : '}';
    for (let n = line - 1; n >= 1; n--) {
      if (src(n).includes(open)) {
        line = n;
        col = src(n).indexOf(open) + 1;
        break;
      }
    }
    message = `${where} opens a ${open === '[' ? 'list' : 'mapping'} with ${open} that is never closed; found ${here()}. Close it with ${close} on the same line, e.g. ${here()}${close}`;
  } else if (err.code === 'BAD_INDENT') {
    message = `${where} has a line indented differently from the ${/sequence/.test(lib) ? 'list items' : 'keys'} around it; found ${here()}. Line it up with the others, using the same number of spaces`;
  } else if (err.code === 'BAD_DQ_ESCAPE') {
    const seq = /sequence (\S+)/.exec(lib)?.[1] ?? 'a backslash';
    const fixed = src(line).trim().replace(/"((?:[^"\\]|\\.)*)"/, (_, s: string) => `'${s.replace(/'/g, "''")}'`);
    message = `${where} has ${seq} inside "double quotes", where a backslash starts an escape and ${seq} is not one. Write LaTeX in 'single quotes': ${fixed}`;
  } else if (err.code === 'TAB_AS_INDENT') {
    message = `${where} indents a line with a tab; found a tab before ${src(line).trim() || 'an empty line'}. Replace the tab with spaces: YAML indents with spaces only`;
  } else if (err.code === 'BAD_SCALAR_START') {
    const l = src(line);
    const value = l.slice(col - 1).trim();
    const key = keyOf(l);
    message = `${where} has a value starting with ${value[0]}, which YAML reserves; found ${value}. Quote it: ${key ? `${key}: ` : ''}'${value.replace(/'/g, "''")}'`;
  } else if (err.code === 'MULTILINE_IMPLICIT_KEY' || /^Implicit map keys need/.test(lib)) {
    message = `${where} has a line that is not key: value; found ${here()}. Write it as key: value, or indent it under the key above if it continues that value`;
  } else if (err.code === 'UNEXPECTED_TOKEN' && /at node end/.test(lib)) {
    const rest = src(line).slice(col - 1).trim();
    message = `${where} has text after a value has ended; found ${rest} after ${src(line).slice(0, col - 1).trim()}. Remove it, or quote the whole value`;
  } else if (err.code === 'MISSING_CHAR' && /^Missing ,/.test(lib)) {
    message = `${where} has two items in [ … ] or { … } with no comma between them; found ${here()}. Add a comma between the items, or quote an item that holds a colon`;
  } else if (err.code === 'MISSING_CHAR' && /^Comments must be separated/.test(lib)) {
    message = `${where} has a # straight after other text; found ${here()}. Quote the value if # is part of it, or put a space before the # of a comment`;
  } else if (/^Unresolved alias/.test(lib)) {
    const name = /: (\S+)$/.exec(lib)?.[1] ?? '';
    const n = lines.findIndex((l) => l.includes('*' + name));
    if (n >= 0) {
      line = n + 1;
      col = lines[n].indexOf('*' + name) + 1;
    }
    message = `${where} has *${name}, which YAML reads as a reference to an anchor &${name} that isn't set. Quote the value if it is text, e.g. '*${name}'`;
  } else {
    message = `${where} is not valid YAML here: ${lib.replace(/\.$/, '')}; found ${here() || 'an empty line'}. Check the quoting on this line: quote a value that holds : # [ ] { } or starts with a special character`;
  }
  return { message, pos: { file, line: firstLine + line - 1, col } };
}


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
  if (lines > DOC_DEF_LINES) {
    const where = [fs.length ? 'its mkp fences' : '', opts.docFile ? opts.docFile.file.split('/').pop() : ''].filter(Boolean).join(' and ');
    diags.error('mkp.doc-size', `the document's own definitions (${where}, blank lines not counted) are ${lines} lines, over the limit of ${DOC_DEF_LINES}. Move the larger definitions into a pack and use them from there, or shorten them`, at());
  }
  const names = new Set<string>();
  for (const f of files) {
    f.items = f.items.filter((it) => {
      if (it.item === 'def' || it.item === 'type' || it.item === 'fn' || it.item === 'op' || it.item === 'const') return true;
      const what = it.item === 'manifest' ? 'a manifest' : it.item === 'tokens' ? 'a tokens set' : it.item === 'macro' ? 'a maths macro' : 'an interface';
      const name = (it as { name?: string }).name;
      diags.error('mkp.doc-item', `a document's mkp fence may define widgets, parts, types, fns and consts, but not ${what}; found ${it.item}${name ? ' ' + name : ''}. Move it into a pack, or Remove it from the fence`, at(it.p));
      return false;
    });
    for (const it of f.items) {
      const name = 'symbol' in it ? (it as { symbol: string }).symbol : (it as { name: string }).name;
      if (it.item !== 'op') names.add(name);
      if (it.item !== 'def' && it.item !== 'type') continue;
      if (DOC_RESERVED.has(name)) {
        diags.error('mkp.shadow', `the name "${name}" is reserved for the document itself, so this ${it.item === 'type' ? 'type' : 'definition'} can't use it. Rename it, e.g. my_${name}, and use the new name in its blocks too`, it.p);
        continue;
      }
      // a pack's or core's name: a copy must be renamed (mkp show --source --as)
      const hit = it.item === 'def' ? prog.lookupDefs(name, DOC_PACK)[0] : prog.lookupType(name, DOC_PACK);
      if (hit) {
        const isDef = it.item === 'def';
        const which = isDef ? 'widget' : 'type';
        const owner = hit.pack === 'core' ? `a base ${which}` : `a ${which} of the pack ${hit.pack}`;
        const copy = isDef ? `; to change the existing one, copy it under a new name with mkp show ${name} --source --as my_${name}` : '';
        diags.error('mkp.shadow', `${name} is already ${owner}, so this ${which} needs a name of its own. Rename it, e.g. my_${name}${copy}`, it.p);
      }
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
      if (d.syn.kind === 'widget' && !ir.project?.md && !holds) {
        const ex = ir.inputs.find((i) => i.type.t === 'text')?.name ?? '"what it shows"';
        diags.error('mkp.no-project', `${d.syn.name} has no project md line, which every widget defined in a document needs: it is the Markdown readers without MKP see in its place. Add one at the end of the definition, e.g. project md = ${ex}`, d.syn.p);
      }
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
    if (m.m !== 'state' && m.m !== 'var') {
      const at = m.m === 'node' ? m.node.p : m.p;
      const kind = m.m === 'node' ? 'a widget line' : m.m === 'derived' ? 'a derived value' : m.m === 'fn' ? 'a fn' : m.m === 'in' ? 'an input' : m.m === 'project' ? 'a project line' : `a ${m.m} line`;
      const found = (srcLines[at.line - 1] ?? '').trim();
      diags.error('mkp.doc-state', `a state block holds only var lines and state lines, name = control (slider, toggle, choice, steps, drag or clock), e.g. n = slider 0..10 "how many"; found ${kind}${found ? `, ${found}` : ''}. Move it out of the state block, or Remove it`, at);
    }
  }
  defSyn.members = defSyn.members.filter((m) => m.m === 'state' || m.m === 'var');
  const entry = { id: `${DOC_PACK}:document@1`, pack: DOC_PACK, file, syn: defSyn };
  const dc = new DefChecker(prog, entry, diags, opts);
  const def = dc.check();
  const d = new DocChecker(prog, dc, diags, file);
  d.declaredState = states.flatMap((s) => stateLineNames(s.body));
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
        else diags.error('mkp.duplicate-anchor', `#${id} is already the anchor of the block on line ${first}, and an anchor names one block only; found {#${id}} again here. Rename this one, e.g. {#${id}-2}`, { file, line, col: n.pos?.[1] ?? 1 });
      }
      walk(n.children ?? []);
      for (const kids of Object.values(n.fills ?? {})) walk(kids);
    }
  };
  walk(body);
}

/** The names a state block's lines declare. */
function stateLineNames(body: string): string[] {
  return body
    .split('\n')
    .map((l) => /^\s*(?:var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+(?:=|[a-z(])/.exec(l)?.[1])
    .filter((x): x is string => !!x);
}

class DocChecker {
  /** the block being checked: where its YAML starts, and where each key and item is in it */
  private yamlAt: { line: number; map: Map<string, YamlAt> } | null = null;
  /** the names the document's state blocks declare, for messages about {ref: name} */
  declaredState: string[] = [];

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
    let v: unknown;
    try {
      v = YAML.parse(syn.front, { strict: true, uniqueKeys: true });
    } catch (e) {
      const { message, pos } = yamlProblem(e, syn.front, syn.frontLine, this.file, 'the front matter');
      this.diags.error('mkp.front-matter', message, pos);
      return {};
    }
    if (v === null || v === undefined) return {};
    if (typeof v !== 'object' || Array.isArray(v)) {
      this.diags.error('mkp.front-matter', `the front matter must be a YAML mapping of key: value lines; found ${sortOf(v)}. Write each entry as key: value, e.g. title: Notes`, this.p(syn.frontLine));
      return {};
    }
    const fp = yamlPositions(syn.front);
    try {
      this.guard(v, this.p(syn.frontLine), 'the front matter', (path) => {
        const hit = fp.get(path);
        return hit ? this.p(syn.frontLine + hit.line - 1, hit.col) : this.p(syn.frontLine);
      });
    } catch (e) {
      // the same maths guard as a block's, reported under the front matter's own code
      const d = (e as MkpError).diagnostic;
      if (!d) throw e;
      this.diags.error('mkp.front-matter', d.message, d.pos);
      return {};
    }
    return v as Record<string, unknown>;
  }

  /** The YAML maths guard (5): control characters in text mean a backslash was eaten by "…". */
  guard(v: unknown, p: Pos, where: string, locate: (path: string) => Pos = () => p, path = ''): void {
    if (typeof v === 'string') {
      // eslint-disable-next-line no-control-regex
      const m = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.exec(v);
      if (m) {
        // the escape YAML read: its name, and the text as written, backslash put back
        const names: Record<string, [string, string]> = { '\t': ['tab', '\\t'], '\b': ['backspace', '\\b'], '\f': ['form feed', '\\f'], '\v': ['vertical tab', '\\v'], '\r': ['carriage return', '\\r'], '\u0007': ['bell', '\\a'], '\u001b': ['escape', '\\e'] };
        const [name, c] = names[m[0]] ?? ['control character', `U+${m[0].charCodeAt(0).toString(16).padStart(4, '0')}`];
        let written = v;
        for (const [ch, [, esc]] of Object.entries(names)) written = written.split(ch).join(esc);
        if (written.length > 50) written = written.slice(0, 47) + '…';
        const fix = `'${written.replace(/'/g, "''")}'`;
        throw new MkpError('mkp.yaml-control-char', `${where} has a ${name} (${c})${path ? ` in ${path}` : ''}, where a backslash was meant: in "double quotes" ${c} is an escape, so the backslash is lost. Write LaTeX in 'single quotes' instead: ${path ? eg(path, fix) : fix}`, locate(path));
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => this.guard(x, p, where, locate, `${path}[${i}]`));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => this.guard(x, p, where, locate, path ? `${path}.${k}` : k));
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
    return stateLineNames(body);
  }

  private widgetSig(name: string, p: Pos): Sig {
    const sig = this.dc.resolveDef(name, p);
    if (sig.kind === 'part' && !this.dc.opts.allowParts) throw new MkpError('mkp.part-in-document', `${sig.name} is a part, which only other definitions can use, so it can't be a block in a document. Use it inside a widget in an mkp fence, or drop "part" from its definition (and give it a project md) to use it here`, p);
    this.dc.uses.add(sig.id);
    return sig;
  }

  private block(it: Extract<DocItem, { k: 'block' }>): IRNode | null {
    const p = this.p(it.line);
    // a fence whose info string is not a visible widget stays a code block
    const bare = it.name.replace(/@\d+$/, '');
    if (!this.prog.lookupDefs(bare, DOC_PACK).length) {
      if (it.id || it.name.includes('@') || /[.:]/.test(it.name) === false && this.looksLikeWidget(it.yaml)) {
        const near = closest(bare, [...this.prog.defs.values()].filter((d) => d.syn.kind !== 'part').map((d) => d.syn.name));
        const fix = near ? `Did you mean "${near}"? Write \`\`\`${near}` : 'Correct the name after the opening ```, or define the widget in an mkp fence';
        this.diags.error('mkp.unknown-widget', `the fence names a widget "${bare}", but no widget of that name is defined in this document or its packs. ${fix}`, p);
        return null;
      }
      return { node: 'code', def: 'core:code@1', props: { src: { text: it.yaml }, lang: { text: it.info } }, pos: [it.line, 1] };
    }
    let sig = this.widgetSig(it.name, p);
    let data: unknown;
    try {
      data = it.yaml.trim() ? YAML.parse(it.yaml, { strict: true, uniqueKeys: true }) : {};
    } catch (e) {
      const { message, pos } = yamlProblem(e, it.yaml, it.line + 1, this.file, `the ${sig.name} block`);
      throw new MkpError('mkp.yaml', message, pos);
    }
    if (data === null || data === undefined) data = {};
    this.yamlAt = { line: it.line + 1, map: yamlPositions(it.yaml) };
    if (typeof data !== 'object' || Array.isArray(data)) {
      const first = sig.order.find((n) => sig.inputs.has(n)) ?? [...sig.inputs.keys()][0];
      const ex = first ? `${first}: ${example(sig.inputs.get(first)!.type, this.prog.typeEnv(sig.pack), this.dc.opts.tokenNames)}` : 'summary: What it shows.';
      throw new MkpError('mkp.yaml', `the ${sig.name} block must be a YAML mapping of its inputs, one name: value line each; found ${sortOf(data)}. Write each input on its own line, e.g. ${ex}`, this.p(it.line + 1));
    }
    const obj = data as Record<string, unknown>;
    this.guard(obj, this.p(it.line + 1), `the ${sig.name} block`, (path) => this.at(path, this.p(it.line + 1)));
    if (sig.params?.length) sig = this.bindYaml(sig, obj, it);
    const node: IRNode = { node: sig.name, def: sig.id, props: {}, pos: [it.line, 1] };
    const summary = obj.summary;
    if (typeof summary !== 'string' || !summary.trim()) {
      const found = summary === undefined ? 'no summary: line' : summary === null || typeof summary === 'string' ? 'an empty summary' : `summary: ${shown(summary)}, which is not a sentence`;
      const where = summary === undefined ? p : this.at('summary', p);
      this.diags.error('mkp.missing-summary', `the ${sig.name} block needs a summary: line, one sentence of what it shows, for readers without the widget and for Markdown output; found ${found}. Add one, e.g. summary: A short sentence on what it shows.`, where);
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
    const holdsParam = (t: Type, name?: string): boolean => {
      if ((t.t === 'named' || t.t === 'param') && params.includes(t.name)) return name === undefined || t.name === name;
      if (t.t === 'list' || t.t === 'dict') return holdsParam(t.of, name);
      if (t.t === 'rec') return t.fields.some(([, f]) => holdsParam(f, name));
      return false;
    };
    const holds = (t: Type): boolean => holdsParam(t);
    // the part of a given type that stands where the parameter is in the input's declared type
    const partFor = (w: Type, g: Type, name: string): Type | undefined => {
      if ((w.t === 'named' || w.t === 'param') && w.name === name) return g;
      const rg = resolve(g, env);
      if ((w.t === 'list' || w.t === 'dict') && rg.t === w.t) return partFor(w.of, rg.of, name);
      if (w.t === 'rec' && rg.t === 'rec') {
        for (const [n, t] of w.fields) {
          const f = rg.fields.find(([m]) => m === n);
          const r = f && partFor(t, f[1], name);
          if (r) return r;
        }
      }
      return undefined;
    };
    const firstBy: Record<string, string> = {};
    const tStands = (name: string): string => `${name} stands for the kind of items it holds, read from the data`;
    for (const [k, v] of Object.entries(obj)) {
      const inp = sig.inputs.get(k);
      if (!inp || !holds(inp.type)) continue;
      let got: Type;
      try {
        got = yamlType(v, k);
      } catch (e) {
        throw this.shapeProblem(v, k, true, sig) ?? new MkpError('mkp.input-type', (e as Error).message, this.p(this.lineOf(it, k)));
      }
      const before = { ...bound };
      const err = unify(inp.type, got, params, bound, env);
      if (err) {
        // which parameter the two inputs disagree on, and what each gives it
        const name = params.find((x) => before[x] && partFor(inp.type, got, x) && !join(before[x], partFor(inp.type, got, x)!, env));
        if (name && firstBy[name]) {
          const other = firstBy[name];
          throw new MkpError('mkp.input-type', `${k} and ${other} must hold the same kind of items, since ${sig.name} uses one type ${name} for both (${tStands(name)}); found ${showType(partFor(inp.type, got, name)!)} in ${k} but ${showType(before[name])} in ${other}. Give the items of both the same fields with the same kinds of value`, this.p(this.lineOf(it, k)));
        }
        throw new MkpError('mkp.input-type', err, this.p(this.lineOf(it, k)));
      }
      for (const x of params) if (bound[x] && !before[x]) firstBy[x] = k;
    }
    const missing = params.filter((x) => !bound[x]);
    if (missing.length) {
      const holders = [...sig.inputs].filter(([, i]) => missing.some((x) => holdsParam(i.type, x)));
      const given = Object.keys(obj).filter((k) => k !== 'summary');
      const ex = holders.length ? `${holders[0][0]}: ${resolve(holders[0][1].type, env).t === 'list' ? '[{city: Lisbon}]' : '{city: Lisbon}'}` : '';
      const what = missing.join(' and ');
      const are = missing.length > 1 ? 'are' : 'is';
      const fix = holders.length ? `Add ${names(holders.map(([n, i]) => `${n} (${showType(i.type)})`))}, e.g. ${ex}` : `Give the inputs that hold ${missing.length > 1 ? 'them' : 'it'}`;
      throw new MkpError('mkp.input-type', `${sig.name} can't tell what ${what} ${are} (${what} ${missing.length > 1 ? 'stand' : 'stands'} for the kind of items it holds, read from the data), since no input that holds ${what} is given; found ${given.length ? `only ${given.join(', ')}` : 'no inputs'}. ${fix}`, this.p(it.line));
    }
    return instantiate(sig, bound);
  }

  /**
   * Why a block's data has no single type (yamlType refused it), said with the item at fault:
   * an empty list, an empty entry, or an item unlike the ones before it. Null when nothing is found.
   */
  private shapeProblem(v: unknown, what: string, top: boolean, sig: Sig): MkpError | null {
    const at = (w: string): Pos => this.at(w, this.p(this.yamlAt?.line ?? 1));
    if (v === null || v === undefined) return new MkpError('mkp.input-type', `${what} has no value; found an empty entry. Write a value after it, or Remove it`, at(what));
    if (Array.isArray(v)) {
      if (!v.length && top) return new MkpError('mkp.input-type', `${what} is an empty list, so ${sig.name} can't tell what kind of items it holds; found []. Give at least one item, e.g. ${what}: [{city: Lisbon}]`, at(what));
      let t: Type | null = null;
      for (let i = 0; i < v.length; i++) {
        let u: Type;
        try {
          u = yamlType(v[i], `${what}[${i}]`, false);
        } catch {
          return this.shapeProblem(v[i], `${what}[${i}]`, false, sig);
        }
        if (t) {
          const j = join(t, u, () => undefined);
          if (!j) return new MkpError('mkp.input-type', `${what}[${i}] is not like the items before it: ${this.shapeDiff(t, u, what)}`, at(`${what}[${i}]`));
          t = j;
        } else t = u;
      }
      return null;
    }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const r = this.shapeProblem(x, `${what}.${k}`, false, sig);
        if (r) return r;
      }
    }
    return null;
  }

  /** How an item's shape differs from the items before it, and the fix. */
  private shapeDiff(a: Type, b: Type, what: string): string {
    const none = (): undefined => undefined;
    if (a.t === 'rec' && b.t === 'rec') {
      const an = a.fields.map((f) => f[0]);
      const bn = b.fields.map((f) => f[0]);
      const missing = an.filter((n) => !bn.includes(n));
      const extra = bn.filter((n) => !an.includes(n));
      if (missing.length || extra.length) {
        const fix = [missing.length ? `Add ${missing.join(', ')}` : '', extra.length ? `${missing.length ? 'remove' : 'Remove'} ${extra.join(', ')}` : ''].filter(Boolean).join(' and ');
        return `it has the fields ${bn.join(', ') || 'none'}, where the items before it have ${an.join(', ')}; every item of ${what} needs the same fields. ${fix}, or give the others the same fields`;
      }
      for (const [n, ft] of a.fields) {
        const g = b.fields.find((f) => f[0] === n)![1];
        if (!join(ft, g, none)) return `its ${n} is ${words(g, none)}, but in the items before it ${n} is ${words(ft, none)}. Write ${n} as ${words(ft, none)} here too, or as ${words(g, none)} in every item`;
      }
    }
    return `it is ${words(b, none)}, but the items before it are ${words(a, none)}. Write it like the others`;
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

  /** Every input without a default is given; container is the ::: line when the block is one. */
  private requireInputs(node: IRNode, sig: Sig, p: Pos, failed = new Set<string>(), container?: string): void {
    const env = this.prog.typeEnv(sig.pack);
    for (const [name, inp] of sig.inputs) {
      if (inp.hasDefault || node.props?.[name] !== undefined || failed.has(name)) continue;
      const t = resolve(inp.type, env);
      if (t.t === 'records' && node.records?.length) continue;
      const takes = this.takes(inp.type, sig.pack);
      if (container === undefined) {
        this.diags.error('mkp.missing-input', `the ${sig.name} block is missing ${name}, which takes ${takes}. Add a line ${name}: ${example(inp.type, env, this.dc.opts.tokenNames)}`, p);
      } else if (t.t === 'records') {
        const ex = example(T.text, env, this.dc.opts.tokenNames, true);
        this.diags.error('mkp.missing-input', `the :::${sig.name} container is missing ${name}, which takes ${takes}. Add ${t.kind} records inside it, e.g. a :::${t.kind} ${ex} line, its Markdown, and a closing :::`, p);
      } else {
        this.diags.error('mkp.missing-input', `the :::${sig.name} container is missing ${name}, which takes ${takes}. Add it to the ::: line, e.g. ${container} ${name}=${example(inp.type, env, this.dc.opts.tokenNames, true)}`, p);
      }
    }
  }

  /** A record kind's fields, slot included, for a message. */
  private fieldList(t: Extract<Type, { t: 'records' }>): string {
    return names([...t.fields.map((f) => f[0]), ...(t.slot ? ['slot'] : [])]);
  }

  /** A name given to a widget that has no input of that name: its inputs, a near one, the fix. */
  private unknownInput(sig: Sig, k: string, found: string, fix: string, p: Pos): MkpError {
    const near = closest(k, [...sig.inputs.keys(), 'summary']);
    const list = [...sig.inputs.keys()];
    const its = list.length ? `its inputs are ${names(list)}` : 'it takes no inputs';
    return new MkpError('mkp.unknown-prop', `${sig.name} has no input "${k}"; found ${found}${near ? `. Did you mean "${near}"? ${fix.replace(/ to one of them/, '')}` : `, and ${its}. ${fix}`}`, p);
  }

  private setProp(node: IRNode, sig: Sig, k: string, v: unknown, p: Pos): void {
    const inp = sig.inputs.get(k);
    if (!inp) throw this.unknownInput(sig, k, `${k}: ${typeof v === 'string' && v.length < 40 ? v : shown(v)}`, 'Rename the key to one of them, or Remove the line', p);
    const env = this.prog.typeEnv(sig.pack);
    const t = resolve(inp.type, env);
    if (t.t === 'slot') {
      if (typeof v !== 'string') throw new MkpError('mkp.input-type', `${k} is a slot, which takes Markdown written as one piece of text; found ${sortOf(v)}. Write it as text, e.g. ${k}: "Some words.", or as ${k}: | with the Markdown indented on the lines below`, p);
      // a slot may hold a fragment of a document, widget blocks and containers too (GAPS 88)
      const fragment = /^(`{3,}|~{3,}|:{3,})/m.test(v);
      const nodes = fragment ? this.items(parseDoc('\n'.repeat(Math.max(0, p.line)) + v, this.file, this.diags).items, false) : markdownToNodes(v, p.line);
      if (sig.slots[0] === k) node.children = nodes;
      else (node.fills ??= {})[k] = nodes;
      return;
    }
    if (t.t === 'records') {
      if (!Array.isArray(v)) throw new MkpError('mkp.input-type', `${k} is a list of ${t.kind} records, each written as its fields (${this.fieldList(t)}); found ${sortOf(v)}. Write it as a YAML list, e.g. ${k}: ${example(t, env, this.dc.opts.tokenNames)}`, p);
      v.forEach((r, i) => (node.records = [...(node.records ?? []), this.yamlRecord(r, t, sig, this.at(`${k}[${i}]`, p), k, `${k}[${i}]`)]));
      return;
    }
    node.props![k] = this.yamlValue(v, inp.type, sig.pack, p, k);
  }

  private yamlRecord(r: unknown, t: Extract<Type, { t: 'records' }>, sig: Sig, p: Pos, input: string, path = input): IRNode {
    const env = this.prog.typeEnv(sig.pack);
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new MkpError('mkp.input-type', `${path} must be one ${t.kind} record, written as its fields (${this.fieldList(t)}); found ${sortOf(r)}. Write it as - ${example({ ...t, t: 'rec' } as Type, env, this.dc.opts.tokenNames)}`, p);
    const obj = r as Record<string, unknown>;
    const props: Record<string, IRVal> = {};
    const out: IRNode = { node: '$record', record: t.kind, input, props, pos: [p.line, p.col] };
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'slot' && t.slot) {
        if (typeof v !== 'string') throw new MkpError('mkp.input-type', `slot in ${path} is the ${t.kind}'s Markdown content, written as one piece of text; found ${sortOf(v)}. Write it as text, e.g. slot: "Some words."`, this.at(`${path}.slot`, p));
        out.children = markdownToNodes(v, p.line);
        continue;
      }
      const f = t.fields.find((x) => x[0] === k);
      if (!f) {
        const near = closest(k, t.fields.map((x) => x[0]).filter((n) => !(n in obj)));
        throw new MkpError('mkp.unknown-field', `${path} has no field "${k}"; a ${t.kind}'s fields are ${this.fieldList(t)}${near ? `. Did you mean "${near}"? Rename it` : '. Rename it to one of them, or Remove it'}`, this.at(`${path}.${k}`, p));
      }
      const ft = resolve(f[1], this.prog.typeEnv(sig.pack));
      if (ft.t === 'records') {
        if (!Array.isArray(v)) throw new MkpError('mkp.input-type', `${k} in ${path} is a list of ${ft.kind} records, each written as its fields (${this.fieldList(ft)}); found ${sortOf(v)}. Write it as a YAML list, e.g. ${k}: ${example(ft, env, this.dc.opts.tokenNames)}`, this.at(`${path}.${k}`, p));
        v.forEach((x, i) => (out.records ??= []).push(this.yamlRecord(x, ft, sig, this.at(`${path}.${k}[${i}]`, p), k, `${path}.${k}[${i}]`)));
        continue;
      }
      props[k] = this.yamlValue(v, f[1], sig.pack, this.at(`${path}.${k}`, p), `${path}.${k}`);
    }
    for (const [k, ft] of t.fields) {
      if (props[k] !== undefined || resolve(ft, this.prog.typeEnv(sig.pack)).t === 'records') continue;
      const d = t.defaults?.[k];
      if (d === undefined) {
        const given = Object.keys(obj);
        throw new MkpError('mkp.missing-input', `${path} (a ${t.kind}) is missing ${k}, which takes ${this.takes(ft, sig.pack)}; found ${given.length ? `only ${given.join(', ')}` : 'no fields'}. Add it, e.g. ${k}: ${example(ft, env, this.dc.opts.tokenNames)}`, p);
      }
      props[k] = this.dc.staticValue(parseValueString(d, this.file, p.line, p.col), ft, p);
    }
    return out;
  }

  /** What a value of this type can be, in words: a token's names in full, otherwise words(). */
  private takes(type: Type, pack: string): string {
    const t = resolve(type, this.prog.typeEnv(pack));
    return t.t === 'token' ? this.dc.takes(t) : words(t, this.prog.typeEnv(pack));
  }

  /** A value of the wrong kind: what it takes, what was written, an example to write instead. */
  private wrong(what: string, v: unknown, takes: string, ex: string, p: Pos): never {
    const quote = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && /^a (whole )?number/.test(takes) ? ' (a number in quotes is text: remove the quotes)' : '';
    throw new MkpError('mkp.input-type', `${what} takes ${takes}; found ${shown(v)}${quote}. Replace it, e.g. with ${eg(what, quote ? String(v) : ex)}`, this.at(what, p));
  }

  /** A number outside its range. */
  private outside(what: string, v: number, lo: number, hi: number, p: Pos): MkpError {
    return new MkpError('mkp.input-range', `${what} must be from ${lo} to ${hi}; found ${v}. Write a number in that range, e.g. ${eg(what, String(v < lo ? lo : hi))}`, this.at(what, p));
  }

  /** A token name that is not one of its kind's. */
  private badToken(what: string, v: unknown, t: Extract<Type, { t: 'token' }>, p: Pos): MkpError {
    const near = closest(String(v), this.dc.opts.tokenNames(t.kind));
    const all = this.dc.opts.tokenNames(t.kind);
    const ex = near ?? (all.has('accent') ? 'accent' : [...all][0] ?? 'none');
    return new MkpError('mkp.unknown-token', `${what} takes ${this.dc.takes(t)}; found ${shown(v)}, which is not a ${t.kind} token name. ${near ? `Did you mean ${near}? ` : ''}Write one of those names, e.g. ${eg(what, ex)}`, this.at(what, p));
  }

  /** A YAML value as an IR value of the given type (5: inputs are type-checked everywhere). */
  yamlValue(v: unknown, type: Type, pack: string, p: Pos, what: string): IRVal {
    const env = this.prog.typeEnv(pack);
    const t = resolve(type, env);
    const bad = (want: string, ex?: string): never => this.wrong(what, v, want, ex ?? example(t, env, this.dc.opts.tokenNames), p);
    switch (t.t) {
      case 'num':
      case 'int': {
        if (typeof v !== 'number') return bad(this.dc.takes(t));
        if (t.t === 'int' && !Number.isInteger(v)) return bad(this.dc.takes(t), String(Math.round(v)));
        if (t.lo !== undefined && (v < t.lo || v > t.hi!)) throw this.outside(what, v, t.lo, t.hi!, p);
        return { lit: v };
      }
      case 'bool':
        if (typeof v === 'string' && /^(yes|no|on|off|y|n)$/i.test(v)) {
          const b = /^(yes|on|y)$/i.test(v) ? 'true' : 'false';
          throw new MkpError('mkp.input-type', `${what} takes true or false; found ${v}, which YAML 1.2 reads as text, not as yes or no. Write ${eg(what, b)}`, this.at(what, p));
        }
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
        {
          const near = closest(String(v), t.opts);
          throw new MkpError('mkp.enum', `${what} takes one of ${t.opts.join(', ')}; found ${shown(v)}. ${near ? `Did you mean ${near}? Write ${eg(what, near)}` : `Write one of them, e.g. ${eg(what, t.opts[0])}`}`, this.at(what, p));
        }
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
        throw this.badToken(what, v, t, p);
      case 'ref': {
        const r = v as { ref?: unknown };
        const declared = this.declaredState.filter((n) => this.dc.scope.get(n));
        const refName = declared[0] ?? 'name';
        if (!r || typeof r !== 'object' || typeof r.ref !== 'string') return bad(`a reference to ${words(t.of, env).replace(/^an? /, '')} state, written {ref: name} with the name of a line in a state block`, `{ref: ${refName}}`);
        const b = this.dc.scope.get(r.ref);
        if (!b || (b.kind !== 'state' && b.kind !== 'var')) {
          const decl = `${r.ref} = ${controlFor(t.of, env)} "${r.ref}"`;
          const known = declared.length ? `; the state declared here is ${names(declared)}` : '';
          const near = closest(r.ref, declared);
          throw new MkpError('mkp.not-state', `${what} refers to the state "${r.ref}", but no state block of this document declares it${known}. ${near ? `Did you mean {ref: ${near}}? Or declare` : 'Declare'} it in a \`\`\`state block, e.g. ${decl}`, this.at(what, p));
        }
        if (!fits(b.type, t.of, env)) {
          const want = words(t.of, env);
          throw new MkpError('mkp.input-type', `${what} takes state that is ${want}, but the state ${r.ref} is ${words(b.type, env)}. Refer to state that is ${want}, or declare ${r.ref} with another control, e.g. ${r.ref} = ${controlFor(t.of, env)} "${r.ref}"`, this.at(what, p));
        }
        return { ref: r.ref };
      }
      case 'path':
        if (typeof v !== 'string') return bad('the name of a field of the items', 'name');
        return this.dc.pathTo(v, t, this.at(what, p), env);
      case 'expr': {
        if (typeof v !== 'string' && typeof v !== 'number') return bad(`an expression${t.vars.length ? ` in ${t.vars.map((x) => x[0]).join(', ')}` : ''}, written as text`, `"${t.vars[0]?.[0] ?? 'x'} * 2"`);
        const e = parseExprString(String(v), this.file, p.line, p.col);
        return this.dc.value({ v: 'expr', e, src: String(v), p }, type, this.dc.scope, p);
      }
      case 'list': {
        if (!Array.isArray(v)) return bad(words(t, env));
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
    const bad = (want: string, ex?: string): never => this.wrong(what, v, want, ex ?? example(t, env, this.dc.opts.tokenNames), p);
    switch (t.t) {
      case 'num':
      case 'int':
        if (typeof v !== 'number' || (t.t === 'int' && !Number.isInteger(v))) return bad(this.dc.takes(t), typeof v === 'number' ? String(Math.round(v)) : undefined);
        if (t.lo !== undefined && (v < t.lo || v > t.hi!)) throw this.outside(what, v, t.lo, t.hi!, p);
        return v;
      case 'bool':
        return typeof v === 'boolean' ? v : bad('true or false');
      case 'text':
      case 'latex':
        return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : bad('text');
      case 'choice':
        return typeof v === 'string' && t.opts.includes(v) ? v : bad(`one of ${t.opts.join(', ')}`, closest(String(v), t.opts) ?? t.opts[0]);
      case 'token':
        // a colour in a YAML record is a token name (GAPS 155)
        if (typeof v === 'string' && (v === 'none' || this.dc.opts.tokenNames(t.kind).has(v))) return v;
        throw this.badToken(what, v, t, p);
      case 'point':
        return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') ? v : bad('a point [x, y]');
      case 'list':
        return Array.isArray(v) ? v.map((x, i) => this.yamlData(x, t.of, env, p, `${what}[${i}]`)) : bad(words(t, env));
      case 'dict': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('a mapping of name: value pairs', '{a: …, b: …}');
        const o: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) o[k] = this.yamlData(x, t.of, env, p, `${what}.${k}`);
        return o;
      }
      case 'rec': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return bad(`a record with the fields ${t.fields.map((f) => f[0]).join(', ')}`);
        const o: Record<string, unknown> = {};
        const src = v as Record<string, unknown>;
        for (const k of Object.keys(src)) {
          if (t.fields.some((f) => f[0] === k)) continue;
          // a near name not already given: z next to x and y means y
          const near = closest(k, t.fields.map((f) => f[0]).filter((n) => !(n in src)));
          const all = t.fields.map((f) => f[0]).join(', ');
          throw new MkpError('mkp.unknown-field', `${what} has no field "${k}"; its fields are ${all}${near ? `. Did you mean "${near}"? Rename it` : '. Rename it to one of them, or Remove it'}`, this.at(`${what}.${k}`, this.at(what, p)));
        }
        for (const [k, ft] of t.fields) {
          if (!(k in src)) {
            const d = t.defaults?.[k];
            if (d !== undefined) {
              const dv = this.dc.staticValue(parseValueString(d), ft, p) as Record<string, unknown>;
              o[k] = 'lit' in dv ? dv.lit : 'text' in dv ? dv.text : 'tex' in dv ? dv.tex : 'tok' in dv ? dv.tok : 'ms' in dv ? dv.ms : 'ast' in dv ? constant(dv as unknown as IRExpr, `${what}.${k}`, this.at(what, p)) : dv.lit;
              continue;
            }
            const given = Object.keys(src);
            const keep = given.map((g) => `${g}: ${typeof src[g] === 'string' || typeof src[g] === 'number' ? String(src[g]) : '…'}`);
            throw new MkpError('mkp.missing-field', `${what} is missing the field ${k}, which takes ${words(ft, env)}; found only ${given.length ? given.join(', ') : 'an empty record'}. Add it, e.g. ${eg(what, `{${[`${k}: ${example(ft, env, this.dc.opts.tokenNames)}`, ...keep].join(', ')}}`)}`, this.at(what, p));
          }
          o[k] = this.yamlData(src[k], ft, env, p, `${what}.${k}`);
        }
        return o;
      }
      default:
        throw new MkpError('mkp.input-type', `${what} takes ${showType(type)}, which a value written in YAML can't be; found ${shown(v)}. Pass ${what} from a widget definition instead, or give it a type YAML can write (text, a number, a list, a record)`, this.at(what, p));
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
        if (!sig.slots.includes(nm)) {
          const near = closest(nm, sig.slots.slice(1)) ?? closest(nm, sig.slots);
          const other = near ?? sig.slots[1] ?? sig.slots[0];
          const msg = !sig.slots.length
            ? `${sig.name} has no slots, so :::fill ${nm} has nothing to fill. Remove the :::fill container, or use a widget that holds Markdown`
            : `${sig.name} has no slot "${nm}"; its slots are ${sig.slots.join(', ')} (the Markdown written straight inside :::${sig.name} goes to ${sig.slots[0]}). ${near ? `Did you mean "${near}"? ` : ''}Write :::fill ${other}`;
          throw new MkpError('mkp.unknown-slot', msg, this.p(inner.line));
        }
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
          if (d === undefined) {
            const head = `:::${inner.name}${inner.args.trim() ? ' ' + inner.args.trim() : ''}`;
            const env = this.prog.typeEnv(sig.pack);
            throw new MkpError('mkp.missing-input', `the ${head} record is missing ${f}, which takes ${this.takes(ft, sig.pack)}; its fields, in order, are ${order.join(', ')}. Add it on the ::: line, by position or by name, e.g. ${head} ${f}=${example(ft, env, this.dc.opts.tokenNames, true)}`, this.p(inner.line));
          }
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
      if (!sig.slots.length) {
        const md = plain.find((x) => x.k === 'md') as Extract<DocItem, { k: 'md' }> | undefined;
        const first = md?.text.split('\n').find((l) => l.trim())?.trim();
        const found = first ? `found ${JSON.stringify(first.length > 40 ? first.slice(0, 37) + '…' : first)}` : 'found content';
        throw new MkpError('mkp.no-slot', `${sig.name} has no slot, so the Markdown inside :::${sig.name} … ::: has nowhere to go; ${found}. Remove the Markdown between the ::: lines, or write the widget as a \`\`\`${sig.name} block instead`, p);
      }
      node.children = content;
    }
    if (it.attrs) this.applyAttrs(node, it.attrs.id, it.attrs.props, it.attrs.line, sig);
    this.requireInputs(node, sig, p, new Set(), `:::${it.name}${it.args.trim() ? ' ' + it.args.trim() : ''}`);
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
        const extra = [...(this.dc.opts.blockAttrs ?? [])];
        const allowed = `an anchor {#id}, role= on a heading${extra.length ? `, and this profile's block attributes ${names(extra)}` : ''}`;
        this.diags.warn('mkp.attrs', `the attribute ${k}=${v} on a Markdown block is ignored; a Markdown block takes only ${allowed}. Remove it, or move it to a widget block that has a ${k} input`, p);
        continue;
      }
      const inp = sig.inputs.get(k);
      if (!inp) throw this.unknownInput(sig, k, `{${k}=${v}} under the block`, 'Rename the attribute to one of them, or Remove it', p);
      node.props![k] = this.dc.value(parseValueString(v, this.file, line, 1), inp.type, this.dc.scope, p);
    }
    void pos;
    void T;
  }
}
