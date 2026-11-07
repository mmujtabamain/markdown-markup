// scripts/api-diff.mjs: the API's changes between two releases, on four surfaces, and what a changelog misses.
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script with no declarations
import { apiMarkdown, cliSurface, diffSurfaces, irSurface, language, missing, recordsIn, releaseFiles, splitTop, surfaceOf } from './api-diff.mjs';

type Item = { kind: string; surface: string; key: string; text: string };
const empty = () => ({ js: {}, lang: { externs: {}, types: {}, tokens: {}, icons: [], reserved: [] }, cli: { commands: {}, flags: {}, values: {} }, ir: {}, files: [] });

describe('reading a surface', () => {
  it('splits at the top level only, and finds the records in a type', () => {
    expect(splitTop('a | { b: "x|y" } | (c | d)', '|')).toEqual(['a', '{ b: "x|y" }', '(c | d)']);
    expect(recordsIn('list(record layer {opacity: num = 1, clip: list(point) = [], circles: list(record circle {c: point, label: text = ""})})')).toEqual({
      layer: { opacity: 'opacity: num = 1', clip: 'clip: list(point) = []', circles: 'records' },
      circle: { c: 'c: point', label: 'label: text = ""' },
    });
  });
  it('reads the base set: externs and their members (long ones joined), types, tokens', () => {
    const l = language('pack core@1 "x"\n\ntype rgb = {r: num}\nextern zoom@1 "A view."\n  in max num = 4\n  in layers list(record a {x: num,\n      y: num})\n  out click\n\ntokens core@1 "t"\n  color accent "#2563eb" dark="#7aa7ff"\n  space xs=2 s=4\n');
    expect(l.externs.zoom.members).toEqual({ 'in max': 'in max num = 4', 'in layers': 'in layers list(record a {x: num, y: num})', 'out click': 'out click' });
    expect(l.types).toEqual({ rgb: '{r: num}' });
    expect(l.tokens).toEqual({ 'color accent': '"#2563eb" dark="#7aa7ff"', 'space xs': '2', 'space s': '4' });
  });
  it('reads the CLI from its help: commands, flags, and each --target value', () => {
    const c = cliSurface('mkp 1: x\n\n  mkp build <docs> [--target ir|md|html[,…]] [--out dir]\n            [--lock mkp.lock]\n  mkp fmt <files> [--write]\n');
    expect(Object.keys(c.commands)).toEqual(['build', 'fmt']);
    expect(Object.keys(c.flags)).toEqual(['mkp build --target', 'mkp build --out', 'mkp build --lock', 'mkp fmt --write']);
    expect(Object.keys(c.values)).toEqual(['mkp build --target ir', 'mkp build --target md', 'mkp build --target html']);
  });
  it('reads the IR schemas two levels deep, with what is required', () => {
    expect(irSurface({ 'ir/bundle': { required: ['ir'], properties: { ir: {}, mkp: {}, doc: { properties: { body: {} } } } } })).toEqual({ 'bundle.ir': 'required', 'bundle.mkp': 'optional', 'bundle.doc': 'optional', 'bundle.doc.body': 'optional' });
  });
});

