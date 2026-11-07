// Tokens as CSS custom properties, and the renderer's base stylesheet.

import type { IRTokenSet } from '@mkp/core';
import { TokenTable } from '@mkp/core';

export type TokenMap = Record<string, Record<string, Record<string, unknown>>>;

function px(v: unknown): string {
  return typeof v === 'number' ? `${v}px` : String(v);
}

/** CSS for a token table: light values on .mkp-root, dark under prefers-color-scheme and [data-theme=dark]. */
export function tokenCss(sets: IRTokenSet[], overrides?: TokenMap, scope = '.mkp-root'): string {
  const t = new TokenTable(sets, overrides);
  const light: string[] = [];
  const dark: string[] = [];
  for (const [k, v] of Object.entries(t.all())) {
    const [kind, name] = k.split(':');
    const value = v.value;
    switch (kind) {
      case 'color':
        light.push(`--mkp-color-${name}: ${value};`);
        dark.push(`--mkp-color-${name}: ${v.dark ?? value};`);
        break;
      case 'font':
        light.push(`--mkp-font-${name}: ${value}; --mkp-font-${name}-size: ${px(v.size ?? 16)}; --mkp-font-${name}-weight: ${v.weight ?? 400}; --mkp-font-${name}-line: ${v.line ?? 1.5};`);
        break;
      case 'space':
      case 'size':
      case 'radius':
        light.push(`--mkp-${kind}-${name}: ${px(value)};`);
        break;
      case 'shadow':
        light.push(`--mkp-shadow-${name}: 0 ${px(v.y ?? 1)} ${px(v.blur ?? 2)} ${v.color ?? '#0000001f'};`);
        break;
    }
  }
  return layer(`${scope} { ${light.join(' ')} }
@media (prefers-color-scheme: dark) { ${scope}:not([data-theme=light]) { ${dark.join(' ')} } }
${scope}[data-theme=dark] { ${dark.join(' ')} }`);
}

/**
 * MKP's own styles sit in one cascade layer, so any rule of the host's that isn't in a layer wins
 * over them whatever its specificity (GAPS 5). A host with layers of its own places this one in
 * its order: `@layer base, mkp, components, utilities`.
 */
export const layer = (css: string): string => `@layer mkp {\n${css}\n}`;

export const color = (name: unknown): string | undefined => (name && name !== 'none' ? `var(--mkp-color-${String(name)})` : undefined);
export const space = (name: unknown): string | undefined => (name && name !== 'none' ? `var(--mkp-space-${String(name)})` : undefined);
export const size = (name: unknown): string | undefined => (name && name !== 'none' && name !== 'fill' ? `var(--mkp-size-${String(name)})` : name === 'fill' ? '100%' : undefined);
export const radius = (name: unknown): string | undefined => (name && name !== 'none' ? `var(--mkp-radius-${String(name)})` : undefined);
export const shadow = (name: unknown): string | undefined => (name && name !== 'none' ? `var(--mkp-shadow-${String(name)})` : undefined);


/**
 * What a provider needs whoever draws the base set: the root, runs, containers, canvases, arrows,
 * the control bar and errors. A CSS reset (Tailwind's preflight, say) can't undo the displays MKP's
 * layout relies on: those few are !important, which in a layer holds against any unlayered rule
 * (GAPS 2, 3, 33). Everything else gives way to the host.
 */
