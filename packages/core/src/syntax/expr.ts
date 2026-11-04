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

export class ExprParser {
  private i = 0;
  private readonly toks: Tok[];
  constructor(private readonly text: string, from: number, to: number, private readonly map: PosMap) {
    this.toks = tokenize(text, from, to);
  }

  static parse(text: string, from: number, to: number, map: PosMap): Ex {
    const p = new ExprParser(text, from, to, map);
    const e = p.expr();
    const t = p.peek();
    if (t.k !== 'eof') p.fail(t, `unexpected "${t.v}" after the expression`);
    return e;
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
  private expect(v: string): Tok {
    const t = this.next();
    if (t.k !== 'op' || t.v !== v) this.fail(t, `expected "${v}"${t.k === 'eof' ? ' before the end' : ` but found "${t.v}"`}`);
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
    const a = this.sum();
    const t = this.peek();
    if (t.k === 'op' && CMP.has(t.v)) {
      this.next();
      const b = this.sum();
      const u = this.peek();
      if (u.k === 'op' && CMP.has(u.v)) this.fail(u, 'comparisons do not chain; join them with "and"');
      return { k: 'bin', op: t.v as BinOp, a, b, p: this.pos(t) };
    }
    return a;
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
        const args = this.list(')');
        a = a.k === 'id' ? { k: 'call', f: a.name, args, p: a.p } : { k: 'apply', f: a, args, p: this.pos(t) };
        steps++;
      } else if (t.k === 'op' && t.v === '[' && !t.sp) {
        this.next();
        const i = this.expr();
        this.expect(']');
        a = { k: 'index', o: a, i, p: this.pos(t) };
      } else if (t.k === 'op' && t.v === '.' && !t.sp) {
        this.next();
        const n = this.next();
        if (n.k !== 'id') this.fail(n, 'expected a field name after "."');
        a = { k: 'field', o: a, name: n.v, p: this.pos(t) };
      } else return a;
    }
  }
  private list(close: string): Ex[] {
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
      this.expect(close);
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
        if (KEYWORDS.has(t.v)) this.fail(t, `"${t.v}" cannot start a value here`);
        return { k: 'id', name: t.v, p };
      case 'op':
        if (t.v === '(') {
          const e = this.expr();
          if (this.isOp(',')) {
            this.next();
            const y = this.expr();
            this.expect(')');
            return { k: 'point', x: e, y, p };
          }
          this.expect(')');
          return e;
        }
        if (t.v === '[') return { k: 'list', items: this.list(']'), p };
        if (t.v === '{') {
          const fields: [string, Ex][] = [];
          if (this.isOp('}')) {
            this.next();
            return { k: 'rec', fields, p };
          }
          for (;;) {
            const n = this.next();
            if (n.k !== 'id' && n.k !== 'str') this.fail(n, 'expected a field name in the record');
            this.expect(':');
            fields.push([n.v, this.expr()]);
            if (this.isOp(',')) {
              this.next();
              continue;
            }
            this.expect('}');
            return { k: 'rec', fields, p };
          }
        }
        if (t.v === '|') this.fail(t, 'there is no |x|; write abs(x)');
        return this.fail(t, `unexpected "${t.v}"`);
      default:
        return this.fail(t, 'the expression ends too early');
    }
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
