// The .mkp statement parser (spec 6.1–6.4, 6.20, 7, 10, 16). It knows statement shapes only;
// whether a node line is an element, a prop line, a record or a relation is decided later by the
// checker from the parent's declaration (6.8).

import { Diagnostics, MkpError, Pos } from '../diag';
import { parseType, Type } from '../types';
import { Ex, ExprParser } from './expr';
import { chunks, Chunk, decodeText, LLine, PosMap, readLines, skipMaths } from './lexer';

export type Val =
  | { v: 'expr'; e: Ex; src: string; p: Pos }
  | { v: 'range'; lo: Ex; hi: Ex; src: string; loSrc: string; hiSrc: string; p: Pos }
  | { v: 'dur'; ms: number; src: string; p: Pos; per?: boolean };

export interface Arg {
  key?: string;
  value: Val;
  p: Pos;
}

export interface ActionSyn {
  name: string;
  args: Arg[];
  p: Pos;
}

export interface EventSyn {
  name: string;
  actions: ActionSyn[];
  /** if=(…) on the event line: its actions run only while it is true (GAPS 81) */
  cond?: Val;
  p: Pos;
}

export interface NodeSyn {
  head: string;
  args: Arg[];
  children: NodeSyn[];
  events: EventSyn[];
  comments: string[];
  p: Pos;
}

export type ControlWord = 'slider' | 'choice' | 'toggle' | 'steps' | 'drag' | 'clock';

export interface ParamSyn {
  name: string;
  type?: Type;
}

export interface FnSyn {
  name: string;
  params: ParamSyn[];
  ret?: Type;
  body: Ex;
  src: string;
  p: Pos;
  comments: string[];
}

export type Member =
  | { m: 'requires'; cap: string; p: Pos; comments: string[] }
  | { m: 'budget'; n: number; p: Pos; comments: string[] }
  | { m: 'fields'; names: string[]; p: Pos; comments: string[] }
  | { m: 'in'; name: string; type: Type; def?: Val; about?: string; answer?: boolean; p: Pos; comments: string[] }
  | { m: 'implements'; names: string[]; p: Pos; comments: string[] }
  | { m: 'out'; name: string; payload?: Type; about?: string; p: Pos; comments: string[] }
  | { m: 'signal'; name: string; payload: Type; about?: string; p: Pos; comments: string[] }
  | { m: 'host'; name: string; type: Type; def: Val; about?: string; p: Pos; comments: string[] }
  | { m: 'command'; name: string; payload?: Type; about?: string; actions: ActionSyn[]; p: Pos; comments: string[] }
  | { m: 'var'; name: string; type: Type; def: Val; about?: string; p: Pos; comments: string[] }
  | { m: 'state'; name: string; control: ControlWord; opts?: string[]; args: Arg[]; def?: Val; label?: string; events: EventSyn[]; p: Pos; comments: string[] }
  | { m: 'derived'; name: string; e: Ex; src: string; p: Pos; comments: string[] }
  | ({ m: 'fn' } & FnSyn)
  | { m: 'project'; target: 'md' | 'mermaid'; e: Ex; src: string; p: Pos; comments: string[] }
  | { m: 'node'; node: NodeSyn };

export interface DefSyn {
  item: 'def';
  kind: 'widget' | 'part' | 'extern';
  name: string;
  version: number;
  /** type parameters: `walk of S` */
  params?: string[];
  /** written without @N, in a document (inline or its file): versioned by the document */
  inline?: boolean;
  about?: string;
  members: Member[];
  p: Pos;
  comments: string[];
}

export interface TokenLineSyn {
  kind: string;
  name?: string;
  value?: Val;
  args: Arg[];
  p: Pos;
}

export interface TokensSyn {
  item: 'tokens';
  name: string;
  version: number;
  about?: string;
  lines: TokenLineSyn[];
  p: Pos;
  comments: string[];
}

export interface ManifestSyn {
  item: 'manifest';
  kind: 'pack' | 'profile';
  name: string;
  version: number;
  about?: string;
  requires: string[];
  depends: string[];
  provides: string[];
  front: { name: string; type: Type; def?: Val; about?: string; p: Pos }[];
  /** block attributes a document may write on any block ({name=value}), kept in the IR's meta (16) */
  attrs: { name: string; type: Type; about?: string; p: Pos }[];
  roles: string[];
  rules: { rule: string; path: string; args: Arg[]; message?: string; p: Pos }[];
  /** not published yet: its definitions may change without a new @N (GAPS 15) */
  unpublished?: boolean;
  p: Pos;
  comments: string[];
}

