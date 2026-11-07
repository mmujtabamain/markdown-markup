// Maths notation (spec 6.15): one engine on every platform. MathJax with its DOM-free adaptor
// gives SVG; the Speech Rule Engine gives spoken text. Static formulas are pre-rendered at build;
// formulas with \val{} render at runtime.

import type { Diagnostics } from './diag';
import type { IRBundle, IRMaths } from './ir';
import { inlineMaths } from './markdown';
import type { MathsRenderer } from './runtime/runtime';

export interface Rendered {
  svg: string;
  w: number;
  h: number;
  va: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Engine {
  mathjax: any;
  TeX: any;
  SVG: any;
  liteAdaptor: any;
  RegisterHTMLHandler: any;
  SerializedMmlVisitor: any;
  STATE: any;
  sre: { setupEngine(o: Record<string, unknown>): Promise<void>; engineReady(): Promise<void>; toSpeech(mml: string): string };
  locales: Record<string, string>;
}
// The engine (2.7 MB) loads with the first MathsEngine.create(), not with @mkp/core: a page that only
// shows pre-rendered maths, or a host that imports core for its types and runtime, never fetches it.
// Every use goes through an instance, and an instance exists only after the load.
let engine: Engine;
let loading: Promise<void> | null = null;
function load(): Promise<void> {
  // @ts-expect-error: the generated engine bundle has no type declarations
  loading ??= import('../vendor/maths-engine.js').then((m: { default?: Engine } & Engine) => {
    engine = m.default ?? m;
  });
  return loading;
}

let speechReady: Promise<void> | null = null;

/**
 * \mark{id}{…} marks a part of a formula (GAPS 163): it becomes \class{mkp-mark-id}{…}, a group a
 * provider colours by the math block's marks.
 */
export function marks(tex: string): string {
  return tex.replace(/\\mark\{([A-Za-z][A-Za-z0-9_-]*)\}/g, '\\class{mkp-mark-$1}');
}

export class MathsEngine implements MathsRenderer {
  private readonly adaptor = engine.liteAdaptor();
  private readonly doc: any;
  private readonly visitor = new engine.SerializedMmlVisitor();
  private readonly svgCache = new Map<string, Rendered | null>();
  private readonly speechCache = new Map<string, string>();
  private speechOn = false;

  private constructor(_macros: Record<string, string>) {
    engine.RegisterHTMLHandler(this.adaptor);
    const tex = new engine.TeX({
      packages: ['base', 'ams', 'newcommand', 'boldsymbol', 'cancel', 'mathtools', 'html'],
      formatError: (_jax: unknown, err: Error) => {
        throw err;
      },
    });
    const svg = new engine.SVG({ fontCache: 'none' });
    this.doc = engine.mathjax.document('', { InputJax: tex, OutputJax: svg });
  }

  /** An engine; with speech, it waits for the speech rules to load once. */
  static async create(opts: { speech?: boolean; macros?: Record<string, string> } = {}): Promise<MathsEngine> {
    await load();
    const m = new MathsEngine(opts.macros ?? {});
    if (opts.speech !== false) {
      speechReady ??= engine.sre
        .setupEngine({ locale: 'en', domain: 'clearspeak', modality: 'speech', custom: (loc: string) => Promise.resolve(engine.locales[loc]) })
        .then(() => engine.sre.engineReady());
      await speechReady;
      m.speechOn = true;
    }
    return m;
  }

