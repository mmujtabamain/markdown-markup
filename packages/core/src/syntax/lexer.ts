// Lines and tokens for .mkp (spec 6.1, 6.2, 6.20).
//
// A source file becomes logical lines: inside an open bracket, line breaks are ignored; a `"""`
// long text spans physical lines and is folded into one ordinary text literal. Logical lines form
// an indentation tree (two spaces per level). Each line's arguments are chunks separated by
// spaces outside brackets, strings and maths.

import { Diagnostics, Pos } from '../diag';

export interface Seg {
  /** offset in the logical text where this physical piece starts */
  at: number;
  line: number;
  col: number;
}

export interface LLine {
  indent: number;
  text: string;
  segs: Seg[];
  comments: string[];
  children: LLine[];
  line: number;
}

export class PosMap {
  constructor(readonly file: string, readonly segs: Seg[]) {}
  at(offset: number): Pos {
    let s = this.segs[0];
    for (const g of this.segs) if (g.at <= offset) s = g;
    return { file: this.file, line: s.line, col: s.col + (offset - s.at) };
  }
}

/** Splits source into logical lines and builds the indentation tree. */
export function readLines(src: string, file: string, diags: Diagnostics): LLine[] {
  const phys = src.replace(/\r\n?/g, '\n').split('\n');
  const out: LLine[] = [];
  let pending: string[] = [];
  let i = 0;
  while (i < phys.length) {
    const raw = phys[i];
    const lineNo = i + 1;
    i++;
    if (/^\s*$/.test(raw)) continue;
    const tabAt = raw.search(/^[ ]*\t/);
    if (tabAt >= 0) {
      diags.error('mkp.tab', 'tabs are not allowed in indentation; indent with two spaces', { file, line: lineNo, col: raw.indexOf('\t') + 1 });
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const body = raw.slice(indent);
    if (body.startsWith('#')) {
      pending.push(body.slice(1).trim());
      continue;
    }
    let text = body;
    const segs: Seg[] = [{ at: 0, line: lineNo, col: indent + 1 }];
    // continuation and long text
    for (;;) {
      const st = scanState(text);
      if (st.longOpen >= 0) {
        // fold a """ … """ block into an ordinary text literal
        const lines: string[] = [];
        let closed = false;
        let after = '';
        while (i < phys.length) {
          const l = phys[i];
          i++;
          const t = l.trim();
          if (t.startsWith('"""')) {
            closed = true;
            after = t.slice(3);
            break;
          }
          lines.push(l);
        }
        if (!closed) {
          diags.error('mkp.unclosed-text', 'a """ long text is never closed; end it with a line holding """', { file, line: lineNo, col: indent + st.longOpen + 1 });
        }
        const lit = encodeLongText(dedent(lines));
        text = text.slice(0, st.longOpen) + lit + after;
        continue;
      }
      if (st.depth > 0 && i < phys.length) {
        const next = phys[i];
        const nIndent = next.length - next.trimStart().length;
        segs.push({ at: text.length + 1, line: i + 1, col: nIndent + 1 });
        text = text + ' ' + next.trim();
        i++;
        continue;
      }
      if (st.depth > 0) {
        diags.error('mkp.unclosed-bracket', 'a bracket is never closed', { file, line: lineNo, col: indent + 1 });
      }
      break;
    }
    out.push({ indent, text, segs, comments: pending, children: [], line: lineNo });
    pending = [];
  }
  return buildTree(out, file, diags);
}

function buildTree(lines: LLine[], file: string, diags: Diagnostics): LLine[] {
  const root: LLine = { indent: -2, text: '', segs: [], comments: [], children: [], line: 0 };
  const stack: LLine[] = [root];
  for (const l of lines) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= l.indent) stack.pop();
    const parent = stack[stack.length - 1];
    const want = parent.indent + 2;
    if (l.indent !== want && !(parent === root && l.indent === 0)) {
      if (l.indent > want) {
        diags.error('mkp.indent', `this line is indented ${l.indent} spaces; children are indented two spaces below their parent (${want})`, { file, line: l.line, col: 1 });
      } else if (l.indent % 2 !== 0) {
        diags.error('mkp.indent', 'indentation must be a multiple of two spaces', { file, line: l.line, col: 1 });
      }
    }
    parent.children.push(l);
    stack.push(l);
  }
  return root.children;
}

function dedent(lines: string[]): string {
  const nonBlank = lines.filter((l) => l.trim() !== '');
  const common = nonBlank.length ? Math.min(...nonBlank.map((l) => l.length - l.trimStart().length)) : 0;
  return lines.map((l) => l.slice(common).replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
}

/** Re-encodes multi-line text as a one-line text literal that decodes back to the same text. */
function encodeLongText(t: string): string {
  let out = '"';
  let maths = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && i + 1 < t.length) {
      out += c + t[i + 1];
      i++;
      continue;
    }
    if (c === '$') maths = !maths;
    if (c === '\n') out += maths ? ' ' : '\\n';
    else if (c === '"') out += '\\"';
    else out += c;
  }
  return out + '"';
}

interface ScanState {
  depth: number;
  longOpen: number;
}

/** Bracket depth at the end of a line, and where an unclosed """ starts (or -1). */
function scanState(text: string): ScanState {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      if (text.startsWith('"""', i)) {
        const close = text.indexOf('"""', i + 3);
        if (close < 0) return { depth, longOpen: i };
        i = close + 3;
        continue;
      }
      i = skipString(text, i);
      continue;
    }
    if (c === '$') {
      i = skipMaths(text, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    i++;
  }
  return { depth, longOpen: -1 };
}

/** Index just after a "…" literal starting at i (text mode escapes; maths inside is raw). */
export function skipString(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    // a quote always ends the literal, in maths too: "… $x^" + n + "$" is two strings, never one
    if (c === '"') return j + 1;
    j++;
  }
  return j;
}

