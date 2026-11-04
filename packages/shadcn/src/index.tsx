// @mkp/shadcn: a provider's definition of every base widget (spec 8), drawn with the shadcn-style
// components it passes in. A kit is shadcn's components plus, for what shadcn has none of, components
// in its style (OptionRow, Callout, CodeBlock and the typography). State stays in the runtime: every
// component is controlled, and what it reports goes back as the base widget's own event.

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipBack, type LucideIcon } from 'lucide-react';
import { walkView, type VNode, type VRun } from '@mkp/core';
import { Canvas, color, flexRole, flexStyle, gridStyle, Kids, MathSpan, nodeAttrs, Runs, size, stackStyle, textStyle, type HostProps, type MkpComponents, type TokenMap } from '@mkp/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kits differ in their exact props; these pass only what shadcn's take
type C = ComponentType<any>;

export interface OptionRowProps {
  kind: 'radio' | 'check';
  selected: boolean;
  verdict?: 'right' | 'wrong';
  disabled?: boolean;
  onClick(): void;
  style?: CSSProperties;
  children?: ReactNode;
}

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export interface Kit {
  Button: C;
  Toggle: C;
  Switch: C;
  Slider: C;
  Input: C;
  Checkbox: C;
  Progress: C;
  Separator: C;
  Tabs: C;
  TabsList: C;
  TabsTrigger: C;
  ToggleGroup: C;
  ToggleGroupItem: C;
  Select: C;
  SelectTrigger: C;
  SelectValue: C;
  SelectContent: C;
  SelectItem: C;
  Tooltip: C;
  TooltipTrigger: C;
  TooltipContent: C;
  Popover: C;
  PopoverTrigger: C;
  PopoverContent: C;
  Dialog: C;
  DialogTrigger: C;
  DialogContent: C;
  DialogTitle: C;
  Table: C;
  TableHeader: C;
  TableBody: C;
  TableRow: C;
  TableHead: C;
  TableCell: C;
  /** one answer among others: a full-width row with a tick or a dot */
  OptionRow: ComponentType<OptionRowProps>;
  Callout: ComponentType<{ alert: AlertKind; children?: ReactNode }>;
  CodeBlock: ComponentType<{ language: string; code: string }>;
  Paragraph: C;
  /** takes `level`, 1 to 6 */
  Heading: C;
  /** takes `ordered` and `start`; its children are <li>s */
  List: C;
  Quote: C;
  /** takes `label` */
  Footnote: C;
}

/** core@1's colours as shadcn's variables; `dark` repeats them, so the page's theme decides. */
const shade = (cssVar: string, fallback: string) => ({ value: `var(${cssVar}, ${fallback})`, dark: `var(${cssVar}, ${fallback})` });

export const shadcnTokens: TokenMap = {
  color: {
    surface: shade('--background', '#ffffff'),
    ink: shade('--foreground', '#0a0a0a'),
    muted: shade('--muted-foreground', '#737373'),
    accent: shade('--primary', '#171717'),
    info: shade('--info', '#1d4ed8'),
    ok: shade('--ok', '#15803d'),
    warn: shade('--warn', '#b45309'),
    bad: shade('--destructive', '#dc2626'),
  },
  radius: { card: { value: 'var(--radius, 0.625rem)' }, pill: { value: 999 } },
};

const GLYPHS: Record<string, LucideIcon> = { '‹': ChevronLeft, '›': ChevronRight, '▶': Play, '⏸': Pause, '⏮': SkipBack, '↑': ArrowUp, '↓': ArrowDown, '↺': RotateCcw };

/** A press whose whole content is one symbol is an icon button. MKP has no icon widget (GAPS 57). */
function glyphOf(n: VNode): LucideIcon | undefined {
  const kid = n.kids?.length === 1 ? n.kids[0] : undefined;
  const runs = kid?.t === 'text' ? (kid.p.runs as VRun[]) : undefined;
  return runs?.length === 1 && runs[0].t === 'text' ? GLYPHS[runs[0].v] : undefined;
}

const shown = (n: VNode): VNode[] => (n.kids ?? []).filter((k) => !k.hidden);
const every = (n: VNode, kind: string): boolean => shown(n).length > 0 && shown(n).every((k) => k.t === 'press' && k.p.kind === kind);
const chosen = (kids: VNode[]): string => kids.find((k) => k.p.selected)?.key ?? '';
const words = (v: unknown): string | undefined => (v ? String(v) : undefined);

