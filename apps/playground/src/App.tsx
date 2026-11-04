// The MKP playground (spec 12): loads the packs and documents, shows every fixture case live with
// its IR and its Markdown output beside it.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { compile, compileCase, fixtureCases, formatDiagnostic, MathsEngine, prerender, Runtime, stripPos, writeMarkdown, expand, type Compiled, type FixtureCase, type IRBundle, type MdToggle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { packFolders } from './catalog';
import { components } from './kit';

declare const __PG_COMMIT__: string;

interface Entry {
  id: string;
  group: string;
  title: string;
  kind: 'case' | 'doc';
  fc?: FixtureCase;
  doc?: { label: string; path: string; text: string };
}

const TOGGLES: MdToggle[] = ['gfm', 'math', 'mermaid', 'html', 'images'];

function readHash(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
}

export function App(): ReactNode {
  const [maths, setMaths] = useState<MathsEngine | null>(null);
  const [hash, setHash] = useState(readHash);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (readHash().theme === 'dark' ? 'dark' : 'light'));
  const [reduced, setReduced] = useState(() => readHash().reduced === '1');
  const [toggles, setToggles] = useState<Set<MdToggle>>(new Set(['gfm', 'math', 'mermaid', 'html']));
  const [tab, setTab] = useState(() => readHash().tab ?? 'md');
  useEffect(() => {
    MathsEngine.create().then(setMaths);
    const f = (): void => setHash(readHash());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  // packs and documents opened from disk join the repository's own
  const [opened, setOpened] = useState<{ packs: { label: string; zip: Uint8Array }[]; docs: { label: string; path: string; text: string }[] }>({ packs: [], docs: [] });
  const compiled = useMemo<Compiled>(() => compile({ packs: [...packFolders().map((p) => ({ label: p.label, files: p.files })), ...opened.packs] }), [opened]);
  const open = async (files: FileList | null): Promise<void> => {
    const next = { packs: [...opened.packs], docs: [...opened.docs] };
    for (const f of Array.from(files ?? [])) {
      if (f.name.endsWith('.mkpack')) next.packs.push({ label: f.name, zip: new Uint8Array(await f.arrayBuffer()) });
      else if (f.name.endsWith('.md')) next.docs.push({ label: 'opened', path: f.name, text: await f.text() });
    }
    setOpened(next);
  };
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const p of packFolders()) {
      for (const [path, bytes] of p.files) {
        if (path.endsWith('.mkp.md')) out.push({ id: `doc:${p.label}/${path}`, group: p.label, title: path, kind: 'doc', doc: { label: p.label, path, text: new TextDecoder().decode(bytes) } });
      }
    }
    for (const d of opened.docs) out.push({ id: `doc:opened/${d.path}`, group: 'opened', title: d.path, kind: 'doc', doc: d });
    for (const fc of fixtureCases(compiled)) out.push({ id: `case:${fc.pack}/${fc.widget}/${fc.name}`, group: fc.pack, title: `${fc.widget} · ${fc.name}`, kind: 'case', fc });
    return out;
  }, [compiled, opened]);
  const selected = entries.find((e) => e.id === hash.e) ?? entries.find((e) => e.kind === 'doc') ?? entries[0];
  const result = useMemo(() => {
    if (!selected || !maths) return null;
    if (selected.kind === 'case') {
      const r = compileCase(compiled, selected.fc!);
      if (r.bundle) prerender(r.bundle, maths, r.diags);
      return { bundle: r.bundle, diags: r.diags.items, negative: !!selected.fc!.expect?.errors?.length, ok: r.ok };
    }
    const diags = new (compiled.diags.constructor as new () => typeof compiled.diags)();
    const bundle = compiled.document(selected.doc!.text, `${selected.doc!.label}/${selected.doc!.path}`, diags);
    if (bundle) prerender(bundle, maths, diags);
    return { bundle, diags: diags.items, negative: false, ok: diags.ok };
  }, [selected, maths, compiled]);
  const select = (id: string): void => {
    location.hash = new URLSearchParams({ ...hash, e: id }).toString();
  };
  const groups = [...new Set(entries.map((e) => e.group))];
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return (
    <TooltipProvider>
      <div className="grid min-h-svh md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="pg-side max-h-56 overflow-y-auto border-b p-3 text-sm md:sticky md:top-0 md:max-h-svh md:border-r md:border-b-0" aria-label="cases">
          <h1 className="text-base font-semibold">MKP playground</h1>
          <p className="text-xs text-muted-foreground">
            {compiled.defs.size} definitions · {entries.filter((e) => e.kind === 'case').length} fixture cases
            {__PG_COMMIT__ ? ` · ${__PG_COMMIT__}` : ''}
          </p>
          {compiled.diags.errors.length ? <p className="text-destructive">{compiled.diags.errors.length} build errors</p> : null}
          {groups.map((g) => (
            <section key={g} className="mt-3">
              <h2 className="px-2 text-xs font-medium text-muted-foreground">{g}</h2>
              <ul>
                {entries
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <li key={e.id}>
                      <a
                        className="block truncate rounded-md px-2 py-1 hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
                        href={`#${new URLSearchParams({ ...hash, e: e.id }).toString()}`}
                        aria-current={e === selected ? 'page' : undefined}
                        onClick={(ev) => (ev.preventDefault(), select(e.id))}
                      >
                        {e.title}
                      </a>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </aside>
        <main className="min-w-0 space-y-4 p-4 md:p-6">
          <header className="pg-head flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong className="font-semibold">{selected?.title}</strong>
              <span className="text-sm text-muted-foreground"> {selected?.group}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Button variant="outline" size="sm" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                {theme === 'light' ? 'Dark' : 'Light'}
              </Button>
              <Label>
                <Checkbox checked={reduced} onCheckedChange={(c) => setReduced(c === true)} /> Reduced motion
              </Label>
              <Button variant="outline" size="sm" asChild>
                <label>
                  Open .mkpack or .mkp.md <input className="sr-only" type="file" accept=".mkpack,.md" multiple onChange={(e) => void open(e.currentTarget.files)} />
                </label>
              </Button>
            </div>
          </header>
          {!maths ? <p className="text-sm text-muted-foreground">Loading the maths engine…</p> : null}
          {result && selected ? <Shown key={selected.id + theme + String(reduced)} entry={selected} bundle={result.bundle} maths={maths} theme={theme} reduced={reduced} negative={result.negative} ok={result.ok} diags={result.diags.map(formatDiagnostic)} /> : null}
          {result?.bundle ? (
            <section>
              <Tabs value={tab} onValueChange={setTab}>
                <div className="flex flex-wrap items-center gap-3">
                  <TabsList>
                    {['md', 'ir', 'expanded', 'diagnostics'].map((t) => (
                      <TabsTrigger key={t} value={t}>
                        {t === 'md' ? 'Markdown' : t === 'ir' ? 'IR (bundle)' : t === 'expanded' ? 'IR (expanded)' : `Diagnostics (${result.diags.length})`}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {tab === 'md' ? (
                    <div className="flex flex-wrap gap-3 text-sm">
                      {TOGGLES.map((t) => (
                        <Label key={t}>
                          <Checkbox
                            checked={toggles.has(t)}
                            onCheckedChange={(c) => {
                              const s = new Set(toggles);
                              if (c === true) s.add(t);
                              else s.delete(t);
                              setToggles(s);
                            }}
                          />
                          {t}
                        </Label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Tabs>
              <pre className="pg-code" data-pg-out={tab}>
                {tab === 'md' ? writeMarkdown(result.bundle, { toggles: [...toggles] }).md : tab === 'ir' ? JSON.stringify(stripPos(result.bundle), null, 1).slice(0, 60000) : tab === 'expanded' ? JSON.stringify(stripPos(expand(result.bundle)).doc, null, 1).slice(0, 60000) : result.diags.map(formatDiagnostic).join('\n') || 'No diagnostics.'}
              </pre>
            </section>
          ) : null}
        </main>
      </div>
    </TooltipProvider>
  );
}

function Shown({ entry, bundle, maths, theme, reduced, negative, ok, diags }: { entry: Entry; bundle: IRBundle | null; maths: MathsEngine | null; theme: 'light' | 'dark'; reduced: boolean; negative: boolean; ok: boolean; diags: string[] }): ReactNode {
  const runtime = useMemo(() => (bundle ? new Runtime(bundle, { capabilities: ['core@1', 'gfx@1'], maths: maths ?? undefined, reducedMotion: reduced, hosts: entry.fc?.hosts ? { '0': entry.fc.hosts } : undefined }) : null), [bundle, maths, reduced, entry]);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    if (!runtime) return;
    (runtime.opts as { onSignal?: (e: { name: string; payload: unknown }) => void }).onSignal = (e) => setLog((l) => [...l.slice(-6), `${e.name} ${JSON.stringify(e.payload)}`]);
  }, [runtime]);
  // fixture play steps (provider-neutral): run them with real time when asked
  const play = async (): Promise<void> => {
    if (!runtime || !entry.fc?.play) return;
    for (const s of entry.fc.play) {
      if (s.press) runtime.press(s.press);
      if (s.set) runtime.set(s.set);
      if (s.command) runtime.widget(0).command(s.command, s.args);
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
    }
  };
  useEffect(() => {
    if (readHash().play === '1') void play();
  }, [runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  if (negative) {
    return (
      <section className="pg-view" data-mkp-ready="1" data-pg-negative={ok ? 'ok' : 'unexpected'}>
        <p className="mb-2 text-sm">
          <strong>Negative case.</strong> {ok ? 'It fails as expected:' : 'It did not fail as expected.'}
        </p>
        <pre className="pg-code">{diags.join('\n')}</pre>
      </section>
    );
  }
  if (!bundle || !runtime) {
    return (
      <section className="pg-view" data-mkp-ready="1" data-pg-failed="1">
        <pre className="pg-code text-destructive">{diags.join('\n')}</pre>
      </section>
    );
  }
  return (
    <section className="pg-view" data-mkp-ready="1">
      {entry.fc?.play ? (
        <Button variant="outline" size="sm" className="mb-2" onClick={() => void play()}>
          Run the play steps
        </Button>
      ) : null}
      <Card className="pg-stage py-0" data-pg-stage="1">
        <CardContent className="p-5">
          <MkpDocument bundle={bundle} runtime={runtime} theme={theme} reducedMotion={reduced} components={components} tokens={shadcnTokens} />
        </CardContent>
      </Card>
      {log.length ? <pre className="pg-code mt-2">{log.join('\n')}</pre> : null}
    </section>
  );
}
