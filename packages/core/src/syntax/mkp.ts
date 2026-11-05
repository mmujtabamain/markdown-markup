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

const MANIFEST_WORDS = ['requires', 'depends', 'provides', 'front', 'attr', 'roles', 'rule', 'unpublished'];

/** A piece of source in backticks, clipped for a message. */
function q(s: string, max = 40): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return `\`${t.length > max ? `${t.slice(0, max - 1)}…` : t}\``;
}

/**
 * Why a name is refused, as "rule; found …", or null when it is fine. dotted names (definitions,
 * packs, elements) may also hold "." and "-"; plain ones (inputs, fns, types) only letters, digits, "_".
 */
function nameTrouble(name: string, dotted: boolean): string | null {
  const rule = dotted ? 'a name starts with a letter or `_` and uses only letters, digits, `.`, `-` and `_`' : 'a name starts with a letter or `_` and uses only letters, digits and `_`';
  if (!name) return `${rule}; found no name`;
  if (!/^[A-Za-z_]/.test(name)) return `${rule}; found ${name[0] === '"' ? 'a quoted text' : `\`${name[0]}\` at its start`}`;
  const ok = dotted ? /[A-Za-z0-9_.-]/ : /[A-Za-z0-9_]/;
  const bad = [...name].find((c) => !ok.test(c));
  if (bad) return `${rule}; found ${bad === ' ' ? 'a space' : `\`${bad}\``} in it`;
  return null;
}

/** A valid name close to the one written, for "e.g." in a message (or null). */
function nameFix(name: string, dotted: boolean): string | null {
  const lead = /^[0-9]+/.exec(name)?.[0] ?? '';
  let n = name.slice(lead.length) + lead;
  n = n.replace(dotted ? /[^A-Za-z0-9_.-]+/g : /[^A-Za-z0-9_]+/g, dotted ? '-' : '_').replace(/^[-_.]+|[-_.]+$/g, '');
  return n && /^[A-Za-z_]/.test(n) && n !== name ? n : null;
}

/** The message for a refused name: `2x` is not a valid input name: …. Rename it, e.g. `x2`. */
function badName(kind: string, name: string, dotted: boolean, example?: (fixed: string) => string): string {
  const fix = nameFix(name, dotted);
  const why = nameTrouble(name, dotted) ?? (dotted ? 'a name uses only letters, digits, `.`, `-` and `_`' : 'a name uses only letters, digits and `_`');
  return `${q(name)} is not a valid ${kind} name: ${why}. Rename it${fix ? `, e.g. \`${example ? example(fix) : fix}\`` : ''}`;
}

/** A starting value of a type, for examples: 0, "", false, [] or …. */
function sampleValue(typeSrc: string): string {
  const t = typeSrc.trim();
  if (/^(int|num)\b/.test(t)) return '0';
  if (/^(text|latex)\b/.test(t)) return '""';
  if (t === 'bool') return 'false';
  if (/^list\b/.test(t)) return '[]';
  if (/^point\b/.test(t)) return '(0, 0)';
  return '…';
}

/** The closest of words to w, when it is a likely typo (at most two edits away). */
function nearest(w: string, words: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = 3;
  for (const c of words) {
    const d = editDistance(w, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

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
      if (lastManifest && MANIFEST_WORDS.includes(word)) {
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

/**
 * The name and version of a "name@N" head. kw is the keyword before it (part, pack, …), or ''
 * for a widget's own line.
 */
function nameVersion(ctx: LineCtx, chunk: Chunk, kw: string): { name: string; version: number } {
  const m = /^([^@\s]+)@(\d+)$/.exec(chunk.text);
  const what = kw ? `the ${kw} name` : 'the widget name';
  const lead = kw ? `${kw} ` : '';
  if (!m) {
    if (chunk.text.startsWith('"')) ctx.fail(`${what} is missing: found the description ${q(chunk.text)} where the name goes. Add a name with its version before it, e.g. \`${lead}distance@1 ${clipText(chunk.text)}\``, chunk.at);
    const base = chunk.text.split('@')[0];
    const fixed = (nameTrouble(base, true) ? nameFix(base, true) : base) ?? 'name';
    ctx.fail(`${what} needs its version, written name@N (a pack's definitions are versioned); found ${q(chunk.text)}. Write \`${lead}${fixed}@1\``, chunk.at);
  }
  if (!NAME_RE.test(m[1])) ctx.fail(badName(kw || 'widget', m[1], true, (f) => `${lead}${f}@${m[2]}`), chunk.at);
  return { name: m[1], version: Number(m[2]) };
}

/** A quoted text, clipped for an example. */
function clipText(t: string): string {
  return t.length > 24 ? `${t.slice(0, 20)}…"` : t;
}

/** The optional "about" text at c. */
function optText(ctx: LineCtx, c: Chunk | undefined): string | undefined {
  if (!c) return undefined;
  if (!c.text.startsWith('"')) {
    const rest = ctx.text.slice(c.at).trim();
    const quoted = rest.includes('"') ? `"${c.text}"` : `"${rest}"`;
    ctx.fail(`a description must be quoted text; found ${q(c.text)} where it goes. Put it in double quotes, e.g. \`${quoted}\`, or remove it`, c.at);
  }
  return decodeText(c.text);
}

