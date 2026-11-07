// What's new, which is the changelog: every release's changelog/<version>.mkp.md, newest first, laid
// out after the What's new reference. Each version is an article with its summary and sections; each
// item says what changed, with the change working under it where a widget shows it. Filter by kind or
// by words, fold the older versions, and follow along in the Versions index. `#0.2.2` opens a version.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Link2, Rss, Search, X } from 'lucide-react';
import { compile, Runtime, type IRBundle, type VNode } from '@mkp/core';
import { MkpProvider, Node, useMkpTheme, useMkpView, useMkpWidth } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { markdownToHtml } from '@mkp/page';
import { cn } from '@/lib/utils';
import { components } from '../kit';
import { REPO, SiteHeader, useTheme, type Theme } from './chrome';
import { filtered, KINDS, longDate, newestFirst, readChangelog, wordsOf, type Filter, type Kind, type Release } from './changelog';

/** Every release's changelog, as the site is built with them. */
const SOURCES = import.meta.glob('../../../../changelog/*.mkp.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function releases(sources: Record<string, string> = SOURCES): Release[] {
  return Object.entries(sources)
    .map(([file, text]) => readChangelog(text, file))
    .sort(newestFirst);
}

/** Each kind's colour: a dot, never the colour alone (each has its word). */
export const DOT: Record<string, string> = {
  Breaking: 'bg-red-600 dark:bg-red-400',
  New: 'bg-emerald-600 dark:bg-emerald-400',
  Changed: 'bg-blue-600 dark:bg-blue-400',
  Fixed: 'bg-amber-600 dark:bg-amber-400',
  API: 'bg-violet-600 dark:bg-violet-400',
  Migration: 'bg-slate-500 dark:bg-slate-400',
};
const dot = (kind: string): string => cn('inline-block size-2 shrink-0 rounded-full forced-colors:bg-[CanvasText]', DOT[kind] ?? 'bg-muted-foreground');
const noun = (kind: Filter['kind'], n: number): string => `${kind === 'All' ? '' : `${kind === 'API' ? 'API' : kind.toLowerCase()} `}note${n === 1 ? '' : 's'}`;
const OPEN_NEWEST = 3;

/** An item's Markdown as HTML: the changelog is this repository's own file. */
const html = (md: string): string => markdownToHtml(md, { maths: null });

/** Marks every word in `el`'s text with <mark>, after taking the old marks out. */
function markWords(el: HTMLElement | null, words: string[]): void {
  if (!el) return;
  for (const m of [...el.querySelectorAll('mark[data-found]')]) m.replaceWith(document.createTextNode(m.textContent ?? ''));
  el.normalize();
  if (!words.length) return;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (re.test((n as Text).data)) texts.push(n as Text);
  for (const t of texts) {
    const frag = document.createDocumentFragment();
    for (const part of t.data.split(re)) {
      if (!part) continue;
      if (re.test(part) && words.some((w) => part.toLowerCase() === w)) {
        const m = document.createElement('mark');
        m.dataset.found = '';
        m.textContent = part;
        frag.append(m);
      } else frag.append(part);
      re.lastIndex = 0;
    }
    t.replaceWith(frag);
  }
}

/** A line of plain text with the words marked. */
function Marked({ words, className, children }: { words: string[]; className?: string; children: string }): ReactNode {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => markWords(ref.current, words), [words, children]);
  return (
    <p ref={ref} className={className}>
      {children}
    </p>
  );
}

/** An item's words and code; scrollable blocks take focus so a keyboard can scroll them. */
function ItemBody({ md, words }: { md: string; words: string[] }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useMemo(() => html(md), [md]);
  useEffect(() => {
    for (const pre of ref.current?.querySelectorAll('pre') ?? []) pre.tabIndex = 0;
    markWords(ref.current, words);
  }, [inner, words]);
  return <div ref={ref} data-item-body="" className="whats-new-item min-w-0 [&_code]:break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_p]:my-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/50 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:underline [&_mark]:rounded-sm [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-700/60 dark:[&_mark]:text-foreground" dangerouslySetInnerHTML={{ __html: inner }} />;
}

