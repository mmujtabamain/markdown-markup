// The editor's two themes, from the playground's own colours (src/style.css, :root and its dark
// half): the same token colours the editor had before Monaco, its background, gutter, line
// numbers, current line and selection. A weight over 500 there drew as bold, so it is bold here.

import type { monaco as Monaco } from "./monaco.js";

interface Palette {
  panel: string;
  gutter: string;
  line: string;
  lineStrong: string;
  faint: string;
  muted: string;
  text: string;
  accent: string;
  /** --sel, as a hex with its alpha */
  selection: string;
  err: string;
  warn: string;
  tok: Record<"keyword" | "string" | "number" | "comment" | "doc" | "call" | "fn" | "state" | "hole" | "case" | "heading" | "mark", string>;
}

const LIGHT: Palette = {
  panel: "#ffffff",
  gutter: "#f7f8fa",
  line: "#e3e6ec",
  lineStrong: "#cdd2db",
  faint: "#9aa1af",
  muted: "#646d80",
  text: "#1a2130",
  accent: "#4257d6",
  selection: "#4257d638",
  err: "#c5352b",
  warn: "#a15f05",
  tok: {
    keyword: "#8a3fcf",
    string: "#1d7a4c",
    number: "#b4501a",
    comment: "#8b93a2",
    doc: "#6f7d92",
    call: "#2c5bd0",
    fn: "#3a49ad",
    state: "#0b7a87",
    hole: "#0b7a87",
    case: "#9a4a1c",
    heading: "#1a2130",
    mark: "#4257d6",
  },
};

const DARK: Palette = {
  panel: "#151920",
  gutter: "#1a1f28",
  line: "#262c37",
  lineStrong: "#343c4a",
  faint: "#687186",
  muted: "#98a1b3",
  text: "#e3e7ee",
  accent: "#8d9dff",
  selection: "#8d9dff47",
  err: "#ff7d73",
  warn: "#e6a64a",
  tok: {
    keyword: "#c79bff",
    string: "#7fd3a3",
    number: "#f1a36c",
    comment: "#6f798c",
    doc: "#8794a8",
    call: "#84a8ff",
    fn: "#a3b1ff",
    state: "#5fd4df",
    hole: "#5fd4df",
    case: "#f0b072",
    heading: "#e3e7ee",
    mark: "#8d9dff",
  },
};

export const LIGHT_THEME = "mkp-light";
export const DARK_THEME = "mkp-dark";

const hex = (c: string) => c.replace("#", "");
/** A colour with an alpha, from a fraction. */
const alpha = (c: string, a: number) => c + Math.round(a * 255).toString(16).padStart(2, "0");

function theme(base: "vs" | "vs-dark", p: Palette): Monaco.editor.IStandaloneThemeData {
  const t = p.tok;
  const rule = (token: string, color: string, fontStyle?: string) => ({ token, foreground: hex(color), ...(fontStyle ? { fontStyle } : {}) });
  return {
    base,
    // nothing from Monaco's own themes: every token below is coloured as the playground colours it
    inherit: false,
    rules: [
      rule("", p.text),
      rule("identifier", p.text),
      rule("type", p.text),
      rule("delimiter", p.text),
      rule("operator", p.text),
      rule("keyword", t.keyword, "bold"),
      rule("state", t.state, "bold"),
      rule("call", t.call, "bold"),
      rule("function", t.fn),
      rule("string", t.string),
      rule("hole", t.hole),
      rule("number", t.number),
      rule("comment", t.comment, "italic"),
      rule("comment.doc", t.doc, "italic"),
      rule("case", t.case),
      rule("divider", p.accent, "bold"),
      rule("heading", t.heading, "bold"),
      rule("strong", p.text, "bold"),
      rule("emphasis", p.text, "italic"),
      rule("code", t.string),
      rule("link", t.call),
      rule("list", t.mark, "bold"),
    ],
    colors: {
      "editor.background": p.panel,
      "editor.foreground": p.text,
      // the gutter's own colour is drawn by style.css, up to its border, so the gap before the
      // text has the editor's background as it did
      "editorGutter.background": p.panel,
      "editorLineNumber.foreground": p.faint,
      "editorLineNumber.activeForeground": p.faint,
      "editor.lineHighlightBackground": alpha(p.accent, 0.07),
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": p.text,
      "editor.selectionBackground": p.selection,
      "editor.inactiveSelectionBackground": alpha(p.accent, 0.12),
      "editor.selectionHighlightBackground": "#00000000",
      "editorError.foreground": p.err,
      "editorWarning.foreground": p.warn,
      // brackets are text, as they were: no pair colours even if colourising comes back on
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((k) => [`editorBracketHighlight.foreground${k}`, p.text])),
      "editorBracketHighlight.unexpectedBracket.foreground": p.text,
      "editorBracketMatch.background": alpha(p.accent, 0.14),
      "editorBracketMatch.border": alpha(p.accent, 0.45),
      "editor.findMatchBackground": alpha(p.accent, 0.3),
      "editor.findMatchHighlightBackground": alpha(p.accent, 0.15),
      "editorWidget.background": p.panel,
      "editorWidget.foreground": p.text,
      "editorWidget.border": p.lineStrong,
      "editorHoverWidget.background": p.panel,
      "editorHoverWidget.foreground": p.text,
      "editorHoverWidget.border": p.lineStrong,
      "input.background": p.panel,
      "input.foreground": p.text,
      "input.border": p.lineStrong,
      "focusBorder": p.accent,
      "scrollbarSlider.background": alpha(p.muted, 0.18),
      "scrollbarSlider.hoverBackground": alpha(p.muted, 0.3),
      "scrollbarSlider.activeBackground": alpha(p.muted, 0.42),
      "scrollbar.shadow": "#00000000",
    },
  };
}

export function defineThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme(LIGHT_THEME, theme("vs", LIGHT));
  monaco.editor.defineTheme(DARK_THEME, theme("vs-dark", DARK));
}

export function themeFor(dark: boolean): string {
  return dark ? DARK_THEME : LIGHT_THEME;
}