/**
 * A definition's head after its keyword: name@N (or a bare name in a document), type parameters
 * (of S, T) and its about text.
 */
function defHead(ctx: LineCtx, cs: Chunk[], at: number, inline: boolean): { name: string; version: number; params?: string[]; about?: string; inline?: boolean } {
  const kw = at > 0 ? cs[0].text : '';
  const c =
    cs[at] ??
    ctx.fail(
      inline
        ? `\`${kw}\` needs a name after it (letters, digits, \`.\`, \`-\` and \`_\`), then its description in quotes; found nothing. Write e.g. \`${kw} gauge "A dial."\``
        : `\`${kw}\` needs a name with its version after it (name@N), then its description in quotes; found nothing. Write e.g. \`${kw} distance@1 "A distance."\``,
      ctx.text.length,
    );
  let nv: { name: string; version: number };
  let bare = false;
  if (/@/.test(c.text) || !inline) nv = nameVersion(ctx, c, kw);
  else {
    if (c.text.startsWith('"')) ctx.fail(`\`${kw}\` needs a name before its description; found the description ${q(c.text)} where the name goes. Add a name, e.g. \`${kw} gauge ${clipText(c.text)}\``, c.at);
    if (c.text.includes(':')) ctx.fail(`a document's own definition takes a plain name, without a \`prefix:\`; found ${q(c.text)}. Write it without the prefix, e.g. \`${c.text.slice(c.text.lastIndexOf(':') + 1)}\``, c.at);
    if (!NAME_RE.test(c.text)) ctx.fail(badName(kw || 'widget', c.text, true, (f) => (kw ? `${kw} ${f}` : f)), c.at);
    nv = { name: c.text, version: 1 };
    bare = true;
  }
  const head = kw ? `${kw} ${c.text}` : c.text;
  let i = at + 1;
  let params: string[] | undefined;
  if (cs[i]?.text === 'of') {
    params = [];
    i++;
    while (cs[i] && !cs[i].text.startsWith('"')) {
      for (const n of cs[i].text.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!/^[A-Z][A-Za-z0-9]*$/.test(n)) {
          const fixed = n.replace(/[^A-Za-z0-9]/g, '').replace(/^[0-9]+/, '');
          const eg = fixed ? fixed[0].toUpperCase() + fixed.slice(1) : 'T';
          ctx.fail(
            `type parameters after \`of\` are single words starting with a capital letter (each stands for a type, told from what the widget is given); found ${q(n)}. Write e.g. \`${head} of ${eg} "…"\``,
            cs[i].at + Math.max(0, cs[i].text.indexOf(n)),
          );
        }
        params.push(n);
      }
      i++;
    }
    if (!params.length)
      ctx.fail(
        `\`of\` after ${q(head)} must be followed by type parameter names (capitalised words, each standing for a type, like \`T\`); found ${cs[i] ? 'the description' : 'nothing'} instead. Write e.g. \`${head} of T "…"\`, or remove \`of\``,
        cs[at + 1].at,
      );
  }
  const about = optText(ctx, cs[i]);
  if (cs[i + 1]) {
    const extra = cs[i + 1];
    ctx.fail(
      extra.text.startsWith('"')
        ? `${q(head)} takes one description; found a second text, ${q(extra.text)}, after it. Join the two into one quoted text, or remove ${q(extra.text)}`
        : `${q(head)} takes nothing after its description; found ${q(extra.text)}. Remove it, or move it to a line of its own below, indented two spaces`,
      extra.at,
    );
  }
  return { ...nv, ...(params ? { params } : {}), about, ...(bare ? { inline: true } : {}) };
}