/** Index just after a $…$ or $$…$$ literal starting at i. */
export function skipMaths(text: string, i: number): number {
  const display = text.startsWith('$$', i);
  let j = i + (display ? 2 : 1);
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '$') {
      if (display) {
        if (text.startsWith('$$', j)) return j + 2;
      } else return j + 1;
    }
    j++;
  }
  return j;
}

/** Decodes the body of a "…" literal: \" \\ \n outside maths; everything else is kept as written. */
export function decodeText(lit: string): string {
  const body = lit.slice(1, lit.endsWith('"') && lit.length > 1 ? -1 : undefined);
  let out = '';
  let maths = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      const n = body[i + 1];
      if (!maths && (n === '"' || n === '\\')) {
        out += n;
        i++;
        continue;
      }
      if (!maths && n === 'n') {
        out += '\n';
        i++;
        continue;
      }
      out += c + n;
      i++;
      continue;
    }
    if (c === '$') maths = !maths;
    out += c;
  }
  return out;
}

/** Encodes text as a "…" literal (the inverse of decodeText). */
export function encodeText(t: string): string {
  let out = '"';
  let maths = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '$' && !(i > 0 && t[i - 1] === '\\')) maths = !maths;
    if (maths) {
      out += c;
      continue;
    }
    if (c === '"') out += '\\"';
    else if (c === '\n') out += '\\n';
    else if (c === '\\') {
      const n = t[i + 1];
      // a backslash that would read as an escape must itself be escaped
      if (n === '"' || n === '\\' || n === 'n') out += '\\\\';
      else out += '\\';
    } else out += c;
  }
  return out + '"';
}

export interface Chunk {
  text: string;
  at: number;
}

/** Splits text into chunks at spaces outside brackets, strings and maths. */
export function chunks(text: string, from = 0): Chunk[] {
  const out: Chunk[] = [];
  let i = from;
  let start = -1;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (start < 0 && c !== ' ') start = i;
    if (c === '"') {
      i = skipString(text, i);
      continue;
    }
    if (c === '$') {
      i = skipMaths(text, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === ' ' && depth === 0 && start >= 0) {
      out.push({ text: text.slice(start, i), at: start });
      start = -1;
    }
    i++;
  }
  if (start >= 0 && start < text.length) out.push({ text: text.slice(start), at: start });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Expression tokens

export type TokKind = 'num' | 'id' | 'str' | 'tex' | 'op' | 'eof';

export interface Tok {
  k: TokKind;
  v: string;
  at: number;
  /** preceded by whitespace */
  sp: boolean;
  num?: number;
  display?: boolean;
}

const OPS = ['=>', '==', '!=', '<=', '>=', '..', '<', '>', '+', '-', '*', '/', '^', '(', ')', '[', ']', '{', '}', ',', ':', '.', '=', '|', '@', '#'];

export function tokenize(text: string, from: number, to: number): Tok[] {
  const toks: Tok[] = [];
  let i = from;
  let sp = true;
  while (i < to) {
    const c = text[i];
    if (c === ' ' || c === '\n' || c === '\t') {
      sp = true;
      i++;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? '') && text[i - 1] !== '.')) {
      let j = i;
      while (j < to && /[0-9]/.test(text[j])) j++;
      if (text[j] === '.' && /[0-9]/.test(text[j + 1] ?? '')) {
        j++;
        while (j < to && /[0-9]/.test(text[j])) j++;
      }
      if ((text[j] === 'e' || text[j] === 'E') && (/[0-9]/.test(text[j + 1] ?? '') || (/[+-]/.test(text[j + 1] ?? '') && /[0-9]/.test(text[j + 2] ?? '')))) {
        j += 2;
        while (j < to && /[0-9]/.test(text[j])) j++;
      }
      const v = text.slice(i, j);
      toks.push({ k: 'num', v, at, sp, num: Number(v) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < to && /[A-Za-z0-9_]/.test(text[j])) j++;
      toks.push({ k: 'id', v: text.slice(i, j), at, sp });
      i = j;
    } else if (c === '"') {
      const j = Math.min(skipString(text, i), to);
      toks.push({ k: 'str', v: decodeText(text.slice(i, j)), at, sp });
      i = j;
    } else if (c === '$') {
      const j = Math.min(skipMaths(text, i), to);
      const display = text.startsWith('$$', i);
      const d = display ? 2 : 1;
      toks.push({ k: 'tex', v: text.slice(i + d, Math.max(i + d, j - d)), at, sp, display });
      i = j;
    } else {
      const op = OPS.find((o) => text.startsWith(o, i));
      if (!op) {
        toks.push({ k: 'op', v: c, at, sp });
        i++;
      } else {
        toks.push({ k: 'op', v: op, at, sp });
        i += op.length;
      }
    }
    sp = false;
  }
  toks.push({ k: 'eof', v: '', at: to, sp: true });
  return toks;
}

/** Collapses whitespace outside strings and maths, for canonical expression source. */
export function normalizeSource(src: string): string {
  let out = '';
  let i = 0;
  let pendingSpace = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      const j = skipString(src, i);
      if (pendingSpace && out && !/[([{]$/.test(out)) out += ' ';
      pendingSpace = false;
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$') {
      const j = skipMaths(src, i);
      if (pendingSpace && out && !/[([{]$/.test(out)) out += ' ';
      pendingSpace = false;
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === ' ' || c === '\n' || c === '\t') {
      pendingSpace = true;
      i++;
      continue;
    }
    if (pendingSpace && out && !/[([{]$/.test(out) && !/[)\]},]/.test(c)) out += ' ';
    pendingSpace = false;
    out += c;
    i++;
  }
  return out;
}