/** What a host may rely on in a widget that implements it (spec 6.24). */
export interface InterfaceSyn {
  item: 'interface';
  name: string;
  version: number;
  about?: string;
  inputs: { name: string; type: Type; p: Pos }[];
  hosts: { name: string; type: Type; p: Pos }[];
  signals: { name: string; payload: Type; p: Pos }[];
  outs: { name: string; payload?: Type; p: Pos }[];
  project: boolean;
  p: Pos;
  comments: string[];
}

export type TopSyn =
  | DefSyn
  | InterfaceSyn
  | TokensSyn
  | ManifestSyn
  | { item: 'type'; name: string; type: Type; p: Pos; comments: string[] }
  | ({ item: 'fn' } & FnSyn)
  | ({ item: 'op'; symbol: string } & FnSyn)
  | { item: 'const'; name: string; type?: Type; e: Ex; src: string; p: Pos; comments: string[] }
  | { item: 'macro'; name: string; tex: string; p: Pos; comments: string[] };

export interface MkpFile {
  file: string;
  items: TopSyn[];
}

const MEMBER_WORDS = new Set(['requires', 'budget', 'fields', 'in', 'out', 'signal', 'host', 'command', 'var', 'fn', 'project', 'implements']);
export const CONTROL_WORDS = new Set(['slider', 'choice', 'toggle', 'steps', 'drag', 'clock']);
export const ACTION_NAMES = new Set(['set', 'play', 'pause', 'reset', 'reveal', 'hide', 'open', 'close', 'emit', 'send']);
const OP_SYMBOLS = new Set(['+', '-', '*', '/', '^', '==', '<', 'from', 'point']);

const NAME_RE = /^([A-Za-z_][A-Za-z0-9_.-]*:)?[A-Za-z_][A-Za-z0-9_.-]*$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

class LineCtx {
  readonly map: PosMap;
  constructor(readonly line: LLine, file: string) {
    this.map = new PosMap(file, line.segs);
  }
  get text(): string {
    return this.line.text;
  }
  pos(at = 0): Pos {
    return this.map.at(at);
  }
  fail(msg: string, at = 0, code = 'mkp.syntax'): never {
    throw new MkpError(code, msg, this.pos(at));
  }
}

export interface ParseOptions {
  /** a document's own definitions (an mkp fence or the document's file): heads need no @N */
  inline?: boolean;
}

export function parseMkp(src: string, file: string, diags: Diagnostics, opts: ParseOptions = {}): MkpFile {
  const lines = readLines(src, file, diags);
  const items: TopSyn[] = [];
  let lastManifest: ManifestSyn | null = null;
  for (const l of lines) {
    const ctx = new LineCtx(l, file);
    try {
      const word = firstWord(l.text);
      if (lastManifest && ['requires', 'depends', 'provides', 'front', 'attr', 'roles', 'rule', 'unpublished'].includes(word)) {
        packLine(ctx, lastManifest);
        continue;
      }
      const item = topLevel(ctx, diags, opts);
      if (item) {
        items.push(item);
        lastManifest = item.item === 'manifest' ? item : null;
      }
    } catch (e) {
      report(e, diags);
    }
  }
  return { file, items };
}

function report(e: unknown, diags: Diagnostics): void {
  if (e instanceof MkpError) diags.add(e.diagnostic);
  else throw e;
}

function firstWord(text: string): string {
  const m = /^[^\s]+/.exec(text);
  return m ? m[0] : '';
}

/** The name and version of a "name@N" head. */
function nameVersion(ctx: LineCtx, chunk: Chunk): { name: string; version: number } {
  const m = /^([^@\s]+)@(\d+)$/.exec(chunk.text);
  if (!m) ctx.fail(`expected name@N, found "${chunk.text}"`, chunk.at);
  if (!NAME_RE.test(m[1])) ctx.fail(`"${m[1]}" is not a valid name (letters, digits, ".", "-" and "_")`, chunk.at);
  return { name: m[1], version: Number(m[2]) };
}

function optText(ctx: LineCtx, c: Chunk | undefined): string | undefined {
  if (!c) return undefined;
  if (!c.text.startsWith('"')) ctx.fail(`expected a quoted description, found ${c.text}`, c.at);
  return decodeText(c.text);
}

/**
 * A definition's head after its keyword: name@N (or a bare name in a document), type parameters
 * (of S, T) and its about text.
 */