function interfaceItem(ctx: LineCtx, diags: Diagnostics, comments: string[]): InterfaceSyn {
  const cs = chunks(ctx.text);
  const nv = nameVersion(ctx, cs[1] ?? ctx.fail('`interface` needs a name with its version after it (name@N), then its description in quotes; found nothing. Write e.g. `interface scored@1 "Something with a score."`', ctx.text.length), 'interface');
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
      else lc.fail(`an interface may list only \`in\`, \`host\` (data the host sets), \`signal\` and \`out\` lines, and \`project md\`; found ${memberDesc(m, c.text)}. Remove that line: a widget that implements the interface may still have it`, 0, 'mkp.syntax');
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

/** A member as an interface or continuation message names it: "a `var` line (`var n int = 0`)". */
function memberDesc(m: Member, text: string): string {
  if (m.m === 'node') return `the element ${q(m.node.head)}`;
  if (m.m === 'derived' || m.m === 'state') return `the line ${q(text)}`;
  return `a \`${m.m}\` line (${q(text)})`;
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
      if (head === 'extern' && inline)
        ctx.fail(
          `a document can't declare ${q(text.split('"')[0], 30)}: an extern is a widget drawn by the app's own code, so only a pack declares one; found \`extern\` here. Remove \`extern\` to write the widget in MKP (\`${cs[1]?.text ?? 'gauge'} "…"\` with its lines below), or move it to a pack`,
          0,
          'mkp.syntax',
        );
      const h = defHead(ctx, cs, 1, inline);
      return { item: 'def', kind: head === 'extern' ? 'extern' : 'part', ...h, members: members(ctx, diags), p, comments };
    }
    case 'interface':
      if (inline)
        ctx.fail(
          `a document can't declare ${q(text.split('"')[0], 30)}: an interface says what a host app relies on, so it is declared in the host's pack; found \`interface\` here. Move it into a .mkp file of that pack, or remove it and give the widget its \`in\` lines directly`,
          0,
          'mkp.syntax',
        );
      return interfaceItem(ctx, diags, comments);
    case 'tokens': {
      const nv = nameVersion(ctx, cs[1] ?? ctx.fail('`tokens` needs a name with its version after it (name@N); found nothing. Write e.g. `tokens brand@1 "Our colours."`', ctx.text.length), 'tokens');
      return { item: 'tokens', ...nv, about: optText(ctx, cs[2]), lines: tokenLines(ctx, diags), p, comments };
    }
    case 'pack':
    case 'profile': {
      const nv = nameVersion(ctx, cs[1] ?? ctx.fail(`\`${head}\` needs a name with its version after it (name@N), then its description in quotes; found nothing. Write e.g. \`${head} units@1 "Distances in kilometres."\``, ctx.text.length), head);
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
      if (eq < 0) {
        const n = text.slice(4).trim() || 'Name';
        ctx.fail(`${q(`type ${n}`)} needs \`=\` and the type it names; found no \`=\`. Write e.g. \`type ${n} = {value: num}\` (a record of fields and their types)`, text.length);
      }
      const name = text.slice(4, eq).trim();
      if (!IDENT_RE.test(name)) ctx.fail(badName('type', name, false, (f) => `type ${f} = …`), Math.max(5, text.indexOf(name, 4)));
      const { type } = parseType(text, eq + 1, text.length, ctx.map);
      return { item: 'type', name, type, p, comments };
    }
    case 'fn':
      return { item: 'fn', ...fnLine(ctx, 3, comments) };
    case 'op': {
      const m = /^op\s+(\S+?)\(/.exec(text);
      if (!m || !OP_SYMBOLS.has(m[1])) {
        const sym = m ? m[1] : (text.slice(2).trim().split(/[\s(]/)[0] ?? '');
        if (!m && OP_SYMBOLS.has(sym))
          ctx.fail(`${q(`op ${sym}`)} needs its parameters in brackets right after the symbol; found ${q(text.split('=')[0], 30)}. Write e.g. \`op ${sym}(a: vec2, b: vec2): vec2 = …\``, 3);
        ctx.fail(
          `${sym ? q(sym) : 'nothing'} is not an operator you can define; found ${q(text.split('=')[0], 30)}. Define one of \`+ - * / ^ == <\`, \`from\` (turns another type into this one: \`op from(n: num): vec2 = …\`) or \`point\` (makes a point of it: \`op point(v: vec2): point = …\`)`,
          3,
        );
      }
      return { item: 'op', symbol: m[1], ...fnLine(ctx, 3 + m[1].length, comments, m[1]) };
    }
    case 'const': {
      const eq = findTopEq(text, 6);
      if (eq < 0) {
        const n = text.slice(6).trim() || 'limit';
        ctx.fail(`${q(`const ${n}`)} needs \`=\` and its value; found no \`=\`. Write e.g. \`const ${n} = 10\` (a type may come before \`=\`: \`const ${n}: int = 10\`)`, text.length);
      }
      const lhs = text.slice(6, eq).trim();
      const colon = lhs.indexOf(':');
      const name = (colon >= 0 ? lhs.slice(0, colon) : lhs).trim();
      if (!IDENT_RE.test(name)) ctx.fail(badName('constant', name, false, (f) => `const ${f} = …`), Math.max(6, text.indexOf(name, 5)));
      const type = colon >= 0 ? parseType(text, 6 + colon + 1, eq, ctx.map).type : undefined;
      const { e, src } = exprAt(ctx, eq + 1, text.length);
      return { item: 'const', name, type, e, src, p, comments };
    }
    case 'macro': {
      const m = /^macro\s+([A-Za-z]+)\s*=\s*(\$.*)$/.exec(text);
      if (!m) ctx.fail(macroTrouble(text), 0);
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
      ctx.fail(unknownTop(head, cs, inline), 0, 'mkp.unknown-statement');
    }
  }
}

/** What is wrong with a macro line that doesn't read as macro name = $…$. */
function macroTrouble(text: string): string {
  const m = /^macro\s*([^\s=]*)\s*(=?)\s*(.*)$/.exec(text)!;
  const [, name, eq, value] = m;
  const shape = '(a macro names a piece of maths, written `\\R` inside $…$)';
  if (!name) return `\`macro\` needs a name, \`=\` and its maths ${shape}; found nothing after \`macro\`. Write e.g. \`macro R = $\\mathbb{R}$\``;
  if (!/^[A-Za-z]+$/.test(name)) return `a macro's name is letters only ${shape}; found ${q(name)}. Rename it, e.g. \`macro ${name.replace(/[^A-Za-z]/g, '') || 'R'} = $…$\``;
  if (!eq) return `${q(`macro ${name}`)} needs \`=\` and the maths it stands for ${shape}; found no \`=\`. Write e.g. \`macro ${name} = $\\mathbb{${name}}$\``;
  return `the value of ${q(`macro ${name}`)} must be maths in dollars; found ${value ? q(value) : 'nothing'}. Write it as \`macro ${name} = $${value && !value.startsWith('$') ? value.replace(/^"|"$/g, '') : '…'}$\``;
}

/** The message for a top-level line that starts nothing MKP knows. */
function unknownTop(head: string, cs: Chunk[], inline: boolean): string {
  const found = `found ${q(head)}`;
  if (MANIFEST_WORDS.includes(head) && head !== 'requires')
    return `\`${head}\` is a line of a pack's manifest; ${found} outside it. Move it into manifest.mkp, indented two spaces under the \`pack name@N\` line`;
  if (MEMBER_WORDS.has(head) && head !== 'fn')
    return `\`${head}\` lines belong inside a definition; ${found} at the top level. Indent it two spaces under the widget's own line (e.g. \`tally "A running count."\`)`;
  if (head.startsWith('@')) return `the event ${q(head)} must sit under the element it handles; ${found} at the top level. Indent it under that element, inside a widget`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(head) && cs[1]?.text === '=') return `${q(`${head} = …`)} belongs inside a definition; ${found} at the top level. Indent it two spaces under the widget's own line, or write \`const ${head} = …\` for a constant`;
  if (!inline && NAME_RE.test(head) && cs[1]?.text.startsWith('"')) return `a widget in a pack needs its version after its name; ${found} with none. Write \`${head}@1 ${clipText(cs[1].text)}\``;
  // several words, or a capitalised one, after a name read as an unquoted description
  if (inline && NAME_RE.test(head) && cs[1] && !MEMBER_WORDS.has(head) && (cs.length > 2 || /^[A-Z]/.test(cs[1].text)))
    return `the description after ${q(head)} must be in double quotes; found ${q(cs[1].text)}. Write \`${head} "${clipMid(cs.slice(1).map((c) => c.text).join(' ').replace(/"/g, ''))}"\``;
  if (inline && NAME_RE.test(head) && !cs[1]) return `a widget's line needs its description in quotes after the name; ${found} alone. Write e.g. \`${head} "What it shows."\``;
  const kws = inline ? '`part`, `tokens`, `type`, `fn`, `op`, `const` or `macro`' : '`part`, `extern`, `interface`, `tokens`, `type`, `fn`, `op`, `const`, `macro` or `pack`';
  const head0 = inline ? 'a widget name and its description (`tally "A running count."`)' : 'a widget name@N and its description (`tally@1 "A running count."`)';
  return `a top-level line starts a definition; ${found}. Start it with ${head0} or one of ${kws}, or remove the line`;
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
      if (cs.length > 1) ctx.fail(`\`unpublished\` is a bare flag (the pack may still change without a new version) and takes nothing after it; found ${q(text.slice(cs[1].at))}. Write just \`unpublished\`, or remove the line once the pack is published`, cs[1].at);
      m.unpublished = true;
      return;
    case 'front': {
      const name = cs[1]?.text;
      if (!name) ctx.fail('`front` declares a front-matter field, as `front name type [= default] ["about"]`; found nothing after it. Write e.g. `front title text "the lesson\'s title"`', text.length);
      if (!IDENT_RE.test(name)) ctx.fail(badName('front-matter field', name, false, (f) => `front ${f} text`), cs[1].at);
      const typed = typedMember(ctx, cs[1].at + name.length);
      m.front.push({ name, type: typed.type, def: typed.def, about: typed.about, p });
      return;
    }
    case 'attr': {
      const name = cs[1]?.text;
      if (!name)
        ctx.fail('`attr` declares a block attribute that a document may write on any block (`{name=value}`), as `attr name type ["about"]`; found nothing after it. Write e.g. `attr cite text "the slide this block cites"`', text.length);
      if (!IDENT_RE.test(name)) ctx.fail(badName('block attribute', name, false, (f) => `attr ${f} text`), cs[1].at);
      if (['role', 'id'].includes(name))
        ctx.fail(`\`${name}\` can't be declared as a block attribute: \`id\` and \`role\` are built in (\`{#name}\` names a block, \`{role=…}\` gives a section its role); found \`attr ${name}\`. Pick another name, e.g. \`attr audience text\``, cs[1].at);
      const typed = typedMember(ctx, cs[1].at + name.length);
      if (typed.def) {
        const eq = findTopEq(text, cs[1].at + name.length);
        const bare = `${text.slice(0, eq).trim()}${typed.about !== undefined ? ` "${typed.about}"` : ''}`;
        ctx.fail(`the block attribute \`${name}\` can't have a default: a block that doesn't write \`{${name}=…}\` simply has no value for it; found ${q(text.slice(eq).split('"')[0])}. Remove it: \`${bare}\``, eq);
      }
      m.attrs.push({ name, type: typed.type, about: typed.about, p });
      return;
    }
    case 'rule': {
      const rule = cs[1]?.text;
      const path = cs[2]?.text;
      if (!rule || !path)
        ctx.fail(
          `\`rule\` needs a rule name and a path (\`rule name path [args] ["message"]\`); found ${rule ? `only ${q(rule)}` : 'nothing after it'}. Rules: required, one-of, pattern, max-length, count, depth, first; paths: front.<field>, blocks.<widget>, roles.<role>. E.g. \`rule required front.title\``,
          cs[1]?.at ?? text.length,
        );
      const rest = cs.slice(3);
      let message: string | undefined;
      if (rest.length && rest[rest.length - 1].text.startsWith('"')) message = decodeText(rest.pop()!.text);
      m.rules.push({ rule, path, args: rest.map((c) => arg(ctx, c)), message, p });
      return;
    }
    default:
      ctx.fail(unknownManifest(cs[0].text), 0);
  }
}

