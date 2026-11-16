// What the 0.2 IR leaves out, read from the 0.2 source beside it: HTML comments and link reference
// definitions in prose, comments in YAML blocks, the order the YAML wrote its keys in, and where each
// ::: container ends. Everything is found by line, and placed by the IR's own positions: each IR node
// carries the line it starts on. Code comments need none of this: 0.2's IR keeps them (a definition's,
// an input's, a value's and a view node's `comment`).

/**
 * @returns {{
 *   prose: { kind: 'html'|'linkref', line: number, end: number, text: string }[],
 *   yaml: Map<number, Yaml>,      // by the line of the block's opening fence
 *   ends: Map<number, number>,    // a ::: container's first line → its closing line
 *   front: string | null,         // the front matter as written, --- lines included
 * }}
 */
export function readSource(text) {
  const lines = text.split('\n');
  const prose = [];
  const yaml = new Map();
  const ends = new Map();
  let i = 0;
  let front = null;
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) {
      front = lines.slice(0, close + 1).join('\n') + '\n';
      i = close + 1;
    }
  }
  const open = []; // ::: containers: [colons, line]
  for (; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (fence) {
      // a fence: skipped whole; a widget block's YAML is read for its comments
      const mark = fence[1];
      const start = i;
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[j])) j++;
      const info = fence[2].trim().split(/\s+/)[0] ?? '';
      if (info && info !== 'mkp' && info !== 'state') yaml.set(start + 1, readYaml(lines.slice(start + 1, j)));
      i = j;
      continue;
    }
    const c = /^(:{3,})\s*([A-Za-z].*)?$/.exec(l);
    if (c) {
      if (c[2]) open.push([c[1].length, i + 1]);
      else {
        for (let k = open.length - 1; k >= 0; k--)
          if (open[k][0] === c[1].length) {
            ends.set(open[k][1], i + 1);
            open.splice(k);
            break;
          }
      }
      continue;
    }
    if (/^ {0,3}<!--/.test(l)) {
      let j = i;
      while (j < lines.length && !lines[j].includes('-->')) j++;
      prose.push({ kind: 'html', line: i + 1, end: j + 1, text: lines.slice(i, j + 1).join('\n') });
      i = j;
      continue;
    }
    if (/^ {0,3}\[[^\]^][^\]]*\]:\s*\S/.test(l)) prose.push({ kind: 'linkref', line: i + 1, end: i + 1, text: l.trim() });
  }
  return { prose, yaml, ends, front };
}

/**
 * A YAML block's comments and key order. A comment on a line of its own goes with the key or list item
 * that follows it; one at the end of a line, with that line's key or item.
 * @typedef {{ order: string[], keys: Map<string, Note>, items: Map<string, Note[]>, fields: Map<string, Map<string, Note>[]>, count: number }} Yaml
 * @typedef {{ before: string[], after: string | null }} Note
 */
function readYaml(lines) {
  const out = { order: [], keys: new Map(), items: new Map(), fields: new Map(), count: 0 };
  let pending = [];
  let key = null; // the top-level key a list belongs to
  let item = -1;
  const note = () => ({ before: [], after: null });
  for (const raw of lines) {
    const own = /^\s*#\s?(.*)$/.exec(raw);
    if (own) {
      pending.push(own[1]);
      out.count++;
      continue;
    }
    const [l, after] = splitComment(raw);
    if (after !== null) out.count++;
    if (!l.trim()) continue;
    const top = /^([A-Za-z_][\w-]*):/.exec(l);
    if (top) {
      key = top[1];
      item = -1;
      out.order.push(key);
      const n = out.keys.get(key) ?? note();
      n.before.push(...pending);
      n.after = after ?? n.after;
      out.keys.set(key, n);
      pending = [];
      continue;
    }
    const li = /^(\s*)-\s?(.*)$/.exec(l);
    if (li && key) {
      item++;
      const list = out.items.get(key) ?? [];
      list[item] = { before: pending, after };
      out.items.set(key, list);
      pending = [];
      continue;
    }
    // a field of a record written one field a line under its "- "
    const f = /^\s+([A-Za-z_][\w-]*):/.exec(l);
    if (f && key && item >= 0 && (pending.length || after !== null)) {
      const fs = out.fields.get(key) ?? [];
      (fs[item] ??= new Map()).set(f[1], { before: pending, after });
      out.fields.set(key, fs);
      pending = [];
    }
  }
  // comments after the last line go with the last key
  if (pending.length && key) out.keys.get(key).after = [out.keys.get(key).after, ...pending].filter(Boolean).join(' ');
  return out;
}

/** A YAML line and its end-of-line comment: a # after a space, outside quotes. */
function splitComment(l) {
  let q = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) {
      if (c === q && l[i - 1] !== '\\') q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(l[i - 1]))) return [l.slice(0, i), l.slice(i + 1).trim()];
  }
  return [l, null];
}

/**
 * Every comment in a 0.2 document, for measuring what a migration keeps: the front matter's, HTML
 * comments and link reference definitions in prose, YAML comments in widget blocks, and comments in
 * ```mkp and ```state fences.
 */
export function sourceComments(text) {
  const out = [];
  const lines = text.split('\n');
  let i = 0;
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    for (let k = 1; k < close; k++) if (/^\s*#/.test(lines[k])) out.push({ kind: 'front matter', text: lines[k].replace(/^\s*#\s?/, '') });
    i = close + 1;
  }
  for (; i < lines.length; i++) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence) {
      const info = fence[2].trim().split(/\s+/)[0] ?? '';
      let j = i + 1;
      const close = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      for (; j < lines.length && !close.test(lines[j]); j++) {
        if (!info || /^(txt|text|markdown|java|json|ts|js|yaml|rust|python|bash|sh|kotlin|html|mermaid|math|tex|sql|toml|css|diff|go|console)$/i.test(info)) continue;
        const kind = info === 'mkp' ? 'mkp' : info === 'state' ? 'state' : 'yaml';
        const own = /^\s*#\s?(.*)$/.exec(lines[j]);
        if (own && !(kind === 'mkp' && /^#\s*mkp \d/.test(lines[j]))) out.push({ kind, text: own[1] });
        else {
          const [, after] = splitComment(lines[j]);
          if (after && kind !== 'mkp') out.push({ kind, text: after });
        }
      }
      i = j;
      continue;
    }
    if (/^ {0,3}<!--/.test(lines[i])) {
      let j = i;
      while (j < lines.length && !lines[j].includes('-->')) j++;
      out.push({ kind: 'html', text: lines.slice(i, j + 1).join('\n').replace(/^\s*<!--|-->\s*$/g, '').trim() });
      i = j;
      continue;
    }
    if (/^ {0,3}\[[^\]^][^\]]*\]:\s*\S/.test(lines[i])) out.push({ kind: 'link definition', text: lines[i].trim() });
  }
  return out.filter((c) => c.text.trim());
}

/** Whether a migration's output still has a comment's words (as a comment or in place). */
export function kept(comment, outputs) {
  const words = (t) => t.replace(/\/\/\s?|<!--|-->/g, ' ').replace(/\s+/g, ' ').trim();
  const w = words(comment.text);
  return outputs.some((o) => words(o).includes(w));
}