function defHead(ctx: LineCtx, cs: Chunk[], at: number, inline: boolean): { name: string; version: number; params?: string[]; about?: string; inline?: boolean } {
  const c = cs[at] ?? ctx.fail(inline ? 'expected a name' : 'expected name@N', 0);
  let nv: { name: string; version: number };
  let bare = false;
  if (/@/.test(c.text) || !inline) nv = nameVersion(ctx, c);
  else {
    if (!NAME_RE.test(c.text) || c.text.includes(':')) ctx.fail(`"${c.text}" is not a valid name (letters, digits, ".", "-" and "_")`, c.at);
    nv = { name: c.text, version: 1 };
    bare = true;
  }
  let i = at + 1;
  let params: string[] | undefined;
  if (cs[i]?.text === 'of') {
    params = [];
    i++;
    while (cs[i] && !cs[i].text.startsWith('"')) {
      for (const n of cs[i].text.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!/^[A-Z][A-Za-z0-9]*$/.test(n)) ctx.fail(`"${n}" is not a type parameter: one capitalised word, such as S or Item`, cs[i].at);
        params.push(n);
      }
      i++;
    }
    if (!params.length) ctx.fail('of names the type parameters: name of S', cs[at + 1].at);
  }
  const about = optText(ctx, cs[i]);
  if (cs[i + 1]) ctx.fail(`unexpected "${cs[i + 1].text}" after the description`, cs[i + 1].at);
  return { ...nv, ...(params ? { params } : {}), about, ...(bare ? { inline: true } : {}) };
}

function interfaceItem(ctx: LineCtx, diags: Diagnostics, comments: string[]): InterfaceSyn {
  const cs = chunks(ctx.text);
  const nv = nameVersion(ctx, cs[1] ?? ctx.fail('expected interface name@N', 0));
  const it: InterfaceSyn = { item: 'interface', ...nv, about: optText(ctx, cs[2]), inputs: [], hosts: [], signals: [], outs: [], project: false, p: ctx.pos(0), comments };
  for (const c of ctx.line.children) {
    const lc = new LineCtx(c, ctx.map.file);
    try {
      const m = member(lc, diags);
      if (m.m === 'in') it.inputs.push({ name: m.name, type: m.type, p: m.p });
      else if (m.m === 'signal') it.signals.push({ name: m.name, payload: m.payload, p: m.p });
      else if (m.m === 'out') it.outs.push({ name: m.name, payload: m.payload, p: m.p });
      else if (m.m === 'host') it.hosts.push({ name: m.name, type: m.type, p: m.p });
      else if (m.m === 'project') it.project = true;
      else lc.fail('an interface lists in, host, signal and out lines, and "project md"', 0, 'mkp.syntax');
    } catch (e) {
      // "project md" alone is an interface's own line
      if (/^project\s+md\s*$/.test(c.text)) it.project = true;
      else if (/^host\s+[A-Za-z_][A-Za-z0-9_]*\s+\S/.test(c.text) && !c.text.includes('=')) {
        const name = chunks(c.text)[1].text;
        it.hosts.push({ name, type: typedMember(lc, c.text.indexOf(name) + name.length).type, p: lc.pos(0) });
      } else report(e, diags);
    }
  }
  return it;
}

