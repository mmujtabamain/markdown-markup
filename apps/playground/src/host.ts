// What the playground, as the app, gives a page: where it is read (width and theme), the clock
// (`core/page.today` and `core/page.now`), and `core/moment.local` from the browser's time zone.

import { Num, type Page, type PageOptions, type PageValues, type Value, type ir } from "@extended-mark/runtime";

const n = (v: number): ir.Expr => ({ num: String(v) });

/** The page's width, from the width it is drawn at, in CSS pixels. */
export function widthOf(px: number): NonNullable<PageValues["width"]> {
  if (px < 600) return "NARROW";
  if (px < 1000) return "MEDIUM";
  return "WIDE";
}

export function themeNow(): NonNullable<PageValues["theme"]> {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "DARK" : "LIGHT";
}

function offsetFields(minutesEast: number) {
  const abs = Math.abs(minutesEast);
  return { east: minutesEast >= 0, hour: Math.min(14, Math.floor(abs / 60)), minute: abs % 60 };
}

/** `core/page.today` and `core/page.now`, from the browser's clock and zone. */
export function clockExterns(now = new Date()): Record<string, Record<string, ir.Expr>> {
  const today: ir.Expr = { record: { type: "core/date", fields: { year: n(now.getFullYear()), month: n(now.getMonth() + 1), day: n(now.getDate()) } } };
  const off = offsetFields(-now.getTimezoneOffset());
  const moment: ir.Expr = {
    record: {
      type: "core/moment",
      fields: { day: today, hour: n(now.getHours()), minute: n(now.getMinutes()), east: { bool: off.east }, offset_hour: n(off.hour), offset_minute: n(off.minute) },
    },
  };
  return { "core/page": { today, now: moment } };
}

/** The value fns a target supplies: `core/moment.local`, by the browser's zone rules. */
export function targetFns(getPage: () => Page): NonNullable<PageOptions["fns"]> {
  return {
    "core/moment.local": ([m]) => {
      const machine = getPage().machine;
      if (!m || m.kind !== "record") return null;
      const utc = machine.call("core/moment.utc", [{ value: m }]);
      if (!utc || utc.kind !== "num") return null;
      const off = offsetFields(-new Date(utc.n.toNumber() * 60_000).getTimezoneOffset());
      const set: Record<string, Value> = {
        east: { kind: "bool", b: off.east } as Value,
        offset_hour: { kind: "num", n: Num.int(off.hour) } as Value,
        offset_minute: { kind: "num", n: Num.int(off.minute) } as Value,
      };
      const zoned = { ...m, fields: m.fields.map(([k, v]) => [k, set[k] ?? v] as const) } as Value;
      return machine.call("core/moment_at", [{ value: utc }, { value: zoned }]) ?? null;
    },
  };
}
