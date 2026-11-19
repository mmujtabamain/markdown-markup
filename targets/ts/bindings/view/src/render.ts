// A page's tree as elements: each drawn extern widget by its widget, keyed by who it is across
// redraws (a loop row's widgets follow its item) and marked with the place it is drawn at, as
// @extended-mark/dom marks its own, so focus and what is being typed survive a redraw in every framework.

import type { Drawn, Page, Value } from "@extended-mark/runtime";
import { styleText, Tokens, str } from "@extended-mark/dom/shared";
import { h, type VNode } from "./vnode.js";

/** What a widget can do on the page it is drawn on. */
export interface ViewContext {
  readonly page: Page;
  readonly tokens: Tokens;
  /** A prefix unique to this document, for element ids (`xtmdv3-`). */
  readonly uid: string;
  /** The reader's event on this widget: runs the caller's handler, as one change. */
  event(name: string, args?: Value[]): void;
  /** This widget writing one of its `mut` inputs, as a field or a slider does: checked, then one change. */
  write(input: string, value: Value): void;
  /** A slot's widgets, drawn. */
  children(nodes: Drawn[]): VNode[];
  /** Asks for the plane's layout once this render is in the document. */
  layout(): void;
}

/** A widget: its element for what the page shows now. Core's are in `widgets`; a pack's own extern
 * widgets are given the same way, by full name. */
export type ViewWidget = (d: Drawn, ctx: ViewContext) => VNode;

function notice(message: string): VNode {
  return h("div", "notice", { role: "alert" }, [message]);
}

export interface Drawing {
  readonly page: Page;
  readonly registry: Record<string, ViewWidget>;
  readonly tokens: Tokens;
  readonly uid: string;
  /** Called when a widget asks for the plane's layout. */
  layout(): void;
  /** Called after a reader's event or write, done or refused, so what it did reaches the app. */
  after?(): void;
}

/** The page as one root element: its stylesheet, its tokens for the theme it has now, and every
 * drawn widget. */
export function renderPage(dr: Drawing): VNode {
  const theme = dr.tokens.theme();
  const root = h("div", undefined, { class: "xtmd-root", "data-xtmd-root": "", "data-xtmd-theme": theme.toLowerCase() }, [
    { tag: "style", attrs: { "data-xtmd-dom": "" }, children: [styleText] },
    ...children(dr, dr.page.tree()),
  ]);
  root.style = { ...dr.tokens.properties(), "color-scheme": theme === "DARK" ? "dark" : "light" };
  return root;
}

/** Drawn widgets as elements, each keyed once among its siblings. */
export function children(dr: Drawing, nodes: Drawn[]): VNode[] {
  const seen = new Set<string>();
  return nodes.map((d) => {
    let key = d.key;
    for (let k = 2; seen.has(key); k++) key = `${d.key}#${k}`;
    seen.add(key);
    const v = draw(dr, d);
    v.key = key;
    v.attrs["data-xtmd-site"] = d.path;
    v.attrs["data-xtmd-widget"] = d.widget;
    return v;
  });
}

function draw(dr: Drawing, d: Drawn): VNode {
  if (d.widget === "#notice") return notice(str(d.props.get("message")));
  const maker = dr.registry[d.widget];
  // an extern widget nobody supplies shows its Markdown instead (page 6): the page draws it with
  // the blocks we do draw, so this is only one whose supplier the page wasn't told about
  if (!maker) return notice(`Nothing draws ${d.widget} here: its widget isn't supplied.`);
  const ctx: ViewContext = {
    page: dr.page,
    tokens: dr.tokens,
    uid: dr.uid,
    event: (name, args = []) => {
      dr.page.event(d.path, name, args);
      dr.after?.();
    },
    write: (input, value) => {
      dr.page.write(d.path, input, value);
      dr.after?.();
    },
    children: (nodes) => children(dr, nodes),
    layout: () => dr.layout(),
  };
  try {
    return maker(d, ctx);
  } catch (f) {
    dr.page.errors.push(f);
    return notice(`${d.widget.split("/").pop()} couldn't be drawn: ${f instanceof Error ? f.message : String(f)}`);
  }
}
