#!/usr/bin/env node
// What changed in MKP's API between two releases, read from the releases themselves, on four
// surfaces: JavaScript (the exports and signatures in the web files' .d.ts headers), the language
// (the base set's externs, its types and tokens, the icons, the names every definition reads), the
// CLI (its commands, flags and targets, from its help), and the IR and files (the IR's JSON Schemas,
// and the files in the web zip). It prints a changelog's `## API` section, ready to edit, or checks
// a changelog for what it leaves out (warnings only).
//
//   node scripts/api-diff.mjs [--from 0.2.2] [--to current|0.2.3]          the ## API section
//   node scripts/api-diff.mjs --check changelog/0.2.3.mkp.md [--from …]     what that section misses
//   node scripts/api-diff.mjs --first 0.1.0                                 what a first release provides
//   node scripts/api-diff.mjs --check-current                               pnpm check:api: VERSION's changelog
//
// A release's files are downloaded once from its GitHub release, checked against its SHA256SUMS, into
// MKP_CACHE (else ~/.cache/mkp/api/<version>/). `--to current` builds this checkout (scripts/dist.mjs).

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
export const RELEASES = 'https://github.com/mmujtabamain/markdown-markup/releases/download';
export const SURFACES = ['JavaScript', 'Language', 'CLI', 'IR and files'];
const KINDS = { added: 'Added', changed: 'Changed', deprecated: 'Deprecated', removed: 'Removed' };

const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// Reading a release

