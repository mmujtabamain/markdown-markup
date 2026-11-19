// Markdown out (page 1, plan tab 13): the page written as Markdown with the values it has now, in
// one spelling for each block and mark. A port of targets/rust/compiler/markdown, reading the
// live page: `$state`, the page's values and each widget's own variables as they are.

import type * as ir from "./generated/ir.js";
import { Failure, type Binding } from "./eval/index.js";
import { none, toIr, type Value as V } from "./eval/value.js";
import { type Env, Page, setMarkdownWriter } from "./page.js";

export type Inline =
  | { text: { value: string; bold?: boolean; italic?: boolean; strike?: boolean; link?: string } }
  | { code: string }
  | { math: string }
  | { image: { src: string; alt: string } }
  | { note: string }
  | { break: Record<string, never> };

export interface Item {
  done?: boolean;
  blocks: Block[];
}

export type Block =
  | { paragraph: Inline[] }
  | { heading: { level: number; inline: Inline[] } }
  | { bullets: { ordered: boolean; start?: number; items: Item[] } }
  | { quote: Block[] }
  | { code: { lang: string; src: string } }
  | { math: string }
  | { table: { head: Inline[][]; rows: Inline[][][]; align: ("START" | "CENTER" | "END")[] } }
  | { footnote: { mark: string; blocks: Block[] } }
  | { divider: Record<string, never> };

type Piece = { block: Block } | { item: Item };

function field(v: V | undefined, name: string): V | undefined {
  if (!v) return undefined;
  if (v.kind === "record") return v.fields.find(([k]) => k === name)?.[1];
  if (v.kind === "case") return v.values.find(([k]) => k === name)?.[1];
  return undefined;
}

function textOf(v: V | undefined): string {
  if (!v) return "";
  if (v.kind === "text") return v.s;
  if (v.kind === "num") return v.n.show();
  if (v.kind === "opt") return textOf(v.value ?? undefined);
  return "";
}

function itemsOf(v: V | undefined): V[] {
  return v && v.kind === "list" ? v.items.map((i) => i.value) : [];
}

/** A template's text: its pieces with each hole's shown text between them. */
function templateText(v: V | undefined): string {
  const pieces = itemsOf(field(v, "pieces"));
  const holes = itemsOf(field(v, "holes"));
  return pieces.map((p, k) => textOf(p) + (holes[k] ? textOf(field(holes[k], "value")) : "")).join("");
}

/** Runs that follow one another with the same marks are one run. */
function joinRuns(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && "text" in last && "text" in r) {
      const a = last.text, b = r.text;
      if (!!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && a.link === b.link) {
        a.value += b.value;
        continue;
      }
    }
    if ("text" in r && r.text.value === "") continue;
    out.push(r);
  }
  return out;
}

/** List items that follow one another make one list, across a loop's turns too (page 3). */
function blocksOf(pieces: Piece[]): Block[] {
  const out: Block[] = [];
  for (const p of pieces) {
    const b: Block = "block" in p ? p.block : { bullets: { ordered: false, items: [p.item] } };
    const last = out[out.length - 1];
    if (last && "bullets" in last && "bullets" in b && last.bullets.ordered === b.bullets.ordered) {
      last.bullets.items.push(...b.bullets.items);
      continue;
    }
    out.push(b);
  }
  return out;
}

function join(path: string, part: string): string {
  return path ? `${path}/${part}` : part;
}

class Writer {
  depth = 0;
  constructor(private readonly page: Page) {}

  nodes(nodes: ir.Node[], env0: Env): Piece[] {
    let env = env0;
    const out: Piece[] = [];
    for (const n of nodes) {
      if ("declare" in n) {
        const l = n.declare.let;
        env = { ...env, bindings: [...env.bindings, [l.name, { value: this.page.evalIn(env, l.value) }]] };
      } else if ("for" in n) {
        // rows by position for paths, and by item for identity, as drawing walks them
        this.page.keyedRows(n.for, env).forEach((row, k) =>
          out.push(...this.nodes(n.for.body, { owner: env.owner, bindings: [...env.bindings, ...row.bindings], path: join(env.path, `${n.for.site}[${k}]`), key: join(env.key ?? env.path, `${n.for.site}[${row.key}]`) })),
        );
      } else if ("if" in n) {
        const b = this.page.pickBranch(n.if, env);
        if (b) out.push(...this.nodes(b.nodes, b.env));
      } else if ("match" in n) {
        const v = this.page.evalIn(env, n.match.value);
        let done = false;
        for (const c of n.match.cases) {
          const binds = this.page.matches(v, c.when);
          if (binds) {
            out.push(...this.nodes(c.then, { ...env, bindings: [...env.bindings, ...binds] }));
            done = true;
            break;
          }
        }
        if (!done) out.push(...this.nodes(n.match.else ?? [], env));
      } else if ("place" in n) {
        out.push(...this.view(this.page.evalIn(env, n.place.view), env, `${env.path ? env.path + "/" : ""}${n.place.site}`));
      } else if ("extern" in n) {
        const props = new Map<string, V>();
        for (const [k, e] of Object.entries(n.extern.props)) props.set(k, this.page.evalIn(env, e));
        for (const [k, p] of Object.entries(n.extern.writes ?? {})) props.set(k, this.page.machine.evalWith(env.bindings, env.owner, { place: p } as ir.Expr));
        out.push(...this.widget(n.extern.name, `${env.path ? env.path + "/" : ""}${n.extern.site}`, props, {}, n.extern.slots ?? {}, env));
      } else if ("use" in n) {
        out.push(...this.widget(n.use.name, join(env.path, n.use.site), new Map(), n.use.args, n.use.slots ?? {}, env, join(env.key ?? env.path, n.use.site), n.use.events ?? {}));
      }
    }
    return out;
  }

