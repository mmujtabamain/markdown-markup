// The build (spec 12): read packs and documents, check every definition, resolve names, check
// documents, write the lock and assemble bundles.

import { CORE_MKP } from './base';
import { checkDocument, DOC_PACK, type DocFile } from './check/doc';
import { DefChecker, signatureOf, type Sig } from './check/def';
import { Program, type PackInfo } from './check/program';
import { Diagnostics, MkpError } from './diag';
import type { A, IRBundle, IRDef, IRDoc, IRExpr, IRFn, IRLock, IRNode, IRTokenSet, IRVal } from './ir';
import { IR_VERSION } from './ir';
import { corePack, loadPack, readZip, type PackFiles } from './pack';
import { checkRequired, tokenNames, tokenSetIR } from './tokens';
import { checkProfile } from './profile';
import { fileItems, printFile } from './print';
import type { Type } from './types';
import { canonicalJson } from './util/jcs';
import { sha256 } from './util/sha256';

/** IR node names the compiler and runtime give their own meaning (statements, document state). */
const BUILTIN_NODES = new Set(['each', 'switch', 'case', 'else', 'slot', 'fill', 'controls', 'arrow']);

export interface PackSource {
  /** a folder's files, or the bytes of a .mkpack */
  files?: Map<string, Uint8Array>;
  zip?: Uint8Array;
  label: string;
}

export interface CompileOptions {
  packs: PackSource[];
  lock?: IRLock;
  profile?: string;
  /** capabilities the target provider declares (default: core@1 and gfx@1) */
  capabilities?: string[];
}

export class Compiled {
  readonly defs = new Map<string, IRDef>();
  readonly sigs = new Map<string, Sig>();
  tokens: IRTokenSet[] = [];
  lock: IRLock = { packs: [], defs: {} };
  constructor(
    readonly prog: Program,
    readonly diags: Diagnostics,
    readonly opts: CompileOptions,
  ) {}

  /** The locked id for a bare name, from the lock this build was given (6.17). */
  lockedFn(): (name: string) => string | undefined {
    const ids = Object.keys(this.opts.lock?.defs ?? {});
    return (name) => {
      const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
      const hits = ids.filter((id) => id.slice(id.indexOf(':') + 1).replace(/@\d+$/, '') === bare && (!name.includes(':') || id.startsWith(name.slice(0, name.indexOf(':') + 1))));
      return hits.length === 1 ? hits[0] : undefined;
    };
  }

  tokenNameFn(): (kind: string) => Set<string> {
    const names = tokenNames(this.tokens);
    return (kind) => names.get(kind) ?? new Set();
  }

  /**
   * Checks a document and assembles its bundle (null when it has errors). Its own definitions
   * (mkp fences, and `docFile`, the name.mkp beside it) are checked with it and go in its bundle.
   */
  document(text: string, file: string, diags = this.diags, opts: { allowParts?: boolean; docFile?: DocFile; privateOf?: string } = {}): IRBundle | null {
    const before = diags.errors.length;
    const prof = this.opts.profile ? this.prog.packs.get(this.opts.profile) : undefined;
    const blockAttrs = new Set(prof?.kind === 'profile' ? prof.manifest.attrs.map((a) => a.name) : []);
    const cd = checkDocument(this.prog, text, file, diags, { tokenNames: this.tokenNameFn(), sigs: this.sigs, allowParts: opts.allowParts, locked: this.lockedFn(), blockAttrs, docFile: opts.docFile, privateOf: opts.privateOf });
    if (this.opts.profile) checkProfile(this, cd.front, cd.body, file, diags, cd.frontAt);
    if (diags.errors.length > before) return null;
    const doc: IRDoc = { file, front: cd.front, body: cd.body };
    doc.digest = digest({ front: doc.front, body: stripPos(doc.body) });
    const own = new Map(cd.defs.map((d) => [d.id, d]));
    markDefFallbacks(own);
    for (const d of own.values()) d.digest = digest(stripPos({ ...d, fns: d.fns }));
    return this.bundle(doc, cd.def, { prog: cd.prog, defs: own });
  }