/** A portal's content leaves .mkp-root: this brings the token variables along, and nothing else. */
function Inside({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="mkp-root" style={{ background: 'transparent', color: 'inherit', fontSize: 'inherit', fontFamily: 'inherit' }}>
      {children}
    </div>
  );
}

function press({ n, attrs, style, dispatch }: HostProps, kit: Kit): ReactNode {
  const p = n.p;
  const kind = String(p.kind ?? 'button');
  const click = (): void => dispatch(n.key, 'click');
  const selected = !!p.selected;
  const disabled = !!p.disabled;
  const label = words(p.label);
  switch (kind) {
    case 'switch':
      return (
        <label {...attrs} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', ...style }}>
          <kit.Switch checked={selected} disabled={disabled} aria-label={label} onCheckedChange={click} />
          <Kids nodes={n.kids} />
        </label>
      );
    case 'option':
    case 'radio':
    case 'check':
      return (
        <kit.OptionRow {...attrs} kind={kind === 'check' ? 'check' : 'radio'} selected={selected} verdict={p.tone === 'ok' ? 'right' : p.tone === 'bad' ? 'wrong' : undefined} disabled={disabled} aria-label={label} onClick={click} style={style}>
          <Kids nodes={n.kids} />
        </kit.OptionRow>
      );
    case 'toggle':
      return (
        <kit.Toggle {...attrs} variant="outline" size="sm" pressed={selected} disabled={disabled} aria-label={label} onPressedChange={click} style={{ color: color(p.tone), ...style }}>
          <Kids nodes={n.kids} />
        </kit.Toggle>
      );
    default: {
      const Icon = glyphOf(n);
      return (
        <kit.Button {...attrs} variant="outline" size={Icon ? 'icon-sm' : 'sm'} disabled={disabled} aria-label={label} onClick={click} style={{ color: color(p.tone), ...style }}>
          {Icon ? <Icon aria-hidden /> : <Kids nodes={n.kids} />}
        </kit.Button>
      );
    }
  }
}

/** A row of tabs is Tabs and a row of options is a ToggleGroup; any other row is plain layout. */
function flex({ n, attrs, style, dispatch }: HostProps, kit: Kit): ReactNode {
  const kids = shown(n);
  if (every(n, 'tab')) {
    return (
      <kit.Tabs value={chosen(kids)} onValueChange={(key: string) => dispatch(key, 'click')} style={style}>
        <kit.TabsList {...attrs}>
          {kids.map((k) => (
            <kit.TabsTrigger key={k.key} {...nodeAttrs(k)} value={k.key} disabled={!!k.p.disabled}>
              <Kids nodes={k.kids} />
            </kit.TabsTrigger>
          ))}
        </kit.TabsList>
      </kit.Tabs>
    );
  }
  if (kids.length > 1 && every(n, 'option')) {
    const now = chosen(kids);
    return (
      // Radix empties the value when the chosen item is pressed again: that is still a press of it
      <kit.ToggleGroup {...attrs} type="single" variant="outline" size="sm" value={now} onValueChange={(key: string) => dispatch(key || now, 'click')} style={style}>
        {kids.map((k) => (
          <kit.ToggleGroupItem key={k.key} {...nodeAttrs(k)} value={k.key} disabled={!!k.p.disabled} aria-label={words(k.p.label)}>
            <Kids nodes={k.kids} />
          </kit.ToggleGroupItem>
        ))}
      </kit.ToggleGroup>
    );
  }
  return (
    <div {...attrs} role={flexRole(n)} aria-label={n.p.label as string | undefined} style={{ ...flexStyle(n), ...style }}>
      <Kids nodes={n.kids} />
    </div>
  );
}

/** The options in a menu's body. It only has a body while open, and the trigger shows the current one. */
function menu({ n, attrs, style, dispatch }: HostProps, kit: Kit): ReactNode {
  const options: VNode[] = [];
  walkView(n.body ?? [], (k) => {
    if (k.t === 'press' && k.p.kind === 'option') options.push(k);
  });
  return (
    // Radix shows the trigger's children only with a value, and a closed menu has no options to name one
    <kit.Select open={!!n.p.open} value={chosen(options) || 'current'} onOpenChange={(o: boolean) => dispatch(n.key, o ? 'open' : 'close')} onValueChange={(key: string) => dispatch(key, 'click')}>
      <kit.SelectTrigger {...attrs} size="sm" aria-label={words(n.p.label)} style={style}>
        <kit.SelectValue>
          <Kids nodes={n.kids} />
        </kit.SelectValue>
      </kit.SelectTrigger>
      <kit.SelectContent>
        {options.map((o) => (
          <kit.SelectItem key={o.key} {...nodeAttrs(o)} value={o.key}>
            <Kids nodes={o.kids} />
          </kit.SelectItem>
        ))}
      </kit.SelectContent>
    </kit.Select>
  );
}

