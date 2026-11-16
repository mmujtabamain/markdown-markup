// What one migration knows and collects: the 0.2 bundle it reads, the names it gives, the enums and
// records it has to declare, and every note it makes (a TODO, a change in meaning, a fallback).

/** Thrown where a construct has no 0.3 form here: the caller falls back, keeping the content readable. */
export class Unsupported extends Error {
  constructor(what) {
    super(what);
    this.what = what;
  }
}

// 0.3 keywords can never be names, after a dot included (spec page 1)
export const KEYWORDS = new Set(
  'package import enum record type interface implements widget extern expose fn pack tokens mut let event invoke view markdown require if else for in match case return only step void any param slot try with self true false as token'.split(
    ' ',
  ),
);

// names core 0.3 provides (core/pack.mkp): a pack's or document's name may not reuse one
export const CORE_NAMES = new Set(
  `shown same ordered numeric scaled literal int map date moment template hole latex can_draw_tex md block list_item rich_text segment part marks
   point region pi euler color_value font_value shadow_value color space size radius font shadow stroke align justify weight text_size press_kind
   edge overlay_mode axis anchor head width theme track cols glyph page flex grid cell sizing plane spot paragraph heading bullets item quote code
   math table footnote divider cell_align label image icon press field slider overlay canvas layer shape circle path place handle pixel shade rect
   grow shrink basis min_size max_size aspect column row stack meter frame pane blocks number bool text duration list opt range view`.split(/\s+/),
);

// the values core provides: a value of the document can't take one of these names
export const CORE_VALUES = new Set(['pi', 'euler', 'page', 'can_draw_tex']);

export class Migration {
  constructor(bundle, opts = {}) {
    this.b = bundle;
    this.opts = opts;
    /** { kind: 'todo'|'lossy'|'fallback'|'info', line, what } */
    this.notes = [];
    /** packs other than core and the document's own, as 0.3 shims: name → PackShim (packs.mjs) */
    this.packs = new Map();
    /** 0.2 fn ids that did not migrate: what calls them falls back too */
    this.failedFns = new Set();
  }

  note(kind, line, what) {
    if (!this.notes.some((n) => n.kind === kind && n.line === line && n.what === what)) this.notes.push({ kind, line: line ?? null, what });
  }
  todo(line, what) {
    this.note('todo', line, what);
  }
  lossy(line, what) {
    this.note('lossy', line, what);
  }
  fallback(line, what) {
    this.note('fallback', line, what);
  }

  /**
   * A 0.2 name as a 0.3 name: a keyword, or a name already taken in its set, gets a suffix. Values
   * (inputs, fields, locals, fns) clash only with keywords and core's few values; types, widgets and
   * slots (which can't share a widget's name) pass `CORE_NAMES` and their own.
   */
  safe(name, used = CORE_VALUES) {
    let n = name.replace(/-/g, '_').toLowerCase();
    if (!/^[a-z]/.test(n)) n = 'x_' + n;
    if (KEYWORDS.has(n) || used.has(n)) n = n + '_';
    return n;
  }

  /** A choice option or a token name as a 0.3 case. */
  caseName(opt) {
    let c = String(opt).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    if (!/^[A-Z]/.test(c)) c = 'N' + c;
    return c;
  }

  /** The 0.2 definition a node uses. */
  def(id) {
    return id ? this.b.defs[id] : undefined;
  }

  /** A named 0.2 type, resolved in the pack it was written in. */
  named(name, pack) {
    const t = this.b.types ?? {};
    const hit = t[`${pack}:${name}`] ?? t[`core:${name}`] ?? Object.entries(t).find(([k]) => k.endsWith(`:${name}`))?.[1];
    if (hit) return hit;
    // a record kind declared inline in an input, list(record stat {…}), named by fns of its pack
    for (const d of Object.values(this.b.defs)) {
      if (d.pack !== pack) continue;
      for (const inp of d.inputs ?? []) {
        if (inp.type?.t === 'records' && inp.type.kind === name) return { t: 'rec', name, fields: inp.type.fields, defaults: inp.type.defaults };
      }
    }
    return undefined;
  }
}
