// The preview: the live drawing with MKP's neutral kit (@mkp/shadcn on @mkp/react), at a chosen
// width, in light or dark, with reduced motion and gfx@1 on or off; and the signals log under it.

import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleX, Moon, Play, Sun } from 'lucide-react';
import { Runtime, type IRBundle, type MathsEngine, type SignalEvent } from '@mkp/core';
import { MkpDocument, widthClass } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { components } from '../kit';
import { drawnErrors, type DrawnError } from '../build';
import type { ConfCase, Entry } from '../catalog';
import { DiagList, type DiagItem } from './DiagList';

export type WidthPreset = 'phone' | 'tablet' | 'desktop';
export const WIDTHS: Record<WidthPreset, { px?: number; label: string }> = {
  phone: { px: 390, label: 'Phone 390' },
  tablet: { px: 768, label: 'Tablet 768' },
  desktop: { label: 'Desktop' },
};

export interface PreviewSettings {
  theme: 'light' | 'dark';
  reduced: boolean;
  gfx: boolean;
  width: WidthPreset;
}

export interface PreviewPaneProps {
  entry: Entry;
  /** the entry the bundle was built from (it lags the selection while a compile waits) */
  builtFor: string;
  bundle: IRBundle | null;
  maths: MathsEngine | null;
  diags: DiagItem[];
  onJump: (d: DiagItem) => void;
  settings: PreviewSettings;
  onSettings: (s: Partial<PreviewSettings>) => void;
  /** a conformance case's play steps and host values */
  conf?: ConfCase | null;
  onDrawn: (errors: DrawnError[]) => void;
  loading?: string;
}