function overlay(h: HostProps, kit: Kit): ReactNode {
  const { n, attrs, style, dispatch } = h;
  const open = !!n.p.open;
  const onOpenChange = (o: boolean): void => dispatch(n.key, o ? 'open' : 'close');
  const label = words(n.p.label);
  const trigger = (
    <kit.Button {...attrs} variant="outline" size="sm" aria-label={label} style={style}>
      <Kids nodes={n.kids} />
    </kit.Button>
  );
  const body = (
    <Inside>
      <Kids nodes={n.body} />
    </Inside>
  );
  switch (String(n.p.mode ?? 'popover')) {
    case 'menu':
      return menu(h, kit);
    case 'tooltip':
      return (
        <kit.Tooltip open={open} onOpenChange={onOpenChange}>
          <kit.TooltipTrigger asChild>
            <span {...attrs} tabIndex={0} style={{ display: 'inline-block', cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 4, ...style }}>
              <Kids nodes={n.kids} />
            </span>
          </kit.TooltipTrigger>
          <kit.TooltipContent>{body}</kit.TooltipContent>
        </kit.Tooltip>
      );
    case 'dialog':
      return (
        <kit.Dialog open={open} onOpenChange={onOpenChange}>
          <kit.DialogTrigger asChild>{trigger}</kit.DialogTrigger>
          <kit.DialogContent aria-describedby={undefined}>
            <kit.DialogTitle style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{label ?? 'dialog'}</kit.DialogTitle>
            {body}
          </kit.DialogContent>
        </kit.Dialog>
      );
    default:
      return (
        <kit.Popover open={open} onOpenChange={onOpenChange}>
          <kit.PopoverTrigger asChild>{trigger}</kit.PopoverTrigger>
          <kit.PopoverContent>{body}</kit.PopoverContent>
        </kit.Popover>
      );
  }
}

function table({ n, attrs }: HostProps, kit: Kit): ReactNode {
  const align = (n.p.align as string[]) ?? [];
  const al = (i: number): CSSProperties | undefined => (align[i] && align[i] !== 'none' ? { textAlign: align[i] as CSSProperties['textAlign'] } : undefined);
  return (
    <kit.Table {...attrs}>
      <kit.TableHeader>
        <kit.TableRow>
          {(n.p.head as VRun[][]).map((c, i) => (
            <kit.TableHead key={i} style={al(i)}>
              <Runs runs={c} />
            </kit.TableHead>
          ))}
        </kit.TableRow>
      </kit.TableHeader>
      <kit.TableBody>
        {(n.p.rows as VRun[][][]).map((r, j) => (
          <kit.TableRow key={j}>
            {r.map((c, i) => (
              <kit.TableCell key={i} style={al(i)}>
                <Runs runs={c} />
              </kit.TableCell>
            ))}
          </kit.TableRow>
        ))}
      </kit.TableBody>
    </kit.Table>
  );
}

function list({ n, attrs }: HostProps, kit: Kit): ReactNode {
  const task = (it: VNode): boolean => it.p.checked !== 'none';
  return (
    <kit.List {...attrs} ordered={!!n.p.ordered} start={n.p.ordered ? Number(n.p.start) : undefined}>
      {(n.kids ?? []).map((it) => (
        <li key={it.key} style={task(it) ? { listStyle: 'none', display: 'flex', gap: '0.5rem', alignItems: 'baseline' } : undefined}>
          {task(it) ? <kit.Checkbox checked={it.p.checked === 'yes'} disabled aria-readonly style={{ alignSelf: 'center' }} /> : null}
          <Kids nodes={it.kids} />
        </li>
      ))}
    </kit.List>
  );
}

