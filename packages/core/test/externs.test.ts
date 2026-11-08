// A pack's externs, drawn by the host: what the view hands a host for each shape, and the Markdown.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { writeMarkdown } from '../src/md';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode } from '../src/runtime/view';
import { hostDoc, hostPack } from './host-externs';

const bundle = () => {
  const c = compile({ packs: [hostPack] });
  const b = c.document(hostDoc, 'doc.mkp.md');
  expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
  return b!;
};
const externs = (rt: Runtime): Record<string, VNode> => {
  const out: Record<string, VNode> = {};
  walk(rt.view(), (n) => void (n.ext && (out[n.ext] = n)));
  return out;
};
const texts = (nodes: VNode[] | undefined): string => {
  const out: string[] = [];
  walk(nodes ?? [], (n) => void ((n.p.runs as { v?: string }[] | undefined)?.forEach((r) => r.v && out.push(r.v))));
  return out.join(' ');
};

describe('a pack’s externs, as the view hands them to a host', () => {
  it('gives a record list as values, with defaults, and each record’s content drawn beside them', () => {
    const x = externs(new Runtime(bundle()))['host:sections@1'];
    expect(x.p.sections).toEqual([
      { title: 'First', open: true },
      { title: 'Second', open: false },
    ]);
    // the values are data only: no slot in them
    expect(JSON.stringify(x.p.sections)).not.toContain('slot');
    expect(x.recs!.sections).toHaveLength(2);
    expect(texts(x.recs!.sections[0])).toContain('first');
    expect(texts(x.recs!.sections[1])).toBe('Inside second.');
    expect(x.kids).toEqual([]);
  });
  it('draws a widget in a record’s content live: its state changes there', () => {
    const rt = new Runtime(bundle());
    const press = (): VNode => {
      let p: VNode | undefined;
      walk(externs(rt)['host:sections@1'].recs!.sections[0], (n) => void (n.t === 'press' && (p = n)));
      return p!;
    };
    expect(texts([press()])).toBe('Up 0');
    rt.dispatch(press().key, 'click');
    expect(texts([press()])).toBe('Up 1');
  });
  it('gives one slot as kids, and a second, filled by name, in slots', () => {
    const x = externs(new Runtime(bundle()));
    expect(texts(x['host:single@1'].kids)).toBe('Inside single.');
    expect(x['host:single@1'].p).toMatchObject({ title: 'Single' });
    expect(texts(x['host:panel@1'].kids)).toBe('Body.');
    expect(Object.keys(x['host:panel@1'].slots!)).toEqual(['footer']);
    expect(texts(x['host:panel@1'].slots!.footer)).toBe('Foot.');
  });
  it('gives a record list of data only (YAML) as values, and the block’s summary', () => {
    const x = externs(new Runtime(bundle()))['host:items@1'];
    expect(x.p.items).toEqual([{ title: 'one' }, { title: 'two' }]);
    expect(x.recs).toBeUndefined();
    expect(x.summary).toBe('Two items.');
  });
  it('keeps each extern’s place in the document', () => {
    const x = externs(new Runtime(bundle()));
    expect(['host:sections@1', 'host:single@1', 'host:noted@1', 'host:items@1', 'host:panel@1'].map((id) => x[id].p.place)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('a pack’s externs in Markdown', () => {
  const md = writeMarkdown(bundle()).md;
  it('writes each record’s content under its title', () => {
    expect(md).toContain('**First**\n\nInside **first**.');
    expect(md).toContain('**Second**\n\nInside second.');
  });
  it('writes an extern’s project md, from its inputs, in place of what it holds', () => {
    expect(md).toContain('**Noted**');
    expect(md).not.toContain('Inside noted.');
  });
  it('writes a summary, and every slot', () => {
    expect(md).toContain('*Two items.*');
    expect(md).toContain('Inside single.');
    expect(md).toContain('Body.\n\nFoot.');
  });
});
