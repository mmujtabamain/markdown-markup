// The build (spec 12): read packs and documents, check every definition, resolve names, check
// documents, write the lock and assemble bundles.

import { CORE_MKP } from './base';
import { checkDocument, DOC_PACK } from './check/doc';
import { DefChecker, signatureOf, type Sig } from './check/def';
import { Program, type PackInfo } from './check/program';
import { Diagnostics, MkpError } from './diag';
import type { A, IRBundle, IRDef, IRDoc, IRExpr, IRFn, IRLock, IRNode, IRTokenSet, IRVal } from './ir';
import { IR_VERSION } from './ir';
import { corePack, loadPack, readZip, type PackFiles } from './pack';
import { checkRequired, tokenNames, tokenSetIR } from './tokens';
import { checkProfile } from './profile';
import type { Type } from './types';
import { canonicalJson } from './util/jcs';
import { sha256 } from './util/sha256';

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

  tokenNameFn(): (kind: string) => Set<string> {
    const names = tokenNames(this.tokens);
    return (kind) => names.get(kind) ?? new Set();
  }

  /** Checks a document and assembles its bundle (null when it has errors). */
  document(text: string, file: string, diags = this.diags, opts: { allowParts?: boolean } = {}): IRBundle | null {
    const before = diags.errors.length;
    const cd = checkDocument(this.prog, text, file, diags, { tokenNames: this.tokenNameFn(), sigs: this.sigs, allowParts: opts.allowParts });
    if (this.opts.profile) checkProfile(this, cd.front, cd.body, file, diags);
    if (diags.errors.length > before) return null;
    const doc: IRDoc = { file, front: cd.front, body: cd.body };
    doc.digest = digest({ front: doc.front, body: stripPos(doc.body) });
    return this.bundle(doc, cd.def);
  }

  /** A self-contained bundle: the document, the definitions it uses, fns, tokens and the lock. */
  bundle(doc: IRDoc, docDef: IRDef): IRBundle {
    const defs: Record<string, IRDef> = {};
    const fns: Record<string, IRFn> = {};
    const consts: Record<string, IRExpr> = {};
    const want: string[] = [];
    const seenFn = new Set<string>();
    const visitAst = (a: A | undefined): void => {
      if (!a || typeof a !== 'object') return;
      if ((a.t === 'call' || a.t === 'fnref') && !seenFn.has(a.fn)) {
        seenFn.add(a.fn);
        const f = this.prog.irFns[a.fn];
        if (f) {
          fns[a.fn] = f;
          visitAst(f.body);
        }
      }
      if (a.t === 'var' && a.from === 'const' && !consts[a.name]) {
        const c = this.prog.irConsts[a.name];
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
      if (typeof o.def === 'string' && !defs[o.def] && this.defs.has(o.def)) want.push(o.def);
      for (const x of Object.values(o)) if (x && typeof x === 'object') visitVal(x);
    };
    visitVal(doc.body);
    visitVal(docDef);
    while (want.length) {
      const id = want.pop()!;
      if (defs[id]) continue;
      const d = this.defs.get(id)!;
      defs[id] = d;
      visitVal(d);
      for (const f of Object.values(d.fns ?? {})) visitAst(f.body);
    }
    defs[docDef.id] = docDef;
    for (const f of Object.values(docDef.fns ?? {})) visitAst(f.body);
    const types: Record<string, Type> = {};
    for (const [k, t] of this.prog.types) types[k] = t.type;
    const caps = new Set<string>(['core@1']);
    const iface: IRBundle['interface'] = { signals: [], hosts: [], commands: [] };
    for (const d of Object.values(defs)) {
      for (const r of d.requires ?? []) caps.add(r);
      for (const s of d.signals ?? []) iface.signals.push({ def: d.id, name: s.name, payload: s.payload });
      for (const v of d.values ?? []) if (v.k === 'host') iface.hosts.push({ def: d.id, name: v.name, type: v.type, default: v.default });
      for (const c of d.commands ?? []) iface.commands.push({ def: d.id, name: c.name, payload: c.payload });
    }
    const macros: Record<string, string> = {};
    for (const [k, m] of this.prog.macros) macros[k] = m.tex;
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
      const has = [...prog.defs.values()].some((d) => d.pack === p.name && d.syn.name === name) || prog.types.has(`${p.name}:${name}`) || prog.fns.get(name)?.some((f) => f.pack === p.name) || prog.consts.get(name)?.some((x) => x.pack === p.name) || prog.tokenSets.some((t) => t.pack === p.name && t.syn.name === name);
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
  }
  // tokens
  c.tokens = prog.tokenSets.map((t) => tokenSetIR(t.syn, t.pack, diags));
  checkRequired(c.tokens, diags);
  // definitions
  const checkers: DefChecker[] = [];
  for (const d of prog.defs.values()) c.sigs.set(d.id, signatureOf(prog, d));
  for (const d of prog.defs.values()) {
    const dc = new DefChecker(prog, d, diags, { tokenNames: c.tokenNameFn(), sigs: c.sigs });
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
  for (const ir of c.defs.values()) ir.digest = digest(stripPos({ ...ir, fns: ir.fns }));
  // the lock: pack digests and the version each name resolved to
  c.lock = makeLock(c, opts.lock, diags);
  return c;
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
      if (defs[id] && defs[id] !== dg && !id.startsWith(`${DOC_PACK}:`)) diags.error('mkp.version-changed', `${id} changed since it was locked; a behaviour change is a new version (@N+1)`);
    }
  }
  return { packs, defs };
}

/** Values in a bundle that read only constants become literals (used by the expander). */
export function isLit(v: IRVal | undefined): v is { lit: unknown } {
  return !!v && typeof v === 'object' && 'lit' in v;
}

export type { IRNode };
