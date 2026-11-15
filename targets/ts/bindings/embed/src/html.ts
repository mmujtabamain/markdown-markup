// A page's Markdown as HTML, for a server to put in the element a binding mounts the page into:
// search engines and readers without JavaScript get the page's content, with the values it starts
// with, and @mkp/dom replaces it when the page mounts. No DOM: it runs in Node, on a server.

import { pageBlocks, type Block, type Inline, type PageOptions } from "@mkp/runtime";
import { makePage, type Ir } from "./page.js";

/** The page's blocks as HTML: everything escaped, links and images only to safe addresses. */
export function blocksHtml(blocks: Block[]): string {
  return blocks.map(block).join("\n");
}

/** A page's Markdown as HTML, with the values it starts with (and `$state` the app gives). */
export function pageHtml(irFile: Ir, opts: Omit<PageOptions, "defects"> = {}): string {
  const { state, ...rest } = opts;
  const { page } = makePage(irFile, rest, state);
  return blocksHtml(pageBlocks(page));
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** An address that can't run script: http(s), mailto, tel, or relative. */
function safeUrl(u: string): string | undefined {
  const t = u.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(t)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) return undefined;
  return t;
}

function inline(runs: Inline[]): string {
  return runs.map(run).join("");
}

function run(r: Inline): string {
  if ("text" in r) {
    let h = escapeHtml(r.text.value);
    if (r.text.strike) h = `<del>${h}</del>`;
    if (r.text.italic) h = `<em>${h}</em>`;
    if (r.text.bold) h = `<strong>${h}</strong>`;
    const href = r.text.link === undefined ? undefined : safeUrl(r.text.link);
    if (href !== undefined) h = `<a href="${escapeHtml(href)}">${h}</a>`;
    return h;
  }
  if ("code" in r) return `<code>${escapeHtml(r.code)}</code>`;
  if ("math" in r) return `<span class="mkp-math">${escapeHtml(r.math)}</span>`;
  if ("image" in r) {
    const src = safeUrl(r.image.src);
    return src === undefined ? escapeHtml(r.image.alt) : `<img src="${escapeHtml(src)}" alt="${escapeHtml(r.image.alt)}">`;
  }
  if ("note" in r) return `<sup><a href="#mkp-fn-${escapeHtml(r.note)}">${escapeHtml(r.note)}</a></sup>`;
  return "<br>";
}

function cellAlign(a: "START" | "CENTER" | "END" | undefined): string {
  return a === "CENTER" ? ' style="text-align:center"' : a === "END" ? ' style="text-align:right"' : "";
}

function block(b: Block): string {
  if ("paragraph" in b) return `<p>${inline(b.paragraph)}</p>`;
  if ("heading" in b) {
    const n = Math.min(6, Math.max(1, b.heading.level));
    return `<h${n}>${inline(b.heading.inline)}</h${n}>`;
  }
  if ("bullets" in b) {
    const { ordered, start, items } = b.bullets;
    const lis = items
      .map((i) => {
        const box = i.done === undefined ? "" : `<input type="checkbox" disabled${i.done ? " checked" : ""}> `;
        // a single paragraph in an item is written inline, as Markdown's tight lists are
        const only = i.blocks.length === 1 && "paragraph" in i.blocks[0] ? inline((i.blocks[0] as { paragraph: Inline[] }).paragraph) : blocksHtml(i.blocks);
        return `<li>${box}${only}</li>`;
      })
      .join("");
    return ordered ? `<ol${start !== undefined && start !== 1 ? ` start="${start}"` : ""}>${lis}</ol>` : `<ul>${lis}</ul>`;
  }
  if ("quote" in b) return `<blockquote>${blocksHtml(b.quote)}</blockquote>`;
  if ("code" in b) return `<pre><code${b.code.lang ? ` class="language-${escapeHtml(b.code.lang)}"` : ""}>${escapeHtml(b.code.src)}</code></pre>`;
  if ("math" in b) return `<div class="mkp-math">${escapeHtml(b.math)}</div>`;
  if ("table" in b) {
    const { head, rows, align } = b.table;
    const th = head.map((c, k) => `<th${cellAlign(align[k])}>${inline(c)}</th>`).join("");
    const trs = rows.map((r) => `<tr>${r.map((c, k) => `<td${cellAlign(align[k])}>${inline(c)}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  }
  if ("footnote" in b) return `<div class="mkp-footnote" id="mkp-fn-${escapeHtml(b.footnote.mark)}"><sup>${escapeHtml(b.footnote.mark)}</sup> ${blocksHtml(b.footnote.blocks)}</div>`;
  return "<hr>";
}

export type { Block, Inline } from "@mkp/runtime";
