// The value fns the web supplies (target.yaml's `fns`): the reader's own time zone, which only the
// browser knows. can_draw_tex keeps core's default: TeX our reader doesn't know is shown as itself.

import { Num, type Value } from "@extended-mark/runtime";
import { field, num } from "./values.js";

type Entries = readonly (readonly [string, Value])[];

const int = (n: number): Value => ({ kind: "num", n: Num.int(n) });

/** A record like `like`, its fields in the same order, with some of them changed. */
function withFields(like: Value & { kind: "record" }, set: Record<string, Value>): Value {
  return { ...like, fields: (like.fields as Entries).map(([k, v]) => [k, set[k] ?? v] as const) };
}

/**
 * `core/moment.local`: the same instant, with the offset the reader's zone uses on its date,
 * summer time included. Worked out from the moment's fields, as the page may call it while it
 * is still being made.
 */
export function webFns(): Record<string, (args: readonly Value[]) => Value | null> {
  return {
    "core/moment.local": ([m]) => {
      const day = field(m, "day");
      if (!m || m.kind !== "record" || !day || day.kind !== "record") return null;
      const n = (v: Value | undefined) => num(v) ?? 0;
      const sign = field(m, "east")?.kind === "bool" && (field(m, "east") as { b: boolean }).b ? 1 : -1;
      const offset = sign * (n(field(m, "offset_hour")) * 60 + n(field(m, "offset_minute")));
      // the instant, in UTC; setUTCFullYear keeps years below 100 as they are
      const at = new Date(0);
      at.setUTCFullYear(n(field(day, "year")), n(field(day, "month")) - 1, n(field(day, "day")));
      at.setUTCHours(n(field(m, "hour")), n(field(m, "minute")) - offset, 0, 0);
      const east = -at.getTimezoneOffset();
      const local = new Date(at.getTime() + east * 60_000);
      return withFields(m, {
        day: withFields(day, { year: int(local.getUTCFullYear()), month: int(local.getUTCMonth() + 1), day: int(local.getUTCDate()) }),
        hour: int(local.getUTCHours()),
        minute: int(local.getUTCMinutes()),
        east: { kind: "bool", b: east >= 0 },
        offset_hour: int(Math.floor(Math.abs(east) / 60)),
        offset_minute: int(Math.abs(east) % 60),
      });
    },
  };
}
