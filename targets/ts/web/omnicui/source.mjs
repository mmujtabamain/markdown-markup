// The Extended Mark page the omnicui adapter mounts for one widget contract: the extern widget called on its
// own, its props turned into Extended Mark literals by each input's type, every `mut` input bound to a
// `$state` field (so a write persists), every event bound to a handler (so it reaches the page),
// and its slots filled with simple labelled content. Inputs, slots and events come from the IR's
// declarations (`declarations[].declare.extern.widget`), not from a hand-written list.
//
// Names: omnicui's are camelCase (props, events, fields), Extended Mark's are small with underscores. A
// prop `zoomRange` is the input `zoom_range`; an event `openChanged` is `open_changed`; a write
// to the `mut` input `open` is reported as the event `writeOpen`, with the field `value`.

/** `zoom_range` → `zoomRange`. */
export const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
/** `zoomRange` → `zoom_range`. */
export const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** `open` → `writeOpen`: the event a write to a `mut` input is reported as. */
export const writeEvent = (input) => `write${camel(input)[0].toUpperCase()}${camel(input).slice(1)}`;
/** `core/press_kind` → `press_kind`: the name a document writes. */
const short = (name) => name.slice(name.lastIndexOf("/") + 1);

/** Every declaration of an IR file, by kind and full name. */
export function declarations(irFile) {
  const out = { widgets: new Map(), enums: new Map(), tokens: new Map(), records: new Map(), types: new Map() };
  for (const d of (irFile.ir ?? irFile).declarations) {
    const x = d.declare;
    if (x.extern?.widget) out.widgets.set(x.extern.widget.name, x.extern.widget);
    else if (x.enum) out.enums.set(x.enum.name, x.enum);
    else if (x.token) out.tokens.set(x.token.name, x.token);
    else if (x.record) out.records.set(x.record.name, x.record);
    else if (x.type) out.types.set(x.type.name, x.type);
  }
  return out;
}

/** The core widget a contract id names: `core.slider` → `core/slider`. */
export function widgetOf(component) {
  const m = /^core\.([a-z][a-z0-9_]*)$/.exec(component);
  return m ? `core/${m[1]}` : undefined;
}

// ---- literals

/** A text literal on one line: `"` and `\` escaped, line breaks and tabs as `\n` and `\t`. */
export function textLiteral(s) {
  const body = String(s).replace(/[\\"\n\t\r\u0000-\u001f\u007f]/g, (c) => {
    if (c === "\\") return "\\\\";
    if (c === '"') return '\\"';
    if (c === "\n") return "\\n";
    if (c === "\t") return "\\t";
    return `\\u{${c.charCodeAt(0).toString(16)}}`;
  });
  return `"${body}"`;
}

/** A number literal: digits, an optional fraction and a minus, never an exponent. */
export function numberLiteral(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) throw new Error(`${JSON.stringify(n)} is not a number`);
  let s = String(Math.abs(x));
  if (/e/i.test(s)) s = Math.abs(x).toFixed(20).replace(/\.?0+$/, "");
  return x < 0 ? `-${s}` : s;
}

const RANGE = /^\s*(-?\d+(?:\.\d+)?)\s*\.\.(\.)?\s*(-?\d+(?:\.\d+)?)?\s*(?:step\s+(-?\d+(?:\.\d+)?))?\s*$/;

