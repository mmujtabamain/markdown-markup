// gfx@1 (spec 8.1, 17): `pixels` compiles MKP's own expression tree to GLSL (WebGL) and SkSL
// (Skia) — no raw shaders, no loops except bounded sums unrolled at compile time, a term budget
// and a source cap. The CPU path evaluates the same expression for fallback images.

import { zlibSync } from 'fflate';
import type { A, IRBundle, IRExpr, IRFn } from '../ir';
import { Env, EvalError, Fun, V, compileAst, withBudget } from '../eval';
import { resolve, Type } from '../types';
import { toBase64 } from '../util/base64';

export const GFX_LIMITS = { terms: 2000, source: 64 * 1024 };

type Kind = 'f' | 'b' | 'v2' | 'v3';
interface G {
  code: string;
  kind: Kind;
  /** field names when the value is a record (vec2: two fields, vec3: r g b) */
  fields?: string[];
}

export interface CompiledPixels {
  glsl: string;
  sksl: string;
  uniforms: Record<string, number>;
  fallback?: () => string;
  terms: number;
}

class Translator {
  terms = 0;
  readonly uniforms: Record<string, number> = {};
  private readonly uniformKinds = new Map<string, G>();
  constructor(
    readonly bundle: IRBundle,
    readonly lookup: (name: string, local: boolean) => V,
  ) {}

  tick(): void {
    if (++this.terms > GFX_LIMITS.terms) throw new EvalError('mkp.gfx-terms', `a pixels expression may have at most ${GFX_LIMITS.terms} terms`);
  }

  lit(n: number): string {
    if (!Number.isFinite(n)) return Number.isNaN(n) ? '(0.0/0.0)' : n > 0 ? '1e30' : '-1e30';
    const s = String(n);
    return /[.e]/.test(s) ? s : s + '.0';
  }

