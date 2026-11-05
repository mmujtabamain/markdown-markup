// Types (spec 6.5, 6.22): parsing, printing, equality and assignability.

import { MkpError, Pos } from './diag';
import { PosMap, Tok, tokenize } from './syntax/lexer';

export const TOKEN_KINDS = ['color', 'font', 'space', 'size', 'radius', 'shadow'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export type Field = [string, Type];

export type Type =
  | { t: 'num'; lo?: number; hi?: number }
  | { t: 'int'; lo?: number; hi?: number }
  | { t: 'bool' }
  | { t: 'text' }
  | { t: 'latex' }
  | { t: 'point' }
  | { t: 'duration' }
  | { t: 'range' }
  | { t: 'expr'; vars: Field[]; ret: Type }
  | { t: 'choice'; opts: string[] }
  | { t: 'list'; of: Type }
  | { t: 'rec'; fields: Field[]; name?: string; defaults?: Record<string, string> }
  | { t: 'named'; name: string }
  | { t: 'dict'; of: Type }
  | { t: 'records'; kind: string; fields: Field[]; slot: boolean; defaults?: Record<string, string> }
  | { t: 'slot' }
  | { t: 'ref'; of: Type }
  | { t: 'token'; kind: TokenKind }
  | { t: 'fn'; params: Type[]; ret: Type }
  /** a definition's type parameter (walk of S): known at each use */
  | { t: 'param'; name: string }
  /** the name of a field of `of` whose value is a `to` (path(S, int)) */
  | { t: 'path'; of: Type; to: Type }
  | { t: 'unknown' }
  | { t: 'any' };

export const T = {
  num: { t: 'num' } as Type,
  int: { t: 'int' } as Type,
  bool: { t: 'bool' } as Type,
  text: { t: 'text' } as Type,
  latex: { t: 'latex' } as Type,
  point: { t: 'point' } as Type,
  duration: { t: 'duration' } as Type,
  range: { t: 'range' } as Type,
  slot: { t: 'slot' } as Type,
  unknown: { t: 'unknown' } as Type,
  any: { t: 'any' } as Type,
  list: (of: Type): Type => ({ t: 'list', of }),
  dict: (of: Type): Type => ({ t: 'dict', of }),
  fn: (params: Type[], ret: Type): Type => ({ t: 'fn', params, ret }),
};

/** A token as the author wrote it, for "found …" in messages. */
function tokText(t: Tok): string {
  if (t.k === 'eof') return 'the end of the type';
  if (t.k === 'str') return `"${t.v}"`;
  return t.v;
}

const TYPE_EXAMPLES = 'int, num, text, bool, list(int), dict(text) or a record such as {name: text}';

class TypeParser {
  i = 0;
  /** where each constructor being read starts, for naming it in messages */
  private readonly open: { name: string; at: number; close?: string }[] = [];
  constructor(readonly toks: Tok[], readonly map: PosMap, readonly text: string) {}
  /** The type written so far inside the innermost constructor (list(int …), for messages. */
  private sofar(): string {
    const o = this.open[this.open.length - 1];
    const prev = this.toks[this.i - 2] ?? this.toks[0];
    if (!o) return '';
    return this.text.slice(o.at, prev.at + prev.v.length).replace(/\s+/g, ' ').trim();
  }
  peek(o = 0): Tok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  next(): Tok {
    return this.toks[this.i++];
  }
  fail(t: Tok, m: string): never {
    // a token past the line end (an open bracket joins the next line on) is reported where the
    // type stops, on the line to change
    const prev = this.toks[this.toks.indexOf(t) - 1];
    const ended = t.k === 'eof' || this.pastLine(t);
    const at = prev && ended ? prev.at + prev.v.length : t.at;
    const inner = this.open[this.open.length - 1];
    // the line ended inside a bracket: the missing ")" is the problem, whatever was expected next
    const close = inner?.close ?? ')';
    if (ended && inner && !m.startsWith(`expected "${close}"`)) {
      const sofar = this.text.slice(inner.at, at).replace(/\s+/g, ' ').trim();
      m = `\`${sofar}\` is missing its closing "${close}"; found the end of the line. Add "${close}" to close ${close === '}' ? 'the record' : `${inner.name}(…)`}, e.g. \`${sofar}${close}\``;
    }
    throw new MkpError('mkp.type-syntax', m, this.map.at(at));
  }
  /** Whether a token sits on a later source line than the one before it. */
  private pastLine(t: Tok): boolean {
    const prev = this.toks[this.toks.indexOf(t) - 1];
    return !!prev && this.map.at(prev.at + prev.v.length).line !== this.map.at(t.at).line;
  }
  private isOpTok(t: Tok | undefined, v: string): boolean {
    return !!t && t.k === 'op' && t.v === v;
  }
  isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === 'op' && t.v === v;
  }
  expect(v: string, how?: string): void {
    const t = this.next();
    if (t.k === 'op' && t.v === v) return;
    const inner = this.open[this.open.length - 1];
    const prev = this.toks[this.i - 2];
    const what = inner ? `\`${this.sofar()}\`` : prev ? `\`${prev.v}\`` : 'the type';
    const fix = how ?? (v === ')' && inner ? `Add ")" to close ${inner.name}(…), e.g. \`${this.sofar()})\`` : `Write "${v}" there`);
    this.fail(t, `expected "${v}" after ${what}; found ${this.seen(t)}. ${fix}`);
  }
  /** A token as found, or the line end when the token is on a later line. */
  seen(t: Tok): string {
    return t.k !== 'eof' && this.pastLine(t) ? 'the end of the line' : tokText(t);
  }
  number(): number {
    let sign = 1;
    if (this.isOp('-')) {
      this.next();
      sign = -1;
    }
    const t = this.next();
    if (t.k !== 'num') this.fail(t, `a range in a type needs a plain number at each end, such as int 1..10; found ${this.seen(t)}. Write a number there`);
    return sign * t.num!;
  }
  type(): Type {
    const t = this.next();
    if (t.k === 'op' && t.v === '{') {
      const defaults: Record<string, string> = {};
      const fields = this.fieldsAfterBrace(defaults);
      return Object.keys(defaults).length ? { t: 'rec', fields, defaults } : { t: 'rec', fields };
    }
    if (t.k !== 'id') {
      const inner = this.open[this.open.length - 1];
      this.fail(t, `expected a type${inner ? ` inside ${inner.name}(…)` : ''}; found ${this.seen(t)}. Write a type such as ${TYPE_EXAMPLES}`);
    }
    switch (t.v) {
      case 'num':
      case 'int': {
        const ty: { t: 'num' | 'int'; lo?: number; hi?: number } = { t: t.v };
        if (this.peek().k === 'num' || (this.isOp('-') && this.peek(1).k === 'num')) {
          ty.lo = this.number();
          this.expect('..', `Write a range as lo..hi, e.g. \`${t.v} ${ty.lo}..10\``);
          ty.hi = this.number();
        }
        return ty;
      }
      case 'bool':
      case 'text':
      case 'latex':
      case 'point':
      case 'duration':
      case 'range':
      case 'slot':
        return { t: t.v } as Type;
      case 'expr': {
        this.expect('(', 'Write the variables in brackets, e.g. `expr(x)` or `expr(t: num): point`');
        this.open.push({ name: 'expr', at: t.at });
        const vars: Field[] = [];
        let wrap: Tok | undefined;
        while (!this.isOp(')')) {
          const n = this.next();
          // commas between the names are optional: a name read from the next line, with the list
          // failing after it, means the ")" is missing at the line end (fail reports it so)
          if (n.k === 'id' && !wrap && this.pastLine(n) && !this.isOpTok(this.toks[this.i - 2], ',')) wrap = n;
          if (n.k !== 'id' && wrap) this.fail(wrap, '');
          if (n.k !== 'id') this.fail(n, `expr(…) lists the names of the variables the expression uses, e.g. expr(x) or expr(x, y), each with an optional type (expr(t: num)); found ${this.seen(n)}. Write a name such as x`);
          let vt: Type = T.num;
          if (this.isOp(':')) {
            this.next();
            vt = this.type();
          }
          vars.push([n.v, vt]);
          if (this.isOp(',')) this.next();
        }
        this.expect(')');
        this.open.pop();
        let ret: Type = T.num;
        if (this.isOp(':')) {
          this.next();
          ret = this.type();
        }
        return { t: 'expr', vars, ret };
      }
      case 'choice': {
        this.expect('(', 'Write the options in brackets, separated by |, e.g. `choice(low|high)`');
        this.open.push({ name: 'choice', at: t.at });
        const opts: string[] = [];
        for (;;) {
          const n = this.next();
          if (n.k !== 'id') this.fail(n, `each option of choice(…) must be a word (letters, digits and _, starting with a letter), as in choice(low|high); found ${this.seen(n)}. Write a word${n.k === 'num' ? `, e.g. n${n.v}` : ''}`);
          opts.push(n.v);
          if (this.isOp('|')) {
            this.next();
            continue;
          }
          const nx = this.peek();
          this.expect(')', `Separate the options with | and close with ")", e.g. \`choice(${[...opts, nx.k === 'id' ? nx.v : 'other'].join('|')})\``);
          this.open.pop();
          return { t: 'choice', opts };
        }
      }
      case 'list': {
        this.expect('(', 'Write the item type in brackets, e.g. `list(int)`');
        this.open.push({ name: 'list', at: t.at });
        if (this.peek().k === 'id' && this.peek().v === 'record') {
          this.next();
          const kind = this.next();
          if (kind.k !== 'id') this.fail(kind, `list(record …) needs a name for its records after "record", e.g. list(record row {a: int}); found ${this.seen(kind)}. Write a name such as row`);
          this.expect('{', `Write the record's fields in braces after its name, e.g. \`list(record ${kind.v} {a: int})\``);
          const defaults: Record<string, string> = {};
          const fields = this.fieldsAfterBrace(defaults);
          let slot = false;
          if (this.peek().k === 'id' && this.peek().v === 'slot') {
            this.next();
            slot = true;
          }
          this.expect(')');
          this.open.pop();
          return Object.keys(defaults).length ? { t: 'records', kind: kind.v, fields, slot, defaults } : { t: 'records', kind: kind.v, fields, slot };
        }
        const of = this.type();
        this.expect(')');
        this.open.pop();
        return { t: 'list', of };
      }
      case 'dict': {
        this.expect('(', 'Write the value type in brackets, e.g. `dict(int)` (the keys are always text)');
        this.open.push({ name: 'dict', at: t.at });
        const of = this.type();
        this.expect(')');
        this.open.pop();
        return { t: 'dict', of };
      }
      case 'ref':
        return { t: 'ref', of: this.type() };
      case 'path': {
        this.expect('(', 'Write path(record type, field type), e.g. `path(T, text)`');
        this.open.push({ name: 'path', at: t.at });
        const of = this.type();
        const nx = this.peek();
        this.expect(',', `path(…) takes two types separated by a comma: the record and the type of the field it names, e.g. \`path(${showType(of)}, ${nx.k === 'id' ? nx.v : 'text'})\``);
        const to = this.type();
        this.expect(')');
        this.open.pop();
        return { t: 'path', of, to };
      }
      default:
        if ((TOKEN_KINDS as readonly string[]).includes(t.v)) return { t: 'token', kind: t.v as TokenKind };
        return { t: 'named', name: t.v };
    }
  }
  fieldsAfterBrace(defaults?: Record<string, string>): Field[] {
    const fields: Field[] = [];
    if (this.isOp('}')) {
      this.next();
      return fields;
    }
    this.open.push({ name: 'record', at: this.toks[this.i - 1].at, close: '}' });
    for (;;) {
      const n = this.next();
      if (n.k !== 'id') this.fail(n, `each field of a record starts with its name, as in {title: text, count: int}; found ${this.seen(n)}. Write a name such as ${n.k === 'num' ? `f${n.v}` : 'title'}`);
      this.expect(':', `Give the field a type after a colon, e.g. \`${n.v}: text\``);
      fields.push([n.v, this.type()]);
      if (this.isOp('=')) {
        // a field default (an extension of 6.5): the source up to the next "," or "}" at depth 0
        this.next();
        const start = this.peek().at;
        let depth = 0;
        while (this.peek().k !== 'eof') {
          const q = this.peek();
          if (q.k === 'op' && (q.v === '(' || q.v === '[' || q.v === '{')) depth++;
          if (q.k === 'op' && (q.v === ')' || q.v === ']' || q.v === '}')) {
            if (depth === 0) break;
            depth--;
          }
          if (q.k === 'op' && q.v === ',' && depth === 0) break;
          this.next();
        }
        if (defaults) defaults[n.v] = this.text.slice(start, this.peek().at).trim();
      }
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      this.expect('}', 'Separate the fields with commas and close the record with "}", e.g. `{a: int, b: text}`');
      this.open.pop();
      return fields;
    }
  }
}

