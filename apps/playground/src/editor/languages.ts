// Highlighting for the source pane: Markdown, with ```mkp fences read as MKP and a widget block's
// fence (its YAML) as YAML; .mkp files as MKP. Small stream modes: they colour, they don't check
// (the compiler does that, and its diagnostics are underlined).

import { HighlightStyle, StreamLanguage, type StreamParser } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const KEYWORDS = new Set([
  'in', 'var', 'fn', 'type', 'state', 'interface', 'implements', 'signal', 'project', 'pack', 'requires', 'provides', 'depends',
  'each', 'switch', 'case', 'else', 'slot', 'fill', 'layer', 'tokens', 'const', 'host', 'out', 'command', 'part', 'extern',
  'macro', 'controls', 'budget', 'answer', 'profile', 'of', 'key', 'if', 'set', 'send', 'emit', 'open', 'close', 'reveal',
  'hide', 'play', 'pause', 'reset', 'when', 'and', 'or', 'not',
]);
const ATOMS = new Set(['true', 'false', 'none', 'pi']);

interface MkpState {
  /** inside a """ long text */
  long: boolean;
  /** the first word of the line is still to come */
  head: boolean;
}

const mkp: StreamParser<MkpState> = {
  name: 'mkp',
  startState: () => ({ long: false, head: true }),
  token(stream, st) {
    if (stream.sol()) st.head = true;
    if (st.long) {
      if (stream.match(/^\s*"""/)) st.long = false;
      else stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (st.head && stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('"""')) {
      st.long = true;
      return 'string';
    }
    if (stream.peek() === '"') {
      stream.next();
      let esc = false;
      for (let c = stream.next(); c !== undefined; c = stream.next()) {
        if (c === '"' && !esc) break;
        esc = c === '\\' && !esc;
      }
      st.head = false;
      return 'string';
    }
    if (stream.peek() === '$') {
      stream.next();
      stream.skipTo('$') ? stream.next() : stream.skipToEnd();
      st.head = false;
      return 'string-2';
    }
    if (stream.match(/^@[A-Za-z][\w-]*/)) {
      st.head = false;
      return 'meta';
    }
    if (stream.match(/^\d+(?:\.\d+)?(?:ms|s|px|%)?/)) {
      st.head = false;
      return 'number';
    }
    const word = stream.match(/^[A-Za-z_][\w.-]*(?:@\d+)?/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      const head = st.head;
      st.head = false;
      if (stream.peek() === '=' && !stream.match('==', false)) return 'attribute';
      if (KEYWORDS.has(w)) return 'keyword';
      if (ATOMS.has(w)) return 'atom';
      return head ? 'def' : 'variable';
    }
    stream.next();
    st.head = false;
    return /[-+*/=<>!&|^]/.test(stream.current()) ? 'operator' : null;
  },
};

const yaml: StreamParser<{ value: boolean }> = {
  name: 'yaml',
  startState: () => ({ value: false }),
  token(stream, st) {
    if (stream.sol()) st.value = false;
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (!st.value && stream.match(/^-(?=\s)/)) return 'operator';
    if (!st.value && stream.match(/^[^:#\s][^:#]*?(?=:(\s|$))/)) return 'property';
    if (stream.match(':')) {
      st.value = true;
      return 'operator';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^']|'')*'?/)) return 'string';
    if (stream.match(/^-?\d+(?:\.\d+)?(?=[\s,\]}]|$)/)) return 'number';
    if (stream.match(/^(?:true|false|null|yes|no|on|off)(?=[\s,\]}]|$)/)) return 'atom';
    if (stream.match(/^[[\]{},]/)) return 'bracket';
    stream.match(/^[^\s,[\]{}#]+/) || stream.next();
    return st.value ? 'string' : null;
  },
};

export const mkpLanguage = StreamLanguage.define(mkp);
export const yamlLanguage = StreamLanguage.define(yaml);

/** The highlighting for a file, by its name. */
export function languageFor(path: string): Extension {
  // a document, or a pack's fixture case written as one (pack/file.fixture.json#case)
  if (path.endsWith('.md') || path.includes('#')) return markdown({ codeLanguages: (info) => (info.trim().split(/\s+/)[0] === 'mkp' ? mkpLanguage : info.trim() ? yamlLanguage : null) });
  if (path.endsWith('.mkp')) return mkpLanguage;
  return [];
}

/** Colours from the page's tokens, so light and dark both hold. */
export const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--pg-hl-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: 'var(--pg-hl-string)' },
  { tag: [t.number, t.atom, t.bool], color: 'var(--pg-hl-number)' },
  { tag: t.keyword, color: 'var(--pg-hl-keyword)', fontWeight: '600' },
  { tag: [t.definition(t.variableName), t.function(t.variableName)], color: 'var(--pg-hl-def)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--pg-hl-attr)' },
  { tag: t.meta, color: 'var(--pg-hl-event)' },
  { tag: t.heading, color: 'var(--pg-hl-keyword)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--pg-hl-attr)', textDecoration: 'underline' },
  { tag: [t.url, t.monospace], color: 'var(--pg-hl-string)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.quote], color: 'var(--pg-hl-comment)' },
]);
