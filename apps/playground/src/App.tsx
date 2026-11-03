// The MKP playground (spec 12): loads the packs and documents, shows every fixture case live with
// its IR and its Markdown output beside it.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { compile, compileCase, fixtureCases, formatDiagnostic, MathsEngine, prerender, Runtime, stripPos, writeMarkdown, expand, type Compiled, type FixtureCase, type IRBundle, type MdToggle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';
import { packFolders } from './catalog';

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
  const compiled = useMemo<Compiled>(() => compile({ packs: packFolders().map((p) => ({ label: p.label, files: p.files })) }), []);
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const p of packFolders()) {
      for (const [path, bytes] of p.files) {
        if (path.endsWith('.mkp.md')) out.push({ id: `doc:${p.label}/${path}`, group: p.label, title: path, kind: 'doc', doc: { label: p.label, path, text: new TextDecoder().decode(bytes) } });
      }
    }
    for (const fc of fixtureCases(compiled)) out.push({ id: `case:${fc.pack}/${fc.widget}/${fc.name}`, group: fc.pack, title: `${fc.widget} · ${fc.name}`, kind: 'case', fc });
    return out;
  }, [compiled]);
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
  return (
    <div className="pg" data-theme={theme}>
      <style>{PG_CSS}</style>
      <aside className="pg-side" aria-label="cases">
        <h1>MKP playground</h1>
        <p className="pg-muted">{compiled.defs.size} definitions · {entries.filter((e) => e.kind === 'case').length} fixture cases</p>
        {compiled.diags.errors.length ? <p className="pg-bad">{compiled.diags.errors.length} build errors</p> : null}
        {groups.map((g) => (
          <section key={g}>
            <h2>{g}</h2>
            <ul>
              {entries
                .filter((e) => e.group === g)
                .map((e) => (
                  <li key={e.id}>
                    <a href={`#${new URLSearchParams({ ...hash, e: e.id }).toString()}`} aria-current={e === selected ? 'page' : undefined} onClick={(ev) => (ev.preventDefault(), select(e.id))}>
                      {e.title}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </aside>
      <main className="pg-main">
        <header className="pg-head">
          <div>
            <strong>{selected?.title}</strong>
            <span className="pg-muted"> {selected?.group}</span>
          </div>
          <div className="pg-tools">
            <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Dark' : 'Light'}</button>
            <label>
              <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.currentTarget.checked)} /> reduced motion
            </label>
          </div>
        </header>
        {!maths ? <p className="pg-muted">Loading the maths engine…</p> : null}
        {result && selected ? <Shown key={selected.id + theme + String(reduced)} entry={selected} bundle={result.bundle} maths={maths} theme={theme} reduced={reduced} negative={result.negative} ok={result.ok} diags={result.diags.map(formatDiagnostic)} /> : null}
        {result?.bundle ? (
          <section className="pg-out">
            <div role="tablist" className="pg-tabs">
              {['md', 'ir', 'expanded', 'diagnostics'].map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {t === 'md' ? 'Markdown' : t === 'ir' ? 'IR (bundle)' : t === 'expanded' ? 'IR (expanded)' : `Diagnostics (${result.diags.length})`}
                </button>
              ))}
              {tab === 'md' ? (
                <span className="pg-toggles">
                  {TOGGLES.map((t) => (
                    <label key={t}>
                      <input
                        type="checkbox"
                        checked={toggles.has(t)}
                        onChange={(e) => {
                          const s = new Set(toggles);
                          if (e.currentTarget.checked) s.add(t);
                          else s.delete(t);
                          setToggles(s);
                        }}
                      />{' '}
                      {t}
                    </label>
                  ))}
                </span>
              ) : null}
            </div>
            <pre className="pg-code" data-pg-out={tab}>
              {tab === 'md' ? writeMarkdown(result.bundle, { toggles: [...toggles] }).md : tab === 'ir' ? JSON.stringify(stripPos(result.bundle), null, 1).slice(0, 60000) : tab === 'expanded' ? JSON.stringify(stripPos(expand(result.bundle)).doc, null, 1).slice(0, 60000) : result.diags.map(formatDiagnostic).join('\n') || 'No diagnostics.'}
            </pre>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Shown({ entry, bundle, maths, theme, reduced, negative, ok, diags }: { entry: Entry; bundle: IRBundle | null; maths: MathsEngine | null; theme: 'light' | 'dark'; reduced: boolean; negative: boolean; ok: boolean; diags: string[] }): ReactNode {
  const runtime = useMemo(() => (bundle ? new Runtime(bundle, { maths: maths ?? undefined, reducedMotion: reduced, hosts: entry.fc?.hosts ? { '0': entry.fc.hosts } : undefined }) : null), [bundle, maths, reduced, entry]);
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
        <p>
          <strong>Negative case.</strong> {ok ? 'It fails as expected:' : 'It did not fail as expected.'}
        </p>
        <pre className="pg-code">{diags.join('\n')}</pre>
      </section>
    );
  }
  if (!bundle || !runtime) {
    return (
      <section className="pg-view" data-mkp-ready="1" data-pg-failed="1">
        <pre className="pg-code pg-bad">{diags.join('\n')}</pre>
      </section>
    );
  }
  return (
    <section className="pg-view" data-mkp-ready="1">
      {entry.fc?.play ? (
        <button type="button" className="pg-play" onClick={() => void play()}>
          Run the play steps
        </button>
      ) : null}
      <div className="pg-stage" data-pg-stage="1">
        <MkpDocument bundle={bundle} runtime={runtime} theme={theme} reducedMotion={reduced} />
      </div>
      {log.length ? <pre className="pg-code pg-signals">{log.join('\n')}</pre> : null}
    </section>
  );
}

const PG_CSS = `
body { margin: 0; font-family: system-ui, sans-serif; }
.pg { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; background: #f4f5f7; color: #1a1c1f; }
.pg[data-theme=dark] { background: #0d0f12; color: #e6e8eb; }
.pg-side { padding: 12px 14px; border-right: 1px solid #0002; overflow-y: auto; max-height: 100vh; position: sticky; top: 0; font-size: 13px; }
.pg-side h1 { font-size: 16px; margin: 4px 0; } .pg-side h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin: 14px 0 4px; }
.pg-side ul { list-style: none; padding: 0; margin: 0; } .pg-side a { color: inherit; text-decoration: none; display: block; padding: 2px 6px; border-radius: 4px; }
.pg-side a[aria-current=page] { background: #2563eb; color: #fff; }
.pg-muted { opacity: .65; } .pg-bad { color: #dc2626; }
.pg-main { padding: 14px 20px; min-width: 0; }
.pg-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.pg-tools { display: flex; gap: 10px; align-items: center; font-size: 13px; }
.pg-view { margin-bottom: 14px; }
.pg-stage { background: var(--pg-stage, #fff); border-radius: 10px; box-shadow: 0 1px 3px #0002; padding: 16px 18px; }
.pg[data-theme=dark] .pg-stage { background: #15171a; }
.pg-stage .mkp-root { background: transparent; }
.pg-play { margin-bottom: 8px; }
.pg-tabs { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
.pg-tabs button[aria-selected=true] { font-weight: 700; }
.pg-toggles { display: inline-flex; gap: 8px; margin-left: 12px; font-size: 13px; }
.pg-code { background: #0000000a; border-radius: 8px; padding: 10px 12px; font-size: 12px; overflow: auto; max-height: 420px; white-space: pre-wrap; word-break: break-word; }
.pg[data-theme=dark] .pg-code { background: #ffffff10; }
@media (max-width: 720px) { .pg { grid-template-columns: 1fr; } .pg-side { position: static; max-height: 220px; } }
`;
