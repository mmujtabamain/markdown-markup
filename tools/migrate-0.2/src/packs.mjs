// A 0.2 pack (devbench@1, or any other a document uses) as a 0.3 shim: the same widgets with the same
// inputs, records and choices, declared `extern widget` with a markdown block each. It is the pack's
// interface, migrated mechanically from the definitions the bundle carries; how each widget is drawn
// is the pack owner's to write in 0.3 (a view over core's widgets), against this same signature.

import { D, E, P } from './tree.mjs';
import { Decls } from './decls.mjs';
import { resolve } from './values.mjs';
import { Unsupported, CORE_NAMES } from './context.mjs';
import { DefWriter, fnDecls } from './view.mjs';

export class PackShim extends Decls {
  constructor(m, pack, version) {
    super(m, pack);
    this.version = version;
    /** 0.2 def id → { name, params, slots, kids, decl } */
    this.widgets = new Map();
    /** with packWidgets, each definition is written as a 0.3 widget with a view where it can be */
    this.real = !!m.opts.packWidgets;
    // the shim's text is rich_text, as 0.2's text widget read inline Markdown; a real widget's
    // views hand text to label, so there it stays text
    this.rich = !this.real;
    /** every definition of the pack the bundle carries, named up front (a widget may use a part) */
    this.defNames = new Map(Object.values(m.b.defs).filter((d) => d.pack === pack).map((d) => [d.id, { name: this.name(d.name, 'widget') }]));
    this.written = 0;
    // the pack's own fns first, so a widget that calls one that didn't migrate stays an extern
    this.fns = this.real ? fnDecls(m, this, pack) : [];
  }

  /** A widget of this pack is used by another: declare it too. */
  want(id) {
    if (this.defNames.has(id)) this.widget(id);
  }

  /** The 0.3 widget for a 0.2 definition of this pack, declared on first use. */
  widget(id) {
    if (this.widgets.has(id)) return this.widgets.get(id);
    const m = this.m;
    const d = m.def(id);
    const at = { line: d.pos?.[0], pack: this.pack, sink: this, rich: this.rich };
    const name = this.defNames.get(id)?.name ?? this.name(d.name, 'widget');
    const w = { name, id, params: [], slots: [], kids: new Map(), inputs: new Map(), def: d };
    this.widgets.set(id, w);
    const listsOfRecords = [];
    for (const inp of d.inputs) {
      const t = resolve(m, inp.type, this.pack);
      if (t.t === 'slot') {
        w.slots.push([this.slotName(inp.name), 'view', inp.name]);
        continue;
      }
      if (t.t === 'records' && t.slot) {
        // one widget per record, with its fields as inputs and the record's content as its slot
        const kid = this.kid(t, d, at);
        w.kids.set(t.kind, kid);
        w.slots.push([this.slotName(inp.name), `list<${kid.name}>`, inp.name]);
        continue;
      }
      try {
        const f = this.field(inp.name, inp.type, inp.default, { ...at, hint: `${name}_${inp.name}` });
        if (inp.about) f.about = inp.about;
        if (inp.comment?.length) f.comments = inp.comment;
        w.params.push(f);
        w.inputs.set(inp.name, { f, t: inp.type });
        if (t.t === 'records') listsOfRecords.push([f.name, t]);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        m.todo(at.line, `${d.name}'s input ${inp.name} was left out of the 0.3 shim: ${e.what}`);
      }
    }
    // every 0.2 block had a summary; it keeps a home here, and the markdown block writes it
    if (!w.inputs.has('summary')) w.params.push({ name: 'summary', type: 'text', default: E.text(''), about: "the 0.2 block's summary: one sentence for readers without the widget" });
    const markdown = this.markdown(w, listsOfRecords);
    w.decl = D.widget({ name, extern: true, comments: d.comment, about: d.about ?? undefined, params: w.params, slots: w.slots.map(([n, t]) => [n, t]), markdown });
    if (this.real && d.kind !== 'extern') {
      try {
        const v = new DefWriter(m, this, this.defNames).widget(d);
        const params = [...v.params, ...w.params.filter((p) => !v.params.some((q) => q.name === p.name))];
        // a pack's widget needs a markdown block; one 0.2's project md didn't give is the generic one
        w.decl = D.widget({ ...v, params, markdown: v.markdown ?? markdown });
        this.written++;
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        m.todo(at.line, `${this.pack}'s ${d.name} stays an extern widget with a markdown block: its view did not migrate (${e.what})`);
      }
    }
    return w;
  }

  slotName(n) {
    let s = this.m.safe(n, CORE_NAMES);
    // a slot can't take a widget's name (names.view-named-like-a-widget)
    if (this.used.has(s) || [...this.widgets.values()].some((w) => w.name === s)) s = `${s}_slot`;
    return s;
  }

  /** A record kind with content (tabs' tab, accordion's section) as a widget of its own. */
  kid(t, d, at) {
    const name = this.name(t.kind, 'widget');
    const params = [];
    for (const [f, ft] of t.fields) {
      try {
        params.push(this.field(f, ft, t.defaults?.[f], { ...at, hint: `${name}_${f}` }));
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        this.m.todo(at.line, `${d.name}'s ${t.kind} field ${f} was left out: ${e.what}`);
      }
    }
    const first = params.find((p) => /^(rich_)?text$/.test(p.type));
    const md = [...(first ? [P.md(`**\\{${first.name}}**`)] : []), P.md('\\{body}')];
    const decl = D.widget({ name, extern: true, about: `One ${t.kind} of ${d.name}.`, params, slots: [['body', 'view']], markdown: md });
    const kid = { name, params, decl, fields: new Map(t.fields.map(([f, ft]) => [f, { f: params.find((p) => p.name === this.m.safe(f)), t: ft }])) };
    this.extraDecls ??= [];
    this.extraDecls.push(decl);
    return kid;
  }

  /** A markdown block any widget of this shape can have: its summary, its lists, its slots. */
  markdown(w, lists) {
    const out = [P.md('\\{summary}')];
    for (const [pname, t] of lists) {
      const rec = this.records.get(this.names.get(`record:${t.kind}`));
      const shown = (rec?.fields ?? []).filter((f) => /^(rich_)?text$|^(int|number)\b/.test(f.type)).slice(0, 3);
      if (!shown.length) continue;
      const v = 'x';
      out.push(P.for(v, E.name(pname), [P.md(`- ${shown.map((f) => `\\{${v}.${f.name}}`).join(' — ')}`)]));
    }
    for (const [s, t] of w.slots) out.push(t === 'view' ? P.md(`\\{${s}}`) : P.for('k', E.name(s), [P.md('\\{k}')]));
    return out;
  }

  file() {
    const fns = this.fns;
    const provides = [...this.widgets.values()].map((w) => w.name);
    for (const d of this.extraDecls ?? []) provides.push(d.name);
    // fns added to a type come with the pack, unlisted
    for (const d of [...this.decls(), ...fns]) if (!d.name.includes('.')) provides.push(d.name);
    return [
      D.comment(`The ${this.pack}@${this.version} pack's interface, migrated from MKP 0.2 by tools/migrate-0.2.\nEach widget is an extern with a markdown block: a 0.3 pack draws it with a view instead.`),
      D.pack(this.pack, this.version, ['core@1'], [...new Set(provides)]),
      ...this.decls(),
      ...fns,
      ...(this.extraDecls ?? []),
      ...[...this.widgets.values()].map((w) => w.decl),
    ];
  }
}
