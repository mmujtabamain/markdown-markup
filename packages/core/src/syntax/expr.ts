// The expression grammar (spec 6.7 precedence table, 6.20 expression productions).

import { MkpError, Pos } from '../diag';
import { PosMap, Tok, tokenize } from './lexer';

export type BinOp = '+' | '-' | '*' | '/' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or';

export type Ex =
  | { k: 'num'; v: number; p: Pos }
  | { k: 'str'; v: string; p: Pos }
  | { k: 'tex'; v: string; display: boolean; p: Pos }
  | { k: 'id'; name: string; p: Pos }
  | { k: 'list'; items: Ex[]; p: Pos }
  | { k: 'rec'; fields: [string, Ex][]; p: Pos }
  | { k: 'point'; x: Ex; y: Ex; p: Pos }
  | { k: 'call'; f: string; args: Ex[]; p: Pos }
  | { k: 'apply'; f: Ex; args: Ex[]; p: Pos }
  | { k: 'field'; o: Ex; name: string; p: Pos }
  | { k: 'index'; o: Ex; i: Ex; p: Pos }
  | { k: 'neg'; a: Ex; p: Pos }
  | { k: 'not'; a: Ex; p: Pos }
  | { k: 'bin'; op: BinOp; a: Ex; b: Ex; juxt?: boolean; p: Pos }
  | { k: 'lam'; params: string[]; body: Ex; p: Pos };

const KEYWORDS = new Set(['and', 'or', 'not']);
const CMP = new Set(['==', '!=', '<', '<=', '>', '>=']);

/** What a token looks like in a message: `x`, `"text"`, `$maths$`, or "the end of the expression". */
function shown(t: Tok): string {
  if (t.k === 'eof') return 'the end of the expression';
  const v = t.k === 'str' ? `"${t.v}"` : t.k === 'tex' ? (t.display ? `$$${t.v}$$` : `$${t.v}$`) : t.v;
  return `\`${v.length > 40 ? `${v.slice(0, 37)}…` : v}\``;
}

/** A piece of source, short enough for a message. */
function clip(s: string, max = 40): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `…${t.slice(t.length - max + 1)}` : t;
}

const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

export class ExprParser {
  private i = 0;
  private readonly toks: Tok[];
  constructor(
    private readonly text: string,
    private readonly from: number,
    to: number,
    private readonly map: PosMap,
  ) {
    this.toks = tokenize(text, from, to);
  }

  static parse(text: string, from: number, to: number, map: PosMap): Ex {
    const p = new ExprParser(text, from, to, map);
    const e = p.expr();
    const t = p.peek();
    if (t.k !== 'eof') p.trailing(t);
    return e;
  }

  /** The source read so far, up to the token t. */
  private before(t: Tok): string {
    return clip(this.text.slice(this.from, t.at));
  }

  /** A complete expression is followed by more: say what to do with it. */
  private trailing(t: Tok): never {
    const done = this.before(t);
    if (t.k === 'op' && OPENER[t.v]) {
      this.fail(t, `the expression has a \`${t.v}\` with no \`${OPENER[t.v]}\` to match it; found \`${t.v}\` after \`${done}\`. Remove the \`${t.v}\`, or add the \`${OPENER[t.v]}\` it closes`);
    }
    if (t.k === 'op' && t.v === '=') {
      this.fail(t, `an expression can't hold \`=\`; found \`=\` after \`${done}\`. To compare two values, write \`==\`; to set a value, use \`set name=(…)\` in an event`);
    }
    if (t.k === 'op' && t.v === ',') {
      this.fail(t, `the expression \`${done}\` is followed by a comma, which only separates items inside brackets; found \`,\`. Remove it, or bracket the items: \`[a, b]\` for a list, \`(x, y)\` for a point`);
    }
    const join = t.k === 'str' || t.k === 'tex' ? 'To join texts, put `+` between them' : 'Put an operator between them (`+`, `*`, `and`, …)';
    this.fail(t, `the expression \`${done}\` is complete, so ${shown(t)} can't follow it; found ${shown(t)} after it. ${join}, or remove ${shown(t)}`);
  }

