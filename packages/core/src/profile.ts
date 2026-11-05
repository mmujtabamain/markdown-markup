// Profiles (spec 16): a pack whose manifest says `profile name@N`, declaring typed front-matter
// fields, block attributes, section roles and rules from a small built-in set: required, one-of, pattern,
// max-length and count. A rule path is front.<field>, blocks.<widget> or roles.<role>.

import { Diagnostics, Pos } from './diag';
import type { Compiled } from './build';
import type { IRNode } from './ir';
import { resolve, showType, Type } from './types';

function valOf(v: { value: { v: string; src: string; e?: { k: string; v?: unknown; name?: string } } }): string {
  const e = v.value.e;
  if (e && (e.k === 'str' || e.k === 'num')) return String(e.v);
  if (e && e.k === 'id') return String(e.name);
  return v.value.src;
}

function typeOk(v: unknown, t: Type): boolean {
  switch (t.t) {
    case 'text':
    case 'latex':
      return typeof v === 'string';
    case 'num':
      return typeof v === 'number' && (t.lo === undefined || (v >= t.lo && v <= t.hi!));
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && (t.lo === undefined || (v >= t.lo && v <= t.hi!));
    case 'bool':
      return typeof v === 'boolean';
    case 'choice':
      return typeof v === 'string' && t.opts.includes(v);
    case 'list':
      return Array.isArray(v) && v.every((x) => typeOk(x, t.of));
    default:
      return true;
  }
}

/**
 * Checks a document against its profile. `frontAt` is where each front-matter key is written, so a
 * rule on a field points at that field (GAPS 12).
 */
export function checkProfile(c: Compiled, front: Record<string, unknown>, body: IRNode[], file: string, diags: Diagnostics, frontAt: (key: string) => Pos | undefined = () => undefined): void {
  const name = c.opts.profile!;
  const prof = c.prog.packs.get(name);
  const at: Pos = { file, line: 1, col: 1 };
  const fieldAt = (path: string): Pos => (path.startsWith('front.') ? frontAt(path.slice(6)) : undefined) ?? at;
  if (!prof || prof.kind !== 'profile') {
    diags.error('mkp.profile', `there is no profile "${name}" among the packs given`, at);
    return;
  }
  const m = prof.manifest;
  const env = c.prog.typeEnv(prof.name);
  // front-matter fields: typed, with defaults; unknown fields are errors
  for (const f of m.front) {
    if (!(f.name in front)) {
      if (f.def) {
        const e = (f.def as { e?: { k: string; v?: unknown; name?: string } }).e;
        front[f.name] = e?.k === 'id' ? e.name : e?.v;
      }
      continue;
    }
    if (!typeOk(front[f.name], resolve(f.type, env))) diags.error('mkp.front-type', `front matter ${f.name} must be ${showType(f.type)}`, frontAt(f.name) ?? at);
  }
  for (const k of Object.keys(front)) if (!m.front.some((f) => f.name === k)) diags.error('mkp.front-unknown', `the ${name} profile has no front-matter field "${k}"`, frontAt(k) ?? at);
  // roles on headings ({role=…})
  const roles: string[] = [];
  const blocks = new Map<string, number>();
  const walk = (ns: IRNode[]): void => {
    for (const n of ns) {
      const role = (n.meta as { role?: string } | undefined)?.role;
      if (role) {
        if (!m.roles.includes(role)) diags.error('mkp.role', `"${role}" is not a section role of ${name} (${m.roles.join(', ')})`, { file, line: n.pos?.[0] ?? 1, col: 1 });
        roles.push(role);
      }
      if (n.meta?.summary !== undefined) blocks.set(n.node, (blocks.get(n.node) ?? 0) + 1);
      // block attributes: a choice must be one of its options (they are written as text)
      for (const [k, v] of Object.entries(n.meta?.attrs ?? {})) {
        const t = resolve(m.attrs.find((a) => a.name === k)!.type, env);
        if (t.t === 'choice' && !t.opts.includes(v)) diags.error('mkp.attr-type', `${k} must be ${showType(t)}`, { file, line: n.pos?.[0] ?? 1, col: 1 });
      }
      if (n.children) walk(n.children);
    }
  };
  walk(body);
  const read = (path: string): unknown => {
    const [head, rest] = [path.split('.')[0], path.split('.').slice(1).join('.')];
    if (head === 'front') return front[rest];
    if (head === 'blocks') return blocks.get(rest) ?? 0;
    if (head === 'roles') return roles.filter((r) => r === rest).length;
    return undefined;
  };
  for (const r of m.rules) {
    const v = read(r.path);
    const msg = r.message ?? `${r.rule} ${r.path}`;
    const fail = (where: Pos = fieldAt(r.path)): void => diags.error(`mkp.rule.${r.rule}`, msg, where);
    switch (r.rule) {
      // the body's shape (GAPS 35): headings at most n deep, and what the body starts with
      case 'depth': {
        const max = Number(r.args[0] ? valOf(r.args[0]) : NaN);
        for (const n of body) if (n.node === 'heading' && Number((n.props?.level as { lit?: number } | undefined)?.lit ?? 2) > max) fail({ file, line: n.pos?.[0] ?? 1, col: 1 });
        break;
      }
      case 'first': {
        const kind = r.args[0] ? valOf(r.args[0]) : 'heading';
        const first = body.find((n) => n.node !== 'controls');
        if (first && first.node !== kind) fail({ file, line: first.pos?.[0] ?? 1, col: 1 });
        break;
      }
      case 'required':
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || v === 0) fail();
        break;
      case 'one-of': {
        const opts = r.args.map(valOf);
        if (v !== undefined && !opts.includes(String(v))) fail();
        break;
      }
      case 'pattern': {
        const src = r.args[0] ? valOf(r.args[0]) : '';
        let re: RegExp | null = null;
        try {
          re = new RegExp(src);
        } catch {
          diags.error('mkp.profile', `rule pattern ${r.path}: "${src}" is not a valid pattern`, at);
        }
        if (re && v !== undefined && !(Array.isArray(v) ? v : [v]).every((x) => re!.test(String(x)))) fail();
        break;
      }
      case 'max-length': {
        const n = Number(r.args[0] ? valOf(r.args[0]) : NaN);
        const len = typeof v === 'string' || Array.isArray(v) ? v.length : 0;
        if (len > n) fail();
        break;
      }
      case 'count': {
        const a = r.args[0];
        const n = typeof v === 'number' ? v : Array.isArray(v) ? v.length : v === undefined ? 0 : 1;
        if (a && a.value.v === 'range') {
          const lo = Number((a.value as { lo: { v?: number } }).lo.v ?? 0);
          const hi = Number((a.value as { hi: { v?: number } }).hi.v ?? Infinity);
          if (n < lo || n > hi) fail();
        } else if (a && n !== Number(valOf(a))) fail();
        break;
      }
      default:
        diags.error('mkp.profile', `unknown rule "${r.rule}"; rules are required, one-of, pattern, max-length, count, depth and first`, at);
    }
  }
}