function topLevel(ctx: LineCtx, diags: Diagnostics, opts: ParseOptions = {}): TopSyn | null {
  const text = ctx.text;
  const cs = chunks(text);
  const head = cs[0].text;
  const comments = ctx.line.comments;
  const p = ctx.pos(0);
  const inline = !!opts.inline;
  switch (head) {
    case 'extern':
    case 'part': {
      if (head === 'extern' && inline) ctx.fail('a document cannot declare an extern; externs are what a provider draws', 0, 'mkp.syntax');
      const h = defHead(ctx, cs, 1, inline);
      return { item: 'def', kind: head === 'extern' ? 'extern' : 'part', ...h, members: members(ctx, diags), p, comments };
    }
    case 'interface':
      if (inline) ctx.fail('interfaces belong to a host, in its pack; a document cannot declare one', 0, 'mkp.syntax');
      return interfaceItem(ctx, diags, comments);
    case 'tokens': {
      const nv = nameVersion(ctx, cs[1] ?? ctx.fail('expected name@N', 0));
      return { item: 'tokens', ...nv, about: optText(ctx, cs[2]), lines: tokenLines(ctx, diags), p, comments };
    }
    case 'pack':
    case 'profile': {
      const nv = nameVersion(ctx, cs[1] ?? ctx.fail('expected name@N', 0));
      const m: ManifestSyn = { item: 'manifest', kind: head, ...nv, about: optText(ctx, cs[2]), requires: [], depends: [], provides: [], front: [], attrs: [], roles: [], rules: [], p, comments };
      for (const c of ctx.line.children) {
        try {
          packLine(new LineCtx(c, ctx.map.file), m);
        } catch (e) {
          report(e, diags);
        }
      }
      return m;
    }
    case 'type': {
      const eq = text.indexOf('=');
      if (eq < 0) ctx.fail('expected "type name = {field: type, …}"');
      const name = text.slice(4, eq).trim();
      if (!IDENT_RE.test(name)) ctx.fail(`"${name}" is not a valid type name`, 5);
      const { type } = parseType(text, eq + 1, text.length, ctx.map);
      return { item: 'type', name, type, p, comments };
    }
    case 'fn':
      return { item: 'fn', ...fnLine(ctx, 3, comments) };
    case 'op': {
      const m = /^op\s+(\S+?)\(/.exec(text);
      if (!m || !OP_SYMBOLS.has(m[1])) ctx.fail(`an op is one of ${[...OP_SYMBOLS].join(' ')}`, 3);
      return { item: 'op', symbol: m[1], ...fnLine(ctx, 3 + m[1].length, comments, m[1]) };
    }
    case 'const': {
      const eq = findTopEq(text, 6);
      if (eq < 0) ctx.fail('expected "const name[: type] = expression"');
      const lhs = text.slice(6, eq).trim();
      const colon = lhs.indexOf(':');
      const name = (colon >= 0 ? lhs.slice(0, colon) : lhs).trim();
      if (!IDENT_RE.test(name)) ctx.fail(`"${name}" is not a valid name`, 6);
      const type = colon >= 0 ? parseType(text, 6 + colon + 1, eq, ctx.map).type : undefined;
      const { e, src } = exprAt(ctx, eq + 1, text.length);
      return { item: 'const', name, type, e, src, p, comments };
    }
    case 'macro': {
      const m = /^macro\s+([A-Za-z]+)\s*=\s*(\$.*)$/.exec(text);
      if (!m) ctx.fail('expected "macro name = $…$"');
      const tex = m[2];
      const end = skipMaths(tex, 0);
      const d = tex.startsWith('$$') ? 2 : 1;
      return { item: 'macro', name: m[1], tex: tex.slice(d, end - d), p, comments };
    }
    default: {
      if (/^[^@\s]+@\d+$/.test(head) || (inline && NAME_RE.test(head) && (cs[1]?.text.startsWith('"') || cs[1]?.text === 'of'))) {
        const h = defHead(ctx, cs, 0, inline);
        return { item: 'def', kind: 'widget', ...h, members: members(ctx, diags), p, comments };
      }
      ctx.fail(`a top-level line starts a definition (name@N, part, extern), tokens, type, fn, op, const, macro or pack; found "${head}"`, 0, 'mkp.unknown-statement');
    }
  }
}

function packLine(ctx: LineCtx, m: ManifestSyn): void {
  const text = ctx.text;
  const cs = chunks(text);
  const p = ctx.pos(0);
  switch (cs[0].text) {
    case 'requires':
      m.requires.push(...cs.slice(1).map((c) => c.text));
      return;
    case 'depends':
      m.depends.push(...cs.slice(1).map((c) => c.text));
      return;
    case 'provides':
      m.provides.push(...cs.slice(1).map((c) => c.text));
      return;
    case 'roles':
      m.roles.push(...cs.slice(1).map((c) => c.text));
      return;
    case 'unpublished':
      if (cs.length > 1) ctx.fail('unpublished takes nothing after it');
      m.unpublished = true;
      return;
    case 'front': {
      const name = cs[1]?.text;
      if (!name || !IDENT_RE.test(name)) ctx.fail('expected "front name type [= value] ["about"]"');
      const typed = typedMember(ctx, cs[1].at + name.length);
      m.front.push({ name, type: typed.type, def: typed.def, about: typed.about, p });
      return;
    }
    case 'attr': {
      const name = cs[1]?.text;
      if (!name || !IDENT_RE.test(name) || ['role', 'id'].includes(name)) ctx.fail('expected "attr name type ["about"]" (role and id are taken)');
      const typed = typedMember(ctx, cs[1].at + name.length);
      if (typed.def) ctx.fail('a block attribute has no default: a block without it has none');
      m.attrs.push({ name, type: typed.type, about: typed.about, p });
      return;
    }
    case 'rule': {
      const rule = cs[1]?.text;
      const path = cs[2]?.text;
      if (!rule || !path) ctx.fail('expected "rule name path [args] ["message"]"');
      const rest = cs.slice(3);
      let message: string | undefined;
      if (rest.length && rest[rest.length - 1].text.startsWith('"')) message = decodeText(rest.pop()!.text);
      m.rules.push({ rule, path, args: rest.map((c) => arg(ctx, c)), message, p });
      return;
    }
    default:
      ctx.fail(`a manifest line is requires, depends, provides, front, attr, roles, rule or unpublished; found "${cs[0].text}"`);
  }
}

function tokenLines(ctx: LineCtx, diags: Diagnostics): TokenLineSyn[] {
  const out: TokenLineSyn[] = [];
  for (const c of ctx.line.children) {
    const lc = new LineCtx(c, ctx.map.file);
    try {
      const cs = chunks(c.text);
      const kind = cs[0].text;
      const rest = cs.slice(1);
      const p = lc.pos(0);
      if (rest.length && IDENT_RE.test(rest[0].text)) {
        // color accent "#2563eb" dark="#60a5fa" | shadow raised y=1 …
        const name = rest[0].text;
        const after = rest.slice(1);
        const value = after.length && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(after[0].text) ? valueOf(lc, after.shift()!) : undefined;
        out.push({ kind, name, value, args: after.map((a) => arg(lc, a)), p });
      } else {
        // space xs=2 s=4 …
        out.push({ kind, args: rest.map((a) => arg(lc, a)), p });
      }
    } catch (e) {
      report(e, diags);
    }
  }
  return out;
}

/** The index of " = " (a lone "=" at depth 0 outside strings), or -1. */
function findTopEq(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (c === '$') {
      i = skipMaths(text, i) - 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '=' && depth === 0 && text[i + 1] !== '=' && text[i + 1] !== '>' && !'=!<>'.includes(text[i - 1] ?? '')) return i;
  }
  return -1;
}

