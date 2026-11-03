// The base set as React DOM components (spec 8): layout, text, media, press, range, field,
// overlay, canvas, Markdown blocks, the control bar, scopes with arrows, and the error boundary.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { arrowPath, type Runtime, type VArrow, type VNode, type VRun } from '@mkp/core';
import { color, radius, shadow, size, space } from './style';
import { Canvas } from './canvas';

export interface Ctx {
  rt: Runtime;
  reducedMotion: boolean;
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
// Keyed children with enter, move (FLIP) and leave animation (6.11)

interface Leaving {
  node: VNode;
  index: number;
  until: number;
}

export function Kids({ nodes }: { nodes: VNode[] | undefined }): ReactNode {
  const { reducedMotion } = useCtx();
  const list = nodes ?? [];
  const els = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const prevKeys = useRef<Set<string> | null>(null);
  const prevNodes = useRef<VNode[]>([]);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const curKeys = new Set(list.map((n) => n.key));
  const mounted = prevKeys.current !== null;

  // removed children linger briefly so they can fade out
  useLayoutEffect(() => {
    if (reducedMotion || !prevKeys.current) return;
    const gone = prevNodes.current.map((n, i) => ({ n, i })).filter(({ n }) => !curKeys.has(n.key));
    if (gone.length) {
      const until = Date.now() + 200;
      setLeaving((l) => [...l.filter((x) => !curKeys.has(x.node.key)), ...gone.map(({ n, i }) => ({ node: n, index: i, until }))]);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setLeaving((l) => l.filter((x) => x.until > Date.now()));
      }, 220);
    }
  });

  // FLIP: children that moved glide from their old place
  useLayoutEffect(() => {
    if (!reducedMotion) {
      for (const [k, el] of els.current) {
        const before = rects.current.get(k);
        if (!before || !el.isConnected) continue;
        const after = relRect(el);
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.style.transition = 'none';
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = 'transform var(--mkp-motion-settle, 300ms) ease';
            el.style.transform = '';
          });
        }
      }
    }
    const next = new Map<string, DOMRect>();
    for (const [k, el] of els.current) if (el.isConnected) next.set(k, relRect(el));
    rects.current = next;
    prevKeys.current = curKeys;
    prevNodes.current = list;
  });

  const rendered: { n: VNode; leaving: boolean }[] = list.map((n) => ({ n, leaving: false }));
  for (const l of leaving) if (!curKeys.has(l.node.key)) rendered.splice(Math.min(l.index, rendered.length), 0, { n: l.node, leaving: true });
  return rendered.map(({ n, leaving: isLeaving }) => (
    <Slot key={n.key} n={n} entering={mounted && !prevKeys.current!.has(n.key) && !reducedMotion} leaving={isLeaving} reg={(el) => (el ? els.current.set(n.key, el) : els.current.delete(n.key))} />
  ));
}

/** A rectangle relative to the parent element (moves of the parent itself are not the child's). */
function relRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  const p = el.parentElement?.getBoundingClientRect();
  return p ? new DOMRect(r.left - p.left, r.top - p.top, r.width, r.height) : r;
}

function Slot({ n, entering, leaving, reg }: { n: VNode; entering: boolean; leaving: boolean; reg: (el: HTMLElement | null) => void }): ReactNode {
  return <Node n={n} cls={leaving ? 'mkp-leaving' : entering ? 'mkp-enter' : undefined} reg={reg} />;
}

// ---------------------------------------------------------------------------------------------

function layoutStyle(n: VNode): CSSProperties {
  const s: CSSProperties = {};
  if (n.layout?.grow) s.flex = '1 1 0';
  if (n.layout?.basis) s.flexBasis = size(n.layout.basis);
  if (n.layout?.span) s.gridColumn = `span ${n.layout.span}`;
  return s;
}