/** A JSON value given for a list, a record or a range may come as JSON text in a string prop. */
function parsed(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!/^[[{]/.test(t)) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/**
 * A prop's value, in the type of the input it is given to, as Extended Mark source.
 * - text, rich_text, latex: an escaped text literal; bool and numbers as they are;
 * - an enum or a token: its case's name (`"TOGGLE"` → `press_kind.TOGGLE`), or for a case with
 *   values an object (`{"EQUAL": {"count": 2}}` → `cols.EQUAL(count = 2)`); a token that is a
 *   literal of numbers (stroke) also takes a number;
 * - opt: the value, or `opt.NONE` for null;
 * - a list or a record: JSON, or JSON text in a string (`'{"x": 1, "y": 2}'` → `point { x = 1, y = 2 }`);
 * - a range: `"0..10"`, `"0..10 step 0.5"`, `[0, 10]` or `{"low": 0, "high": 10, "step": 1}`.
 */
export function literal(v, type, decls) {
  const name = type.name;
  const args = type.args ?? [];
  switch (name) {
    case "core/text":
    case "core/rich_text":
    case "core/latex":
    case "core/md":
      return textLiteral(v);
    case "core/bool":
      if (v === true || v === "true") return "true";
      if (v === false || v === "false") return "false";
      throw new Error(`${JSON.stringify(v)} is not a bool`);
    case "core/number":
    case "core/int":
      return numberLiteral(v);
    case "core/opt":
      return v === null || v === undefined || v === "NONE" ? "opt.NONE" : literal(v, args[0], decls);
    case "core/list": {
      const items = parsed(v);
      if (!Array.isArray(items)) throw new Error(`${JSON.stringify(v)} is not a list (give JSON: [ … ])`);
      return `[${items.map((x) => literal(x, args[0], decls)).join(", ")}]`;
    }
    case "core/range": {
      const r = parsed(v);
      if (Array.isArray(r)) return `${numberLiteral(r[0])}..${numberLiteral(r[1])}${r[2] !== undefined ? ` step ${numberLiteral(r[2])}` : ""}`;
      if (r && typeof r === "object") {
        const low = r.low !== undefined ? numberLiteral(r.low) : "";
        const high = r.high !== undefined ? numberLiteral(r.high) : "";
        return `${low}..${high === "" ? "." : high}${r.step !== undefined ? ` step ${numberLiteral(r.step)}` : ""}`;
      }
      const m = RANGE.exec(String(r));
      if (!m) throw new Error(`${JSON.stringify(v)} is not a range (write "0..10" or "0..10 step 0.5")`);
      return `${m[1]}..${m[2] ? "." : ""}${m[3] ?? ""}${m[4] ? ` step ${m[4]}` : ""}`;
    }
  }
  const alias = decls.types.get(name);
  if (alias) return literal(v, { ...alias.is, contract: type.contract }, decls);
  const kinds = decls.enums.get(name) ?? decls.tokens.get(name);
  if (kinds) {
    const token = decls.tokens.get(name);
    if (typeof v === "number" && token) return numberLiteral(v);
    const c = parsed(v);
    if (typeof c === "string") {
      const kase = kinds.cases.find((k) => k.name === c);
      if (!kase) throw new Error(`${JSON.stringify(c)} is not a case of ${short(name)} (${kinds.cases.map((k) => k.name).join(", ")})`);
      return `${short(name)}.${c}`;
    }
    if (c && typeof c === "object" && Object.keys(c).length === 1) {
      const [caseName, values] = Object.entries(c)[0];
      const kase = kinds.cases.find((k) => k.name === caseName);
      if (!kase) throw new Error(`${JSON.stringify(caseName)} is not a case of ${short(name)}`);
      const fields = (kase.fields ?? []).filter((f) => values && f.name in values);
      return `${short(name)}.${caseName}(${fields.map((f) => `${f.name} = ${literal(values[f.name], f.type, decls)}`).join(", ")})`;
    }
    throw new Error(`${JSON.stringify(v)} is not a case of ${short(name)}`);
  }
  const record = decls.records.get(name);
  if (record) {
    const o = parsed(v);
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error(`${JSON.stringify(v)} is not a ${short(name)} (give JSON: { … })`);
    const fields = record.fields.filter((f) => f.name in o || f.name in snakeKeys(o));
    return `${short(name)} { ${fields.map((f) => `${f.name} = ${literal(o[f.name] ?? snakeKeys(o)[f.name], f.type, decls)}`).join(", ")} }`;
  }
  throw new Error(`an input of type ${name} can't be set from a contract`);
}

function snakeKeys(o) {
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [snake(k), x]));
}

/** A literal from a default in the IR's form, for a `$state` field's starting value. */
export function irLiteral(x, decls) {
  if ("num" in x) return x.num.startsWith("-") ? `-${x.num.slice(1)}` : x.num;
  if ("text" in x) return textLiteral(x.text);
  if ("bool" in x) return x.bool ? "true" : "false";
  if ("none" in x) return "opt.NONE";
  if ("some" in x) return irLiteral(x.some, decls);
  if ("case" in x) {
    const vals = Object.entries(x.case.values ?? {});
    return `${short(x.case.enum)}.${x.case.name}${vals.length ? `(${vals.map(([k, v]) => `${k} = ${irLiteral(v, decls)}`).join(", ")})` : ""}`;
  }
  if ("record" in x) return `${short(x.record.type)} { ${Object.entries(x.record.fields).map(([k, v]) => `${k} = ${irLiteral(v, decls)}`).join(", ")} }`;
  if ("list" in x) return `[${x.list.map((v) => irLiteral(v, decls)).join(", ")}]`;
  if ("range" in x) return `${x.range.low ? irLiteral(x.range.low, decls) : ""}..${x.range.high ? irLiteral(x.range.high, decls) : "."}`;
  throw new Error(`can't write the default ${JSON.stringify(x)}`);
}