class Boundary extends Component<{ children: ReactNode; reset: unknown }, { error: Error | null; reset: unknown }> {
  override state: { error: Error | null; reset: unknown } = { error: null, reset: undefined };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  static getDerivedStateFromProps(p: { reset: unknown }, s: { error: Error | null; reset: unknown }): { error: Error | null; reset: unknown } | null {
    return p.reset !== s.reset ? { error: null, reset: p.reset } : null;
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('the renderer stopped', error, info.componentStack);
  }
  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-pg-render-error="">
          <strong>The renderer stopped.</strong> <span className="font-mono text-xs">{this.state.error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Logged {
  n: number;
  at: string;
  e: SignalEvent;
}

function Stage({ bundle, maths, settings, conf, onDrawn, onSignal }: { bundle: IRBundle; maths: MathsEngine | null; settings: PreviewSettings; conf?: ConfCase | null; onDrawn: (e: DrawnError[]) => void; onSignal: (e: SignalEvent) => void }): ReactNode {
  const signal = useRef(onSignal);
  signal.current = onSignal;
  const runtime = useMemo(
    () =>
      new Runtime(bundle, {
        capabilities: settings.gfx ? ['core@1', 'gfx@1'] : ['core@1'],
        maths: maths ?? undefined,
        reducedMotion: settings.reduced,
        hosts: conf?.hosts ? { '0': conf.hosts as Record<string, unknown> } : undefined,
        onSignal: (e) => signal.current(e),
      }),
    [bundle, maths, settings.gfx, settings.reduced, conf],
  );
  useEffect(() => onDrawn(drawnErrors(runtime)), [runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  const play = async (): Promise<void> => {
    for (const s of conf?.steps ?? []) {
      if (s.press) runtime.press(s.press);
      if (s.set) runtime.set(s.set);
      if (s.open) runtime.open(s.open);
      if (s.command) runtime.widget(0).command(s.command, s.args);
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
    }
  };
  return (
    <>
      {conf?.steps.length ? (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" onClick={() => void play()}>
            <Play /> Play the case's {conf.steps.length === 1 ? 'step' : `${conf.steps.length} steps`}
          </Button>
        </div>
      ) : null}
      <MkpDocument bundle={bundle} runtime={runtime} theme={settings.theme} reducedMotion={settings.reduced} components={components} tokens={shadcnTokens} />
    </>
  );
}

/** An element's width, kept current; `key` changes when the element may have come or gone. */
function useWidth(ref: React.RefObject<HTMLElement | null>, key: unknown): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref, key]);
  return w;
}

export function PreviewPane(p: PreviewPaneProps): ReactNode {
  const { settings: s } = p;
  const [log, setLog] = useState<Logged[]>([]);
  const counter = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const measured = useWidth(stage, !!p.bundle && !p.loading);
  useEffect(() => setLog([]), [p.bundle]);
  const onSignal = (e: SignalEvent): void => {
    const n = ++counter.current;
    const at = new Date().toLocaleTimeString([], { hour12: false });
    setLog((l) => [...l.slice(-49), { n, at, e }]);
  };
  const px = WIDTHS[s.width].px;
  const compileErrors = p.diags.filter((d) => d.stage === 'compile' && d.severity === 'error');
  const drawn = p.diags.filter((d) => d.stage === 'draw');
  const status = p.loading ? 'loading' : p.bundle ? 'drawn' : 'failed';
  const expect = p.entry.expect;
  const met = expect ? p.diags.some((d) => d.code === expect.code && (expect.line === 0 ? d.stage === 'draw' : d.line === expect.line)) : false;
  return (
    <div className="flex h-full min-h-0 flex-col" data-pg-pane="preview">
      <div className="pg-preview-bar flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-1.5 text-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={s.theme === 'dark' ? 'Light' : 'Dark'} data-pg-theme-toggle="" onClick={() => p.onSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' })}>
              {s.theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{s.theme === 'dark' ? 'Light' : 'Dark'}</TooltipContent>
        </Tooltip>
        <Label className="gap-1.5 text-xs font-normal">
          <Switch checked={s.reduced} onCheckedChange={(v) => p.onSettings({ reduced: v })} aria-label="Reduced motion" /> Reduced motion
        </Label>
        <Label className="gap-1.5 text-xs font-normal">
          <Switch checked={s.gfx} onCheckedChange={(v) => p.onSettings({ gfx: v })} aria-label="gfx@1" /> <code className="font-mono">gfx@1</code>
        </Label>
        <ToggleGroup type="single" size="sm" variant="outline" value={s.width} onValueChange={(v) => v && p.onSettings({ width: v as WidthPreset })} aria-label="Width">
          {(Object.keys(WIDTHS) as WidthPreset[]).map((k) => (
            <ToggleGroupItem key={k} value={k} className="px-2 text-xs" data-pg-width={k}>
              {WIDTHS[k].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="font-mono text-xs text-muted-foreground" data-pg-measured={measured} title="The width the document has, and what the runtime reads as width">
          {measured ? `${measured} px · ${widthClass(measured)}` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-pg-scroll="preview">
        {expect ? (
          <div className={cn('m-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm', met ? 'border-ok/40 bg-ok/5' : 'border-destructive/40 bg-destructive/5')} data-pg-limit={met ? 'met' : 'unmet'}>
            {met ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
            <span>
              <strong className="font-medium">{p.entry.num}: fails on purpose.</strong> Expected <code className="font-mono">{expect.code}</code> {expect.line ? `at line ${expect.line}` : 'while drawing'}
              {met ? ', and it does.' : ', but it does not.'}
              {p.entry.teaches ? <span className="block text-muted-foreground">{p.entry.teaches}</span> : null}
            </span>
          </div>
        ) : null}
        <div
          className="pg-stage-wrap p-3"
          data-pg-preview=""
          data-pg-entry={p.builtFor}
          data-pg-status={status}
          data-pg-theme={s.theme}
          data-pg-errors={compileErrors.length + drawn.length}
        >
          {p.loading ? <p className="p-2 text-sm text-muted-foreground">{p.loading}</p> : null}
          {!p.loading && !p.bundle ? (
            <section className="rounded-md border" aria-label="Errors">
              <p className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
                <CircleAlert className="size-4 text-destructive" aria-hidden /> It doesn't compile: {compileErrors.length} {compileErrors.length === 1 ? 'error' : 'errors'}
              </p>
              <DiagList items={compileErrors} onJump={p.onJump} docFile={p.entry.files[0]?.path} />
            </section>
          ) : null}
          {!p.loading && p.bundle ? (
            // a preset is the document's own width, as on that device; the pane scrolls when it is wider
            <div className={cn('mx-auto rounded-lg border bg-card p-4', px && 'shadow-sm')} style={{ width: px ? `calc(${px}px + 2rem + 2px)` : undefined }}>
              <div ref={stage} className="pg-stage" style={{ width: px ? px : '100%' }} data-pg-stage="">
                <Boundary reset={p.bundle}>
                  <Stage bundle={p.bundle} maths={p.maths} settings={s} conf={p.conf} onDrawn={p.onDrawn} onSignal={onSignal} />
                </Boundary>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <section className="max-h-[30%] shrink-0 overflow-y-auto border-t" aria-label="Signals">
        <div className="sticky top-0 flex items-center justify-between bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          <span>Signals {log.length ? `(${log.length})` : ''}</span>
          {log.length ? (
            <Button variant="ghost" size="xs" onClick={() => setLog([])}>
              Clear
            </Button>
          ) : null}
        </div>
        {log.length ? (
          <ol className="px-3 pb-2 font-mono text-xs" data-pg-signals={log.length}>
            {log.map((l) => (
              <li key={l.n} className="flex gap-2 py-0.5">
                <span className="text-muted-foreground">{l.at}</span>
                <span className="font-medium">{l.e.name}</span>
                <span className="min-w-0 flex-1 break-all">{JSON.stringify(l.e.payload)}</span>
                <span className="text-muted-foreground">
                  block {String(l.e.block)} · {l.e.widget}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-3 pb-2 text-xs text-muted-foreground">A widget's signals to its host show here as they are sent.</p>
        )}
      </section>
    </div>
  );
}
