// The source editor: a plain textarea, so typing, undo, selection and the browser's own editing
// all work as they always do, over two layers drawn in the same font: the colours, and the
// diagnostics' underlines. A gutter numbers the lines and marks the ones with problems.

import { escapeHtml, highlight } from "./highlight.js";

export interface Diagnostic {
  line: number;
  col: number;
  severity: string;
  code: string;
  message: string;
  end?: { line: number; col: number };
  file?: string;
}

export interface EditorEvents {
  /** The text changed by the reader. */
  change(): void;
  /** Ctrl/Cmd+S or Ctrl/Cmd+Enter: compile now. */
  run(): void;
}

const INDENT = "    ";

export class Editor {
  readonly textarea: HTMLTextAreaElement;
  private readonly layers: HTMLElement;
  private readonly code: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly band: HTMLElement;
  private lines = 0;
  private diagnostics: Diagnostic[] = [];
  /** The text the diagnostics belong to: they are shown only while the text is still that. */
  private diagnosed = "";
  private painted = false;

  constructor(frame: HTMLElement, private readonly on: EditorEvents) {
    this.textarea = frame.querySelector("textarea")!;
    this.layers = frame.querySelector(".layers")!;
    this.code = frame.querySelector(".hl code")!;
    this.marks = frame.querySelector(".marks")!;
    this.gutter = frame.querySelector(".gutter-lines")!;
    this.band = frame.querySelector(".active-line")!;
    const ta = this.textarea;
    ta.addEventListener("input", () => {
      this.schedulePaint();
      this.on.change();
    });
    ta.addEventListener("scroll", () => this.syncScroll());
    ta.addEventListener("keydown", (e) => this.key(e));
    document.addEventListener("selectionchange", () => {
      if (document.activeElement === ta) this.moveBand();
    });
    ta.addEventListener("focus", () => {
      this.band.hidden = false;
      this.moveBand();
    });
    ta.addEventListener("blur", () => (this.band.hidden = true));
    new ResizeObserver(() => this.syncScroll()).observe(ta);
  }

  get value(): string {
    return this.textarea.value;
  }

  /** Replaces the whole text, as loading an example does: not an edit to undo. The caret goes to
   * the end, so focusing the editor and typing adds to the page's prose; the view stays at the top. */
  set value(text: string) {
    this.textarea.value = text;
    this.textarea.setSelectionRange(text.length, text.length);
    this.textarea.scrollTop = 0;
    this.textarea.scrollLeft = 0;
    this.diagnostics = [];
    this.paint();
  }

  /** Shows the diagnostics of a compile of `source`, while the text is still that source. */
  setDiagnostics(diagnostics: Diagnostic[], source: string): void {
    this.diagnostics = diagnostics.filter((d) => !d.file);
    this.diagnosed = source;
    this.paint();
  }

  /** Puts the caret at a line and column (both from 1), and brings it into view. */
  goTo(line: number, col: number): void {
    const ta = this.textarea;
    const text = ta.value;
    let at = 0;
    for (let l = 1; l < line; l++) {
      const nl = text.indexOf("\n", at);
      if (nl < 0) break;
      at = nl + 1;
    }
    const lineEnd = text.indexOf("\n", at);
    const offset = Math.min(at + Math.max(0, col - 1), lineEnd < 0 ? text.length : lineEnd);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(offset, offset);
    const lh = this.lineHeight();
    const top = (line - 1) * lh;
    if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    const cw = this.charWidth();
    const left = (col - 1) * cw;
    if (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - cw * 4) ta.scrollLeft = Math.max(0, left - ta.clientWidth / 2);
    ta.scrollIntoView({ block: "nearest" });
    this.syncScroll();
    this.moveBand();
    this.band.classList.remove("flash");
    void this.band.offsetWidth;
    this.band.classList.add("flash");
  }

  focus(): void {
    this.textarea.focus();
  }

  // ---- drawing

  private schedulePaint(): void {
    if (this.painted) return;
    this.painted = true;
    requestAnimationFrame(() => {
      this.painted = false;
      this.paint();
    });
  }

  private paint(): void {
    const text = this.textarea.value;
    // a trailing space keeps the last line's height when the text ends in a newline
    this.code.innerHTML = highlight(text) + " ";
    const current = text === this.diagnosed ? this.diagnostics : [];
    this.marks.innerHTML = marksHtml(text, current) + " ";
    const count = text.split("\n").length;
    const byLine = new Map<number, string>();
    for (const d of current) {
      const was = byLine.get(d.line);
      if (was !== "error") byLine.set(d.line, d.severity === "error" ? "error" : "warning");
    }
    if (count !== this.lines || byLine.size || this.gutter.querySelector(".has-error, .has-warning")) {
      let html = "";
      for (let l = 1; l <= count; l++) {
        const s = byLine.get(l);
        html += s ? `<div class="has-${s}">${l}</div>` : `<div>${l}</div>`;
      }
      this.gutter.innerHTML = html;
      this.lines = count;
    }
    this.syncScroll();
  }

