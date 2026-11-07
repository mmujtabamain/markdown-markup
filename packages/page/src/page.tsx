// The page script of mkp build --target html (built to dist/page.js, inlined into every page):
// reads the IR bundle from <script type="application/json" id="mkp-bundle"> and draws it with
// @mkp/react's neutral renderer, the core runtime and the maths engine. The theme follows the
// reader's system, or #theme=dark|light in the URL. If the renderer can't start, the page shows the
// document's Markdown that is already in it, with the reason above it.

import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Diagnostics, MathsEngine, needsMaths, prerender, Runtime, type IRBundle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';

type Theme = 'light' | 'dark' | 'auto';

const html = document.documentElement;
const fallback = document.querySelector<HTMLElement>('#mkp-page > .mkp-md');

/** Shows the Markdown that is already in the page, with why the document itself isn't drawn. */
function failed(why: string): void {
  html.classList.remove('mkp-js');
  const page = document.getElementById('mkp-page');
  if (!page) return;
  if (fallback && !page.contains(fallback)) page.append(fallback);
  const note = document.createElement('p');
  note.className = 'mkp-page-error';
  note.setAttribute('role', 'alert');
  note.textContent = `This page couldn't draw its widgets (${why}), so it shows the document's Markdown instead.`;
  page.prepend(note);
}

function themeNow(): Theme {
  const t = html.getAttribute('data-theme');
  return t === 'dark' || t === 'light' ? t : 'auto';
}

/** The theme: #theme=… when the URL gives one (it may change while the page is open), else the system's. */
function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(themeNow);
  useEffect(() => {
    const f = (): void => {
      const m = /(?:^#|&)theme=(dark|light)\b/.exec(location.hash);
      if (m) html.setAttribute('data-theme', m[1]);
      else html.removeAttribute('data-theme');
      setTheme(themeNow());
    };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return theme;
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('mkp: the renderer stopped', error, info.componentStack);
    failed(error.message);
  }
  override render(): ReactNode {
    return this.state.error ? null : this.props.children;
  }
}

function Page({ bundle }: { bundle: IRBundle }): ReactNode {
  // { m: undefined } is a document with nothing to typeset: it draws without starting the engine
  const [maths, setMaths] = useState<{ m?: MathsEngine } | null>(null);
  const theme = useTheme();
  useEffect(() => {
    if (!needsMaths(bundle)) return setMaths({});
    MathsEngine.create().then(
      (m) => {
        // formulas with no live values are typeset once, before the first drawing
        prerender(bundle, m, new Diagnostics());
        setMaths({ m });
      },
      (e: Error) => failed(`the maths engine didn't load: ${e.message}`),
    );
  }, [bundle]);
  const runtime = useMemo(() => (maths ? new Runtime(bundle, { capabilities: ['core@1', 'gfx@1'], maths: maths.m }) : null), [bundle, maths]);
  // the page around the document takes the document's own surface and ink (its tokens may set them)
  useEffect(() => {
    if (!runtime) return;
    const paint = (): void => {
      const root = document.querySelector('.mkp-page-doc .mkp-root');
      if (!root) return;
      const s = getComputedStyle(root);
      document.body.style.setProperty('--mkp-page-bg', s.backgroundColor);
      document.body.style.setProperty('--mkp-page-ink', s.color);
    };
    const raf = requestAnimationFrame(paint);
    const m = matchMedia('(prefers-color-scheme: dark)');
    const later = (): void => void requestAnimationFrame(paint);
    m.addEventListener('change', later);
    return () => {
      cancelAnimationFrame(raf);
      m.removeEventListener('change', later);
    };
  }, [runtime, theme]);
  if (!runtime) return null;
  return <MkpDocument bundle={bundle} runtime={runtime} theme={theme} />;
}

function start(): void {
  const el = document.getElementById('mkp-bundle');
  const page = document.getElementById('mkp-page');
  if (!el || !page) return failed('the page has no document in it');
  let bundle: IRBundle;
  try {
    bundle = JSON.parse(el.textContent ?? '') as IRBundle;
  } catch (e) {
    return failed(`its document couldn't be read: ${(e as Error).message}`);
  }
  // the drawing goes in its own element, so the Markdown stays in the page, hidden, to fall back to
  const root = document.createElement('div');
  root.className = 'mkp-page-doc';
  page.append(root);
  createRoot(root).render(
    <Boundary>
      <Page bundle={bundle} />
    </Boundary>,
  );
}

start();
