// 0.2.1 -> 0.2.2: `theme` became a name every definition reads (the reader's theme), so a definition
// that declared its own is renamed; and four things draw differently with the same IR.

import type { Change, Place, Step, StepContext } from '../index';
import { definitionsIn, renameInExpr, renameInText, usesName, walk, type Obj } from '../walk';

const lit = (v: unknown): unknown => (v && typeof v === 'object' && 'lit' in (v as Obj) ? (v as Obj).lit : undefined);
const isTrue = (v: unknown): boolean => lit(v) === true;

/** Places of the IR nodes `pick` chooses, under every root, with the file each was written in. */
function places(roots: unknown[], pick: (o: Obj, parent: Obj | undefined) => boolean): Place[] {
  const out: Place[] = [];
  const seen = new Set<string>();
  walk(roots, (o, file, parent) => {
    if (typeof o.node !== 'string' || !pick(o, parent)) return;
    const pos = o.pos as [number, number] | undefined;
    const k = `${file}:${pos?.join(':')}:${o.node}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ file, pos });
  });
  return out;
}

/** The children of a node that sit in its container: in its children, or a stack's layers. */
const kidsOf = (o: Obj | undefined): Obj[] => ((o?.children as Obj[] | undefined) ?? []).filter((k) => typeof k.node === 'string');

const zoomMinscale: Change = {
  id: 'zoom-minscale',
  what: 'a zoom shrinks what is too wide no smaller than 0.6 of its size, then shows its middle to pan',
  keep: { how: 'zoom minscale=0' },
  find: (roots) => places(roots, (o) => o.node === 'zoom' && !(o.props as Obj | undefined)?.minscale && lit((o.props as Obj | undefined)?.fit) !== false),
  pin: (roots) =>
    walk(roots, (o) => {
      if (o.node !== 'zoom') return;
      const p = ((o.props as Obj | undefined) ?? (o.props = {})) as Obj;
      if (!p.minscale) p.minscale = { lit: 0 };
    }),
};

const arrowEnds: Change = {
  id: 'arrow-ends',
  what: 'arrows touch the outlines they join, and a routed line keeps a straight run before its head',
  keep: { cannot: 'there is no setting for the old 3 px gap' },
  find: (roots) => places(roots, (o) => o.node === 'arrow'),
};

const selfBoth: Change = {
  id: 'self-both-axes',
  what: 'self= places a child of a grid or a stack on both axes (self=start is its top-left corner), not only across',
  keep: { cannot: 'placing on one axis only can’t be written; remove self= and set the container’s align= instead' },
  find: (roots) => places(roots, (o, parent) => !!(o.meta as Obj | undefined)?.self && (parent?.node === 'grid' || parent?.node === 'stack') && kidsOf(parent).includes(o)),
};

const stackOrder: Change = {
  id: 'stack-order',
  what: 'a dimmed or blurred layer of a stack no longer paints over the layers after it',
  keep: { cannot: 'the old order was a fault' },
  find: (roots) =>
    places(roots, (o, parent) => {
      if (parent?.node !== 'stack') return false;
      const kids = kidsOf(parent);
      const i = kids.indexOf(o);
      const p = o.props as Obj | undefined;
      return i >= 0 && i < kids.length - 1 && (isTrue(p?.dim) || isTrue(p?.blur));
    }),
};

/** The kinds of name 0.2.2 refuses to call `theme`: inputs, vars, values, fns, controls and each's variable. */
function declares(def: Obj, name: string): Place | null {
  const file = def.file as string | undefined;
  for (const i of (def.inputs as Obj[]) ?? []) if (i.name === name) return { file, pos: i.pos as [number, number] };
  for (const v of (def.values as Obj[]) ?? []) if (v.name === name && v.k !== 'host') return { file, pos: v.pos as [number, number] };
  let hit: Place | null = null;
  walk(def.view, (o) => {
    if (!hit && o.node === 'each' && o.var === name) hit = { file, pos: o.pos as [number, number] };
  });
  return hit;
}

/** Renames `from` to `to` inside one definition: its declarations, references and expressions' source. */
function renameInside(def: Obj, from: string, to: string): void {
  const swap = (x: unknown): unknown => (x === from ? to : x);
  for (const i of (def.inputs as Obj[]) ?? []) i.name = swap(i.name);
  if (Array.isArray(def.fields)) def.fields = def.fields.map(swap);
  walk(def, (o, _file, _parent, key) => {
    if (o.t === 'var' && o.name === from) o.name = to;
    if (o.t === 'lam' && Array.isArray(o.params)) o.params = o.params.map(swap);
    if (typeof o.k === 'string' && o.k !== 'host' && o.name === from && key === 'values') o.name = to;
    if (o.k === 'fn' && Array.isArray(o.params)) for (const p of o.params as Obj[]) p.name = swap(p.name);
    if (o.node === 'each' && o.var === from) o.var = to;
    if (o.ref === from) o.ref = to;
    if ((o.a === 'set' || o.a === 'play' || o.a === 'pause') && o.name === from) o.name = to;
    if ((o.a === 'reset' || o.node === 'controls') && Array.isArray(o.names)) o.names = o.names.map(swap);
    for (const k of ['expr', 'body', 'src'] as const) if (typeof o[k] === 'string') o[k] = renameInExpr(o[k] as string, from, to);
    if (typeof o.text === 'string') o.text = renameInText(o.text, from, to);
    if (o.t === 'tmpl' && typeof o.v === 'string') o.v = renameInText(o.v, from, to);
    if (o.t === 'tmpl' && Array.isArray(o.show)) o.show = o.show.map((s) => (typeof s === 'string' ? renameInExpr(s, from, to) : s));
  });
  // its local fns (a definition's own table): parameters and source
  for (const f of Object.values((def.fns as Record<string, Obj> | undefined) ?? {})) {
    if (Array.isArray(f.params)) f.params = f.params.map(swap);
    if (typeof f.src === 'string') f.src = renameInExpr(f.src, from, to);
  }
}

/** Renames an input `from` to `to` wherever the definition `id` is used: its props, fills and records. */
function renameUses(roots: unknown[], id: string, from: string, to: string): void {
  walk(roots, (o) => {
    if (o.def !== id) return;
    for (const k of ['props', 'fills'] as const) {
      const m = o[k] as Obj | undefined;
      if (m && from in m) {
        m[to] = m[from];
        delete m[from];
      }
    }
    for (const r of (o.records as Obj[] | undefined) ?? []) if (r.input === from) r.input = to;
  });
}

function renameTheme(roots: unknown[], ctx: StepContext): void {
  const byId = new Map<string, Obj[]>();
  for (const d of definitionsIn(roots)) byId.set(d.id as string, [...(byId.get(d.id as string) ?? []), d]);
  for (const [id, copies] of byId) {
    const at = declares(copies[0], 'theme');
    if (!at) continue;
    // a new name nothing in it uses yet: look, look2, …
    let to = 'look';
    for (let n = 2; copies.some((d) => usesName(d, to)); n++) to = `look${n}`;
    for (const d of copies) renameInside(d, 'theme', to);
    renameUses(roots, id, 'theme', to);
    ctx.renamed(id, 'theme', to);
    const name = copies[0].name as string;
    const elsewhere = copies[0].pack !== '$doc' ? ` Documents elsewhere that set theme: on ${name} must be migrated too, with this pack.` : '';
    ctx.warn('mkp.migrate-renamed', `theme is now the reader's theme, which every definition reads (0.2.2), so ${name}'s own theme is renamed ${to}, with every use of it.${elsewhere}`, at);
  }
}

export const step_0_2_2: Step = {
  from: '0.2.1',
  to: '0.2.2',
  summary: 'theme became the reader’s theme; arrows touch what they join; self= places both ways in a grid or stack; a zoom stops shrinking at 0.6.',
  renames: [{ name: 'theme', why: 'the reader’s theme, which every definition reads, as width' }],
  removes: [],
  changes: [zoomMinscale, arrowEnds, selfBoth, stackOrder],
  ir: renameTheme,
};
