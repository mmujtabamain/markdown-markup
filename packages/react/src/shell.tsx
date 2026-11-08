// The shell base widgets (spec 8): frame, pane, zoom and icon. A provider may pass its own button
// (`Button`), so the frame's icon buttons and the zoom's lock are its own; everything else is here.

import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ICON_GLYPHS, type VNode, type VRun } from '@mkp/core';
import { color, layer, size } from './style';
import { Kids, Runs, type ExternProps, type MkpExterns } from './nodes';

/** Tells the arrows around an element that what it holds has moved without changing size. */
export function relayout(el: Element | null): void {
  el?.dispatchEvent(new Event('mkp-layout', { bubbles: true }));
}

/** A small button: a provider's own, or a plain one. */
export interface ShellButtonProps {
  label: string;
  onClick(): void;
  pressed?: boolean;
  children: ReactNode;
}
export type ShellButton = ComponentType<ShellButtonProps>;

const PlainButton: ShellButton = ({ label, onClick, pressed, children }) => (
  <button type="button" className="mkp-press mkp-shell-button" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
    {children}
  </button>
);

/** What a host's icon is given: the name a document chose (one of the fixed set), and how to draw it. */
export interface HostIconProps {
  name: string;
  size: 'small' | 'normal' | 'large';
  /** the tone the document asked for (a colour token's name: accent, ok…), or none for the text's own colour */
  tone: string;
  /** that tone as a CSS colour (a var() of the token), which the box's own color already is */
  color: string;
  /** what it says to a screen reader; the box carries it, so the icon itself needs no label */
  label?: string;
  /** a class for the icon's own element: it fills its box (1em, the box's colour) */
  className: string;
}
export type IconComponent = ComponentType<HostIconProps>;
/** A host's icons: one component for every name, or one per name (the rest stay MKP's). */
export type MkpIcons = IconComponent | Partial<Record<string, IconComponent>>;

/** The host's icon for `name`, if it has one. */
export function hostIcon(icons: MkpIcons | undefined, name: string): IconComponent | undefined {
  if (!icons) return undefined;
  // a function component, or memo()/forwardRef() (objects React knows by their $$typeof)
  if (typeof icons === 'function' || '$$typeof' in icons) return icons as IconComponent;
  return (icons as Partial<Record<string, IconComponent>>)[name];
}

/**
 * A host's icons as mount() and firstPaint() take them, with no React of their own: an SVG string
 * (the same markup in the first paint and once mounted), or a function that draws into the box once
 * it is in the page and returns how to clean up. One for every name, or one per name.
 */
export type DomIcon = string | ((box: HTMLElement, props: Omit<HostIconProps, 'className'>) => void | (() => void));
export type DomIcons = DomIcon | Partial<Record<string, DomIcon>>;

function DomIconBox({ draw, ...props }: HostIconProps & { draw: DomIcon }): ReactNode {
  const box = useRef<HTMLSpanElement>(null);
  const { className, name, size: sz, tone, color: c, label } = props;
  useLayoutEffect(() => {
    if (typeof draw !== 'function' || !box.current) return;
    const el = box.current;
    const done = draw(el, { name, size: sz, tone, color: c, label });
    return () => {
      if (typeof done === 'function') done();
      el.replaceChildren();
    };
  }, [draw, name, sz, tone, c, label]);
  // the host's markup is its own: MKP puts it in the box as given
  return typeof draw === 'string' ? <span ref={box} className={className} dangerouslySetInnerHTML={{ __html: draw }} /> : <span ref={box} className={className} />;
}

/** mount()'s and firstPaint()'s icons as the components <MkpDocument icons> takes. */
export function domIcons(icons: DomIcons | undefined): MkpIcons | undefined {
  if (icons === undefined) return undefined;
  const one = (draw: DomIcon): IconComponent => {
    const C = (p: HostIconProps): ReactNode => <DomIconBox {...p} draw={draw} />;
    return C;
  };
  if (typeof icons === 'string' || typeof icons === 'function') return one(icons);
  return Object.fromEntries(Object.entries(icons).flatMap(([k, v]) => (v === undefined ? [] : [[k, one(v)]])));
}

