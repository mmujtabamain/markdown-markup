// Profiles (spec 16): a pack whose manifest says `profile name@N`, declaring typed front-matter
// fields, block attributes, section roles and rules from a small built-in set: required, one-of, pattern,
// max-length and count. A rule path is front.<field>, blocks.<widget> or roles.<role>.

import { closest, Diagnostics, Pos } from './diag';
import type { Compiled } from './build';
import type { IRNode } from './ir';
import { resolve, showType, Type } from './types';

const RULES = ['required', 'one-of', 'pattern', 'max-length', 'count', 'depth', 'first'];

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

/** A front-matter value as the author wrote it, for "found …". */
function shown(v: unknown): string {
  if (v === undefined || v === null) return 'nothing';
  if (typeof v === 'string') return v === '' ? '""' : v;
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}]` : '[] (an empty list)';
  return JSON.stringify(v);
}

/** What a type takes, in plain words. */
function describe(t: Type): string {
  switch (t.t) {
    case 'text':
      return 'text';
    case 'latex':
      return 'LaTeX text';
    case 'int':
      return t.lo !== undefined ? `a whole number from ${t.lo} to ${t.hi}` : 'a whole number';
    case 'num':
      return t.lo !== undefined ? `a number from ${t.lo} to ${t.hi}` : 'a number';
    case 'bool':
      return 'true or false';
    case 'choice':
      return `one of ${t.opts.join(', ')}`;
    case 'list':
      return `a list of ${describe(t.of)}`;
    default:
      return showType(t);
  }
}

/** A value of a type, as front matter writes it. */
function example(t: Type): string {
  switch (t.t) {
    case 'text':
    case 'latex':
      return '"Some text"';
    case 'int':
      return String(t.lo ?? 2);
    case 'num':
      return String(t.lo ?? 1.5);
    case 'bool':
      return 'true';
    case 'choice':
      return t.opts[0] ?? '…';
    case 'list':
      return `[${example(t.of)}]`;
    default:
      return '…';
  }
}

/** "a or b", "a, b or c". */
function orList(xs: string[]): string {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

/** What a rule path counts or reads, in the author's words. */
function pathName(path: string): string {
  const [head, ...rest] = path.split('.');
  const name = rest.join('.');
  if (head === 'front') return `front matter ${name}`;
  if (head === 'blocks') return `${name} blocks`;
  if (head === 'roles') return `sections with {role=${name}}`;
  return path;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** How a body node reads to an author: "a paragraph", "a code block". */
function nodeName(n: IRNode): string {
  if (n.node === 'heading') return `the heading ${'#'.repeat(Number((n.props?.level as { lit?: number } | undefined)?.lit ?? 1))} ${headingText(n)}`;
  if (n.node === 'paragraph') return 'a paragraph';
  if (n.node === 'list') return 'a list';
  if (n.node === 'code') return 'a code block';
  return `a ${n.node} block`;
}

function headingText(n: IRNode): string {
  const t = (n.props?.text as { text?: string } | undefined)?.text;
  return t ?? '…';
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
    const given = [...c.prog.packs.values()].filter((p) => p.kind === 'profile').map((p) => p.name);
    const hint = closest(name, given) ?? given[0];
    const other = hint ? `or ask for a profile that was given (--profile ${hint})` : 'or check the document without --profile';
    if (prof) diags.error('mkp.profile', `${name} is a pack, not a profile, so a document can't be checked against it; found pack ${name}@${prof.version} at the top of its manifest. Give the build the profile you mean (a pack whose manifest starts with "profile name@N"), ${other}`, at);
    else diags.error('mkp.profile', `the profile ${name} is not among the packs given to this build; found ${given.length ? `only the profiles ${given.join(', ')}` : 'no profile among them'}. Give the build the pack whose manifest starts with "profile ${name}@1" (--pack <its folder>), ${other}`, at);
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
    const t = resolve(f.type, env);
    if (!typeOk(front[f.name], t)) {
      const v = front[f.name];
      const fix = (t.t === 'text' || t.t === 'latex') && (typeof v === 'number' || typeof v === 'boolean') ? `Quote it so it is read as text: ${f.name}: "${v}"` : `Write ${describe(t)}, e.g. ${f.name}: ${example(t)}`;
      const declared = describe(t) === showType(f.type) ? '' : ` (the ${name} profile declares it ${showType(f.type)})`;
      diags.error('mkp.front-type', `front matter ${f.name} must be ${describe(t)}${declared}; found ${shown(v)}. ${fix}`, frontAt(f.name) ?? at);
    }
  }
  const fields = m.front.map((f) => f.name);
  for (const k of Object.keys(front)) {
    if (fields.includes(k)) continue;
    const hint = closest(k, fields);
    diags.error('mkp.front-unknown', `the ${name} profile has no front-matter field ${k}; found ${k}: ${shown(front[k])}. ${hint ? `Rename it to ${hint} if that is what you meant, or remove the line` : 'Remove the line'}, or declare the field in the profile's manifest (front ${k} text). Its fields are ${fields.join(', ') || 'none'}`, frontAt(k) ?? at);
  }
  // roles on headings ({role=…})
  const roles: string[] = [];
  const rolePos = new Map<string, number[]>();
  const blocks = new Map<string, number>();
  const blockPos = new Map<string, number[]>();
  const walk = (ns: IRNode[]): void => {
    for (const n of ns) {
      const line = n.pos?.[0] ?? 1;
      const role = (n.meta as { role?: string } | undefined)?.role;
      if (role) {
        if (!m.roles.includes(role)) {
          const hint = closest(role, m.roles) ?? m.roles[0];
          const msg = m.roles.length
            ? `the section role ${role} is not one of the ${name} profile's roles (${m.roles.join(', ')}); found {role=${role}}. Write one of them, e.g. {role=${hint}}, or add ${role} to the profile's roles line`
            : `the ${name} profile declares no section roles; found {role=${role}}. Remove {role=${role}}, or add a line "roles ${role}" to the profile's manifest`;
          diags.error('mkp.role', msg, { file, line, col: 1 });
        }
        roles.push(role);
        rolePos.set(role, [...(rolePos.get(role) ?? []), line]);
      }
      if (n.meta?.summary !== undefined) {
        blocks.set(n.node, (blocks.get(n.node) ?? 0) + 1);
        blockPos.set(n.node, [...(blockPos.get(n.node) ?? []), line]);
      }
      // block attributes: a choice must be one of its options (they are written as text)
      for (const [k, v] of Object.entries(n.meta?.attrs ?? {})) {
        const t = resolve(m.attrs.find((a) => a.name === k)!.type, env);
        if (t.t === 'choice' && !t.opts.includes(v)) {
          const hint = closest(v, t.opts);
          const fix = hint ? `Write {${k}=${hint}}` : t.opts.length <= 3 ? `Write ${orList(t.opts.map((o) => `{${k}=${o}}`))}` : `Write one of them, e.g. {${k}=${t.opts[0]}}`;
          diags.error('mkp.attr-type', `the block attribute ${k} takes one of ${t.opts.join(', ')}; found {${k}=${v}}. ${fix}`, { file, line, col: 1 });
        }
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
    const [head, ...restParts] = r.path.split('.');
    const field = restParts.join('.');
    const fieldType = head === 'front' ? m.front.find((f) => f.name === field)?.type : undefined;
    const ruleText = `profile rule: ${r.rule} ${r.path}${r.args.length ? ' ' + r.args.map(valOf).join(' ') : ''}`;
    // the author's own message leads; the rule, what was found and the fix follow
    const fail = (demand: string, found: string, fix: string, where: Pos = fieldAt(r.path)): void => diags.error(`mkp.rule.${r.rule}`, `${r.message ?? demand} (${ruleText}); found ${found}. ${fix}`, where);
    const lineAt = (line: number): Pos => ({ file, line, col: 1 });
    switch (r.rule) {
      // the body's shape (GAPS 35): headings at most n deep, and what the body starts with
      case 'depth': {
        const max = Number(r.args[0] ? valOf(r.args[0]) : NaN);
        for (const n of body) {
          const level = Number((n.props?.level as { lit?: number } | undefined)?.lit ?? 2);
          if (n.node !== 'heading' || !(level > max)) continue;
          const text = headingText(n);
          fail(`headings may go at most ${max} levels deep`, `${'#'.repeat(level)} ${text}, a level-${level} heading`, `Use at most ${max} # (${'#'.repeat(max)} ${text}), or make it bold text (**${text}**)`, lineAt(n.pos?.[0] ?? 1));
        }
        break;
      }
      case 'first': {
        const kind = r.args[0] ? valOf(r.args[0]) : 'heading';
        const first = body.find((n) => n.node !== 'controls');
        if (first && first.node !== kind) {
          const later = body.find((n) => n.node === kind);
          const fix = later ? `Move ${nodeName(later)} (line ${later.pos?.[0] ?? '?'}) above it, or add a ${kind} at the top` : kind === 'heading' ? `Add a heading at the top, e.g. # ${typeof front.title === 'string' ? front.title : 'Title'}` : `Put a ${kind} block at the top`;
          fail(`the document must start with a ${kind}`, `${nodeName(first)} first`, fix, lineAt(first.pos?.[0] ?? 1));
        }
        break;
      }
      case 'required': {
        const missing = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || v === 0;
        if (!missing) break;
        const found = v === undefined || v === null ? (head === 'front' ? `no ${field} in the front matter` : 'nothing') : Array.isArray(v) ? `${field}: [] (an empty list)` : v === '' ? `${field}: "" (empty)` : `no ${pathName(r.path)}`;
        const fix =
          head === 'front'
            ? Array.isArray(v)
              ? `Give at least one item, e.g. ${field}: ${fieldType ? example(resolve(fieldType, env)) : '[…]'}`
              : `Add it to the front matter, e.g. ${field}: ${fieldType ? example(resolve(fieldType, env)) : '…'}`
            : head === 'roles'
              ? `Add a section with {role=${field}}: a heading, then {role=${field}} on the line under it`
              : head === 'blocks'
                ? `Add a \`\`\`${field} block to the document`
                : `Give ${r.path} a value`;
        fail(`${pathName(r.path)} is required`, found, fix);
        break;
      }
      case 'one-of': {
        const opts = r.args.map(valOf);
        if (v !== undefined && !opts.includes(String(v))) {
          const hint = closest(String(v), opts);
          const lhs = head === 'front' ? `${field}: ` : '';
          const fix = hint ? `Write ${lhs}${hint}` : opts.length <= 3 ? `Write ${orList(opts.map((o) => lhs + o))}` : `Write one of ${opts.join(', ')}, e.g. ${lhs}${opts[0]}`;
          fail(`${pathName(r.path)} must be ${orList(opts)}`, shown(v), fix);
        }
        break;
      }
      case 'pattern': {
        const src = r.args[0] ? valOf(r.args[0]) : '';
        let re: RegExp | null = null;
        try {
          re = new RegExp(src);
        } catch (e) {
          const why = String((e as Error).message).replace(/^.*: /, '');
          diags.error('mkp.profile', `the pattern rule on ${r.path} in the ${name} profile is not a valid regular expression; found "${src}" (${why.toLowerCase()}). Correct the pattern on that rule line, e.g. rule pattern ${r.path} "^[a-z-]+$"`, r.p ?? at);
        }
        if (re && v !== undefined) {
          const bad = (Array.isArray(v) ? v : [v]).find((x) => !re!.test(String(x)));
          if (bad !== undefined) {
            const guess = String(bad).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const lhs = head === 'front' ? `${field}: ` : '';
            const fix = guess && guess !== String(bad) && re.test(guess) ? `Change it so it matches ${src}, e.g. ${lhs}${guess}` : `Change it so it matches the pattern ${src}`;
            fail(`${pathName(r.path)} must match the pattern ${src}`, `${shown(bad)}, which does not match`, fix);
          }
        }
        break;
      }
      case 'max-length': {
        const n = Number(r.args[0] ? valOf(r.args[0]) : NaN);
        const len = typeof v === 'string' || Array.isArray(v) ? v.length : 0;
        if (len > n) {
          const found = Array.isArray(v) ? `${plural(len, 'item')} in ${field}` : `${shown(v)}, ${plural(len, 'character')} long`;
          const fix = Array.isArray(v) ? `Remove ${plural(len - n, 'item')} so at most ${n} remain` : `Shorten it to ${plural(n, 'character')} or fewer`;
          fail(`${pathName(r.path)} may be at most ${Array.isArray(v) ? plural(n, 'item') : plural(n, 'character')} long`, found, fix);
        }
        break;
      }
      case 'count': {
        const a = r.args[0];
        const n = typeof v === 'number' ? v : Array.isArray(v) ? v.length : v === undefined ? 0 : 1;
        let lo: number;
        let hi: number;
        if (a && a.value.v === 'range') {
          lo = Number((a.value as { lo: { v?: number } }).lo.v ?? 0);
          hi = Number((a.value as { hi: { v?: number } }).hi.v ?? Infinity);
        } else if (a) lo = hi = Number(valOf(a));
        else break;
        if (n >= lo && n <= hi) break;
        const want = lo === hi ? `exactly ${lo}` : hi === Infinity ? `at least ${lo}` : `${lo} to ${hi}`;
        const lines = head === 'roles' ? rolePos.get(field) ?? [] : head === 'blocks' ? blockPos.get(field) ?? [] : [];
        let fix: string;
        let where = fieldAt(r.path);
        if (n < lo) {
          const k = lo - n;
          fix =
            head === 'roles'
              ? `Add ${plural(k, 'more section')} with {role=${field}}: a heading, then {role=${field}} on the line under it`
              : head === 'blocks'
                ? `Add ${plural(k, `more \`\`\`${field} block`)}`
                : `Add ${plural(k, 'more item')} to ${field}`;
          if (lines.length) where = lineAt(lines[lines.length - 1]);
        } else {
          const k = n - hi;
          fix = head === 'roles' ? `Remove {role=${field}} from ${plural(k, 'section')}` : head === 'blocks' ? `Remove ${plural(k, `\`\`\`${field} block`)}` : `Remove ${plural(k, 'item')} from ${field}`;
          if (lines[hi] !== undefined) where = lineAt(lines[hi]);
        }
        fail(`the document needs ${want} ${pathName(r.path)}`, String(n), fix, where);
        break;
      }
      default: {
        const hint = closest(r.rule, RULES) ?? RULES.find((x) => x.includes(r.rule) || r.rule.includes(x));
        diags.error('mkp.profile', `the ${name} profile has a rule named ${r.rule}, which MKP does not know; found rule ${r.rule} ${r.path}. ${hint ? `Write rule ${hint} ${r.path} … instead, or use` : 'Use'} one of ${RULES.join(', ')}`, r.p ?? at);
      }
    }
  }
}