function exprAt(ctx: LineCtx, from: number, to: number): { e: Ex; src: string } {
  while (from < to && ctx.text[from] === ' ') from++;
  if (from >= to) ctx.fail('expected an expression', from);
  const e = ExprParser.parse(ctx.text, from, to, ctx.map);
  return { e, src: ctx.text.slice(from, to).trim() };
}

function fnLine(ctx: LineCtx, nameAt: number, comments: string[], symbol?: string): FnSyn {
  const text = ctx.text;
  const open = text.indexOf('(', nameAt);
  const name = symbol ?? text.slice(nameAt, open).trim();
  if (!symbol && !IDENT_RE.test(name)) ctx.fail(`"${name}" is not a valid function name`, nameAt);
  // matching close paren
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) ctx.fail('the parameter list is never closed', open);
  const params: ParamSyn[] = [];
  const inner = text.slice(open + 1, close);
  let start = 0;
  depth = 0;
  const pieces: [number, number][] = [];
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    if ((c === ',' && depth === 0) || i === inner.length) {
      if (inner.slice(start, i).trim()) pieces.push([start, i]);
      start = i + 1;
    }
  }
  for (const [a, b] of pieces) {
    const piece = inner.slice(a, b);
    const colon = piece.indexOf(':');
    const pname = (colon >= 0 ? piece.slice(0, colon) : piece).trim();
    if (!IDENT_RE.test(pname)) ctx.fail(`"${pname}" is not a valid parameter name`, open + 1 + a);
    const type = colon >= 0 ? parseType(text, open + 1 + a + colon + 1, open + 1 + b, ctx.map).type : undefined;
    params.push({ name: pname, type });
  }
  const eq = findTopEq(text, close + 1);
  if (eq < 0) ctx.fail('expected "= expression" after the parameters', close + 1);
  const retText = text.slice(close + 1, eq).trim();
  let ret: Type | undefined;
  if (retText) {
    if (!retText.startsWith(':')) ctx.fail('expected ": type" or "=" after the parameters', close + 1);
    ret = parseType(text, text.indexOf(':', close + 1) + 1, eq, ctx.map).type;
  }
  const { e, src } = exprAt(ctx, eq + 1, text.length);
  return { name, params, ret, body: e, src, p: ctx.pos(0), comments };
}

