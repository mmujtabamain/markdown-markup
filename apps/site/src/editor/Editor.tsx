// The source editor: CodeMirror with line numbers, the compiler's diagnostics underlined in place
// (and marked in the gutter), and a way to put the cursor on a line from outside (a click on a
// diagnostic). The cursor's line is on the element as data-cursor-line, for tests and tools.

import { useEffect, useRef, type ReactNode } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { highlight, languageFor } from './languages';

export interface Mark {
  line: number;
  col: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface Jump {
  line: number;
  col: number;
  /** a new number for each request, so the same line can be asked for twice */
  n: number;
}

export interface EditorProps {
  /** the file's identity: a new path starts a new editor state (and undo history) */
  path: string;
  value: string;
  marks: Mark[];
  onChange?: (text: string) => void;
  jump?: Jump | null;
  readOnly?: boolean;
  label: string;
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
  '.cm-scroller': { fontFamily: 'var(--pg-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--foreground)', paddingBlock: '8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--pg-selection) !important' },
  '.cm-gutters': { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'var(--pg-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--pg-active-line)', color: 'var(--foreground)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--destructive)', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
  '.cm-lintPoint-error:after': { borderBottomColor: 'var(--destructive)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: '6px' },
  '.cm-diagnostic': { fontFamily: 'var(--pg-mono)', fontSize: '12px', whiteSpace: 'pre-wrap', maxWidth: 'min(520px, 90vw)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--destructive)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warn)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--pg-selection)', outline: 'none' },
});

/** The range a diagnostic underlines: the word it points at, or the rest of its line. */
export function markRange(text: string, line: number, col: number): { from: number; to: number } {
  const lines = text.split('\n');
  const ln = Math.min(Math.max(line, 1), lines.length);
  let from = 0;
  for (let i = 0; i < ln - 1; i++) from += lines[i].length + 1;
  const body = lines[ln - 1] ?? '';
  const c = Math.min(Math.max(col - 1, 0), body.length);
  const word = /^[^\s"()[\]{},]+/.exec(body.slice(c))?.[0].length ?? 0;
  if (word) return { from: from + c, to: from + c + word };
  // nothing to underline at the point: the line's text instead
  const start = body.length - body.trimStart().length;
  return { from: from + start, to: from + body.trimEnd().length };
}

function cmMarks(text: string, marks: Mark[]): CmDiagnostic[] {
  return marks.map((m) => ({ ...markRange(text, m.line, m.col), severity: m.severity, message: m.message }));
}

export function Editor({ path, value, marks, onChange, jump, readOnly, label }: EditorProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  const extensions = (): Extension[] => [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    syntaxHighlighting(highlight),
    lintGutter(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    languageFor(path),
    theme,
    EditorState.tabSize.of(2),
    EditorState.readOnly.of(!!readOnly),
    EditorView.contentAttributes.of({ 'aria-label': label }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) change.current?.(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) {
        const line = u.state.doc.lineAt(u.state.selection.main.head).number;
        host.current?.setAttribute('data-cursor-line', String(line));
      }
    }),
  ];

  // one view for the component's life; a new file gets a new state
  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: extensions() }) });
    view.current = v;
    host.current!.setAttribute('data-cursor-line', '1');
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.setState(EditorState.create({ doc: value, extensions: extensions() }));
    v.dispatch(setDiagnostics(v.state, cmMarks(value, marks)));
    host.current?.setAttribute('data-cursor-line', '1');
  }, [path, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // a value from outside (a reset, a shared link): replace the text, keeping the history
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch(setDiagnostics(v.state, cmMarks(v.state.doc.toString(), marks)));
  }, [marks]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump) return;
    const { from } = markRange(v.state.doc.toString(), jump.line, jump.col);
    const line = v.state.doc.line(Math.min(Math.max(jump.line, 1), v.state.doc.lines));
    const at = Math.min(Math.max(from, line.from), line.to);
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    v.focus();
    host.current?.setAttribute('data-cursor-line', String(line.number));
  }, [jump]);

  return <div ref={host} className="pg-editor" data-pg-editor={path} />;
}
