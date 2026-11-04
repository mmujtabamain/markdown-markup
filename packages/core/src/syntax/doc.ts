// Documents (.mkp.md, spec 5): front matter, widget blocks, containers, attributes and Markdown.

import { Diagnostics } from '../diag';

export type DocItem =
  | { k: 'md'; text: string; line: number; attrs?: DocAttrs }
  | { k: 'block'; name: string; id?: string; yaml: string; line: number; attrs?: DocAttrs; info: string; fence: string }
  | { k: 'state'; body: string; line: number }
  | { k: 'container'; name: string; args: string; colons: number; items: DocItem[]; line: number; attrs?: DocAttrs };

export interface DocAttrs {
  id?: string;
  props: Record<string, string>;
  line: number;
}

export interface DocSyn {
  file: string;
  front: string | null;
  frontLine: number;
  items: DocItem[];
}

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*(.*)$/;
const WIDGET_INFO_RE = /^([A-Za-z_][A-Za-z0-9_.:-]*(?:@\d+)?)(?:\s+#([A-Za-z0-9_-]+))?\s*$/;
const CONTAINER_OPEN_RE = /^(:{3,})([A-Za-z_][A-Za-z0-9_.:-]*(?:@\d+)?)(?:\s+(.*))?$/;
const CONTAINER_CLOSE_RE = /^(:{3,})\s*$/;
const ATTR_RE = /^\{(.*)\}\s*$/;

export function parseDoc(src: string, file: string, diags: Diagnostics): DocSyn {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let front: string | null = null;
  let start = 0;
  let frontLine = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    const end2 = lines.indexOf('...', 1);
    const close = end < 0 ? end2 : end2 < 0 ? end : Math.min(end, end2);
    if (close < 0) diags.error('mkp.front-matter', 'the front matter is never closed with ---', { file, line: 1, col: 1 });
    else {
      front = lines.slice(1, close).join('\n');
      frontLine = 2;
      start = close + 1;
    }
  }
  const { items } = parseItems(lines, start, lines.length, 0, file, diags);
  return { file, front, frontLine, items };
}

function parseItems(lines: string[], from: number, to: number, colons: number, file: string, diags: Diagnostics): { items: DocItem[]; end: number } {
  const items: DocItem[] = [];
  let md: string[] = [];
  let mdLine = from + 1;
  const flush = (): void => {
    if (md.some((l) => l.trim())) items.push({ k: 'md', text: md.join('\n'), line: mdLine });
    md = [];
  };
  let i = from;
  while (i < to) {
    const line = lines[i];
    // fenced blocks: widget blocks, state blocks, or plain code (kept as Markdown)
    const f = FENCE_RE.exec(line);
    if (f) {
      const fence = f[2];
      const info = f[3].trim();
      let j = i + 1;
      while (j < to && !(lines[j].trim().startsWith(fence[0].repeat(fence.length)) && lines[j].trim().replace(new RegExp(`^${fence[0] === '`' ? '`' : '~'}+`), '').trim() === '')) j++;
      const body = lines.slice(i + 1, j).join('\n');
      const wm = WIDGET_INFO_RE.exec(info);
      if (info === 'state') {
        flush();
        items.push({ k: 'state', body, line: i + 1 });
        i = j + 1;
        mdLine = i + 1;
        continue;
      }
      if (wm && !f[1]) {
        flush();
        items.push({ k: 'block', name: wm[1], id: wm[2], yaml: body, line: i + 1, info, fence: lines.slice(i, Math.min(j + 1, to)).join('\n') });
        i = j + 1;
        mdLine = i + 1;
        continue;
      }
      if (!md.length) mdLine = i + 1;
      md.push(...lines.slice(i, Math.min(j + 1, to)));
      i = j + 1;
      continue;
    }
    const co = CONTAINER_OPEN_RE.exec(line);
    if (co) {
      flush();
      const n = co[1].length;
      // find the matching close: a line of exactly n colons at this nesting
      let depth = 0;
      let j = i + 1;
      for (; j < to; j++) {
        const l = lines[j];
        const o2 = CONTAINER_OPEN_RE.exec(l);
        if (o2 && o2[1].length === n) depth++;
        const c2 = CONTAINER_CLOSE_RE.exec(l);
        if (c2 && c2[1].length === n) {
          if (depth === 0) break;
          depth--;
        }
      }
      if (j >= to) diags.error('mkp.container', `the container :::${co[2]} is never closed with ${':'.repeat(n)}`, { file, line: i + 1, col: 1 });
      const inner = parseItems(lines, i + 1, Math.min(j, to), n, file, diags);
      items.push({ k: 'container', name: co[2], args: (co[3] ?? '').trim(), colons: n, items: inner.items, line: i + 1 });
      i = j + 1;
      mdLine = i + 1;
      continue;
    }
    const at = ATTR_RE.exec(line.trim());
    if (at && (md.length === 0 || md[md.length - 1].trim() !== '') && /^\s*(#[A-Za-z0-9_-]+|[A-Za-z_][A-Za-z0-9_]*=)/.test(at[1])) {
      const attrs = parseAttrs(at[1], i + 1);
      if (md.some((l) => l.trim())) {
        flush();
        (items[items.length - 1] as { attrs?: DocAttrs }).attrs = attrs;
      } else if (items.length) {
        const last = items[items.length - 1];
        if (last.k !== 'state') last.attrs = attrs;
      } else diags.warn('mkp.attrs-orphan', 'attributes must follow a block', { file, line: i + 1, col: 1 });
      i++;
      mdLine = i + 1;
      continue;
    }
    if (!md.length) mdLine = i + 1;
    md.push(line);
    i++;
  }
  flush();
  void colons;
  return { items, end: to };
}

function parseAttrs(s: string, line: number): DocAttrs {
  const out: DocAttrs = { props: {}, line };
  const re = /#([A-Za-z0-9_-]+)|([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) out.id = m[1];
    else out.props[m[2]] = m[3];
  }
  return out;
}