function boxStyle(p: Record<string, unknown>): CSSProperties {
  return {
    padding: space(p.pad),
    gap: space(p.gap),
    background: color(p.fill),
    border: p.stroke && p.stroke !== 'none' ? `1px solid ${color(p.stroke)}` : undefined,
    borderRadius: radius(p.radius),
    boxShadow: shadow(p.shadow),
  };
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
const QUOTE_TONE: Record<string, string> = { note: 'info', tip: 'ok', important: 'accent', warning: 'warn', caution: 'bad' };

export function Node({ n, cls, reg }: { n: VNode; cls?: string; reg?: (el: HTMLElement | null) => void }): ReactNode {
  const { rt } = useCtx();
  const p = n.p;
  const common = { 'data-mkp-key': n.key, 'data-mkp-id': n.id, 'data-mkp-src': n.src ? `${n.src[0]}:${n.src[1]}:${n.src[2]}` : undefined, hidden: n.hidden || undefined, className: cls, ref: reg } as const;
  const lay = layoutStyle(n);
  switch (n.t) {
    case 'scope':
      return <Scope n={n} cls={cls} reg={reg} />;
    case 'error':
      return (
        <div {...common} className={['mkp-error', cls].filter(Boolean).join(' ')} role="alert">
          <div>{String(p.summary || p.name)}</div>
          <small>{String(p.message)}</small>
        </div>
      );
    case 'bar':
      return (
        <div {...common} className={['mkp-bar', cls].filter(Boolean).join(' ')} role="toolbar" aria-label="controls">
          <Kids nodes={n.kids} />
        </div>
      );
    case 'stack':
      return (
        <div {...common} role={p.role as string | undefined} aria-label={p.label as string | undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: ALIGN[String(p.align)] ?? 'stretch', ...boxStyle(p), ...lay }}>
          <Kids nodes={n.kids} />
        </div>
      );
    case 'flex':
      return (
        <div {...common} role={p.role === 'control' ? 'group' : (p.role as string | undefined)} aria-label={p.label as string | undefined} style={{ display: 'flex', flexDirection: 'row', flexWrap: p.wrap === false ? 'nowrap' : 'wrap', alignItems: ALIGN[String(p.align)] ?? 'flex-start', justifyContent: JUSTIFY[String(p.justify)] ?? 'flex-start', ...boxStyle(p), ...lay }}>
          <Kids nodes={n.kids} />
        </div>
      );
    case 'grid':
      return (
        <div {...common} style={{ display: 'grid', gridTemplateColumns: `repeat(${Number(p.cols) || 2}, minmax(0, 1fr))`, alignItems: ALIGN[String(p.align)] ?? 'stretch', ...boxStyle(p), ...lay }}>
          <Kids nodes={n.kids} />
        </div>
      );
    case 'text': {
      const font = String(p.font ?? 'body');
      const st: CSSProperties = {
        color: color(p.tone),
        fontFamily: `var(--mkp-font-${font}), ${font === 'mono' ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`,
        fontWeight: p.weight === 'bold' ? 700 : p.weight === 'medium' ? 550 : undefined,
        fontSize: p.size === 'small' ? '0.875em' : p.size === 'large' ? '1.25em' : undefined,
        textAlign: (p.align as CSSProperties['textAlign']) ?? undefined,
        whiteSpace: p.wrap === false ? 'nowrap' : undefined,
        ...lay,
      };
      return (
        <div {...common} style={st}>
          <Runs runs={p.runs as VRun[]} />
        </div>
      );
    }
    case 'image':
      return <img {...common} src={String(p.src)} alt={String(p.alt)} style={{ maxWidth: p.size && p.size !== 'none' ? size(p.size) : '100%', ...lay }} />;
    case 'press': {
      const kind = String(p.kind ?? 'button');
      const aria: Record<string, unknown> = {};
      if (kind === 'tab') Object.assign(aria, { role: 'tab', 'aria-selected': !!p.selected });
      else if (kind === 'option') Object.assign(aria, { role: 'radio', 'aria-checked': !!p.selected });
      else if (kind === 'toggle') aria['aria-pressed'] = !!p.selected;
      if (p.label) aria['aria-label'] = String(p.label);
      return (
        <button {...common} {...aria} type="button" disabled={!!p.disabled} className={['mkp-press', kind === 'tab' ? 'mkp-tab' : '', cls].filter(Boolean).join(' ')} style={{ color: color(p.tone), ...lay }} onClick={() => rt.dispatch(n.key, 'click')}>
          <Kids nodes={n.kids} />
        </button>
      );
    }
    case 'range':
      return (
        <input
          {...common}
          className={['mkp-range', cls].filter(Boolean).join(' ')}
          type="range"
          min={Number(p.min)}
          max={Number(p.max)}
          step={Number(p.step) > 0 ? Number(p.step) : 'any'}
          value={Number(p.value)}
          aria-label={String(p.label || 'value')}
          aria-valuetext={String(Number(Number(p.value).toPrecision(4)))}
          onChange={(e) => rt.dispatch(n.key, 'change', { value: Number(e.currentTarget.value) })}
          style={lay}
        />
      );
    case 'field':
      return <Field n={n} cls={cls} reg={reg} />;
    case 'overlay':
      return <Overlay n={n} cls={cls} reg={reg} />;
    case 'canvas':
      return <Canvas n={n} cls={cls} reg={reg} />;
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
        <pre {...common}>
          <code data-lang={String(p.lang || '') || undefined}>{String(p.src)}</code>
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
    default:
      // a transitional extern this renderer does not implement: say so, accessibly
      return (
        <div {...common} className="mkp-error" role="note">
          {String(p.summary ?? n.t)}
        </div>
      );
  }
}

