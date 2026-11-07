// mkp-dom: draws an MKP document into an element, from any framework or none.
//
//   const view = mount(el, bundle, { theme: 'auto', onSignal: (e) => … });
//   view.update({ theme: 'dark' });    // keeps the document's state
//   view.unmount();
//
// It draws MKP's own neutral look with @mkp/react, kept inside this file: the page that uses it
// needs no React of its own. The document's state lives in its runtime (view.runtime), which
// update() keeps; a new bundle (setBundle) starts it again.

import { createRoot, type Root } from 'react-dom/client';
import { Diagnostics, MathsEngine, prerender, Runtime, type IRBundle, type MathsRenderer, type SignalEvent } from '@mkp/core';
import { MkpDocument } from '@mkp/react';

export interface MountOptions {
  /** light or dark, or the reader's system setting (the default) */
  theme?: 'light' | 'dark' | 'auto';
  /** a widget's signals to its host (an answer given, a step reached) */
  onSignal?: (e: SignalEvent) => void;
  /** the maths engine: 'auto' (the default) loads MKP's, null draws formulas as their TeX */
  maths?: MathsRenderer | 'auto' | null;
  /** fewer animations; the reader's system setting by default */
  reducedMotion?: boolean;
  /** a class for the document's root element */
  className?: string;
}

export interface MountedDocument {
  /** the document's runtime: its state, its widgets' commands */
  readonly runtime: Runtime | null;
  /** resolves once the document is drawn (after the maths engine has loaded) */
  readonly ready: Promise<void>;
  /** changes the theme, the signal handler, reduced motion or the class; the state is kept */
  update(opts: Partial<Omit<MountOptions, 'maths'>>): void;
  /** draws another document (or a recompiled one): its state starts again */
  setBundle(bundle: IRBundle): void;
  /** removes the document from the element */
  unmount(): void;
}

let engine: Promise<MathsEngine> | null = null;
const sharedMaths = (): Promise<MathsEngine> => (engine ??= MathsEngine.create());

/** Draws `bundle` (from compile(), or a build's .ir.json) into `el`. */
export function mount(el: HTMLElement, bundle: IRBundle, opts: MountOptions = {}): MountedDocument {
  const root: Root = createRoot(el);
  let current = { ...opts };
  let doc = bundle;
  let maths: MathsRenderer | undefined;
  let runtime: Runtime | null = null;
  let gone = false;

  const start = (): void => {
    if (maths) prerender(doc, maths as MathsEngine, new Diagnostics());
    // the handler is read at each signal, so update({ onSignal }) takes effect without a new runtime
    runtime = new Runtime(doc, { capabilities: ['core@1', 'gfx@1'], maths, reducedMotion: current.reducedMotion, onSignal: (e) => current.onSignal?.(e) });
    draw();
  };
  const draw = (): void => {
    if (gone || !runtime) return;
    root.render(<MkpDocument bundle={doc} runtime={runtime} theme={current.theme ?? 'auto'} reducedMotion={current.reducedMotion} className={current.className} />);
  };

  const ready =
    opts.maths === null
      ? Promise.resolve().then(start)
      : (opts.maths && opts.maths !== 'auto' ? Promise.resolve(opts.maths) : sharedMaths()).then(
          (m) => {
            maths = m;
            if (!gone) start();
          },
          (e: Error) => {
            // without the engine, formulas show as TeX: the document still draws
            console.warn('mkp-dom: the maths engine did not load', e);
            if (!gone) start();
          },
        );

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
      if (runtime) start();
    },
    unmount() {
      gone = true;
      root.unmount();
    },
  };
}

export type { IRBundle, SignalEvent, Runtime } from '@mkp/core';