  view(v: V, env: Env, path: string): Piece[] {
    if (v.kind === "opt") return v.value ? this.view(v.value, env, path) : [];
    if (v.kind === "list") return v.items.flatMap((i, k) => this.view(i.value, env, `${path}[${k}]`));
    if (v.kind !== "view") return [];
    if (v.widget === "#slot") {
      const id = v.args.get("id");
      const held = id && id.kind === "num" ? this.page.heldSlot(Number(id.n.show())) : undefined;
      return held ? this.nodes(held.nodes, held.env) : [];
    }
    const made: Env = { owner: v.owner, bindings: [...v.captured] as [string, Binding][], path: env.path };
    // its arguments as drawing gives them, so a widget written in Extended Mark gets its inputs
    const args = Object.fromEntries([...v.args].map(([k, x]) => [k, toIr(x)]));
    return this.widget(v.widget, path, new Map(v.args), args, v.slots as Record<string, ir.Node[]>, made, path, v.events as Record<string, string>);
  }

  slot(slots: Record<string, ir.Node[]>, name: string, env: Env): Piece[] {
    return slots[name] ? this.nodes(slots[name], env) : [];
  }

  /** A widget: Markdown's own blocks are written directly; any other widget writes its markdown. */
  /** `key` and `events` are the call's, as drawing gives them: entering a widget to write its
   * Markdown must find the instance the page drew and leave it as it was. */
  widget(name: string, path: string, props: Map<string, V>, args: Record<string, ir.Expr>, slots: Record<string, ir.Node[]>, env: Env, key: string = path, events: Record<string, string> = {}): Piece[] {
    if (++this.depth > 64) {
      this.depth--;
      throw new Failure("Limit", `${name} places itself more than 64 deep`);
    }
    try {
      return this.widgetInner(name, path, props, args, slots, env, key, events);
    } catch (f) {
      if (name.startsWith("core/") && !this.page.templateOf(name)) throw f;
      if (this.page.defect("no-notice")) return [];
      // a widget that fails is a notice in its place, a quote in Markdown (page 6)
      const msg = f instanceof Error ? f.message : String(f);
      return [{ block: { quote: [{ paragraph: [{ text: { value: `${name.split("/").pop()} failed: ${msg}` } }] }] } }];
    } finally {
      this.depth--;
    }
  }

