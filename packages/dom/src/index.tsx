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
import { Diagnostics, MathsEngine, migrateBundle, needsMaths, needsMigration, prerender, Runtime, type Diagnostic, type IRBundle, type MathsRenderer, type SignalEvent } from '@mkp/core';
import { domExterns, domIcons, MkpDocument, MkpPlaces, type DomExterns, type DomIcons, type MkpExterns, type MkpIcons, type TokenMap } from '@mkp/react';

export type { DomIcon, DomIcons, DomExtern, DomExterns, DomExternProps } from '@mkp/react';
export { outline, places, placeholder, segments, DEFAULT_HEIGHT, type Place, type OutlineOptions, type Segment } from './outline';

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
   * your icons, for one name or all, drawn in place of MKP's text symbols: an SVG string (put in the
   * icon's box as given, the same in a first paint), or a function that draws into the box,
   * (box, { name, size, tone, color, label }) => cleanup. Documents still only name icons from the
   * fixed set; the box keeps its data-name, data-size, colour and label
   */
  icons?: DomIcons;
  /**
   * your own code for a pack's externs, by id ({ "devbench:accordion@1": draw }): draw(box,
   * { id, props, slot, dispatch }) draws into box once, places `slot` (what the document put inside
   * it, drawn by MKP) where it goes, and may return { update(props), destroy() } or a cleanup. An
   * extern with none here shows a placeholder with its summary
   */
  externs?: DomExterns;
  /**
   * the element holds the page's own first paint: the prose, drawn by the page, and a placeholder
   * for each top-level widget (mkp-outline's outline() or placeholder()). Each widget is drawn into
   * its placeholder, and nothing else in the element is touched
   */
  places?: boolean;
  /**
   * 'external': the page loads mkp.css (from the web zip) once, and each document writes only its
   * own tokens; 'inline' (the default) writes the whole stylesheet with each document. A first paint
   * taken over with hydrate must have been drawn the same way
   */
  styles?: 'inline' | 'external';
  /**
   * the element already holds this bundle's first paint (`mkp build --target fragment`, or
   * firstPaint() from @mkp/page), drawn with the same theme, tokens and class: take it over in
   * place rather than draw it again, so nothing moves. The bundle must be the one it was drawn from
   */
  hydrate?: boolean;
  /**
   * a bundle an older release built is migrated to this one as it loads: `keep` names the changes
   * whose old look to keep (or 'all'), and `onWarn` hears what changed (the console by default)
   */
  migrate?: { keep?: string[] | 'all'; onWarn?: (warnings: Diagnostic[]) => void };
}

export interface MountedDocument {
  /** the document's runtime: its state, its widgets' commands */
  readonly runtime: Runtime | null;
  /** resolves once the document is drawn (after the maths engine has loaded) */
  readonly ready: Promise<void>;
  /** changes the theme, the signal handler, reduced motion, the tokens, the icons, the styles or the class; the state is kept */
  update(opts: Partial<Omit<MountOptions, 'maths' | 'hydrate'>>): void;
  /** draws another document (or a recompiled one): its state starts again */
  setBundle(bundle: IRBundle): void;
  /** removes the document from the element */
  unmount(): void;
}

let engine: Promise<MathsEngine> | null = null;
const sharedMaths = (): Promise<MathsEngine> => (engine ??= MathsEngine.create());

/** Draws `bundle` (from compile(), or a build's .ir.json) into `el`. */
/** The bundle as this release draws it: migrated first when an older release built it. */
function upToDate(b: IRBundle, opts: MountOptions): IRBundle {
  if (!needsMigration(b)) return b;
  const r = migrateBundle(b, { keep: opts.migrate?.keep });
  if (r.warnings.length) (opts.migrate?.onWarn ?? ((w) => console.warn(`mkp-dom: migrated a ${r.from} bundle to ${r.to}`, w)))(r.warnings);
  return r.bundle;
}

export function mount(el: HTMLElement, bundle: IRBundle, opts: MountOptions = {}): MountedDocument {
  bundle = upToDate(bundle, opts);
  // made at the first drawing: a first paint stays on screen, untouched, until the document can draw
  let root: Root | null = null;
  let current = { ...opts };
  let doc = bundle;
  let maths: MathsRenderer | undefined;
  let runtime: Runtime | null = null;
  let gone = false;
  // the icons as components, made again only when update() is given other icons (so none is redrawn)
  let icons: { from: DomIcons | undefined; as: MkpIcons | undefined } = { from: undefined, as: undefined };
  const iconsNow = (): MkpIcons | undefined => (icons.from === current.icons ? icons.as : (icons = { from: current.icons, as: domIcons(current.icons) }).as);
  let externs: { from: DomExterns | undefined; as: MkpExterns | undefined } = { from: undefined, as: undefined };
  const externsNow = (): MkpExterns | undefined => (externs.from === current.externs ? externs.as : (externs = { from: current.externs, as: domExterns(current.externs) }).as);

  const start = (): void => {
    if (gone) return;
    if (maths) prerender(doc, maths as MathsEngine, new Diagnostics());
    // the handler is read at each signal, so update({ onSignal }) takes effect without a new runtime
    runtime = new Runtime(doc, { capabilities: ['core@1', 'gfx@1'], maths, reducedMotion: current.reducedMotion, onSignal: (e) => current.onSignal?.(e) });
    draw();
  };
  // places: the page's placeholders, and an element of MKP's own (hidden) for its stylesheet and root
  let targets: Map<number, HTMLElement> | null = null;
  let host: HTMLElement | null = null;
  if (opts.places) {
    targets = new Map([...el.querySelectorAll<HTMLElement>('[data-mkp-place]')].map((p) => [Number(p.getAttribute('data-mkp-place')), p]));
    host = document.createElement('div');
    host.hidden = true;
    host.setAttribute('data-mkp-places', '');
    el.appendChild(host);
  }
  const draw = (): void => {
    if (gone || !runtime) return;
    const props = { bundle: doc, runtime, theme: current.theme ?? 'auto', tokens: current.tokens, icons: iconsNow(), externs: externsNow(), styles: current.styles, reducedMotion: current.reducedMotion, className: current.className } as const;
    // drawn into the boxes: each takes its widget's drawn size in the same frame (the same, when it
    // fits its minwidth, minheight and aspect, which the widget keeps), and the outline is no longer busy
    const drawn = (): void => {
      for (const t of targets!.values()) {
        for (const k of ['height', 'min-width', 'min-height', 'aspect-ratio', 'max-width']) t.style.removeProperty(k);
        t.removeAttribute('aria-hidden');
      }
      el.querySelector('.mkp-outline[aria-busy]')?.removeAttribute('aria-busy');
    };
    const view = targets ? <MkpPlaces {...props} targets={targets} onDrawn={drawn} /> : <MkpDocument {...props} />;
    if (targets && host) {
      if (!root) root = createRoot(host);
      root.render(view);
      return;
    }
    if (root) {
      root.render(view);
      return;
    }
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
      b = upToDate(b, opts);
      doc = b;
      // a document with maths after one without: the engine loads first, then it draws
      void drawFrom(b);
    },
    unmount() {
      gone = true;
      root?.unmount();
      host?.remove();
    },
  };
}

export type { IRBundle, SignalEvent, Runtime } from '@mkp/core';
export type { TokenMap } from '@mkp/react';
