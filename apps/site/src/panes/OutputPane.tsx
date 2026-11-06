// The output: the exported Markdown (with its toggles and a copy button), that Markdown as a plain
// GitHub-style renderer draws it, the IR, the expanded IR, the interfaces a host sees, and the
// diagnostics as a list and as the JSON lines `mkp check --format json` prints.

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, SlidersHorizontal } from 'lucide-react';
import { expand, showType, stripPos, writeMarkdown, type IRBundle, type IRNode, type MathsEngine, type MdToggle } from '@mkp/core';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { markdownToHtml } from '../markdown-preview';
import { DiagList, type DiagItem } from './DiagList';

export const TOGGLES: MdToggle[] = ['gfm', 'math', 'mermaid', 'html', 'images'];

export interface MdSettings {
  toggles: MdToggle[];
  answers: boolean;
}

/** The result pane's groups: each shows some of the tabs, as small toggles under the group's switch. */
export type OutputGroup = 'md' | 'ir' | 'problems';
export const GROUP_TABS: Record<OutputGroup, { value: string; label: string }[]> = {
  md: [
    { value: 'md', label: 'Text' },
    { value: 'preview', label: 'Rendered' },
  ],
  ir: [
    { value: 'ir', label: 'Bundle' },
    { value: 'expanded', label: 'Expanded' },
    { value: 'interfaces', label: 'Interfaces' },
  ],
  problems: [{ value: 'diagnostics', label: 'Problems' }],
};
export const groupOf = (tab: string): OutputGroup => (tab === 'ir' || tab === 'expanded' || tab === 'interfaces' ? 'ir' : tab === 'diagnostics' ? 'problems' : 'md');

export interface OutputPaneProps {
  bundle: IRBundle | null;
  maths: MathsEngine | null;
  diags: DiagItem[];
  /** the compiler's diagnostics, as JSON lines */
  json: string[];
  onJump: (d: DiagItem) => void;
  tab: string;
  onTab: (t: string) => void;
  md: MdSettings;
  onMd: (s: MdSettings) => void;
  /** a picture the document names, as a URL */
  image: (href: string) => string | undefined;
  docFile?: string;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): ReactNode {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      data-pg-copy=""
      onClick={() => {
        const ok = (): void => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        };
        navigator.clipboard?.writeText(text).then(ok, () => undefined);
      }}
    >
      {done ? <Check /> : <Copy />} {done ? 'Copied' : label}
    </Button>
  );
}

/** JSON for reading: maths SVG shortened (Copy gives all of it). */
function irText(v: unknown, short: boolean): string {
  return JSON.stringify(v, (k, x) => (short && k === 'svg' && typeof x === 'string' && x.length > 120 ? `${x.slice(0, 60)}… (${x.length} characters of SVG)` : x), 1);
}

