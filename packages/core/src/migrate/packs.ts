// A pack's own versions (migrate walk@1 -> walk@2): how a use of one version moves to the next, as
// the pack declares it in MKP (no code from a pack ever runs). The compiler checks the declaration
// against both definitions (every input of the old one is renamed, dropped, or kept by name; every
// input the new one needs is given), proves it on the old version's fixtures (each case, moved, must
// compile against the new one), and `mkp migrate` moves the uses in documents and definitions.

import type { Compiled } from '../build';
import { caseDocument, fixtureCases } from '../fixtures';
import { Diagnostics, type Diagnostic, type Pos } from '../diag';
import type { IRDef, IRNode, IRVal } from '../ir';
import { parseValueString, type MigrateSyn, type MoveLine } from '../syntax/mkp';
import { DefChecker } from '../check/def';
import { resolve, type Type, type TypeEnv } from '../types';
import { walk, type Obj } from './walk';

/** A checked migrate block: ids, and what happens to each input, each record field and each value. */
export interface PackMove {
  pack: string;
  from: string;
  to: string;
  rename: Record<string, string>;
  drop: { name: string; why: string }[];
  keep: { name: string; value: IRVal; why: string }[];
  /** a record list's fields, by the old input's name: renamed and dropped in each of its items */
  fields: Record<string, { rename: Record<string, string>; drop: { name: string; why: string }[] }>;
  /** values mapped one for one, by the old input's name, or input.field for a record list's field */
  map: Record<string, Record<string, string>>;
  /** what a moved record list's items become: by the new input's name, its record kind and the defaults of fields no old field becomes */
  records: Record<string, { kind: string; fill: Record<string, IRVal> }>;
  pos: Pos;
}

type RecordsType = Extract<Type, { t: 'records' }>;