  private peek(o = 0): Tok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private pos(t: Tok): Pos {
    return this.map.at(t.at);
  }
  fail(t: Tok, msg: string): never {
    throw new MkpError('mkp.syntax', msg, this.pos(t));
  }
  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === 'op' && t.v === v;
  }
  /** Takes the operator v, or fails with the message what(found) builds. */
  private expect(v: string, what: (found: string) => string, atEnd?: Tok): Tok {
    const t = this.next();
    // at the end of the expression, an opener is a better place to point than past the last token
    if (t.k !== 'op' || t.v !== v) this.fail(t.k === 'eof' && atEnd ? atEnd : t, what(shown(t)));
    return t;
  }

  expr(): Ex {
    const lam = this.tryLambda();
    if (lam) return lam;
    return this.or();
  }

  private tryLambda(): Ex | null {
    const t = this.peek();
    if (t.k === 'id' && !KEYWORDS.has(t.v) && this.isOp('=>', 1)) {
      this.i += 2;
      return { k: 'lam', params: [t.v], body: this.expr(), p: this.pos(t) };
    }
    if (this.isOp('(')) {
      // (a, b) => e
      let j = 1;
      const params: string[] = [];
      for (;;) {
        const a = this.peek(j);
        if (a.k !== 'id') return null;
        params.push(a.v);
        j++;
        if (this.isOp(',', j)) {
          j++;
          continue;
        }
        if (this.isOp(')', j) && this.isOp('=>', j + 1)) {
          this.i += j + 2;
          return { k: 'lam', params, body: this.expr(), p: this.pos(t) };
        }
        return null;
      }
    }
    return null;
  }

  private or(): Ex {
    let a = this.and();
    while (this.peek().k === 'id' && this.peek().v === 'or') {
      const t = this.next();
      a = { k: 'bin', op: 'or', a, b: this.and(), p: this.pos(t) };
    }
    return a;
  }
  private and(): Ex {
    let a = this.not();
    while (this.peek().k === 'id' && this.peek().v === 'and') {
      const t = this.next();
      a = { k: 'bin', op: 'and', a, b: this.not(), p: this.pos(t) };
    }
    return a;
  }
  private not(): Ex {
    const t = this.peek();
    if (t.k === 'id' && t.v === 'not') {
      this.next();
      return { k: 'not', a: this.not(), p: this.pos(t) };
    }
    return this.cmp();
  }
  private cmp(): Ex {
    const start = this.peek();
    const a = this.sum();
    const t = this.peek();
    if (t.k === 'op' && CMP.has(t.v)) {
      this.next();
      const b = this.sum();
      const u = this.peek();
      if (u.k === 'op' && CMP.has(u.v)) this.chained(start, t, u);
      return { k: 'bin', op: t.v as BinOp, a, b, p: this.pos(t) };
    }
    return a;
  }
  /** a < b < c: show it as two comparisons joined with and. */
  private chained(start: Tok, t: Tok, u: Tok): never {
    const a = this.text.slice(start.at, t.at).trim();
    const b = this.text.slice(t.at + t.v.length, u.at).trim();
    let c = '…';
    try {
      this.next();
      this.sum();
      c = this.text.slice(u.at + u.v.length, this.peek().at).trim() || '…';
    } catch {
      // the rest doesn't parse: show it as …
    }
    const first = clip(`${a} ${t.v} ${b}`);
    this.fail(u, `comparisons can't be chained; found a second \`${u.v}\` after \`${first}\`. Write two comparisons joined with \`and\`: \`${clip(`${a} ${t.v} ${b} and ${b} ${u.v} ${c}`, 60)}\``);
  }

  private sum(): Ex {
    let a = this.product();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.next();
        a = { k: 'bin', op: t.v, a, b: this.product(), p: this.pos(t) };
      } else return a;
    }
  }
  private product(): Ex {
    let a = this.juxt();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '*' || t.v === '/')) {
        this.next();
        a = { k: 'bin', op: t.v, a, b: this.juxt(), p: this.pos(t) };
      } else return a;
    }
  }
  /** juxt = unary { power }: implicit multiplication, tighter than * and / */
  private juxt(): Ex {
    let a = this.unary();
    while (this.startsAtom()) {
      const t = this.peek();
      a = { k: 'bin', op: '*', a, b: this.power(), juxt: true, p: this.pos(t) };
    }
    return a;
  }
  private startsAtom(): boolean {
    const t = this.peek();
    if (t.k === 'num') return true;
    if (t.k === 'id') return !KEYWORDS.has(t.v) && !this.isOp('=>', 1);
    if (t.k === 'op' && t.v === '(') return this.tryLambdaAhead() === false;
    return false;
  }
  /** true when a "(" here begins a lambda (which juxtaposition never consumes) */
  private tryLambdaAhead(): boolean {
    let j = 1;
    for (;;) {
      const a = this.peek(j);
      if (a.k !== 'id') return false;
      j++;
      if (this.isOp(',', j)) {
        j++;
        continue;
      }
      return this.isOp(')', j) && this.isOp('=>', j + 1);
    }
  }
  private unary(): Ex {
    const t = this.peek();
    if (t.k === 'op' && t.v === '-') {
      this.next();
      return { k: 'neg', a: this.unary(), p: this.pos(t) };
    }
    return this.power();
  }
  private power(): Ex {
    const base = this.postfix();
    const t = this.peek();
    if (t.k === 'op' && t.v === '^') {
      this.next();
      return { k: 'bin', op: '^', a: base, b: this.unary(), p: this.pos(t) };
    }
    return base;
  }
  private postfix(): Ex {
    const bracketed = this.isOp('(');
    let a = this.atom();
    let steps = 0;
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && t.v === '(' && !t.sp && a.k !== 'num' && !(bracketed && steps === 0 && a.k !== 'lam')) {
        this.next();
        const args = this.list(')', `the arguments of ${a.k === 'id' ? `${a.name}(…)` : 'the call'}`, 'argument');
        a = a.k === 'id' ? { k: 'call', f: a.name, args, p: a.p } : { k: 'apply', f: a, args, p: this.pos(t) };
        steps++;
      } else if (t.k === 'op' && t.v === '[' && !t.sp) {
        this.next();
        const i = this.expr();
        this.expect(']', (f) => `the index opened with \`[\` is not closed; found ${f} where \`]\` should end it. Add \`]\` after the index, e.g. \`xs[i]\``);
        a = { k: 'index', o: a, i, p: this.pos(t) };
      } else if (t.k === 'op' && t.v === '.' && !t.sp) {
        this.next();
        const n = this.next();
        if (n.k !== 'id') {
          const of = this.before(t);
          this.fail(n, `\`.\` after \`${of}\` must be followed by a field name; found ${shown(n)}. Write the field's name, e.g. \`${of}.x\` (a point's parts are \`.x\` and \`.y\`), or use \`${of}[i]\` for an item of a list`);
        }
        a = { k: 'field', o: a, name: n.v, p: this.pos(t) };
      } else return a;
    }
  }
  /** Items up to close; of names what is being listed, e.g. `the arguments of format(…)`. */
  private list(close: string, of: string, item: string): Ex[] {
    const out: Ex[] = [];
    if (this.isOp(close)) {
      this.next();
      return out;
    }
    for (;;) {
      out.push(this.expr());
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      this.expect(close, (f) => `${of} must be separated by \`,\` and end with \`${close}\`; found ${f} after ${item} ${out.length}. Add \`,\` before the next ${item}, or \`${close}\` to end the list there`);
      return out;
    }
  }
  private atom(): Ex {
    const t = this.next();
    const p = this.pos(t);
    switch (t.k) {
      case 'num':
        return { k: 'num', v: t.num!, p };
      case 'str':
        return { k: 'str', v: t.v, p };
      case 'tex':
        return { k: 'tex', v: t.v, display: !!t.display, p };
      case 'id':
        if (KEYWORDS.has(t.v)) this.keywordAsValue(t);
        return { k: 'id', name: t.v, p };
      case 'op':
        if (t.v === '(') {
          const e = this.expr();
          if (this.isOp(',')) {
            this.next();
            const y = this.expr();
            this.expect(')', (f) =>
              this.peek(-1).v === ','
                ? 'a point `(x, y)` has exactly two parts; found a third after the second comma. Remove it, or write a list in square brackets: `[a, b, c]`'
                : `the point opened with \`(\` is not closed; found ${f} after its second part. Add \`)\` after it: \`(x, y)\``,
            );
            return { k: 'point', x: e, y, p };
          }
          this.expect(')', (f) => `the bracket \`(\` opened before \`${clip(this.text.slice(t.at + 1, this.peek(-1).at), 30)}\` is not closed; found ${f} where \`)\` should be. Add \`)\` where the bracketed part ends`, t);
          return e;
        }
        if (t.v === '[') return { k: 'list', items: this.list(']', 'the items of a list', 'item'), p };
        if (t.v === '{') {
          const fields: [string, Ex][] = [];
          if (this.isOp('}')) {
            this.next();
            return { k: 'rec', fields, p };
          }
          for (;;) {
            const n = this.next();
            if (n.k !== 'id' && n.k !== 'str') {
              if (n.k === 'op' && n.v === '}' && fields.length) this.fail(n, 'a record can\'t end with a comma; found `,` before `}`. Remove the last comma, e.g. `{a: 1, b: 2}`');
              this.fail(n, `a record field's name must be a word or a quoted text; found ${shown(n)}. Write e.g. \`{a: …}\`${n.k === 'num' ? `, or quote it: \`{"${n.v}": …}\`` : ''}`);
            }
            const name = n.k === 'str' ? `"${n.v}"` : n.v;
            this.expect(':', (f) => {
              const nx = this.peek(-1);
              const v = nx.k === 'num' || nx.k === 'id' ? nx.v : '…';
              return `the record field \`${name}\` needs \`:\` between its name and its value; found ${f}. Write \`{${name}: ${v}}\``;
            });
            fields.push([n.v, this.expr()]);
            if (this.isOp(',')) {
              this.next();
              continue;
            }
            this.expect('}', (f) => `the fields of a record must be separated by \`,\` and end with \`}\`; found ${f} after the field \`${name}\`. Add \`,\` before the next field, or \`}\` to end the record: \`{a: 1, b: 2}\``);
            return { k: 'rec', fields, p };
          }
        }
        if (t.v === '|') this.fail(t, 'MKP has no `|x|` for absolute value; found `|`. Write `abs(x)` instead, e.g. `abs(n - 3)`');
        return this.needValue(t);
      default:
        return this.needValue(t);
    }
  }

  /** "and", "or" or "not" where a value goes. */
  private keywordAsValue(t: Tok): never {
    const where = this.before(t);
    const at = where ? `after \`${where}\`` : 'at the start of the expression';
    if (t.v === 'not') this.fail(t, `a value is needed ${at}; found \`not\`, which can't sit inside arithmetic without brackets. Bracket it, e.g. \`(not done)\``);
    this.fail(t, `a value is needed ${at}; found \`${t.v}\`, which only joins two conditions (\`a ${t.v} b\`). Put a value here, such as a number or a name, or remove the \`${t.v}\``);
  }

  /** A value was due at t (an operator, a closing bracket, or the end). */
  private needValue(t: Tok): never {
    const where = this.before(t);
    const prev = this.peek(-1 - 1);
    if (t.k === 'eof') {
      if (!where) this.fail(t, 'the expression is empty; found nothing where a value should be. Write a value, such as a number, a name or a quoted text');
      // point at the last thing written: that is what wants finishing
      const last = this.toks[this.i - 2] ?? t;
      this.fail(last, `the expression \`${where}\` stops before its last value; found the end of the expression after ${shown(last)}. Finish it, e.g. \`${clip(where, 30)} ${last.v === 'not' ? 'done' : '1'}\`, or remove the trailing ${shown(last)}`);
    }
    const at = where ? `after \`${where}\`` : 'at the start of the expression';
    let fix: string;
    if (t.k === 'op' && OPENER[t.v]) fix = prev?.k === 'op' && prev.v === ',' ? `Remove the comma before \`${t.v}\`` : `Put a value before \`${t.v}\`, or remove the brackets`;
    else if (t.v === ',') fix = 'Remove the extra comma, or put a value before it';
    else if (t.v === '=') fix = 'To compare two values, write `==`';
    else if (t.v === '..') fix = 'A range has a start and an end: `0..10`';
    else if (t.v === '=>') fix = 'A function value names its parameter first: `x => x + 1`';
    else if (t.v === '.') fix = 'A field is read from a value: `p.x`';
    else if (['*', '/', '^', '+', '<', '>', '<=', '>=', '==', '!='].includes(t.v)) {
      fix = prev && prev.k === 'op' && !OPENER[prev.v] && prev.v !== '(' ? 'Remove one of the two operators' : `\`${t.v}\` goes between two values: write one before it, e.g. \`2 ${t.v} 3\``;
    } else fix = `Remove ${shown(t)}`;
    this.fail(t, `a value is needed ${at}, such as a number, a name, a quoted text or a bracket; found ${shown(t)}. ${fix}`);
  }
}

