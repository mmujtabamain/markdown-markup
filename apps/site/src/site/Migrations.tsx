// Migrations: how a document, a pack or a stored bundle moves from one release to the next. Each
// release's part is built from its step's own declarations (packages/core/src/migrate/steps), so the
// page says what the code does; its before and after are in apps/site/migrations/<version>/, the
// after being what `mkp migrate` writes (a test holds them to it), drawn live.
import { useMemo, type ReactNode } from 'react';
import { compile, formatDiagnostic, Runtime, STEPS, type Step } from '@mkp/core';
import { MkpDocument } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { components } from '../kit';
import { SiteHeader, useTheme } from './chrome';

const FILES = import.meta.glob('../../migrations/*/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A release's before and after, and what mkp migrate said, when the site has them. */
export function exampleOf(version: string, files: Record<string, string> = FILES): { before: string; after: string; said: string } | null {
  const get = (name: string) => Object.entries(files).find(([k]) => k.endsWith(`/migrations/${version}/${name}`))?.[1];
  const before = get('before.mkp.md');
  const after = get('after.mkp.md');
  return before && after ? { before, after, said: get('said.txt') ?? '' } : null;
}

function Code({ children, label }: { children: string; label?: string }): ReactNode {
  return (
    <figure className="min-w-0">
      {label ? <figcaption className="mb-1 font-mono text-xs text-muted-foreground">{label}</figcaption> : null}
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 font-mono text-[13px] leading-relaxed whitespace-pre">{children}</pre>
    </figure>
  );
}

function Drawn({ source, theme }: { source: string; theme: 'light' | 'dark' }): ReactNode {
  const built = useMemo(() => {
    const c = compile({ packs: [] });
    const b = c.document(source, 'after.mkp.md');
    return b && !c.diags.errors.length ? { b, rt: new Runtime(b, { capabilities: ['core@1', 'gfx@1'] }) } : { errors: c.diags.errors.map(formatDiagnostic) };
  }, [source]);
  if ('errors' in built) return <pre className="text-sm text-destructive">{built.errors!.join('\n')}</pre>;
  return (
    <div className="rounded-lg border p-4" data-migrated-drawing="">
      <MkpDocument bundle={built.b} runtime={built.rt} theme={theme} components={components} tokens={shadcnTokens} />
    </div>
  );
}

function StepView({ s, theme }: { s: Step; theme: 'light' | 'dark' }): ReactNode {
  const ex = exampleOf(s.to);
  return (
    <section id={`v${s.to}`} className="scroll-mt-16 border-b py-10 last:border-b-0" data-step={s.to}>
      <h2 className="font-mono text-2xl font-semibold tracking-tight">
        {s.from} → {s.to}
      </h2>
      <p className="mt-2 text-muted-foreground">{s.summary}</p>
      {!s.renames.length && !s.changes.length && !s.removes.length ? (
        <p className="mt-3 text-sm text-muted-foreground" data-change="none">
          Nothing to change: <code>mkp migrate</code> only restamps each file.
        </p>
      ) : (
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-4 font-medium">What changes</th>
              <th className="py-2 pr-4 font-medium">mkp migrate</th>
              <th className="py-2 font-medium">Keep the old look?</th>
            </tr>
          </thead>
          <tbody>
            {s.renames.map((r) => (
              <tr key={r.name} className="border-b align-top" data-change={`rename-${r.name}`}>
                <td className="py-2 pr-4">
                  <code>{r.name}</code> is now {r.why}
                </td>
                <td className="py-2 pr-4">renames yours, with every use of it</td>
                <td className="py-2">a rename: nothing to keep. An app that sets it by name is told.</td>
              </tr>
            ))}
            {s.changes.map((c) => (
              <tr key={c.id} className="border-b align-top" data-change={c.id}>
                <td className="py-2 pr-4">{/^\S*=/.test(c.what) ? c.what : c.what[0].toUpperCase() + c.what.slice(1)}</td>
                <td className="py-2 pr-4">says so at each place</td>
                <td className="py-2">
                  {'how' in c.keep ? (
                    <>
                      yes: <code>--keep {c.id}</code> writes <code>{c.keep.how}</code>
                    </>
                  ) : (
                    <>no: {c.keep.cannot}</>
                  )}
                </td>
              </tr>
            ))}
            {s.removes.map((r) => (
              <tr key={r.what} className="border-b align-top">
                <td className="py-2 pr-4">{r.what} is removed</td>
                <td className="py-2 pr-4">says so at each place</td>
                <td className="py-2">{r.instead}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {!s.removes.length && (s.renames.length || s.changes.length) ? <p className="mt-3 text-sm text-muted-foreground">Nothing was removed.</p> : null}
      {ex ? (
        <>
          <h3 className="mt-8 text-lg font-semibold">Before and after</h3>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <Code label={`written for ${s.from}`}>{ex.before}</Code>
            <Code label={`after mkp migrate --take all`}>{ex.after}</Code>
          </div>
          {ex.said ? <Code label="what mkp migrate said">{ex.said.trim()}</Code> : null}
          <h3 className="mt-6 mb-3 text-lg font-semibold">The migrated card, drawn by {s.to}</h3>
          <Drawn source={ex.after} theme={theme} />
        </>
      ) : null}
    </section>
  );
}

const HOW = `mkp migrate notes/ --pack lib --check        # in CI: fails while anything is written for an older release
mkp migrate lib/ notes/ --write                # packs first, then the documents that use them
mkp migrate notes/ --keep zoom-minscale --write   # keep an old look where it can be kept
mkp migrate notes/ --take all --write          # take every new behaviour, without asking
mkp migrate saved.ir.json --write              # a bundle an older release built
mkp migrate notes/ --core mkp-web-0.2.1.zip    # offline: the older release's web files`;

const PACK = `walk@1 "A walk."
  deprecated "use walk@2: from is now start"
  in from text
  in speed num = 1
  …

walk@2 "A walk."
  in start text
  in look choice(classic|new) = new
  …

migrate walk@1 -> walk@2
  rename from -> start
  drop speed "walk@2 sets its own pace"
  keep look = classic "walk@1's look"`;

const ACROSS = `migrate statuslist@1 -> rows@1
  rename items -> rows
  rename items.name -> rows.title
  rename items.state -> rows.tone
  drop items.icon "rows show no icon"
  map items.state: done -> ok, todo -> muted, late -> bad`;

export function Migrations(): ReactNode {
  const [theme, toggle] = useTheme();
  const steps = [...STEPS].reverse();
  return (
    <>
      <SiteHeader theme={theme} toggle={toggle} at="migrations" up="../" />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Migrations</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Each release ships a step that brings what the previous one wrote up to date: documents, packs and stored bundles. From any release to the newest, every step in between runs in order. Nothing changes silently: each change is a warning at its line, and where an old look can be kept, you choose.
        </p>

        <section className="mt-8" aria-labelledby="how">
          <h2 id="how" className="text-xl font-semibold">
            How to migrate
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Every file says which release it was written for: <code>mkp: 0.2.2</code> in a document's front matter, <code># mkp 0.2.2 ir 1</code> at the top of a <code>.mkp</code> file, <code>"mkp"</code> in a bundle. A file without one was written for 0.2.1.
            </li>
            <li>A source is compiled by the release it was written for, brought up to date, written back in canonical form and stamped, then checked by the new release before anything is written.</li>
            <li>In a terminal, it asks about each change whose old look can be kept. Without an answer it takes the new behaviour and says how to keep the old one.</li>
          </ul>
          <div className="mt-4">
            <Code>{HOW}</Code>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            In a page, <code>mount(el, bundle, {'{ migrate: { keep: [\'zoom-minscale\'] } }'})</code> upgrades a stored bundle as it loads, and <code>migrateBundle()</code> does it anywhere.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="packs">
          <h2 id="packs" className="text-xl font-semibold">
            A pack's own versions
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A version stays as it is once published. A breaking change is always a new version beside the old one (<code>callout@2</code> next to <code>callout@1</code>), which is marked <code>deprecated</code>, so every use is told what to use instead. The pack says how a use moves, in MKP: <code>mkp check</code> proves it on the old version's fixtures, and <code>mkp migrate</code> moves the uses, asking whether to keep the old look.
          </p>
          <div className="mt-4">
            <Code>{PACK}</Code>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            A use can move to another widget too, in the pack or one it depends on (<code>ui:rows@1</code>). A dotted name reaches a field of each item of a record list, and <code>map</code> changes a choice's values. Every old field and every old value must go somewhere, or the check says which one doesn't.
          </p>
          <div className="mt-4">
            <Code>{ACROSS}</Code>
          </div>
        </section>

        <h2 className="mt-12 text-xl font-semibold">Release by release</h2>
        {steps.map((s) => (
          <StepView key={s.to} s={s} theme={theme} />
        ))}
      </main>
    </>
  );
}