/** The pack's migrate blocks, checked; errors go to `diags`. */
export function packMoves(c: Compiled, diags: Diagnostics): PackMove[] {
  const out: PackMove[] = [];
  for (const p of c.prog.packs.values()) {
    if (p.builtin) continue;
    for (const f of p.files) {
      for (const it of f.items) {
        if (it.item !== 'migrate') continue;
        const m = it as MigrateSyn;
        const at = (q: Pos = m.p): Pos => q;
        const fromId = `${p.name}:${m.from}`;
        // the new version is this pack's, or (pack:name@N) one from a pack it depends on
        const toId = m.to.includes(':') ? m.to : `${p.name}:${m.to}`;
        const toPack = toId.split(':')[0];
        const a = c.defs.get(fromId);
        const b = c.defs.get(toId);
        const versions = (pack: string, name: string) => [...c.defs.values()].filter((d) => d.pack === pack && d.name === name).map((d) => `${d.name}@${d.version}`);
        if (m.from.includes(':')) {
          diags.error('mkp.migrate-pack', `a migrate block moves uses of this pack's own widgets; found ${m.from}. Write it in the pack that defines it, as migrate ${m.from.split(':')[1]} -> …`, at());
          continue;
        }
        if (toPack !== p.name && !p.depends.some((d) => d.replace(/@\d+$/, '') === toPack)) {
          diags.error('mkp.migrate-pack', `migrate moves uses to ${m.to}, from pack ${toPack}, which pack ${p.name} doesn't depend on; found no ${toPack} under its depends. Add \`depends ${toPack}@1\` to its manifest, or move them to one of its own widgets`, at());
          continue;
        }
        if (!a || !b) {
          const [pk, w] = !a ? [p.name, m.from] : [toPack, toId.split(':')[1]];
          diags.error('mkp.migrate-pack', `migrate names ${!a ? m.from : m.to}, which pack ${pk} doesn't define; the versions it has are ${versions(pk, w.split('@')[0]).join(', ') || 'none'}. A migrate block moves uses from one widget to a later version of it, or to another widget`, at());
          continue;
        }
        if (fromId === toId || (a.pack === b.pack && a.name === b.name && b.version <= a.version)) {
          diags.error('mkp.migrate-pack', `migrate moves uses of one widget to a later version of it, or to another widget; found ${m.from} -> ${m.to}. Write e.g. migrate ${a.name}@${a.version} -> ${a.name}@${a.version + 1}`, at());
          continue;
        }
        const aenv = c.prog.typeEnv(a.pack);
        const benv = c.prog.typeEnv(b.pack);
        const ain = new Map(a.inputs.map((x) => [x.name, x]));
        const bin = new Map(b.inputs.map((x) => [x.name, x]));
        const recordsOf = (t: Type | undefined, env: TypeEnv): RecordsType | null => {
          const r = t ? resolve(t, env) : null;
          return r?.t === 'records' ? r : null;
        };
        const move: PackMove = { pack: p.name, from: fromId, to: toId, rename: {}, drop: [], keep: [], fields: {}, map: {}, records: {}, pos: m.p };
        const said = new Set<string>();
        const fieldsSaid = new Map<string, Set<string>>();
        const saidField = (inp: string, field: string): void => void (fieldsSaid.get(inp) ?? fieldsSaid.set(inp, new Set()).get(inp)!).add(field);
        const fieldsOf = (inp: string) => (move.fields[inp] ??= { rename: {}, drop: [] });
        // a path's input and, for items.field, the record list it names and the field
        const oldPath = (path: string, q: Pos, what: string): { inp: string; field?: string; rec?: RecordsType } | null => {
          const [inp, field] = path.split('.');
          if (!ain.has(inp)) {
            diags.error('mkp.migrate-pack', `${m.from} has no input ${inp}${what}; its inputs are ${[...ain.keys()].join(', ')}`, at(q));
            return null;
          }
          if (field === undefined) return { inp };
          const rec = recordsOf(ain.get(inp)!.type, aenv);
          if (!rec) {
            diags.error('mkp.migrate-pack', `${m.from}'s ${inp} isn't a record list, so it has no field ${field}; found ${path}. A dotted name reaches a field of each item of a record list (items.name)`, at(q));
            return null;
          }
          if (!rec.fields.some(([n]) => n === field)) {
            diags.error('mkp.migrate-pack', `the items of ${m.from}'s ${inp} have no field ${field}${what}; their fields are ${rec.fields.map(([n]) => n).join(', ')}`, at(q));
            return null;
          }
          return { inp, field, rec };
        };
        const newInput = (inp: string): string => move.rename[inp] ?? inp;
        // top-level lines first, so a field's line knows what its record list became
        const lines = [...m.lines].sort((x, y) => Number(lineName(x).includes('.')) - Number(lineName(y).includes('.')));
        for (const l of lines) {
          if (l.k === 'rename') {
            if (l.from.includes('.') !== l.to.includes('.')) {
              diags.error('mkp.migrate-pack', `a rename moves an input to an input, or a record list's field to a field; found ${l.from} -> ${l.to}. Write e.g. rename items -> rows, then rename items.name -> rows.title`, at(l.p));
              continue;
            }
            const o = oldPath(l.from, l.p, ', so it can\'t be renamed');
            if (!o) continue;
            if (o.field === undefined) {
              said.add(o.inp);
              if (!bin.has(l.to)) diags.error('mkp.migrate-pack', `${m.to} has no input ${l.to} for ${l.from} to become; its inputs are ${[...bin.keys()].join(', ')}`, at(l.p));
              else move.rename[l.from] = l.to;
              continue;
            }
            saidField(o.inp, o.field);
            const [ninp, nfield] = l.to.split('.');
            if (ninp !== newInput(o.inp)) {
              diags.error('mkp.migrate-pack', `${o.inp}'s items become ${newInput(o.inp)}'s, so its field ${o.field} becomes a field of ${newInput(o.inp)}; found ${l.to}. Write rename ${l.from} -> ${newInput(o.inp)}.${nfield}${ninp !== o.inp && !move.rename[o.inp] ? `, after rename ${o.inp} -> ${ninp}` : ''}`, at(l.p));
              continue;
            }
            const nrec = recordsOf(bin.get(ninp)?.type, benv);
            if (!nrec) diags.error('mkp.migrate-pack', `${m.to}'s ${ninp} isn't a record list, so ${l.from} has no field there to become; found ${l.to}`, at(l.p));
            else if (!nrec.fields.some(([n]) => n === nfield)) diags.error('mkp.migrate-pack', `the items of ${m.to}'s ${ninp} have no field ${nfield} for ${l.from} to become; their fields are ${nrec.fields.map(([n]) => n).join(', ')}`, at(l.p));
            else fieldsOf(o.inp).rename[o.field] = nfield;
          } else if (l.k === 'drop') {
            const o = oldPath(l.name, l.p, ' to drop');
            if (!o) continue;
            if (o.field === undefined) {
              move.drop.push({ name: l.name, why: l.why });
              said.add(l.name);
            } else {
              fieldsOf(o.inp).drop.push({ name: o.field, why: l.why });
              saidField(o.inp, o.field);
            }
          } else if (l.k === 'map') {
            const o = oldPath(l.name, l.p, ' to map the values of');
            if (!o) continue;
            const oldT = o.field === undefined ? ain.get(o.inp)!.type : o.rec!.fields.find(([n]) => n === o.field)![1];
            const ot = resolve(oldT, aenv);
            if (ot.t !== 'choice' && ot.t !== 'text') {
              diags.error('mkp.migrate-pack', `map changes a choice's or a text's values, one for one; ${l.name} in ${m.from} takes ${ot.t}`, at(l.p));
              continue;
            }
            const opts = ot.t === 'choice' ? ot.opts : null;
            const bad = opts ? l.values.filter(([x]) => !opts.includes(x)).map(([x]) => x) : [];
            if (opts && bad.length) diags.error('mkp.migrate-pack', `${l.name} in ${m.from} is one of ${opts.join(', ')}; found ${bad.join(', ')} on the left of map`, at(l.p));
            move.map[l.name] = Object.fromEntries(l.values);
          } else {
            const inp = bin.get(l.name);
            if (!inp) {
              diags.error('mkp.migrate-pack', `${m.to} has no input ${l.name} to keep the old look with; its inputs are ${[...bin.keys()].join(', ')}`, at(l.p));
              continue;
            }
            const entry = c.prog.defs.get(toId);
            const dc = entry ? new DefChecker(c.prog, entry, diags, { tokenNames: c.tokenNameFn(), sigs: c.sigs, locked: c.lockedFn() }) : null;
            try {
              if (dc) move.keep.push({ name: l.name, value: dc.staticValue(l.value, inp.type, l.p, l.name), why: l.why });
            } catch (e) {
              dc?.err(e);
            }
          }
        }
        // every input of the old version goes somewhere, and the new one gets what it needs
        for (const n of ain.keys()) if (!said.has(n) && !bin.has(n)) diags.error('mkp.migrate-pack', `${m.from}'s input ${n} isn't in ${m.to}, and the migrate block doesn't say where it goes; found no rename or drop for it. Add \`rename ${n} -> …\` or \`drop ${n} "why"\``, at());
        const given = new Set([...[...ain.keys()].filter((n) => !said.has(n)), ...Object.values(move.rename), ...move.keep.map((k) => k.name)]);
        for (const x of b.inputs) if (!x.default && !given.has(x.name) && resolve(x.type, benv).t !== 'slot' && resolve(x.type, benv).t !== 'records') diags.error('mkp.migrate-pack', `${m.to} needs ${x.name}, which a use of ${m.from} doesn't give and the migrate block doesn't set; found no input of ${m.from} that becomes it. Add \`rename … -> ${x.name}\`, or give ${x.name} a default in ${m.to}`, at());
        // the same for each record list that moves: every field goes somewhere, and each item gets what the new record needs
        const entry = c.prog.defs.get(toId);
        const dc = entry ? new DefChecker(c.prog, entry, new Diagnostics(), { tokenNames: c.tokenNameFn(), sigs: c.sigs, locked: c.lockedFn() }) : null;
        for (const [inp, x] of ain) {
          const orec = recordsOf(x.type, aenv);
          if (!orec || move.drop.some((d) => d.name === inp)) continue;
          const nrec = recordsOf(bin.get(newInput(inp))?.type, benv);
          if (!nrec) {
            if (bin.has(newInput(inp))) diags.error('mkp.migrate-pack', `${m.from}'s ${inp} is a record list, and ${m.to}'s ${newInput(inp)} isn't; found ${inp} -> ${newInput(inp)}. Drop it, or move it to a record list`, at());
            continue;
          }
          const fm = move.fields[inp] ?? { rename: {}, drop: [] };
          const s2 = fieldsSaid.get(inp) ?? new Set();
          const nnames = new Set(nrec.fields.map(([n]) => n));
          for (const [fname] of orec.fields) if (!s2.has(fname) && !nnames.has(fname)) diags.error('mkp.migrate-pack', `the items of ${m.from}'s ${inp} have a field ${fname} that those of ${m.to}'s ${newInput(inp)} don't, and the migrate block doesn't say where it goes. Add \`rename ${inp}.${fname} -> ${newInput(inp)}.…\` or \`drop ${inp}.${fname} "why"\``, at());
          const gave = new Set([...orec.fields.map(([n]) => n).filter((n) => !s2.has(n)), ...Object.values(fm.rename)]);
          const fill: Record<string, IRVal> = {};
          for (const [fname, ft] of nrec.fields) {
            if (gave.has(fname) || recordsOf(ft, benv)) continue;
            const d = nrec.defaults?.[fname];
            if (d === undefined) {
              diags.error('mkp.migrate-pack', `the items of ${m.to}'s ${newInput(inp)} need ${fname}, which those of ${m.from}'s ${inp} don't give; found no field that becomes it. Add \`rename ${inp}.… -> ${newInput(inp)}.${fname}\`, or give ${fname} a default in ${m.to}`, at());
              continue;
            }
            try {
              if (dc) fill[fname] = dc.staticValue(parseValueString(d), ft, m.p);
            } catch {
              /* the new version's own check reports a bad default */
            }
          }
          move.records[newInput(inp)] = { kind: nrec.kind, fill };
        }
        // every value of a choice goes somewhere: kept as it is, or mapped
        const choicePairs: [string, Type, Type | undefined][] = [];
        for (const [inp, x] of ain) {
          if (said.has(inp) && !move.rename[inp]) continue;
          choicePairs.push([inp, x.type, bin.get(newInput(inp))?.type]);
          const orec = recordsOf(x.type, aenv);
          const nrec = recordsOf(bin.get(newInput(inp))?.type, benv);
          if (!orec || !nrec) continue;
          const fm = move.fields[inp] ?? { rename: {}, drop: [] };
          for (const [fname, ft] of orec.fields) {
            if (fm.drop.some((d) => d.name === fname)) continue;
            choicePairs.push([`${inp}.${fname}`, ft, nrec.fields.find(([n]) => n === (fm.rename[fname] ?? fname))?.[1]]);
          }
        }
        for (const [path, ot0, nt0] of choicePairs) {
          if (!nt0) continue;
          const ot = resolve(ot0, aenv);
          const nt = resolve(nt0, benv);
          const table = move.map[path] ?? {};
          if (nt.t === 'choice' && (ot.t === 'choice' || move.map[path])) {
            const from = ot.t === 'choice' ? ot.opts : Object.keys(table);
            const lost = from.filter((v) => !nt.opts.includes(table[v] ?? v));
            if (lost.length) diags.error('mkp.migrate-pack', `${path} in ${m.to} is one of ${nt.opts.join(', ')}, so ${lost.map((v) => table[v] ?? v).join(', ')} from ${m.from} has nowhere to go. Add \`map ${path}: ${lost.map((v) => `${v} -> ${nt.opts[0]}`).join(', ')}\` with the values it becomes`, at());
          }
        }
        out.push(move);
      }
    }
  }
  return out;
}