/** A type as a document writes it, its contract included: `number 0.1..10`, `opt<region>`. */
export function typeSource(t) {
  let s = short(t.name);
  if (t.args?.length) s += `<${t.args.map(typeSource).join(", ")}>`;
  const c = t.contract;
  if (c?.range) {
    const lo = c.range.low ? c.range.low.num : "";
    const hi = c.range.high ? c.range.high.num : "";
    s += ` ${lo}..${hi === "" ? "." : hi}`;
  }
  if (c?.step) s += ` step ${c.step.num}`;
  return s;
}

/** A starting value for a `$state` field when neither the contract nor the input gives one. */
function zero(t, decls) {
  switch (t.name) {
    case "core/text":
      return '""';
    case "core/bool":
      return "false";
    case "core/number":
    case "core/int":
      return t.contract?.range?.low ? t.contract.range.low.num : "0";
    case "core/opt":
      return "opt.NONE";
  }
  const r = decls.records.get(t.name);
  if (r) return `${short(t.name)} { ${r.fields.map((f) => `${f.name} = ${zero(f.type, decls)}`).join(", ")} }`;
  const e = decls.enums.get(t.name);
  if (e) return `${short(t.name)}.${e.cases[0].name}`;
  throw new Error(`no starting value for a ${t.name}`);
}

// ---- slots and the widgets a widget has to sit in

/** What fills a slot whose content a contract gives as text: a label, or a paragraph where the
 * slot holds blocks (an item's, a quote's or a footnote's body). */
const BLOCK_BODIES = new Set(["core/item.body", "core/quote.body", "core/footnote.body"]);

const label = (text) => `@label(value = ${textLiteral(text)});`;

/** The content a slot gets when the contract doesn't fill it, where the widget needs some. */
const SLOT_DEFAULTS = {
  "core/bullets.items": ["One", "Two"],
  "core/item.body": "An item",
  "core/quote.body": "Quoted",
  "core/footnote.body": "Its source.",
  "core/overlay.anchor": "More",
  "core/overlay.body": "The rest",
  "core/flex.children": ["One", "Two"],
  "core/grid.children": ["One", "Two"],
  "core/cell.child": "In a cell",
  "core/sizing.child": "Sized",
  "core/place.child": "Here",
  "core/spot.child": "Home",
};

/** The shapes a canvas or a layer is filled with: a labelled circle up and to the right of the
 * middle, so a press at a canvas's middle lands on empty space. */
const FILLER_CIRCLE = '@circle(at = point { x = 0.5, y = 0.5 }, r = 0.2, fill = color.ACCENT, label = "a dot");';
/** A plane's spots: one labelled spot away from the middle, so a press at the middle is empty. */
const FILLER_SPOT = ["@spot(at = point { x = 100, y = 40 }) {", '    @label(value = "Home");', "}"];

/** Where a widget has to sit: the widgets around it, with its call inside. */
const PARENTS = {
  "core/item": (inner) => ["@bullets {", ...indent(inner), "}"],
  "core/layer": (inner) => ['@canvas(label = "A canvas") {', ...indent(inner), "}"],
  "core/spot": (inner) => ['@plane(label = "A plane", width = size.M, aspect = 2) {', "    items {", ...indent(indent(inner)), "    }", "}"],
  "core/cell": (inner) => ["@grid(cols = cols.EQUAL(count = 2)) {", ...indent(inner), "}"],
  "core/sizing": (inner) => ["@flex(axis = axis.X) {", ...indent(inner), "}"],
};
for (const shape of ["core/circle", "core/path", "core/place", "core/handle", "core/shade"]) {
  PARENTS[shape] = (inner) => ['@canvas(label = "A canvas") {', "    @layer {", ...indent(indent(inner)), "    }", "}"];
}

/** Inputs a contract can't give (a shader is code, its args are any type): the adapter's own. */
const FIXED = {
  "core/shade": { shader: "glow", args: "1" },
};

/** Top-level definitions a page needs for FIXED inputs. */
const DEFINITIONS = {
  "core/shade": [
    "fn glow(at: point, px: number, args: number): pixel {",
    "    return pixel { r = at.x.clamp(0, 1), g = 0, b = at.y.clamp(0, 1), a = 1 };",
    "}",
  ],
};

