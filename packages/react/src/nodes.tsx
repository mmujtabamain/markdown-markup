// The base set as React DOM components (spec 8): the four containers, text, media, press, range,
// field, overlay, canvas, Markdown blocks, the control bar, scopes with arrows, and the error boundary.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { Runtime, VNode, VRun } from '@mkp/core';
import { color, radius, shadow, size, space } from './style';
import { Canvas } from './canvas';
import { Arrows } from './arrows';
import { Frame, Icon, Pane, Zoom } from './shell';

/** What a host's route gets: the node, what goes on its outer element, and how to report events. */
export interface HostProps {
  n: VNode;
  /** data-mkp-* and hidden: spread on the outer element, so arrows and selectors still find it */
  attrs: Record<string, unknown>;
  /** the place its parent gives it: grow, basis, span, self */
  style: CSSProperties;
  dispatch: Runtime['dispatch'];
}

/** The base set (core@1, spec 8): what every provider implements. */
export const BASE_WIDGETS = ['column', 'row', 'grid', 'stack', 'text', 'image', 'press', 'range', 'meter', 'field', 'overlay', 'canvas', 'paragraph', 'heading', 'list', 'quote', 'code', 'math', 'divider', 'table', 'footnote', 'frame', 'pane', 'zoom', 'icon'] as const;
export type BaseWidget = (typeof BASE_WIDGETS)[number];

/** Draws one base widget. It is called as a plain function, so hooks go in what it returns. */
export type HostRoute = (props: HostProps) => ReactNode;

/**
 * A provider's definition of every base widget (spec 8, 15). Everything else is described in terms of
 * the base set, so a derived widget reaches a provider's components through its base widgets. With
 * none given, this renderer's neutral versions draw them.
 */
export type MkpComponents = Record<BaseWidget, HostRoute>;

export interface Ctx {
  rt: Runtime;
  components?: MkpComponents;
}

export const RuntimeCtx = createContext<Ctx | null>(null);

export function useCtx(): Ctx {
  const c = useContext(RuntimeCtx);
  if (!c) throw new Error('MKP nodes render inside <MkpDocument>');
  return c;
}

// ---------------------------------------------------------------------------------------------
// Inline runs: text, emphasis, code, links and maths

export function Runs({ runs }: { runs: VRun[] }): ReactNode {
  return runs.map((r, i) => <Run key={i} r={r} />);
}

/** A superscript a reset can't lift off its line (GAPS 33). */
const SUP: CSSProperties = { position: 'static', top: 'auto', verticalAlign: 'super', lineHeight: 0 };

function Run({ r }: { r: VRun }): ReactNode {
  switch (r.t) {
    case 'text': {
      let el: ReactNode = r.v;
      if (r.b) el = <strong>{el}</strong>;
      if (r.i) el = <em>{el}</em>;
      if (r.s) el = <s>{el}</s>;
      if (r.href) el = <a href={r.href}>{el}</a>;
      return el;
    }
    case 'code':
      return r.href ? (
        <a href={r.href}>
          <code>{r.v}</code>
        </a>
      ) : (
        <code>{r.v}</code>
      );
    case 'math':
      return <MathSpan m={r} />;
    case 'br':
      return <br />;
    case 'img':
      return <img src={r.src} alt={r.alt} style={{ maxWidth: '100%', display: 'inline' }} />;
    case 'fnref':
      return (
        <sup style={SUP}>
          <a href={`#fn-${r.label}`}>{r.n ?? r.label}</a>
        </sup>
      );
  }
}

export function MathSpan({ m, display }: { m: { tex: string; svg?: string; speech?: string }; display?: boolean }): ReactNode {
  const cls = display ? 'mkp-math mkp-math-display' : 'mkp-math';
  if (!m.svg) return <span className={cls}><i>{m.tex}</i></span>;
  // the SVG comes from the maths engine (TeX → MathJax → SVG, links removed), not from content
  return <span className={cls} role="img" aria-label={m.speech ?? m.tex} dangerouslySetInnerHTML={{ __html: m.svg }} />;
}

/** A part of a formula written \mark{id}{…}: its tone, and a note shown under the formula. */
export interface MathMark {
  id: string;
  tone?: string;
  note?: string;
}

