// Markdown in and out of the IR's base Markdown widgets (spec 5, 8): block conversion through
// mdast, and inline runs (text, emphasis, code, links, inline maths) for renderers.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { IRNode } from './ir';

type MdNode = { type: string; children?: MdNode[]; value?: string; position?: { start: { line: number; column: number; offset?: number }; end: { offset?: number } }; [k: string]: unknown };

function parse(src: string): MdNode {
  return fromMarkdown(src, {
    extensions: [gfmTable(), gfmStrikethrough(), gfmTaskListItem(), gfmFootnote(), math()],
    mdastExtensions: [gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown(), gfmTaskListItemFromMarkdown(), gfmFootnoteFromMarkdown(), mathFromMarkdown()],
  }) as unknown as MdNode;
}

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

export interface MdWarning {
  line: number;
  message: string;
}

/** Converts a Markdown chunk to base-widget IR nodes. `line0` is the chunk's first line in its file. */
export function markdownToNodes(src: string, line0 = 1, warnings: MdWarning[] = []): IRNode[] {
  const root = parse(src);
  const slice = (n: MdNode): string => src.slice(n.position!.start.offset!, n.position!.end.offset!);
  const posOf = (n: MdNode): [number, number] => [line0 + n.position!.start.line - 1, n.position!.start.column];
  const inline = (n: MdNode): string => {
    const kids = n.children ?? [];
    if (!kids.length) return '';
    // continuation lines keep their container markers in the source (a quote's "> ", a list
    // item's indent); Markdown drops them, so the text does too
    return src.slice(kids[0].position!.start.offset!, kids[kids.length - 1].position!.end.offset!).replace(/\n[ \t]*(?:>[ \t]?)*/g, '\n');
  };
  const conv = (n: MdNode): IRNode[] => {
    const p = posOf(n);
    switch (n.type) {
      case 'heading':
        return [{ node: 'heading', def: 'core:heading@1', props: { level: { lit: n.depth as number }, text: { text: inline(n) } }, pos: p }];
      case 'paragraph': {
        // a paragraph that is only $$…$$ is a display formula, as GitHub draws it
        const only = n.children?.length === 1 && n.children[0].type === 'inlineMath' ? n.children[0] : null;
        const raw = inline(n).trim();
        if (only && /^\$\$[\s\S]*\$\$$/.test(raw)) return [{ node: 'math', def: 'core:math@1', props: { tex: { tex: only.value ?? '', display: true } }, pos: p }];
        return [{ node: 'paragraph', def: 'core:paragraph@1', props: { text: { text: inline(n) } }, pos: p }];
      }
      case 'thematicBreak':
        return [{ node: 'divider', def: 'core:divider@1', props: {}, pos: p }];
      case 'code':
        return [{ node: 'code', def: 'core:code@1', props: { src: { text: n.value ?? '' }, lang: { text: (n.lang as string) ?? '' } }, pos: p }];
      case 'math':
        return [{ node: 'math', def: 'core:math@1', props: { tex: { tex: n.value ?? '', display: true } }, pos: p }];
      case 'blockquote': {
        const kids = n.children ?? [];
        let alert = 'none';
        let children = kids.flatMap(conv);
        const first = kids[0];
        if (first && first.type === 'paragraph') {
          const t = inline(first);
          const m = ALERT_RE.exec(t);
          if (m) {
            alert = m[1].toLowerCase();
            const rest = t.slice(m[0].length);
            children = [...(rest.trim() ? [{ node: 'paragraph', def: 'core:paragraph@1', props: { text: { text: rest } }, pos: posOf(first) } as IRNode] : []), ...kids.slice(1).flatMap(conv)];
          }
        }
        return [{ node: 'quote', def: 'core:quote@1', props: { alert: { lit: alert } }, children, pos: p }];
      }
      case 'list': {
        const records: IRNode[] = (n.children ?? []).map((li) => {
          const checked = li.checked === true ? 'yes' : li.checked === false ? 'no' : 'none';
          // tight lists keep their paragraphs as paragraphs; renderers space them by spread
          return { node: '$record', record: 'item', input: 'items', props: { checked: { lit: checked } }, children: (li.children ?? []).flatMap(conv), pos: posOf(li) };
        });
        return [{ node: 'list', def: 'core:list@1', props: { ordered: { lit: !!n.ordered }, start: { lit: (n.start as number) ?? 1 } }, records, pos: p }];
      }
      case 'table': {
        const rows = (n.children ?? []).map((r) => (r.children ?? []).map((c) => inline(c)));
        const align = ((n.align as (string | null)[]) ?? []).map((a) => a ?? 'none');
        return [{ node: 'table', def: 'core:table@1', props: { head: { lit: rows[0] ?? [] }, rows: { lit: rows.slice(1) }, align: { lit: align } }, pos: p }];
      }
      case 'footnoteDefinition':
        return [{ node: 'footnote', def: 'core:footnote@1', props: { label: { text: String(n.label ?? n.identifier ?? '') } }, children: (n.children ?? []).flatMap(conv), pos: p }];
      case 'html':
        {
          const h = slice(n).trim().split('\n')[0];
          warnings.push({ line: p[0], message: `raw HTML is shown as plain text, since MKP content has no HTML; found ${h.length > 60 ? h.slice(0, 57) + '…' : h}. Write it as Markdown (**bold**, *italic*, [text](url)), or use a widget for anything more` });
        }
        return [{ node: 'paragraph', def: 'core:paragraph@1', props: { text: { text: escapeMd(slice(n)) } }, pos: p }];
      case 'definition':
        warnings.push({ line: p[0], message: `link reference definitions like [${String(n.label ?? n.identifier ?? '')}]: ${String(n.url ?? '')} are not supported, so links that use them stay plain text. Write each link inline instead: [text](${String(n.url ?? 'url')}), and remove this line` });
        return [];
      default:
        return [];
    }
  };
  return (root.children ?? []).flatMap(conv);
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]<>#|])/g, '\\$1');
}

