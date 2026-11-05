// Where each key and list item of a YAML text is (GAPS 165): "items[1].city" → line and column,
// so a block's errors point at the exact option or step, inside list items too.

import YAML, { isMap, isPair, isScalar, isSeq, type Node } from 'yaml';

export interface YamlAt {
  line: number;
  col: number;
}

/** Positions (1-based, relative to the text) of every key path and list item in a YAML text. */
export function yamlPositions(text: string): Map<string, YamlAt> {
  const out = new Map<string, YamlAt>();
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(text, { keepSourceTokens: true, uniqueKeys: false });
  } catch {
    return out;
  }
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const at = (offset: number): YamlAt => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - starts[lo] + 1 };
  };
  const visit = (n: Node | null | undefined, path: string): void => {
    if (!n) return;
    if (isMap(n)) {
      for (const it of n.items) {
        if (!isPair(it) || !isScalar(it.key)) continue;
        const key = String(it.key.value);
        const p = path ? `${path}.${key}` : key;
        if (it.key.range) out.set(p, at(it.key.range[0]));
        visit(it.value as Node, p);
      }
    } else if (isSeq(n)) {
      n.items.forEach((it, i) => {
        const p = `${path}[${i}]`;
        const r = (it as Node)?.range;
        if (r) out.set(p, at(r[0]));
        visit(it as Node, p);
      });
    }
  };
  visit(doc.contents as Node, '');
  return out;
}
