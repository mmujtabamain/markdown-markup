// Fixtures (spec 11): name.fixture.json beside definitions. Each case is exactly what a document
// block compiles to; it feeds the playground, the tests and the conformance suite.

import YAML from 'yaml';
import type { Compiled } from './build';
import { closest, Diagnostics } from './diag';
import type { IRBundle } from './ir';

export interface PlayStep {
  press?: string;
  /** state by name; "part/name" sets a nested part's (GAPS 87) */
  set?: Record<string, unknown>;
  command?: string;
  args?: Record<string, unknown>;
  wait?: number;
  /** an overlay by id (GAPS 115) */
  open?: string;
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
  expect?: { errors?: string[]; md?: Record<string, string>; values?: Record<string, unknown>; visible?: string[]; tolerance?: number };
}

export interface FixtureFile {
  widget: string;
  cases: Record<string, Omit<FixtureCase, 'pack' | 'file' | 'widget' | 'name'>>;
}

/** A JSON value as a message shows it: "a list ([…])", "the text "x"". */
function kindOf(v: unknown): string {
  const brief = (x: unknown): string => {
    const j = JSON.stringify(x) ?? String(x);
    return j.length > 40 ? j.slice(0, 40) + '…' : j;
  };
  if (v === undefined) return 'nothing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return `a list (${brief(v)})`;
  if (typeof v === 'string') return `the text ${brief(v)}`;
  if (typeof v === 'number' || typeof v === 'boolean') return `the value ${String(v)}`;
  return `an object (${brief(v)})`;
}

const CASE_KEYS = ['props', 'summary', 'play', 'expect', 'hosts'];
const STEP_KEYS = ['press', 'set', 'command', 'args', 'wait', 'open'];

/** Problems with a fixture file's shape (fixture.schema.json says the same). */
export function fixtureShape(json: unknown, file = 'the fixture file'): string | null {
  const widget = /([A-Za-z_][\w.-]*)\.fixture\.json$/.exec(file)?.[1] ?? 'note';
  const shape = `{"widget": "${widget}@1", "cases": {"basic": {"props": {…}, "summary": "…"}}}`;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return `${file} must hold one JSON object with "widget" and "cases"; found ${kindOf(json)}. Write it as ${shape}`;
  const f = json as Record<string, unknown>;
  if (typeof f.widget !== 'string' || !/^[A-Za-z_][\w.:-]*@\d+$/.test(f.widget)) {
    const fix = typeof f.widget === 'string' && /^[A-Za-z_][\w.:-]*$/.test(f.widget) ? `Add its version: "widget": "${f.widget}@1"` : `Write e.g. "widget": "${widget}@1"`;
    return `"widget" in ${file} must name the definition the cases are for, as name@N; found ${f.widget === undefined ? 'no "widget" key' : kindOf(f.widget)}. ${fix}`;
  }
  if (!f.cases || typeof f.cases !== 'object' || Array.isArray(f.cases)) return `"cases" in ${file} must be an object of named cases; found ${f.cases === undefined ? 'no "cases" key' : kindOf(f.cases)}. Write e.g. "cases": {"basic": {"props": {…}, "summary": "…"}}`;
  for (const [n, c] of Object.entries(f.cases as Record<string, unknown>)) {
    if (!c || typeof c !== 'object') return `case ${n} in ${file} must be an object; found ${kindOf(c)}. Write e.g. "${n}": {"props": {…}, "summary": "…"}`;
    const cc = c as Record<string, unknown>;
    for (const k of Object.keys(cc)) {
      if (CASE_KEYS.includes(k)) continue;
      const hint = closest(k, CASE_KEYS);
      return `case ${n} in ${file} has a key a case does not take; found "${k}". ${hint ? `Rename it to "${hint}", or remove it` : `Remove it, or move it into "props" if it is an input`}; a case takes ${CASE_KEYS.join(', ')}`;
    }
    if (cc.props !== undefined && (typeof cc.props !== 'object' || Array.isArray(cc.props))) return `props of case ${n} in ${file} must be an object of input values; found ${kindOf(cc.props)}. Write e.g. "props": {"label": "Hello"}`;
    if (cc.play !== undefined) {
      if (!Array.isArray(cc.play)) return `play of case ${n} in ${file} must be a list of steps; found ${kindOf(cc.play)}. Write e.g. "play": [{"press": "next"}]`;
      for (const s of cc.play) {
        const keys = s && typeof s === 'object' && !Array.isArray(s) ? Object.keys(s) : [];
        if (keys.length && keys.every((k) => STEP_KEYS.includes(k))) continue;
        const bad = keys.find((k) => !STEP_KEYS.includes(k));
        const hint = bad ? closest(bad, STEP_KEYS) : undefined;
        return `a play step of case ${n} in ${file} must be press, set, command (with args), wait or open; found ${bad ? `the key "${bad}"` : kindOf(s)}. ${hint ? `Rename it to "${hint}"` : 'Write e.g. {"press": "next"}, {"set": {"count": 2}} or {"wait": 500}'}`;
      }
    }
  }
  return null;
}

export function fixtureCases(c: Compiled, diags = c.diags): FixtureCase[] {
  const out: FixtureCase[] = [];
  for (const p of c.prog.packs.values()) {
    for (const f of p.fixtures) {
      const err = fixtureShape(f.json, f.path);
      if (err) {
        // the file as the pack was given (a folder path), so it can be opened
        diags.error('mkp.fixture-shape', err, { file: `${p.label ?? p.name}/${f.path}`, line: 1, col: 1 });
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
  const body: Record<string, unknown> = { ...fc.props, summary: fc.summary ?? `${fc.widget}: ${fc.name}` };
  // {"state": v} gives a ref input state of its own: a document state var bound with {ref}
  const vars: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'state' in v) {
      const init = (v as { state: unknown }).state;
      const type = typeof init === 'boolean' ? 'bool' : typeof init === 'string' ? 'text' : Number.isInteger(init) ? 'int' : 'num';
      vars.push(`var ${k} ${type} = ${typeof init === 'string' ? JSON.stringify(init) : String(init)}`);
      body[k] = { ref: k };
    }
  }
  const state = vars.length ? `\`\`\`state\n${vars.join('\n')}\n\`\`\`\n\n` : '';
  // YAML, as a document writes it (GAPS 168)
  return `${state}\`\`\`${fc.pack}:${fc.widget}\n${YAML.stringify(body, { lineWidth: 0 }).trimEnd()}\n\`\`\`\n`;
}

export interface CaseResult {
  bundle: IRBundle | null;
  diags: Diagnostics;
  /** for negative cases: whether the expected error codes appeared */
  ok: boolean;
}

export function compileCase(c: Compiled, fc: FixtureCase): CaseResult {
  const diags = new Diagnostics();
  // a pack's fixture cases see its private parts too: every definition has a case
  const bundle = c.document(caseDocument(fc), `${fc.pack}/${fc.file}#${fc.name}`, diags, { allowParts: true, privateOf: fc.pack });
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
