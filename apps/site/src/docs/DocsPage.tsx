// The docs (docs/): the repository's docs/*.md, compiled as MKP when the site is built
// (docs-plugin.ts) and drawn here in the site's look. The hash names the document and, after a
// slash, a heading in it: #recipes/vue.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { MathsEngine, Runtime, type IRBundle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { docs, load, type DocEntry } from 'virtual:mkp-docs';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { components } from '../kit';
import { REPO, SiteHeader, useTheme } from '../site/chrome';

function readHash(): { slug: string; anchor: string } {
  const [slug = '', anchor = ''] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { slug: docs.some((d) => d.slug === slug) ? slug : docs[0].slug, anchor };
}

function useHash(): { slug: string; anchor: string } {
  const [h, setH] = useState(readHash);
  useEffect(() => {
    const on = (): void => setH(readHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return h;
}

/** A document's bundle, loaded when it is opened, with a runtime that draws its maths. */
function useDoc(slug: string): { bundle: IRBundle; runtime: Runtime } | null {
  const [doc, setDoc] = useState<{ slug: string; bundle: IRBundle; runtime: Runtime } | null>(null);
  useEffect(() => {
    let gone = false;
    void Promise.all([load[slug](), MathsEngine.create().catch(() => undefined)]).then(([m, maths]) => {
      if (!gone) setDoc({ slug, bundle: m.default, runtime: new Runtime(m.default, { capabilities: ['core@1', 'gfx@1'], maths }) });
    });
    return () => {
      gone = true;
    };
  }, [slug]);
  return doc && doc.slug === slug ? doc : null;
}

/** Where a link in a document goes on this site: another doc, a recipe or file on GitHub, or as written. */
function siteHref(href: string): string | null {
  if (/^[a-z]+:|^#|^\/\//i.test(href)) return null;
  const url = new URL(href, `${location.origin}/docs/`);
  const path = url.pathname.replace(/^\//, '');
  const doc = /^docs\/([\w-]+)\.md$/.exec(path);
  if (doc && docs.some((d) => d.slug === doc[1])) return `#${doc[1]}${url.hash ? `/${url.hash.slice(1)}` : ''}`;
  return `${REPO}/${path.endsWith('/') || !path.includes('.') ? 'tree' : 'blob'}/main/${path}${url.hash}`;
}

function DocList({ at, onPick }: { at: DocEntry; onPick?: () => void }): ReactNode {
  return (
    <nav aria-label="Docs" className="flex flex-col gap-0.5 text-sm" data-docs-nav="">
      {docs.map((d) => (
        <a
          key={d.slug}
          href={`#${d.slug}`}
          onClick={onPick}
          aria-current={d.slug === at.slug ? 'page' : undefined}
          className={cn('rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground', d.slug === at.slug && 'bg-brand-soft font-medium text-foreground')}
        >
          {d.label}
        </a>
      ))}
    </nav>
  );
}

export function DocsPage(): ReactNode {
  const [theme, toggle] = useTheme();
  const { slug, anchor } = useHash();
  const entry = docs.find((d) => d.slug === slug)!;
  const doc = useDoc(slug);
  const [sheet, setSheet] = useState(false);
  const article = useRef<HTMLElement>(null);
  const at = docs.indexOf(entry);
  const prev = docs[at - 1];
  const next = docs[at + 1];

  useEffect(() => {
    document.title = `${entry.label} · MKP docs`;
  }, [entry]);

  // the drawn headings get the outline's ids, in order, so #doc/heading can find them
  useEffect(() => {
    const root = article.current;
    if (!doc || !root) return;
    const drawn = [...root.querySelectorAll<HTMLElement>('.mkp-root h2, .mkp-root h3')];
    entry.headings.forEach((h, i) => drawn[i] && (drawn[i].id = h.id));
    const target = anchor ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView();
    else scrollTo(0, 0);
  }, [doc, entry, anchor]);

  const onClick = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href || !article.current?.contains(a)) return;
    const to = siteHref(href);
    if (to) {
      e.preventDefault();
      if (to.startsWith('#')) location.hash = to;
      else open(to, '_blank', 'noopener');
    }
  };

  const drawn = useMemo(
    () => (doc ? <MkpDocument bundle={doc.bundle} runtime={doc.runtime} theme={theme} components={components} tokens={shadcnTokens} /> : <p className="py-10 text-sm text-muted-foreground">Loading…</p>),
    [doc, theme],
  );

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader
        theme={theme}
        toggle={toggle}
        at="docs"
        up="../"
        wide
        before={
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="The docs" onClick={() => setSheet(true)} data-docs-menu="">
            <Menu />
          </Button>
        }
      />
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="left" className="w-72 p-4">
          <SheetTitle>Docs</SheetTitle>
          <SheetDescription className="sr-only">The MKP docs</SheetDescription>
          <DocList at={entry} onPick={() => setSheet(false)} />
        </SheetContent>
      </Sheet>
      <div className="mx-auto flex max-w-7xl gap-8 px-4">
        <aside className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-56 shrink-0 overflow-y-auto py-8 lg:block">
          <DocList at={entry} />
        </aside>
        <main className="min-w-0 flex-1 py-8">
          <article ref={article} onClick={onClick} className="docs-article max-w-3xl" data-docs-article={slug}>
            {drawn}
          </article>
          <nav className="mt-12 flex max-w-3xl justify-between gap-4 border-t pt-6 text-sm" aria-label="Previous and next">
            {prev ? (
              <a href={`#${prev.slug}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" data-docs-prev="">
                <ChevronLeft className="size-4" /> {prev.label}
              </a>
            ) : (
              <span />
            )}
            {next ? (
              <a href={`#${next.slug}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" data-docs-next="">
                {next.label} <ChevronRight className="size-4" />
              </a>
            ) : null}
          </nav>
        </main>
        <aside className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-56 shrink-0 overflow-y-auto py-8 xl:block" aria-label="On this page">
          <p className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">On this page</p>
          <ul className="flex flex-col gap-1 text-sm" data-docs-outline="">
            {entry.headings.map((h) => (
              <li key={h.id} className={cn(h.depth === 3 && 'pl-3')}>
                <a href={`#${slug}/${h.id}`} className={cn('block truncate text-muted-foreground hover:text-foreground', anchor === h.id && 'text-brand')} title={h.text}>
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