const lineName = (l: MoveLine): string => (l.k === 'rename' ? l.from : l.name);

/** An input's value as a fixture (YAML) writes it, for moving cases. */
function jsonOf(v: IRVal): unknown {
  const o = v as Obj;
  if ('lit' in o) return o.lit;
  if ('text' in o) return o.text;
  if ('tok' in o) return o.tok;
  return undefined;
}

/** What a move does to a use, in words: "from is now start; items.icon is gone (why); items.state: done is now ok". */
export function moveSummary(m: PackMove): string {
  const vals = (path: string): string => Object.entries(m.map[path]).map(([a, b]) => `${a} is now ${b}`).join(', ');
  return [
    ...Object.entries(m.rename).map(([a, b]) => `${a} is now ${b}`),
    ...m.drop.map((d) => `${d.name} is gone (${d.why})`),
    ...Object.entries(m.fields).flatMap(([inp, f]) => [...Object.entries(f.rename).map(([a, b]) => `${inp}.${a} is now ${m.rename[inp] ?? inp}.${b}`), ...f.drop.map((d) => `${inp}.${d.name} is gone (${d.why})`)]),
    ...Object.keys(m.map).map((p) => `${p}: ${vals(p)}`),
  ].join('; ');
}

/** A move's widget names without their pack: walk@1, walk@2. */
export const moveNames = (m: PackMove): { from: string; to: string } => ({ from: m.from.split(':')[1], to: m.to.split(':')[1] });