/** Where a release's files are kept, fetched (and checked) the first time. */
export async function releaseFiles(version) {
  const dir = join(process.env.MKP_CACHE ? join(process.env.MKP_CACHE, 'api') : join(homedir(), '.cache', 'mkp', 'api'), version);
  const web = join(dir, 'web');
  if (existsSync(join(web, 'mkp.js')) && existsSync(join(dir, 'mkp-cli.mjs'))) return { web, cli: join(dir, 'mkp-cli.mjs'), version };
  mkdirSync(web, { recursive: true });
  const get = async (name) => {
    const r = await fetch(`${RELEASES}/v${version}/${name}`);
    if (!r.ok) throw new Error(`couldn't download ${RELEASES}/v${version}/${name}: ${r.status} ${r.statusText}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const sums = new TextDecoder().decode(await get('SHA256SUMS'));
  const want = (name) => sums.split('\n').map((l) => l.trim().split(/\s+/)).find((x) => x[1] === name)?.[0];
  const zipName = `mkp-web-${version}.zip`;
  for (const name of [zipName, 'mkp-cli.mjs']) {
    const bytes = await get(name);
    const got = createHash('sha256').update(bytes).digest('hex');
    if (want(name) !== got) throw new Error(`${name} of ${version} doesn't match the release's SHA256SUMS; it was not used`);
    writeFileSync(join(dir, name === zipName ? 'web.zip' : name), bytes);
  }
  const { unzipSync } = createRequire(join(root, 'packages/core/package.json'))('fflate');
  for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(readFileSync(join(dir, 'web.zip')))))) if (!path.endsWith('/')) writeFileSync(join(web, path.slice(path.indexOf('/') + 1)), bytes);
  return { web, cli: join(dir, 'mkp-cli.mjs'), version };
}

/** This checkout's files, built as a release would be. */
export function currentFiles() {
  const out = mkdtempSync(join(tmpdir(), 'mkp-api-'));
  execFileSync(process.execPath, [join(root, 'scripts/dist.mjs'), '--out', out], { stdio: 'ignore' });
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  return { web: join(out, 'web'), cli: join(out, 'mkp-cli.mjs'), version };
}

/** A .d.ts file's exports: name → { kind, text, members }. Files that only re-export another are left out (their names are the other's). */
export function jsExports(file) {
  const ts = require('typescript');
  const program = ts.createProgram([file], { noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX });
  const sf = program.getSourceFile(file);
  const checker = program.getTypeChecker();
  const mod = sf && checker.getSymbolAtLocation(sf);
  if (!mod) return null;
  const onlyReexports = sf.statements.every((s) => ts.isExportDeclaration(s) && s.moduleSpecifier);
  if (onlyReexports) return null;
  const out = {};
  for (const sym of checker.getExportsOfModule(mod)) {
    let s = sym;
    if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    const d = s.declarations?.[0];
    if (!d) continue;
    // a name re-exported from the core file is that file's: the renderers' headers import their core types
    if (d.getSourceFile() !== sf) continue;
    const kind = ts.isFunctionDeclaration(d) ? 'function' : ts.isClassDeclaration(d) ? 'class' : ts.isInterfaceDeclaration(d) ? 'interface' : ts.isTypeAliasDeclaration(d) ? 'type' : ts.isEnumDeclaration(d) ? 'enum' : 'const';
    const node = ts.isVariableDeclaration(d) ? d.parent.parent : d;
    const entry = { kind, text: squash(node.getText(sf)) };
    const members = ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d) ? d.members : ts.isTypeAliasDeclaration(d) && ts.isTypeLiteralNode(d.type) ? d.type.members : null;
    if (members) {
      entry.members = {};
      for (const m of members) {
        const name = m.name?.getText(sf);
        if (!name || m.modifiers?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword) || name.startsWith('#')) continue;
        entry.members[name] = squash(m.getText(sf));
      }
      // the declaration minus its body: what changes besides the members
      entry.text = squash(entry.text.replace(/\{[\s\S]*\}\s*;?$/, '{…}'));
    }
    // overloads: every signature
    if (kind === 'function' && s.declarations.length > 1) entry.text = s.declarations.map((x) => squash(x.getText(sf))).join(' | ');
    out[sym.name] = entry;
  }
  return out;
}

/** The base set as written: each extern's members, its types, its tokens. */
export function language(coreMkp) {
  const externs = {};
  const types = {};
  const tokens = {};
  let cur = null;
  let block = null;
  for (const raw of coreMkp.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      cur = null;
      block = null;
      let m;
      if ((m = /^extern (\S+?)@\d+\s*(.*)$/.exec(line))) externs[(cur = m[1])] = { about: m[2], members: {} };
      else if ((m = /^type (\S+) = (.*)$/.exec(line))) types[m[1]] = squash(m[2]);
      else if (line.startsWith('tokens ')) block = 'tokens';
      continue;
    }
    if (block === 'tokens') {
      const [kind, ...rest] = line.split(/\s+/);
      // `space xs=2 s=4 …` names several at once; `color accent "#…" dark=…` one
      if (rest.every((r) => r.includes('='))) for (const r of rest) tokens[`${kind} ${r.split('=')[0]}`] = r.split('=')[1];
      else tokens[`${kind} ${rest[0]}`] = squash(rest.slice(1).join(' '));
      continue;
    }
    if (!cur) continue;
    const e = externs[cur];
    if (indent > 2 && e.last) {
      e.members[e.last] = squash(`${e.members[e.last]} ${line}`);
      continue;
    }
    const m = /^(in|out|fields|requires)\b\s*(\S*)/.exec(line);
    const key = m ? (m[1] === 'in' || m[1] === 'out' ? `${m[1]} ${m[2]}` : m[1]) : line.split(/\s+/)[0];
    e.members[key] = squash(line);
    e.last = key;
  }
  for (const e of Object.values(externs)) delete e.last;
  return { externs, types, tokens };
}

/** The names every definition reads (width, theme…): found by trying to declare each, as the release's own compiler refuses it. */
export function reservedNames(mod, candidates) {
  const out = [];
  for (const name of candidates) {
    const c = mod.compile({ packs: [] });
    c.document('```mkp\nw "x"\n  in ' + name + ' text = "a"\n  project md = "x"\n```\n\n```w\nsummary: s\n```\n', 'probe.mkp.md');
    if (c.diags.errors.some((d) => d.code === 'mkp.shadow' || d.code === 'mkp.reserved')) out.push(name);
  }
  return out;
}

/** The CLI from its help: each command's usage, each flag, and each --target value. */
export function cliSurface(help) {
  const commands = {};
  let cur = null;
  for (const raw of help.split('\n')) {
    const m = /^ {2}mkp (\S+)(.*)$/.exec(raw);
    if (m) {
      cur = m[1];
      commands[cur] = squash(`mkp ${m[1]}${m[2]}`);
    } else if (cur && /^ {4,}\S/.test(raw)) commands[cur] = squash(`${commands[cur]} ${raw}`);
    else cur = null;
  }
  const flags = {};
  const values = {};
  for (const [cmd, text] of Object.entries(commands)) {
    for (const f of new Set(text.match(/--[a-z][a-z-]*/g) ?? [])) flags[`mkp ${cmd} ${f}`] = true;
    for (const m of text.matchAll(/(--[a-z-]+) ([a-z][a-z-]*(?:\|[a-z][a-z-]*)+)/g)) for (const v of m[2].split('|')) values[`mkp ${cmd} ${m[1]} ${v}`] = true;
  }
  return { commands, flags, values };
}

/** The IR's JSON Schemas: each schema's properties (two levels), and which are required. */
export function irSurface(schemas) {
  const out = {};
  const name = (k) => k.replace(/^ir\//, '');
  for (const [k, s] of Object.entries(schemas)) {
    const walk = (node, path, depth) => {
      if (!node || typeof node !== 'object' || depth > 2) return;
      for (const [p, v] of Object.entries(node.properties ?? {})) {
        const key = `${path}.${p}`;
        out[key] = (node.required ?? []).includes(p) ? 'required' : 'optional';
        walk(v, key, depth + 1);
      }
    };
    walk(s, name(k), 1);
  }
  return out;
}

/** Everything a release offers, read from its files. */
export async function surfaceOf({ web, cli, version }, candidates = ['width', 'theme', 'answers']) {
  const mod = await import(pathToFileURL(join(web, 'mkp.js')).href);
  const js = {};
  for (const f of readdirSync(web).filter((x) => x.endsWith('.d.ts')).sort()) {
    const e = jsExports(join(web, f));
    if (e) js[f.replace(/\.d\.ts$/, '.js')] = e;
  }
  const help = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' }).stdout;
  return {
    version: version ?? mod.VERSION,
    js,
    lang: { ...language(mod.CORE_MKP), icons: [...mod.ICON_NAMES], reserved: reservedNames(mod, candidates) },
    cli: cliSurface(help),
    ir: irSurface(mod.IR_SCHEMAS),
    files: readdirSync(web).filter((f) => f !== 'README.txt').sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// The difference

/** Splits at a top-level separator (outside brackets and quotes). */
export function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{<'.includes(c)) depth++;
    else if (')]}>'.includes(c) && s[i - 1] !== '=') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i).trim());
      start = i + sep.length;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

/** The records written inside a type (record name {field, …}), with their fields by name. */
export function recordsIn(type) {
  const out = {};
  const re = /record (\w+) \{/g;
  let m;
  while ((m = re.exec(type))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < type.length && depth; i++) depth += type[i] === '{' ? 1 : type[i] === '}' ? -1 : 0;
    const body = type.slice(m.index + m[0].length, i - 1);
    const fields = {};
    for (const f of splitTop(body, ',')) {
      // a nested record list is its own record: here only its name
      const name = f.split(':')[0].trim();
      fields[name] = /record \w+ \{/.test(f) ? 'records' : f;
    }
    out[m[1]] = fields;
  }
  return out;
}

const LONG = 160;
const short = (t) => (t.length > LONG ? t.slice(0, LONG - 1) + '…' : t);

/** One change: its kind, surface, the name a changelog must mention, and a line saying what it is. */
const item = (kind, surface, key, text) => ({ kind, surface, key, text });

/** Compares two maps of name → text: added, removed, changed. */
function compare(a, b, surface, key, say) {
  const out = [];
  for (const k of Object.keys(b)) if (!(k in a)) out.push(item('added', surface, key(k), say('added', k, b[k])));
  for (const k of Object.keys(a)) if (!(k in b)) out.push(item('removed', surface, key(k), say('removed', k, a[k])));
  for (const k of Object.keys(a)) if (k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(item('changed', surface, key(k), say('changed', k, b[k], a[k])));
  return out;
}

/** Every change from release `a` to release `b`, by surface. */
export function diffSurfaces(a, b) {
  const out = [];
  // JavaScript: a file's exports, and an interface's or class's members one by one
  const files = new Set([...Object.keys(a.js), ...Object.keys(b.js)]);
  for (const f of files) {
    const x = a.js[f] ?? {};
    const y = b.js[f] ?? {};
    for (const n of Object.keys(y)) if (!(n in x)) out.push(item('added', 'JavaScript', n, `${y[n].kind} \`${n}\` in \`${f}\``));
    for (const n of Object.keys(x)) if (!(n in y)) out.push(item('removed', 'JavaScript', n, `${x[n].kind} \`${n}\` from \`${f}\``));
    for (const n of Object.keys(x)) {
      if (!(n in y)) continue;
      const p = x[n];
      const q = y[n];
      if (p.members || q.members) {
        const pm = p.members ?? {};
        const qm = q.members ?? {};
        for (const m of Object.keys(qm)) if (!(m in pm)) out.push(item('added', 'JavaScript', `${n}.${m}`, `\`${n}.${m}\`: \`${qm[m]}\``));
        for (const m of Object.keys(pm)) if (!(m in qm)) out.push(item('removed', 'JavaScript', `${n}.${m}`, `\`${n}.${m}\``));
        for (const m of Object.keys(pm)) if (m in qm && pm[m] !== qm[m]) out.push(item('changed', 'JavaScript', `${n}.${m}`, `\`${n}.${m}\`: now \`${qm[m]}\` (was \`${pm[m]}\`)`));
        if (p.text !== q.text) out.push(item('changed', 'JavaScript', n, `${q.kind} \`${n}\`: now \`${q.text}\``));
      } else if (p.text !== q.text) {
        // a union: which alternatives came and went, not the whole of it twice
        const alts = (t) => splitTop(t.replace(/^export (declare )?type \w+(<[^=]*>)? = /, '').replace(/;$/, ''), '|').map((x) => squash(x.replace(/\/\*\*[\s\S]*?\*\//g, '')));
        if (q.kind === 'type' && alts(q.text).length > 1) {
          const [pa, qa] = [alts(p.text), alts(q.text)];
          let came = qa.filter((x) => !pa.includes(x));
          let went = pa.filter((x) => !qa.includes(x));
          // tagged objects ({ t: "circle"; … }) are paired by their tag, and say which fields changed
          const tag = (x) => /^\{\s*(\w+): ("[^"]+");/.exec(x)?.slice(1, 3).join(': ');
          const fields = (x) => splitTop(x.replace(/^\{|\}$/g, ''), ';').filter((f) => f);
          const said = [];
          for (const c of [...came]) {
            const w = went.find((x) => tag(x) && tag(x) === tag(c));
            if (!w) continue;
            const [fw, fc] = [fields(w), fields(c)];
            const more = fc.filter((f) => !fw.includes(f));
            const less = fw.filter((f) => !fc.includes(f));
            said.push(`\`${tag(c)}\` ${[...more.map((f) => `gains \`${f}\``), ...less.map((f) => `loses \`${f}\``)].join(', ')}`);
            came = came.filter((x) => x !== c);
            went = went.filter((x) => x !== w);
          }
          said.push(...came.map((x) => `gains \`${short(x)}\``), ...went.map((x) => `loses \`${short(x)}\``));
          out.push(item('changed', 'JavaScript', n, `type \`${n}\`: ${said.join('; ') || 'reworded'}`));
        } else if (n === 'IR_SCHEMAS') continue; // the IR's schemas: listed under IR and files, field by field
        else if (q.text.length > LONG || p.text.length > LONG) out.push(item('changed', 'JavaScript', n, `${q.kind} \`${n}\` changed: see \`${f.replace(/\.js$/, '.d.ts')}\``));
        else out.push(item('changed', 'JavaScript', n, `${q.kind} \`${n}\`: now \`${q.text}\` (was \`${p.text}\`)`));
      }
    }
  }
  // the language: externs and their members, types, tokens, icons, reserved names
  const ex = new Set([...Object.keys(a.lang.externs), ...Object.keys(b.lang.externs)]);
  for (const e of ex) {
    const x = a.lang.externs[e];
    const y = b.lang.externs[e];
    if (!x) out.push(item('added', 'Language', e, `base widget \`${e}\`: ${y.about}`));
    else if (!y) out.push(item('removed', 'Language', e, `base widget \`${e}\``));
    else {
      for (const it of compare(x.members, y.members, 'Language', (k) => `${e} ${k}`, (kind, k, now, was) => `\`${e}\`: \`${short(now ?? was)}\`${kind === 'changed' && (now ?? '').length + (was ?? '').length < LONG ? ` (was \`${was}\`)` : ''}`)) {
        const k = it.key.slice(e.length + 1);
        const [ra, rb] = [recordsIn(x.members[k] ?? ''), recordsIn(y.members[k] ?? '')];
        // an input that holds records: its records' fields one by one
        if (it.kind === 'changed' && (Object.keys(ra).length || Object.keys(rb).length)) {
          for (const r of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
            const [fa, fb] = [ra[r] ?? {}, rb[r] ?? {}];
            for (const f of Object.keys(fb)) if (!(f in fa)) out.push(item('added', 'Language', `${r}.${f}`, `\`${e}\`'s \`${r}\` record: \`${fb[f]}\``));
            for (const f of Object.keys(fa)) if (!(f in fb)) out.push(item('removed', 'Language', `${r}.${f}`, `\`${e}\`'s \`${r}\` record: \`${f}\``));
            for (const f of Object.keys(fa)) if (f in fb && fa[f] !== fb[f]) out.push(item('changed', 'Language', `${r}.${f}`, `\`${e}\`'s \`${r}\` record: now \`${fb[f]}\` (was \`${fa[f]}\`)`));
          }
          continue;
        }
        out.push(it);
      }
    }
  }
  out.push(...compare(a.lang.types, b.lang.types, 'Language', (k) => `type ${k}`, (kind, k, now, was) => `type \`${k}\`${kind === 'changed' ? ` is now \`${now}\`` : ''}`).filter((i) => i.key !== 'type iconname'));
  out.push(...compare(a.lang.tokens, b.lang.tokens, 'Language', (k) => `token ${k}`, (kind, k, now, was) => `token \`${k}\`${kind === 'removed' ? '' : ` = \`${now}\``}${kind === 'changed' ? ` (was \`${was}\`)` : ''}`));
  const icons = (l) => Object.fromEntries(l.map((n) => [n, true]));
  out.push(...compare(icons(a.lang.icons), icons(b.lang.icons), 'Language', (k) => `icon ${k}`, (kind, k) => `icon \`${k}\``));
  for (const n of b.lang.reserved) if (!a.lang.reserved.includes(n)) out.push(item('added', 'Language', n, `\`${n}\`, a name every definition reads (so a definition can no longer declare its own)`));
  for (const n of a.lang.reserved) if (!b.lang.reserved.includes(n)) out.push(item('removed', 'Language', n, `\`${n}\` is no longer reserved`));
  // the CLI
  out.push(...compare(a.cli.commands, b.cli.commands, 'CLI', (k) => `mkp ${k}`, (kind, k, now) => `\`mkp ${k}\`${kind === 'added' ? `: \`${now}\`` : ''}`).filter((i) => i.kind !== 'changed'));
  const cmdsBoth = (k) => k.split(' ')[1] in a.cli.commands && k.split(' ')[1] in b.cli.commands;
  out.push(...compare(Object.fromEntries(Object.keys(a.cli.flags).filter(cmdsBoth).map((k) => [k, true])), Object.fromEntries(Object.keys(b.cli.flags).filter(cmdsBoth).map((k) => [k, true])), 'CLI', (k) => k, (kind, k) => `\`${k}\``));
  out.push(...compare(Object.fromEntries(Object.keys(a.cli.values).filter(cmdsBoth).map((k) => [k, true])), Object.fromEntries(Object.keys(b.cli.values).filter(cmdsBoth).map((k) => [k, true])), 'CLI', (k) => k, (kind, k) => `\`${k}\``));
  // the IR and the release's files
  out.push(...compare(a.ir, b.ir, 'IR and files', (k) => k, (kind, k, now, was) => `\`${k}\`${kind === 'changed' ? `: now ${now} (was ${was})` : kind === 'added' ? ` (${now})` : ''}`));
  out.push(...compare(Object.fromEntries(a.files.map((f) => [f, true])), Object.fromEntries(b.files.map((f) => [f, true])), 'IR and files', (k) => k, (kind, k) => `\`${k}\` in the web zip`));
  return out;
}