describe('the difference', () => {
  it('lists added, changed and removed, on each surface, with the name a changelog must use', () => {
    const a = empty();
    const b = empty();
    a.js = { 'mkp-dom.js': { mount: { kind: 'function', text: 'f(a)' }, MountOptions: { kind: 'interface', text: 'interface MountOptions {…}', members: { theme: 'theme?: string;' } }, gone: { kind: 'const', text: 'x' } } };
    b.js = { 'mkp-dom.js': { mount: { kind: 'function', text: 'f(a, b)' }, MountOptions: { kind: 'interface', text: 'interface MountOptions {…}', members: { theme: 'theme?: string;', tokens: 'tokens?: TokenMap;' } } } };
    a.lang.externs = { zoom: { about: 'A view.', members: { 'in max': 'in max num = 4' } } };
    b.lang.externs = { zoom: { about: 'A view.', members: { 'in max': 'in max num = 4', 'in minscale': 'in minscale num = 0.6' } } };
    b.lang.reserved = ['theme'];
    b.cli = { commands: { migrate: 'mkp migrate <x>' }, flags: {}, values: {} };
    b.files = ['mkp-runtime.js'];
    const items: Item[] = diffSurfaces(a, b);
    const keys = (k: string) => items.filter((i) => i.kind === k).map((i) => `${i.surface}: ${i.key}`);
    expect(keys('added')).toEqual(['JavaScript: MountOptions.tokens', 'Language: zoom in minscale', 'Language: theme', 'CLI: mkp migrate', 'IR and files: mkp-runtime.js']);
    expect(keys('changed')).toEqual(['JavaScript: mount']);
    expect(keys('removed')).toEqual(['JavaScript: gone']);
    const md = apiMarkdown(items);
    expect(md).toMatch(/^## API\n\n### Added\n\n\*\*JavaScript\*\*\n\n- `MountOptions.tokens`/);
    expect(md.indexOf('### Changed')).toBeLessThan(md.indexOf('### Removed'));
  });
  it('says what a changelog leaves out, and asks for ## Breaking when something was removed (warnings only)', () => {
    const items = [{ kind: 'added', surface: 'CLI', key: 'mkp migrate', text: '`mkp migrate`' }, { kind: 'removed', surface: 'JavaScript', key: 'gone', text: '`gone`' }];
    const w = missing('---\nversion: 1\n---\n## New\n- x\n## API\n### Added\n- `mkp migrate`: brings files up to date\n', items);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain("doesn't name `gone`");
    expect(w[1]).toContain('no ## Breaking section');
    expect(missing('## Breaking\n- **gone** is gone.\n## API\n- `mkp migrate`\n- `gone`\n', items)).toEqual([]);
  });
  it('counts a record field or a base widget’s input as named by the line it wrote, and not by its parts on separate lines', () => {
    const items = [
      { kind: 'added', surface: 'Language', key: 'layer.clip', text: "`canvas`'s `layer` record: `clip: list(point) = []`" },
      { kind: 'added', surface: 'Language', key: 'zoom in minscale', text: '`zoom`: `in minscale num = 0.6 "…"`' },
    ];
    const api = '## API\n### Added\n- `canvas`\'s `layer` record: `clip: list(point) = []`, so a layer clips\n- `zoom`: `in minscale num = 0.6`, the least it shrinks\n';
    expect(missing(api, items)).toEqual([]);
    expect(missing('## API\n- `layer` changed\n- `clip` is new\n- `zoom`\n', items)).toHaveLength(2);
  });
});

describe('two published releases, 0.2.1 and 0.2.2', () => {
  let items: Item[] = [];
  beforeAll(async () => {
    const [a, b] = [await surfaceOf(await releaseFiles('0.2.1')), await surfaceOf(await releaseFiles('0.2.2'))];
    items = diffSurfaces(a, b);
  }, 240000);
  it('finds what 0.2.2 changed, on all four surfaces', () => {
    const has = (kind: string, key: string) => items.some((i) => i.kind === kind && i.key === key);
    for (const k of ['needsMaths', 'migrateBundle', 'MountOptions.tokens', 'MountOptions.hydrate', 'Runtime.setTheme']) expect(has('added', k), k).toBe(true);
    for (const k of ['zoom in minscale', 'column in padx', 'row out enter', 'theme', 'layer.clip', 'circle.label']) expect(has('added', k), k).toBe(true);
    for (const k of ['mkp migrate', 'mkp build --target fragment', 'bundle.mkp', 'mkp-runtime.js', 'mkp-shared.js']) expect(has('added', k), k).toBe(true);
    expect(has('changed', 'arrowPath')).toBe(true);
    expect(items.filter((i) => i.kind === 'removed')).toEqual([]);
  });
});