// ---------------------------------------------------------------------------------------------
// Inline runs

export type Run =
  | { t: 'text'; v: string; b?: true; i?: true; s?: true; href?: string }
  | { t: 'code'; v: string; href?: string }
  | { t: 'math'; tex: string; display?: true }
  | { t: 'br' }
  | { t: 'img'; src: string; alt: string }
  /** n: its number, by the order of first references in the document (GAPS 34) */
  | { t: 'fnref'; label: string; n?: number };

const runCache = new Map<string, Run[]>();

/** Inline Markdown (with $…$ maths) as flat runs. */
export function inlineRuns(text: string): Run[] {
  const hit = runCache.get(text);
  if (hit) return hit;
  const out: Run[] = [];
  if (!/[*_`$[\\!~<\n]/.test(text)) {
    if (text) out.push({ t: 'text', v: text });
  } else {
    // a footnote reference is only recognised beside its definition, and definitions live
    // elsewhere in the document: give each [^label] a stand-in one, which is never walked
    const labels = [...new Set([...text.matchAll(/\[\^([^\]\s]+)\]/g)].map((m) => m[1]))];
    const root = parse(labels.length ? `${text}\n\n${labels.map((l) => `[^${l}]: -`).join('\n')}` : text);
    const para = (root.children ?? []).find((c) => c.type === 'paragraph' || c.type === 'heading');
    const walk = (n: MdNode, marks: { b?: true; i?: true; s?: true; href?: string }): void => {
      switch (n.type) {
        case 'text':
          pushText(out, n.value ?? '', marks);
          break;
        case 'strong':
          (n.children ?? []).forEach((c) => walk(c, { ...marks, b: true }));
          break;
        case 'emphasis':
          (n.children ?? []).forEach((c) => walk(c, { ...marks, i: true }));
          break;
        case 'delete':
          (n.children ?? []).forEach((c) => walk(c, { ...marks, s: true }));
          break;
        case 'inlineCode':
          out.push(marks.href ? { t: 'code', v: n.value ?? '', href: marks.href } : { t: 'code', v: n.value ?? '' });
          break;
        case 'inlineMath':
          out.push({ t: 'math', tex: n.value ?? '' });
          break;
        case 'math':
          out.push({ t: 'math', tex: n.value ?? '', display: true });
          break;
        case 'break':
          out.push({ t: 'br' });
          break;
        case 'link':
          (n.children ?? []).forEach((c) => walk(c, { ...marks, href: safeHref(String(n.url ?? '')) }));
          break;
        case 'image':
          out.push({ t: 'img', src: String(n.url ?? ''), alt: String(n.alt ?? '') });
          break;
        case 'footnoteReference':
          out.push({ t: 'fnref', label: String(n.label ?? n.identifier ?? '') });
          break;
        case 'html':
          pushText(out, n.value ?? '', marks);
          break;
        default:
          (n.children ?? []).forEach((c) => walk(c, marks));
          if (!n.children && n.value) pushText(out, n.value, marks);
      }
    };
    if (para) (para.children ?? []).forEach((c) => walk(c, {}));
    else (root.children ?? []).filter((c) => c.type !== 'footnoteDefinition').forEach((c) => walk(c, {}));
  }
  if (runCache.size > 5000) runCache.clear();
  runCache.set(text, out);
  return out;
}

function pushText(out: Run[], v: string, marks: { b?: true; i?: true; s?: true; href?: string }): void {
  const last = out[out.length - 1];
  if (last && last.t === 'text' && last.b === marks.b && last.i === marks.i && last.s === marks.s && last.href === marks.href) {
    last.v += v;
    return;
  }
  const r: Run = { t: 'text', v };
  if (marks.b) r.b = true;
  if (marks.i) r.i = true;
  if (marks.s) r.s = true;
  if (marks.href) r.href = marks.href;
  out.push(r);
}

/** Links may point to the web or within the document; no script or data URLs. */
export function safeHref(url: string): string {
  const u = url.trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u) || /^[A-Za-z0-9_.-]+(\.[A-Za-z0-9]+)?(#.*)?$/.test(u)) return u;
  return '#';
}

/** Plain text of inline Markdown (for summaries, labels and speech). */
export function plainText(text: string, mathAs: (tex: string) => string = (t) => t): string {
  return inlineRuns(text)
    .map((r) => (r.t === 'text' || r.t === 'code' ? r.v : r.t === 'math' ? mathAs(r.tex) : r.t === 'br' ? '\n' : r.t === 'img' ? r.alt : ''))
    .join('');
}

/** Every inline maths source in a text (for pre-rendering at build). */
export function inlineMaths(text: string): string[] {
  return inlineRuns(text)
    .filter((r): r is Extract<Run, { t: 'math' }> => r.t === 'math')
    .map((r) => r.tex);
}
