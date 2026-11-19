// The test target's fixed sizes, in the page's own lengths, so a check can say exactly where a
// plane's spots land:
//
// - Text is 8 wide per character and 20 high: a label, a paragraph, a button's label.
// - A flex lines its children up along its axis (a row's is X, a column's Y); a grid, a cell, a
//   sizing and a spot stack theirs. Each has its `gap` between children and its `pad` on every
//   side (core's space tokens).
// - Anything else is 80 by 20.
// - A plane given no width is 640 wide, the test page's width.

import { Num } from "@extended-mark/runtime";

export const CHAR = 8;
export const LINE = 20;
export const OTHER = 80;
export const PAGE_WIDTH = 640;

function textOf(v) {
  if (!v) return undefined;
  switch (v.kind) {
    case "text":
      return v.s;
    case "opt":
      return v.value ? textOf(v.value) : "";
    case "list":
      return v.items.map((i) => textOf(i.value) ?? "").join("");
    case "record":
    case "case":
      return (v.fields ?? v.values).map(([, x]) => textOf(x) ?? "").join("");
    default:
      return undefined;
  }
}

/** A token case's number, or 0. An `opt` gives its value's. */
function tokenOf(page, v) {
  if (!v) return 0;
  if (v.kind === "opt") return v.value ? tokenOf(page, v.value) : 0;
  if (v.kind === "num") return v.n.toNumber();
  if (v.kind === "case") {
    const n = page.machine.defaultTokenValue(v);
    return n.kind === "num" ? n.n.toNumber() : 0;
  }
  return 0;
}

/** Widgets that hold others: their size is their children's, with their gap and pad. */
const CONTAINERS = new Set(["core/flex", "core/grid", "core/cell", "core/sizing", "core/spot"]);

/** A drawn widget's size: [width, height]. */
export function sizeOf(page, d) {
  const kids = [...d.slots.values()].flat();
  const pad = tokenOf(page, d.props.get("pad"));
  const gap = tokenOf(page, d.props.get("gap"));
  const axis = d.props.get("axis");
  if (CONTAINERS.has(d.widget)) {
    const sizes = kids.map((k) => sizeOf(page, k));
    const between = gap * Math.max(0, sizes.length - 1);
    // a flex lines its children up along its axis; everything else here stacks them
    const across = d.widget === "core/flex" && axis?.kind === "case" && axis.name === "X";
    const w = across ? sizes.reduce((a, [x]) => a + x, 0) + between : Math.max(0, ...sizes.map(([x]) => x));
    const h = across ? Math.max(0, ...sizes.map(([, y]) => y)) : sizes.reduce((a, [, y]) => a + y, 0) + between;
    return [w + 2 * pad, h + 2 * pad];
  }
  const text = textOf(d.props.get("value")) ?? textOf(d.props.get("label"));
  if (text !== undefined) return [CHAR * [...text].length + 2 * pad, LINE + 2 * pad];
  return [OTHER, LINE];
}

/** The layout's measure for a page. */
export function measure(page) {
  return {
    spot(s) {
      const [w, h] = sizeOf(page, s);
      return { width: Num.int(w), height: Num.int(h) };
    },
    planeWidth() {
      return Num.int(PAGE_WIDTH);
    },
  };
}

/** The value fns the test target supplies. Its reader is in UTC. */
export function targetFns(getPage) {
  return {
    "core/can_draw_tex": () => ({ kind: "bool", b: true }),
    "core/moment.local": ([m]) => {
      const machine = getPage().machine;
      const utc = machine.call("core/moment.utc", [{ value: m }]);
      const zone = (k, v) => (k === "east" ? { kind: "bool", b: true } : k === "offset_hour" || k === "offset_minute" ? { kind: "num", n: Num.zero() } : v);
      const inUtc = { ...m, fields: m.fields.map(([k, v]) => [k, zone(k, v)]) };
      return machine.call("core/moment_at", [{ value: utc }, { value: inUtc }]);
    },
  };
}