/** "type [= value] ["about"]" after a member name. */
function typedMember(ctx: LineCtx, from: number): { type: Type; def?: Val; about?: string; answer?: boolean } {
  const text = ctx.text;
  const eq = findTopEq(text, from);
  let typeEnd = eq >= 0 ? eq : text.length;
  let about: string | undefined;
  if (eq < 0) {
    const cs = chunks(text, from);
    const last = cs[cs.length - 1];
    if (cs.length > 1 && last.text.startsWith('"')) {
      about = decodeText(last.text);
      typeEnd = last.at;
    }
  }
  const { type, end } = parseType(text, from, typeEnd, ctx.map);
  let answer: boolean | undefined;
  const after = text.slice(end, typeEnd).trim();
  if (after === 'answer') answer = true;
  else if (after) ctx.fail(`unexpected "${after}" after the type`, end);
  let def: Val | undefined;
  if (eq >= 0) {
    const cs = chunks(text, eq + 1);
    if (!cs.length) ctx.fail('expected a value after "="', eq);
    def = valueOf(ctx, cs[0]);
    // answer may also come after the default: in accept list(text) = [] answer "…"
    if (cs[1]?.text === 'answer') {
      answer = true;
      cs.splice(1, 1);
    }
    if (cs[1]) about = optText(ctx, cs[1]);
    if (cs.length > 2) ctx.fail(`unexpected "${cs[2].text}"`, cs[2].at);
  }
  return { type, def, about, ...(answer ? { answer } : {}) };
}

function recordTypeAfter(ctx: LineCtx, from: number): { payload?: Type; about?: string } {
  const text = ctx.text;
  let i = from;
  while (text[i] === ' ') i++;
  let payload: Type | undefined;
  if (text[i] === '{') {
    const r = parseType(text, i, text.length, ctx.map);
    payload = r.type;
    i = r.end;
    // parseType stops at the next token; find where the record's chunk ended
    const cs = chunks(text, from);
    const rest = cs.slice(1);
    return { payload, about: optText(ctx, rest[0]) };
  }
  const cs = chunks(text, from);
  return { payload, about: optText(ctx, cs[0]) };
}

function members(ctx: LineCtx, diags: Diagnostics): Member[] {
  const out: Member[] = [];
  for (const c of ctx.line.children) {
    const lc = new LineCtx(c, ctx.map.file);
    try {
      out.push(member(lc, diags));
    } catch (e) {
      report(e, diags);
    }
  }
  return out;
}

