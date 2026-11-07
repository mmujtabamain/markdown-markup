// What's new: each release, newest first, as a document in MKP (apps/site/whats-new/<version>.mkp.md):
// a line per change, and under it the change working, drawn live with the site's kit.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { compile, formatDiagnostic, MathsEngine, needsMaths, prerender, Diagnostics, Runtime, type IRBundle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { components } from '../kit';
import { REPO, SiteHeader, useTheme } from './chrome';

/** The releases' pages, by file: one document each, named for its version. */
const SOURCES = import.meta.glob('../../whats-new/*.mkp.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Release {
  version: string;
  file: string;
  text: string;
}

const versionOf = (file: string): string => /([\d.]+)\.mkp\.md$/.exec(file)?.[1] ?? '0';
const byVersion = (a: string, b: string): number => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/** Every release's page, newest first. */
export function releases(sources: Record<string, string> = SOURCES): Release[] {
  return Object.entries(sources)
    .map(([file, text]) => ({ version: versionOf(file), file: `whats-new/${file.split('/').pop()}`, text }))
    .sort((a, b) => byVersion(a.version, b.version));
}

/** A release's page, compiled: its bundle, or what is wrong with it. */
export function compileRelease(r: Release): { bundle: IRBundle | null; errors: string[] } {
  const c = compile({ packs: [] });
  const bundle = c.document(r.text, r.file);
  return { bundle: c.diags.errors.length ? null : bundle, errors: c.diags.errors.map(formatDiagnostic) };
}

function ReleaseView({ r, theme }: { r: Release; theme: 'light' | 'dark' }): ReactNode {
  const built = useMemo(() => compileRelease(r), [r]);
  // the maths engine only for a page that has maths to typeset
  const [ready, setReady] = useState<{ maths?: MathsEngine } | null>(null);
  useEffect(() => {
    const b = built.bundle;
    if (!b) return;
    if (!needsMaths(b)) return setReady({});
    MathsEngine.create().then(
      (m) => {
        prerender(b, m, new Diagnostics());
        setReady({ maths: m });
      },
      () => setReady({}),
    );
  }, [built]);
  const runtime = useMemo(() => (built.bundle && ready ? new Runtime(built.bundle, { capabilities: ['core@1', 'gfx@1'], maths: ready.maths }) : null), [built, ready]);
  const date = typeof built.bundle?.doc.front?.date === 'string' ? built.bundle.doc.front.date : '';
  return (
    <section id={`v${r.version}`} className="scroll-mt-16 border-b py-10 last:border-b-0" aria-label={`MKP ${r.version}`} data-release={r.version}>
      <p className="font-mono text-xs text-muted-foreground">
        {date}
        {date ? ' · ' : ''}
        <a className="underline-offset-4 hover:underline" href={`${REPO}/releases/tag/v${r.version}`}>
          release notes and files
        </a>
      </p>
      {built.errors.length ? (
        <pre className="mt-4 rounded-md border border-destructive/40 p-4 text-sm whitespace-pre-wrap text-destructive">{built.errors.join('\n')}</pre>
      ) : built.bundle && runtime ? (
        <div className="whats-new-doc mt-2">
          <MkpDocument bundle={built.bundle} runtime={runtime} theme={theme} components={components} tokens={shadcnTokens} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Drawing…</p>
      )}
    </section>
  );
}

export function WhatsNew(): ReactNode {
  const [theme, toggle] = useTheme();
  const list = useMemo(() => releases(), []);
  return (
    <>
      <SiteHeader theme={theme} toggle={toggle} at="whats-new" up="../" />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">What's new</h1>
        <p className="mt-2 text-muted-foreground">Each release's changes, one line each, with the change working under it. Try them: they are live.</p>
        {list.map((r) => (
          <ReleaseView key={r.version} r={r} theme={theme} />
        ))}
      </main>
    </>
  );
}