export const BASE_CSS = layer(`
.mkp-root { color: var(--mkp-color-ink); background: var(--mkp-color-surface); font-family: var(--mkp-font-body), system-ui, sans-serif; font-size: var(--mkp-font-body-size); line-height: var(--mkp-font-body-line); }
.mkp-root * { box-sizing: border-box; }
.mkp-root [hidden] { display: none !important; }
.mkp-root :focus-visible { outline: 2px solid var(--mkp-color-accent); outline-offset: 2px; }
.mkp-root sup { font-size: 0.75em; line-height: 0; vertical-align: super !important; position: static !important; top: auto !important; }
.mkp-math { display: inline; }
.mkp-math svg { display: inline !important; overflow: visible; }
.mkp-math-display { display: block; text-align: center; margin: 0.6em 0; overflow-x: auto; }
.mkp-math-notes { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--mkp-space-xs) var(--mkp-space-l); margin: 0 0 0.6em; padding: 0; list-style: none; font-size: 0.875em; color: var(--mkp-color-muted); }
.mkp-math-notes > li { display: flex; align-items: baseline; gap: var(--mkp-space-s); }
.mkp-math-notes > li::before { content: ''; flex: none; width: 0.7em; height: 0.7em; border-radius: 2px; background: var(--mkp-mark-tone); }
.mkp-root [data-justify=center] { justify-content: center; justify-content: safe center; }
/* every layer positioned, so they paint in the order written: one with dim or blur (an opacity or a
   filter, a stacking context) no longer paints over the plain layers after it */
.mkp-root [data-layers] > * { grid-area: 1 / 1; min-width: 0; position: relative; }
.mkp-root [data-flow=column] > .mkp-pane { flex: 1 1 auto; }
.mkp-root [data-clip] { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--mkp-lines, 1); line-clamp: var(--mkp-lines, 1); overflow: hidden; }
.mkp-bar { display: flex; flex-wrap: wrap; gap: var(--mkp-space-m) var(--mkp-space-l); align-items: center; padding: var(--mkp-space-s) 0 0; margin-top: var(--mkp-space-m); border-top: 1px solid var(--mkp-color-line); }
.mkp-error { border: 1px solid var(--mkp-color-bad); border-radius: var(--mkp-radius-card); padding: var(--mkp-space-m); color: var(--mkp-color-ink); }
.mkp-error small { color: var(--mkp-color-bad); display: block; margin-top: var(--mkp-space-s); }
.mkp-canvas { position: relative; max-width: 100%; touch-action: none; isolation: isolate; }
.mkp-canvas > svg { display: block !important; overflow: hidden; }
.mkp-canvas [data-press] { cursor: pointer; }
/* a shape is no box: an outline would be drawn round its bounding box (a rectangle over a pie's
   slice), so it has none, focused by the pointer or not; the keyboard's focus traces its own edge */
.mkp-canvas [data-pointed], .mkp-canvas [data-pointed]:focus, .mkp-canvas [data-pointed]:focus-visible { outline: none; }
.mkp-canvas g[data-press]:focus-visible > path:first-child, .mkp-canvas circle[data-press]:focus-visible { stroke: var(--mkp-color-accent); stroke-width: 3px; }
.mkp-overlay-label { position: absolute; white-space: nowrap; pointer-events: none; font-size: 0.95em; line-height: 1.3; }
.mkp-overlay-label[data-size=small] { font-size: 0.8em; }
.mkp-overlay-label[data-size=large] { font-size: 1.15em; }
.mkp-overlay-label[data-chip] { padding: 1px 6px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 5px; background: var(--mkp-color-surface); font-weight: 550; }
.mkp-overlay-label[data-halo] { filter: drop-shadow(0 0 1px var(--mkp-color-surface)) drop-shadow(0 0 1px var(--mkp-color-surface)) drop-shadow(0 0 1px var(--mkp-color-surface)); }
.mkp-place { position: absolute; transform: translate(-50%, -50%); }
.mkp-handle { cursor: grab; } .mkp-handle:focus { outline: none; } .mkp-handle:focus-visible circle { stroke: var(--mkp-color-accent); stroke-width: 3; }
.mkp-scope { position: relative; }
/* a document's blocks: a widget block keeps the paragraph gap from what is beside it (a root of one block adds none) */
.mkp-root > * + .mkp-scope, .mkp-root > .mkp-scope + * { margin-top: var(--mkp-space-l); }
.mkp-root [data-mkp-behind] { isolation: isolate; }
/* a layer arrows are drawn in: zero specificity, so a full-screen frame stays fixed */
.mkp-root :where([data-mkp-arrow-host]) { position: relative; isolation: isolate; }
.mkp-arrows { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.mkp-arrows[data-layer=behind] { z-index: -1; }
.mkp-arrow-labels { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.mkp-arrow-labels[data-layer=behind] { z-index: -1; }
.mkp-arrow-label { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; font-size: 0.8em; line-height: 1.35; padding: 0 6px; border-radius: 999px; background: var(--mkp-color-surface); border: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
.mkp-arrow-label[data-align=start] { transform: translate(0, -50%); }
.mkp-arrow-label[data-align=end] { transform: translate(-100%, -50%); }
.mkp-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mkp-root code { font-family: var(--mkp-font-mono), ui-monospace, monospace; font-size: var(--mkp-font-mono-size); }
.mkp-root a { color: var(--mkp-color-accent); }
`);

