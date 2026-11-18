// The source editor: Monaco, with MKP's language and the playground's colours. Monaco draws the
// text, the caret and the selection itself, measured from what it draws, so they stay together
// whatever the font. The compiler's diagnostics are its markers.

import { monaco } from "./monaco.js";
import { MKP, languageFor, registerMkp } from "./language.js";
import { defineThemes, themeFor } from "./themes.js";

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

/** Whose markers these are, in Monaco's marker service. */
export const MARKER_OWNER = "mkp";
/** The markers of widgets that failed while the page was drawn: the page's, not the compiler's. */
export const FAILURE_OWNER = "mkp-page";

const FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';
/** Where the gutter's border is, past the line numbers' right edge (style.css draws it). */
const GUTTER_PAD = 13;

let registered = false;

export class Editor {
  readonly view: monaco.editor.IStandaloneCodeEditor;
  readonly model: monaco.editor.ITextModel;
  /** The text is being replaced whole, as loading an example does: not the reader's edit. */
  private replacing = false;
  private readonly lineMarks: monaco.editor.IEditorDecorationsCollection;
  private readonly flash: monaco.editor.IEditorDecorationsCollection;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: HTMLElement, on: EditorEvents) {
    if (!registered) {
      registerMkp(monaco);
      defineThemes(monaco);
      registered = true;
    }
    const dark = matchMedia("(prefers-color-scheme: dark)");
    this.model = monaco.editor.createModel("", MKP, monaco.Uri.parse("inmemory://playground/page.mkp.md"));
    // the model is ours, so its own options: four spaces, and brackets in the text's colour
    this.model.updateOptions({ tabSize: 4, indentSize: 4, insertSpaces: true, bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
    this.view = monaco.editor.create(host, {
      model: this.model,
      theme: themeFor(dark.matches),
      ariaLabel: "The page's MKP source",
      automaticLayout: true,
      fixedOverflowWidgets: true,
      // the look the editor had: the font, its size and lines, the gutter, no minimap or rulers
      fontFamily: FONT,
      // the size the old editor's text was drawn at (0.92em of 13px, from style.css's `code`); its
      // textarea, holding the caret, was 13px, and that difference was the caret drifting off
      fontSize: 11.96,
      lineHeight: 20,
      letterSpacing: 0,
      fontLigatures: false,
      padding: { top: 12, bottom: 52 },
      scrollBeyondLastLine: false,
      renderFinalNewline: "on",
      lineNumbersMinChars: 5,
      lineDecorationsWidth: GUTTER_PAD + 14,
      glyphMargin: false,
      folding: false,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      // the current line's band from the gutter's border on, as before (style.css clips it)
      renderLineHighlight: "all",
      renderLineHighlightOnlyWhenFocus: true,
      renderWhitespace: "none",
      guides: { indentation: false, bracketPairs: false, highlightActiveIndentation: false },
      bracketPairColorization: { enabled: false },
      matchBrackets: "near",
      occurrencesHighlight: "off",
      selectionHighlight: false,
      wordWrap: "off",
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false, alwaysConsumeMouseWheel: false },
      // typing: Tab is four spaces, Enter keeps the line's indent, pairs close and are stepped over
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: false,
      useTabStops: false,
      autoIndent: "keep",
      autoClosingBrackets: "languageDefined",
      autoClosingQuotes: "languageDefined",
      autoClosingOvertype: "auto",
      autoClosingDelete: "auto",
      autoSurround: "languageDefined",
      // nothing pops up while typing: Enter is always a new line
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      wordBasedSuggestions: "off",
      acceptSuggestionOnEnter: "off",
      tabCompletion: "off",
    });
    // again now: creating the editor applies the configuration's default to every model
    this.model.updateOptions({ bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
    this.lineMarks = this.view.createDecorationsCollection();
    this.flash = this.view.createDecorationsCollection();

    dark.addEventListener("change", () => monaco.editor.setTheme(themeFor(dark.matches)));
    this.model.onDidChangeContent(() => {
      this.syncLanguage();
      if (!this.replacing) on.change();
    });
    this.view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => on.run());
    this.view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => on.run());
    // the gutter ends a little past the line numbers, wherever Monaco puts them
    const gutter = () => {
      const info = this.view.getLayoutInfo();
      host.style.setProperty("--gutter-edge", `${info.decorationsLeft + GUTTER_PAD}px`);
      host.style.setProperty("--content-left", `${info.contentLeft}px`);
    };
    this.view.onDidLayoutChange(gutter);
    gutter();
    // a problem's message as the tooltip of its squiggle, with no hover widget to load
    this.view.onMouseMove((e) => {
      const at = e.target.position;
      const found = at && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT ? this.markers().find((m) => new monaco.Range(m.line, m.col, m.endLine, m.endCol).containsPosition(at)) : undefined;
      const title = found ? `${found.message} (${found.code})` : "";
      if (host.title !== title) host.title = title;
    });
    this.view.onMouseLeave(() => (host.title = ""));
  }

  get value(): string {
    return this.model.getValue();
  }

  /** Replaces the whole text, as loading an example does: not an edit to undo. The caret goes to
   * the end, so clicking in and typing adds to the page's prose; the view stays at the top. */
  set value(text: string) {
    this.replacing = true;
    try {
      this.model.setValue(text);
    } finally {
      this.replacing = false;
    }
    this.syncLanguage();
    this.setDiagnostics([], text);
    const last = this.model.getLineCount();
    this.view.setPosition({ lineNumber: last, column: this.model.getLineMaxColumn(last) });
    this.view.setScrollTop(0);
    this.view.setScrollLeft(0);
  }

  /** The compiler's diagnostics for `source`, as markers. Markers move with later edits; a result
   * for a text that has changed since is left for the next compile. */
  setDiagnostics(diagnostics: Diagnostic[], source: string): void {
    if (source !== this.model.getValue()) return;
    const mine = diagnostics.filter((d) => !d.file);
    monaco.editor.setModelMarkers(
      this.model,
      MARKER_OWNER,
      mine.map((d) => ({
        severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        startLineNumber: d.line,
        startColumn: d.col,
        endLineNumber: d.end?.line ?? d.line,
        endColumn: d.end?.col ?? d.col,
        message: d.message,
        code: d.code,
        source: "mkp",
      })),
    );
    // and the gutter's numbers on their lines, red or amber, as before
    const worst = new Map<number, "error" | "warning">();
    for (const d of mine) if (worst.get(d.line) !== "error") worst.set(d.line, d.severity === "error" ? "error" : "warning");
    this.lineMarks.set(
      [...worst].map(([line, sev]) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { lineNumberClassName: `has-${sev}`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      })),
    );
  }

  /** The widgets that failed while the page was drawn, each marked on the call that placed it with
   * its notice's message. Only for the text the page was compiled from; markers move with edits. */
  setFailures(failed: { message: string; written: { line: number; column: number; end: { line: number; column: number } } }[], source: string): void {
    if (source !== this.model.getValue()) return;
    monaco.editor.setModelMarkers(
      this.model,
      FAILURE_OWNER,
      failed.map((f) => ({
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: f.written.line,
        startColumn: f.written.column,
        endLineNumber: f.written.end.line,
        endColumn: f.written.end.column,
        message: `${f.message}, when the page was drawn`,
        source: "page",
      })),
    );
  }

  /** Puts the caret at a line and column (both from 1), brings it into view, and flashes the line. */
  goTo(line: number, col: number): void {
    const pos = this.model.validatePosition({ lineNumber: line, column: col });
    this.view.setPosition(pos);
    this.view.revealPositionInCenterIfOutsideViewport(pos, monaco.editor.ScrollType.Smooth);
    this.view.focus();
    this.flash.set([{ range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1), options: { isWholeLine: true, className: "line-flash" } }]);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.clear(), 1300);
  }

  focus(): void {
    this.view.focus();
  }

  /** The source's language follows whether it has a `@@@` line (language.ts). */
  private syncLanguage(): void {
    const want = languageFor(this.model.getValue());
    if (this.model.getLanguageId() !== want) monaco.editor.setModelLanguage(this.model, want);
  }

  // ---- for the tests and the video: what the editor holds, read only

  /** The markers on the source now. */
  /** The marks of widgets that failed while the page was drawn, as `markers()` gives the compiler's. */
  failures(): { line: number; col: number; endLine: number; endCol: number; severity: string; code: string; message: string }[] {
    return this.markers(FAILURE_OWNER);
  }

  markers(owner: string = MARKER_OWNER): { line: number; col: number; endLine: number; endCol: number; severity: string; code: string; message: string }[] {
    return monaco.editor.getModelMarkers({ owner, resource: this.model.uri }).map((m) => ({
      line: m.startLineNumber,
      col: m.startColumn,
      endLine: m.endLineNumber,
      endCol: m.endColumn,
      severity: m.severity === monaco.MarkerSeverity.Error ? "error" : "warning",
      code: typeof m.code === "string" ? m.code : (m.code?.value ?? ""),
      message: m.message,
    }));
  }

  /** A line's tokens as MKP's tokenizer reads it, with their text. */
  tokens(line: number): { text: string; type: string }[] {
    const lines = monaco.editor.tokenize(this.model.getValue(), this.model.getLanguageId());
    const text = this.model.getLineContent(line);
    const row = lines[line - 1] ?? [];
    return row.map((t, k) => ({ text: text.slice(t.offset, row[k + 1]?.offset ?? text.length), type: t.type }));
  }
}
