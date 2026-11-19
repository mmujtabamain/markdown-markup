// @extended-mark/dom's API, fixed before its widgets so that the bindings, the web target, the omnicui
// target and the playground can all be written against it.
//
// A page is drawn from @extended-mark/runtime's tree: each drawn extern widget becomes one WidgetView,
// kept across redraws by its key (a loop row's widgets follow its item), and updated in place,
// so focus, selection and scroll survive a change.

import type { Drawn, Measure, Page, PageOptions, Value, ir } from "@extended-mark/runtime";

/** What a widget can do on the page it is drawn on. */
export interface WidgetContext {
  readonly page: Page;
  /** The reader's event on this widget: runs the caller's handler, as one change. */
  event(name: string, args?: Value[]): void;
  /** This widget writing one of its `mut` inputs, as a slider does: checked, then one change. */
  write(input: string, value: Value): void;
  /** Draws a slot's widgets into a container, keeping the ones already there by key. */
  children(container: Element, nodes: Drawn[]): void;
  /** A token case's value: `space.M` → 16, `color.INK` → its colour for the current theme. */
  token(v: Value | undefined): Value | undefined;
}

/** One drawn widget: its element, and how it follows the page. */
export interface WidgetView {
  /** Its root element. @extended-mark/dom sets `data-xtmd-site` (its path) and `data-xtmd-widget` on it. */
  readonly el: Element;
  /** The page changed: show this widget's new props and slots. */
  update(d: Drawn): void;
  /** For the checks and omnicui: the reader acting on it through its own DOM, as a person would.
   * Returns false when this widget can't do it that way, and the caller goes through the page. */
  act?(action: Action): boolean;
  destroy?(): void;
}

/** What a reader does to a widget, in the checks' terms. */
export type Action = { event: string; args?: Value[] } | { write: string; value: Value };

/** A widget's maker: our defaults for every `core/*` extern, or the app's own, by full name. */
export type Widget = (d: Drawn, ctx: WidgetContext) => WidgetView;

export interface MountOptions {
  /** The app's widgets, by full name (`core/press`, `acme/chart`): they replace ours. */
  widgets?: Record<string, Widget>;
  /** How spots are measured for the plane's layout. Left out, from the DOM: a ResizeObserver
   * and each child's box in page lengths (CSS pixels). The checks pass fixed sizes. */
  measure?: Measure;
}

/** A page drawn into an element. */
export interface Mounted {
  readonly page: Page;
  readonly root: HTMLElement;
  /** The widget view drawn at a path (`s0/s1[2]/s3`), if it is on the page now. */
  view(path: string): WidgetView | undefined;
  /** The reader acting on the widget at a path: through its DOM when it can, else the page. */
  act(path: string, action: Action): void;
  /** The plane's layout, run now (it also runs after every change on its own). */
  layout(): void;
  unmount(): void;
}

export type { Drawn, Measure, Page, PageOptions, Value, ir };
