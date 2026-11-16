// Where a migration declares the enums and records its types need: in the document, or in a pack
// shim. Both are a Decls: it hands out a 0.3 name per 0.2 choice or record, declaring it once.

import { D, E, S } from './tree.mjs';
import { typeOf, resolve, lit, token } from './values.mjs';
import { CORE_NAMES, Unsupported } from './context.mjs';

export class Decls {
  constructor(m, pack) {
    this.m = m;
    /** the 0.2 pack whose names these are ($doc for the document) */
    this.pack = pack;
    this.enums = new Map();
    this.records = new Map();
    /** 0.2 name → 0.3 name */
    this.names = new Map();
    this.used = new Set(CORE_NAMES);
    /** the show fn of each enum */
    this.shows = new Map();
  }

  /** A 0.3 name for something of this pack, not clashing with core or the pack's other names. */
  name(n02, kind) {
    const key = `${kind}:${n02}`;
    if (this.names.has(key)) return this.names.get(key);
    let n = this.m.safe(n02, this.used);
    while (this.used.has(n)) n += '_';
    this.used.add(n);
    this.names.set(key, n);
    return n;
  }

  /**
   * The enum for a 0.2 choice. A named choice (type state = choice(…)) keeps its name; an inline one
   * is named from where it is first used (`hint`) and shared by every choice with the same options.
   */
  enumFor(n02, cases, hint) {
    const key = n02 ? `enum:${n02}` : `enum-of:${cases.join('|')}`;
    if (this.names.has(key)) return this.names.get(key);
    const name = this.name(n02 ?? hint ?? 'choice', 'enum');
    this.names.set(key, name);
    this.enums.set(name, D.enum(name, cases.map((c) => this.m.caseName(c))));
    // a 0.2 choice was text: it showed as its option's name, in a hole or joined to text. A show fn
    // keeps that, and makes the enum fit `shown`.
    this.shows.set(
      name,
      D.fn(`${name}.show`, [['self', null]], 'text', [S.match(E.name('self'), cases.map((c) => [[`${name}.${this.m.caseName(c)}`], [S.ret(E.text(c))]]))]),
    );
    return name;
  }

  /** The record for a 0.2 record type: by its name, or for an inline one, by its fields. */
  recordFor(n02, fields, defaults, at) {
    const key = n02 ? `record:${n02}` : `record-of:${JSON.stringify(fields)}`;
    if (this.names.has(key)) return this.names.get(key);
    const name = this.name(n02 ?? at.hint ?? 'fields', 'record');
    this.names.set(key, name);
    this.records.set(name, null); // reserve it: a record may hold itself in a list
    this.records.set(name, D.record(name, fields.map(([f, t]) => this.field(f, t, defaults?.[f], { ...at, hint: `${name}_${f}` }))));
    return name;
  }

  /** A record field or a widget input: its 0.3 type, and its default. */
  field(f, t02, def02, at) {
    const m = this.m;
    const at2 = { ...at, sink: this, pack: this.pack };
    const t = typeOf(m, t02, at2);
    const out = { name: m.safe(f), type: t.src };
    let d = null;
    if (def02 !== undefined) d = typeof def02 === 'string' ? defaultSrc(m, def02, resolve(m, t02, this.pack), at2) : defaultVal(m, def02, resolve(m, t02, this.pack), at2);
    if (t.none) {
      out.type = `opt<${t.src}>`;
      // a 0.2 `none` default is 0.3's opt.NONE; a field with no default stays required
      if (d === null && def02 !== undefined) d = E.none();
    }
    if (d) out.default = d;
    if (t.mut) out.mut = true;
    return out;
  }

  decls() {
    return [...this.enums.values(), ...this.shows.values(), ...[...this.records.values()].filter(Boolean)];
  }
}

/** A default as a 0.2 IRVal. */
function defaultVal(m, v, t, at) {
  if ('lit' in v) return lit(m, v.lit, t, at);
  if ('text' in v) return E.text(v.text);
  if ('tok' in v) return token(m, v.kind, v.tok, at.line);
  if ('ms' in v) return E.dur(v.ms);
  throw new Unsupported('a default that is an expression');
}

/** A record field's default, as 0.2 wrote it in source (`""`, `none`, `false`, `[]`, `3`, `ok`). */
function defaultSrc(m, src, t, at) {
  const s = src.trim();
  if (s === 'none' && t?.t !== 'choice') return E.none();
  if (s === 'true' || s === 'false') return E.bool(s === 'true');
  if (/^-?\d+(\.\d+)?$/.test(s)) return E.num(s);
  if (/^"([^"\\]|\\.)*"$/.test(s)) return E.text(JSON.parse(s));
  if (s === '[]') return E.list([]);
  if (/^[a-z][a-z0-9_]*$/.test(s)) return lit(m, s, t, at);
  try {
    return lit(m, JSON.parse(s), t, at);
  } catch {
    throw new Unsupported(`the default ${s}`);
  }
}