  /** A value from outside the expression becomes a uniform (numbers, and 2-number records). */
  uniform(name: string, v: V): G {
    const key = 'u_' + name.replace(/[^A-Za-z0-9_]/g, '_');
    const known = this.uniformKinds.get(key);
    if (known) return known;
    let g: G;
    if (typeof v === 'number' || typeof v === 'boolean') {
      this.uniforms[key] = Number(v);
      g = { code: key, kind: 'f' };
    } else if (Array.isArray(v) && v.length === 2) {
      this.uniforms[key + '.x'] = v[0] as number;
      this.uniforms[key + '.y'] = v[1] as number;
      g = { code: key, kind: 'v2', fields: ['x', 'y'] };
    } else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 2) {
      const ks = Object.keys(v);
      this.uniforms[key + '.x'] = (v as Record<string, number>)[ks[0]];
      this.uniforms[key + '.y'] = (v as Record<string, number>)[ks[1]];
      g = { code: key, kind: 'v2', fields: ks };
    } else throw new EvalError('mkp.gfx-value', `${name} can't be used in pixels (only numbers and two-number records)`);
    this.uniformKinds.set(key, g);
    return g;
  }

  declarations(dialect: 'glsl' | 'sksl'): string {
    const f = dialect === 'glsl' ? 'float' : 'float';
    const v2 = dialect === 'glsl' ? 'vec2' : 'float2';
    return [...this.uniformKinds.entries()].map(([k, g]) => `uniform ${g.kind === 'v2' ? v2 : f} ${k};`).join('\n');
  }

  tr(a: A, locals: Map<string, G>, fnStack: string[]): G {
    this.tick();
    switch (a.t) {
      case 'num':
        return { code: this.lit(a.v), kind: 'f' };
      case 'bool':
        return { code: a.v ? 'true' : 'false', kind: 'b' };
      case 'var': {
        const l = locals.get(a.name);
        if (l) return l;
        if (a.from === 'const') return this.uniform(a.name, this.lookup(a.name, false));
        return this.uniform(a.name, this.lookup(a.name, a.from === 'local'));
      }
      case 'rec': {
        const parts = a.fields.map(([, x]) => this.tr(x, locals, fnStack));
        const names = a.fields.map(([k]) => k);
        if (parts.length === 2 && parts.every((p) => p.kind === 'f')) return { code: `vec2(${parts[0].code}, ${parts[1].code})`, kind: 'v2', fields: names };
        if (parts.length === 3 && parts.every((p) => p.kind === 'f')) {
          const order = ['r', 'g', 'b'].map((k) => names.indexOf(k));
          if (order.every((i) => i >= 0)) return { code: `vec3(${order.map((i) => parts[i].code).join(', ')})`, kind: 'v3', fields: ['r', 'g', 'b'] };
        }
        throw new EvalError('mkp.gfx-value', 'pixels only handles records of two numbers (a vec2) or {r, g, b}');
      }
      case 'point': {
        const x = this.tr(a.x, locals, fnStack);
        const y = this.tr(a.y, locals, fnStack);
        return { code: `vec2(${x.code}, ${y.code})`, kind: 'v2', fields: ['x', 'y'] };
      }
      case 'field': {
        const o = this.tr(a.o, locals, fnStack);
        if (o.kind === 'v2' || o.kind === 'v3') {
          const i = (o.fields ?? ['x', 'y', 'z']).indexOf(a.name);
          if (i < 0) throw new EvalError('mkp.gfx-value', `no field ${a.name}`);
          return { code: `(${o.code}).${'xyz'[i]}`, kind: 'f' };
        }
        throw new EvalError('mkp.gfx-value', 'field access on a number');
      }
      case 'not': {
        const x = this.tr(a.a, locals, fnStack);
        return { code: `(!${x.code})`, kind: 'b' };
      }
      case 'and':
      case 'or': {
        const x = this.tr(a.a, locals, fnStack);
        const y = this.tr(a.b, locals, fnStack);
        return { code: `(${x.code} ${a.t === 'and' ? '&&' : '||'} ${y.code})`, kind: 'b' };
      }
      case 'if': {
        const c = this.tr(a.c, locals, fnStack);
        const x = this.tr(a.a, locals, fnStack);
        const y = this.tr(a.b, locals, fnStack);
        return { code: `(${c.code} ? ${x.code} : ${y.code})`, kind: x.kind, fields: x.fields };
      }
      case 'call':
        return this.call(a.fn, a.args.map((x) => this.tr(x, locals, fnStack)), fnStack);
      case 'builtin':
        return this.builtin(a.fn, a.args, locals, fnStack);
      case 'tmpl':
      case 'str':
        throw new EvalError('mkp.gfx-value', 'text has no place in pixels');
      default:
        throw new EvalError('mkp.gfx-value', `pixels can't compile ${a.t}`);
    }
  }

  /** Declared fns and ops are inlined (recursion is not allowed in pixels). */
  call(id: string, args: G[], fnStack: string[]): G {
    if (fnStack.includes(id)) throw new EvalError('mkp.gfx-recursion', 'pixels functions may not recurse');
    const fn: IRFn | undefined = this.bundle.fns[id];
    if (!fn) throw new EvalError('mkp.gfx-value', `pixels can't call ${id}`);
    const locals = new Map<string, G>();
    fn.params.forEach((p, i) => {
      const g = args[i];
      const t = fn.types?.[i];
      if (t && g.kind === 'v2') {
        const r = resolve(t, (n) => this.bundle.types[n] ?? Object.entries(this.bundle.types).find(([k]) => k.endsWith(':' + n))?.[1]);
        if (r.t === 'rec') g.fields = r.fields.map((f) => f[0]);
      }
      locals.set(p, g);
    });
    return this.tr(fn.body, locals, [...fnStack, id]);
  }

  builtin(fn: string, argsA: A[], locals: Map<string, G>, fnStack: string[]): G {
    const MAP1: Record<string, string> = { exp: 'exp', ln: 'log', sqrt: 'sqrt', sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', abs: 'abs', floor: 'floor', ceil: 'ceil', sign: 'sign' };
    if (fn === 'sum' || fn === 'prod' || fn === 'sumT' || fn === 'prodT') {
      // bounded sums with constant bounds unroll
      const lo = this.constNum(argsA[0], locals);
      const hi = this.constNum(argsA[1], locals);
      const lam = argsA[2];
      if (lam.t !== 'lam') throw new EvalError('mkp.gfx-value', 'sum in pixels needs k => body');
      if (hi - lo + 1 > 500) throw new EvalError('mkp.gfx-terms', 'a sum in pixels may have at most 500 terms');
      const parts: G[] = [];
      for (let k = Math.ceil(lo); k <= hi; k++) {
        const l2 = new Map(locals);
        l2.set(lam.params[0], { code: this.lit(k), kind: 'f' });
        parts.push(this.tr(lam.body, l2, fnStack));
      }
      if (!parts.length) return { code: fn.startsWith('prod') ? '1.0' : '0.0', kind: 'f' };
      if (parts[0].kind === 'v2' && fn === 'sumT') return { code: `(${parts.map((p) => p.code).join(' + ')})`, kind: 'v2', fields: parts[0].fields };
      return { code: `(${parts.map((p) => p.code).join(fn.startsWith('prod') ? ' * ' : ' + ')})`, kind: 'f' };
    }
    const g = argsA.map((x) => this.tr(x, locals, fnStack));
    const [x, y, z] = g;
    if (fn in MAP1) return { code: `${MAP1[fn]}(${x.code})`, kind: 'f' };
    switch (fn) {
      case 'neg':
        return { code: `(-${x.code})`, kind: x.kind, fields: x.fields };
      case '+':
      case '-':
      case '*':
      case '/':
        return { code: `(${x.code} ${fn} ${y.code})`, kind: x.kind === 'f' ? y.kind : x.kind, fields: x.fields ?? y.fields };
      case '^':
      case 'pow':
        return { code: `mkp_pow(${x.code}, ${y.code})`, kind: 'f' };
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=':
        return { code: `(${x.code} ${fn} ${y.code})`, kind: 'b' };
      case 'atan2':
        return { code: `atan(${x.code}, ${y.code})`, kind: 'f' };
      case 'mod':
        return { code: `mod(${x.code}, ${y.code})`, kind: 'f' };
      case 'min':
      case 'max':
        return { code: `${fn}(${x.code}, ${y.code})`, kind: 'f' };
      case 'round':
        return { code: `floor(${x.code} + 0.5)`, kind: 'f' };
      case 'step':
        return { code: `step(0.0, ${x.code})`, kind: 'f' };
      case 'sinh':
        return { code: `((exp(${x.code}) - exp(-${x.code})) * 0.5)`, kind: 'f' };
      case 'cosh':
        return { code: `((exp(${x.code}) + exp(-${x.code})) * 0.5)`, kind: 'f' };
      case 'tanh':
        return { code: `mkp_tanh(${x.code})`, kind: 'f' };
      case 'log':
        return { code: `(log(${x.code}) / log(10.0))`, kind: 'f' };
      case 'rgb':
        return { code: `clamp(vec3(${x.code}, ${y.code}, ${z.code}), 0.0, 1.0)`, kind: 'v3', fields: ['r', 'g', 'b'] };
      case 'hsl':
        return { code: `mkp_hsl(${x.code}, ${y.code}, ${z.code})`, kind: 'v3', fields: ['r', 'g', 'b'] };
      case 'p+':
      case 'p-':
        return { code: `(${x.code} ${fn[1]} ${y.code})`, kind: 'v2', fields: ['x', 'y'] };
      case 'inf':
        return { code: '1e30', kind: 'f' };
      case 'nan':
        return { code: '(0.0/0.0)', kind: 'f' };
      default:
        throw new EvalError('mkp.gfx-value', `pixels can't compile ${fn}()`);
    }
  }

  constNum(a: A, locals: Map<string, G>): number {
    if (a.t === 'num') return a.v;
    if (a.t === 'builtin' && a.fn === 'neg' && a.args[0].t === 'num') return -a.args[0].v;
    if (a.t === 'var' && !locals.has(a.name)) {
      const v = this.lookup(a.name, a.from === 'local');
      if (typeof v === 'number') return v;
    }
    throw new EvalError('mkp.gfx-value', 'sum bounds in pixels must be fixed numbers');
  }
}