  private widgetInner(name: string, path: string, props: Map<string, V>, args: Record<string, ir.Expr>, slots: Record<string, ir.Node[]>, env: Env, key: string, events: Record<string, string>): Piece[] {
    const p = (k: string) => props.get(k);
    switch (name) {
      case "core/paragraph": {
        const runs = this.inline(p("value"));
        return runs.length ? [{ block: { paragraph: runs } }] : [];
      }
      case "core/heading": {
        const l = p("level");
        const level = l && l.kind === "num" ? Math.min(6, Math.max(1, Number(l.n.show()))) : 1;
        return [{ block: { heading: { level, inline: this.inline(p("value")) } } }];
      }
      case "core/bullets": {
        const o = p("ordered");
        const ordered = !!o && o.kind === "bool" && o.b;
        const s = p("start");
        const start = s && s.kind === "num" ? Number(s.n.show()) : 1;
        const items: Item[] = this.slot(slots, "items", env).map((x) => ("item" in x ? x.item : { blocks: [x.block] }));
        if (!items.length) return [];
        return [{ block: { bullets: ordered ? { ordered, start, items } : { ordered, items } } }];
      }
      case "core/item": {
        const d = p("done");
        const done = d && d.kind === "opt" && d.value && d.value.kind === "bool" ? d.value.b : d && d.kind === "bool" ? d.b : undefined;
        const item: Item = { blocks: blocksOf(this.slot(slots, "body", env)) };
        if (done !== undefined) item.done = done;
        return [{ item }];
      }
      case "core/quote":
        return [{ block: { quote: blocksOf(this.slot(slots, "body", env)) } }];
      case "core/code":
        return [{ block: { code: { lang: textOf(p("lang")), src: textOf(p("src")) } } }];
      case "core/math":
        return [{ block: { math: templateText(field(p("tex"), "tex")) } }];
      case "core/divider":
        return [{ block: { divider: {} } }];
      case "core/footnote":
        return [{ block: { footnote: { mark: textOf(p("mark")), blocks: blocksOf(this.slot(slots, "body", env)) } } }];
      case "core/table": {
        const head = itemsOf(p("head")).map((c) => this.inline(c));
        const rows = itemsOf(p("rows")).map((r) => itemsOf(r).map((c) => this.inline(c)));
        const align = itemsOf(p("align")).map((a) => (a.kind === "case" && (a.name === "CENTER" || a.name === "END") ? a.name : "START")) as ("START" | "CENTER" | "END")[];
        return [{ block: { table: { head, rows, align } } }];
      }
    }
    const t = this.page.templateOf(name);
    if (t) {
      // a widget written in Extended Mark: its markdown, in its instance
      const own = this.page.enterUse(t, path, args, slots, events, env, key);
      return this.nodes(t.markdown, own);
    }
    const w = this.page.externWidget(name);
    if (w) {
      const own = this.page.enterExtern(w, path, props, slots, env);
      try {
        return this.nodes(w.markdown ?? [], own);
      } finally {
        this.page.leave(own);
      }
    }
    throw new Failure("Ir", `there is no widget ${name} to write`);
  }

  /** A rich text's segments as runs; a view in a sentence puts its own Markdown's text there. */
  inline(v: V | undefined): Inline[] {
    const out: Inline[] = [];
    for (const seg of itemsOf(field(v, "segments"))) {
      const part = field(seg, "part");
      if (!part || part.kind !== "case") continue;
      const marks = field(seg, "marks");
      const flag = (n: string) => {
        const x = field(marks, n);
        return !!x && x.kind === "bool" && x.b;
      };
      const l = field(marks, "link");
      const link = l && l.kind === "opt" && l.value ? textOf(l.value) : undefined;
      const text = (value: string): Inline => {
        const t: { value: string; bold?: boolean; italic?: boolean; strike?: boolean; link?: string } = { value };
        if (flag("bold")) t.bold = true;
        if (flag("italic")) t.italic = true;
        if (flag("strike")) t.strike = true;
        if (link !== undefined) t.link = link;
        return { text: t };
      };
      switch (part.name) {
        case "TEXT":
          out.push(text(textOf(field(part, "value"))));
          break;
        case "CODE":
          out.push({ code: textOf(field(part, "value")) });
          break;
        case "MATH":
          out.push({ math: templateText(field(field(part, "tex"), "tex")) });
          break;
        case "IMAGE":
          out.push({ image: { src: textOf(field(part, "src")), alt: textOf(field(part, "alt")) } });
          break;
        case "NOTE":
          out.push({ note: textOf(field(part, "mark")) });
          break;
        case "BREAK":
          out.push({ break: {} });
          break;
        case "VIEW": {
          const blocks = blocksOf(this.view(field(part, "child") ?? none(), { owner: undefined, bindings: [], path: "" }, ""));
          out.push(text(blocks.map(plain).filter((s) => s).join(" ")));
          break;
        }
      }
    }
    return joinRuns(out);
  }
}

function plain(b: Block): string {
  const runs = (r: Inline[]) => r.map((i) => ("text" in i ? i.text.value : "code" in i ? i.code : "math" in i ? i.math : "image" in i ? i.image.alt : "")).join("");
  if ("paragraph" in b) return runs(b.paragraph);
  if ("heading" in b) return runs(b.heading.inline);
  if ("quote" in b) return b.quote.map(plain).join(" ");
  return "";
}

/** The page's blocks, with the values it has now. */
export function pageBlocks(page: Page): Block[] {
  const doc = page.templateOf("doc");
  if (!doc) return [];
  return blocksOf(new Writer(page).nodes(doc.markdown, { owner: undefined, bindings: [], path: "" }));
}

// ---- the one spelling (page 1, Markdown out)

let unescaped = false;

