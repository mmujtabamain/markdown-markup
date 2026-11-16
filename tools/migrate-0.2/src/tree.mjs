// The 0.3 side of the migration: a small mirror of the 0.3 syntax tree (targets/rust/compiler/syntax/src/ast.rs)
// and a printer for it. The migration builds this tree and never writes 0.3 source by string pasting.
// What it prints is valid 0.3 in the canonical layout as far as the printer knows it; `mkp fmt` then
// reads it with the real parser and prints it with the real printer, so the file that is written is
// exactly what `mkp fmt --check` accepts.
//
// Why a mirror and not the Rust tree itself: mkp-syntax's tree is lossless and holds spans into the
// source it was read from, and it has no Deserialize, so a tool outside the Rust workspace can't hand
// it a tree. A Rust port of this tool would build mkp_syntax::ast directly (see README).

// ---------------------------------------------------------------------------------------------
// Expressions

export const E = {
  num: (v) => ({ k: 'num', v: String(v) }),
  bool: (v) => ({ k: 'bool', v: !!v }),
  /** a text literal; `parts` are strings and holes (expressions) */
  text: (...parts) => ({ k: 'text', parts }),
  dur: (ms) => ({ k: 'dur', ms }),
  name: (n) => ({ k: 'name', n }),
  state: (n) => ({ k: 'state', n }),
  /** type.CASE, or type.CASE(args) */
  case: (type, name, args) => ({ k: 'case', type, name, args }),
  none: () => ({ k: 'case', type: 'opt', name: 'NONE' }),
  rec: (type, fields) => ({ k: 'rec', type, fields }),
  list: (items, multiline = false) => ({ k: 'list', items, multiline }),
  field: (o, n) => ({ k: 'field', o, n }),
  index: (o, i) => ({ k: 'index', o, i }),
  method: (o, n, args = []) => ({ k: 'method', o, n, args }),
  call: (fn, args = []) => ({ k: 'call', fn, args }),
  bin: (op, a, b) => ({ k: 'bin', op, a, b }),
  un: (op, a) => ({ k: 'un', op, a }),
  cond: (c, a, b) => ({ k: 'cond', c, a, b }),
  range: (lo, hi) => ({ k: 'range', lo, hi }),
  /** fn(params) { body }; params are names, or [name, type] */
  lambda: (params, body) => ({ k: 'lambda', params, body }),
  /** @name(args) as a value */
  view: (call) => ({ k: 'view', call }),
};

/**
 * Comments that go with an item of a list, an argument or a parameter: `before` on lines of their
 * own above it, `after` at the end of its line. A noted item makes its list print one item a line.
 */
export function noted(e, before = [], after = null) {
  return before.length || after ? { k: 'noted', e, before, after } : e;
}

const commentLines = (lines, ind) => lines.map((l) => `${ind}// ${l}`.trimEnd()).join('\n') + (lines.length ? '\n' : '');
const afterOf = (x) => (x?.k === 'noted' && x.after ? ` // ${x.after}` : '');
const bare = (x) => (x?.k === 'noted' ? x.e : x);
const isNoted = (x) => x?.k === 'noted';