/** Words authors reach for in a manifest, and the line that does the job. */
const MANIFEST_MEANT: Record<string, string> = {
  export: 'provides',
  exports: 'provides',
  expose: 'provides',
  public: 'provides',
  publish: 'provides',
  import: 'depends',
  imports: 'depends',
  include: 'depends',
  uses: 'depends',
  use: 'depends',
  needs: 'requires',
};

function unknownManifest(word: string): string {
  const list = 'requires, depends (another pack), provides (names documents may use), front, attr, roles, rule or unpublished';
  if (['part', 'extern', 'interface', 'tokens', 'type', 'fn', 'op', 'const', 'macro'].includes(word) || /@\d+$/.test(word))
    return `a manifest holds only the pack's own lines; found the definition ${q(word)} in it. Move the definition into another .mkp file of the pack, and list its name with \`provides\``;
  const meant = MANIFEST_MEANT[word] ?? nearest(word, MANIFEST_WORDS);
  const hint = meant ? ` Did you mean \`${meant}\`?${meant === 'provides' ? ' e.g. `provides distance` makes `distance` usable from documents' : ''}` : '';
  return `${q(word)} is not a manifest line; a line under \`pack name@N\` is ${list}.${hint || ' Rewrite the line as one of these, or remove it'}`;
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
  if (from >= to) {
    const lead = ctx.text.slice(0, from).trim();
    const eg = /^project\b/.test(lead) ? '"…"' : '0';
    ctx.fail(`${q(lead)} has nothing after it, where a value is needed; found the end of the line. Write the expression after it, e.g. \`${lead} ${eg}\``, Math.max(0, ctx.text.slice(0, from).trimEnd().length - 1));
  }
  const e = ExprParser.parse(ctx.text, from, to, ctx.map);
  return { e, src: ctx.text.slice(from, to).trim() };
}

