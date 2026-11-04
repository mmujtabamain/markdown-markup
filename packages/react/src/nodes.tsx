// The base set as React DOM components (spec 8): layout, text, media, press, range, field,
// overlay, canvas, Markdown blocks, the control bar, scopes with arrows, and the error boundary.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { arrowPaths, type ArrowEnds, type Runtime, type VArrow, type VNode, type VRun } from '@mkp/core';
import { color, radius, shadow, size, space } from './style';
import { Canvas } from './canvas';
import { Frame, Icon, Pane, Zoom } from './shell';

/** What a host's route gets: the node, what goes on its outer element, and how to report events. */
export interface HostProps {
  n: VNode;
  /** data-mkp-* and hidden: spread on the outer element, so arrows and selectors still find it */
  attrs: Record<string, unknown>;
  /** the place its parent gives it: grow, basis, span */
  style: CSSProperties;
  dispatch: Runtime['dispatch'];
}

/** The base set (core@1, spec 8): what every provider implements. */
export const BASE_WIDGETS = ['stack', 'flex', 'grid', 'text', 'image', 'press', 'range', 'meter', 'field', 'overlay', 'canvas', 'paragraph', 'heading', 'list', 'quote', 'code', 'math', 'divider', 'table', 'footnote', 'frame', 'pane', 'zoom', 'icon'] as const;
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
      return <img src={r.src} alt={r.alt} style={{ maxWidth: '100%' }} />;
    case 'fnref':
      return (
        <sup>
          <a href={`#fn-${r.label}`}>{r.label}</a>
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

// ---------------------------------------------------------------------------------------------

/** Children keyed by identity. Nothing animates: a change to the view is drawn as it is. */
export function Kids({ nodes }: { nodes: VNode[] | undefined }): ReactNode {
  return (nodes ?? []).map((n) => <Node key={n.key} n={n} />);
}

// ---------------------------------------------------------------------------------------------

const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };

export function layoutStyle(n: VNode): CSSProperties {
  const s: CSSProperties = {};
  if (n.layout?.grow) s.flex = '1 1 0';
  if (n.layout?.basis) s.flexBasis = size(n.layout.basis);
  if (n.layout?.span) s.gridColumn = `span ${n.layout.span}`;
  return s;
}

/** A wash of a colour: --mkp-tint-<name> if the provider has one, else that colour thinned. */
const tint = (name: unknown): string | undefined =>
  name && name !== 'none' ? `var(--mkp-tint-${String(name)}, color-mix(in srgb, ${color(name)} 12%, var(--mkp-color-surface)))` : undefined;

function boxStyle(p: Record<string, unknown>): CSSProperties {
  return {
    padding: space(p.pad),
    gap: space(p.gap),
    background: tint(p.tint) ?? color(p.fill),
    // a box's outline: --mkp-stroke-<name> if the provider sets one (lines lighter than text), else the colour
    border: p.stroke && p.stroke !== 'none' ? `1px solid var(--mkp-stroke-${String(p.stroke)}, ${color(p.stroke)})` : undefined,
    borderRadius: radius(p.radius),
    boxShadow: shadow(p.shadow),
  };
}

/** What goes on a node's outer element, so a provider's stylesheet, arrows and selectors find it. */
export function nodeAttrs(n: VNode): Record<string, unknown> {
  return {
    'data-mkp': n.t,
    'data-mkp-key': n.key,
    'data-mkp-id': n.id,
    'data-mkp-src': n.src ? `${n.src[0]}:${n.src[1]}:${n.src[2]}` : undefined,
    // a box faded back, or blurred until revealed (stack, flex, grid)
    'data-dim': n.p.dim ? '' : undefined,
    'data-blur': n.p.blur ? '' : undefined,
    hidden: n.hidden || undefined,
  };
}

