// The MKP playground (doc #1129 §7.1): a place to see the language working, and where it stops.
// Source | Preview | Output side by side on a wide screen, as tabs on a phone; the examples, the
// limits and the conformance cases in the sidebar. It compiles as you type, and the URL carries
// the example and any edits, so a document can be shared by link.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Check, FolderOpen, Link2, Menu, PanelLeft } from 'lucide-react';
import { MathsEngine } from '@mkp/core';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { assetUrl, withAssets } from './assets';
import { build, jsonLine, type DrawnError } from './build';
import { catalog, type ConfCase, type Entry, type SourceFile } from './catalog';
import { openedDoc, openFiles, type Opened } from './opened';
import type { DiagItem } from './panes/DiagList';
import { OutputPane, type MdSettings } from './panes/OutputPane';
import { PreviewPane, type PreviewSettings, type WidthPreset } from './panes/PreviewPane';
import { Sidebar } from './panes/Sidebar';
import { SourcePane } from './panes/SourcePane';
import { packFiles, readHash, unpackFiles, writeHash, type HashState } from './share';
import type { Jump } from './editor/Editor';

declare const __PG_COMMIT__: string;

type Pane = 'source' | 'preview' | 'output';
const PANES: { id: Pane; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'preview', label: 'Preview' },
  { id: 'output', label: 'Output' },
];

const prefersDark = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The files with the edits made to them. */
function applyEdits(files: SourceFile[], edits?: Record<string, string>): SourceFile[] {
  if (!edits) return files;
  return files.map((f) => (edits[f.path] !== undefined ? { ...f, text: edits[f.path] } : f));
}

/** The edits worth carrying in a link: the files that differ (all of an opened document's). */
function changed(entry: Entry, files: SourceFile[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const orig = entry.files.find((x) => x.path === f.path);
    if (entry.kind === 'opened' || !orig || orig.text !== f.text) out[f.path] = f.text;
  }
  return out;
}