  /**
   * A document's own definitions (its mkp fences and its file) in the formatter's form, for
   * printing it back (mkp fmt), or null when it has none or doesn't compile.
   */
  documentDefs(text: string, file: string, opts: { docFile?: DocFile } = {}): string | null {
    const d = new Diagnostics();
    const cd = checkDocument(this.prog, text, file, d, { tokenNames: this.tokenNameFn(), sigs: this.sigs, locked: this.lockedFn(), docFile: opts.docFile });
    const own = cd.prog.packs.get(DOC_PACK);
    if (!d.ok || !own || own === this.prog.packs.get(DOC_PACK) || !own.files.length) return null;
    const defs = new Map([...this.defs, ...cd.defs.map((x) => [x.id, x] as const)]);
    const ctx = { defs: Object.fromEntries(defs), env: cd.prog.typeEnv(DOC_PACK) };
    return own.files.map((f) => printFile(fileItems(f, defs, DOC_PACK, () => undefined), ctx)).join('\n');
  }

  /** A self-contained bundle: the document, the definitions it uses, fns, tokens and the lock. */
  bundle(doc: IRDoc, docDef: IRDef, own?: { prog: Program; defs: Map<string, IRDef> }): IRBundle {
    const prog = own?.prog ?? this.prog;
    const lookup = (id: string): IRDef | undefined => own?.defs.get(id) ?? this.defs.get(id);
    const defs: Record<string, IRDef> = {};
    const fns: Record<string, IRFn> = {};
    const consts: Record<string, IRExpr> = {};
    const want: string[] = [];
    const seenFn = new Set<string>();
    const visitAst = (a: A | undefined): void => {
      if (!a || typeof a !== 'object') return;
      if ((a.t === 'call' || a.t === 'fnref') && !seenFn.has(a.fn)) {
        seenFn.add(a.fn);
        const f = prog.irFns[a.fn];
        if (f) {
          fns[a.fn] = f;
          visitAst(f.body);
        }
      }
      if (a.t === 'var' && a.from === 'const' && !consts[a.name]) {
        const c = prog.irConsts[a.name];
        if (c) {
          consts[a.name] = c;
          visitAst(c.ast);
        }
      }
      if (a.t === 'tmpl') for (const s of a.show) if (s && !seenFn.has(s)) visitAst({ t: 'fnref', fn: s });
      for (const v of Object.values(a)) {
        if (Array.isArray(v)) v.forEach((x) => x && typeof x === 'object' && visitAst(x as A));
        else if (v && typeof v === 'object' && 't' in v) visitAst(v as A);
      }
    };
    const visitVal = (v: unknown): void => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(visitVal);
      const o = v as Record<string, unknown>;
      if ('ast' in o && o.ast && typeof o.ast === 'object') visitAst(o.ast as A);
      if (typeof o.def === 'string' && !defs[o.def] && lookup(o.def)) want.push(o.def);
      for (const x of Object.values(o)) if (x && typeof x === 'object') visitVal(x);
    };
    visitVal(doc.body);
    visitVal(docDef);
    while (want.length) {
      const id = want.pop()!;
      if (defs[id]) continue;
      const d = lookup(id)!;
      defs[id] = d;
      visitVal(d);
      for (const f of Object.values(d.fns ?? {})) visitAst(f.body);
    }
    defs[docDef.id] = docDef;
    markFallbacks(doc.body, defs);
    for (const f of Object.values(docDef.fns ?? {})) visitAst(f.body);
    const types: Record<string, Type> = {};
    for (const [k, t] of prog.types) types[k] = t.type;
    const caps = new Set<string>(['core@1']);
    const iface: IRBundle['interface'] = { signals: [], hosts: [], commands: [], implements: [] };
    for (const d of Object.values(defs)) {
      for (const r of d.requires ?? []) caps.add(r);
      for (const s of d.signals ?? []) iface.signals.push({ def: d.id, name: s.name, payload: s.payload });
      for (const v of d.values ?? []) if (v.k === 'host') iface.hosts.push({ def: d.id, name: v.name, type: v.type, default: v.default });
      for (const c of d.commands ?? []) iface.commands.push({ def: d.id, name: c.name, payload: c.payload });
      for (const i of d.implements ?? []) iface.implements.push({ def: d.id, iface: i });
    }
    markInterfaces(doc.body, defs);
    const macros: Record<string, string> = {};
    for (const [k, m] of prog.macros) macros[k] = m.tex;
    const lockDefs: Record<string, string> = {};
    for (const id of Object.keys(defs)) if (this.lock.defs[id]) lockDefs[id] = this.lock.defs[id];
    const packsUsed = new Set(Object.values(defs).map((d) => d.pack));
    return {
      ir: IR_VERSION,
      level: 'bundle',
      doc,
      defs,
      fns,
      consts,
      types,
      tokens: this.tokens,
      macros,
      capabilities: [...caps].sort(),
      interface: iface,
      lock: { packs: this.lock.packs.filter((p) => packsUsed.has(p.pack) || p.pack === 'core'), defs: lockDefs },
      profile: this.opts.profile,
    };
  }
}