function fnLine(ctx: LineCtx, nameAt: number, comments: string[], symbol?: string): FnSyn {
  const text = ctx.text;
  const open = text.indexOf('(', nameAt);
  if (open < 0) {
    const n = text.slice(nameAt).split(/[\s=:]/)[0] || 'name';
    ctx.fail(`${q(`fn ${n}`)} needs its parameters in brackets after the name; found no \`(\`. Write e.g. \`fn ${n}(x: num): num = …\` (or \`fn ${n}(): num = …\` with none)`, nameAt);
  }
  const name = symbol ?? text.slice(nameAt, open).trim();
  if (!symbol && !IDENT_RE.test(name)) ctx.fail(badName('function', name, false, (f) => `fn ${f}(…)`), nameAt);
  const fnHead = symbol ? `op ${symbol}` : `fn ${name}`;
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
  if (close < 0) ctx.fail(`the parameter list of ${q(fnHead)} opened with \`(\` is never closed; found no \`)\`. Add \`)\` after the last parameter, e.g. \`${fnHead}(w: num, h: num): num = …\``, open);
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
    const pAt = open + 1 + a + (piece.length - piece.trimStart().length);
    if (colon < 0 && /^[A-Za-z_][A-Za-z0-9_]*\s+\S/.test(pname)) {
      const [pn, ...pt] = pname.split(/\s+/);
      ctx.fail(`the parameter ${q(pname)} of ${q(fnHead)} needs \`:\` between its name and its type; found a space. Write \`${pn}: ${pt.join(' ')}\``, pAt);
    }
    if (!IDENT_RE.test(pname)) ctx.fail(badName('parameter', pname, false), pAt);
    const type = colon >= 0 ? parseType(text, open + 1 + a + colon + 1, open + 1 + b, ctx.map).type : undefined;
    params.push({ name: pname, type });
  }
  const eq = findTopEq(text, close + 1);
  const sig = text.slice(0, close + 1).trim();
  if (eq < 0) {
    const after = text.slice(close + 1).trim();
    ctx.fail(
      `${q(sig)} needs \`=\` and the expression it gives; found ${after ? q(after) : 'nothing'} after the parameters. Write the result type and body, e.g. \`${clipFn(sig)}${after.startsWith(':') ? ` ${after}` : ': num'} = …\``,
      close + 1,
    );
  }
  const retText = text.slice(close + 1, eq).trim();
  let ret: Type | undefined;
  if (retText) {
    if (!retText.startsWith(':'))
      ctx.fail(`the result type of ${q(fnHead)} comes after \`:\`, between the parameters and \`=\`; found ${q(retText)} with no \`:\`. Write \`${clipFn(sig)}: ${retText} = …\``, text.indexOf(retText, close + 1));
    ret = parseType(text, text.indexOf(':', close + 1) + 1, eq, ctx.map).type;
  }
  const { e, src } = exprAt(ctx, eq + 1, text.length);
  return { name, params, ret, body: e, src, p: ctx.pos(0), comments };
}