function member(ctx: LineCtx, diags: Diagnostics): Member {
  const text = ctx.text;
  const word = firstWord(text);
  const p = ctx.pos(0);
  const comments = ctx.line.comments;
  const cs = chunks(text);
  if (MEMBER_WORDS.has(word)) {
    switch (word) {
      case 'requires':
        return { m: 'requires', cap: cs[1]?.text ?? ctx.fail('expected a capability such as gfx@1'), p, comments };
      case 'budget': {
        const n = Number(cs[1]?.text);
        if (!Number.isInteger(n) || n <= 0) ctx.fail('expected a positive whole number of operations', cs[1]?.at ?? 0);
        return { m: 'budget', n, p, comments };
      }
      case 'implements': {
        const names = cs.slice(1).map((c) => c.text);
        if (!names.length) ctx.fail('implements names an interface: implements scored@1');
        for (const n of names) if (!/^[A-Za-z_][A-Za-z0-9_.:-]*@\d+$/.test(n)) ctx.fail(`"${n}" is not an interface name@N`);
        return { m: 'implements', names, p, comments };
      }
      case 'fields': {
        const names = cs.slice(1).map((c) => c.text);
        for (const n of names) if (!IDENT_RE.test(n)) ctx.fail(`"${n}" is not a valid input name`);
        return { m: 'fields', names, p, comments };
      }
      case 'in':
      case 'host':
      case 'var': {
        const name = cs[1]?.text;
        if (!name || !IDENT_RE.test(name)) ctx.fail(`expected "${word} name type …"`, cs[1]?.at ?? 0);
        const t = typedMember(ctx, cs[1].at + name.length);
        if (word === 'in') return { m: 'in', name, ...t, p, comments };
        if (t.answer) ctx.fail('only an input (in) can be an answer', 0);
        if (!t.def) ctx.fail(`a ${word} always has a default: "${word} ${name} type = value"`, 0, 'mkp.missing-default');
        return { m: word, name, type: t.type, def: t.def, about: t.about, p, comments };
      }
      case 'out':
      case 'signal':
      case 'command': {
        const name = cs[1]?.text;
        if (!name || !IDENT_RE.test(name)) ctx.fail(`expected "${word} name …"`, cs[1]?.at ?? 0);
        const r = recordTypeAfter(ctx, cs[1].at + name.length);
        if (word === 'out') return { m: 'out', name, payload: r.payload, about: r.about, p, comments };
        if (word === 'signal') {
          if (!r.payload) ctx.fail('a signal declares its payload: signal name {field: type, …}', 0);
          return { m: 'signal', name, payload: r.payload, about: r.about, p, comments };
        }
        const actions: ActionSyn[] = [];
        for (const c of ctx.line.children) {
          const lc = new LineCtx(c, ctx.map.file);
          try {
            actions.push(...actionLine(lc, 0));
          } catch (e) {
            report(e, diags);
          }
        }
        return { m: 'command', name, payload: r.payload, about: r.about, actions, p, comments };
      }
      case 'fn':
        return { m: 'fn', ...fnLine(ctx, 3, comments) };
      case 'project': {
        const m = /^project\s+(md|mermaid)\s*=/.exec(text);
        if (!m) ctx.fail('expected "project md = expression" or "project mermaid = expression"');
        const { e, src } = exprAt(ctx, m[0].length, text.length);
        return { m: 'project', target: m[1] as 'md' | 'mermaid', e, src, p, comments };
      }
    }
  }
  // name = control … | name = expression
  const assign = /^([A-Za-z_][A-Za-z0-9_]*)\s+=\s+/.exec(text);
  if (assign) {
    const name = assign[1];
    const restAt = assign[0].length;
    const rest = text.slice(restAt);
    const cw = /^(slider|toggle|steps|drag|clock)\b|^choice\(/.exec(rest);
    if (cw) return stateLine(ctx, name, restAt, diags);
    const { e, src } = exprAt(ctx, restAt, text.length);
    return { m: 'derived', name, e, src, p, comments };
  }
  if (word.startsWith('@')) ctx.fail('an event belongs under the element or state line it handles; indent it below that line', 0, 'mkp.event-placement');
  return { m: 'node', node: nodeLine(ctx, diags) };
}

function stateLine(ctx: LineCtx, name: string, at: number, diags: Diagnostics): Member {
  const text = ctx.text;
  const cs = chunks(text, at);
  const first = cs[0];
  let control: ControlWord;
  let opts: string[] | undefined;
  if (first.text.startsWith('choice(')) {
    control = 'choice';
    const m = /^choice\(([^)]*)\)$/.exec(first.text);
    if (!m) ctx.fail('expected choice(a|b|…)', first.at);
    opts = m[1].split('|').map((s) => s.trim());
    for (const o of opts) if (!IDENT_RE.test(o)) ctx.fail(`"${o}" is not a valid option name`, first.at);
  } else control = first.text as ControlWord;
  const rest = cs.slice(1);
  let label: string | undefined;
  if (rest.length && rest[rest.length - 1].text.startsWith('"')) label = decodeText(rest.pop()!.text);
  let def: Val | undefined;
  const args: Arg[] = [];
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c.text === '=') {
      const v = rest[i + 1];
      if (!v) ctx.fail('expected a value after "="', c.at);
      def = valueOf(ctx, v);
      i++;
      continue;
    }
    args.push(arg(ctx, c));
  }
  const events: EventSyn[] = [];
  for (const c of ctx.line.children) {
    const lc = new LineCtx(c, ctx.map.file);
    try {
      if (!c.text.startsWith('@')) lc.fail('only events (@name action …) may be indented under a state line', 0, 'mkp.event-placement');
      events.push(eventLine(lc, diags));
    } catch (e) {
      report(e, diags);
    }
  }
  return { m: 'state', name, control, opts, args, def, label, events, p: ctx.pos(0), comments: ctx.line.comments };
}

export function nodeLine(ctx: LineCtx, diags: Diagnostics): NodeSyn {
  const cs = chunks(ctx.text);
  const head = cs[0].text;
  // name=value at the start of an indented line: the writer meant to go on with the line above (GAPS 136)
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) ctx.fail(`this line goes on with the one above, which works only inside an open bracket: put ${head.split('=')[0]}=… on the line above, or break the line inside its (…)`, 0, 'mkp.continuation');
  if (!NAME_RE.test(head) && head !== 'else') ctx.fail(`"${head}" is not a valid element name`, 0);
  const args = cs.slice(1).map((c) => arg(ctx, c));
  const children: NodeSyn[] = [];
  const events: EventSyn[] = [];
  for (const c of ctx.line.children) {
    const lc = new LineCtx(c, ctx.map.file);
    try {
      if (c.text.startsWith('@')) events.push(eventLine(lc, diags));
      else children.push(nodeLine(lc, diags));
    } catch (e) {
      report(e, diags);
    }
  }
  return { head, args, children, events, comments: ctx.line.comments, p: ctx.pos(0) };
}