/** How a value is held where props are moved: IR values in a use, plain JSON in a fixture case. */
export interface ValueForm<T> {
  /** a kept value, from the IR */
  of(v: IRVal): T;
  /** the value mapped by a map line's table (a literal choice or text; anything else stays) */
  mapped(v: T, table: Record<string, string>): T;
  /** a record list given in the props (a fixture's list of objects), each item moved by `f` */
  items?(v: T, f: (item: Record<string, T>) => Record<string, T>): T;
}

/** One item of a record list moved: its fields renamed, dropped and mapped (by the old input's name). */
export function moveItem<T>(item: Record<string, T>, move: PackMove, input: string, form: Pick<ValueForm<T>, 'mapped'>): Record<string, T> {
  const fm = move.fields[input];
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(item)) {
    if (fm?.drop.some((d) => d.name === k)) continue;
    const table = move.map[`${input}.${k}`];
    out[fm?.rename[k] ?? k] = table ? form.mapped(v, table) : v;
  }
  return out;
}

/** A use's props moved: renamed, dropped, mapped, and (when kept) set to the old look. */
export function moveProps<T>(props: Record<string, T>, move: PackMove, keep: boolean, form: ValueForm<T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v0] of Object.entries(props)) {
    if (move.drop.some((d) => d.name === k)) continue;
    let v = move.map[k] ? form.mapped(v0, move.map[k]) : v0;
    if (form.items && (move.fields[k] || Object.keys(move.map).some((p) => p.startsWith(k + '.')))) v = form.items(v, (it) => moveItem(it, move, k, form));
    out[move.rename[k] ?? k] = v;
  }
  if (keep) for (const k of move.keep) if (!(k.name in out)) out[k.name] = form.of(k.value);
  return out;
}