/**
 * A display formula. Its marked parts are the engine's `.mkp-mark-<id>` groups, coloured by their
 * tone; the notes are listed under it, each with its tone's swatch.
 */
export function MathBlock({ n, attrs, style }: { n: VNode; attrs?: Record<string, unknown>; style?: CSSProperties }): ReactNode {
  const marks = (n.p.marks as MathMark[] | undefined) ?? [];
  const scope = `[data-mkp-key="${String(n.key).replace(/["\\]/g, '\\$&')}"]`;
  const rules = marks
    .filter((m) => m.tone && m.tone !== 'none')
    .map((m) => `${scope} .mkp-mark-${cssEscape(m.id)} { color: ${color(m.tone)}; fill: currentColor; }`)
    .join('\n');
  const notes = marks.filter((m) => m.note);
  return (
    <div {...(attrs ?? nodeAttrs(n))} style={style}>
      {rules ? <style>{rules}</style> : null}
      <MathSpan m={n.p as { tex: string }} display />
      {notes.length ? (
        <ul className="mkp-math-notes">
          {notes.map((m) => (
            <li key={m.id} data-mark={m.id} style={{ '--mkp-mark-tone': color(m.tone) ?? 'currentColor' } as CSSProperties}>
              {m.note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/** Children keyed by identity. Nothing animates: a change to the view is drawn as it is. */
export function Kids({ nodes }: { nodes: VNode[] | undefined }): ReactNode {
  return (nodes ?? []).map((n) => <Node key={n.key} n={n} />);
}

// ---------------------------------------------------------------------------------------------
// The containers: column, row, grid and stack (layers)

const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
const ITEMS: Record<string, string> = { start: 'start', center: 'center', end: 'end', stretch: 'stretch', baseline: 'baseline' };
const SELF: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
const WIDTH: Record<string, string | undefined> = { fit: 'fit-content', fill: '100%' };
const SIDES: Record<string, string[]> = { all: [], top: ['Top'], right: ['Right'], bottom: ['Bottom'], left: ['Left'], x: ['Left', 'Right'], y: ['Top', 'Bottom'] };
const WEIGHT: Record<string, number> = { thin: 1, normal: 2, thick: 4 };

/** The place a node's parent gives it: grow, basis, a grid span, and its own alignment (GAPS 41). */
export function layoutStyle(n: VNode): CSSProperties {
  const s: CSSProperties = {};
  const l = n.layout;
  // a growing child shares what is left, and its content (a canvas drawn to the width it is given) never widens it
  if (l?.grow) Object.assign(s, { flex: '1 1 0', minWidth: 0 });
  if (l?.basis) s.flexBasis = size(l.basis);
  if (l?.span) s.gridColumn = `span ${l.span}`;
  if (l?.self) s.alignSelf = SELF[l.self];
  return s;
}

/** A wash of a colour: --mkp-tint-<name> if the provider has one, else that colour thinned. */
const tint = (name: unknown): string | undefined =>
  name && name !== 'none' ? `var(--mkp-tint-${String(name)}, color-mix(in srgb, ${color(name)} 12%, var(--mkp-color-surface)))` : undefined;

/** A container's look: background, border on the sides `edge` names at its `weight` (GAPS 154), corners and shadow. */
export function boxStyle(p: Record<string, unknown>): CSSProperties {
  const s: CSSProperties = { background: tint(p.tint) ?? color(p.fill), borderRadius: radius(p.radius), boxShadow: shadow(p.shadow) };
  if (p.stroke && p.stroke !== 'none') {
    // a box's outline: --mkp-stroke-<name> if the provider sets one, else the colour (GAPS 4)
    const line = `${WEIGHT[String(p.weight)] ?? 1}px ${p.line === 'dashed' || p.line === 'dotted' ? p.line : 'solid'} var(--mkp-stroke-${String(p.stroke)}, ${color(p.stroke)})`;
    const sides = SIDES[String(p.edge ?? 'all')] ?? [];
    if (!sides.length) s.border = line;
    else for (const side of sides) (s as Record<string, string>)[`border${side}`] = line;
  }
  return s;
}

/** A grid's column tracks: auto, fit, Nfr (a share that may shrink below its content), Nch, or a size token (GAPS 98, 148, 159). */
export function gridTracks(cols: unknown): string {
  if (typeof cols === 'number') return `repeat(${Math.max(1, Math.round(cols))}, minmax(0, 1fr))`;
  const list = Array.isArray(cols) && cols.length ? cols.map(String) : ['1fr', '1fr'];
  return list
    .map((t) => {
      if (t === 'auto') return 'auto';
      if (t === 'fit') return 'fit-content(100%)';
      if (/^\d+(\.\d+)?fr$/.test(t)) return `minmax(0, ${t})`;
      if (/^\d+(\.\d+)?ch$/.test(t)) return t;
      return `var(--mkp-size-${t}, auto)`;
    })
    .join(' ');
}

/** How a container lays its children out, whatever its look. */
export function flowStyle(n: VNode): CSSProperties {
  const p = n.p;
  const gaps = { padding: space(p.pad), gap: space(p.gap) };
  switch (n.t) {
    case 'row':
      // centring is the stylesheet's, as safe centring: an overflowing row keeps its start (GAPS 120)
      return { display: 'flex', flexDirection: 'row', flexWrap: p.wrap === false ? 'nowrap' : 'wrap', alignItems: ALIGN[String(p.align)] ?? 'flex-start', justifyContent: p.justify === 'center' ? undefined : JUSTIFY[String(p.justify)], ...gaps };
    case 'grid':
      return { display: 'grid', gridTemplateColumns: gridTracks(p.cols), alignItems: ITEMS[String(p.align)] ?? 'stretch', justifyItems: ITEMS[String(p.justify)], ...gaps };
    case 'stack':
      // layers: every child in the one cell, the last on top; as big as the biggest (GAPS 79)
      return { display: 'grid', alignItems: ITEMS[String(p.align)] ?? 'stretch', justifyItems: ITEMS[String(p.justify)] ?? 'stretch', padding: space(p.pad) };
    default:
      return { display: 'flex', flexDirection: 'column', alignItems: ALIGN[String(p.align)] ?? 'stretch', justifyContent: p.justify === 'center' ? undefined : JUSTIFY[String(p.justify)], ...gaps };
  }
}

/** The attributes the stylesheet lays a container out by. */
function flowAttrs(n: VNode): Record<string, string | undefined> {
  return {
    'data-flow': n.t === 'column' ? 'column' : undefined,
    'data-justify': (n.t === 'row' || n.t === 'column') && n.p.justify === 'center' ? 'center' : undefined,
    'data-layers': n.t === 'stack' ? '' : undefined,
  };
}

/** A row's role: what the runtime gave it (a control, a choice), or a tablist when it holds tabs. */
export const rowRole = (n: VNode): string | undefined =>
  n.p.role === 'control' ? 'group' : ((n.p.role as string | undefined) ?? (n.kids?.some((k) => k.t === 'press' && k.p.kind === 'tab') ? 'tablist' : undefined));

/**
 * One container, laid out and drawn: column, row, grid or stack. `width` and `minwidth` size it
 * (GAPS 19, 142); with `scroll=x` its content scrolls sideways inside its outline (GAPS 149); a
 * press on its own background, not on a child, raises click (pointer only, GAPS 125).
 */
export function Box({ n, attrs, style, role, label, children }: { n: VNode; attrs?: Record<string, unknown>; style?: CSSProperties; role?: string; label?: string; children?: ReactNode }): ReactNode {
  const { rt } = useCtx();
  const p = n.p;
  const width = WIDTH[String(p.width)];
  const min = size(p.minwidth);
  const onClick = n.ev?.includes('click')
    ? (e: MouseEvent<HTMLElement>) => {
        const t = e.target as HTMLElement;
        if (t === e.currentTarget || (t.parentElement === e.currentTarget && t.hasAttribute('data-mkp-inner'))) rt.dispatch(n.key, 'click');
      }
    : undefined;
  const outer = { ...(attrs ?? nodeAttrs(n)), role: role ?? (p.role as string | undefined), 'aria-label': label ?? (p.label ? String(p.label) : undefined), onClick };
  if (p.scroll === 'x') {
    // the outline stays put and the content scrolls inside it, never narrower than minwidth
    const inner: CSSProperties = n.t === 'row' && p.wrap === false ? { width: 'max-content', minWidth: min ?? '100%' } : { minWidth: min ?? 'min-content' };
    return (
      <div {...outer} data-scroll="x" style={{ ...boxStyle(p), overflowX: 'auto', overflowY: 'hidden', maxWidth: '100%', width, ...style }}>
        <div data-mkp-inner="" {...flowAttrs(n)} style={{ ...flowStyle(n), ...inner }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div {...outer} {...flowAttrs(n)} style={{ ...flowStyle(n), ...boxStyle(p), width, maxWidth: width === 'fit-content' ? '100%' : undefined, minWidth: min, ...style }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function textStyle(n: VNode): CSSProperties {
  const font = String(n.p.font ?? 'body');
  const lines = Number(n.p.lines) || 0;
  return {
    color: color(n.p.tone),
    fontFamily: `var(--mkp-font-${font}), ${font === 'mono' ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`,
    fontWeight: n.p.weight === 'bold' ? 700 : n.p.weight === 'medium' ? 550 : undefined,
    fontSize: n.p.size === 'small' ? '0.875em' : n.p.size === 'large' ? '1.25em' : undefined,
    textAlign: (n.p.align as CSSProperties['textAlign']) ?? undefined,
    whiteSpace: n.p.wrap === false && !n.p.clip ? 'nowrap' : undefined,
    minHeight: lines ? `${lines}lh` : undefined,
    // a caption: spaced capitals
    ...(n.p.caps ? { textTransform: 'uppercase', letterSpacing: '0.06em' } : {}),
    // clipped at its lines (one with no lines=) with an ellipsis, by the stylesheet's [data-clip] (GAPS 151)
    ...(n.p.clip ? ({ '--mkp-lines': String(lines || 1) } as CSSProperties) : {}),
  };
}

/** A run of text, clipped to its lines with an ellipsis when it says so. */
export function TextBlock({ n, attrs, style }: { n: VNode; attrs?: Record<string, unknown>; style?: CSSProperties }): ReactNode {
  return (
    <div {...(attrs ?? nodeAttrs(n))} data-clip={n.p.clip ? '' : undefined} role={n.p.role as string | undefined} style={{ ...textStyle(n), ...style }}>
      <Runs runs={n.p.runs as VRun[]} />
    </div>
  );
}

/** A press's pointer enter and leave, and its focus and blur, for the ones it listens to. */
export function hoverEvents(n: VNode, dispatch: Runtime['dispatch']): Record<string, () => void> {
  const on: Record<string, () => void> = {};
  if (n.ev?.includes('enter')) on.onPointerEnter = on.onFocus = () => dispatch(n.key, 'enter');
  if (n.ev?.includes('leave')) on.onPointerLeave = on.onBlur = () => dispatch(n.key, 'leave');
  return on;
}

/** What goes on a node's outer element, so a provider's stylesheet, arrows and selectors find it. */
export function nodeAttrs(n: VNode): Record<string, unknown> {
  return {
    'data-mkp': n.t,
    'data-mkp-key': n.key,
    'data-mkp-id': n.id,
    'data-mkp-src': n.src ? `${n.src[0]}:${n.src[1]}:${n.src[2]}` : undefined,
    // a box faded back, or blurred until revealed
    'data-dim': n.p.dim ? '' : undefined,
    'data-blur': n.p.blur ? '' : undefined,
    // a control the runtime made for a state (steps, clock), so a bar can lay it out on a narrow screen
    'data-control': n.p.control as string | undefined,
    hidden: n.hidden || undefined,
  };
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, (c) => `\\${c}`);
}

/**
 * Scrolls the nearest ancestor that scrolls, never the page, so that `el` is in view (GAPS 150).
 * It moves only as far as it must, and keeps a little room either side.
 */
export function keepInView(el: HTMLElement, room = 8): void {
  for (let s = el.parentElement; s && s !== document.body && s !== document.documentElement; s = s.parentElement) {
    const cs = getComputedStyle(s);
    const down = /auto|scroll/.test(cs.overflowY) && s.scrollHeight > s.clientHeight;
    const across = /auto|scroll/.test(cs.overflowX) && s.scrollWidth > s.clientWidth;
    if (!down && !across) continue;
    const r = el.getBoundingClientRect();
    const b = s.getBoundingClientRect();
    const by = (lo: number, hi: number, from: number, to: number): number => (lo < from + room ? lo - from - room : hi > to - room ? Math.min(hi - to + room, lo - from - room) : 0);
    if (down) s.scrollTop = Math.max(0, s.scrollTop + by(r.top, r.bottom, b.top + s.clientTop, b.top + s.clientTop + s.clientHeight));
    if (across) s.scrollLeft = Math.max(0, s.scrollLeft + by(r.left, r.right, b.left + s.clientLeft, b.left + s.clientLeft + s.clientWidth));
    return;
  }
}

/** keep=true: whenever it becomes the kept one, it is scrolled into its pane's view. */
function useKeep(n: VNode): void {
  const on = !!n.layout?.keep;
  useLayoutEffect(() => {
    if (!on || typeof document === 'undefined') return;
    for (const el of document.querySelectorAll<HTMLElement>(`[data-mkp-key="${n.key.replace(/["\\]/g, '\\$&')}"]`)) keepInView(el);
  }, [on, n.key]);
}

const QUOTE_TONE: Record<string, string> = { note: 'info', tip: 'ok', important: 'accent', warning: 'warn', caution: 'bad' };

export function Node({ n }: { n: VNode }): ReactNode {
  const { rt, components } = useCtx();
  useKeep(n);
  const p = n.p;
  // data-mkp names the base widget, so a provider's stylesheet can say what it styles
  const common = nodeAttrs(n);
  const lay = layoutStyle(n);
  const route = (components as Record<string, HostRoute> | undefined)?.[n.t];
  if (route) return route({ n, attrs: common, style: lay, dispatch: rt.dispatch.bind(rt) });
  switch (n.t) {
    case 'scope':
      return <Scope n={n} />;
    case 'error':
      return (
        <div {...common} className="mkp-error" role="alert">
          <div>{String(p.summary || p.name)}</div>
          <small>{String(p.message)}</small>
        </div>
      );
    case 'bar':
      return (
        <div {...common} className="mkp-bar" role="toolbar" aria-label="controls">
          <Kids nodes={n.kids} />
        </div>
      );
    case 'column':
    case 'grid':
    case 'stack':
      return (
        <Box n={n} attrs={common} style={lay}>
          <Kids nodes={n.kids} />
        </Box>
      );
    case 'row':
      return (
        <Box n={n} attrs={common} style={lay} role={rowRole(n)}>
          <Kids nodes={n.kids} />
        </Box>
      );
    case 'text':
      return <TextBlock n={n} attrs={common} style={lay} />;
    case 'image':
      return <img {...common} src={String(p.src)} alt={String(p.alt)} style={{ maxWidth: p.size && p.size !== 'none' ? size(p.size) : '100%', ...lay }} />;
    case 'press': {
      const kind = String(p.kind ?? 'button');
      const aria: Record<string, unknown> = {};
      if (kind === 'tab') Object.assign(aria, { role: 'tab', 'aria-selected': !!p.selected });
      else if (kind === 'option' || kind === 'radio') Object.assign(aria, { role: 'radio', 'aria-checked': !!p.selected });
      else if (kind === 'check' || kind === 'switch') Object.assign(aria, { role: kind === 'check' ? 'checkbox' : 'switch', 'aria-checked': !!p.selected });
      else if (kind === 'toggle' || kind === 'plain') aria['aria-pressed'] = !!p.selected;
      if (p.label) aria['aria-label'] = String(p.label);
      return (
        <button
          {...common}
          {...aria}
          {...hoverEvents(n, rt.dispatch.bind(rt))}
          data-kind={kind}
          data-emphasis={p.emphasis && p.emphasis !== 'normal' ? String(p.emphasis) : undefined}
          type="button"
          disabled={!!p.disabled}
          className={kind === 'tab' ? 'mkp-press mkp-tab' : 'mkp-press'}
          style={{ color: color(p.tone), ...lay }}
          onClick={() => rt.dispatch(n.key, 'click')}
        >
          <Kids nodes={n.kids} />
        </button>
      );
    }
    case 'range':
      return (
        <input
          {...common}
          className="mkp-range"
          type="range"
          min={Number(p.min ?? 0)}
          max={Number(p.max ?? 1)}
          step={Number(p.step) > 0 ? Number(p.step) : 'any'}
          value={Number(p.value)}
          aria-label={String(p.label || 'value')}
          aria-valuetext={String(Number(Number(p.value).toPrecision(4)))}
          onChange={(e) => rt.dispatch(n.key, 'change', { value: Number(e.currentTarget.value) })}
          // how far along the track the value is, for providers that paint the filled part
          style={{ ...lay, '--mkp-range-fill': `${Number(p.max) > Number(p.min) ? ((Number(p.value) - Number(p.min)) / (Number(p.max) - Number(p.min))) * 100 : 0}%` } as CSSProperties}
        />
      );
    case 'meter': {
      const max = Number(p.max) > 0 ? Number(p.max) : 1;
      return (
        <div {...common} className="mkp-meter" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Number(p.value)} aria-label={String(p.label || 'progress')} style={{ width: size(p.size ?? 'fill'), ...lay }}>
          <div style={{ width: `${Math.max(0, Math.min(1, Number(p.value) / max)) * 100}%`, background: color(p.tone ?? 'accent') }} />
        </div>
      );
    }
    case 'field':
      return <Field n={n} />;
    case 'overlay':
      return <Overlay n={n} />;
    case 'canvas':
      return <Canvas n={n} />;
    case 'paragraph':
      return (
        <p {...common}>
          <Runs runs={p.runs as VRun[]} />
        </p>
      );
    case 'heading': {
      const H = `h${Math.min(6, Math.max(1, Number(p.level) || 2))}` as 'h2';
      return (
        <H {...common} id={(p.anchor as string) ?? undefined}>
          <Runs runs={p.runs as VRun[]} />
        </H>
      );
    }
    case 'divider':
      return <hr {...common} />;
    case 'code': {
      const marks = (p.marks as CodeMark[] | undefined) ?? [];
      const pick = p.pickable && n.ev?.includes('pick') ? (line: number) => rt.dispatch(n.key, 'pick', { line }) : undefined;
      return (
        <pre {...common} style={lay}>
          <code data-lang={String(p.lang || '') || undefined}>{p.line || marks.length || pick ? <CodeLines src={String(p.src)} line={Number(p.line) || 0} marks={marks} pick={pick} /> : String(p.src)}</code>
        </pre>
      );
    }
    case 'math':
      return <MathBlock n={n} attrs={common} style={lay} />;
    case 'quote': {
      const alert = String(p.alert ?? 'none');
      const tone = QUOTE_TONE[alert];
      return (
        <blockquote {...common} style={tone ? ({ '--mkp-quote': `var(--mkp-color-${tone})` } as CSSProperties) : undefined} role={tone ? 'note' : undefined}>
          {tone ? <strong style={{ color: color(tone), display: 'block', textTransform: 'capitalize' }}>{alert}</strong> : null}
          <Kids nodes={n.kids} />
        </blockquote>
      );
    }
    case 'list': {
      const L = p.ordered ? 'ol' : 'ul';
      // the markers are set here, not left to the browser's defaults, so a reset can't take them (GAPS 3)
      return (
        <L {...common} start={p.ordered ? Number(p.start) : undefined} style={{ listStyleType: p.ordered ? 'decimal' : 'disc', paddingLeft: '1.5em' }}>
          {(n.kids ?? []).map((it) => (
            <li key={it.key} style={{ display: 'list-item', ...(it.p.checked !== 'none' ? { listStyleType: 'none' } : {}) }}>
              {it.p.checked !== 'none' ? <input type="checkbox" checked={it.p.checked === 'yes'} disabled readOnly style={{ marginRight: 6, display: 'inline-block' }} /> : null}
              <Kids nodes={it.kids} />
            </li>
          ))}
        </L>
      );
    }
    case 'table': {
      const align = (p.align as string[]) ?? [];
      const al = (i: number): CSSProperties => (align[i] && align[i] !== 'none' ? { textAlign: align[i] as CSSProperties['textAlign'] } : {});
      return (
        <table {...common}>
          <thead>
            <tr>
              {(p.head as VRun[][]).map((c, i) => (
                <th key={i} style={al(i)}>
                  <Runs runs={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(p.rows as VRun[][][]).map((r, j) => (
              <tr key={j}>
                {r.map((c, i) => (
                  <td key={i} style={al(i)}>
                    <Runs runs={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'footnote':
      return (
        <div {...common} id={`fn-${String(p.label)}`} style={{ fontSize: '0.875em' }}>
          <sup style={SUP}>{String(p.n ?? p.label)}</sup> <Kids nodes={n.kids} />
        </div>
      );
    case 'frame':
      return <Frame n={n} attrs={common} style={lay} />;
    case 'pane':
      return <Pane n={n} attrs={common} style={lay} />;
    case 'zoom':
      return <Zoom n={n} attrs={common} style={lay} />;
    case 'icon':
      return <Icon n={n} attrs={common} style={lay} />;
    default:
      // a transitional extern this renderer does not implement: say so, accessibly
      return (
        <div {...common} className="mkp-error" role="note">
          {String(p.summary ?? n.t)}
        </div>
      );
  }
}

/** A mark on a code line (code@1 marks): a tone for the line or for columns from to to, and a note. */
export interface CodeMark {
  line: number;
  tone?: string;
  note?: string;
  from?: number;
  to?: number;
}

/** A numbered listing; with `pick`, each line is pressed with the pointer or Enter/Space (GAPS 68, 96). */
export function CodeLines({ src, line, marks, pick }: { src: string; line: number; marks: CodeMark[]; pick?: (line: number) => void }): ReactNode {
  return src.split('\n').map((text, i) => {
    const m = marks.find((x) => x.line === i + 1);
    const tone = m?.tone && m.tone !== 'none' ? m.tone : undefined;
    const part = tone && m!.from ? [m!.from - 1, m!.to || text.length] : null;
    const press = pick
      ? {
          role: 'button',
          tabIndex: 0,
          'data-pick': '',
          'aria-label': `line ${i + 1}`,
          onClick: () => pick(i + 1),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            pick(i + 1);
          },
        }
      : {};
    return (
      <span key={i} className="mkp-code-line" {...press} data-tone={tone && !part ? tone : undefined} aria-current={i + 1 === line ? 'step' : undefined} style={tone && !part ? { background: `color-mix(in srgb, var(--mkp-color-${tone}) 12%, transparent)` } : undefined}>
        {part ? (
          <>
            {text.slice(0, part[0])}
            <mark style={{ background: `color-mix(in srgb, var(--mkp-color-${tone}) 22%, transparent)`, color: 'inherit' }}>{text.slice(part[0], part[1])}</mark>
            {text.slice(part[1])}
          </>
        ) : (
          text || ' '
        )}
        {m?.note ? <span className="mkp-code-note">{m.note}</span> : null}
      </span>
    );
  });
}

/** A field marked right or wrong (GAPS 86): its outline in the tone, and invalid when wrong. */
export function fieldTone(p: Record<string, unknown>): { attrs: Record<string, unknown>; style: CSSProperties } {
  const tone = p.tone && p.tone !== 'none' ? String(p.tone) : undefined;
  return { attrs: { 'data-tone': tone, 'aria-invalid': tone === 'bad' || undefined }, style: tone ? { borderColor: color(tone) } : {} };
}

/** Keys for a field: one line submits on Enter; several (GAPS 80) on Ctrl/Cmd+Enter, Enter being a new line. */
export function fieldKeys(n: VNode, dispatch: Runtime['dispatch']): (e: { key: string; ctrlKey: boolean; metaKey: boolean; currentTarget: { value: string }; preventDefault(): void }) => void {
  const multi = Number(n.p.lines) > 1;
  return (e) => {
    if (e.key !== 'Enter' || (multi && !e.ctrlKey && !e.metaKey)) return;
    if (multi) e.preventDefault();
    dispatch(n.key, 'submit', { value: e.currentTarget.value });
  };
}

function Field({ n }: { n: VNode }): ReactNode {
  const { rt } = useCtx();
  const p = n.p;
  const lines = Number(p.lines) || 1;
  const tone = fieldTone(p);
  const props = {
    ...nodeAttrs(n),
    ...tone.attrs,
    className: 'mkp-field',
    value: String(p.value ?? ''),
    placeholder: String(p.placeholder ?? ''),
    'aria-label': String(p.label || p.placeholder || 'entry'),
    style: { width: p.width && p.width !== 'none' ? size(p.width) : undefined, ...tone.style, ...layoutStyle(n) },
    onChange: (e: { currentTarget: { value: string } }) => rt.dispatch(n.key, 'change', { value: e.currentTarget.value }),
    onKeyDown: fieldKeys(n, rt.dispatch.bind(rt)),
  };
  if (lines > 1) return <textarea {...props} rows={lines} />;
  return <input {...props} type="text" inputMode={p.kind === 'number' ? 'decimal' : undefined} />;
}

function Overlay({ n }: { n: VNode }): ReactNode {
  const { rt } = useCtx();
  const p = n.p;
  const mode = String(p.mode ?? 'popover');
  const open = !!p.open;
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    rt.dispatch(n.key, 'close');
    anchor.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    const focusables = (): HTMLElement[] => (el ? [...el.querySelectorAll<HTMLElement>('button, input, textarea, a[href], [tabindex]:not([tabindex="-1"])')] : []);
    if (mode === 'dialog') (focusables()[0] ?? el)?.focus();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab' && mode === 'dialog') {
        // focus trap
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const body = open ? (
    mode === 'dialog' ? (
      <div className="mkp-dialog" onClick={(e) => e.target === e.currentTarget && close()}>
        <div ref={panel} role="dialog" aria-modal="true" aria-label={String(p.label || 'dialog')} tabIndex={-1}>
          <Kids nodes={n.body} />
        </div>
      </div>
    ) : (
      <div ref={panel} className="mkp-popover" role={mode === 'tooltip' ? 'tooltip' : 'dialog'} aria-label={String(p.label || '')}>
        <Kids nodes={n.body} />
      </div>
    )
  ) : null;
  const hover = mode === 'tooltip' ? { onMouseEnter: () => rt.dispatch(n.key, 'open'), onMouseLeave: () => rt.dispatch(n.key, 'close'), onFocus: () => rt.dispatch(n.key, 'open'), onBlur: () => rt.dispatch(n.key, 'close') } : {};
  return (
    <span data-mkp="overlay" data-mode={mode} data-mkp-key={n.key} data-mkp-id={n.id} hidden={n.hidden || undefined} style={{ position: 'relative', display: 'inline-block', ...layoutStyle(n) }}>
      <button ref={anchor} type="button" className="mkp-press mkp-overlay-anchor" data-mode={mode} aria-expanded={open} aria-haspopup={mode === 'tooltip' ? undefined : 'dialog'} aria-label={p.label ? String(p.label) : undefined} onClick={() => rt.dispatch(n.key, open ? 'close' : 'open')} {...hover}>
        <Kids nodes={n.kids} />
      </button>
      {body}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Scopes: a definition instance, with its arrows drawn over (or under) it

function Scope({ n }: { n: VNode }): ReactNode {
  const box = useRef<HTMLDivElement | null>(null);
  const measure = useRef<() => void>(() => undefined);
  // here, not in Arrows: a parent's ref is only attached once its children's layout effects have run
  useLayoutEffect(() => measure.current());
  const label = n.p.summary ? String(n.p.summary) : undefined;
  return (
    <div
      ref={box}
      data-mkp-key={n.key}
      data-mkp-id={n.id}
      data-mkp-def={String(n.p.def)}
      // arrows behind the content sit under it, and over the scope's own background (GAPS 100)
      data-mkp-behind={n.arrows?.some((a) => a.layer === 'behind') ? '' : undefined}
      hidden={n.hidden || undefined}
      className="mkp-scope"
      role={label ? 'group' : undefined}
      aria-label={label}
      id={(n.p.anchor as string) ?? undefined}
      style={layoutStyle(n)}
    >
      <Kids nodes={n.kids} />
      {n.arrows?.length ? <Arrows arrows={n.arrows} box={box} measure={measure} /> : null}
    </div>
  );
}