export function digest(v: unknown): string {
  return 'sha256:' + sha256(canonicalJson(v));
}

/** IR without source positions (the source map), keeping everything else. */
export function omitPos<T>(v: T): T {
  if (Array.isArray(v)) return v.map(omitPos) as unknown as T;
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== 'pos') out[k] = omitPos(x);
  return out as T;
}

/** IR without source positions and comments (what "IR-identical" compares, and digests hash). */
export function stripPos<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripPos) as unknown as T;
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'pos' || k === 'file' || k === 'digest') continue;
    out[k] = stripPos(x);
  }
  return out as T;
}

/** Loads and checks every pack. Documents are checked afterwards with compiled.document(). */
export function compile(opts: CompileOptions): Compiled {
  const diags = new Diagnostics();
  const prog = new Program(diags);
  const core = corePack(CORE_MKP, diags);
  prog.addPack(core);
  const loaded: PackInfo[] = [];
  for (const src of opts.packs) {
    try {
      const pf: PackFiles | null = src.zip ? readZip(src.zip, src.label, diags) : { label: src.label, origin: 'folder', files: src.files ?? new Map() };
      if (!pf) continue;
      const p = loadPack(pf, diags);
      if (!p) continue;
      if (p.name === 'core') {
        diags.error('mkp.pack-reserved', 'the pack name "core" is reserved for the base set', { file: src.label, line: 1, col: 1 });
        continue;
      }
      loaded.push(p);
      prog.addPack(p);
    } catch (e) {
      if (e instanceof MkpError) diags.add(e.diagnostic);
      else throw e;
    }
  }
  const c = new Compiled(prog, diags, opts);
  const caps = new Set(opts.capabilities ?? ['core@1', 'gfx@1']);
  // dependencies, capabilities and provides
  for (const p of prog.packs.values()) {
    const where = { file: `${p.name}/manifest.mkp`, line: p.manifest.p.line, col: 1 };
    for (const d of p.depends) {
      const m = /^(.+)@(\d+)$/.exec(d);
      const dep = m && prog.packs.get(m[1]);
      if (!m || !dep) diags.error('mkp.pack-depends', `${p.name} depends on ${d}, which this build was not given (pass it with --pack)`, where);
      else if (dep.version < Number(m[2])) diags.error('mkp.pack-depends', `${p.name} depends on ${d}; this build has ${dep.name}@${dep.version}`, where);
    }
    for (const r of p.requires) if (!/^(core|gfx)@1$/.test(r)) diags.error('mkp.capability', `${p.name} requires ${r}, which is not a known capability (core@1, gfx@1)`, where);
    for (const name of p.provides) {
      const has = [...prog.defs.values()].some((d) => d.pack === p.name && d.syn.name === name) || [...prog.ifaces.values()].some((x) => x.pack === p.name && x.syn.name === name) || prog.types.has(`${p.name}:${name}`) || prog.fns.get(name)?.some((f) => f.pack === p.name) || prog.consts.get(name)?.some((x) => x.pack === p.name) || prog.tokenSets.some((t) => t.pack === p.name && t.syn.name === name);
      if (!has) diags.error('mkp.pack-provides', `${p.name} provides "${name}", but no definition, type, fn or constant has that name`, where);
    }
  }
  // the same provided definition name in two packs
  const providers = new Map<string, string[]>();
  for (const p of prog.packs.values()) {
    if (p.builtin) continue;
    for (const n of p.provides) {
      if (!prog.defs.has(`${p.name}:${n}@1`) && ![...prog.defs.values()].some((d) => d.pack === p.name && d.syn.name === n)) continue;
      providers.set(n, [...(providers.get(n) ?? []), p.name]);
    }
  }
  for (const [n, ps] of providers) {
    if (ps.length > 1) diags.warn('mkp.name-clash', `${n} is provided by ${ps.join(' and ')}; uses must be qualified as pack:${n}`);
    if (prog.lookupDefs(n, '$none').some((d) => d.pack === 'core')) diags.error('mkp.reserved', `${n} is a base widget name and is reserved`);
    // a use is an IR node named after the definition, so a built-in's name would be read as the built-in
    if (BUILTIN_NODES.has(n)) diags.error('mkp.reserved', `${n} is a built-in node name (${[...BUILTIN_NODES].join(', ')}) and is reserved`);
  }
  // tokens
  c.tokens = prog.tokenSets.map((t) => tokenSetIR(t.syn, t.pack, diags));
  checkRequired(c.tokens, diags);
  prog.tokenNames = c.tokenNameFn();
  // definitions
  const checkers: DefChecker[] = [];
  for (const d of prog.defs.values()) c.sigs.set(d.id, signatureOf(prog, d));
  for (const d of prog.defs.values()) {
    const dc = new DefChecker(prog, d, diags, { tokenNames: c.tokenNameFn(), sigs: c.sigs, locked: c.lockedFn() });
    try {
      const ir = dc.check();
      c.defs.set(d.id, ir);
      checkers.push(dc);
      for (const r of ir.requires ?? []) if (!caps.has(r)) diags.warn('mkp.capability-fallback', `${d.syn.name} requires ${r}; providers without it show its fallback`, d.syn.p);
    } catch (e) {
      dc.err(e);
    }
  }
  for (const dc of checkers) dc.runDeferred();
  // nesting depth of definitions (non-recursive chains) and digests
  depthCheck(c, checkers, diags);
  markDefFallbacks(c.defs);
  for (const ir of c.defs.values()) ir.digest = digest(stripPos({ ...ir, fns: ir.fns }));
  // the lock: pack digests and the version each name resolved to
  c.lock = makeLock(c, opts.lock, diags);
  return c;
}

