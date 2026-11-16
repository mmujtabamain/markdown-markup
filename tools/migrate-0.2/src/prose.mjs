// A 0.2 document's body (doc.body: Markdown blocks as base-widget nodes, widget blocks, containers)
// as 0.3 prose. 0.2's IR keeps each paragraph's inline Markdown as written, so prose passes through
// with only what 0.3 reads differently escaped: a line starting with @, a line holding only }, and
// \{, which 0.3 reads as a hole.

import { E, P } from './tree.mjs';
import { Unsupported } from './context.mjs';
import { value, scopeOf } from './values.mjs';

/**
 * Inline Markdown written for 0.2, as 0.3 prose text. Code spans are literal in both. In 0.3 text,
 * `\{` opens a hole, so CommonMark's escaped brace becomes a plain one; in maths, `\{` reaches TeX
 * as `\\{`. A line that starts with `@` and one that holds only `}` are MKP in 0.3, so they are escaped.
 */
export function inlineProse(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let lineStart = true;
  while (i < n) {
    if (lineStart) {
      lineStart = false;
      const m = /^( {0,3})(@|\}[ \t]*(?:\n|$))/.exec(text.slice(i));
      if (m) {
        out += m[1] + '\\';
        i += m[1].length;
      }
    }
    const c = text[i];
    if (c === '\n') {
      out += c;
      i++;
      lineStart = true;
      continue;
    }
    if (c === '`') {
      // a code span: the same run of backticks closes it; with none, the backticks are text
      const run = /^`+/.exec(text.slice(i))[0];
      const close = text.indexOf(run, i + run.length);
      let end = close;
      while (end !== -1 && text[end + run.length] === '`') end = text.indexOf(run, end + 1);
      if (end !== -1) {
        out += text.slice(i, end + run.length);
        i = end + run.length;
        continue;
      }
      out += run;
      i += run.length;
      continue;
    }
    if (c === '\\') {
      const d = text[i + 1];
      if (d === '{') {
        out += '{';
        i += 2;
        continue;
      }
      if (d === undefined || d === '\n') {
        // a hard break (a backslash at the end of a line): the line break is read on its own
        out += c;
        i++;
        continue;
      }
      out += c + d;
      i += 2;
      continue;
    }
    if (c === '$' && text[i + 1] !== '$' && text[i + 1] && !/\s/.test(text[i + 1])) {
      // inline maths, paired as 0.3 pairs it: the next $ on the line after a non-space, not before a digit
      let j = i + 1;
      let close = -1;
      for (; j < n && text[j] !== '\n'; j++) {
        if (text[j] === '\\') {
          j++;
          continue;
        }
        if (text[j] === '$' && !/\s/.test(text[j - 1]) && !/\d/.test(text[j + 1] ?? '')) {
          close = j;
          break;
        }
      }
      if (close !== -1) {
        out += '$' + tex(text.slice(i + 1, close)) + '$';
        i = close + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** TeX for 0.3: `\{` (TeX's brace) is written `\\{`, since `\{` is a hole. */
export function tex(s) {
  return s.replace(/(^|[^\\])((?:\\\\)*)\\\{/g, '$1$2\\\\{');
}

/** The document's body as prose nodes. `widgets` writes widget blocks (migrate.mjs). */
export class ProseWriter {
  constructor(m, widgets) {
    this.m = m;
    this.widgets = widgets;
  }

  blocks(nodes) {
    return nodes.flatMap((n) => this.block(n));
  }

  /** Markdown text of a run of Markdown-only nodes (for lists and quotes), or null if one is a widget. */
  mdOf(nodes) {
    const parts = [];
    for (const n of nodes) {
      const p = this.block(n);
      if (p.some((x) => x.k !== 'md')) return null;
      parts.push(...p.map((x) => x.text));
    }
    return parts.join('\n\n');
  }

  block(n) {
    const m = this.m;
    const p = n.props ?? {};
    const line = n.pos?.[0];
    switch (n.node) {
      case 'paragraph':
        return [P.md(inlineProse(p.text?.text ?? ''))];
      case 'heading':
        return [P.md(`${'#'.repeat(p.level?.lit ?? 2)} ${inlineProse(p.text?.text ?? '')}`)];
      case 'divider':
        return [P.md('---')];
      case 'code': {
        const src = p.src?.text ?? '';
        let fence = '```';
        while (src.includes(fence)) fence += '`';
        return [P.md(`${fence}${p.lang?.text ?? ''}\n${src}\n${fence}`)];
      }
      case 'math':
        return [P.md(`$$\n${tex(p.tex?.tex ?? '')}\n$$`)];
      case 'quote': {
        const alert = p.alert?.lit;
        if (alert && alert !== 'none') m.lossy(line, `a GitHub alert (> [!${alert.toUpperCase()}]) is a plain quote in 0.3; its [!${alert.toUpperCase()}] line is kept as text`);
        const body = this.mdOf(n.children ?? []);
        if (body === null) throw new Unsupported('a quote holding a widget');
        const text = alert && alert !== 'none' ? `[!${alert.toUpperCase()}]\n${body}` : body;
        return [P.md(text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'))];
      }
      case 'list': {
        const ordered = !!p.ordered?.lit;
        let k = Number(p.start?.lit ?? 1);
        const items = [];
        let loose = false;
        for (const it of n.records ?? []) {
          const mark = ordered ? `${k++}.` : '-';
          const checked = it.props?.checked?.lit;
          const box = checked === 'yes' ? '[x] ' : checked === 'no' ? '[ ] ' : '';
          const body = this.mdOf(it.children ?? []);
          if (body === null) throw new Unsupported('a list item holding a widget');
          if ((it.children ?? []).length > 1) loose = true;
          const pad = ' '.repeat(mark.length + 1);
          items.push(`${mark} ${box}${body.split('\n').map((l, i) => (i && l ? pad + l : l)).join('\n')}`);
        }
        return [P.md(items.join(loose ? '\n\n' : '\n'))];
      }
      case 'table': {
        const head = p.head?.lit ?? [];
        const rows = p.rows?.lit ?? [];
        const align = p.align?.lit ?? [];
        const sep = head.map((_, i) => (align[i] === 'center' ? ':---:' : align[i] === 'right' ? '---:' : align[i] === 'left' ? ':---' : '---'));
        const row = (r) => `| ${r.map((c) => inlineProse(c)).join(' | ')} |`;
        return [P.md([row(head), `| ${sep.join(' | ')} |`, ...rows.map(row)].join('\n'))];
      }
      case 'footnote': {
        const body = this.mdOf(n.children ?? []);
        if (body === null) throw new Unsupported('a footnote holding a widget');
        return [P.md(`[^${p.label?.text}]: ${body.split('\n').join('\n    ')}`)];
      }
    }
    return this.widgets(n);
  }
}

/** A value for a widget input, at the document level: a literal, or an expression of literals. */
export function docValue(m, v, t02, at) {
  return value(m, v, t02, at, scopeOf());
}

/**
 * A fallback for a block that can't be migrated: its content as Markdown, readable without MKP:
 * its summary, then its inputs as YAML in a code block. It is marked with a TODO in the header.
 */
export function fallbackBlock(m, n, why, blocks = () => []) {
  const name = n.node;
  const lines = [];
  const summary = n.meta?.summary;
  lines.push(P.md(`**${name}**${summary ? `: ${inlineProse(summary)}` : ''}`));
  const data = {};
  for (const [k, v] of Object.entries(n.props ?? {})) data[k] = plain(v);
  for (const r of n.records ?? []) (data[r.input] ??= []).push(Object.fromEntries(Object.entries(r.props ?? {}).map(([k, v]) => [k, plain(v)])));
  if (Object.keys(data).length) lines.push(P.md('```yaml\n' + yaml(data) + '\n```'));
  // what it held stays as prose: its content, and each record's content under its first field
  for (const r of n.records ?? []) {
    if (!r.children?.length) continue;
    const title = Object.values(r.props ?? {}).map(plain).find((x) => typeof x === 'string' && x);
    if (title) lines.push(P.md(`**${inlineProse(title)}**`));
    lines.push(...blocks(r.children));
  }
  for (const ns of Object.values(n.fills ?? {})) lines.push(...blocks(ns));
  if (n.children?.length) lines.push(...blocks(n.children));
  m.fallback(n.pos?.[0], `the ${name} block was kept as Markdown (its summary, its inputs as YAML, and what it held): ${why}`);
  return lines;
}

function plain(v) {
  if (!v || typeof v !== 'object') return v;
  if ('lit' in v) return v.lit;
  if ('text' in v) return v.text;
  if ('tok' in v) return v.tok;
  if ('tex' in v) return v.tex;
  if ('expr' in v) return v.expr;
  if ('ref' in v) return `ref ${v.ref}`;
  if ('ms' in v) return `${v.ms}ms`;
  return JSON.stringify(v);
}

function yaml(v, ind = '') {
  if (Array.isArray(v)) return v.map((x) => `${ind}- ${x && typeof x === 'object' && !Array.isArray(x) ? `{${Object.entries(x).map(([k, y]) => `${k}: ${JSON.stringify(y)}`).join(', ')}}` : JSON.stringify(x)}`).join('\n');
  return Object.entries(v)
    .map(([k, x]) => (Array.isArray(x) && x.some((y) => y && typeof y === 'object') ? `${ind}${k}:\n${yaml(x, ind + '  ')}` : `${ind}${k}: ${JSON.stringify(x)}`))
    .join('\n');
}