/** What a page's own code gets to draw a pack's extern with mount() (no React of its own). */
export interface DomExternProps {
  id: string;
  props: Record<string, unknown>;
  /** what the document put inside it (its first slot), drawn by MKP into this element: place it where it goes */
  slot: HTMLElement;
  /** its other slots (filled by name with :::fill), each drawn into its own element, by input name */
  slots: Record<string, HTMLElement>;
  /** each record's content, drawn into its own element, for its record lists with a slot:
   *  records.sections[i] goes with props.sections[i]. The same element stays with a record's place. */
  records: Record<string, HTMLElement[]>;
  /** the summary its use wrote, if any */
  summary?: string;
  /** reports one of the extern's outs to the document */
  dispatch: (event: string, payload?: unknown) => void;
}
/**
 * A page's own drawing of an extern: it draws into `box` once, and gets the new inputs through
 * `update` when they change (so its own state, an accordion's open sections, is kept); `destroy`
 * runs when it goes. A plain function returned is taken as `destroy`.
 */
export type DomExtern = (box: HTMLElement, props: DomExternProps) => void | (() => void) | { update?: (props: DomExternProps) => void; destroy?: () => void };
export type DomExterns = Record<string, DomExtern>;

function DomExternBox({ draw, id, props, children, slots, records, summary, attrs, style, dispatch }: ExternProps & { draw: DomExtern }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  // made on the page only (not in a first paint, so the paint and the page agree), for MKP to draw into;
  // kept by name, so a host that has placed one keeps it
  const [ready, setReady] = useState(false);
  const els = useRef(new Map<string, HTMLElement>());
  const el = (name: string): HTMLElement => {
    let e = els.current.get(name);
    if (!e) {
      e = document.createElement('div');
      e.className = 'mkp-extern-slot';
      els.current.set(name, e);
    }
    return e;
  };
  const live = useRef<{ update?: (p: DomExternProps) => void; destroy?: () => void } | null>(null);
  const latest = useRef({ props, slots, records, summary, dispatch });
  latest.current = { props, slots, records, summary, dispatch };
  const given = (): DomExternProps => ({
    id,
    props: latest.current.props,
    slot: el(''),
    slots: Object.fromEntries(Object.keys(latest.current.slots).map((k) => [k, el(`slot:${k}`)])),
    records: Object.fromEntries(Object.entries(latest.current.records).map(([k, list]) => [k, list.map((_, i) => el(`rec:${k}[${i}]`))])),
    summary: latest.current.summary,
    dispatch: (e, p) => latest.current.dispatch(e, p),
  });
  useLayoutEffect(() => {
    const host = box.current;
    if (!host) return;
    setReady(true);
    const out = draw(host, given());
    live.current = typeof out === 'function' ? { destroy: out } : out ?? null;
    return () => {
      live.current?.destroy?.();
      live.current = null;
      host.replaceChildren();
    };
  }, [draw, id]); // eslint-disable-line react-hooks/exhaustive-deps
  // the inputs, and how many records and which slots there are
  const shape = JSON.stringify([props, Object.keys(slots), Object.entries(records).map(([k, l]) => [k, l.length]), summary]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    live.current?.update?.(given());
  }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} {...attrs} style={style} data-mkp-extern={id}>
      {ready ? (
        <>
          {createPortal(children, el(''))}
          {Object.entries(slots).map(([k, s]) => createPortal(s, el(`slot:${k}`), `slot:${k}`))}
          {Object.entries(records).flatMap(([k, list]) => list.map((s, i) => createPortal(s, el(`rec:${k}[${i}]`), `rec:${k}[${i}]`)))}
        </>
      ) : null}
    </div>
  );
}

/** mount()'s and firstPaint()'s externs as the components <MkpDocument externs> takes. */
export function domExterns(externs: DomExterns | undefined): MkpExterns | undefined {
  if (!externs) return undefined;
  return Object.fromEntries(
    Object.entries(externs).map(([id, draw]) => {
      const C = (p: ExternProps): ReactNode => <DomExternBox {...p} draw={draw} />;
      return [id, C];
    }),
  );
}