/**
 * Puts on each document block the interfaces its definition implements (meta.implements), and
 * those of the definitions used inside it at any depth (meta.within), so a host finds a question
 * inside a walk without knowing either's name (6.24).
 */
function markInterfaces(body: IRNode[], defs: Record<string, IRDef>): void {
  const deep = new Map<string, Set<string>>();
  const inside = (id: string, stack: Set<string>): Set<string> => {
    const hit = deep.get(id);
    if (hit) return hit;
    const out = new Set<string>();
    if (stack.has(id)) return out;
    stack.add(id);
    const visit = (ns: IRNode[] | undefined): void => {
      for (const n of ns ?? []) {
        if (n.def && defs[n.def] && n.def !== id) {
          for (const i of defs[n.def].implements ?? []) out.add(i);
          for (const i of inside(n.def, stack)) out.add(i);
        }
        visit(n.children);
        visit(n.records);
        for (const c of n.cases ?? []) visit(c.children);
        visit(n.else);
        for (const f of Object.values(n.fills ?? {})) visit(f);
      }
    };
    visit(defs[id]?.view);
    stack.delete(id);
    deep.set(id, out);
    return out;
  };
  const visit = (ns: IRNode[] | undefined): void => {
    for (const n of ns ?? []) {
      const d = n.def ? defs[n.def] : undefined;
      if (d && d.kind !== 'extern') {
        if (d.implements?.length) (n.meta ??= {}).implements = [...d.implements];
        const within = [...inside(d.id, new Set())];
        if (within.length) (n.meta ??= {}).within = within.sort();
      }
      visit(n.children);
      for (const f of Object.values(n.fills ?? {})) visit(f);
    }
  };
  visit(body);
}

