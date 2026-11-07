// A pack's own versions (migrate walk@1 -> walk@2): how a use of one version moves to the next, as
// the pack declares it in MKP (no code from a pack ever runs). The compiler checks the declaration
// against both definitions (every input of the old one is renamed, dropped, or kept by name; every
// input the new one needs is given), proves it on the old version's fixtures (each case, moved, must
// compile against the new one), and `mkp migrate` moves the uses in documents and definitions.

import type { Compiled } from '../build';
import { caseDocument, fixtureCases } from '../fixtures';
import { Diagnostics, type Diagnostic, type Pos } from '../diag';
import type { IRDef, IRNode, IRVal } from '../ir';
import type { MigrateSyn } from '../syntax/mkp';
import { DefChecker } from '../check/def';
import { resolve } from '../types';
import { walk, type Obj } from './walk';

/** A checked migrate block: ids, and what happens to each input. */
export interface PackMove {
  pack: string;
  from: string;
  to: string;
  rename: Record<string, string>;
  drop: { name: string; why: string }[];
  keep: { name: string; value: IRVal; why: string }[];
  pos: Pos;
}

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
        const toId = `${p.name}:${m.to}`;
        const a = c.defs.get(fromId);
        const b = c.defs.get(toId);
        const versions = (name: string) => [...c.defs.values()].filter((d) => d.pack === p.name && d.name === name).map((d) => `${d.name}@${d.version}`);
        if (!a || !b) {
          const miss = !a ? m.from : m.to;
          diags.error('mkp.migrate-pack', `migrate names ${miss}, which pack ${p.name} doesn't define; found ${miss} here, and the versions it has are ${versions(miss.split('@')[0]).join(', ') || 'none'}. A migrate block moves uses between two versions the pack keeps side by side`, at());
          continue;
        }
        if (a.name !== b.name || b.version <= a.version) {
          diags.error('mkp.migrate-pack', `migrate moves uses of one widget to a later version of it; found ${m.from} -> ${m.to}. Write e.g. migrate ${a.name}@${a.version} -> ${a.name}@${a.version + 1}`, at());
          continue;
        }
        const ain = new Map(a.inputs.map((x) => [x.name, x]));
        const bin = new Map(b.inputs.map((x) => [x.name, x]));
        const move: PackMove = { pack: p.name, from: fromId, to: toId, rename: {}, drop: [], keep: [], pos: m.p };
        const said = new Set<string>();
        for (const l of m.lines) {
          if (l.k === 'rename') {
            if (!ain.has(l.from)) diags.error('mkp.migrate-pack', `${m.from} has no input ${l.from}, so it can't be renamed; its inputs are ${[...ain.keys()].join(', ')}`, at(l.p));
            else if (!bin.has(l.to)) diags.error('mkp.migrate-pack', `${m.to} has no input ${l.to} for ${l.from} to become; its inputs are ${[...bin.keys()].join(', ')}`, at(l.p));
            else move.rename[l.from] = l.to;
            said.add(l.from);
          } else if (l.k === 'drop') {
            if (!ain.has(l.name)) diags.error('mkp.migrate-pack', `${m.from} has no input ${l.name} to drop; its inputs are ${[...ain.keys()].join(', ')}`, at(l.p));
            else move.drop.push({ name: l.name, why: l.why });
            said.add(l.name);
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
        for (const x of b.inputs) if (!x.default && !given.has(x.name) && resolve(x.type, c.prog.typeEnv(p.name)).t !== 'slot' && resolve(x.type, c.prog.typeEnv(p.name)).t !== 'records') diags.error('mkp.migrate-pack', `${m.to} needs ${x.name}, which a use of ${m.from} doesn't give and the migrate block doesn't set; found no input of ${m.from} that becomes it. Add \`rename … -> ${x.name}\`, or give ${x.name} a default in ${m.to}`, at());
        out.push(move);
      }
    }
  }
  return out;
}

/** An input's value as a fixture (YAML) writes it, for moving cases. */
function jsonOf(v: IRVal): unknown {
  const o = v as Obj;
  if ('lit' in o) return o.lit;
  if ('text' in o) return o.text;
  if ('tok' in o) return o.tok;
  return undefined;
}

/** A use's props moved: renamed, dropped, and (when kept) set to the old look. */
export function moveProps<T>(props: Record<string, T>, move: PackMove, keep: boolean, val: (v: IRVal) => T): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(props)) {
    if (move.drop.some((d) => d.name === k)) continue;
    out[move.rename[k] ?? k] = v;
  }
  if (keep) for (const k of move.keep) if (!(k.name in out)) out[k.name] = val(k.value);
  return out;
}

/** Proves each move on the old version's fixtures: every case, moved (both ways: kept and not), must compile against the new version. */
export function checkMoves(c: Compiled, moves: PackMove[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const cases = fixtureCases(c, new Diagnostics());
  for (const m of moves) {
    const [, fromW] = m.from.split(':');
    const [, toW] = m.to.split(':');
    for (const fc of cases.filter((x) => x.pack === m.pack && x.widget === fromW)) {
      for (const keep of m.keep.length ? [false, true] : [false]) {
        const moved = { ...fc, widget: toW, props: moveProps(fc.props, m, keep, jsonOf), expect: undefined };
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

/** Moves the uses under `roots` (props renamed, dropped, kept), and points them at the new version. */
export function applyMove(roots: unknown[], move: PackMove, keep: boolean, to: IRDef): { node: IRNode; file?: string }[] {
  const hits = usesOf(roots, move);
  for (const h of hits) {
    const n = h.node as unknown as IRNode;
    n.def = move.to;
    n.node = to.name;
    if (n.props) n.props = moveProps(n.props, move, keep, (v) => v);
  }
  // the bundles that hold these uses get the new version's definition, so they print and run by it
  walk(roots, (o) => {
    const defs = o.defs as Record<string, IRDef> | undefined;
    if (o.doc && defs && typeof defs === 'object' && hits.length && !defs[move.to]) defs[move.to] = to;
  });
  return hits as unknown as { node: IRNode; file?: string }[];
}