/** Names an expression reads (free variables), for dependency and input-only analysis. */
export function freeNames(e: Ex, bound: Set<string> = new Set(), out: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case 'id':
      if (!bound.has(e.name)) out.add(e.name);
      break;
    case 'list':
      e.items.forEach((x) => freeNames(x, bound, out));
      break;
    case 'rec':
      e.fields.forEach(([, x]) => freeNames(x, bound, out));
      break;
    case 'point':
      freeNames(e.x, bound, out);
      freeNames(e.y, bound, out);
      break;
    case 'call':
      if (!bound.has(e.f)) out.add(e.f);
      e.args.forEach((x) => freeNames(x, bound, out));
      break;
    case 'apply':
      freeNames(e.f, bound, out);
      e.args.forEach((x) => freeNames(x, bound, out));
      break;
    case 'field':
      freeNames(e.o, bound, out);
      break;
    case 'index':
      freeNames(e.o, bound, out);
      freeNames(e.i, bound, out);
      break;
    case 'neg':
    case 'not':
      freeNames(e.a, bound, out);
      break;
    case 'bin':
      freeNames(e.a, bound, out);
      freeNames(e.b, bound, out);
      break;
    case 'lam': {
      const b = new Set(bound);
      e.params.forEach((x) => b.add(x));
      freeNames(e.body, b, out);
      break;
    }
    case 'str':
    case 'tex':
      for (const h of valHoles(e.v)) {
        // holes are parsed later; a cheap scan of identifiers is enough for dependencies
        for (const m of h.src.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) if (!bound.has(m[0])) out.add(m[0]);
      }
      break;
    default:
      break;
  }
  return out;
}

export interface Hole {
  /** offset of "\val{" in the string */
  at: number;
  /** offset just after the closing brace */
  end: number;
  src: string;
}

/** Finds \val{…} holes (balanced braces) in text or maths. */
export function valHoles(s: string): Hole[] {
  const out: Hole[] = [];
  let i = s.indexOf('\\val{');
  while (i >= 0) {
    let depth = 1;
    let j = i + 5;
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    out.push({ at: i, end: j, src: s.slice(i + 5, j - 1) });
    i = s.indexOf('\\val{', j);
  }
  return out;
}