export const flexRole = (n: VNode): string | undefined =>
  n.p.role === 'control' ? 'group' : ((n.p.role as string | undefined) ?? (n.kids?.some((k) => k.t === 'press' && k.p.kind === 'tab') ? 'tablist' : undefined));

export const stackStyle = (n: VNode): CSSProperties => ({ display: 'flex', flexDirection: 'column', alignItems: ALIGN[String(n.p.align)] ?? 'stretch', ...boxStyle(n.p) });

export const flexStyle = (n: VNode): CSSProperties => ({ display: 'flex', flexDirection: 'row', flexWrap: n.p.wrap === false ? 'nowrap' : 'wrap', alignItems: ALIGN[String(n.p.align)] ?? 'flex-start', justifyContent: JUSTIFY[String(n.p.justify)] ?? 'flex-start', ...boxStyle(n.p) });

export const gridStyle = (n: VNode): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${Number(n.p.cols) || 2}, minmax(0, 1fr))`, alignItems: ALIGN[String(n.p.align)] ?? 'stretch', ...boxStyle(n.p) });

export function textStyle(n: VNode): CSSProperties {
  const font = String(n.p.font ?? 'body');
  return {
    color: color(n.p.tone),
    fontFamily: `var(--mkp-font-${font}), ${font === 'mono' ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`,
    fontWeight: n.p.weight === 'bold' ? 700 : n.p.weight === 'medium' ? 550 : undefined,
    fontSize: n.p.size === 'small' ? '0.875em' : n.p.size === 'large' ? '1.25em' : undefined,
    textAlign: (n.p.align as CSSProperties['textAlign']) ?? undefined,
    whiteSpace: n.p.wrap === false ? 'nowrap' : undefined,
    minHeight: n.p.lines ? `${Number(n.p.lines)}lh` : undefined,
    // a caption: spaced capitals
    ...(n.p.caps ? { textTransform: 'uppercase', letterSpacing: '0.06em' } : {}),
  };
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

const QUOTE_TONE: Record<string, string> = { note: 'info', tip: 'ok', important: 'accent', warning: 'warn', caution: 'bad' };

export function Node({ n }: { n: VNode }): ReactNode {
  const { rt, components } = useCtx();
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
    case 'stack':
      return (
        <div {...common} role={p.role as string | undefined} aria-label={p.label as string | undefined} style={{ ...stackStyle(n), ...lay }}>
          <Kids nodes={n.kids} />
        </div>
      );
    case 'flex':
      return (
        <div {...common} role={flexRole(n)} aria-label={p.label as string | undefined} style={{ ...flexStyle(n), ...lay }}>
          <Kids nodes={n.kids} />
        </div>
      );
    case 'grid':
      return (
        <div {...common} style={{ ...gridStyle(n), ...lay }}>
          <Kids nodes={n.kids} />
        </div>
      );
    case 'text':
      return (
        <div {...common} role={p.role as string | undefined} style={{ ...textStyle(n), ...lay }}>
          <Runs runs={p.runs as VRun[]} />
        </div>
      );
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
        <button {...common} {...aria} data-kind={kind} data-emphasis={p.emphasis && p.emphasis !== 'normal' ? String(p.emphasis) : undefined} type="button" disabled={!!p.disabled} className={kind === 'tab' ? 'mkp-press mkp-tab' : 'mkp-press'} style={{ color: color(p.tone), ...lay }} onClick={() => rt.dispatch(n.key, 'click')}>
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
          min={Number(p.min)}
          max={Number(p.max)}
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
        <div {...common} className="mkp-meter" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Number(p.value)} aria-label={String(p.label || 'progress')} style={{ width: size(p.size), ...lay }}>
          <div style={{ width: `${Math.max(0, Math.min(1, Number(p.value) / max)) * 100}%`, background: color(p.tone) }} />
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
    case 'code':
      return (
        <pre {...common} style={lay}>
          <code data-lang={String(p.lang || '') || undefined}>
            {p.line || (p.marks as CodeMark[] | undefined)?.length ? <CodeLines src={String(p.src)} line={Number(p.line) || 0} marks={(p.marks as CodeMark[] | undefined) ?? []} /> : String(p.src)}
          </code>
        </pre>
      );
    case 'math':
      return (
        <div {...common}>
          <MathSpan m={p as { tex: string }} display />
        </div>
      );
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
      return (
        <L {...common} start={p.ordered ? Number(p.start) : undefined}>
          {(n.kids ?? []).map((it) => (
            <li key={it.key} style={it.p.checked !== 'none' ? { listStyle: 'none' } : undefined}>
              {it.p.checked !== 'none' ? <input type="checkbox" checked={it.p.checked === 'yes'} disabled readOnly style={{ marginRight: 6 }} /> : null}
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
          <sup>{String(p.label)}</sup> <Kids nodes={n.kids} />
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

function CodeLines({ src, line, marks }: { src: string; line: number; marks: CodeMark[] }): ReactNode {
  return src.split('\n').map((text, i) => {
    const m = marks.find((x) => x.line === i + 1);
    const tone = m?.tone && m.tone !== 'none' ? m.tone : undefined;
    const part = tone && m!.from ? [m!.from - 1, m!.to || text.length] : null;
    return (
      <span key={i} className="mkp-code-line" data-tone={tone && !part ? tone : undefined} aria-current={i + 1 === line ? 'step' : undefined} style={tone && !part ? { background: `color-mix(in srgb, var(--mkp-color-${tone}) 12%, transparent)` } : undefined}>
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

function Field({ n }: { n: VNode }): ReactNode {
  const { rt } = useCtx();
  const p = n.p;
  return (
    <input
      data-mkp-key={n.key}
      data-mkp-id={n.id}
      hidden={n.hidden || undefined}
      className="mkp-field"
      type="text"
      inputMode={p.kind === 'number' ? 'decimal' : undefined}
      value={String(p.value ?? '')}
      placeholder={String(p.placeholder ?? '')}
      aria-label={String(p.label || p.placeholder || 'entry')}
      style={{ width: p.width && p.width !== 'none' ? size(p.width) : undefined, ...layoutStyle(n) }}
      onChange={(e) => rt.dispatch(n.key, 'change', { value: e.currentTarget.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') rt.dispatch(n.key, 'submit', { value: e.currentTarget.value });
      }}
    />
  );
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
    const focusables = (): HTMLElement[] => (el ? [...el.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])')] : []);
    if (mode === 'dialog') (focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent): void => {
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
// Scopes: a definition instance, with its arrows drawn over it

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

/** Draws the arrows, measuring their ends after layout (run by Scope) and whenever a size changes (6.10). */
/** One arrow as drawn: its shaft, head and other marks, label and look. */
interface Drawn {
  key: string;
  d: string;
  head: string;
  marks?: { d: string; fill: 'solid' | 'none' | 'hollow' }[];
  label?: [number, number];
  align?: 'start' | 'end';
  runs?: VRun[];
  tone?: string;
  line?: string;
  dim?: boolean;
  bold?: boolean;
}
const DASH: Record<string, string | undefined> = { solid: undefined, dashed: '5 4', dotted: '2 3' };

function Arrows({ arrows, box, measure }: { arrows: VArrow[]; box: { current: HTMLDivElement | null }; measure: { current: () => void } }): ReactNode {
  const [paths, setPaths] = useState<Drawn[]>([]);
  const sig = useMemo(() => arrows.map((a) => `${a.key}|${a.from}|${a.to}|${a.curve ? 1 : 0}|${a.route ?? ''}|${a.head ?? ''}|${a.tail ?? ''}|${(a.via ?? []).join(',')}`).join(';'), [arrows]);
  measure.current = () => {
    const root = box.current;
    if (!root) return;
    const t0 = performance.now();
    const base = root.getBoundingClientRect();
    const find = (key: string): DOMRect | null => {
      const el = root.querySelector<HTMLElement>(`[data-mkp-key="${cssEscape(key)}"]`);
      if (!el || el.hidden || !el.offsetParent) return null;
      const r = el.getBoundingClientRect();
      return r;
    };
    const out: typeof paths = [];
    const rel = (r: DOMRect) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    const shown: VArrow[] = [];
    const ends: ArrowEnds[] = [];
    for (const a of arrows) {
      const ra = find(a.from);
      const rb = find(a.to);
      if (!ra || !rb) continue;
      // waypoints that are not shown (hidden, or not laid out) are passed by
      const via = (a.via ?? []).map(find).filter((r): r is DOMRect => !!r).map(rel);
      shown.push(a);
      ends.push({ from: a.from, to: a.to, a: rel(ra), b: rel(rb), via, curve: a.curve, route: a.route, head: a.head, tail: a.tail });
    }
    arrowPaths(ends, 3, 7, base.width).forEach((p, i) => {
      const a = shown[i];
      if (p) out.push({ key: a.key, d: p.d, head: p.head.map((q) => q.join(',')).join(' '), marks: p.marks, label: a.label ? p.label : undefined, align: p.align, runs: a.label, tone: a.tone, line: a.line, dim: a.dim, bold: a.bold });
    });
    setPaths((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
    // measuring cost, for performance probes (spike 2): passes, total and worst time, arrows drawn
    const stats = ((globalThis as { __mkpArrowStats?: { passes: number; total: number; max: number; arrows: number } }).__mkpArrowStats ??= { passes: 0, total: 0, max: 0, arrows: 0 });
    const dt = performance.now() - t0;
    stats.passes++;
    stats.total += dt;
    stats.max = Math.max(stats.max, dt);
    stats.arrows = Math.max(stats.arrows, out.length);
  };
  useEffect(() => {
    const root = box.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure.current());
    ro.observe(root);
    for (const el of root.querySelectorAll('[data-mkp-key]')) ro.observe(el);
    return () => ro.disconnect();
  }, [sig, box, measure]);
  return (
    <svg className="mkp-arrows" aria-hidden="true">
      {paths.map((p) => {
        // a provider may give lines their own colour: --mkp-arrow-<tone>, else the tone's
        const ink = `var(--mkp-arrow-${p.tone ?? 'muted'}, var(--mkp-color-${p.tone ?? 'muted'}))`;
        const width = p.bold ? 2 : 1.5;
        return (
        <g key={p.key} data-mkp-arrow={p.key} data-dim={p.dim ? '' : undefined} data-bold={p.bold ? '' : undefined} style={p.dim ? { opacity: 0.3 } : undefined}>
          <path d={p.d} fill="none" stroke={ink} strokeWidth={width} strokeDasharray={DASH[p.line ?? 'solid']} />
          {p.head ? <polygon points={p.head} fill={ink} /> : null}
          {(p.marks ?? []).map((m, i) => (
            <path key={i} d={m.d} stroke={ink} strokeWidth={width} fill={m.fill === 'solid' ? ink : m.fill === 'hollow' ? 'var(--mkp-color-surface)' : 'none'} strokeLinejoin="round" />
          ))}
          {p.label && p.runs ? (
            <foreignObject x={p.label[0] - (p.align === 'start' ? 0 : p.align === 'end' ? 120 : 60)} y={p.label[1] - 12} width={120} height={24}>
              <div className="mkp-arrow-label" style={{ textAlign: p.align ?? 'center', fontSize: '0.8em', color: p.tone ? ink : 'var(--mkp-color-muted)' }}>
                <span style={{ background: 'var(--mkp-color-surface)', padding: '0 3px' }}><Runs runs={p.runs} /></span>
              </div>
            </foreignObject>
          ) : null}
        </g>
        );
      })}
    </svg>
  );
}