  private syncScroll(): void {
    const ta = this.textarea;
    this.layers.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    this.gutter.style.transform = `translateY(${-ta.scrollTop}px)`;
  }

  private lineHeight(): number {
    return parseFloat(getComputedStyle(this.textarea).lineHeight) || 20;
  }

  private charWidth(): number {
    const probe = this.code.ownerDocument.createElement("span");
    probe.textContent = "0".repeat(10);
    probe.style.visibility = "hidden";
    this.code.append(probe);
    const w = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return w || 8;
  }

  private moveBand(): void {
    const ta = this.textarea;
    const line = ta.value.slice(0, ta.selectionStart).split("\n").length;
    this.band.style.top = `${(line - 1) * this.lineHeight()}px`;
  }

  // ---- keys

  private key(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "s" || e.key === "Enter")) {
      e.preventDefault();
      this.on.run();
      return;
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) this.outdent();
      else this.indent();
      return;
    }
    if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey && !e.isComposing) {
      // a new line keeps the indent of the one it breaks
      const ta = this.textarea;
      const start = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
      const indent = /^[ \t]*/.exec(ta.value.slice(start, ta.selectionStart))![0];
      if (indent) {
        e.preventDefault();
        this.insert("\n" + indent);
      }
    }
  }

  /** Inserts text as the reader typing it would: one step for undo. */
  private insert(text: string): void {
    const ta = this.textarea;
    if (!document.execCommand("insertText", false, text)) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  private selectedLines(): { start: number; end: number } {
    const ta = this.textarea;
    const v = ta.value;
    const start = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let end = v.indexOf("\n", ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === "\n" ? 1 : 0));
    if (end < 0) end = v.length;
    return { start, end };
  }

  private indent(): void {
    const ta = this.textarea;
    const v = ta.value;
    if (!v.slice(ta.selectionStart, ta.selectionEnd).includes("\n")) {
      this.insert(INDENT);
      return;
    }
    const { start, end } = this.selectedLines();
    const block = v.slice(start, end);
    const lines = block.split("\n");
    ta.setSelectionRange(start, end);
    this.insert(lines.map((l) => (l ? INDENT + l : l)).join("\n"));
    ta.setSelectionRange(start, start + block.length + INDENT.length * lines.filter(Boolean).length);
  }

  private outdent(): void {
    const ta = this.textarea;
    const v = ta.value;
    const { start, end } = this.selectedLines();
    const block = v.slice(start, end);
    const caret = ta.selectionStart;
    const out = block
      .split("\n")
      .map((l) => l.replace(/^ {1,4}|^\t/, ""))
      .join("\n");
    if (out === block) return;
    ta.setSelectionRange(start, end);
    this.insert(out);
    if (!block.includes("\n")) {
      const back = block.length - out.length;
      const at = Math.max(start, caret - back);
      ta.setSelectionRange(at, at);
    } else {
      ta.setSelectionRange(start, start + out.length);
    }
  }
}

/** The text, transparent, with each diagnostic's range in a mark that draws its underline. */
function marksHtml(text: string, diagnostics: Diagnostic[]): string {
  if (!diagnostics.length) return escapeHtml(text);
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const offset = (line: number, col: number) => {
    const s = starts[Math.min(Math.max(line, 1), starts.length) - 1];
    const e = line < starts.length ? starts[line] - 1 : text.length;
    return Math.min(s + Math.max(col, 1) - 1, e);
  };
  type Range = { from: number; to: number; severity: string };
  const ranges: Range[] = diagnostics
    .map((d) => {
      const from = offset(d.line, d.col);
      let to = d.end ? offset(d.end.line, d.end.col) : from;
      if (to <= from) to = Math.min(from + 1, text.length);
      // a range at the end of a line marks the place after it
      if (text[from] === "\n" || from >= text.length) to = from;
      return { from, to, severity: d.severity === "error" ? "error" : "warning" };
    })
    .sort((a, b) => a.from - b.from);
  let out = "";
  let at = 0;
  for (const r of ranges) {
    if (r.from < at) continue; // overlapping: the first one wins
    out += escapeHtml(text.slice(at, r.from));
    if (r.to === r.from) out += `<mark class="${r.severity} point"></mark>`;
    else out += `<mark class="${r.severity}">${escapeHtml(text.slice(r.from, r.to))}</mark>`;
    at = Math.max(r.to, r.from);
  }
  return out + escapeHtml(text.slice(at));
}