const PRELUDE = `float mkp_pow(float a, float b) { return a < 0.0 && floor(b) == b ? (mod(b, 2.0) == 0.0 ? pow(-a, b) : -pow(-a, b)) : pow(a, b); }
float mkp_tanh(float x) { float e = exp(2.0 * x); return (e - 1.0) / (e + 1.0); }
vec3 mkp_hsl(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + fract(h) * 12.0, 12.0);
  float a = clamp(s, 0.0, 1.0) * min(clamp(l, 0.0, 1.0), 1.0 - clamp(l, 0.0, 1.0));
  return clamp(l, 0.0, 1.0) - a * max(min(min(k - 3.0, 9.0 - k), 1.0), -1.0);
}`;

/** Compiles a pixels expression (a lambda over x and y returning {r, g, b}). */
export function compilePixels(f: IRExpr, bundle: IRBundle, inst: (name: string) => V, env: Env): CompiledPixels {
  const lam = f.ast;
  if (lam.t !== 'lam' || lam.params.length !== 2) throw new EvalError('mkp.gfx-value', 'pixels needs an expression in x and y');
  const tr = new Translator(bundle, (name, local) => (local ? env.local(name) : name.includes(':') ? env.prog.constValue(name) : inst(name)));
  const locals = new Map<string, G>([
    [lam.params[0], { code: 'mkp_p.x', kind: 'f' }],
    [lam.params[1], { code: 'mkp_p.y', kind: 'f' }],
  ]);
  const body = tr.tr(lam.body, locals, []);
  if (body.kind !== 'v3') throw new EvalError('mkp.gfx-value', 'pixels must return a colour: rgb(r, g, b) or hsl(h, s, l)');
  const decl = tr.declarations('glsl');
  const glsl = `precision highp float;\n${decl}\nuniform vec2 mkp_x;\nuniform vec2 mkp_y;\nuniform vec2 mkp_size;\n${PRELUDE}\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / mkp_size;\n  vec2 mkp_p = vec2(mix(mkp_x.x, mkp_x.y, uv.x), mix(mkp_y.x, mkp_y.y, uv.y));\n  gl_FragColor = vec4(${body.code}, 1.0);\n}\n`;
  const sk = (s: string): string => s.replace(/\bvec2\b/g, 'float2').replace(/\bvec3\b/g, 'float3');
  const sksl = sk(`${tr.declarations('sksl')}\nuniform float2 mkp_x;\nuniform float2 mkp_y;\nuniform float2 mkp_size;\n${PRELUDE}\nhalf4 main(float2 frag) {\n  float2 uv = float2(frag.x / mkp_size.x, 1.0 - frag.y / mkp_size.y);\n  float2 mkp_p = float2(mix(mkp_x.x, mkp_x.y, uv.x), mix(mkp_y.x, mkp_y.y, uv.y));\n  return half4(half3(${body.code}), 1.0);\n}\n`);
  if (glsl.length > GFX_LIMITS.source) throw new EvalError('mkp.gfx-source', 'the compiled shader is over 64 KB');
  const fn = compileAst(lam)(env) as Fun;
  return {
    glsl,
    sksl,
    uniforms: tr.uniforms,
    terms: tr.terms,
    fallback: () => pngDataUri(renderPixelsCpu(fn, [-1, 1], [-1, 1], 96, 96), 96, 96),
  };
}