function indent(lines) {
  return lines.map((l) => `    ${l}`);
}

function slotContent(widget, slot, given) {
  const key = `${widget}.${slot.name}`;
  const t = slot.type;
  const value = given !== undefined ? parsed(given) : SLOT_DEFAULTS[key];
  if (t.name === "core/list" && t.args?.[0]?.name === "core/item") {
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((s) => ["@item {", `    @paragraph(value = ${textLiteral(s)});`, "}"]);
  }
  if (t.name === "core/list" && t.args?.[0]?.name === "core/layer") return widget === "core/plane" ? [] : ["@layer {", `    ${FILLER_CIRCLE}`, "}"];
  if (t.name === "core/list" && t.args?.[0]?.name === "core/spot") return FILLER_SPOT;
  if (t.name === "core/list" && t.args?.[0]?.interface === "core/shape") return [FILLER_CIRCLE];
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((s) => label(s));
  if (BLOCK_BODIES.has(key)) return [`@paragraph(value = ${textLiteral(value)});`];
  return [label(value)];
}

/**
 * The page for one mount. `props` are the contract's (camelCase), the test's over the contract's
 * defaults. A prop named after a slot fills it: text for a view slot, a list of texts for a
 * list of children or items.
 */
export function pageSource(widget, props, decls) {
  const w = decls.widgets.get(widget);
  if (!w) throw new Error(`no extern widget ${widget}`);
  const given = new Map(Object.entries(props ?? {}).map(([k, v]) => [snake(k), v]));
  const known = new Set([...w.inputs.map((i) => i.name), ...w.slots.map((s) => s.name)]);
  for (const k of given.keys()) if (!known.has(k)) throw new Error(`${widget} has no input or slot ${camel(k)}`);
  const state = ["    heard: int = 0;"];
  const args = [];
  const fixed = FIXED[widget] ?? {};
  for (const input of w.inputs) {
    const has = given.has(input.name);
    if (fixed[input.name]) {
      args.push(`${input.name} = ${fixed[input.name]}`);
    } else if (input.mut) {
      const start = has ? literal(given.get(input.name), input.type, decls) : input.default ? irLiteral(input.default, decls) : zero(input.type, decls);
      state.push(`    ${input.name}: ${typeSource(input.type)} = ${start};`);
      args.push(`${input.name} = $state.${input.name}`);
    } else if (has) {
      args.push(`${input.name} = ${literal(given.get(input.name), input.type, decls)}`);
    } else if (!input.default) {
      throw new Error(`${widget} needs ${camel(input.name)}, and neither the test nor the contract gives it`);
    }
  }
  for (const e of w.events) {
    const params = e.params.map((p) => p.name).join(", ");
    args.push(`${e.name} = fn(${params}) { $state.heard = $state.heard + 1; }`);
  }
  const head = `@${short(widget)}${args.length ? `(${args.join(", ")})` : ""}`;
  let call;
  const slots = w.slots.map((s) => [s, slotContent(widget, s, given.get(s.name))]).filter(([, body]) => body.length);
  if (slots.length === 0) call = [`${head};`];
  else if (w.slots.length === 1) call = [`${head} {`, ...indent(slots[0][1]), "}"];
  else call = [`${head} {`, ...slots.flatMap(([s, body]) => indent([`${s.name} {`, ...indent(body), "}"])), "}"];
  const view = PARENTS[widget] ? PARENTS[widget](call) : call;
  return [
    ...(DEFINITIONS[widget] ?? []),
    ...(DEFINITIONS[widget] ? [""] : []),
    "$state {",
    ...state,
    "}",
    "",
    "widget sample() {",
    "    view {",
    ...indent(indent(view)),
    "    }",
    "}",
    "@@@",
    "@sample;",
    "",
  ].join("\n");
}

/** What the browser needs to report a widget's events: each event's parameter names, and its
 * `mut` inputs, each reported as `write<Input>`. */
export function reporting(widget, decls) {
  const w = decls.widgets.get(widget);
  return {
    widget,
    events: Object.fromEntries(w.events.map((e) => [e.name, { name: camel(e.name), params: e.params.map((p) => p.name) }])),
    writes: Object.fromEntries(w.inputs.filter((i) => i.mut).map((i) => [i.name, writeEvent(i.name)])),
  };
}