const PREC = { '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, in: 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };
// equality and comparisons don't chain, so their operands sit one level tighter
const NONASSOC = new Set(['==', '!=', '<', '<=', '>', '>=', 'in']);

function prec(e) {
  switch (e.k) {
    case 'cond':
      return 1;
    case 'bin':
      return PREC[e.op];
    case 'un':
      return 8;
    case 'num':
      return e.v.startsWith('-') ? 8 : 10;
    case 'range':
    case 'lambda':
      return 0;
    default:
      return 10;
  }
}

/** A text literal's body: its escapes, and its holes. */
export function textBody(parts, ind) {
  return parts
    .map((p) =>
      typeof p === 'string'
        ? p.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`)
        : `\\{${expr(p, ind)}}`,
    )
    .join('');
}

const IND = '    ';

export function expr(e, ind = '') {
  const wrap = (x, min) => (prec(x) < min ? `(${expr(x, ind)})` : expr(x, ind));
  switch (e.k) {
    case 'num':
      return e.v;
    case 'bool':
      return e.v ? 'true' : 'false';
    case 'text':
      return `"${textBody(e.parts, ind)}"`;
    case 'dur':
      return e.ms % 1000 === 0 && e.ms !== 0 ? `${e.ms / 1000}s` : `${e.ms}ms`;
    case 'name':
      return e.n;
    case 'state':
      return `$state.${e.n}`;
    case 'case':
      return `${e.type}.${e.name}${e.args ? `(${e.args.map((a) => expr(a, ind)).join(', ')})` : ''}`;
    case 'rec':
      return `${e.type ? e.type + ' ' : ''}{ ${e.fields.map(([n, v]) => `${n} = ${expr(v, ind)}`).join(', ')}${e.fields.length ? ' ' : ''}}`;
    case 'list':
      if (!e.items.length) return '[]';
      if (e.multiline || e.items.some(isNoted))
        return `[\n${e.items.map((x) => `${isNoted(x) ? commentLines(x.before, ind + IND) : ''}${ind}${IND}${expr(bare(x), ind + IND)},${afterOf(x)}\n`).join('')}${ind}]`;
      return `[${e.items.map((x) => expr(x, ind)).join(', ')}]`;
    case 'noted':
      return expr(e.e, ind);
    case 'field':
      return `${wrap(e.o, 9)}.${e.n}`;
    case 'index':
      return `${wrap(e.o, 9)}[${expr(e.i, ind)}]`;
    case 'method':
      return `${wrap(e.o, 9)}.${e.n}(${e.args.map((a) => expr(a, ind)).join(', ')})`;
    case 'call':
      return `${e.fn}(${e.args.map((a) => expr(a, ind)).join(', ')})`;
    case 'bin': {
      const p = PREC[e.op];
      const lmin = NONASSOC.has(e.op) ? p + 1 : p;
      return `${wrap(e.a, lmin)} ${e.op} ${wrap(e.b, p + 1)}`;
    }
    case 'un':
      return `${e.op}${wrap(e.a, 8)}`;
    case 'cond':
      return `${wrap(e.c, 2)} ? ${wrap(e.a, 1)} : ${wrap(e.b, 1)}`;
    case 'range': {
      // a bound is a number, a name or a bracketed expression
      const bound = (b) => (b.k === 'num' || b.k === 'name' ? expr(b, ind) : `(${expr(b, ind)})`);
      return `${bound(e.lo)}..${bound(e.hi)}`;
    }
    case 'lambda': {
      const ps = e.params.map((p) => (Array.isArray(p) ? `${p[0]}: ${p[1]}` : p)).join(', ');
      if (e.body.length === 1 && e.body[0].k !== 'comment') return `fn(${ps}) { ${stmtLine(e.body[0], ind).trim()} }`;
      return `fn(${ps}) {\n${stmts(e.body, ind + IND)}${ind}}`;
    }
    case 'view':
      return callHead(e.call, ind);
  }
  throw new Error(`tree: no printer for expression ${e.k}`);
}

// ---------------------------------------------------------------------------------------------
// Statements (view code and fn bodies)

export const S = {
  /** @name(args); or with children / named slots */
  call: (name, args = [], children = null, slots = null) => ({ k: 'call', name, args, children, slots }),
  if: (branches, otherwise = null) => ({ k: 'if', branches, otherwise }),
  for: (name, over, body, key = null, mut = false) => ({ k: 'for', name, over, body, key, mut }),
  match: (subject, cases) => ({ k: 'match', subject, cases }),
  let: (name, type, value) => ({ k: 'let', name, type, value }),
  mut: (name, type, value) => ({ k: 'mutvar', name, type, value }),
  assign: (place, value) => ({ k: 'assign', place, value }),
  expr: (e) => ({ k: 'expr', e }),
  ret: (e) => ({ k: 'return', e }),
  invoke: (name, args = []) => ({ k: 'invoke', name, args }),
  comment: (text) => ({ k: 'comment', text }),
  /** a blank line, kept where the author grouped statements */
  blank: () => ({ k: 'blank' }),
};

function callHead(c, ind) {
  const args = c.args.map(([n, v]) => `${n} = ${expr(bare(v), ind + IND)}`);
  const one = args.join(', ');
  if (!args.length) return `@${c.name}`;
  const noted = c.args.some(([, v]) => isNoted(v));
  if (!noted && !one.includes('\n') && one.length + ind.length + c.name.length < 100) return `@${c.name}(${one})`;
  return `@${c.name}(\n${c.args.map(([, v], i) => `${isNoted(v) ? commentLines(v.before, ind + IND) : ''}${ind}${IND}${args[i]},${afterOf(v)}\n`).join('')}${ind})`;
}

function stmtLine(s, ind) {
  switch (s.k) {
    case 'let':
      return `${ind}let ${s.name}: ${s.type} = ${expr(s.value, ind)};`;
    case 'mutvar':
      return `${ind}mut ${s.name}: ${s.type} = ${expr(s.value, ind)};`;
    case 'assign':
      return `${ind}${expr(s.place, ind)} = ${expr(s.value, ind)};`;
    case 'expr':
      return `${ind}${expr(s.e, ind)};`;
    case 'return':
      return `${ind}return${s.e ? ' ' + expr(s.e, ind) : ''};`;
    case 'invoke':
      return `${ind}invoke ${s.name}(${s.args.map((a) => expr(a, ind)).join(', ')});`;
    case 'comment':
      return s.text.split('\n').map((l) => `${ind}// ${l}`.trimEnd()).join('\n');
    case 'blank':
      return '';
  }
  return stmt(s, ind).replace(/\n$/, '');
}

function cond(c, ind) {
  return c.k === 'open' ? `let ${c.name}: ${c.type} = ${expr(c.value, ind)}` : expr(c, ind);
}

export function stmt(s, ind) {
  switch (s.k) {
    case 'call': {
      const head = `${ind}${callHead(s, ind)}`;
      if (s.slots?.length) return `${head} {\n${s.slots.map(([n, body]) => `${ind}${IND}${n} {\n${stmts(body, ind + IND + IND)}${ind}${IND}}\n`).join('')}${ind}}\n`;
      if (s.children) return `${head} {\n${stmts(s.children, ind + IND)}${ind}}\n`;
      return `${head};\n`;
    }
    case 'if': {
      let out = `${ind}if (${cond(s.branches[0][0], ind)}) {\n${stmts(s.branches[0][1], ind + IND)}${ind}}`;
      for (const [c, b] of s.branches.slice(1)) out += ` else if (${cond(c, ind)}) {\n${stmts(b, ind + IND)}${ind}}`;
      if (s.otherwise) out += ` else {\n${stmts(s.otherwise, ind + IND)}${ind}}`;
      return out + '\n';
    }
    case 'for':
      return `${ind}${s.mut ? 'mut ' : ''}for (${s.key ? s.key + ', ' : ''}${s.name} in ${expr(s.over, ind)}) {\n${stmts(s.body, ind + IND)}${ind}}\n`;
    case 'match':
      return `${ind}match (${expr(s.subject, ind)}) {\n${s.cases.map(([pats, body]) => `${ind}${IND}case ${pats.join(', ')} {\n${stmts(body, ind + IND + IND)}${ind}${IND}}\n`).join('')}${ind}}\n`;
  }
  return stmtLine(s, ind) + '\n';
}

export function stmts(list, ind) {
  return list.map((s) => (s.k === 'blank' ? '\n' : stmt(s, ind))).join('');
}

// ---------------------------------------------------------------------------------------------
// Declarations

export const D = {
  import: (name) => ({ k: 'import', name }),
  comment: (text) => ({ k: 'comment', text }),
  enum: (name, cases, about) => ({ k: 'enum', name, cases, about }),
  /** fields: { name, type, default? } */
  record: (name, fields, about) => ({ k: 'record', name, fields, about }),
  /** fields: { name, type, default } */
  state: (fields) => ({ k: 'state', fields }),
  let: (name, type, value, about) => ({ k: 'let', name, type, value, about }),
  fn: (name, params, ret, body, about) => ({ k: 'fn', name, params, ret, body, about }),
  /**
   * w: { name, about, params: [{name, type, default?, about?, mut?}], slots: [[name, type]], events: [name],
   *      body: Stmt[] (own mut/let/fn, as statements and fn decls), view: Stmt[] | null, markdown: Prose[] | null,
   *      extern: bool, comments: string[] (above it) }
   */
  widget: (w) => ({ k: 'widget', ...w }),
  pack: (name, version, uses, provides) => ({ k: 'pack', name, version, uses, provides }),
};

function docLines(about, params = []) {
  const out = [];
  if (about) for (const l of about.split('\n')) out.push(`//@about ${l}`.trimEnd());
  for (const p of params) if (p.about) out.push(`//@param ${p.name} ${p.about.replace(/\n/g, ' ')}`);
  return out;
}

function field(f, ind) {
  return `${f.mut ? 'mut ' : ''}${f.name}: ${f.type}${f.default ? ` = ${expr(f.default, ind)}` : ''}`;
}

/** A parameter list: on one line when it fits and holds no comments, one parameter a line otherwise. */
function params(ps, head) {
  const one = ps.map((p) => field(p, IND)).join(', ');
  if (one.length + head.length < 96 && !ps.some((p) => p.comments?.length || p.trailing)) return `${head}(${one})`;
  return `${head}(\n${ps.map((p) => `${commentLines(p.comments ?? [], IND)}${IND}${field(p, IND)},${p.trailing ? ` // ${p.trailing}` : ''}\n`).join('')})`;
}

export function decl(d) {
  switch (d.k) {
    case 'import':
      return `import ${d.name};`;
    case 'comment':
      return d.text.split('\n').map((l) => `// ${l}`.trimEnd()).join('\n');
    case 'enum':
      return [...docLines(d.about), `enum ${d.name} { ${d.cases.join(', ')} }`].join('\n');
    case 'record':
      return [...docLines(d.about), `record ${d.name} {`, ...d.fields.map((f) => `${IND}${field(f, IND)};`), '}'].join('\n');
    case 'state':
      return ['$state {', ...d.fields.flatMap((f) => [...(f.comments ?? []).map((c) => `${IND}// ${c}`.trimEnd()), `${IND}${field(f, IND)};`]), '}'].join('\n');
    case 'let':
      return [...docLines(d.about), `let ${d.name}: ${d.type} = ${expr(d.value, '')};`].join('\n');
    case 'fn':
      return [...docLines(d.about), `fn ${d.name}(${d.params.map(([n, t]) => (t ? `${n}: ${t}` : n)).join(', ')})${d.ret ? `: ${d.ret}` : ''} {`, stmts(d.body, IND).trimEnd(), '}'].join('\n');
    case 'pack':
      return [`pack ${d.name}@${d.version} {`, `${IND}uses ${d.uses.join(', ')};`, `${IND}provides ${d.provides.join(', ')};`, '}'].join('\n');
    case 'widget':
      return widget(d);
  }
  throw new Error(`tree: no printer for declaration ${d.k}`);
}

function widget(w) {
  const lines = [...(w.comments ?? []).map((c) => `// ${c}`.trimEnd()), ...docLines(w.about, w.params)];
  const open = params(w.params, `${w.extern ? 'extern ' : ''}widget ${w.name}`);
  const body = [];
  if (w.slots?.length) body.push(w.slots.map(([n, t]) => `${IND}slot ${n}: ${t};`).join('\n'));
  if (w.events?.length) body.push(w.events.map((e) => (typeof e === 'string' ? `${IND}event ${e}();` : `${commentLines(e.comments ?? [], IND)}${IND}event ${e.name}();`)).join('\n'));
  // the widget's own variables and fns, grouped as the author grouped them (S.blank between groups)
  if (w.body?.length) {
    const groups = [[]];
    for (const b of w.body) b.k === 'blank' ? groups.push([]) : groups[groups.length - 1].push(b.k === 'fndecl' ? fnDecl(b, IND) : stmt(b, IND).trimEnd());
    for (const g of groups) if (g.length) body.push(g.join('\n'));
  }
  if (w.view) body.push(`${IND}view {\n${stmts(w.view, IND + IND)}${IND}}`);
  if (w.markdown) body.push(`${IND}markdown {\n${prose(w.markdown, IND + IND)}\n${IND}}`);
  if (!body.length) return [...lines, `${open};`].join('\n');
  return [...lines, `${open} {`, body.join('\n\n'), '}'].join('\n');
}

export function fnDecl(f, ind) {
  const ps = f.params.map(([n, t]) => `${n}: ${t}`).join(', ');
  return [...(f.comments ?? []).map((c) => `${ind}// ${c}`.trimEnd()), ...(f.about ? [`${ind}//@about ${f.about}`] : []), `${ind}fn ${f.name}(${ps})${f.ret ? `: ${f.ret}` : ''} {`, stmts(f.body, ind + IND).trimEnd(), `${ind}}`].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Prose (below the @@@ line, and in markdown blocks)

export const P = {
  /** Markdown lines, already escaped for 0.3 prose */
  md: (text) => ({ k: 'md', text }),
  /** @name(args); or @name(args) { prose } or with @slot blocks */
  call: (name, args = [], body = null, slots = null) => ({ k: 'call', name, args, body, slots }),
  for: (name, over, body) => ({ k: 'for', name, over, body }),
  if: (c, then, otherwise = null) => ({ k: 'if', c, then, otherwise }),
};

function proseNode(n, ind, tight) {
  switch (n.k) {
    case 'md':
      return n.text
        .split('\n')
        .map((l) => (l ? ind + l : ''))
        .join('\n');
    case 'call': {
      const head = ind + callHead(n, ind);
      if (n.slots?.length) return `${head} {\n${n.slots.map(([s, body]) => `${ind}@slot ${s} {\n${prose(body, ind, tight)}\n${ind}}`).join('\n')}\n${ind}}`;
      if (n.body) return `${head} {\n${prose(n.body, ind, tight)}\n${ind}}`;
      return `${head};`;
    }
    case 'for':
      return `${ind}@for (${n.name} in ${expr(n.over, ind)}) {\n${prose(n.body, ind, true)}\n${ind}}`;
    case 'if':
      return `${ind}@if (${cond(n.c, ind)}) {\n${prose(n.then, ind, true)}\n${ind}}${n.otherwise ? ` else {\n${prose(n.otherwise, ind, true)}\n${ind}}` : ''}`;
  }
  throw new Error(`tree: no printer for prose ${n.k}`);
}

/** Prose blocks, a blank line between them (none inside a markdown block's loops: tight). */
export function prose(nodes, ind = '', tight = false) {
  return nodes.map((n) => proseNode(n, ind, tight)).join(tight ? '\n' : '\n\n');
}

// ---------------------------------------------------------------------------------------------
// Files

/** A .mkp.md document: front matter, definitions, the @@@ line, prose. */
export function document({ front, decls, body }) {
  const parts = [];
  if (front) parts.push(front.trimEnd());
  const defs = decls.map(decl).join('\n\n');
  // with no definitions the whole file is the document, and no @@@ line is needed
  if (defs) parts.push(defs + '\n@@@');
  parts.push(prose(body));
  return parts.join('\n') + '\n';
}

/** A pack's .mkp file. */
export function packFile(pkg, decls) {
  return `package ${pkg};\n\n${decls.map(decl).join('\n\n')}\n`;
}