function eventLine(ctx: LineCtx, diags: Diagnostics): EventSyn {
  const m = /^@([A-Za-z_][A-Za-z0-9_]*)/.exec(ctx.text);
  if (!m) ctx.fail('expected "@event action …"');
  // if=(…) anywhere on the line guards the whole line
  const cs = chunks(ctx.text, m[0].length);
  const guard = cs.find((c) => c.text.startsWith('if='));
  let cond: Val | undefined;
  if (guard) {
    if (cs.filter((c) => c.text.startsWith('if=')).length > 1) ctx.fail('an event line has one if=', guard.at);
    cond = arg(ctx, guard).value;
  }
  const actions = actionChunks(ctx, cs.filter((c) => c !== guard));
  for (const c of ctx.line.children) {
    const lc = new LineCtx(c, ctx.map.file);
    try {
      actions.push(...actionLine(lc, 0));
    } catch (e) {
      report(e, diags);
    }
  }
  if (!actions.length) ctx.fail(`the event "@${m[1]}" has no actions`);
  return { name: m[1], actions, ...(cond ? { cond } : {}), p: ctx.pos(0) };
}

/** One or more actions on a line; each action name starts a new action. */
function actionLine(ctx: LineCtx, from: number): ActionSyn[] {
  return actionChunks(ctx, chunks(ctx.text, from));
}

function actionChunks(ctx: LineCtx, cs: Chunk[]): ActionSyn[] {
  const out: ActionSyn[] = [];
  for (const c of cs) {
    if (ACTION_NAMES.has(c.text)) {
      out.push({ name: c.text, args: [], p: ctx.pos(c.at) });
      continue;
    }
    if (!out.length) ctx.fail(`"${c.text}" is not an action; actions are ${[...ACTION_NAMES].join(', ')}`, c.at, 'mkp.unknown-action');
    out[out.length - 1].args.push(arg(ctx, c));
  }
  return out;
}

function arg(ctx: LineCtx, c: Chunk): Arg {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(?!=)/.exec(c.text);
  if (m) {
    const vc = { text: c.text.slice(m[0].length), at: c.at + m[0].length };
    if (!vc.text) ctx.fail(`expected a value after "${m[1]}="`, c.at);
    return { key: m[1], value: valueOf(ctx, vc), p: ctx.pos(c.at) };
  }
  return { value: valueOf(ctx, c), p: ctx.pos(c.at) };
}

/** value = range | duration | number | point | text | maths | "(" expr ")" | bare */
function valueOf(ctx: LineCtx, c: Chunk): Val {
  const p = ctx.pos(c.at);
  const t = c.text;
  const dur = /^(\d+(?:\.\d+)?)(ms|s)(\/step)?$/.exec(t);
  if (dur) return { v: 'dur', ms: Number(dur[1]) * (dur[2] === 's' ? 1000 : 1), src: t, p, ...(dur[3] ? { per: true } : {}) };
  const dots = topLevelDots(t);
  if (dots >= 0) {
    const lo = ExprParser.parse(ctx.text, c.at, c.at + dots, ctx.map);
    const hi = ExprParser.parse(ctx.text, c.at + dots + 2, c.at + t.length, ctx.map);
    return { v: 'range', lo, hi, src: t, loSrc: t.slice(0, dots), hiSrc: t.slice(dots + 2), p };
  }
  const e = ExprParser.parse(ctx.text, c.at, c.at + t.length, ctx.map);
  return { v: 'expr', e, src: t, p };
}

function topLevelDots(t: string): number {
  let depth = 0;
  for (let i = 0; i < t.length - 1; i++) {
    const c = t[i];
    if (c === '"' || c === '$') return -1;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '.' && t[i + 1] === '.') return i;
  }
  return -1;
}

/** Parses one expression from a string (used for YAML expression inputs and tests). */
export function parseExprString(src: string, file = '<expr>', line = 1, col = 1): Ex {
  const map = new PosMap(file, [{ at: 0, line, col }]);
  return ExprParser.parse(src, 0, src.length, map);
}

/** Parses one argument value from a string (a range, a duration or an expression). */
export function parseValueString(src: string, file = '<value>', line = 1, col = 1): Val {
  const lline: LLine = { indent: 0, text: src, segs: [{ at: 0, line, col }], comments: [], children: [], line };
  const ctx = new LineCtx(lline, file);
  return valueOf(ctx, { text: src, at: 0 });
}