/** Parses a type written in text[from, to). Returns the type and where it stopped. */
export function parseType(text: string, from: number, to: number, map: PosMap): { type: Type; end: number } {
  const toks = tokenize(text, from, to);
  const p = new TypeParser(toks, map, text);
  const type = p.type();
  return { type, end: p.peek().at };
}

export function parseTypeString(src: string, file = '<type>'): Type {
  const map = new PosMap(file, [{ at: 0, line: 1, col: 1 }]);
  const { type, end } = parseType(src, 0, src.length, map);
  if (end < src.trim().length) {
    const rest = src.slice(end).trim();
    throw new MkpError('mkp.type-syntax', `the type \`${src.slice(0, end).trim()}\` is complete, but more follows it; found "${rest}". Remove "${rest}", or join it into the type (a range is written int 1..6)`, map.at(end));
  }
  return type;
}

export function showType(ty: Type): string {
  switch (ty.t) {
    case 'num':
    case 'int':
      return ty.lo !== undefined ? `${ty.t} ${fmtNum(ty.lo)}..${fmtNum(ty.hi!)}` : ty.t;
    case 'expr':
      return `expr(${ty.vars.map(([n, v]) => (v.t === 'num' && v.lo === undefined ? n : `${n}: ${showType(v)}`)).join(', ')})${ty.ret.t === 'num' && ty.ret.lo === undefined ? '' : `: ${showType(ty.ret)}`}`;
    case 'choice':
      return `choice(${ty.opts.join('|')})`;
    case 'list':
      return `list(${showType(ty.of)})`;
    case 'dict':
      return `dict(${showType(ty.of)})`;
    case 'rec':
      return ty.name ?? `{${ty.fields.map(([n, f]) => `${n}: ${showType(f)}${ty.defaults?.[n] !== undefined ? ` = ${ty.defaults[n]}` : ''}`).join(', ')}}`;
    case 'named':
      return ty.name;
    case 'records':
      return `list(record ${ty.kind} {${ty.fields.map(([n, f]) => `${n}: ${showType(f)}${ty.defaults?.[n] !== undefined ? ` = ${ty.defaults[n]}` : ''}`).join(', ')}}${ty.slot ? ' slot' : ''})`;
    case 'ref':
      return `ref ${showType(ty.of)}`;
    case 'token':
      return ty.kind;
    case 'fn':
      return `fn(${ty.params.map(showType).join(', ')}): ${showType(ty.ret)}`;
    case 'param':
      return ty.name;
    case 'path':
      return `path(${showType(ty.of)}, ${showType(ty.to)})`;
    default:
      return ty.t;
  }
}

