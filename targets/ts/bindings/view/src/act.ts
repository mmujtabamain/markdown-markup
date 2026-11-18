// The reader acting on a drawn widget through its own element, as a person would: what the target
// checks drive a framework target with (as @mkp/dom's `Mounted.act` does), so a target is held to
// the runtime through its real DOM. A widget that can't do an action that way goes through the
// page instead.

import type { Page, Value } from "@mkp/runtime";
import { acts as controls } from "./widgets/controls.js";
import { acts as blocks } from "./widgets/blocks.js";
import { acts as layout } from "./widgets/layout.js";
import { acts as plane } from "./widgets/plane.js";
import { acts as gfx } from "./widgets/gfx.js";

/** What a reader does to a widget, in the checks' terms. */
export type Action = { event: string; args?: Value[] } | { write: string; value: Value };

/** A widget acting through its element; false when it can't do this that way. */
export type Act = (el: HTMLElement, a: Action, page: Page, path: string) => boolean;

const ACTS: Record<string, Act> = { ...blocks, ...controls, ...layout, ...plane, ...gfx };

/** The reader acting on the widget drawn at a path under a root: through its element when it
 * can, else through the page. */
export function act(root: Element, page: Page, path: string, a: Action): void {
  const el = root.querySelector<HTMLElement>(`[data-mkp-site="${CSS.escape(path)}"]`);
  const widget = el?.getAttribute("data-mkp-widget") ?? "";
  const f = ACTS[widget];
  if (el && f) {
    try {
      if (f(el, a, page, path)) return;
    } catch (e) {
      page.errors.push(e);
    }
  }
  if ("event" in a) page.event(path, a.event, a.args ?? []);
  else page.write(path, a.write, a.value);
}