/** A symbol: the host's (icons), or a text one. */
export function Icon({ n, attrs, style, icons }: { n: VNode; attrs?: Record<string, unknown>; style?: CSSProperties; icons?: MkpIcons }): ReactNode {
  const label = n.p.label ? String(n.p.label) : undefined;
  const name = String(n.p.name);
  const sz = (n.p.size ?? 'normal') as HostIconProps['size'];
  const tone = n.p.tone ? String(n.p.tone) : 'none';
  const Host = hostIcon(icons, name);
  return (
    <span
      {...attrs}
      className="mkp-icon"
      // the icon's name, so a host's stylesheet can swap in its own symbol or adjust one
      data-name={name}
      data-size={sz}
      data-tone={Host ? tone : undefined}
      data-host={Host ? '' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ color: color(n.p.tone), ...style }}
    >
      {Host ? <Host name={name} size={sz} tone={tone} color={color(n.p.tone) ?? 'currentColor'} label={label} className="mkp-icon-host" /> : (ICON_GLYPHS[name] ?? '•')}
    </span>
  );
}

/** A widget's shell: kind and title, the stage, the bar, and drawers over it. */
export function Frame({ n, attrs, style, Button = PlainButton }: { n: VNode; attrs?: Record<string, unknown>; style?: CSSProperties; Button?: ShellButton }): ReactNode {
  const [drawer, setDrawer] = useState<'about' | 'details' | null>(null);
  const [full, setFull] = useState(false);
  const slots = n.slots ?? {};
  const has = (k: string): boolean => (slots[k]?.length ?? 0) > 0;
  const height = n.p.height && n.p.height !== 'none' ? size(n.p.height) : undefined;
  const own = useRef<HTMLElement>(null);
  // its content moved: arrows drawn outside it measure again
  useEffect(() => relayout(own.current), [full]);
  useEffect(() => {
    if (!full && !drawer) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (drawer) setDrawer(null);
      else setFull(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [full, drawer]);
  return (
    // full screen, it is a layer of its own for the arrows inside it (GAPS 92); a stage that
    // scrolls is one too, so they scroll with it (GAPS 93)
    <section {...attrs} ref={own} className="mkp-frame" data-full={full || undefined} data-mkp-arrow-host={full ? '' : undefined} data-tone={n.p.tone && n.p.tone !== 'none' ? String(n.p.tone) : undefined} style={style}>
      <header className="mkp-frame-head">
        {n.p.kind ? <span className="mkp-frame-kind">{String(n.p.kind)}</span> : null}
        <span className="mkp-frame-title">
          <Runs runs={n.p.title as VRun[]} />
        </span>
        {has('actions') ? (
          <span className="mkp-frame-actions">
            <Kids nodes={slots.actions} />
          </span>
        ) : null}
        <span className="mkp-frame-tools">
          {has('about') ? (
            <Button label="About" pressed={drawer === 'about'} onClick={() => setDrawer(drawer === 'about' ? null : 'about')}>
              ⓘ
            </Button>
          ) : null}
          {has('details') ? (
            <Button label="Details" pressed={drawer === 'details'} onClick={() => setDrawer(drawer === 'details' ? null : 'details')}>
              ▤
            </Button>
          ) : null}
          <Button label={full ? 'Leave full screen' : 'Full screen'} onClick={() => setFull(!full)}>
            {full ? '⤡' : '⤢'}
          </Button>
        </span>
      </header>
      {/* its stage is always a layer for the arrows between what it holds: drawn in it, those behind
          sit over the frame's surface and under its content, rather than under the surface (GAPS 175) */}
      <div className="mkp-frame-stage" data-fixed={height ? '' : undefined} data-mkp-arrow-host="" style={height && !full ? { height } : undefined}>
        <Kids nodes={n.kids} />
      </div>
      {has('bar') ? (
        <div className="mkp-frame-bar" role="toolbar" aria-label="controls">
          <Kids nodes={slots.bar} />
        </div>
      ) : null}
      {drawer ? (
        <aside className="mkp-frame-drawer" role="dialog" aria-label={drawer === 'about' ? 'About' : 'Details'}>
          <header className="mkp-frame-head">
            <span className="mkp-frame-title">{drawer === 'about' ? 'About' : 'Details'}</span>
            <span className="mkp-frame-tools">
              <Button label="Close" onClick={() => setDrawer(null)}>
                ✕
              </Button>
            </span>
          </header>
          <div className="mkp-frame-drawer-body">
            <Kids nodes={slots[drawer]} />
          </div>
        </aside>
      ) : null}
    </section>
  );
}

/** A titled column whose body scrolls on its own. */
export function Pane({ n, attrs, style }: { n: VNode; attrs?: Record<string, unknown>; style?: CSSProperties }): ReactNode {
  const title = n.p.title as VRun[];
  const note = n.p.note as VRun[];
  return (
    <section {...attrs} className="mkp-pane" style={style}>
      {title.length || note.length ? (
        <header className="mkp-pane-head">
          <span className="mkp-pane-title">
            <Runs runs={title} />
          </span>
          {note.length ? (
            <span className="mkp-pane-note">
              <Runs runs={note} />
            </span>
          ) : null}
        </header>
      ) : null}
      {/* it scrolls on its own: arrows between what it holds are drawn in it (GAPS 143) */}
      <div className="mkp-pane-body" data-mkp-arrow-host="">
        <Kids nodes={n.kids} />
      </div>
      {n.slots?.footer?.length ? (
        <footer className="mkp-pane-foot">
          <Kids nodes={n.slots.footer} />
        </footer>
      ) : null}
    </section>
  );
}

const ZOOM_STEP = 1.25;
/** Elements a drag works on itself, so it doesn't pan. */
const OWN_DRAG = 'button, a, input, select, textarea, [role="slider"], .mkp-handle';

/**
 * Zoom and pan behind a lock. Locked (as it starts), a pinch or ctrl+wheel, a drag across it or a
 * double-click points at the lock for a second instead; unlocked, the wheel zooms about the pointer,
 * a drag pans, and + / − / reset sit beside the lock. With nothing to zoom or pan (what it holds fits
 * whole), it shows no lock and takes no gesture.
 */
/**
 * What it holds at its natural width, shrunk to fit when that is wider than the room it has (never
 * enlarged), and as tall as it then is. A drawing wider than its frame is seen whole at rest; a zoom
 * around it lets the reader look closer.
 */
export function FitBox({ children, on = true, gutter = 0, onWide, minScale = 0 }: { children?: ReactNode; on?: boolean; gutter?: number; onWide?: (wide: boolean) => void; minScale?: number }): ReactNode {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ s: number; h: number; dx: number } | null>(null);
  // never smaller than this (a zoom's minscale): what is still wider is clipped about its middle
  const floor = Math.min(1, Math.max(0, Number(minScale) || 0));
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!on || !o || !i) return;
    const go = (): void => {
      // its natural width: what it holds, not the room it is stretched to
      i.style.minWidth = '0';
      const want = i.offsetWidth;
      i.style.minWidth = '';
      // a gutter on the right, kept free for what sits over the view (a zoom's lock)
      const room = o.clientWidth - gutter;
      const s = room > 0 && want > room + 0.5 ? Math.max(floor, room / want) : 1;
      const h = Math.round(i.offsetHeight * s * 10) / 10;
      // at the floor and still wider than the room: its middle is what shows, and the zoom around it
      // (overflow hidden) does the clipping, so a pan brings the sides into view
      const dx = s * want > room + 0.5 ? Math.round(((room - s * want) / 2) * 10) / 10 : 0;
      // wider than the whole view, gutter or not: what a zoom shows its lock for
      if (o.clientWidth > 0) onWide?.(want > o.clientWidth + 0.5);
      setFit((f) => (f && f.s === s && f.h === h && f.dx === dx ? f : { s, h, dx }));
    };
    go();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(go);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [on, gutter, onWide, floor]);
  if (!on) return <>{children}</>;
  const shrunk = !!fit && fit.s < 1;
  return (
    <div ref={outer} className="mkp-fit" data-shrunk={shrunk || undefined} style={{ ...(gutter ? { paddingRight: gutter } : {}), ...(shrunk ? { height: fit.h } : {}), ...(fit?.dx ? { overflow: 'visible' } : {}) }}>
      <div ref={inner} className="mkp-fit-inner" data-clipped={fit?.dx ? '' : undefined} style={shrunk ? { transform: `${fit.dx ? `translateX(${fit.dx}px) ` : ''}scale(${fit.s})` } : undefined}>
        {children}
      </div>
    </div>
  );
}

