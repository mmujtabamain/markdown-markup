// mkp-dom: draws an MKP document into an element, from any framework or none.
//
//   const view = mount(el, bundle, { theme: 'auto', onSignal: (e) => … });
//   mount(el, bundle, { hydrate: true });   // el holds the bundle's first paint (--target fragment)
//   view.update({ theme: 'dark' });    // keeps the document's state
//   view.unmount();
//
// It draws MKP's own neutral look with @mkp/react, kept inside this file: the page that uses it
// needs no React of its own. The document's state lives in its runtime (view.runtime), which
// update() keeps; a new bundle (setBundle) starts it again.

import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { Diagnostics, MathsEngine, needsMaths, prerender, Runtime, type IRBundle, type MathsRenderer, type SignalEvent } from '@mkp/core';
import { MkpDocument, type TokenMap } from '@mkp/react';

export interface MountOptions {
  /** light or dark, or the reader's system setting (the default) */
  theme?: 'light' | 'dark' | 'auto';
  /** a widget's signals to its host (an answer given, a step reached) */
  onSignal?: (e: SignalEvent) => void;
  /**
   * the maths engine: 'auto' (the default) loads MKP's only when the document has maths the build
   * has not already typeset (needsMaths); null draws formulas as their TeX
   */
  maths?: MathsRenderer | 'auto' | null;
  /** your values for token names (colours, spaces, fonts…): kind → name → { value, dark? } */
  tokens?: TokenMap;
  /** fewer animations; the reader's system setting by default */
  reducedMotion?: boolean;
  /** a class for the document's root element */
  className?: string;
  /**
   * the element already holds this bundle's first paint (`mkp build --target fragment`, or
   * firstPaint() from @mkp/page), drawn with the same theme, tokens and class: take it over in
   * place rather than draw it again, so nothing moves. The bundle must be the one it was drawn from
   */
  hydrate?: boolean;
}

export interface MountedDocument {
  /** the document's runtime: its state, its widgets' commands */
  readonly runtime: Runtime | null;
  /** resolves once the document is drawn (after the maths engine has loaded) */
  readonly ready: Promise<void>;
  /** changes the theme, the signal handler, reduced motion, the tokens or the class; the state is kept */
  update(opts: Partial<Omit<MountOptions, 'maths' | 'hydrate'>>): void;
  /** draws another document (or a recompiled one): its state starts again */
  setBundle(bundle: IRBundle): void;
  /** removes the document from the element */
  unmount(): void;
}

let engine: Promise<MathsEngine> | null = null;
const sharedMaths = (): Promise<MathsEngine> => (engine ??= MathsEngine.create());

/** Draws `bundle` (from compile(), or a build's .ir.json) into `el`. */
export function mount(el: HTMLElement, bundle: IRBundle, opts: MountOptions = {}): MountedDocument {
  // made at the first drawing: a first paint stays on screen, untouched, until the document can draw
  let root: Root | null = null;
  let current = { ...opts };
  let doc = bundle;
  let maths: MathsRenderer | undefined;
  let runtime: Runtime | null = null;
  let gone = false;

  const start = (): void => {
    if (gone) return;
    if (maths) prerender(doc, maths as MathsEngine, new Diagnostics());
    // the handler is read at each signal, so update({ onSignal }) takes effect without a new runtime
    runtime = new Runtime(doc, { capabilities: ['core@1', 'gfx@1'], maths, reducedMotion: current.reducedMotion, onSignal: (e) => current.onSignal?.(e) });
    draw();
  };
  const draw = (): void => {
    if (gone || !runtime) return;
    const view = <MkpDocument bundle={doc} runtime={runtime} theme={current.theme ?? 'auto'} tokens={current.tokens} reducedMotion={current.reducedMotion} className={current.className} />;
    if (root) return root.render(view);
    if (opts.hydrate && el.firstElementChild)
      root = hydrateRoot(el, view, {
        // a first paint that isn't this bundle's (another build, other options) is drawn again: say so
        onRecoverableError: (e) => console.warn('mkp-dom: the first paint did not match the document, so it was drawn again', e),
      });
    else {
      root = createRoot(el);
      root.render(view);
    }
  };
  /** The engine this document draws with: the host's, MKP's when it has maths to typeset, or none. */
  const engineFor = (b: IRBundle): Promise<MathsRenderer | undefined> => {
    if (opts.maths === null) return Promise.resolve(undefined);
    if (opts.maths && opts.maths !== 'auto') return Promise.resolve(opts.maths);
    if (maths || !needsMaths(b)) return Promise.resolve(maths);
    return sharedMaths().then(
      (m) => m,
      (e: Error) => {
        // without the engine, formulas show as TeX: the document still draws
        console.warn('mkp-dom: the maths engine did not load', e);
        return undefined;
      },
    );
  };
  // the latest bundle wins: one set before an earlier one has drawn is the one drawn, and ready waits for it
  let latest: Promise<void> = Promise.resolve();
  const drawFrom = (b: IRBundle): Promise<void> =>
    (latest = engineFor(b).then((m) => {
      if (doc !== b) return latest;
      maths = m;
      start();
    }));
  const ready = drawFrom(doc);
  return {
    get runtime() {
      return runtime;
    },
    ready,
    update(next) {
      current = { ...current, ...next };
      draw();
    },
    setBundle(b) {
      doc = b;
      // a document with maths after one without: the engine loads first, then it draws
      void drawFrom(b);
    },
    unmount() {
      gone = true;
      root?.unmount();
    },
  };
}

export type { IRBundle, SignalEvent, Runtime } from '@mkp/core';
export type { TokenMap } from '@mkp/react';
