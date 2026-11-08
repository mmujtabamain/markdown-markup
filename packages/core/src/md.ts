// The Markdown writer (spec 14): from the IR, with toggles gfm, math, mermaid, html and images.
// Only base widgets need projections; every derived widget gets one for free through its view,
// plus its summary and any `project md` / `project mermaid` of its own.

import type { IRBundle } from './ir';
import { Runtime, type Inst, type MathsRenderer } from './runtime/runtime';
import type { VNode, VRun, VShape } from './runtime/view';
import { Env } from './eval';
import { TokenTable } from './tokens';
import { renderPixelsCpu, pngDataUri } from './gfx/compile';
import { fmtNum } from './eval';

export type MdToggle = 'gfm' | 'math' | 'mermaid' | 'html' | 'images';

export interface MdOptions {
  /** false: answers are left out (GAPS 166) — `answers` reads false, and a widget with answer
   * inputs and no project md writes only its summary */
  answers?: boolean;
  toggles?: MdToggle[];
  maths?: MathsRenderer;
  /** the base name for image files (images toggle) */
  imageBase?: string;
}

export interface MdResult {
  md: string;
  /** image files the Markdown refers to (name → SVG text) */
  files: Map<string, string>;
}

const ALERT_TITLE: Record<string, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

export function writeMarkdown(b: IRBundle, opts: MdOptions = {}): MdResult {
  const t = new Set(opts.toggles ?? []);
  // the images toggle draws gfx content from its CPU fallback; otherwise no fallback is needed
  const answers = opts.answers !== false;
  const rt = new Runtime(b, { snapshot: true, maths: opts.maths, now: () => 0, capabilities: t.has('images') ? ['core@1'] : ['core@1', 'gfx@1'], answers });
  const tokens = new TokenTable(b.tokens);
  const files = new Map<string, string>();
  let imageNo = 0;
  const base = opts.imageBase ?? (b.doc.file.replace(/^.*\//, '').replace(/\.mkp\.md$|\.md$|#.*$/g, '') || 'figure');

  const mathInline = (tex: string): string => (t.has('math') ? `$${tex}$` : '`' + tex + '`');
  const inline = (runs: VRun[]): string =>
    runs
      .map((r) => {
        switch (r.t) {
          case 'text': {
            let s = escape(r.v);
            if (r.b) s = `**${s}**`;
            if (r.i) s = `*${s}*`;
            if (r.s) s = t.has('gfm') ? `~~${s}~~` : s;
            if (r.href) s = `[${s}](${r.href})`;
            return s;
          }
          case 'code':
            return r.href ? `[\`${r.v}\`](${r.href})` : '`' + r.v + '`';
          case 'math':
            return r.display ? `\n\n${mathDisplay(r.tex)}\n\n` : mathInline(r.tex);
          case 'br':
            return '  \n';
          case 'img':
            return `![${r.alt}](${r.src})`;
          case 'fnref':
            return `[^${r.label}]`;
        }
      })
      .join('');
  const mathDisplay = (tex: string): string => (t.has('math') ? `$$\n${tex}\n$$` : '```tex\n' + tex + '\n```');

  // a widget's hidden and conditional content goes in <details> (html) or after the visible content
  const later: string[][] = [];

  const blocks = (nodes: VNode[] | undefined): string[] => {
    const out: string[] = [];
    for (const n of nodes ?? []) {
      const s = block(n);
      if (s === null) continue;
      if (n.hidden || n.p.$cond) {
        const label = n.hidden ? 'Revealed later' : 'Shown when it applies';
        if (t.has('html')) out.push(`<details>\n<summary>${label}</summary>\n\n${s}\n\n</details>`);
        else if (later.length) later[later.length - 1].push(`*${label}:*\n\n${s}`);
        else out.push(`*${label}:*\n\n${s}`);
        continue;
      }
      if (s) out.push(s);
    }
    return out;
  };

  const inlineRow = (nodes: VNode[] | undefined): string | null => {
    // a row of small things (text, buttons, fields) reads best on one line
    const parts: string[] = [];
    for (const n of nodes ?? []) {
      if (n.hidden || n.p.$cond) return null;
      if (n.t === 'text') parts.push(inline(n.p.runs as VRun[]));
      else if (n.t === 'press') parts.push(`[${plain(n)}]`);
      else if (n.t === 'field') parts.push('[ ____ ]');
      else if (n.t === 'range') parts.push(`[${fmt(n.p.value)}]`);
      else return null;
    }
    return parts.join(' ');
  };

  const block = (n: VNode): string | null => {
    const p = n.p;
    if (n.ext) return extern(n);
    switch (n.t) {
      case 'paragraph':
        return inline(p.runs as VRun[]);
      case 'heading':
        return `${'#'.repeat(Number(p.level) || 2)} ${inline(p.runs as VRun[])}`;
      case 'divider':
        return '---';
      case 'code': {
        const src = String(p.src);
        const fence = src.includes('```') ? '````' : '```';
        return `${fence}${String(p.lang || '')}\n${src}\n${fence}`;
      }
      case 'math':
        return mathDisplay(String(p.tex));
      case 'quote': {
        const alert = String(p.alert ?? 'none');
        const body = blocks(n.kids).join('\n\n');
        const head = alert !== 'none' ? (t.has('gfm') ? `[!${alert.toUpperCase()}]` : `**${ALERT_TITLE[alert] ?? alert}:**`) : '';
        const text = head ? `${head}\n${body}` : body;
        return text
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n');
      }
      case 'list': {
        const ordered = !!p.ordered;
        let k = Number(p.start) || 1;
        return (n.kids ?? [])
          .map((it) => {
            const mark = ordered ? `${k++}.` : '-';
            const box = it.p.checked === 'yes' ? (t.has('gfm') ? '[x] ' : '(done) ') : it.p.checked === 'no' ? (t.has('gfm') ? '[ ] ' : '') : '';
            const body = blocks(it.kids).join('\n\n');
            return `${mark} ${box}${indent(body, mark.length + 1).trimStart()}`;
          })
          .join('\n');
      }
      case 'table': {
        const head = (p.head as VRun[][]).map((c) => inline(c));
        const rows = (p.rows as VRun[][][]).map((r) => r.map((c) => inline(c)));
        if (t.has('gfm')) {
          const align = (p.align as string[]) ?? [];
          const sep = head.map((_, i) => (align[i] === 'center' ? ':---:' : align[i] === 'right' ? '---:' : align[i] === 'left' ? ':---' : '---'));
          return [head, sep, ...rows].map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');
        }
        // tables as text
        return [head, ...rows].map((r) => r.join(' · ')).join('  \n');
      }
      case 'footnote':
        return `[^${String(p.label)}]: ${blocks(n.kids).join('\n\n    ')}`;
      case 'scope':
        return scope(n);
      case 'error':
        return `*${escape(String(p.summary || p.name))}* (${escape(String(p.message))})`;
      case 'bar':
        return controls(n);
      case 'frame': {
        const title = inline(p.title as VRun[]);
        const head = [p.kind ? `*${escape(String(p.kind))}*` : '', title ? `**${title}**` : ''].filter(Boolean).join(' ');
        const bar = n.slots?.bar?.length ? controls({ ...n, kids: n.slots.bar }) : '';
        return [head, ...blocks(n.kids), ...blocks(n.slots?.details), bar].filter(Boolean).join('\n\n');
      }
      case 'pane': {
        const head = inline(p.title as VRun[]);
        return [head ? `**${head}**` : '', ...blocks(n.kids), ...blocks(n.slots?.footer)].filter(Boolean).join('\n\n');
      }
      case 'icon':
        return p.label ? escape(String(p.label)) : null;
      case 'column':
      case 'grid':
      case 'stack':
        return blocks(n.kids).join('\n\n');
      case 'row':
        if (p.role === 'control' || p.role === 'radiogroup' || p.role === 'group') return controls({ ...n, kids: [n] } as VNode);
        return inlineRow(n.kids) ?? blocks(n.kids).join('\n\n');
      case 'text':
        return inline(p.runs as VRun[]);
      case 'image':
        return `![${escape(String(p.alt))}](${String(p.src)})`;
      case 'press':
        return p.$cond ? null : `[${plain(n)}]`;
      case 'field':
        return '[ ____ ]';
      case 'range':
        return `[${fmt(p.value)}]`;
      case 'meter':
        return `[${Math.round((Number(p.value) / Number(p.max)) * 100)}%]`;
      case 'overlay':
        return [`[${plain(n)}]`, ...blocks(n.body)].join('\n\n');
      case 'canvas':
        return canvas(n);
      case 'cases': {
        const style = String(p.style);
        if (style === 'steps') return (n.kids ?? []).map((c, i) => `${i + 1}. ${indent(blocks(c.kids).join('\n\n'), 3).trimStart()}`).join('\n');
        return (n.kids ?? []).map((c) => `**${escape(String(c.p.label))}**\n\n${blocks(c.kids).join('\n\n')}`).join('\n\n');
      }
      default:
        return blocks(n.kids).join('\n\n');
    }
  };

  const plain = (n: VNode): string => {
    const parts: string[] = [];
    const walk = (x: VNode): void => {
      if (x.t === 'text') parts.push(inline(x.p.runs as VRun[]));
      for (const k of x.kids ?? []) walk(k);
    };
    walk(n);
    return parts.join(' ').trim() || String(n.p.label ?? 'button');
  };

  const controls = (n: VNode): string => {
    const lines: string[] = [];
    for (const c of n.kids ?? []) {
      const label = (c.kids ?? []).find((k) => k.t === 'text' && k.key.endsWith('.label'));
      const range = (c.kids ?? []).find((k) => k.t === 'range');
      if (range) {
        const rp = range.p;
        lines.push(`- **${escape(String(rp.label))}:** ${fmt(rp.value)} (from ${fmt(rp.min)} to ${fmt(rp.max)})`);
      } else if (c.t === 'press') lines.push(`- **${escape(String(c.p.label))}:** ${c.p.selected ? 'on' : 'off'}`);
      else if (c.p.role === 'radiogroup') lines.push(`- **${escape(String(c.p.label))}:** ${(c.kids ?? []).filter((k) => k.t === 'press').map((k) => (k.p.selected ? `**${String(k.p.label)}**` : String(k.p.label))).join(' / ')}`);
      else if (c.p.role === 'group') lines.push(`- **${escape(String(c.p.label))}:** ${plain((c.kids ?? []).find((k) => k.t === 'text') ?? c)}`);
      else if (label) lines.push(`- ${plain(label)}`);
    }
    return lines.join('\n');
  };

  const scope = (n: VNode): string => {
    const inst = rt.instanceAt(n.key);
    const def = inst?.def;
    const out: string[] = [];
    // a summary is Markdown already (with $…$ maths): kept as written
    if (n.p.summary) out.push(`*${String(n.p.summary).trim()}*`);
    const projected = projection(inst);
    if (projected !== null) {
      out.push(projected);
      return out.join('\n\n');
    }
    // without answers, a widget that holds one and says nothing of its own writes its summary only
    if (!answers && def?.inputs.some((i) => i.answer)) return out.join('\n\n');
    later.push([]);
    out.push(...blocks(n.kids));
    const after = later.pop()!;
    out.push(...after);
    return out.filter(Boolean).join('\n\n');
  };

  /** What a widget's project says it is in Markdown (mermaid where that is on), or null if it says nothing. */
  const projection = (inst: Inst | undefined): string | null => {
    const project = inst?.def.project;
    if (project?.mermaid && t.has('mermaid')) return '```mermaid\n' + String(rt.evalExpr(project.mermaid, inst!.env as Env, inst!)) + '\n```';
    if (project?.md) return details(String(rt.evalExpr(project.md, inst!.env as Env, inst!)));
    return null;
  };

  /**
   * A pack's extern, drawn by a host: its summary, then its project md, or what it holds (each
   * record's content under the record's first text field, as a slot chosen by state is written).
   */
  const extern = (n: VNode): string => {
    const out: string[] = [];
    if (n.summary) out.push(`*${n.summary.trim()}*`);
    const projected = projection(rt.externAt(n.key));
    if (projected !== null) return [...out, projected].join('\n\n');
    out.push(...blocks(n.kids));
    for (const [name, list] of Object.entries(n.recs ?? {}))
      list.forEach((kids, i) => {
        const rec = ((n.p[name] as Record<string, unknown>[] | undefined) ?? [])[i] ?? {};
        const title = Object.values(rec).find((v) => typeof v === 'string');
        const body = blocks(kids).join('\n\n');
        out.push(title === undefined ? body : `**${escape(String(title))}**${body ? `\n\n${body}` : ''}`);
      });
    for (const s of Object.values(n.slots ?? {})) out.push(...blocks(s));
    return out.filter(Boolean).join('\n\n');
  };

  /** :::details "Title" … ::: in a projection: <details> with html, a titled block without. */
  const details = (s: string): string =>
    s.replace(/^:::details[ \t]*"?([^"\n]*)"?\n([\s\S]*?)\n:::[ \t]*$/gm, (_m, title: string, body: string) => (t.has('html') ? `<details>\n<summary>${title || 'Details'}</summary>\n\n${body}\n\n</details>` : `**${title || 'Details'}:**\n\n${body}`));

  const canvas = (n: VNode): string => {
    const label = String(n.p.label || 'figure');
    if (!t.has('images')) return `*[${escape(label)}]*`;
    const name = `${base}-${++imageNo}.svg`;
    files.set(name, canvasSvg(n, tokens));
    return `![${escape(label)}](${name})`;
  };

  const body = blocks(rt.view()).join('\n\n');
  const header = `<!-- generated by mkp from ${b.doc.file}${b.doc.digest ? ` (${b.doc.digest})` : ''} -->`;
  return { md: `${header}\n\n${body.replace(/\n{3,}/g, '\n\n').trim()}\n`, files };
}

function fmt(v: unknown): string {
  return typeof v === 'number' ? fmtNum(v) : String(v);
}

function escape(s: string): string {
  return s.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((l, i) => (i && l ? pad + l : l))
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// A canvas as standalone SVG (the images toggle): a 2D canvas serialises straight to SVG.

export function canvasSvg(n: VNode, tokens: TokenTable, W = 320): string {
  const p = n.p;
  const x = (p.x as number[]) ?? [-1, 1];
  const y = (p.y as number[]) ?? [-1, 1];
  const aspect = Number(p.aspect) > 0 ? Number(p.aspect) : (x[1] - x[0]) / (y[1] - y[0]) || 1;
  const H = Math.round(W / aspect);
  const X = (v: number): number => ((v - x[0]) / (x[1] - x[0])) * W;
  const Y = (v: number): number => H - ((v - y[0]) / (y[1] - y[0])) * H;
  const unit = W / (x[1] - x[0]);
  const col = (c: string): string => (c && c !== 'none' ? tokens.color(c) ?? c : 'none');
  const f = (v: number): string => v.toFixed(2);
  const parts: string[] = [];
  const shape = (s: VShape): void => {
    switch (s.t) {
      case 'circle':
        parts.push(`<circle cx="${f(X(s.c[0]))}" cy="${f(Y(s.c[1]))}" r="${f(Math.max(0.5, s.px ? s.px : s.r * unit))}" fill="${col(s.fill)}" stroke="${col(s.stroke)}" stroke-width="${s.width}"${s.opacity !== undefined ? ` opacity="${s.opacity}"` : ''}/>`);
        break;
      case 'path':
        if (s.pts.length) parts.push(`<path d="${s.pts.map((q, i) => `${i ? 'L' : 'M'}${f(X(q[0]))},${f(Y(q[1]))}`).join(' ')}${s.closed ? ' Z' : ''}" fill="${col(s.fill)}" stroke="${col(s.stroke)}" stroke-width="${s.width}"${s.dash ? ' stroke-dasharray="5 4"' : ''}${s.opacity !== undefined ? ` opacity="${s.opacity}"` : ''}/>`);
        break;
      case 'label': {
        const maths = s.runs.find((r) => r.t === 'math' && 'svg' in r && r.svg) as { svg?: string; w?: number; h?: number } | undefined;
        if (maths?.svg) {
          const w = (maths.w ?? 2) * 8;
          const h = (maths.h ?? 2) * 8;
          parts.push(`<g transform="translate(${f(X(s.at[0]) - w / 2)},${f(Y(s.at[1]) - h / 2)})" color="${col(s.tone)}">${maths.svg.replace(/<svg /, `<svg width="${f(w)}" height="${f(h)}" `).replace(/width="[\d.]+ex"|height="[\d.]+ex"/g, '')}</g>`);
        } else {
          const text = s.runs.map((r) => (r.t === 'text' || r.t === 'code' ? r.v : r.t === 'math' ? r.tex : '')).join('');
          parts.push(`<text x="${f(X(s.at[0]))}" y="${f(Y(s.at[1]))}" fill="${col(s.tone)}" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle">${xmlEscape(text)}</text>`);
        }
        break;
      }
      case 'handle':
        parts.push(`<circle cx="${f(X(s.at[0]))}" cy="${f(Y(s.at[1]))}" r="6" fill="${col(s.tone)}"/>`);
        break;
      case 'pixels':
        if (s.fallback) parts.push(`<image href="${s.fallback}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`);
        break;
      case 'mesh': {
        // a wireframe from a fixed camera
        const N = s.n;
        const pr = (i: number, j: number): [number, number] => {
          const u = i / N - 0.5;
          const v = j / N - 0.5;
          const z = s.z[j][i];
          return [W / 2 + (u - v) * W * 0.6, H * 0.6 - (u + v) * H * 0.25 - z * H * 0.15];
        };
        for (let j = 0; j <= N; j += Math.max(1, Math.round(N / 20))) parts.push(`<path d="${Array.from({ length: N + 1 }, (_, i) => `${i ? 'L' : 'M'}${pr(i, j).map(f).join(',')}`).join(' ')}" fill="none" stroke="${col(s.fill)}" stroke-width="0.8"/>`);
        for (let i = 0; i <= N; i += Math.max(1, Math.round(N / 20))) parts.push(`<path d="${Array.from({ length: N + 1 }, (_, j) => `${j ? 'L' : 'M'}${pr(i, j).map(f).join(',')}`).join(' ')}" fill="none" stroke="${col(s.fill)}" stroke-width="0.8"/>`);
        break;
      }
      default:
        break;
    }
  };
  let clips = 0;
  for (const l of n.layers ?? []) {
    if (l.clip) {
      const id = `c${clips++}`;
      parts.push(`<clipPath id="${id}"><rect x="${f(X(l.clip[0]))}" y="${f(Y(l.clip[3]))}" width="${f(X(l.clip[2]) - X(l.clip[0]))}" height="${f(Y(l.clip[1]) - Y(l.clip[3]))}"/></clipPath>`);
      parts.push(`<g opacity="${l.opacity}" clip-path="url(#${id})">`);
    } else parts.push(`<g opacity="${l.opacity}">`);
    l.shapes.forEach(shape);
    parts.push('</g>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="${col('surface')}"/>${parts.join('')}</svg>`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { renderPixelsCpu, pngDataUri };
