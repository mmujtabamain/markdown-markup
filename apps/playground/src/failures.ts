// Where a widget that failed is written: the page draws a notice in its place, at its site path
// (`s1/s0`, a loop's row `s3[2]`), and the compile says where each call in the document is written
// (`Built.sites`, by template and site; no IR holds it). The path is walked through the IR's
// templates from the page's own, `doc`: a call to a widget written in Extended Mark takes the walk into its
// template, and the last call on the way that is written in the document is the one to mark.

import type { Page, ir } from "@extended-mark/runtime";
import type { Built, Written } from "@extended-mark/wasm";

/** A notice on the page, and where in the document its call is written. */
export interface Failed {
  message: string;
  written: Written;
}

/** Every widget on the page that failed, with where in the document to mark it. */
export function failedCalls(page: Page, file: ir.File, sites: Built["sites"]): Failed[] {
  const out: Failed[] = [];
  for (const [path, n] of Object.entries(page.observeTree())) {
    if (n.widget !== "#notice") continue;
    const written = writtenAt(path, file, sites);
    const message = n.props.message && "text" in n.props.message ? n.props.message.text : "this widget failed";
    if (written) out.push({ message, written });
  }
  return out;
}

/** The call a site path ends at, or the last one on the way written in the document. */
export function writtenAt(path: string, file: ir.File, sites: Built["sites"]): Written | undefined {
  const templates = new Map(file.ir.templates.map((t) => [t.name, t]));
  let template = "doc";
  let found: Written | undefined;
  for (const segment of path.split("/")) {
    const site = segment.replace(/\[[^\]]*\]$/, "");
    const node = findSite(templates.get(template), site);
    if (!node) break;
    found = sites[template]?.[site] ?? found;
    if ("use" in node) template = (node.use as { name: string }).name;
  }
  return found;
}

/** The node of a template with this site: in its view, its loops, branches and the slots of the
 * calls in it (a slot's calls are its caller's), never inside another widget's template. */
function findSite(t: ir.Template | undefined, site: string): Record<string, unknown> | undefined {
  if (!t) return undefined;
  const walk = (v: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(v)) {
      for (const x of v) {
        const f = walk(x);
        if (f) return f;
      }
      return undefined;
    }
    if (!v || typeof v !== "object") return undefined;
    const o = v as Record<string, unknown>;
    for (const kind of ["use", "extern", "for", "place"]) {
      const inner = o[kind] as { site?: string } | undefined;
      if (inner && typeof inner === "object" && inner.site === site) return o;
    }
    for (const x of Object.values(o)) {
      const f = walk(x);
      if (f) return f;
    }
    return undefined;
  };
  return walk(t.view);
}
