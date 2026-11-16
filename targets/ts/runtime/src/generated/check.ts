// Written by mkp-schemagen from schemas/check.schema.json. Don't edit: change the schema, then run
// `cargo run -p mkp-schemagen`.

import type { Expr, Level } from "./ir.js";

export interface ActionEvent {
  args?: Expr[];
  name: string;
  site: string;
}

export interface ActionWrite {
  input: string;
  site: string;
  /** A value, in the IR's form. */
  value: Expr;
}

export interface ActionSet {
  "$state": { [key: string]: Expr };
}

export interface ActionExpose {
  args?: Expr[];
  channel: string;
  name: string;
}

export interface ActionExtern {
  channel: string;
  values: { [key: string]: Expr };
}

/** What a step does to the page. */
export type Action =
  | { event: ActionEvent }
  | { write: ActionWrite }
  | { set: ActionSet }
  | { expose: ActionExpose }
  | { extern: ActionExtern }
  | { page: Page };

/** The result of `advertise`. */
export interface Advertised {
  levels: Level[];
  name: string;
  protocol: string;
  /** The extern widgets and fns it draws or runs. */
  supplies: string[];
}

export interface BlockHeading {
  inline: Inline[];
  level: number;
}

export interface BlockBulletsItems {
  blocks: Block[];
  done?: boolean;
}

export interface BlockBullets {
  items: BlockBulletsItems[];
  ordered: boolean;
  start?: number;
}

export interface BlockCode {
  lang: string;
  src: string;
}

export type BlockTableAlign = "START" | "CENTER" | "END";

export interface BlockTable {
  align: BlockTableAlign[];
  head: Inline[][];
  rows: Inline[][][];
}

export interface BlockFootnote {
  blocks: Block[];
  mark: string;
}

/** A Markdown block, as the runner reads the page. */
export type Block =
  | { paragraph: Inline[] }
  | { heading: BlockHeading }
  | { bullets: BlockBullets }
  | { quote: Block[] }
  | { code: BlockCode }
  | { math: string }
  | { table: BlockTable }
  | { footnote: BlockFootnote }
  | { divider: { [key: string]: never } };

/** Where a `spot` landed, in its plane's units. */
export interface Box {
  from: Point;
  to: Point;
}

/** A rule that failed: a `require`'s message, or a contract's code, and where. */
export interface Broken {
  code?: string;
  rule?: string;
  site?: string;
}

export interface CallCall {
  args: Expr[];
  name: string;
}

/** An extern fn the step called, with its arguments. */
export interface Call {
  call: CallCall;
}

/** What the compiler gives: its diagnostics, and the page's Markdown with its starting values. */
export interface CaseExpect {
  diagnostics: Diagnostic[];
  /** The page's Markdown with its starting values, as `mkp md` writes it, before any step. */
  markdown?: MarkdownExpected;
}

export interface CaseTarget {
  levels: Level[];
}

/** A target check: a source, the diagnostics it gives, and what every target must show after each step. */
export interface Case {
  about?: string;
  /** What the compiler gives: its diagnostics, and the page's Markdown with its starting values. */
  expect: CaseExpect;
  /** `group.name`, unique. */
  id: string;
  /** Packs to build with, beside the case. */
  packs?: string[];
  page?: Page;
  /** The .mkp.md or .mkp file, beside the case. */
  source: string;
  steps?: Step[];
  target?: CaseTarget;
}

export type DiagnosticSeverity = "error" | "warning";

/** A diagnostic, by its code and where it starts. Messages are never compared. */
export interface Diagnostic {
  code: string;
  /** Counted in characters, from 1. */
  column: number;
  line: number;
  severity?: DiagnosticSeverity;
}

export interface ExpectedShadedSamples {
  at: Expr;
  pixel: Expr;
}

export interface ExpectedShaded {
  args: Expr;
  samples?: ExpectedShadedSamples[];
  shader: string;
}

export interface ExpectedTree {
  props?: { [key: string]: Expr };
  slots?: { [key: string]: string[] };
  widget?: string;
}

/** Only what a step states is compared with the case; every target's whole observation is compared with every other's. */
export interface Expected {
  boxes?: { [key: string]: Box };
  calls?: Call[];
  markdown?: MarkdownExpected;
  outcome?: Outcome;
  /** Each shade drawn, by site: the fn it was given, by name ("" for a lambda), and its arguments; on the test target also the colour at the area's two corners and its middle, worked out by the shader. */
  shaded?: { [key: string]: ExpectedShaded };
  state?: { [key: string]: Expr };
  tree?: { [key: string]: ExpectedTree };
}

export interface InlineText {
  bold?: boolean;
  italic?: boolean;
  link?: string;
  strike?: boolean;
  value: string;
}

export interface InlineImage {
  alt: string;
  src: string;
}

export type Inline =
  | { text: InlineText }
  | { code: string }
  | { math: string }
  | { image: InlineImage }
  | { note: string }
  | { break: { [key: string]: never } };

/** The params of `load`: the IR the mkp binary wrote for the case, and the page. */
export interface Load {
  externs?: { [key: string]: { [key: string]: Expr } };
  /** A path to the .ir.json file. */
  ir: string;
  page?: Page;
  state?: { [key: string]: Expr };
}

export type MarkdownExpected =
  | { blocks: Block[] }
  | { has: Block[] }
  | { file: string };

export interface Mounted {
  props: { [key: string]: Expr };
  /** Each slot's children, by site, in order. */
  slots?: { [key: string]: string[] };
  widget: string;
}

export interface ObservationShadedSamples {
  at: Expr;
  pixel: Expr;
}

export interface ObservationShaded {
  args: Expr;
  samples?: ObservationShadedSamples[];
  shader: string;
}

/** Everything MKP decides about the page, after a step. */
export interface Observation {
  boxes?: { [key: string]: Box };
  calls: Call[];
  /** The page as Markdown, which the runner reads as blocks. */
  markdown: string;
  outcome: Outcome;
  /** Each shade drawn, by site: the fn it was given, by name ("" for a lambda), and its arguments; on the test target also the colour at the area's two corners and its middle, worked out by the shader. */
  shaded?: { [key: string]: ObservationShaded };
  state: { [key: string]: Expr };
  /** The mounted extern widgets, by site. */
  tree: { [key: string]: Mounted };
}

export interface Outcome {
  failures?: Broken[];
  refused?: Broken[];
}

export type PageTheme = "LIGHT" | "DARK";

export type PageWidth = "NARROW" | "MEDIUM" | "WIDE";

/** What the app tells the page about where it is read. */
export interface Page {
  now?: string;
  theme?: PageTheme;
  today?: string;
  width?: PageWidth;
}

export interface Point {
  x: Expr;
  y: Expr;
}

export type RequestMethod = "advertise" | "load" | "event" | "write" | "set" | "expose" | "extern" | "page" | "observe" | "quit";

/** A JSON-RPC 2.0 request from `mkp target check` to a target's check adapter, one per line on its standard input. */
export interface Request {
  id: number;
  jsonrpc: string;
  method: RequestMethod;
  params?: unknown;
}

export interface ResponseError {
  code: number;
  message: string;
}

/** The adapter's reply, on its standard output only; logs go to standard error. */
export interface Response {
  error?: ResponseError;
  id: number;
  jsonrpc: string;
  result?: unknown;
}

export interface Step {
  do: Action;
  expect?: Expected;
}