  /** The error MathJax reports for a formula, or null. \val{} holes are checked as placeholders. */
  check(tex: string, display = false): string | null {
    try {
      this.doc.convert(marks(tex.replace(/\\val\{(?:[^{}]|\{[^{}]*\})*\}/g, '{\\square}')), { display, end: engine.STATE.CONVERT });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  render(tex: string, display: boolean): Rendered | null {
    const key = (display ? 'D' : 'I') + tex;
    if (this.svgCache.has(key)) return this.svgCache.get(key)!;
    let out: Rendered | null = null;
    try {
      const node = this.doc.convert(marks(tex), { display });
      const html: string = this.adaptor.outerHTML(node);
      const m = /<svg[\s\S]*<\/svg>/.exec(html);
      if (m) {
        // no links out of maths: MathJax's \\href would otherwise put an <a href> in the SVG
        const svg = m[0].replace(/\s(?:xlink:)?href="[^"]*"/g, '');
        const w = parseFloat(/width="([-\d.]+)ex"/.exec(svg)?.[1] ?? '0');
        const h = parseFloat(/height="([-\d.]+)ex"/.exec(svg)?.[1] ?? '0');
        const va = parseFloat(/vertical-align:\s*([-\d.]+)ex/.exec(svg)?.[1] ?? '0');
        out = { svg, w, h, va };
      }
    } catch {
      out = null;
    }
    if (this.svgCache.size > 4000) this.svgCache.clear();
    this.svgCache.set(key, out);
    return out;
  }

  speech(tex: string, display: boolean): string | undefined {
    if (!this.speechOn) return undefined;
    const key = (display ? 'D' : 'I') + tex;
    const hit = this.speechCache.get(key);
    if (hit !== undefined) return hit;
    let s: string;
    try {
      const mml = this.visitor.visitTree(this.doc.convert(marks(tex), { display, end: engine.STATE.CONVERT }));
      s = engine.sre.toSpeech(mml);
    } catch {
      s = tex;
    }
    if (this.speechCache.size > 4000) this.speechCache.clear();
    this.speechCache.set(key, s);
    return s;
  }

  /** Every maths source as one fully rendered IRMaths. */
  full(tex: string, display: boolean): IRMaths {
    const r = this.render(tex, display);
    const m: IRMaths = { tex };
    if (display) m.display = true;
    if (r) Object.assign(m, r);
    const s = this.speech(tex, display);
    if (s) m.speech = s;
    return m;
  }
}

/** Where a formula's $…$ (or $$…$$) starts in a paragraph's text, or -1. */
function findMaths(text: string, tex: string): number {
  for (const d of ['$$', '$']) {
    const i = text.indexOf(d + tex + d);
    if (i >= 0) return i;
  }
  return -1;
}

/** A fix for the TeX errors authors meet most, keyed by the engine's wording. */
function mathsFix(err: string): string {
  let m: RegExpExecArray | null;
  if (/Missing close brace|Extra open brace or missing close brace/.test(err)) return 'Add the missing "}" so every "{" is closed';
  if (/Extra close brace or missing open brace/.test(err)) return 'Remove the extra "}", or add the "{" it closes';
  if ((m = /Undefined control sequence (\\\S+)/.exec(err))) return `Check the spelling of ${m[1]}, or define it in an mkp block: macro ${m[1].slice(1)} = $…$`;
  if ((m = /Missing argument for (\\\S+)/.exec(err))) return `Give ${m[1]} all its arguments in braces, e.g. \\frac{1}{2}`;
  if (/Misplaced &/.test(err)) return 'Use & only inside an environment such as \\begin{aligned}…\\end{aligned}';
  if (/Missing superscript or subscript argument/.test(err)) return 'Give the ^ or _ what it raises or lowers, e.g. x^{2} or x_{1}';
  if (/Double exponent|Double subscripts?/.test(err)) return 'Group with braces, e.g. x^{a^b} or {x^a}^b';
  if (/Missing \\right|Extra \\right|Missing \\left|Extra \\left/.test(err)) return 'Pair every \\left with a \\right';
  if (/Missing \$ inserted|Math mode/i.test(err)) return 'Remove the nested $ inside the formula';
  return 'Fix the LaTeX so it typesets';
}

function mathsMessage(tex: string, err: string): string {
  const shown = tex.length > 80 ? tex.slice(0, 79) + '…' : tex;
  return `the maths \`${shown}\` can't be typeset; found this LaTeX error: ${err.replace(/\s+/g, ' ').trim().replace(/\.$/, '')}. ${mathsFix(err)}`;
}

function expand(tex: string, macros: Record<string, string>): string {
  let out = tex;
  for (const [k, v] of Object.entries(macros)) out = out.replace(new RegExp(`\\\\${k}(?![A-Za-z])`, 'g'), () => v);
  return out;
}

/**
 * Pre-renders a bundle's static maths (6.15) in place and checks every formula, live ones
 * included, reporting errors at the node that holds them.
 */
/**
 * Whether drawing `b` needs the maths engine: a formula or a text with maths in it that the build
 * has not already typeset (prerender), or one with live values (\val{}). A host that loads the
 * engine only when this is true never fetches it for a document without maths. Maths that arrives
 * later from outside the bundle (a host input) shows as its TeX until the host loads the engine.
 */
export function needsMaths(b: IRBundle): boolean {
  const typeset = (o: Record<string, unknown>, tex: string): boolean =>
    !tex.includes('\\val{') && Array.isArray(o.maths) && (o.maths as IRMaths[]).some((m) => m.tex === tex && typeof m.svg === 'string');
  const visit = (v: unknown): boolean => {
    if (typeof v === 'string') return v.includes('$') && inlineMaths(v).length > 0;
    if (!v || typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.some(visit);
    const o = v as Record<string, unknown>;
    // a code block's source is code: a $ in it is a shell variable, not maths (SN 139)
    if (o.node === 'code' && o.props && typeof o.props === 'object') {
      const { src: _src, ...rest } = o.props as Record<string, unknown>;
      return visit(rest) || Object.entries(o).some(([k, x]) => k !== 'props' && visit(x));
    }
    // a math block, or a tex template (latex literal): typeset by the build unless it has live values
    if (typeof o.tex === 'string' && !('ast' in o) && (typeof o.svg !== 'string' || o.tex.includes('\\val{'))) return true;
    if (o.t === 'tmpl' && o.tex) return true;
    for (const [k, x] of Object.entries(o)) {
      if (k === 'svg' || k === 'speech' || k === 'maths' || k === 'file' || k === 'pos' || (k === 'tex' && typeof x !== 'object')) continue;
      if (k === 'text' && typeof x === 'string') {
        if (inlineMaths(x).some((t) => !typeset(o, t))) return true;
        continue;
      }
      if (visit(x)) return true;
    }
    return false;
  };
  return visit(b.doc.body) || Object.values(b.defs).some(visit) || Object.values(b.fns).some((f) => visit(f.body));
}

export function prerender(b: IRBundle, m: MathsEngine, diags?: Diagnostics): void {
  const macros = b.macros;
  const report = (tex: string, err: string, pos: [number, number] | undefined, file: string, para?: string): void => {
    let line = pos?.[0] ?? 1;
    let col = pos?.[1] ?? 1;
    // in a paragraph the text is the source from its first line on: point at the formula itself
    const at = para ? findMaths(para, tex) : -1;
    if (at >= 0) {
      const before = para!.slice(0, at);
      const nl = before.lastIndexOf('\n');
      line += before.split('\n').length - 1;
      col = nl < 0 ? col + at : at - nl;
    }
    diags?.error('mkp.maths', mathsMessage(tex, err), { file, line, col });
  };
  const visit = (v: unknown, pos: [number, number] | undefined, file: string, inPara = false): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, pos, file, inPara));
    const o = v as Record<string, unknown>;
    const here = (Array.isArray(o.pos) ? (o.pos as [number, number]) : pos) ?? pos;
    // a Markdown paragraph's text is its source; a node of another kind holds text from elsewhere
    const para = typeof o.node === 'string' ? o.node === 'paragraph' : inPara;
    // a code block's source is code: a $ in it is a shell variable, not maths (SN 139)
    if (o.node === 'code' && o.props && typeof o.props === 'object') {
      const { src: _src, ...rest } = o.props as Record<string, unknown>;
      return visit(rest, here, file, para);
    }
    if (typeof o.tex === 'string' && !('ast' in o)) {
      const tex = expand(o.tex, macros);
      const err = m.check(tex, !!o.display);
      if (err) report(o.tex, err, here, file);
      else if (!o.tex.includes('\\val{')) Object.assign(o, m.full(tex, !!o.display), { tex: o.tex });
    }
    if (typeof o.text === 'string' && !('ast' in o)) {
      const maths: IRMaths[] = [];
      for (const t of inlineMaths(o.text)) {
        const tex = expand(t, macros);
        const err = m.check(tex);
        if (err) report(t, err, here, file, para ? o.text : undefined);
        else if (!t.includes('\\val{')) maths.push({ ...m.full(tex, false), tex: t });
      }
      if (maths.length) o.maths = maths;
    }
    if (o.t === 'tmpl' || o.t === 'str') {
      // maths inside text and latex literals of expressions: checked, rendered live
      const src = String(o.v);
      const parts = o.t === 'tmpl' ? (o.tex ? [src] : inlineMaths(src)) : o.t === 'str' && /\$/.test(src) ? inlineMaths(src) : [];
      for (const t of parts) {
        const err = m.check(expand(t.replace(/\\val\{\d+\}/g, '{\\square}'), macros));
        if (err) report(t, err, here, file);
      }
    }
    for (const [k, x] of Object.entries(o)) if (k !== 'svg' && x && typeof x === 'object') visit(x, here, file, para);
  };
  visit(b.doc.body, undefined, b.doc.file);
  for (const d of Object.values(b.defs)) visit(d, d.pos, d.file ?? d.id);
  for (const f of Object.values(b.fns)) visit(f.body, f.pos, f.file ?? f.name);
}