function escape(s: string, lineStart: boolean): string {
  if (unescaped) return s;
  let out = "";
  let atStart = lineStart;
  const chars = [...s];
  chars.forEach((c, k) => {
    const before = chars.slice(0, k).join("");
    let esc = "\\`*_~[]<>$|&".includes(c) || (atStart && "#-+=@}!".includes(c));
    if (c === ":" && /(https?|ftp)$/.test(before)) esc = true;
    if (c === "." && /www$/i.test(before)) esc = true;
    if ((c === "." || c === ")") && lineStart && before.length > 0 && /^[0-9]+$/.test(before)) esc = true;
    if (esc) out += "\\";
    out += c;
    if (c === "\n") atStart = true;
    else if (!(c === " " && atStart)) atStart = false;
  });
  return out;
}

function codeSpan(c: string): string {
  let ticks = 1;
  while (c.includes("`".repeat(ticks))) ticks++;
  const fence = "`".repeat(ticks);
  const pad = c.startsWith("`") || c.endsWith("`") || (c.startsWith(" ") && c.endsWith(" ") && c.trim() !== "") ? " " : "";
  return fence + pad + c + pad + fence;
}

export function writeInline(runs: Inline[]): string {
  let out = "";
  for (const r of runs) {
    const first = out === "";
    if ("text" in r) {
      let t = escape(r.text.value, first);
      if (r.text.italic) t = `*${t}*`;
      if (r.text.bold) t = `**${t}**`;
      if (r.text.strike) t = `~~${t}~~`;
      if (r.text.link !== undefined) t = `[${t}](<${r.text.link.replace(/</g, "%3C").replace(/>/g, "%3E")}>)`;
      out += t;
    } else if ("code" in r) out += codeSpan(r.code);
    else if ("math" in r) out += `$${r.math}$`;
    else if ("image" in r) out += `![${escape(r.image.alt, false)}](<${r.image.src}>)`;
    else if ("note" in r) out += `[^${r.note}]`;
    else out += "\\\n";
  }
  return out;
}

function indent(text: string, first: string, rest: string): string {
  return (
    text
      .split("\n")
      .filter((_, k, all) => k < all.length - 1 || all[k] !== "")
      .map((line, k) => {
        const prefix = k === 0 ? first : rest;
        return line === "" ? prefix.trimEnd() : prefix + line;
      })
      .join("\n") + "\n"
  );
}

function writeBlock(b: Block): string {
  if ("paragraph" in b) return writeInline(b.paragraph) + "\n";
  if ("heading" in b) return `${"#".repeat(b.heading.level)} ${writeInline(b.heading.inline)}\n`;
  if ("bullets" in b) {
    const { ordered, items } = b.bullets;
    const start = b.bullets.start ?? 1;
    const loose = items.some((i) => i.blocks.length > 1);
    return items
      .map((it, k) => {
        const marker = ordered ? `${start + k}. ` : "- ";
        const task = it.done === true ? "[x] " : it.done === false ? "[ ] " : "";
        const body = writeBlocks(it.blocks) || "\n";
        return indent(body, marker + task, " ".repeat(marker.length)) + (loose && k + 1 < items.length ? "\n" : "");
      })
      .join("");
  }
  if ("quote" in b) return indent(writeBlocks(b.quote), "> ", "> ");
  if ("code" in b) {
    let ticks = 3;
    while (b.code.src.includes("`".repeat(ticks))) ticks++;
    const fence = "`".repeat(ticks);
    const src = b.code.src.endsWith("\n") || b.code.src === "" ? b.code.src : b.code.src + "\n";
    return `${fence}${b.code.lang}\n${src}${fence}\n`;
  }
  if ("math" in b) return `$$\n${b.math.trimEnd()}\n$$\n`;
  if ("divider" in b) return "---\n";
  if ("table" in b) {
    const cell = (c: Inline[]) => writeInline(c).replace(/\|/g, "\\|");
    const { head, rows, align } = b.table;
    const rule = head.map((_, k) => (align[k] === "CENTER" ? ":---:" : align[k] === "END" ? "---:" : "---"));
    return [`| ${head.map(cell).join(" | ")} |`, `| ${rule.join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n") + "\n";
  }
  return indent(writeBlocks(b.footnote.blocks), `[^${b.footnote.mark}]: `, "    ");
}

function writeBlocks(blocks: Block[]): string {
  return blocks.map(writeBlock).join("\n");
}

/** The page as Markdown text: its blocks, then its footnotes at the end. */
export function writeMarkdown(blocks: Block[]): string {
  const notes = blocks.filter((b) => "footnote" in b);
  const rest = blocks.filter((b) => !("footnote" in b));
  return [...rest, ...notes].map(writeBlock).join("\n");
}

setMarkdownWriter((page) => {
  // the test target's defect: text written as it is, so Markdown's own characters in it change the page
  unescaped = page.defect("unescaped-markdown");
  try {
    return writeMarkdown(pageBlocks(page));
  } finally {
    unescaped = false;
  }
});