/** A zoom's height: as tall as its content, never less than its minheight (none: room for its tools,
 *  the stylesheet's own) and never more than its maxheight. */
export function zoomBounds(n: VNode): CSSProperties {
  const lo = size(n.p.minheight);
  const hi = size(n.p.maxheight);
  return { ...(lo ? { minHeight: lo } : {}), ...(hi ? { maxHeight: hi } : {}) };
}

/** Whether a zoom holds one of these, at any depth. */
function holds(n: VNode, kinds: string[]): boolean {
  const any = (ns: VNode[] | undefined): boolean => (ns ?? []).some((k) => kinds.includes(k.t) || any(k.kids));
  return any(n.kids);
}

/** Whether a zoom has something to fit: a canvas is drawn to its width already, so it never needs it. */
export function fitsWidth(n: VNode): boolean {
  return n.p.fit !== false && !holds(n, ['canvas']);
}

export function Zoom({ n, attrs, style, Button = PlainButton }: { n: VNode; attrs?: Record<string, unknown>; style?: CSSProperties; Button?: ShellButton }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(true);
  const [nudged, setNudged] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const max = Number(n.p.max) > 1 ? Number(n.p.max) : 4;
  const refuse = (): void => {
    setNudged(true);
    window.setTimeout(() => setNudged(false), 1000);
  };
  const zoomAt = (by: number, px?: number, py?: number): void => {
    const el = box.current;
    if (!el) return;
    const cx = px ?? el.clientWidth / 2;
    const cy = py ?? el.clientHeight / 2;
    setView((v) => {
      const scale = Math.min(max, Math.max(1, v.scale * by));
      const k = scale / v.scale;
      return scale === 1 ? { scale, x: 0, y: 0 } : { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  // Its lock and tools show only when there is something to zoom or pan: what it holds was shrunk to
  // fit (or, not fitted, runs past its sides), is taller than it and clipped, or is a drawing or a
  // picture. Once unlocked or moved they stay, so they never vanish under the reader's hand.
  const content = useRef<HTMLDivElement>(null);
  const fit = fitsWidth(n);
  const [wide, setWide] = useState(false);
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    const c = content.current;
    if (!el || !c) return;
    const go = (): void => {
      if (!el.clientWidth) return;
      setTall(c.offsetHeight > el.clientHeight + 0.5);
      if (!fit) setWide(c.scrollWidth > el.clientWidth + 0.5);
    };
    go();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(go);
    ro.observe(el);
    ro.observe(c);
    return () => ro.disconnect();
  }, [fit]);
  const shifted = view.scale !== 1 || view.x !== 0 || view.y !== 0;
  // a drawing or a picture is always worth a closer look, whole or not
  const tools = wide || tall || holds(n, ['canvas', 'image']) || !locked || shifted;
  useEffect(() => {
    const el = box.current;
    if (!el || !tools) return;
    const wheel = (e: WheelEvent): void => {
      const pinch = e.ctrlKey || e.metaKey;
      if (locked) {
        if (pinch) {
          e.preventDefault();
          refuse();
        }
        return;
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(Math.exp(-e.deltaY * (pinch ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [locked, tools]);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!tools || e.button !== 0 || (e.target as Element).closest(OWN_DRAG)) return;
    const start = { x: e.clientX, y: e.clientY };
    const from = view;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      if (!moved) {
        moved = true;
        if (locked) {
          refuse();
          up();
          return;
        }
      }
      setView({ ...from, x: from.x + dx, y: from.y + dy });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => relayout(box.current), [view]);
  return (
    <div
      {...attrs}
      ref={box}
      className="mkp-zoom"
      data-locked={locked || undefined}
      data-nudged={nudged || undefined}
      data-tools={tools || undefined}
      style={{ ...zoomBounds(n), ...style }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if (!tools || (e.target as Element).closest(OWN_DRAG)) return;
        if (locked) return refuse();
        const r = e.currentTarget.getBoundingClientRect();
        zoomAt(ZOOM_STEP * ZOOM_STEP, e.clientX - r.left, e.clientY - r.top);
      }}
    >
      {/* the moving layer: arrows with both ends in it are drawn in it, and follow it (GAPS 126) */}
      <div ref={content} className="mkp-zoom-content" data-mkp-arrow-host="" style={shifted ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } : undefined}>
        <FitBox on={fit} gutter={tools ? 44 : 0} onWide={setWide} minScale={n.p.minscale === undefined ? 0.6 : Number(n.p.minscale)}>
          <Kids nodes={n.kids} />
        </FitBox>
      </div>
      {tools ? (
        <div className="mkp-zoom-tools">
          {!locked ? (
            <>
              <Button label="Zoom out" onClick={() => zoomAt(1 / ZOOM_STEP)}>
                −
              </Button>
              <Button label="Zoom in" onClick={() => zoomAt(ZOOM_STEP)}>
                +
              </Button>
              <Button label="Reset the view" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
                ↺
              </Button>
            </>
          ) : null}
          <Button label={locked ? 'Unlock to zoom and pan' : 'Lock the view'} pressed={!locked} onClick={() => setLocked(!locked)}>
            {locked ? '⚿' : '⚷'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The shell's layout, whoever draws its buttons. */
export const SHELL_CSS = layer(`
.mkp-frame { position: relative; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--mkp-color-line); border-radius: var(--mkp-radius-card); background: var(--mkp-color-surface); overflow: hidden; }
.mkp-frame[data-full] { position: fixed; inset: 12px; z-index: 900; }
.mkp-frame-head { display: flex; align-items: center; gap: var(--mkp-space-m); min-height: 40px; padding: var(--mkp-space-s) var(--mkp-space-s) var(--mkp-space-s) var(--mkp-space-l); border-bottom: 1px solid var(--mkp-color-line); }
.mkp-frame-kind { font-family: var(--mkp-font-mono), ui-monospace, monospace; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--mkp-color-muted); }
.mkp-frame-title { min-width: 0; flex: 1 1 auto; font-weight: 600; font-size: 0.95em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mkp-frame-actions, .mkp-frame-tools { display: flex; align-items: center; gap: var(--mkp-space-xs); flex: none; }
.mkp-frame-actions .mkp-choice-label { display: none; }
/* A press drawn as its own content (a card, a node): no button look, and its content keeps its own alignment. */
.mkp-plain { display: flex; flex-direction: column; align-items: stretch; padding: 0; border: 0; margin: 0; background: none; color: inherit; font: inherit; text-align: inherit; cursor: pointer; border-radius: var(--mkp-radius-card); }
.mkp-plain:disabled { cursor: default; }
.mkp-plain:focus-visible { outline: 2px solid var(--mkp-color-info); outline-offset: 2px; }
/* A bar's parts may shrink: a long status gives up width before the count and start over are pushed out. */
.mkp-frame-bar > *, [data-control=steps] > [role=status] { min-width: 0; }
/* A narrow bar puts the status under the steps' buttons, a line of its own, instead of squeezing the track. */
.mkp-frame-bar { container-type: inline-size; }
@container (max-width: 520px) {
  [data-control=steps] { flex-wrap: wrap !important; row-gap: var(--mkp-space-xs); }
  [data-control=steps] > [role=status] { order: 10; flex: 1 0 100% !important; }
  /* the track gives way first: it asks only its 3rem least, so the buttons and count keep one line */
  [data-control=steps] > [data-mkp=range] { flex: 1 1 3rem !important; width: auto !important; min-width: 3rem; }
  /* a frame's own status says all of itself on a phone; a playback's keeps to one line, so the bar
     doesn't jump while it plays */
  .mkp-frame-bar > [role=status] { white-space: normal !important; }
}
.mkp-choice-label:empty { display: none; }
.mkp-frame-stage { position: relative; min-height: 0; overflow: auto; }
.mkp-frame-stage[data-fixed] { resize: vertical; }
.mkp-frame[data-full] .mkp-frame-stage { flex: 1 1 auto; }
.mkp-frame-bar { display: flex; align-items: center; gap: var(--mkp-space-s) var(--mkp-space-m); min-height: 44px; padding: var(--mkp-space-s) var(--mkp-space-l); border-top: 1px solid var(--mkp-color-line); background: color-mix(in srgb, var(--mkp-color-muted) 6%, var(--mkp-color-surface)); }
.mkp-frame[data-tone] .mkp-frame-bar { background: var(--mkp-tint-bar, color-mix(in srgb, var(--mkp-frame-tone) 10%, var(--mkp-color-surface))); }
.mkp-frame[data-tone=ok] { --mkp-frame-tone: var(--mkp-color-ok); } .mkp-frame[data-tone=bad] { --mkp-frame-tone: var(--mkp-color-bad); } .mkp-frame[data-tone=info] { --mkp-frame-tone: var(--mkp-color-info); } .mkp-frame[data-tone=warn] { --mkp-frame-tone: var(--mkp-color-warn); }
.mkp-frame-bar [role=status] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
/* the bar wraps when its controls and a readable status don't fit on one line: the status takes the
   first line, the controls the next */
.mkp-frame-bar { flex-wrap: wrap; }
.mkp-frame-bar > [role=status] { flex: 1 1 14rem !important; }
.mkp-frame-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(360px, 92%); z-index: 5; display: flex; flex-direction: column; background: var(--mkp-color-surface); border-left: 1px solid var(--mkp-color-line); box-shadow: -8px 0 24px #0000001a; }
.mkp-frame-drawer-body { padding: var(--mkp-space-l); overflow: auto; }
.mkp-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1 1 0; }
.mkp-pane + .mkp-pane { border-left: 1px solid var(--mkp-color-line); }
.mkp-pane-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--mkp-space-m); padding: var(--mkp-space-m) var(--mkp-space-l); border-bottom: 1px solid var(--mkp-color-line); }
.mkp-pane-title { font-family: var(--mkp-font-mono), ui-monospace, monospace; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--mkp-color-muted); }
.mkp-pane-note { font-size: 0.8em; color: var(--mkp-color-muted); }
.mkp-pane-body { position: relative; min-height: 0; overflow: auto; flex: 1 1 auto; }
.mkp-pane-foot { padding: var(--mkp-space-s) var(--mkp-space-l); border-top: 1px solid var(--mkp-color-line); font-size: 0.85em; color: var(--mkp-color-muted); }
.mkp-zoom { position: relative; overflow: hidden; }
.mkp-zoom[data-tools] { min-height: calc(var(--mkp-space-s) * 2 + 40px); }
.mkp-zoom[data-nudged] { outline: 2px solid var(--mkp-color-accent); outline-offset: -2px; }
.mkp-zoom-content { position: relative; transform-origin: 0 0; }
/* its own width never comes from what it holds, so a wide drawing can't widen the column it sits in */
.mkp-fit { overflow: hidden; contain: inline-size; }
.mkp-fit-inner { width: max-content; min-width: 100%; transform-origin: 0 0; }
.mkp-zoom-tools { position: absolute; top: var(--mkp-space-s); right: var(--mkp-space-s); z-index: 2; display: flex; gap: 2px; padding: 2px; border-radius: var(--mkp-radius-card); background: color-mix(in srgb, var(--mkp-color-surface) 90%, transparent); border: 1px solid var(--mkp-color-line); }
.mkp-zoom[data-nudged] .mkp-zoom-tools { border-color: var(--mkp-color-accent); }
.mkp-icon { display: inline-flex; align-items: center; justify-content: center; line-height: 1; width: 1.1em; height: 1.1em; flex: none; }
.mkp-icon[data-size=small] { font-size: 0.8em; } .mkp-icon[data-size=large] { font-size: 1.4em; }
/* help is a question in a circle, as info is an i in one; the ring is drawn, since text has no circled ? */
/* a host's icon fills the box; the circled help is MKP's own drawing, not the host's */
.mkp-icon-host { display: inline-flex; width: 1em; height: 1em; }
.mkp-icon-host > svg { width: 100%; height: 100%; }
.mkp-icon[data-host][data-name=help] { width: 1.1em; height: 1.1em; border-radius: 0; box-shadow: none; font-size: inherit; }
.mkp-icon[data-name=help] { font-size: 0.78em; width: 1.4em; height: 1.4em; border-radius: 50%; box-shadow: inset 0 0 0 1.5px currentColor; font-weight: 700; }
.mkp-icon[data-name=help][data-size=small] { font-size: 0.62em; } .mkp-icon[data-name=help][data-size=large] { font-size: 1.1em; }
.mkp-shell-button { padding: 2px 6px; min-width: 26px; min-height: 26px; justify-content: center; }
.mkp-root [data-dim] { opacity: .4; }
.mkp-root [data-blur] { filter: blur(6px); pointer-events: none; user-select: none; }
`);
