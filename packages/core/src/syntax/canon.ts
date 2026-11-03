// Canonical expression source: whitespace normalised, redundant outer parentheses removed.

import { normalizeSource, skipMaths, skipString } from './lexer';

/** Removes parentheses around a whole expression (not a point's). */
export function stripParens(s: string): string {
  for (;;) {
    if (!s.startsWith('(') || !s.endsWith(')')) return s;
    let depth = 0;
    let wraps = true;
    let comma = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') {
        i = skipString(s, i) - 1;
        continue;
      }
      if (c === '$') {
        i = skipMaths(s, i) - 1;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth === 0 && i < s.length - 1) wraps = false;
      } else if (c === ',' && depth === 1) comma = true;
    }
    if (!wraps || comma) return s;
    s = s.slice(1, -1).trim();
  }
}

export function canonical(src: string): string {
  return stripParens(normalizeSource(src).trim());
}