/** A version's widgets, compiled once, drawn where its items say. */
function Demos({ r, theme, children }: { r: Release; theme: Theme; children: ReactNode }): ReactNode {
  const built = useMemo(() => {
    if (!r.widgets) return null;
    const b = compile({ packs: [] }).document(r.source, `changelog/${r.version}.mkp.md`);
    return b ? { b, rt: new Runtime(b as IRBundle, { capabilities: ['core@1', 'gfx@1'] }) } : null;
  }, [r]);
  if (!built) return <>{children}</>;
  return (
    <MkpProvider bundle={built.b} runtime={built.rt} components={components} tokens={shadcnTokens}>
      <ThemeOf theme={theme} />
      {children}
    </MkpProvider>
  );
}

function ThemeOf({ theme }: { theme: Theme }): null {
  useMkpTheme(theme);
  return null;
}

/** One widget block of a version, in its own root (the stylesheet is scoped to .mkp-root). */
function Demo({ index, theme }: { index: number; theme: Theme }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useMkpWidth(ref);
  let nodes: VNode[] = [];
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    nodes = useMkpView().filter((n) => n.t === 'scope');
  } catch {
    return null;
  }
  const n = nodes[index];
  if (!n) return null;
  return (
    <div ref={ref} className="mkp-root mt-3 rounded-lg border bg-background p-4" data-theme={theme} data-demo={index}>
      <Node n={n} />
    </div>
  );
}

function Chip({ kind, count, pressed, onPress }: { kind: Filter['kind']; count: number; pressed: boolean; onPress: () => void }): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      data-chip={kind}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        pressed ? 'border-foreground bg-background font-medium forced-colors:border-[Highlight]' : 'border-transparent text-muted-foreground',
      )}
    >
      {kind !== 'All' ? <span className={dot(kind)} aria-hidden /> : null}
      {kind}
      <span className="rounded bg-muted px-1.5 font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}