export function App(): ReactNode {
  const [hash, setHash] = useState<HashState>(readHash);
  const [maths, setMaths] = useState<MathsEngine | null>(null);
  const [mathsError, setMathsError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened>({ entries: [], packs: [] });
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [activeFile, setActiveFile] = useState<Record<string, string>>({});
  const [jump, setJump] = useState<Jump | null>(null);
  const [sheet, setSheet] = useState(false);
  const [side, setSide] = useState(true);
  const [notes, setNotes] = useState<string[]>([]);
  const [md, setMd] = useState<MdSettings>({ toggles: ['gfm', 'math', 'mermaid', 'html'], answers: true });
  const [copied, setCopied] = useState(false);
  const lastSrc = useRef<string | undefined>(undefined);
  const [unpacking, setUnpacking] = useState(false);

  useEffect(() => {
    MathsEngine.create().then(setMaths, (e: Error) => setMathsError(e.message));
    const f = (): void => setHash(readHash());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);

  const entries = useMemo(() => [...catalog(), ...opened.entries], [opened]);
  const selected = entries.find((e) => e.id === hash.e) ?? entries[0];

  // a link with src=: the edited files (or a whole document opened from disk)
  useEffect(() => {
    const src = hash.src;
    if (!src || src === lastSrc.current) return;
    lastSrc.current = src;
    const id = hash.e ?? '';
    setUnpacking(true);
    void unpackFiles(src).then((files) => {
      setUnpacking(false);
      if (!files) return setNotes((n) => [...n, 'The link’s source could not be read.']);
      if (id.startsWith('open:') && !entries.some((e) => e.id === id)) {
        const e = openedDoc(id.slice(5), files);
        if (e) setOpened((o) => ({ ...o, entries: [...o.entries.filter((x) => x.id !== e.id), e] }));
      }
      setEdits((m) => ({ ...m, [id]: files }));
    });
  }, [hash.src, hash.e]); // eslint-disable-line react-hooks/exhaustive-deps

  const settings: PreviewSettings = {
    theme: hash.theme ?? (prefersDark() ? 'dark' : 'light'),
    reduced: hash.motion === 'reduced',
    gfx: hash.gfx !== '0',
    width: (hash.w as WidthPreset) ?? 'desktop',
  };
  const pane: Pane = hash.pane ?? 'preview';
  const outTab = hash.out ?? 'md';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings.theme]);

  /** Changes the URL: a new entry is a new history step, a setting is not. */
  const update = useCallback((patch: Partial<HashState>, push = false): void => {
    const next = { ...readHash(), ...patch };
    const h = writeHash(next);
    if (push) location.hash = h;
    else {
      history.replaceState(null, '', `${location.pathname}${location.search}#${h}`);
      setHash(readHash());
    }
  }, []);

  const select = (id: string): void => {
    setSheet(false);
    if (id === selected.id) return;
    lastSrc.current = undefined;
    update({ e: id, src: undefined }, true);
  };
  const hrefFor = (id: string): string => `#${writeHash({ ...hash, e: id, src: undefined })}`;

  const files = useMemo(() => applyEdits(selected.files, edits[selected.id]), [selected, edits]);
  const editedPaths = useMemo(() => new Set(selected.kind === 'opened' ? [] : Object.keys(changed(selected, files))), [selected, files]);
  const editedEntries = useMemo(() => new Set(Object.entries(edits).filter(([id, e]) => {
    const en = entries.find((x) => x.id === id);
    return en && en.kind !== 'opened' && Object.keys(changed(en, applyEdits(en.files, e))).length > 0;
  }).map(([id]) => id)), [edits, entries]);

  // the URL follows the edits, a moment after typing stops
  useEffect(() => {
    if (selected.kind === 'case' || unpacking) return;
    const t = setTimeout(() => {
      const c = edits[selected.id] || selected.kind === 'opened' ? changed(selected, files) : {};
      if (!Object.keys(c).length) {
        if (readHash().src) {
          lastSrc.current = undefined;
          update({ src: undefined });
        }
        return;
      }
      void packFiles(c).then((src) => {
        if (readHash().e !== selected.id) return;
        lastSrc.current = src;
        update({ src });
      });
    }, 500);
    return () => clearTimeout(t);
  }, [files, selected, edits, update, unpacking]);

  // compile as you type, after a short pause (a new entry compiles at once)
  const [input, setInput] = useState<{ id: string; files: SourceFile[] } | null>(null);
  useEffect(() => {
    if (selected.kind === 'case') return;
    const now = input?.id !== selected.id;
    const t = setTimeout(() => setInput({ id: selected.id, files }), now ? 0 : 250);
    return () => clearTimeout(t);
  }, [files, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = useMemo(() => {
    if (!input || !maths) return null;
    const entry = entries.find((e) => e.id === input.id);
    return { id: input.id, ...build(input.files, { maths, extraPacks: entry?.kind === 'opened' ? opened.packs : undefined, ...entry?.build }) };
  }, [input, maths]); // eslint-disable-line react-hooks/exhaustive-deps

  // a conformance case: its bundle, loaded when picked
  const [conf, setConf] = useState<{ id: string; c: ConfCase } | null>(null);
  useEffect(() => {
    if (selected.kind !== 'case' || conf?.id === selected.id) return;
    let live = true;
    void selected.load!().then((c) => live && setConf({ id: selected.id, c }));
    return () => {
      live = false;
    };
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCase = selected.kind === 'case';
  const caseReady = isCase && conf?.id === selected.id ? conf.c : null;
  const current = isCase ? (caseReady ? { id: selected.id, bundle: caseReady.bundle, diags: [], ms: 0 } : null) : result?.id === selected.id ? result : null;
  const shownEntry = entries.find((e) => e.id === current?.id) ?? selected;
  const drawBundle = useMemo(() => (current?.bundle ? withAssets(current.bundle, shownEntry.assets) : null), [current?.bundle, shownEntry]);

  const [drawn, setDrawn] = useState<{ bundle: unknown; errors: DrawnError[] } | null>(null);
  const onDrawn = useCallback((errors: DrawnError[]) => setDrawn({ bundle: drawBundle, errors }), [drawBundle]);
  const diags: DiagItem[] = useMemo(() => {
    const out: DiagItem[] = (current?.diags ?? []).map((d) => ({ severity: d.severity, code: d.code, message: d.message, file: d.pos?.file, line: d.pos?.line, col: d.pos?.col, path: d.path, stage: 'compile' }));
    if (drawn && drawn.bundle === drawBundle) for (const e of drawn.errors) out.push({ severity: 'error', code: e.code, message: `${e.name ? `${e.name}: ` : ''}${e.message}`, file: e.pos?.file, line: e.pos?.line, col: e.pos?.col, stage: 'draw' });
    return out;
  }, [current, drawn, drawBundle]);
  const json = useMemo(() => (current?.diags ?? []).map(jsonLine), [current]);

  const onJump = (d: DiagItem): void => {
    if (!d.line) return;
    const target = files.find((f) => f.path === d.file) ?? (d.file ? undefined : files[0]);
    if (!target) return;
    setActiveFile((a) => ({ ...a, [selected.id]: target.path }));
    setJump({ line: d.line, col: d.col ?? 1, n: Date.now() });
    if (!matchMedia('(min-width: 1024px)').matches) update({ pane: 'source' });
  };

  const active = activeFile[selected.id] ?? files[0]?.path ?? '';
  const pending = !isCase && (input?.id !== selected.id || input.files !== files);
  const errors = diags.filter((d) => d.severity === 'error').length;
  const status = isCase ? (
    <span>a conformance case: its bundle, read only</span>
  ) : !maths ? (
    <span>loading the maths engine…</span>
  ) : pending ? (
    <span>compiling…</span>
  ) : current ? (
    <span data-pg-compiled={current.ms.toFixed(0)}>
      {errors ? <span className="text-destructive">{errors} {errors === 1 ? 'error' : 'errors'}</span> : <span className="text-ok">compiles</span>} · {current.ms.toFixed(0)} ms
    </span>
  ) : null;

  const share = async (): Promise<void> => {
    const c = isCase ? {} : changed(selected, files);
    const src = Object.keys(c).length ? await packFiles(c) : undefined;
    lastSrc.current = src;
    update({ src });
    const url = location.href;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onOpen = async (list: FileList | null): Promise<void> => {
    if (!list?.length) return;
    const r = await openFiles(Array.from(list), opened);
    setOpened(r.opened);
    setNotes(r.notes);
    if (r.first) select(r.first);
  };

  const image = useCallback((href: string) => assetUrl(shownEntry.assets, href), [shownEntry]);
  const loading = mathsError ? `The maths engine didn't load: ${mathsError}` : !maths ? 'Loading the maths engine…' : isCase && !caseReady ? 'Loading the case…' : !current ? 'Compiling…' : undefined;
  const sidebar = <Sidebar entries={entries} selected={selected.id} hrefFor={hrefFor} onSelect={select} edited={editedEntries} />;

  return (
    <TooltipProvider>
      <div className="pg-app flex h-svh flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="icon-sm" className="xl:hidden" aria-label="Examples" onClick={() => setSheet(true)} data-pg-menu="">
            <Menu />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hidden xl:inline-flex" aria-label={side ? 'Hide the examples' : 'Show the examples'} aria-pressed={side} onClick={() => setSide(!side)}>
            <PanelLeft />
          </Button>
          <BookOpen className="hidden size-4 text-muted-foreground sm:block xl:hidden" aria-hidden />
          <h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold">
            <a href="../" className="flex items-center gap-2" aria-label="MKP home" data-pg-home="">
              <span className="grid size-6 place-items-center rounded-md bg-brand font-mono text-[10px] font-bold text-primary-foreground" aria-hidden>
                M↓
              </span>
              MKP
            </a>
            <span className="font-normal text-muted-foreground">docs</span>
            {__PG_COMMIT__ ? <span className="font-mono text-xs font-normal text-muted-foreground">{__PG_COMMIT__}</span> : null}
          </h1>
          <span className="hidden text-muted-foreground sm:inline" aria-hidden>
            /
          </span>
          <p className="min-w-0 flex-1 truncate text-sm" data-pg-title="">
            {selected.num ? <span className="mr-1.5 font-mono text-xs text-muted-foreground">{selected.num}</span> : null}
            {selected.title}
          </p>
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50" title="Open a .mkp.md (with its .mkp) or a .mkpack">
              <FolderOpen /> <span className="hidden sm:inline">Open</span>
              <input className="sr-only" type="file" accept=".mkpack,.md,.mkp" multiple data-pg-open="" onChange={(e) => void onOpen(e.currentTarget.files)} />
            </label>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void share()} title="Copy a link to this document, with your edits" data-pg-share="">
            {copied ? <Check /> : <Link2 />} <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
          </Button>
        </header>
        {notes.length ? (
          <div className="flex shrink-0 items-start gap-2 border-b bg-warn/10 px-3 py-1.5 text-xs" role="status">
            <span className="flex-1">{notes.join(' · ')}</span>
            <Button variant="ghost" size="xs" onClick={() => setNotes([])}>
              Dismiss
            </Button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <aside className={cn('hidden w-68 shrink-0 flex-col border-r pt-3', side && 'xl:flex')} aria-label="Examples, limits and cases">
            {sidebar}
          </aside>
          <Sheet open={sheet} onOpenChange={setSheet}>
            <SheetContent side="left" className="pt-3">
              <SheetTitle className="px-4 pb-1 text-sm">Examples</SheetTitle>
              <SheetDescription className="sr-only">Pick an example, a limit or a conformance case.</SheetDescription>
              {sidebar}
            </SheetContent>
          </Sheet>
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 border-b lg:hidden" role="tablist" aria-label="Panes">
              {PANES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={pane === p.id}
                  data-pg-pane-tab={p.id}
                  className={cn('flex flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent py-2 text-sm text-muted-foreground', pane === p.id && 'border-foreground font-medium text-foreground')}
                  onClick={() => update({ pane: p.id })}
                >
                  {p.label}
                  {p.id === 'source' && errors ? <span className="rounded-full bg-destructive px-1.5 text-[10px] leading-4 text-white">{errors}</span> : null}
                </button>
              ))}
            </div>
            <div className="pg-panes min-h-0 flex-1">
              <section className="pg-pane" data-active={pane === 'source' || undefined} aria-label="Source">
                <h2 className="pg-pane-title">Source</h2>
                <SourcePane
                  files={files}
                  active={active}
                  onActive={(path) => setActiveFile((a) => ({ ...a, [selected.id]: path }))}
                  onEdit={(path, text) => setEdits((m) => ({ ...m, [selected.id]: { ...m[selected.id], [path]: text } }))}
                  diags={diags}
                  jump={jump}
                  onJump={onJump}
                  edited={editedPaths}
                  onReset={() => {
                    setEdits((m) => {
                      const n = { ...m };
                      delete n[selected.id];
                      return n;
                    });
                  }}
                  status={status}
                  readOnly={caseReady ? { path: `conformance/cases/${caseReady.id}.json`, text: JSON.stringify({ id: caseReady.id, steps: caseReady.steps, hosts: caseReady.hosts, bundle: caseReady.bundle }, null, 1) } : undefined}
                  expect={selected.expect}
                />
              </section>
              <section className="pg-pane" data-active={pane === 'preview' || undefined} aria-label="Preview">
                <h2 className="pg-pane-title">Preview</h2>
                <PreviewPane
                  entry={shownEntry}
                  builtFor={current?.id ?? ''}
                  bundle={loading ? null : (drawBundle ?? null)}
                  maths={maths}
                  diags={diags}
                  onJump={onJump}
                  settings={settings}
                  onSettings={(s) =>
                    update({
                      ...(s.theme ? { theme: s.theme } : {}),
                      ...(s.reduced !== undefined ? { motion: s.reduced ? 'reduced' : undefined } : {}),
                      ...(s.gfx !== undefined ? { gfx: s.gfx ? undefined : '0' } : {}),
                      ...(s.width ? { w: s.width === 'desktop' ? undefined : s.width } : {}),
                    })
                  }
                  conf={caseReady}
                  onDrawn={onDrawn}
                  loading={loading}
                />
              </section>
              <section className="pg-pane" data-active={pane === 'output' || undefined} aria-label="Output">
                <h2 className="pg-pane-title">Output</h2>
                <OutputPane bundle={current?.bundle ?? null} maths={maths} diags={diags} json={json} onJump={onJump} tab={outTab} onTab={(t) => update({ out: t === 'md' ? undefined : t })} md={md} onMd={setMd} image={image} docFile={files[0]?.path} />
              </section>
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
