// Walking the IR (a bundle, or the items a printer reads) with the file each part was written in,
// and renaming a name the way the compiler would have seen it: in declarations, references and the
// source text of expressions, never in text, record fields or a field read (x.name).

export type Obj = Record<string, unknown>;

/** Calls `f` on every object under `v`, with the file it was written in (a definition's or the document's). */
export function walk(v: unknown, f: (o: Obj, file: string | undefined, parent: Obj | undefined, key: string | undefined) => void, file?: string, parent?: Obj, key?: string): void {
  if (Array.isArray(v)) {
    for (const x of v) walk(x, f, file, parent, key);
    return;
  }
  if (!v || typeof v !== 'object') return;
  const o = v as Obj;
  const here = typeof o.file === 'string' && (o.kind !== undefined || o.body !== undefined) ? o.file : file;
  f(o, here, parent, key);
  for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object') walk(x, f, here, o, k);
}

/** Every IR definition under `v` (bundle.defs's, and those inside a printer's file items). */
export function definitionsIn(v: unknown): Obj[] {
  const out: Obj[] = [];
  walk(v, (o) => {
    if (typeof o.id === 'string' && typeof o.kind === 'string' && Array.isArray(o.inputs) && !out.includes(o)) out.push(o);
  });
  return out;
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

/** `src` (an expression's source) with the identifier `from` renamed `to`: not inside text (but inside its \val{…} holes), not after a dot, not as a record field before a colon. */
export function renameInExpr(src: string, from: string, to: string): string {
  let out = '';
  let i = 0;
  const prevChar = (): string => out.replace(/\s+$/, '').slice(-1);
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      // a text: only its \val{…} holes are expressions
      const end = closeQuote(src, i + 1);
      out += '"' + renameInText(src.slice(i + 1, end), from, to) + (end < src.length ? '"' : '');
      i = end + 1;
      continue;
    }
    IDENT.lastIndex = i;
    const m = /[A-Za-z_]/.test(ch) ? IDENT.exec(src) : null;
    if (m) {
      const word = m[0];
      const after = src.slice(i + word.length).match(/^\s*(.)/)?.[1];
      out += word === from && prevChar() !== '.' && after !== ':' ? to : word;
      i += word.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Where a text that starts at `i` ends: the next `"` (a `"` always ends a text), past any \val{…} hole. */
function closeQuote(src: string, i: number): number {
  for (; i < src.length; i++) {
    if (src.startsWith('\\val{', i)) {
      i = closeBrace(src, i + 5);
      continue;
    }
    if (src[i] === '"') return i;
  }
  return src.length;
}

function closeBrace(src: string, i: number): number {
  let depth = 1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
  }
  return src.length;
}

/** A text's \val{…} holes with the identifier renamed; the words around them are left alone. */
export function renameInText(text: string, from: string, to: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = text.indexOf('\\val{', i);
    if (at < 0) return out + text.slice(i);
    const end = closeBrace(text, at + 5);
    out += text.slice(i, at + 5) + renameInExpr(text.slice(at + 5, end), from, to) + (end < text.length ? '}' : '');
    i = end + 1;
  }
}

/** Whether `name` is used as an identifier anywhere in `v`: a declared name or a word in an expression's source. */
export function usesName(v: unknown, name: string): boolean {
  let hit = false;
  const word = new RegExp(`(^|[^A-Za-z0-9_.])${name}([^A-Za-z0-9_]|$)`);
  walk(v, (o) => {
    if (hit) return;
    for (const [k, x] of Object.entries(o)) {
      if (x === name && (k === 'name' || k === 'var' || k === 'ref')) hit = true;
      else if (typeof x === 'string' && (k === 'expr' || k === 'body' || k === 'src') && word.test(x)) hit = true;
    }
  });
  return hit;
}