function VersionView({ r, latest, open, onToggle, f, theme, onCopy }: { r: Release; latest: boolean; open: boolean; onToggle: () => void; f: Filter; theme: Theme; onCopy: (v: string) => void }): ReactNode {
  const words = useMemo(() => wordsOf(f.words), [f.words]);
  const filtering = f.kind !== 'All' || words.length > 0;
  const kept = filtered(r, f);
  const breakdown = r.sections.map((s) => `${s.items.length} ${s.kind}`).join(' · ');
  const total = r.sections.reduce((n, s) => n + s.items.length, 0);
  const id = `v${r.version.replace(/\./g, '-')}`;
  const head = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={`${id}-h`} tabIndex={-1} className={cn('text-xl font-semibold tracking-tight outline-none', filtering && !kept.count && 'text-base text-muted-foreground')}>
        <a href={`#${r.version}`} className="hover:underline">
          Version {r.version}
        </a>
      </h2>
      {r.date ? (
        <time dateTime={r.date} className="text-sm text-muted-foreground">
          {longDate(r.date)}
        </time>
      ) : null}
      {latest ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 forced-colors:border forced-colors:border-[Highlight]">
          <span className={dot('New')} aria-hidden /> Latest
        </span>
      ) : null}
      <button type="button" className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent focus-visible:opacity-100" aria-label={`Copy a link to version ${r.version}`} title="Copy a link to this version" onClick={() => onCopy(r.version)}>
        <Link2 className="size-4" />
      </button>
    </div>
  );
  // filtering left nothing here: one quiet line (its summary, when that is what matched)
  if (filtering && !kept.count) {
    if (kept.head && words.length)
      return (
        <article id={r.version} aria-labelledby={`${id}-h`} data-version={r.version} className="group scroll-mt-44 border-b py-4 last:border-b-0">
          {head}
          <Marked words={words} className="mt-1 text-sm">
            {r.summary}
          </Marked>
          <p className="text-sm text-muted-foreground">{`No ${noun(f.kind, 2)} in this version have “${f.words.trim()}”; its summary does.`}</p>
        </article>
      );
    return (
      <article id={r.version} aria-labelledby={`${id}-h`} data-version={r.version} className="group scroll-mt-44 border-b py-4 last:border-b-0">
        {head}
        <p className="mt-1 text-sm text-muted-foreground">{words.length ? `Nothing matching “${f.words.trim()}” in this version.` : `No ${noun(f.kind, 2)} in this version.`}</p>
      </article>
    );
  }
  const shown = filtering ? kept.sections : r.sections;
  return (
    <article id={r.version} aria-labelledby={`${id}-h`} data-version={r.version} data-open={open || undefined} className="group scroll-mt-44 border-b py-8 last:border-b-0">
      {head}
      <Marked words={words} className="mt-2 max-w-2xl text-lg text-pretty">
        {r.summary}
      </Marked>
      {!open ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" aria-expanded={false} aria-controls={`${id}-notes`} onClick={onToggle} className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent">
            Show {total} note{total === 1 ? '' : 's'} <ChevronDown className="size-4" />
          </button>
          <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {r.sections.map((s) => (
              <span key={s.title} className="inline-flex items-center gap-1.5">
                <span className={dot(s.kind)} aria-hidden />
                {s.items.length} {s.kind}
              </span>
            ))}
          </span>
          <span className="sr-only">{breakdown}</span>
        </div>
      ) : null}
      <div id={`${id}-notes`} hidden={!open}>
        {r.intro && !filtering ? <div className="mt-3 max-w-2xl text-muted-foreground [&_p]:my-1" dangerouslySetInnerHTML={{ __html: html(r.intro.replace(/^#\s.*$/m, '')) }} /> : null}
        <Demos r={r} theme={theme}>
          {shown.map((s) => (
            <section key={s.title} aria-labelledby={`${id}-${s.title}`} className="mt-6" data-kind={s.kind}>
              <h3 id={`${id}-${s.title}`} className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                <span className={dot(s.kind)} aria-hidden />
                {s.title}
                <span className="rounded bg-muted px-1.5 font-mono tabular-nums">{s.items.length}</span>
              </h3>
              <ul className="mt-2 space-y-3">
                {s.items.map((it, k) => (
                  <li key={k} className="min-w-0" data-item="">
                    {it.group && it.group !== s.items[k - 1]?.group ? <p className="mt-3 mb-1 text-xs font-medium text-muted-foreground">{it.group}</p> : null}
                    <div className="flex gap-2">
                      <span className="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <ItemBody md={it.md} words={words} />
                        {it.demos.map((d) => (
                          <Demo key={d} index={d} theme={theme} />
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Demos>
        {!filtering ? (
          <p className="mt-6 text-sm text-muted-foreground">
            <a className="underline-offset-4 hover:underline" href={`${REPO}/releases/tag/v${r.version}`}>
              Files for {r.version} on GitHub
            </a>
            {' · '}
            <a className="underline-offset-4 hover:underline" href={`../migrations/#v${r.version}`}>
              Migrating to {r.version}
            </a>
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** The version whose top has passed under the bars: what the index marks as being read. */
function useReading(list: Release[]): string | null {
  const [at, setAt] = useState<string | null>(list[0]?.version ?? null);
  useEffect(() => {
    let raf = 0;
    const go = (): void => {
      raf = 0;
      let cur = list[0]?.version ?? null;
      for (const r of list) {
        const el = document.getElementById(r.version);
        if (el && el.getBoundingClientRect().top < 180) cur = r.version;
      }
      setAt(cur);
    };
    const on = (): void => {
      if (!raf) raf = requestAnimationFrame(go);
    };
    window.addEventListener('scroll', on, { passive: true });
    go();
    return () => {
      window.removeEventListener('scroll', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [list]);
  return at;
}

export function WhatsNew(): ReactNode {
  const [theme, toggle] = useTheme();
  const list = useMemo(() => releases(), []);
  const [f, setF] = useState<Filter>({ kind: 'All', words: '' });
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [addressed, setAddressed] = useState<string | null>(null);
  const [said, setSaid] = useState<{ title: string; text: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const words = useMemo(() => wordsOf(f.words), [f.words]);
  const filtering = f.kind !== 'All' || words.length > 0;
  const reading = useReading(list);

  // what's kept, version by version, and the chips' counts under the words
  const kept = useMemo(() => list.map((r) => ({ r, ...filtered(r, f) })), [list, f]);
  const counts = useMemo(() => {
    const byWords = list.map((r) => filtered(r, { kind: 'All', words: f.words }));
    const c: Record<string, number> = { All: byWords.reduce((n, x) => n + x.count, 0) };
    for (const k of KINDS) c[k] = byWords.reduce((n, x) => n + x.sections.filter((s) => s.kind === k).reduce((m, s) => m + s.items.length, 0), 0);
    return c;
  }, [list, f.words]);
  const notes = kept.reduce((n, x) => n + x.count, 0);
  const versions = kept.filter((x) => x.count > 0).length;

  // an address at a version: unfolded, scrolled under the bars, its heading focused
  const goTo = useCallback(
    (hash: string) => {
      let v: string;
      try {
        v = decodeURIComponent(hash.replace(/^#/, ''));
      } catch {
        return;
      }
      if (!list.some((r) => r.version === v)) return;
      setAddressed(v);
      requestAnimationFrame(() => {
        const el = document.getElementById(v);
        el?.scrollIntoView?.({ block: 'start' });
        document.getElementById(`v${v.replace(/\./g, '-')}-h`)?.focus({ preventScroll: true });
      });
    },
    [list],
  );
  useEffect(() => {
    if (location.hash) goTo(location.hash);
    const on = (): void => goTo(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [goTo]);

  // `/` focuses the filter from anywhere but a field
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || t.isContentEditable)) return;
      e.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);

  // a new filter takes the reader back to the top of the results
  const results = useRef<HTMLDivElement>(null);
  const refilter = (next: Filter): void => {
    setF(next);
    const top = results.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) results.current?.scrollIntoView?.({ block: 'start' });
  };

  const isOpen = (r: Release, i: number): boolean => {
    if (filtering) return true;
    if (toggled[r.version] !== undefined) return toggled[r.version];
    return i < OPEN_NEWEST || r.version === addressed;
  };

  const copy = async (v: string): Promise<void> => {
    const url = `${location.origin}${location.pathname}#${v}`;
    try {
      await navigator.clipboard.writeText(url);
      setSaid({ title: 'Link copied', text: `It opens What's new at version ${v}.` });
    } catch {
      setSaid({ title: 'Could not copy the link', text: 'Your browser blocked clipboard access. Allow it for this site.' });
    }
    setTimeout(() => setSaid(null), 5000);
  };

  const latest = list[0];
  const status = filtering ? `${notes} ${noun(f.kind, notes)} in ${versions} of ${list.length} versions${words.length ? ` match “${f.words.trim()}”` : ''}.` : '';

  return (
    <>
      <SiteHeader theme={theme} toggle={toggle} at="whats-new" up="../" />
      <main className="mx-auto max-w-6xl px-4 pb-24">
        <div className="max-w-3xl pt-10">
          <h1 className="text-3xl font-semibold tracking-tight">What's new</h1>
          <p className="mt-2 text-muted-foreground">What changed in each version of MKP, newest first: what's new and why, what breaks and what to do, the API, and how to migrate. Where a widget shows a change, it's under it, live.</p>
          {latest ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                Latest: <a href={`#${latest.version}`} className="font-medium underline-offset-4 hover:underline">{latest.version}</a> · {longDate(latest.date)}
              </span>
              <a href="feed.xml" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline">
                <Rss className="size-3.5" /> Feed
              </a>
              <a href={`${REPO}/releases`} className="text-muted-foreground underline-offset-4 hover:underline">
                Releases on GitHub
              </a>
            </p>
          ) : null}
        </div>

        <div className="sticky top-14 z-10 -mx-4 mt-6 flex flex-col gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center">
          <div role="group" aria-label="Show notes" className="-mx-1 flex gap-1 overflow-x-auto px-1 [mask-image:linear-gradient(to_right,black_90%,transparent)] sm:[mask-image:none]">
            {(['All', ...KINDS] as Filter['kind'][]).map((k) => (counts[k] || k === 'All' ? <Chip key={k} kind={k} count={counts[k] ?? 0} pressed={f.kind === k} onPress={() => refilter({ ...f, kind: k })} /> : null))}
          </div>
          <label className="relative flex min-w-0 items-center sm:ml-auto sm:w-72">
            <span className="sr-only">Filter notes</span>
            <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden />
            <input
              ref={field}
              type="search"
              value={f.words}
              aria-keyshortcuts="/"
              aria-describedby="whats-new-status"
              placeholder="Filter notes"
              onChange={(e) => refilter({ ...f, words: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                if (f.words) refilter({ ...f, words: '' });
                else {
                  field.current?.blur();
                  document.querySelector<HTMLElement>('article h2')?.focus();
                }
              }}
              className="h-9 w-full rounded-full border bg-background pr-9 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
            />
            {f.words ? (
              <button type="button" aria-label="Clear the words" className="absolute right-2 inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent" onClick={() => refilter({ ...f, words: '' })}>
                <X className="size-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground" aria-hidden>
                /
              </kbd>
            )}
          </label>
        </div>

        <div className={cn('flex flex-wrap items-center gap-3 pt-4 text-sm', !filtering && 'sr-only')}>
          <p id="whats-new-status" aria-live="polite" data-status="">
            {status}
          </p>
          {filtering ? (
            <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent" onClick={() => refilter({ kind: 'All', words: '' })}>
              <X className="size-3.5" /> Clear filters
            </button>
          ) : null}
        </div>

        <div ref={results} className="grid scroll-mt-32 gap-10 min-[900px]:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="min-w-0">
            {filtering && !notes ? (
              <div className="py-10" data-nothing="">
                <p className="font-medium">Nothing matches{words.length ? ` “${f.words.trim()}”` : ''}.</p>
                <p className="text-sm text-muted-foreground">Try fewer words, or another kind.</p>
              </div>
            ) : (
              list.map((r, i) => <VersionView key={r.version} r={r} latest={i === 0} open={isOpen(r, i)} onToggle={() => setToggled((t) => ({ ...t, [r.version]: !isOpen(r, i) }))} f={f} theme={theme} onCopy={(v) => void copy(v)} />)
            )}
          </div>
          <nav aria-label="Versions" className="hidden min-[900px]:block">
            <div className="sticky top-40 max-h-[calc(100vh-11rem)] overflow-y-auto pt-8">
              <p className="mb-2 flex items-baseline justify-between text-sm font-semibold">
                Versions <span className="font-mono text-xs text-muted-foreground">{list.length}</span>
              </p>
              <ol className="border-l">
                {kept.map(({ r, count }) => (
                  <li key={r.version}>
                    <a
                      href={`#${r.version}`}
                      aria-current={reading === r.version ? 'location' : undefined}
                      data-index={r.version}
                      className={cn(
                        '-ml-px flex items-baseline justify-between gap-2 border-l-2 border-transparent py-1 pr-1 pl-3 text-sm hover:text-foreground',
                        reading === r.version ? 'border-foreground font-semibold forced-colors:border-[Highlight]' : 'text-muted-foreground',
                        filtering && !count && 'border-dashed font-normal',
                      )}
                    >
                      <span>
                        {r.version}
                        <span className="block text-xs font-normal">{longDate(r.date)}</span>
                      </span>
                      {filtering && count ? <span className="rounded bg-muted px-1.5 font-mono text-xs">{count}</span> : null}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>
        </div>
      </main>
      <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-30">
        {said ? (
          <div className="pointer-events-auto flex max-w-xs gap-2 rounded-lg border bg-background p-3 text-sm shadow-lg">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{said.title}</p>
              <p className="text-muted-foreground">{said.text}</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