function Field({ n, cls, reg }: { n: VNode; cls?: string; reg?: (el: HTMLElement | null) => void }): ReactNode {
  const { rt } = useCtx();
  const p = n.p;
  return (
    <input
      ref={reg}
      data-mkp-key={n.key}
      data-mkp-id={n.id}
      hidden={n.hidden || undefined}
      className={['mkp-field', cls].filter(Boolean).join(' ')}
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

function Overlay({ n, cls, reg }: { n: VNode; cls?: string; reg?: (el: HTMLElement | null) => void }): ReactNode {
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
    <span ref={reg} data-mkp-key={n.key} data-mkp-id={n.id} hidden={n.hidden || undefined} className={cls} style={{ position: 'relative', display: 'inline-block', ...layoutStyle(n) }}>
      <button ref={anchor} type="button" className="mkp-press" aria-expanded={open} aria-haspopup={mode === 'tooltip' ? undefined : 'dialog'} aria-label={p.label ? String(p.label) : undefined} onClick={() => rt.dispatch(n.key, open ? 'close' : 'open')} {...hover}>
        <Kids nodes={n.kids} />
      </button>
      {body}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Scopes: a definition instance, with its arrows drawn over it

function Scope({ n, cls, reg }: { n: VNode; cls?: string; reg?: (el: HTMLElement | null) => void }): ReactNode {
  const box = useRef<HTMLDivElement | null>(null);
  const label = n.p.summary ? String(n.p.summary) : undefined;
  return (
    <div
      ref={(el) => {
        box.current = el;
        reg?.(el);
      }}
      data-mkp-key={n.key}
      data-mkp-id={n.id}
      data-mkp-def={String(n.p.def)}
      hidden={n.hidden || undefined}
      className={['mkp-scope', cls].filter(Boolean).join(' ')}
      role={label ? 'group' : undefined}
      aria-label={label}
      id={(n.p.anchor as string) ?? undefined}
      style={layoutStyle(n)}
    >
      <Kids nodes={n.kids} />
      {n.arrows?.length ? <Arrows arrows={n.arrows} box={box} /> : null}
    </div>
  );
}

/** Measures the arrow ends after layout and redraws while anything moves (6.10). */
function Arrows({ arrows, box }: { arrows: VArrow[]; box: { current: HTMLDivElement | null } }): ReactNode {
  const [paths, setPaths] = useState<{ key: string; d: string; head: string; label?: [number, number]; runs?: VRun[] }[]>([]);
  const sig = useMemo(() => arrows.map((a) => `${a.key}|${a.from}|${a.to}|${a.curve ? 1 : 0}`).join(';'), [arrows]);
  const measure = useRef<() => void>(() => undefined);
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
    for (const a of arrows) {
      const ra = find(a.from);
      const rb = find(a.to);
      if (!ra || !rb) continue;
      const p = arrowPath({ x: ra.left - base.left, y: ra.top - base.top, w: ra.width, h: ra.height }, { x: rb.left - base.left, y: rb.top - base.top, w: rb.width, h: rb.height }, a.curve);
      if (p) out.push({ key: a.key, d: p.d, head: p.head.map((q) => q.join(',')).join(' '), label: a.label ? p.label : undefined, runs: a.label });
    }
    setPaths((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
    // measuring cost, for performance probes (spike 2): passes, total and worst time, arrows drawn
    const stats = ((globalThis as { __mkpArrowStats?: { passes: number; total: number; max: number; arrows: number } }).__mkpArrowStats ??= { passes: 0, total: 0, max: 0, arrows: 0 });
    const dt = performance.now() - t0;
    stats.passes++;
    stats.total += dt;
    stats.max = Math.max(stats.max, dt);
    stats.arrows = Math.max(stats.arrows, out.length);
  };
  useLayoutEffect(() => {
    measure.current();
    // follow keyed moves: redraw on frames for a little longer than the move animation
    let raf = 0;
    const until = performance.now() + 450;
    const loop = (): void => {
      measure.current();
      if (performance.now() < until) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
  useEffect(() => {
    const root = box.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure.current());
    ro.observe(root);
    for (const el of root.querySelectorAll('[data-mkp-key]')) ro.observe(el);
    return () => ro.disconnect();
  }, [sig, box]);
  return (
    <svg className="mkp-arrows" aria-hidden="true">
      {paths.map((p) => (
        <g key={p.key} data-mkp-arrow={p.key}>
          <path d={p.d} fill="none" stroke="var(--mkp-color-muted)" strokeWidth={1.5} />
          <polygon points={p.head} fill="var(--mkp-color-muted)" />
          {p.label && p.runs ? (
            <foreignObject x={p.label[0] - 60} y={p.label[1] - 12} width={120} height={24}>
              <div style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--mkp-color-muted)' }}>
                <Runs runs={p.runs} />
              </div>
            </foreignObject>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
