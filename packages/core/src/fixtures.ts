// Fixtures (spec 11): name.fixture.json beside definitions. Each case is exactly what a document
// block compiles to; it feeds the playground, the tests and the conformance suite.

import type { Compiled } from './build';
import { Diagnostics } from './diag';
import type { IRBundle } from './ir';

export interface PlayStep {
  press?: string;
  set?: Record<string, unknown>;
  command?: string;
  args?: Record<string, unknown>;
  wait?: number;
}

export interface FixtureCase {
  pack: string;
  file: string;
  widget: string;
  name: string;
  props: Record<string, unknown>;
  summary?: string;
  play?: PlayStep[];
  hosts?: Record<string, unknown>;
  expect?: { errors?: string[]; md?: Record<string, string>; values?: Record<string, unknown>; visible?: string[] };
}

export interface FixtureFile {
  widget: string;
  cases: Record<string, Omit<FixtureCase, 'pack' | 'file' | 'widget' | 'name'>>;
}

/** Problems with a fixture file's shape (fixture.schema.json says the same). */
export function fixtureShape(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 'a fixture file is an object with "widget" and "cases"';
  const f = json as Record<string, unknown>;
  if (typeof f.widget !== 'string' || !/^[A-Za-z_][\w.:-]*@\d+$/.test(f.widget)) return '"widget" names the definition as name@N';
  if (!f.cases || typeof f.cases !== 'object' || Array.isArray(f.cases)) return '"cases" is an object of named cases';
  for (const [n, c] of Object.entries(f.cases as Record<string, unknown>)) {
    if (!c || typeof c !== 'object') return `case ${n} is not an object`;
    const cc = c as Record<string, unknown>;
    for (const k of Object.keys(cc)) if (!['props', 'summary', 'play', 'expect', 'hosts'].includes(k)) return `case ${n} has an unknown key "${k}"`;
    if (cc.props !== undefined && (typeof cc.props !== 'object' || Array.isArray(cc.props))) return `case ${n}: props is an object`;
    if (cc.play !== undefined) {
      if (!Array.isArray(cc.play)) return `case ${n}: play is a list of steps`;
      for (const s of cc.play) {
        const keys = Object.keys(s ?? {});
        if (!keys.length || !keys.every((k) => ['press', 'set', 'command', 'args', 'wait'].includes(k))) return `case ${n}: a play step is press, set, command (with args) or wait`;
      }
    }
  }
  return null;
}

export function fixtureCases(c: Compiled, diags = c.diags): FixtureCase[] {
  const out: FixtureCase[] = [];
  for (const p of c.prog.packs.values()) {
    for (const f of p.fixtures) {
      const err = fixtureShape(f.json);
      if (err) {
        diags.error('mkp.fixture-shape', err, { file: `${p.name}/${f.path}`, line: 1, col: 1 });
        continue;
      }
      const ff = f.json as FixtureFile;
      for (const [name, cs] of Object.entries(ff.cases)) out.push({ pack: p.name, file: f.path, widget: ff.widget, name, props: cs.props ?? {}, summary: cs.summary, play: cs.play, hosts: cs.hosts, expect: cs.expect });
    }
  }
  return out;
}

/** The document a case stands for: one widget block whose YAML body is the case's props. */
export function caseDocument(fc: FixtureCase): string {
  const body = { ...fc.props, summary: fc.summary ?? `${fc.widget}: ${fc.name}` };
  return `\`\`\`${fc.pack}:${fc.widget}\n${JSON.stringify(body, null, 1)}\n\`\`\`\n`;
}

export interface CaseResult {
  bundle: IRBundle | null;
  diags: Diagnostics;
  /** for negative cases: whether the expected error codes appeared */
  ok: boolean;
}

export function compileCase(c: Compiled, fc: FixtureCase): CaseResult {
  const diags = new Diagnostics();
  const bundle = c.document(caseDocument(fc), `${fc.pack}/${fc.file}#${fc.name}`, diags, { allowParts: true });
  const want = fc.expect?.errors;
  if (want?.length) {
    const got = new Set(diags.errors.map((d) => d.code));
    return { bundle, diags, ok: want.every((w) => got.has(w)) };
  }
  return { bundle, diags, ok: diags.ok && !!bundle };
}

/** Every definition (widgets, parts) without one valid fixture case cannot be published. */
export function missingFixtures(c: Compiled): string[] {
  const cases = fixtureCases(c, new Diagnostics());
  const covered = new Set(cases.filter((x) => !x.expect?.errors?.length).map((x) => `${x.pack}:${x.widget}`));
  return [...c.defs.values()].filter((d) => d.kind !== 'extern' && d.pack !== 'core' && !d.id.startsWith('$doc') && !covered.has(`${d.pack}:${d.name}@${d.version}`)).map((d) => d.id);
}