/** Evaluates a pixels function on the CPU (fallback images, and providers without a GPU). */
export function renderPixelsCpu(f: Fun, xr: number[], yr: number[], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  withBudget(20_000_000, 'pixels fallback', () => {
    for (let j = 0; j < h; j++) {
      const y = yr[1] - ((yr[1] - yr[0]) * (j + 0.5)) / h;
      for (let i = 0; i < w; i++) {
        const x = xr[0] + ((xr[1] - xr[0]) * (i + 0.5)) / w;
        const c = f(x, y) as Record<string, number>;
        const o = (j * w + i) * 4;
        out[o] = Math.round(255 * clamp(c.r));
        out[o + 1] = Math.round(255 * clamp(c.g));
        out[o + 2] = Math.round(255 * clamp(c.b));
        out[o + 3] = 255;
      }
    }
  });
  return out;
}

function clamp(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** z = f(x, y) on an n×n grid. */
export function sampleMesh(f: Fun, xr: number[], yr: number[], n: number): number[][] {
  const z: number[][] = [];
  for (let j = 0; j <= n; j++) {
    const row: number[] = [];
    const y = yr[0] + ((yr[1] - yr[0]) * j) / n;
    for (let i = 0; i <= n; i++) {
      const x = xr[0] + ((xr[1] - xr[0]) * i) / n;
      const v = f(x, y) as number;
      row.push(Number.isFinite(v) ? v : 0);
    }
    z.push(row);
  }
  return z;
}

// ---------------------------------------------------------------------------------------------
// PNG encoding (fallback images, the Markdown `images` toggle)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const idat = zlibSync(raw, { level: 9 });
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

export function pngDataUri(rgba: Uint8Array, w: number, h: number): string {
  return 'data:image/png;base64,' + toBase64(encodePng(rgba, w, h));
}

export type { Type };