/** Marks uses of gfx definitions, and gfx canvases, with their fallback (8.1). */
function markFallbacks(body: IRNode[], defs: Record<string, IRDef>): void {
  const gfx = (n: IRNode): boolean => {
    if (n.node === 'canvas' && n.props?.dims && 'lit' in n.props.dims && n.props.dims.lit === 3) return true;
    const walk = (rs: IRNode[] | undefined): boolean => (rs ?? []).some((r) => r.record === 'pixels' || r.record === 'mesh' || walk(r.records) || walk(r.children));
    return walk(n.records);
  };
  const visit = (ns: IRNode[] | undefined, summary: string | undefined): void => {
    for (const n of ns ?? []) {
      const d = n.def ? defs[n.def] : undefined;
      const here = n.meta?.summary ?? summary ?? d?.about;
      if (d && (d.requires ?? []).includes('gfx@1')) n.fallback = { summary: here ?? d.about ?? d.name };
      else if (gfx(n)) n.fallback = { summary: here ?? 'figure' };
      visit(n.children, here);
      for (const f of Object.values(n.fills ?? {})) visit(f, here);
    }
  };
  visit(body, undefined);
}

/** Definition views are marked once, at compile time, before their digests. */
export function markDefFallbacks(defs: Map<string, IRDef>): void {
  const all = Object.fromEntries(defs);
  for (const d of defs.values()) if ((d.requires ?? []).includes('gfx@1') && d.view) markFallbacks(d.view, all);
}

function depthCheck(c: Compiled, checkers: DefChecker[], diags: Diagnostics): void {
  const uses = new Map(checkers.map((dc) => [dc.entry.id, [...dc.uses]]));
  const memo = new Map<string, number>();
  const depth = (id: string, stack: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (stack.has(id)) return 0; // recursion: capped at runtime (6.14)
    stack.add(id);
    let d = 1;
    for (const u of uses.get(id) ?? []) if (!u.startsWith('core:')) d = Math.max(d, 1 + depth(u, stack));
    stack.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const dc of checkers) {
    const d = depth(dc.entry.id, new Set());
    if (d > 12) diags.error('mkp.limit', `${dc.entry.syn.name} nests definitions ${d} deep; at most 12`, dc.entry.syn.p);
  }
  void c;
}

function makeLock(c: Compiled, prev: IRLock | undefined, diags: Diagnostics): IRLock {
  const packs = [...c.prog.packs.values()].map((p) => ({ pack: p.name, version: p.version, digest: p.digest })).sort((a, b) => (a.pack < b.pack ? -1 : 1));
  const defs: Record<string, string> = {};
  for (const [id, d] of c.defs) defs[id] = d.digest!;
  if (prev) {
    for (const p of prev.packs) {
      const now = packs.find((x) => x.pack === p.pack && x.version === p.version);
      if (now && now.digest !== p.digest && p.pack !== 'core') diags.warn('mkp.pack-changed', `${p.pack}@${p.version} changed since the lock was written; a published version must not change`);
    }
    for (const [id, dg] of Object.entries(prev.defs)) {
      // an unpublished pack may still change under the same @N (GAPS 15)
      if (c.prog.packs.get(id.slice(0, id.indexOf(':')))?.manifest.unpublished) continue;
      // the base set is versioned with MKP itself, not by the lock
      if (id.startsWith('core:')) continue;
      if (defs[id] && defs[id] !== dg && !id.startsWith(`${DOC_PACK}:`)) diags.error('mkp.version-changed', `${id} changed since it was locked; a behaviour change is a new version (@N+1), or build with --relock while the pack is unpublished`);
    }
  }
  return { packs, defs };
}

/** Values in a bundle that read only constants become literals (used by the expander). */
export function isLit(v: IRVal | undefined): v is { lit: unknown } {
  return !!v && typeof v === 'object' && 'lit' in v;
}

export type { IRNode };