function fmtNum(n: number): string {
  return String(n);
}

/** Resolves named types through a lookup (recursive types stay lazy behind their names). */
export type TypeEnv = (name: string) => Type | undefined;

export function resolve(ty: Type, env: TypeEnv): Type {
  let cur = ty;
  for (let n = 0; n < 20 && cur.t === 'named'; n++) {
    const r = env(cur.name);
    if (!r) return cur;
    cur = r.t === 'rec' ? { ...r, name: cur.name } : r;
  }
  return cur;
}

/** Structural equality, with named types resolved. */
export function sameType(a: Type, b: Type, env: TypeEnv, seen = new Set<string>()): boolean {
  if (a.t === 'named' && b.t === 'named' && a.name === b.name) return true;
  const key = `${showType(a)}=${showType(b)}`;
  if (seen.has(key)) return true;
  seen.add(key);
  a = resolve(a, env);
  b = resolve(b, env);
  if (a.t === 'any' || b.t === 'any') return true;
  if ((a.t === 'num' || a.t === 'int') && (b.t === 'num' || b.t === 'int')) return a.t === b.t;
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'list':
    case 'dict':
      return sameType(a.of, (b as typeof a).of, env, seen);
    case 'ref':
      return sameType(a.of, (b as typeof a).of, env, seen);
    case 'rec': {
      const bf = (b as typeof a).fields;
      if (a.name && (b as typeof a).name) return a.name === (b as typeof a).name;
      return a.fields.length === bf.length && a.fields.every(([n, t]) => {
        const o = bf.find(([m]) => m === n);
        return !!o && sameType(t, o[1], env, seen);
      });
    }
    case 'choice':
      return a.opts.join('|') === (b as typeof a).opts.join('|');
    case 'token':
      return a.kind === (b as typeof a).kind;
    case 'fn': {
      const bb = b as typeof a;
      return a.params.length === bb.params.length && a.params.every((p, i) => sameType(p, bb.params[i], env, seen)) && sameType(a.ret, bb.ret, env, seen);
    }
    case 'expr': {
      const bb = b as typeof a;
      return a.vars.length === bb.vars.length && a.vars.every(([, t], i) => sameType(t, bb.vars[i][1], env, seen)) && sameType(a.ret, bb.ret, env, seen);
    }
    case 'param':
      return a.name === (b as typeof a).name;
    case 'path': {
      const bb = b as typeof a;
      return sameType(a.of, bb.of, env, seen) && sameType(a.to, bb.to, env, seen);
    }
    default:
      return true;
  }
}