/** What a first release provides, listed by surface (it has nothing before it to differ from). */
export function firstSurface(s) {
  const none = { js: {}, lang: { externs: {}, types: {}, tokens: {}, icons: [], reserved: [] }, cli: { commands: {}, flags: {}, values: {} }, ir: {}, files: [] };
  return diffSurfaces(none, s);
}

/** A changelog's ## API section from the changes: ### Added, Changed, Deprecated, Removed, each by surface. */
export function apiMarkdown(items, { brief = false } = {}) {
  const out = ['## API'];
  for (const [k, title] of Object.entries(KINDS)) {
    const of = items.filter((i) => i.kind === k);
    if (!of.length) continue;
    out.push('', `### ${title}`);
    for (const s of SURFACES) {
      const here = of.filter((i) => i.surface === s);
      if (!here.length) continue;
      out.push('', `**${s}**`, '');
      if (brief && here.length > 12) {
        out.push(`- ${here.map((i) => `\`${i.key}\``).join(', ')}`);
        continue;
      }
      for (const i of here) out.push(`- ${i.text}`);
    }
  }
  return out.join('\n') + '\n';
}

/** What a changelog leaves out: each change its ## API section doesn't name, and removals with no ## Breaking. */
export function missing(changelog, items) {
  const body = changelog.replace(/^---[\s\S]*?\n---\n/, '');
  const at = body.search(/^## API\s*$/m);
  const api = at < 0 ? '' : body.slice(at).replace(/\n## (?!API)[\s\S]*$/, '');
  const named = (key) => api.includes(`\`${key}\``) || api.includes(`\`${key.split(' ').pop()}\``);
  const warnings = items.filter((i) => !named(i.key)).map((i) => `## API doesn't name \`${i.key}\` (${KINDS[i.kind].toLowerCase()}, ${i.surface}): add "- ${i.text}" under ### ${KINDS[i.kind]}`);
  const breaking = /^## Breaking\s*$/m.test(body) && /^## Breaking\s*\n+(?!##)\S/m.test(body);
  if (!breaking && items.some((i) => i.kind === 'removed' || i.kind === 'changed')) warnings.push(`something was removed or changed, but there is no ## Breaking section: say what breaks and what to do instead (or why nothing does)`);
  return warnings;
}

// ---------------------------------------------------------------------------------------------

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args) {
  const previous = (v) => {
    const notes = readdirSync(join(root, 'notes')).filter((f) => /^\d+(\.\d+)*\.md$/.test(f)).map((f) => f.slice(0, -3));
    const sorted = notes.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    const i = sorted.indexOf(v);
    return i > 0 ? sorted[i - 1] : sorted.filter((n) => n.localeCompare(v, undefined, { numeric: true }) < 0).pop();
  };
  if (args.includes('--first')) {
    const v = opt(args, '--first');
    process.stdout.write(apiMarkdown(firstSurface(await surfaceOf(await releaseFiles(v))), { brief: true }));
    return 0;
  }
  // check:api: this checkout against the release before it, and its changelog
  if (args.includes('--check-current')) {
    const v = readFileSync(join(root, 'VERSION'), 'utf8').trim();
    const file = join(root, 'changelog', `${v}.mkp.md`);
    if (!existsSync(file)) {
      console.log(`warning changelog/${v}.mkp.md  there is no changelog for ${v} to check the API against`);
      return 0;
    }
    args = [...args.filter((a) => a !== '--check-current'), '--check', file];
  }
  const toArg = opt(args, '--to') ?? 'current';
  const to = toArg === 'current' ? currentFiles() : await releaseFiles(toArg);
  const fromV = opt(args, '--from') ?? previous(to.version) ?? to.version;
  if (fromV === to.version) throw new Error(`--from is ${fromV}, the same release as --to: give an earlier one`);
  const from = await releaseFiles(fromV);
  const [a, b] = [await surfaceOf(from), await surfaceOf(to, ['width', 'theme', 'answers'])];
  const items = diffSurfaces(a, b);
  const check = opt(args, '--check');
  // the release before this one is this one's own version when VERSION wasn't raised: nothing to say
  if (check) {
    const w = missing(readFileSync(check, 'utf8'), items);
    for (const x of w) console.log(`warning ${check}  ${x}`);
    console.log(`api: ${items.length} change${items.length === 1 ? '' : 's'} from ${fromV} to ${to.version}${w.length ? `, ${w.length} not in ${check} (warnings only)` : `, all in ${check}`}`);
    return 0;
  }
  process.stdout.write(`<!-- the API from ${fromV} to ${to.version}, made by scripts/api-diff.mjs: edit the words, keep the names -->\n` + apiMarkdown(items));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(`api-diff: ${e.message}`);
      process.exit(2);
    },
  );
