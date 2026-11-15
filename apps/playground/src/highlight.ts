// A light highlighter for `.mkp.md` sources, for the editor's colour layer. It is not a parser:
// it colours code before the `@@@` divider, and in the prose after it the Markdown, the `@calls`
// (with their arguments, across lines while a bracket is open) and the `\{holes}`. A wrong colour
// costs nothing, so it errs on the side of simple.

const KEYWORDS = new Set(
  "package import enum record type interface implements widget extern expose fn pack tokens mut let event invoke view markdown require if else for in match case return only step void any param slot try with self true false as token".split(
    " ",
  ),
);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
}

function span(cls: string, text: string): string {
  return `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
}

/** A text literal, with its `\{holes}` set apart. */
function stringHtml(s: string): string {
  let out = "";
  let last = 0;
  const hole = /\\\{[^}]*\}?/g;
  for (let m = hole.exec(s); m; m = hole.exec(s)) {
    if (m.index > last) out += span("string", s.slice(last, m.index));
    out += span("hole", m[0]);
    last = m.index + m[0].length;
  }
  if (last < s.length) out += span("string", s.slice(last));
  return out;
}

const CODE =
  /(\/\/@[a-z]+[^\n]*)|(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?)|(\$state\b)|(@@@|@[a-z_][a-z0-9_]*)|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:ms|s)?\b)|(\b[a-z_][a-z0-9_]*\b)|(\b[A-Z][A-Z0-9_]*\b)/g;

/** Code: keywords, names called, text, numbers, cases, comments. */
export function codeHtml(src: string): string {
  let out = "";
  let last = 0;
  CODE.lastIndex = 0;
  for (let m = CODE.exec(src); m; m = CODE.exec(src)) {
    if (m.index > last) out += escapeHtml(src.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += span("doc", t);
    else if (m[2]) out += span("comment", t);
    else if (m[3]) out += stringHtml(t);
    else if (m[4]) out += span("state", t);
    else if (m[5]) out += span("call", t);
    else if (m[6]) out += span("number", t);
    else if (m[7]) {
      if (KEYWORDS.has(t)) out += span("keyword", t);
      else if (/^\s*\(/.test(src.slice(CODE.lastIndex, CODE.lastIndex + 8))) out += span("fn", t);
      else out += escapeHtml(t);
    } else if (m[8]) out += span("case", t);
    last = CODE.lastIndex;
  }
  if (last < src.length) out += escapeHtml(src.slice(last));
  return out;
}

const INLINE = /(`[^`\n]+`)|(\\\{[^}\n]*\}?)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\n]*\))|(@[a-z_][a-z0-9_]*)/g;

/** A line of prose: inline code, holes, bold, links and calls. */
function inlineHtml(line: string): string {
  let out = "";
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(line); m; m = INLINE.exec(line)) {
    if (m.index > last) out += escapeHtml(line.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += span("md-code", t);
    else if (m[2]) out += span("hole", t);
    else if (m[3]) out += span("md-strong", t);
    else if (m[4]) out += span("md-link", t);
    else if (m[5]) out += span("call", t);
    last = INLINE.lastIndex;
  }
  if (last < line.length) out += escapeHtml(line.slice(last));
  return out;
}

/** How many brackets a line of code leaves open, its text literals and comments left out. */
function openBrackets(line: string): number {
  const bare = line.replace(/"(?:[^"\\\n]|\\.)*"?/g, '""').replace(/\/\/.*$/, "");
  let depth = 0;
  for (const c of bare) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
  }
  return depth;
}

/** Prose after the divider, line for line: also the colours of the Markdown tab. */
export function proseLines(lines: string[]): string[] {
  const out: string[] = [];
  let depth = 0; // brackets a call left open, across lines
  let fence: string | null = null;
  for (const line of lines) {
    if (fence !== null) {
      out.push(span("md-code", line));
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    const fenced = /^\s*(```+|~~~+)/.exec(line);
    if (fenced && depth <= 0) {
      fence = fenced[1];
      out.push(span("md-code", line));
      continue;
    }
    if (depth > 0 || /^\s*@[a-z_]/.test(line) || /^\s*\}\s*;?\s*$/.test(line)) {
      out.push(codeHtml(line));
      depth = Math.max(0, depth + openBrackets(line));
      continue;
    }
    const heading = /^(#{1,6})(\s.*)?$/.exec(line);
    if (heading) {
      out.push(`<span class="tok-md-heading">${inlineHtml(line)}</span>`);
      continue;
    }
    const bullet = /^(\s*(?:[-*+]|\d+\.)\s)(.*)$/.exec(line);
    if (bullet) {
      out.push(span("md-mark", bullet[1]) + inlineHtml(bullet[2]));
      continue;
    }
    out.push(inlineHtml(line));
  }
  return out;
}

/** The whole source as HTML, line for line. */
export function highlight(src: string): string {
  const lines = src.split("\n");
  const divider = lines.findIndex((l) => l === "@@@");
  if (divider < 0) return proseLines(lines).join("\n");
  const code = codeHtml(lines.slice(0, divider).join("\n"));
  const prose = proseLines(lines.slice(divider + 1));
  return [code, span("divider", "@@@"), ...prose].join("\n");
}