/** A fn's head up to its parameters, clipped for an example. */
function clipFn(sig: string): string {
  return sig.length > 40 ? `${sig.slice(0, sig.indexOf('(') + 1)}…)` : sig;
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
  const lead = text.slice(0, end).trim();
  if (after === 'answer') answer = true;
  else if (after) {
    const isIn = /^in\s/.test(lead);
    ctx.fail(
      `after the type in ${q(lead)} only ${isIn ? '`answer` (marks the input holding the answer), ' : ''}\`= default\` or a "description" may follow; found ${q(after)}. Remove it, or quote it and put it last if it is the description: \`${lead}${eq >= 0 ? ` ${text.slice(eq).trim()}` : ''} "${after}"\``,
      text.indexOf(after, end),
    );
  }
  let def: Val | undefined;
  if (eq >= 0) {
    const cs = chunks(text, eq + 1);
    const typeSrc = text.slice(from, eq).replace(/\banswer\b/, '').trim();
    if (!cs.length) ctx.fail(`${q(text.slice(0, eq + 1))} has nothing after \`=\`; found the end of the line. Write the default value after it, e.g. \`${text.slice(0, eq).trim()} = ${sampleValue(typeSrc)}\`, or remove \`=\``, eq);
    def = valueOf(ctx, cs[0]);
    // answer may also come after the default: in accept list(text) = [] answer "…"
    if (cs[1]?.text === 'answer') {
      answer = true;
      cs.splice(1, 1);
    }
    if (cs[1]) about = optText(ctx, cs[1]);
    if (cs.length > 2) {
      const extra = cs[2];
      ctx.fail(
        extra.text === 'answer'
          ? `\`answer\` must come before the description; found it after ${q(cs[1].text)}. Write \`${text.slice(0, cs[1].at).trim()} answer ${cs[1].text}\``
          : extra.text.startsWith('"')
            ? `${q(text.slice(0, eq).trim())} takes one description; found a second text, ${q(extra.text)}, after ${q(cs[1].text)}. Remove ${q(extra.text)}, or join the two into one quoted text`
            : `nothing may follow the description of ${q(text.slice(0, eq).trim())}; found ${q(extra.text)}. Remove it`,
        extra.at,
      );
    }
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
      const m = member(lc, diags);
      out.push(m);
      // only an element, a state line and a command take indented lines: anything else under a line is lost (GAPS 136)
      const under = c.children[0];
      if (under && m.m !== 'node' && m.m !== 'state' && m.m !== 'command') {
        new LineCtx(under, ctx.map.file).fail(continuation(m, c.text, under.text), 0, 'mkp.continuation');
      }
    } catch (e) {
      report(e, diags);
    }
  }
  return out;
}

/** A line indented under a member that takes none: show how to go on with it. */
function continuation(m: Member, line: string, under: string): string {
  const found = `found ${q(under)} below it`;
  if (m.m === 'derived' || m.m === 'project') {
    const eq = line.indexOf('=');
    const open = `${line.slice(0, eq + 1)} (${line.slice(eq + 1).trim()}`;
    return `${memberDesc(m, line)} can't have lines indented under it; ${found}. Join the two lines, or bracket the expression so it may break inside: \`${clipMid(open)}\` then \`${clipMid(under)})\` on the next line`;
  }
  return `${memberDesc(m, line)} can't have lines indented under it; ${found}. Join it to the line above, or, if it is a line of its own, indent it to line up with ${q(line, 20)}`;
}