/** The neutral base set's look, for a document with no provider's components. */
export const NEUTRAL_CSS = layer(`
.mkp-root h1, .mkp-root h2, .mkp-root h3, .mkp-root h4, .mkp-root h5, .mkp-root h6 { font-family: var(--mkp-font-heading), system-ui, sans-serif; font-weight: var(--mkp-font-heading-weight); line-height: var(--mkp-font-heading-line); margin: 0.6em 0 0.3em; }
.mkp-root h1 { font-size: calc(var(--mkp-font-heading-size) * 1.35); } .mkp-root h2 { font-size: var(--mkp-font-heading-size); } .mkp-root h3 { font-size: calc(var(--mkp-font-heading-size) * 0.85); }
.mkp-root p { margin: 0.5em 0; }
.mkp-root ul, .mkp-root ol { margin: 0.5em 0; padding-left: 1.5em; } .mkp-root li > p { margin: 0; }
.mkp-root code, .mkp-root pre { font-family: var(--mkp-font-mono), ui-monospace, monospace; font-size: var(--mkp-font-mono-size); }
.mkp-root pre code:has(.mkp-code-line) { counter-reset: mkp-line; }
.mkp-code-line { display: block; position: relative; padding-left: 4ch; counter-increment: mkp-line; }
.mkp-code-line::before { content: counter(mkp-line); position: absolute; left: 0; width: 3ch; text-align: right; color: var(--mkp-color-muted); }
.mkp-code-note { float: right; padding-left: 2ch; color: var(--mkp-color-muted); font-family: var(--mkp-font-body), system-ui, sans-serif; font-size: 0.85em; }
.mkp-code-line[aria-current] { background: color-mix(in srgb, var(--mkp-color-accent) 14%, transparent); font-weight: 700; }
.mkp-code-line[data-pick] { cursor: pointer; }
.mkp-code-line[data-pick]:hover { background: color-mix(in srgb, var(--mkp-color-accent) 8%, transparent); }
.mkp-root pre { background: color-mix(in srgb, var(--mkp-color-muted) 12%, transparent); padding: var(--mkp-space-m); border-radius: var(--mkp-radius-card); overflow-x: auto; }
.mkp-root hr { border: 0; border-top: 1px solid var(--mkp-color-line); margin: var(--mkp-space-l) 0; }
.mkp-root table { border-collapse: collapse; margin: 0.5em 0; } .mkp-root th, .mkp-root td { border: 1px solid var(--mkp-color-line); padding: var(--mkp-space-xs) var(--mkp-space-m); }
.mkp-root blockquote { margin: 0.6em 0; padding: var(--mkp-space-s) var(--mkp-space-l); border-left: 4px solid var(--mkp-quote, var(--mkp-color-muted)); background: color-mix(in srgb, var(--mkp-quote, var(--mkp-color-muted)) 9%, transparent); border-radius: 0 var(--mkp-radius-card) var(--mkp-radius-card) 0; }
.mkp-root blockquote > :first-child { margin-top: 0; } .mkp-root blockquote > :last-child { margin-bottom: 0; }
.mkp-press { font: inherit; color: inherit; background: color-mix(in srgb, var(--mkp-color-muted) 14%, var(--mkp-color-surface)); border: 1px solid var(--mkp-color-line); border-radius: var(--mkp-radius-card); padding: var(--mkp-space-xs) var(--mkp-space-m); cursor: pointer; min-height: 32px; min-width: 32px; display: inline-flex; align-items: center; justify-content: center; gap: var(--mkp-space-s); }
.mkp-press:hover:not(:disabled) { border-color: var(--mkp-color-accent); }
.mkp-press:disabled { opacity: 0.45; cursor: default; }
.mkp-press[data-kind=plain] { display: flex; flex-direction: column; align-items: stretch; padding: 0; border: 0; background: none; text-align: inherit; border-radius: var(--mkp-radius-card); }
.mkp-press[data-kind=plain][aria-pressed=true] { background: none; color: inherit; }
.mkp-press[data-emphasis=low] { background: none; border-color: transparent; }
.mkp-press[data-emphasis=high] { background: var(--mkp-color-ink); color: var(--mkp-color-surface); border-color: var(--mkp-color-ink); }
.mkp-press[aria-selected=true], .mkp-press[aria-pressed=true], .mkp-press[aria-checked=true] { background: var(--mkp-color-accent); color: var(--mkp-color-surface); border-color: var(--mkp-color-accent); }
.mkp-press[aria-selected=true] *, .mkp-press[aria-pressed=true] *, .mkp-press[aria-checked=true]:not([data-kind=radio], [data-kind=check]) * { color: inherit !important; }
.mkp-press.mkp-tab { border-radius: var(--mkp-radius-card) var(--mkp-radius-card) 0 0; }
.mkp-press[data-kind=radio], .mkp-press[data-kind=check] { justify-content: flex-start; text-align: left; }
.mkp-press[data-kind=radio]::before, .mkp-press[data-kind=check]::before { content: ''; flex: none; width: 1em; height: 1em; border: 1px solid currentColor; border-radius: 3px; }
.mkp-press[data-kind=radio]::before { border-radius: 50%; }
.mkp-press[data-kind=radio][aria-checked=true], .mkp-press[data-kind=check][aria-checked=true] { color: inherit; background: color-mix(in srgb, var(--mkp-color-muted) 14%, var(--mkp-color-surface)); }
.mkp-press[data-kind=radio][aria-checked=true]::before, .mkp-press[data-kind=check][aria-checked=true]::before { background: currentColor; box-shadow: inset 0 0 0 2px var(--mkp-color-surface); }
.mkp-press[data-kind=switch], .mkp-press[data-kind=switch][aria-checked=true] { background: none; border: 0; padding: 0; color: inherit; }
/* a switch's track and thumb are its own elements: a host's .mkp-press style never reaches them, and
   a host that wants the thumb to slide animates .mkp-switch-thumb itself (MKP moves nothing, SN 102) */
.mkp-switch { flex: none; position: relative; display: inline-block; width: 36px; height: 20px; border-radius: 10px; background: var(--mkp-color-muted); }
.mkp-switch-thumb { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--mkp-color-surface); }
.mkp-press[aria-checked=true] > .mkp-switch { background: var(--mkp-color-accent); }
.mkp-press[aria-checked=true] > .mkp-switch > .mkp-switch-thumb { transform: translateX(16px); }
.mkp-overlay-anchor[data-mode=menu]::after { content: '▾'; color: var(--mkp-color-muted); }
.mkp-meter { height: 8px; max-width: 100%; border-radius: var(--mkp-radius-pill, 999px); overflow: hidden; background: color-mix(in srgb, var(--mkp-color-muted) 25%, transparent); }
.mkp-meter > div { height: 100%; }
.mkp-range { accent-color: var(--mkp-color-accent); width: 160px; max-width: 100%; }
.mkp-field { font: inherit; color: inherit; background: var(--mkp-color-surface); border: 1px solid color-mix(in srgb, var(--mkp-color-muted) 60%, transparent); border-radius: var(--mkp-radius-card); padding: var(--mkp-space-xs) var(--mkp-space-m); min-height: 32px; max-width: 100%; }
textarea.mkp-field { resize: vertical; line-height: inherit; }
.mkp-field[data-tone] { border-width: 2px; }
.mkp-dialog { position: fixed; inset: 0; display: grid; place-items: center; background: #0006; z-index: 1000; }
.mkp-dialog > div, .mkp-popover { background: var(--mkp-color-surface); color: var(--mkp-color-ink); border: 1px solid var(--mkp-color-line); border-radius: var(--mkp-radius-card); box-shadow: var(--mkp-shadow-raised); padding: var(--mkp-space-l); max-width: min(90vw, 480px); }
.mkp-popover { position: absolute; z-index: 100; top: calc(100% + 4px); left: 0; min-width: 160px; }
`);