/** A provider's whole base set (spec 8), from its kit. */
export function shadcnComponents(kit: Kit): MkpComponents {
  return {
    stack: ({ n, attrs, style }) => (
      <div {...attrs} role={n.p.role as string | undefined} aria-label={n.p.label as string | undefined} style={{ ...stackStyle(n), ...style }}>
        <Kids nodes={n.kids} />
      </div>
    ),
    flex: (h) => flex(h, kit),
    grid: ({ n, attrs, style }) => (
      <div {...attrs} style={{ ...gridStyle(n), ...style }}>
        <Kids nodes={n.kids} />
      </div>
    ),
    text: ({ n, attrs, style }) => (
      <div {...attrs} style={{ ...textStyle(n), ...style }}>
        <Runs runs={n.p.runs as VRun[]} />
      </div>
    ),
    image: ({ n, attrs, style }) => <img {...attrs} src={String(n.p.src)} alt={String(n.p.alt)} style={{ maxWidth: n.p.size && n.p.size !== 'none' ? size(n.p.size) : '100%', ...style }} />,
    press: (h) => press(h, kit),
    range: ({ n, attrs, style, dispatch }) => {
      const [min, max, step] = [Number(n.p.min), Number(n.p.max), Number(n.p.step)];
      return <kit.Slider {...attrs} min={min} max={max} step={step > 0 ? step : (max - min) / 1000} value={[Number(n.p.value)]} aria-label={words(n.p.label) ?? 'value'} onValueChange={([value]: number[]) => dispatch(n.key, 'change', { value })} style={{ width: size('s'), maxWidth: '100%', ...style }} />;
    },
    meter: ({ n, attrs, style }) => {
      const max = Number(n.p.max) > 0 ? Number(n.p.max) : 1;
      return <kit.Progress {...attrs} value={Math.max(0, Math.min(1, Number(n.p.value) / max)) * 100} aria-label={words(n.p.label) ?? 'progress'} style={{ width: size(n.p.size), ...style }} />;
    },
    field: ({ n, attrs, style, dispatch }) => (
      <kit.Input
        {...attrs}
        inputMode={n.p.kind === 'number' ? 'decimal' : undefined}
        value={String(n.p.value ?? '')}
        placeholder={String(n.p.placeholder ?? '')}
        aria-label={words(n.p.label) ?? words(n.p.placeholder) ?? 'entry'}
        style={{ width: n.p.width && n.p.width !== 'none' ? size(n.p.width) : undefined, ...style }}
        onChange={(e: { currentTarget: { value: string } }) => dispatch(n.key, 'change', { value: e.currentTarget.value })}
        onKeyDown={(e: { key: string; currentTarget: { value: string } }) => {
          if (e.key === 'Enter') dispatch(n.key, 'submit', { value: e.currentTarget.value });
        }}
      />
    ),
    overlay: (h) => overlay(h, kit),
    canvas: ({ n }) => <Canvas n={n} />,
    paragraph: ({ n, attrs }) => (
      <kit.Paragraph {...attrs}>
        <Runs runs={n.p.runs as VRun[]} />
      </kit.Paragraph>
    ),
    heading: ({ n, attrs }) => (
      <kit.Heading {...attrs} level={Math.min(6, Math.max(1, Number(n.p.level) || 2))} id={(n.p.anchor as string) ?? undefined}>
        <Runs runs={n.p.runs as VRun[]} />
      </kit.Heading>
    ),
    list: (h) => list(h, kit),
    quote: ({ n, attrs }) =>
      n.p.alert && n.p.alert !== 'none' ? (
        <kit.Callout {...attrs} alert={n.p.alert as AlertKind}>
          <Kids nodes={n.kids} />
        </kit.Callout>
      ) : (
        <kit.Quote {...attrs}>
          <Kids nodes={n.kids} />
        </kit.Quote>
      ),
    code: ({ n, attrs }) => <kit.CodeBlock {...attrs} language={String(n.p.lang || '')} code={String(n.p.src)} />,
    math: ({ n, attrs }) => (
      <div {...attrs}>
        <MathSpan m={n.p as { tex: string }} display />
      </div>
    ),
    divider: ({ attrs }) => <kit.Separator {...attrs} />,
    table: (h) => table(h, kit),
    footnote: ({ n, attrs }) => (
      <kit.Footnote {...attrs} id={`fn-${String(n.p.label)}`} label={String(n.p.label)}>
        <Kids nodes={n.kids} />
      </kit.Footnote>
    ),
  };
}