/** A type with its parameters replaced (walk of S used with S = {line: int, …}). */
export function substitute(ty: Type, args: Record<string, Type>): Type {
  switch (ty.t) {
    case 'param':
      return args[ty.name] ?? ty;
    case 'named':
      return args[ty.name] ?? ty;
    case 'list':
    case 'dict':
    case 'ref':
      return { ...ty, of: substitute(ty.of, args) };
    case 'rec':
    case 'records':
      return { ...ty, fields: ty.fields.map(([n, f]) => [n, substitute(f, args)] as Field) };
    case 'fn':
      return { t: 'fn', params: ty.params.map((p) => substitute(p, args)), ret: substitute(ty.ret, args) };
    case 'expr':
      return { t: 'expr', vars: ty.vars.map(([n, v]) => [n, substitute(v, args)] as Field), ret: substitute(ty.ret, args) };
    case 'path':
      return { t: 'path', of: substitute(ty.of, args), to: substitute(ty.to, args) };
    default:
      return ty;
  }
}

/** Whether a type mentions a type parameter. */
export function hasParam(ty: Type): boolean {
  switch (ty.t) {
    case 'param':
      return true;
    case 'list':
    case 'dict':
    case 'ref':
      return hasParam(ty.of);
    case 'rec':
    case 'records':
      return ty.fields.some(([, f]) => hasParam(f));
    case 'fn':
      return ty.params.some(hasParam) || hasParam(ty.ret);
    case 'expr':
      return ty.vars.some(([, v]) => hasParam(v)) || hasParam(ty.ret);
    case 'path':
      return hasParam(ty.of) || hasParam(ty.to);
    default:
      return false;
  }
}