/** Values as a fixture (YAML) writes them: plain strings, numbers and lists of objects. */
const JSON_FORM: ValueForm<unknown> = {
  of: jsonOf,
  mapped: (v, t) => (typeof v === 'string' && v in t ? t[v] : v),
  items: (v, f) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? f(x as Record<string, unknown>) : x)) : v),
};

/** Values as the IR holds them: a literal choice ({lit}) or a text ({text}) is mapped; an expression stays. */
const IR_FORM: ValueForm<IRVal> = {
  of: (v) => v,
  mapped: (v, t) => {
    const o = v as Obj;
    if (typeof o.lit === 'string' && o.lit in t) return { ...o, lit: t[o.lit] } as IRVal;
    if (typeof o.text === 'string' && o.text in t) return { ...o, text: t[o.text] } as IRVal;
    return v;
  },
};

/** Proves each move on the old version's fixtures: every valid case, moved (both ways: kept and not), must compile against the new version. */
export function checkMoves(c: Compiled, moves: PackMove[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const cases = fixtureCases(c, new Diagnostics());
  for (const m of moves) {
    const [, fromW] = m.from.split(':');
    const [toPack, toW] = m.to.split(':');
    // a case meant to fail (expect.errors) proves the old version refuses something: it has nothing to move
    for (const fc of cases.filter((x) => x.pack === m.pack && x.widget === fromW && !x.expect?.errors?.length)) {
      for (const keep of m.keep.length ? [false, true] : [false]) {
        const moved = { ...fc, pack: toPack, widget: toW, props: moveProps(fc.props, m, keep, JSON_FORM) as typeof fc.props, expect: undefined };
        const d = new Diagnostics();
        c.document(caseDocument(moved, c), `${fc.pack}/${fc.file}#${fc.name}`, d, { allowParts: true, privateOf: fc.pack });
        for (const e of d.errors) out.push({ severity: 'error', code: 'mkp.migrate-pack-case', message: `${fc.widget}'s case "${fc.name}", moved by migrate ${fromW} -> ${toW}${keep ? ' keeping the old look' : ''}, doesn't compile against ${toW}: ${e.message}`, pos: m.pos });
      }
    }
  }
  return out;
}

/** Where a move applies: the uses of its old version, with the file each is in. */
export function usesOf(roots: unknown[], move: PackMove): { node: Obj; file?: string }[] {
  const out: { node: Obj; file?: string }[] = [];
  walk(roots, (o, file) => {
    if (o.def === move.from && typeof o.node === 'string') out.push({ node: o, file });
  });
  return out;
}

/** Moves the uses under `roots` (props and their record lists' items renamed, dropped, mapped, kept), and points them at the new version. */
export function applyMove(roots: unknown[], move: PackMove, keep: boolean, to: IRDef): { node: IRNode; file?: string }[] {
  const hits = usesOf(roots, move);
  for (const h of hits) {
    const n = h.node as unknown as IRNode;
    n.def = move.to;
    n.node = to.name;
    if (n.props) n.props = moveProps(n.props, move, keep, IR_FORM);
    if (n.records) {
      n.records = n.records.filter((r) => !move.drop.some((d) => d.name === r.input));
      for (const r of n.records) {
        const old = r.input as string;
        if (r.props) r.props = moveItem(r.props, move, old, IR_FORM);
        r.input = move.rename[old] ?? old;
        const rec = move.records[r.input];
        if (!rec) continue;
        r.record = rec.kind;
        for (const [f, v] of Object.entries(rec.fill)) if (!r.props || !(f in r.props)) (r.props ??= {})[f] = v;
      }
    }
  }
  // the bundles that hold these uses get the new version's definition, so they print and run by it
  walk(roots, (o) => {
    const defs = o.defs as Record<string, IRDef> | undefined;
    if (o.doc && defs && typeof defs === 'object' && hits.length && !defs[move.to]) defs[move.to] = to;
  });
  return hits as unknown as { node: IRNode; file?: string }[];
}
