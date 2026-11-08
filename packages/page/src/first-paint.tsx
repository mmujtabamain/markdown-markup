// A document's first paint: the HTML MKP's neutral renderer draws for a bundle before any script
// runs, for a host to put in the element it will mount into. mount(el, bundle, { hydrate: true })
// (mkp-dom.js) then takes it over in place, so the text and widgets show at once, with no swap and
// no layout shift. The bundle must be the one drawn here (from the same build, maths typeset by it).

import { renderToString } from 'react-dom/server';
import { Runtime, type IRBundle, type MathsRenderer } from '@mkp/core';
import { domExterns, domIcons, MkpDocument, type DomExterns, type DomIcons, type TokenMap } from '@mkp/react';

export interface FirstPaintOptions {
  /** as mount()'s: light, dark, or the reader's system setting (the default) */
  theme?: 'light' | 'dark' | 'auto';
  /** as mount()'s: your values for token names */
  tokens?: TokenMap;
  /** as mount()'s: a class for the document's root element */
  className?: string;
  /** as mount()'s: your icons. An SVG string is drawn here; a function's box is left empty, and
   *  mount() fills it once the page has loaded */
  icons?: DomIcons;
  /** as mount()'s: your code for a pack's externs. Their boxes are left empty here, and mount()
   *  draws into them once the page has loaded */
  externs?: DomExterns;
  /** as mount()'s: 'external' leaves MKP's stylesheet out of the HTML (load mkp.css once in the
   *  page) and keeps only this document's tokens; 'inline' (the default) writes all of it */
  styles?: 'inline' | 'external';
  /** the maths engine, for maths with live values; without it they are drawn as their TeX, and
   *  mount() draws them again once its engine has loaded */
  maths?: MathsRenderer;
}

/** The HTML of `bundle` as mount() first draws it: pass mount() the same theme, tokens, icons, styles and class. */
export function firstPaint(bundle: IRBundle, opts: FirstPaintOptions = {}): string {
  // the capabilities mount() declares, so a gfx shape draws what it will draw in the browser
  const runtime = new Runtime(bundle, { capabilities: ['core@1', 'gfx@1'], maths: opts.maths });
  return renderToString(<MkpDocument bundle={bundle} runtime={runtime} theme={opts.theme ?? 'auto'} tokens={opts.tokens} icons={domIcons(opts.icons)} externs={domExterns(opts.externs)} styles={opts.styles} className={opts.className} />);
}
