// pnpm examples:coverage — every extern, control, action, event and language feature appears in
// at least one example, and every core GAPS fix in doc #1129 §8 is proved by an example or a
// conformance case. pnpm examples:sync [--write] — every copy of an example in the docs
// (<!-- example 05-counter --> then a fenced block) is the example as it is (doc #1129 §9.2).
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile, type IRBundle, type IRNode, type PackSource } from '../packages/core/src/index';

const root = process.cwd();
const exDir = join(root, 'examples');

function folder(d: string): PackSource {
  const files = new Map<string, Uint8Array>();
  const walk = (x: string): void => {
    for (const n of readdirSync(x)) {
      const p = join(x, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(d, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(d);
  return { files, label: relative(root, d) };
}

interface Ex {
  name: string;
  text: string;
  front: Record<string, unknown>;
  bundle: IRBundle;
}

function examples(): Ex[] {
  return readdirSync(exDir)
    .filter((n) => /^\d\d-/.test(n) && existsSync(join(exDir, n, 'doc.mkp.md')))
    .sort()
    .map((name) => {
      const d = join(exDir, name);
      const text = readFileSync(join(d, 'doc.mkp.md'), 'utf8');
      const own = join(d, 'doc.mkp');
      const c = compile({ packs: ['pack', 'host'].filter((p) => existsSync(join(d, p))).map((p) => folder(join(d, p))) });
      const b = c.document(text, `examples/${name}/doc.mkp.md`, undefined, { docFile: existsSync(own) ? { text: readFileSync(own, 'utf8'), file: own } : undefined });
      if (!b) throw new Error(`${name} does not compile: ${c.diags.errors.map((x) => x.message).join('; ')}`);
      return { name, text, front: b.doc.front, bundle: b };
    });
}

/** The core GAPS fixes of doc #1129 §8 that nothing a reader sees can show: conformance cases. */
const CONFORMANCE_ONLY = new Set([5, 12, 14, 15, 35, 42, 43, 47, 48, 49, 53, 73, 83, 87, 88, 92, 105, 110, 111, 112, 115, 120, 128, 130, 136, 137, 153, 162, 165]);
const CORE_GAPS = [
  // W1–W8 and the runtime, as listed in doc #1129 §8
  42, 43, 44, 47, 67, 82, 83, 101, 103, 105, 110, 111, 117, 127, 128, 132, 136, 137, 138, 155, 157, 166,
  19, 29, 41, 53, 73, 79, 80, 86, 98, 99, 120, 123, 125, 130, 142, 145, 148, 149, 150, 151, 154, 159,
  18, 30, 104, 160,
  52, 66, 92, 93, 100, 106, 107, 108, 109, 113, 114, 122, 126, 129, 140, 141, 143,
  2, 3, 4, 5, 33, 62, 158,
  68, 81, 96, 124, 146, 156, 169,
  12, 34, 35, 163, 165,
  14, 48, 49, 87, 88, 115, 162, 168,
  153, 112,
];

function coverage(): number {
  const exs = examples();
  const seen = { externs: new Map<string, string[]>(), controls: new Map<string, string[]>(), actions: new Map<string, string[]>(), events: new Map<string, string[]>(), features: new Map<string, string[]>() };
  const add = (m: Map<string, string[]>, k: string, ex: string): void => {
    const l = m.get(k) ?? [];
    if (!l.includes(ex)) l.push(ex);
    m.set(k, l);
  };
  for (const ex of exs) {
    const b = ex.bundle;
    const visitActions = (acts: { a: string; actions?: unknown[] }[]): void => {
      for (const a of acts) {
        add(seen.actions, a.a, ex.name);
        if (a.a === 'when') add(seen.features, 'if= on an event line', ex.name);
        if (a.actions) visitActions(a.actions as { a: string }[]);
      }
    };
    const visit = (ns: IRNode[] | undefined): void => {
      for (const n of ns ?? []) {
        if (n.def?.startsWith('core:')) add(seen.externs, n.node, ex.name);
        for (const [ev, acts] of Object.entries(n.on ?? {})) {
          add(seen.events, ev, ex.name);
          visitActions(acts);
        }
        if (n.node === 'arrow') add(seen.features, 'arrow', ex.name);
        if (n.meta?.self) add(seen.features, 'self=', ex.name);
        if (n.meta?.keep) add(seen.features, 'keep=', ex.name);
        visit(n.children);
        visit(n.records);
        for (const c of n.cases ?? []) visit(c.children);
        visit(n.else);
        for (const f of Object.values(n.fills ?? {})) visit(f);
      }
    };
    visit(b.doc.body);
    for (const d of Object.values(b.defs)) {
      if (d.kind === 'extern') continue;
      visit(d.view);
      for (const v of d.values ?? []) {
        if (v.k === 'state') {
          add(seen.controls, v.control, ex.name);
          for (const acts of Object.values(v.on ?? {})) visitActions(acts);
        }
      }
      if (d.inline && d.pack === '$doc' && d.name !== 'document') add(seen.features, 'inline definition', ex.name);
      if (d.params?.length) add(seen.features, 'type parameters', ex.name);
      if (d.implements?.length) add(seen.features, 'implements', ex.name);
      if (d.inputs.some((i) => i.answer)) add(seen.features, 'answer input', ex.name);
      if (d.project?.mermaid) add(seen.features, 'project mermaid', ex.name);
      if (d.pack !== '$doc' && d.pack !== 'core') add(seen.features, 'a pack', ex.name);
      if (d.kind === 'part') add(seen.features, 'part', ex.name);
      const src = JSON.stringify(d);
      if (src.includes('"$width"')) add(seen.features, 'width', ex.name);
      if (src.includes('"$answers"')) add(seen.features, 'answers', ex.name);
    }
    if (existsSync(join(exDir, ex.name, 'doc.mkp'))) add(seen.features, "the document's file", ex.name);
    if (/^# from /m.test(ex.text)) add(seen.features, 'a copy (show --source)', ex.name);
    if (b.types && Object.keys(b.types).some((k) => k.startsWith('$doc:'))) add(seen.features, 'a type of its own', ex.name);
    if (Object.values(b.fns).some((f) => f.op)) add(seen.features, 'operators', ex.name);
  }
  const want = {
    externs: ['paragraph', 'heading', 'list', 'quote', 'code', 'math', 'divider', 'table', 'footnote', 'image', 'text', 'column', 'row', 'grid', 'stack', 'press', 'field', 'range', 'overlay', 'meter', 'frame', 'pane', 'zoom', 'icon', 'canvas'],
    controls: ['slider', 'toggle', 'choice', 'steps', 'drag', 'clock'],
    actions: ['set', 'play', 'pause', 'reset', 'reveal', 'hide', 'open', 'close', 'emit', 'send', 'when'],
    events: ['click', 'change', 'submit', 'enter', 'leave'],
    features: ['inline definition', "the document's file", 'part', 'a type of its own', 'operators', 'type parameters', 'implements', 'answer input', 'answers', 'width', 'project mermaid', 'a pack', 'a copy (show --source)', 'if= on an event line', 'arrow', 'self=', 'keep='],
  };
  let gaps = 0;
  for (const [what, names] of Object.entries(want) as [keyof typeof want, string[]][]) {
    console.log(`\n${what}`);
    for (const n of names) {
      const hits = seen[what].get(n);
      if (!hits) gaps++;
      console.log(`  ${hits ? '✓' : '✗'} ${n.padEnd(24)} ${hits ? hits.slice(0, 4).join(', ') + (hits.length > 4 ? ` +${hits.length - 4}` : '') : 'in no example'}`);
    }
  }
  // GAPS fixes: proved by an example's front matter, or listed as conformance-only
  const proved = new Map<number, string[]>();
  for (const ex of exs) for (const g of (ex.front.gaps as number[] | undefined) ?? []) proved.set(g, [...(proved.get(g) ?? []), ex.name]);
  const missing = CORE_GAPS.filter((g) => !proved.has(g) && !CONFORMANCE_ONLY.has(g));
  console.log(`\nGAPS core fixes: ${CORE_GAPS.length - missing.length}/${CORE_GAPS.length} proved by an example (${[...CONFORMANCE_ONLY].filter((g) => !proved.has(g)).length} by conformance cases only)`);
  if (missing.length) {
    gaps += missing.length;
    console.log(`  ✗ in no example and not conformance-only: ${missing.join(', ')}`);
  }
  console.log(gaps ? `\n${gaps} gaps` : '\nno gaps');
  return gaps ? 1 : 0;
}

/** Docs that hold copies of examples or recipe files, by marker. */
const DOCS = ['docs/authoring-guide.md', 'docs/recipes.md', 'README.md'];

function sync(write: boolean): number {
  let drift = 0;
  for (const rel of DOCS) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const out = text.replace(/<!-- example ([\w-]+) -->\n(`{3,})(\w*)\n([\s\S]*?)\n\2/g, (m, name: string, fence: string, lang: string) => {
      const file = join(exDir, name, 'doc.mkp.md');
      if (!existsSync(file)) {
        console.error(`${rel}: no example ${name}`);
        drift++;
        return m;
      }
      // the copy leaves out the front matter: it says what the example teaches, not how to write it
      const body = readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '').trimEnd();
      const now = `<!-- example ${name} -->\n${fence}${lang}\n${body}\n${fence}`;
      if (now !== m) {
        drift++;
        console.error(`${rel}: the copy of ${name} differs from examples/${name}/doc.mkp.md${write ? ' (rewritten)' : ''}`);
      }
      return now;
    });
    // <!-- recipe vue/src/MkpView.vue --> then a fence: the recipe's file as it is
    const out2 = out.replace(/<!-- recipe ([\w./-]+) -->\n(`{3,})(\w*)\n([\s\S]*?)\n\2/g, (m, file: string, fence: string, lang: string) => {
      const f = join(root, 'recipes', file);
      if (!existsSync(f)) {
        console.error(`${rel}: no recipe file ${file}`);
        drift++;
        return m;
      }
      const now = `<!-- recipe ${file} -->\n${fence}${lang}\n${readFileSync(f, 'utf8').trimEnd()}\n${fence}`;
      if (now !== m) {
        drift++;
        console.error(`${rel}: the copy of ${file} differs from recipes/${file}${write ? ' (rewritten)' : ''}`);
      }
      return now;
    });
    if (write && out2 !== text) writeFileSync(p, out2);
  }
  if (!drift) console.log('examples: every copy in the docs matches its example or recipe');
  return drift && !write ? 1 : 0;
}

const cmd = process.argv[2];
process.exit(cmd === 'coverage' ? coverage() : cmd === 'sync' ? sync(process.argv.includes('--write')) : (console.error('examples coverage | sync [--write]'), 2));