function Bar({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5 text-xs">{children}</div>;
}

function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

const NO_BUNDLE = 'No bundle: the document has errors. See Problems.';

function Interfaces({ bundle }: { bundle: IRBundle }): ReactNode {
  const blocks = bundle.doc.body.filter((n: IRNode) => n.meta?.block !== undefined);
  const i = bundle.interface;
  const none = <span className="text-muted-foreground">none</span>;
  const list = (xs?: string[]): ReactNode => (xs?.length ? xs.map((x) => <code key={x} className="mr-1 inline-block rounded bg-muted px-1 font-mono text-xs">{x}</code>) : none);
  return (
    <div className="space-y-5 p-3 text-sm" data-pg-out="interfaces">
      <section>
        <h3 className="mb-1 font-medium">Blocks</h3>
        <p className="mb-2 text-xs text-muted-foreground">What a host finds in the document: each widget block, the interfaces its definition implements, and those of the definitions inside it, at any depth.</p>
        {blocks.length ? (
          <div className="overflow-x-auto">
            <table className="pg-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Definition</th>
                  <th>Implements</th>
                  <th>Within</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((n) => (
                  <tr key={n.meta!.block} data-pg-block={n.meta!.block}>
                    <td className="font-mono text-xs">{n.meta!.anchor ? `#${n.meta!.anchor}` : n.meta!.block}</td>
                    <td>
                      <code className="font-mono text-xs">{n.def ?? n.node}</code>
                      {n.meta!.summary ? <span className="block text-xs text-muted-foreground">{n.meta!.summary}</span> : null}
                    </td>
                    <td>{list(n.meta!.implements)}</td>
                    <td>{list(n.meta!.within)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>The document has no widget blocks.</Empty>
        )}
      </section>
      <section>
        <h3 className="mb-1 font-medium">The bundle's interface</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          <code className="font-mono">bundle.interface</code>: the signals a host may hear, the host values and commands it may give, and which definitions implement which interfaces.
        </p>
        <div className="overflow-x-auto">
          <table className="pg-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Definition</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {i.implements.map((x) => (
                <tr key={`i${x.def}${x.iface}`}>
                  <td>implements</td>
                  <td>
                    <code className="font-mono text-xs">{x.iface}</code>
                  </td>
                  <td>
                    <code className="font-mono text-xs">{x.def}</code>
                  </td>
                  <td />
                </tr>
              ))}
              {i.signals.map((x) => (
                <tr key={`s${x.def}${x.name}`}>
                  <td>signal</td>
                  <td>
                    <code className="font-mono text-xs">{x.name}</code>
                  </td>
                  <td>
                    <code className="font-mono text-xs">{x.def}</code>
                  </td>
                  <td className="font-mono text-xs">{showType(x.payload)}</td>
                </tr>
              ))}
              {i.hosts.map((x) => (
                <tr key={`h${x.def}${x.name}`}>
                  <td>host</td>
                  <td>
                    <code className="font-mono text-xs">{x.name}</code>
                  </td>
                  <td>
                    <code className="font-mono text-xs">{x.def}</code>
                  </td>
                  <td className="font-mono text-xs">{showType(x.type)}</td>
                </tr>
              ))}
              {i.commands.map((x) => (
                <tr key={`c${x.def}${x.name}`}>
                  <td>command</td>
                  <td>
                    <code className="font-mono text-xs">{x.name}</code>
                  </td>
                  <td>
                    <code className="font-mono text-xs">{x.def}</code>
                  </td>
                  <td className="font-mono text-xs">{x.payload ? showType(x.payload) : ''}</td>
                </tr>
              ))}
              {!i.implements.length && !i.signals.length && !i.hosts.length && !i.commands.length ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground">
                    Nothing: no widget here talks to its host.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function OutputPane(p: OutputPaneProps): ReactNode {
  const { bundle, tab } = p;
  const md = useMemo(() => {
    if (!bundle || (tab !== 'md' && tab !== 'preview')) return null;
    try {
      return writeMarkdown(bundle, { toggles: p.md.toggles, answers: p.md.answers, maths: p.maths ?? undefined });
    } catch (e) {
      return { md: `The Markdown writer stopped: ${(e as Error).message}`, files: new Map<string, string>() };
    }
  }, [bundle, tab, p.md, p.maths]);
  const html = useMemo(() => {
    if (!md || tab !== 'preview') return '';
    const written = new Map([...md.files].map(([name, svg]) => [name, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`]));
    return markdownToHtml(md.md, { maths: p.maths, image: (href) => written.get(href) ?? p.image(href) });
  }, [md, tab, p.maths, p.image]);
  const ir = useMemo(() => (bundle && tab === 'ir' ? stripPos(bundle) : null), [bundle, tab]);
  const expanded = useMemo(() => {
    if (!bundle || tab !== 'expanded') return null;
    try {
      return { v: stripPos(expand(bundle)).doc };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [bundle, tab]);
  const errors = p.diags.filter((d) => d.severity === 'error').length;
  const mdBar = (
    <Bar>
      <TabsList className="h-7 group-data-[orientation=horizontal]/tabs:h-7">
        {GROUP_TABS.md.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="h-6 flex-none px-2.5 text-xs" data-pg-out-tab={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" data-pg-md-options="">
            <SlidersHorizontal /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <p className="mb-2 text-xs font-medium">What the Markdown may use</p>
          <div className="grid grid-cols-2 gap-2">
            {TOGGLES.map((t) => (
              <Label key={t} className="gap-1.5 text-xs font-normal">
                <Checkbox
                  checked={p.md.toggles.includes(t)}
                  data-pg-toggle={t}
                  onCheckedChange={(c) => p.onMd({ ...p.md, toggles: c === true ? TOGGLES.filter((x) => x === t || p.md.toggles.includes(x)) : p.md.toggles.filter((x) => x !== t) })}
                />
                <code className="font-mono">{t}</code>
              </Label>
            ))}
            <Label className="col-span-2 gap-1.5 text-xs font-normal" title="Off: the Markdown a reader sees before answering (mkp build --no-answers)">
              <Checkbox checked={p.md.answers} data-pg-toggle="answers" onCheckedChange={(c) => p.onMd({ ...p.md, answers: c === true })} />
              <span>
                <code className="font-mono">answers</code> <span className="text-muted-foreground">(off: before answering)</span>
              </span>
            </Label>
          </div>
        </PopoverContent>
      </Popover>
      <span className="truncate text-muted-foreground">{p.md.toggles.join(', ') || 'plain Markdown'}{p.md.answers ? '' : ', no answers'}</span>
      <span className="flex-1" />
      {md ? <CopyButton text={md.md} /> : null}
    </Bar>
  );
  return (
    <Tabs value={tab} onValueChange={p.onTab} className="flex h-full min-h-0 flex-col gap-0" data-pg-pane="output">
      {groupOf(tab) === 'ir' ? (
        <div className="shrink-0 border-b px-3 py-1.5">
          <TabsList className="h-7 group-data-[orientation=horizontal]/tabs:h-7">
            {GROUP_TABS[groupOf(tab)].map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="h-6 flex-none px-2.5 text-xs" data-pg-out-tab={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      ) : null}
      <TabsContent value="md" className="flex min-h-0 flex-col">
        {mdBar}
        <div className="min-h-0 flex-1 overflow-auto">
          {md ? (
            <>
              <pre className="pg-pre" data-pg-out="md">
                {md.md}
              </pre>
              {md.files.size ? (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Written beside it: {[...md.files.keys()].map((f) => <code key={f} className="mr-1 font-mono">{f}</code>)}
                </p>
              ) : null}
            </>
          ) : (
            <Empty>{NO_BUNDLE}</Empty>
          )}
        </div>
      </TabsContent>
      <TabsContent value="preview" className="flex min-h-0 flex-col">
        {mdBar}
        <div className="min-h-0 flex-1 overflow-auto">{md ? <article className="pg-md" data-pg-out="md-preview" dangerouslySetInnerHTML={{ __html: html }} /> : <Empty>{NO_BUNDLE}</Empty>}</div>
      </TabsContent>
      <TabsContent value="ir" className="flex min-h-0 flex-col">
        {ir ? (
          <>
            <Bar>
              <span className="text-muted-foreground">The bundle: the document, the definitions it uses, their fns, the tokens and the lock. Maths SVG is shortened here.</span>
              <span className="flex-1" />
              <CopyButton text={JSON.stringify(ir, null, 1)} label="Copy JSON" />
            </Bar>
            <pre className="pg-pre min-h-0 flex-1 overflow-auto" data-pg-out="ir">
              {irText(ir, true)}
            </pre>
          </>
        ) : (
          <Empty>{NO_BUNDLE}</Empty>
        )}
      </TabsContent>
      <TabsContent value="expanded" className="flex min-h-0 flex-col">
        {expanded && 'v' in expanded ? (
          <>
            <Bar>
              <span className="text-muted-foreground">The document with every definition instance inlined: what a provider without the compiler draws.</span>
              <span className="flex-1" />
              <CopyButton text={JSON.stringify(expanded.v, null, 1)} label="Copy JSON" />
            </Bar>
            <pre className="pg-pre min-h-0 flex-1 overflow-auto" data-pg-out="expanded">
              {irText(expanded.v, true)}
            </pre>
          </>
        ) : expanded ? (
          <Empty>It doesn't expand: {expanded.error}</Empty>
        ) : (
          <Empty>{NO_BUNDLE}</Empty>
        )}
      </TabsContent>
      <TabsContent value="interfaces" className="min-h-0 overflow-auto">
        {bundle ? <Interfaces bundle={bundle} /> : <Empty>{NO_BUNDLE}</Empty>}
      </TabsContent>
      <TabsContent value="diagnostics" className="flex min-h-0 flex-col overflow-auto" data-pg-out="diagnostics">
        <DiagList items={p.diags} onJump={p.onJump} docFile={p.docFile} />
        <div className="border-t">
          <Bar>
            <span className="text-muted-foreground">
              As an agent reads them: <code className="font-mono">mkp check --format json</code>, one diagnostic a line.
            </span>
            <span className="flex-1" />
            {p.json.length ? <CopyButton text={p.json.join('\n')} /> : null}
          </Bar>
          <pre className="pg-pre" data-pg-out="diagnostics-json">
            {p.json.join('\n') || '(nothing: it checks clean)'}
          </pre>
        </div>
      </TabsContent>
    </Tabs>
  );
}