/**
 * Whether a value of type `from` fits where `to` is expected, without conversions.
 * int fits num; a choice fits text; unknown (an empty list or dict) fits anything of its shape.
 */
export function fits(from: Type, to: Type, env: TypeEnv): boolean {
  from = resolve(from, env);
  to = resolve(to, env);
  if (from.t === 'any' || to.t === 'any' || from.t === 'unknown' || to.t === 'unknown') return true;
  if (to.t === 'num' && (from.t === 'num' || from.t === 'int')) return true;
  if (to.t === 'int' && from.t === 'int') return true;
  if (to.t === 'text' && (from.t === 'text' || from.t === 'latex' || from.t === 'choice')) return true;
  if (to.t === 'ref') return fits(from.t === 'ref' ? from.of : from, to.of, env);
  if (from.t === 'ref') return fits(from.of, to, env);
  if (to.t === 'choice' && from.t === 'choice') return from.opts.every((o) => to.opts.includes(o));
  if (to.t === 'list' && from.t === 'list') return fits(from.of, to.of, env);
  if (to.t === 'dict' && from.t === 'dict') return fits(from.of, to.of, env);
  if (to.t === 'dict' && from.t === 'rec' && from.fields.length === 0) return true;
  if (to.t === 'rec' && from.t === 'rec') {
    if (to.name && from.name) return to.name === from.name;
    return to.fields.every(([n, t]) => {
      const f = from.fields.find(([m]) => m === n);
      return !!f && fits(f[1], t, env);
    }) && from.fields.every(([n]) => to.fields.some(([m]) => m === n));
  }
  if (to.t === 'fn' && from.t === 'fn') {
    return from.params.length === to.params.length && fits(from.ret, to.ret, env);
  }
  if (to.t === 'expr' && from.t === 'fn') return fits(from.ret, to.ret, env);
  return sameType(from, to, env);
}

