// The program: every pack given to a build, with its definitions, types, functions, operators,
// constants, macros and tokens, and the visibility rules of spec 6.4 and 10.

import { Diagnostics, Pos } from '../diag';
import type { IRFn, IRExpr, IRTokenSet } from '../ir';
import type { DefSyn, FnSyn, ManifestSyn, MkpFile, TokensSyn } from '../syntax/mkp';
import { Type, TypeEnv } from '../types';

export interface PackInfo {
  name: string;
  version: number;
  about?: string;
  kind: 'pack' | 'profile';
  requires: string[];
  depends: string[];
  provides: Set<string>;
  manifest: ManifestSyn;
  files: MkpFile[];
  fixtures: { path: string; json: unknown }[];
  assets: Map<string, Uint8Array>;
  documents: { path: string; text: string }[];
  digest: string;
  builtin?: boolean;
}

export interface DefEntry {
  id: string;
  pack: string;
  file: string;
  syn: DefSyn;
}

export interface FnEntry {
  id: string;
  pack: string;
  file: string;
  syn: FnSyn;
  op?: string;
  /** param types when every parameter is typed */
  sig?: Type[];
}

export interface ConstEntry {
  id: string;
  pack: string;
  file: string;
  name: string;
  type?: Type;
  syn: { e: import('../syntax/expr').Ex; src: string; p: Pos };
  checked?: IRExpr;
  checking?: boolean;
}

export class Program {
  readonly packs = new Map<string, PackInfo>();
  readonly defs = new Map<string, DefEntry>();
  readonly types = new Map<string, { pack: string; name: string; type: Type; p: Pos }>();
  readonly fns = new Map<string, FnEntry[]>();
  readonly ops = new Map<string, FnEntry[]>();
  readonly consts = new Map<string, ConstEntry[]>();
  readonly macros = new Map<string, { pack: string; tex: string }>();
  readonly tokenSets: { pack: string; syn: TokensSyn; ir?: IRTokenSet }[] = [];
  /** checked fn bodies, by id (pack fns, ops and specialisations) */
  readonly irFns: Record<string, IRFn> = {};
  readonly irConsts: Record<string, IRExpr> = {};
  /** fns (and specialisations) being checked: recursion returns their declared type */
  readonly fnsInProgress = new Map<string, import('../types').Type | undefined>();

  constructor(readonly diags: Diagnostics) {}

  addPack(p: PackInfo): void {
    if (this.packs.has(p.name)) {
      const other = this.packs.get(p.name)!;
      if (other.version === p.version) {
        this.diags.error('mkp.pack-duplicate', `pack ${p.name}@${p.version} is given twice`);
        return;
      }
      // keep the higher version; dependencies say which they need
      if (other.version > p.version) return;
    }
    this.packs.set(p.name, p);
    for (const f of p.files) {
      for (const it of f.items) {
        switch (it.item) {
          case 'def': {
            const id = `${p.name}:${it.name}@${it.version}`;
            if (this.defs.has(id)) this.diags.error('mkp.duplicate-definition', `${it.name}@${it.version} is defined twice in pack ${p.name}`, it.p);
            this.defs.set(id, { id, pack: p.name, file: f.file, syn: it });
            break;
          }
          case 'type': {
            const key = `${p.name}:${it.name}`;
            if (this.types.has(key)) this.diags.error('mkp.duplicate-type', `type ${it.name} is declared twice in pack ${p.name}`, it.p);
            const t = it.type.t === 'rec' ? { ...it.type, name: it.name } : it.type;
            this.types.set(key, { pack: p.name, name: it.name, type: t, p: it.p });
            break;
          }
          case 'fn':
          case 'op': {
            const isOp = it.item === 'op';
            const table = isOp ? this.ops : this.fns;
            const name = isOp ? (it as { symbol: string }).symbol : it.name;
            const list = table.get(name) ?? [];
            const sig = it.params.every((q) => q.type) ? it.params.map((q) => q.type!) : undefined;
            if (isOp && !sig) this.diags.error('mkp.op-untyped', `op ${name} must type every parameter; dispatch uses them (6.22)`, it.p);
            const id = `${p.name}:${isOp ? 'op' : ''}${name}#${list.length}`;
            list.push({ id, pack: p.name, file: f.file, syn: it, op: isOp ? name : undefined, sig });
            table.set(name, list);
            break;
          }
          case 'const': {
            const list = this.consts.get(it.name) ?? [];
            list.push({ id: `${p.name}:${it.name}`, pack: p.name, file: f.file, name: it.name, type: it.type, syn: it });
            this.consts.set(it.name, list);
            break;
          }
          case 'macro':
            this.macros.set(it.name, { pack: p.name, tex: it.tex });
            break;
          case 'tokens':
            this.tokenSets.push({ pack: p.name, syn: it });
            break;
          case 'manifest':
            break;
        }
      }
    }
  }

  /** Whether a name declared in `owner` is visible from `from`. */
  visible(owner: string, name: string, from: string): boolean {
    if (owner === from) return true;
    const p = this.packs.get(owner);
    return !!p && (p.builtin || p.provides.has(name));
  }

  /** The type environment seen from a pack. */
  typeEnv(from: string): TypeEnv {
    return (name: string) => this.lookupType(name, from)?.type;
  }

  lookupType(name: string, from: string): { pack: string; name: string; type: Type } | undefined {
    const own = this.types.get(`${from}:${name}`);
    if (own) return own;
    if (name.includes(':')) {
      const t = this.types.get(name);
      return t && this.visible(t.pack, t.name, from) ? t : undefined;
    }
    const found = [...this.types.values()].filter((t) => t.name === name && this.visible(t.pack, name, from));
    return found[0];
  }

  /** Definitions visible under a name, highest version first. */
  lookupDefs(name: string, from: string): DefEntry[] {
    let pack: string | undefined;
    let bare = name;
    const colon = name.indexOf(':');
    if (colon >= 0) {
      pack = name.slice(0, colon);
      bare = name.slice(colon + 1);
    }
    const out: DefEntry[] = [];
    for (const d of this.defs.values()) {
      if (d.syn.name !== bare) continue;
      if (pack && d.pack !== pack) continue;
      if (!this.visible(d.pack, bare, from)) continue;
      out.push(d);
    }
    return out.sort((a, b) => b.syn.version - a.syn.version);
  }

  fnCandidates(name: string, from: string): FnEntry[] {
    return (this.fns.get(name) ?? []).filter((f) => this.visible(f.pack, name, from));
  }

  opCandidates(symbol: string, from: string): FnEntry[] {
    return (this.ops.get(symbol) ?? []).filter((f) => {
      if (f.pack === from) return true;
      const p = this.packs.get(f.pack);
      if (!p) return false;
      if (p.builtin) return true;
      // a type brings its operators: visible when the pack provides a type the op mentions
      const mentioned = [...(f.sig ?? []), ...(f.syn.ret ? [f.syn.ret] : [])].filter((t) => t.t === 'named').map((t) => (t as { name: string }).name);
      return mentioned.some((n) => p.provides.has(n));
    });
  }

  constCandidates(name: string, from: string): ConstEntry[] {
    return (this.consts.get(name) ?? []).filter((c) => this.visible(c.pack, name, from));
  }
}