/** Text clipped in the middle, for an example that must keep its ends. */
function clipMid(t: string): string {
  return t.length > 36 ? `${t.slice(0, 20)}…${t.slice(-12)}` : t;
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
        return {
          m: 'requires',
          cap: cs[1]?.text ?? ctx.fail('`requires` must name a capability (a feature the widget needs from the app) with its version; found nothing after it. Write e.g. `requires gfx@1`, or remove the line', text.length),
          p,
          comments,
        };
      case 'budget': {
        const n = Number(cs[1]?.text);
        if (!Number.isInteger(n) || n <= 0)
          ctx.fail(
            `\`budget\` takes a positive whole number: the operations one evaluation may use (1,000,000 without it, 20,000,000 at most); found ${cs[1] ? q(cs[1].text) : 'nothing after it'}. Write e.g. \`budget 2000000\`, with no commas`,
            cs[1]?.at ?? text.length,
          );
        return { m: 'budget', n, p, comments };
      }
      case 'implements': {
        const names = cs.slice(1).map((c) => c.text);
        if (!names.length) ctx.fail('`implements` must name an interface (what a host app relies on in this widget) with its version; found nothing after it. Write e.g. `implements scored@1`', text.length);
        for (const c of cs.slice(1))
          if (!/^[A-Za-z_][A-Za-z0-9_.:-]*@\d+$/.test(c.text))
            ctx.fail(`\`implements\` names each interface with its version, as name@N; found ${q(c.text)}. Write \`implements ${c.text.includes('@') ? c.text.split('@')[0] : c.text}@1\``, c.at);
        return { m: 'implements', names, p, comments };
      }
      case 'fields': {
        const names = cs.slice(1).map((c) => c.text);
        for (const c of cs.slice(1)) if (!IDENT_RE.test(c.text)) ctx.fail(`${badName('input', c.text, false, (f) => `fields ${f}`)} (\`fields\` lists the inputs that bare values after the widget's name fill, in order)`, c.at);
        return { m: 'fields', names, p, comments };
      }
      case 'in':
      case 'host':
      case 'var': {
        const name = cs[1]?.text;
        const kind = word === 'in' ? 'input' : word === 'host' ? 'host input' : 'var';
        if (!name) ctx.fail(`\`${word}\` needs a name and a type after it; found nothing. Write e.g. \`${word} n int${word === 'in' ? '' : ' = 0'}\``, text.length);
        if (!IDENT_RE.test(name)) ctx.fail(badName(kind, name, false, (f) => `${word} ${f} …`), cs[1].at);
        const t = typedMember(ctx, cs[1].at + name.length);
        if (word === 'in') return { m: 'in', name, ...t, p, comments };
        const typeSrc = text.slice(cs[1].at + name.length).split(/[="]/)[0].replace(/\banswer\b/, '').trim();
        if (t.answer) {
          const at = /\banswer\b/.exec(text.slice(cs[1].at));
          ctx.fail(
            `\`answer\` marks the input that holds the answer, so only an \`in\` line takes it; found it on the line ${q(`${word} ${name}`)}. Remove \`answer\`, or make it an input: \`in ${name} ${typeSrc} answer\``,
            at ? cs[1].at + at.index : 0,
          );
        }
        if (!t.def)
          ctx.fail(
            `${q(`${word} ${name} ${typeSrc}`)} needs a starting value: a ${kind} always has one${word === 'host' ? ', used until the host sets it' : ''}; found no \`=\`. Write \`${word} ${name} ${typeSrc} = ${sampleValue(typeSrc)}\``,
            text.length,
            'mkp.missing-default',
          );
        return { m: word, name, type: t.type, def: t.def, about: t.about, p, comments };
      }
      case 'out':
      case 'signal':
      case 'command': {
        const name = cs[1]?.text;
        const eg = word === 'out' ? 'out answered {correct: bool}' : word === 'signal' ? 'signal changed {value: num}' : 'command clear';
        if (!name) ctx.fail(`\`${word}\` needs a name after it${word === 'signal' ? ' and its payload' : ''}; found nothing. Write e.g. \`${eg}\``, text.length);
        if (!IDENT_RE.test(name)) ctx.fail(badName(word === 'out' ? 'event' : word, name, false, (f) => `${word} ${f}`), cs[1].at);
        const r = recordTypeAfter(ctx, cs[1].at + name.length);
        if (word === 'out') return { m: 'out', name, payload: r.payload, about: r.about, p, comments };
        if (word === 'signal') {
          if (!r.payload)
            ctx.fail(`\`signal ${name}\` needs its payload, the record of fields it sends to the host; found none. Add it in braces after the name, e.g. \`signal ${name} {value: num}\``, cs[1].at + name.length);
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
        if (!m) {
          const pm = /^project\s*([^\s=]*)\s*(=?)\s*(.*)$/.exec(text)!;
          const [, target, eq, rest] = pm;
          if (target === 'md' || target === 'mermaid') ctx.fail(`\`project ${target}\` needs \`=\` before its expression; found ${rest ? q(rest) : 'nothing'} after it. Write \`project ${target} = ${rest || '"…"'}\``, text.length - rest.length);
          ctx.fail(
            `\`project\` makes the widget's Markdown (\`md\`) or a Mermaid diagram (\`mermaid\`); found ${target ? q(`project ${target}`) : 'nothing after it'}. Write \`project md = ${eq && rest ? rest : '"…"'}\` or \`project mermaid = …\``,
            target ? text.indexOf(target, 7) : text.length,
          );
        }
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
  if (word.startsWith('@'))
    ctx.fail(
      `the event ${q(word)} has no element to handle it: an event goes under the element or state line it reacts to; found it among the widget's own lines. Indent it two spaces under that line, e.g. under \`press label="more"\``,
      0,
      'mkp.event-placement',
    );
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
    if (!m) {
      const inner = first.text.slice(7).replace(/[()"' ]/g, '') || 'a|b';
      ctx.fail(`\`choice(…)\` lists its options as plain words separated by \`|\`; found ${q(first.text)}. Write e.g. \`${name} = choice(${inner})\``, first.at);
    }
    opts = m[1].split('|').map((s) => s.trim());
    for (const o of opts)
      if (!IDENT_RE.test(o))
        ctx.fail(
          o ? badName('option', o, false, (f) => `choice(${opts!.map((x) => (x === o ? f : x)).join('|')})`) : `an option of \`choice(…)\` is empty; found ${q(first.text)}. Remove the extra \`|\``,
          first.at + Math.max(0, first.text.indexOf(o, 7)),
        );
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
      if (!v) ctx.fail(`the starting value after \`=\` is missing in ${q(text)}; found the end of the line. Write it after \`=\`, with a space, e.g. \`${name} = ${text.slice(at).trim()} 1\``, c.at);
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
      if (!c.text.startsWith('@'))
        lc.fail(
          `the state line ${q(text)} can have only events (\`@name action …\`) indented under it; found ${q(c.text)}. Unindent it to line up with ${q(`${name} = …`)}${/^(text\s+)?"/.test(c.text) ? `, or, to label the control, put the text at the end of the state line: \`${clipMid(`${text} ${c.text.replace(/^text\s+/, '')}`)}\`` : ''}`,
          0,
          'mkp.event-placement',
        );
      events.push(eventLine(lc, diags));
    } catch (e) {
      report(e, diags);
    }
  }
  return { m: 'state', name, control, opts, args, def, label, events, p: ctx.pos(0), comments: ctx.line.comments };
}

export function nodeLine(ctx: LineCtx, diags: Diagnostics, parent?: LLine): NodeSyn {
  const cs = chunks(ctx.text);
  const head = cs[0].text;
  // name=value at the start of an indented line: the writer meant to go on with the line above (GAPS 136)
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
    const above = parent ? q(parent.text) : 'the line above';
    const fix = parent ? `: \`${clipMid(`${parent.text} ${ctx.text}`)}\`` : '';
    ctx.fail(
      `${q(head)} is on a line of its own, indented under ${above}, but a line goes on to the next only inside an open bracket; found ${q(ctx.text)} as a line by itself. Put it at the end of the line above${fix}`,
      0,
      'mkp.continuation',
    );
  }
  if (!NAME_RE.test(head) && head !== 'else') {
    const fix = head.startsWith('"') || head.startsWith('$') ? `To show text, write \`text ${head.startsWith('$') ? `"${head}"` : head}\`` : `Start the line with an element's name${nameFix(head, true) ? `, e.g. \`${nameFix(head, true)}\`` : ''}`;
    ctx.fail(`a line inside a widget starts with an element's name (like \`text\`, \`row\` or \`press\`); found ${q(head)}. ${fix}`, 0);
  }
  const args = cs.slice(1).map((c) => arg(ctx, c));
  const children: NodeSyn[] = [];
  const events: EventSyn[] = [];
  for (const c of ctx.line.children) {
    const lc = new LineCtx(c, ctx.map.file);
    try {
      if (c.text.startsWith('@')) events.push(eventLine(lc, diags));
      else children.push(nodeLine(lc, diags, ctx.line));
    } catch (e) {
      report(e, diags);
    }
  }
  return { head, args, children, events, comments: ctx.line.comments, p: ctx.pos(0) };
}

function eventLine(ctx: LineCtx, diags: Diagnostics): EventSyn {
  const m = /^@([A-Za-z_][A-Za-z0-9_]*)/.exec(ctx.text);
  if (!m) {
    const first = firstWord(ctx.text);
    const rest = ctx.text.slice(first.length).trim();
    ctx.fail(
      `an event line is \`@\` and the event's name, then its actions; found ${first === '@' ? '`@` with no name after it' : q(first)}. Write e.g. \`@click ${clipMid(rest || 'set n=(n + 1)')}\` (events include @click, @change, @enter, @leave, @submit)`,
      0,
    );
  }
  // if=(…) anywhere on the line guards the whole line
  const cs = chunks(ctx.text, m[0].length);
  const guards = cs.filter((c) => c.text.startsWith('if='));
  const guard = guards[0];
  let cond: Val | undefined;
  if (guard) {
    if (guards.length > 1) {
      const conds = guards.map((g) => g.text.slice(3).replace(/^\((.*)\)$/, '$1'));
      ctx.fail(
        `an event line takes one \`if=\` condition; found a second, ${q(guards[1].text)}, after ${q(guard.text)}. Join them with \`and\` in one: \`if=(${conds.join(' and ')})\`, or put the actions on two event lines`,
        guards[1].at,
      );
    }
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
  if (!actions.length)
    ctx.fail(
      `the event \`@${m[1]}\` has no actions, so it would do nothing; found nothing after it. Add an action, such as \`set name=(value)\`, \`reveal id\` or \`emit name\`, e.g. \`@${m[1]} set n=(n + 1)\`, or remove the line`,
      m[0].length,
    );
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
    if (!out.length) ctx.fail(unknownAction(c.text, cs[cs.indexOf(c) + 1]?.text), c.at, 'mkp.unknown-action');
    out[out.length - 1].args.push(arg(ctx, c));
  }
  return out;
}

/** The first chunk of an action list is not an action name. */
function unknownAction(w: string, next?: string): string {
  const list = [...ACTION_NAMES].join(', ');
  const kv = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(w);
  if (kv) return `${q(w)} has no action before it; found a value to set with no \`set\`. Write \`set ${clipMid(w)}\` (actions are ${list})`;
  const near = nearest(w, ACTION_NAMES);
  const eg = next && /^[A-Za-z_][A-Za-z0-9_]*=/.test(next) ? `set ${clipMid(next)}` : 'set n=(n + 1)';
  return `${q(w)} is not an action; found it where an event's first action goes. Use one of ${list}${near ? ` (did you mean \`${near}\`?)` : ''}, e.g. \`${near ? `${near}${next ? ` ${clipMid(next)}` : ''}` : eg}\``;
}

function arg(ctx: LineCtx, c: Chunk): Arg {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(?!=)/.exec(c.text);
  if (m) {
    const vc = { text: c.text.slice(m[0].length), at: c.at + m[0].length };
    if (!vc.text)
      ctx.fail(
        `\`${m[1]}=\` has no value after it; found ${ctx.text.length > c.at + c.text.length ? 'a space, which ends the argument' : 'the end of the line'}. Write the value right after \`=\`, with no space, e.g. \`${m[1]}=3\`, or \`${m[1]}=(…)\` around an expression`,
        c.at,
      );
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