/** Joins two types for list elements and branches: int+num → num; unknown takes the other. */
export function join(a: Type, b: Type, env: TypeEnv): Type | null {
  const ra = resolve(a, env);
  const rb = resolve(b, env);
  if (ra.t === 'unknown' || ra.t === 'any') return b;
  if (rb.t === 'unknown' || rb.t === 'any') return a;
  // a path compares with text: path != "" asks whether an optional path was given
  if ((ra.t === 'path' && rb.t === 'text') || (ra.t === 'text' && rb.t === 'path')) return T.text;
  if ((ra.t === 'int' || ra.t === 'num') && (rb.t === 'int' || rb.t === 'num')) return ra.t === 'int' && rb.t === 'int' ? T.int : T.num;
  if (ra.t === 'choice' && rb.t === 'choice') return { t: 'choice', opts: [...new Set([...ra.opts, ...rb.opts])] };
  if ((ra.t === 'text' || ra.t === 'choice') && (rb.t === 'text' || rb.t === 'choice')) return T.text;
  if (ra.t === 'list' && rb.t === 'list') {
    const j = join(ra.of, rb.of, env);
    return j ? T.list(j) : null;
  }
  if (ra.t === 'dict' && rb.t === 'dict') {
    const j = join(ra.of, rb.of, env);
    return j ? T.dict(j) : null;
  }
  if (ra.t === 'dict' && rb.t === 'rec' && rb.fields.length === 0) return a;
  if (rb.t === 'dict' && ra.t === 'rec' && ra.fields.length === 0) return b;
  if (ra.t === 'rec' && rb.t === 'rec' && !ra.name && !rb.name && ra.fields.length === rb.fields.length) {
    const fields: Field[] = [];
    for (const [n, t] of ra.fields) {
      const o = rb.fields.find(([m]) => m === n);
      if (!o) return null;
      const j = join(t, o[1], env);
      if (!j) return null;
      fields.push([n, j]);
    }
    return { t: 'rec', fields };
  }
  if (ra.t === 'rec' && rb.t === 'rec' && (ra.name || rb.name) && fits(ra, rb, env)) return ra.name ? a : b;
  return sameType(ra, rb, env) ? a : null;
}

export function isNumeric(ty: Type): boolean {
  return ty.t === 'num' || ty.t === 'int';
}

/** Whether a type still has unknown parts (an empty list or dict whose element type is open). */
export function hasUnknown(ty: Type): boolean {
  switch (ty.t) {
    case 'unknown':
      return true;
    case 'list':
    case 'dict':
      return hasUnknown(ty.of);
    case 'rec':
      return ty.fields.some(([, f]) => hasUnknown(f));
    default:
      return false;
  }
}

export function posOf(p: Pos | undefined): string {
  return p ? `${p.file}:${p.line}:${p.col}` : '';
}
