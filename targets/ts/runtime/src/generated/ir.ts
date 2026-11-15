// Written by mkp-schemagen from schemas/ir.schema.json. Don't edit: change the schema, then run
// `cargo run -p mkp-schemagen`.

/** A prop that isn't constant: its value, and everything it reads. */
export interface Binding {
  id: string;
  /** `cell:n`, `input:t.title`, `$state:spent`, `let:doc/open`, `extern:core/page.width`. Never too few. */
  reads: string[];
  value: Expr;
}

/** Both ends are included; a missing one is open. */
export interface Bounds {
  high?: Expr;
  low?: Expr;
}

/** A call of a fn by its full name: one written in MKP, an extern, or an interface's, which goes to the fn of the value's own type. */
export interface Call {
  args: Expr[];
  name: string;
  type?: Type;
}

export interface CaseDecl {
  fields?: Field[];
  name: string;
}

/** Opening an `opt`: `if (let …)` or `if (mut …)`. */
export interface CondOpen {
  mut: boolean;
  name: string;
  opt: Expr;
  type: Type;
}

export type Cond =
  | { cond: Expr }
  | { open: CondOpen };

/** What narrows a type. Every part that is given has to hold. */
export interface Contract {
  length?: Bounds;
  only?: Expr[];
  range?: Bounds;
  step?: Expr;
}

export interface DeclType {
  is: Type;
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  params?: TypeParam[];
}

export type Decl =
  | { record: Record }
  | { enum: Enum }
  | { token: Token }
  | { interface: Interface }
  | { fn: FnDecl }
  | { extern: Extern }
  | { "$state": State }
  | { expose: Expose }
  | { let: LetDecl }
  | { type: DeclType };

/** A declaration the page uses. */
export interface Declaration {
  declare: Decl;
}

export interface Enum {
  cases: CaseDecl[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  /** Its cases carry nothing, so they are ordered as written. */
  ordered: boolean;
  params?: TypeParam[];
}

export interface Event {
  name: string;
  params: Param[];
}

export interface ExposeFns {
  body: Stmt[];
  name: string;
  params: Param[];
}

/** Fns the app may call, answering the extern channel of the same name. */
export interface Expose {
  channel: string;
  fns: ExposeFns[];
}

export interface ExprRecord {
  fields: { [key: string]: Expr };
  type: string;
}

export interface ExprCase {
  enum: string;
  name: string;
  values?: { [key: string]: Expr };
}

export interface ExprRange {
  high?: Expr;
  low?: Expr;
  step?: Expr;
}

export interface ExprTokval {
  name: string;
  type: string;
  value: Expr;
}

export interface ExprTemplate {
  holes: Expr[];
  pieces: string[];
  type: Type;
}

export interface ExprField {
  name: string;
  value: Expr;
}

export interface ExprApply {
  args: Expr[];
  fn: Expr;
  type?: Type;
}

export interface ExprOp {
  args: Expr[];
  name: OpName;
  type?: Type;
}

export interface ExprShow {
  value: Expr;
}

export interface ExprTry {
  value: Expr;
}

export interface ExprWith {
  fields: { [key: string]: Expr };
  value: Expr;
}

/** An expression. Values are expressions too. */
export type Expr =
  | { num: string }
  | { text: string }
  | { bool: boolean }
  | { duration: string }
  | { list: Expr[] }
  | { record: ExprRecord }
  | { case: ExprCase }
  | { some: Expr }
  | { none: { [key: string]: never } }
  | { range: ExprRange }
  | { token: string }
  | { tokval: ExprTokval }
  | { rich: Rich }
  | { template: ExprTemplate }
  | { view: ViewValue }
  | { get: Get }
  | { bind: string }
  | { field: ExprField }
  | { call: Call }
  | { apply: ExprApply }
  | { op: ExprOp }
  | { show: ExprShow }
  | { fn: Lambda }
  | { place: Place }
  | { try: ExprTry }
  | { with: ExprWith };

export interface ExternFn {
  /** The default body, run when the supplier gives none. */
  default?: Stmt[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  params: Param[];
  returns?: Type;
  supplier: Supplier;
}

export interface ExternChannelFns {
  name: string;
  params: Param[];
  returns?: Type;
}

export interface ExternChannel {
  fns: ExternChannelFns[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  supplier: Supplier;
  values: Field[];
}

export interface ExternType {
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  params?: TypeParam[];
  supplier: Supplier;
}

/** Something supplied from outside MKP. */
export type Extern =
  | { fn: ExternFn }
  | { widget: ExternWidget }
  | { channel: ExternChannel }
  | { type: ExternType };

export interface ExternWidget {
  events: Event[];
  generics?: TypeParam[];
  inputs: Field[];
  /** The levels drawing this widget needs: core.draw, or core.gfx for the canvas widgets. */
  levels: Level[];
  /** What it writes as Markdown when nobody supplies it, or when the target only writes Markdown. Left out for Markdown's own blocks, which write themselves. */
  markdown?: Node[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  slots: Slot[];
  supplier: Supplier;
}

/** A record's field, a widget's input or own variable, or a `$state` field. */
export interface Field {
  default?: Expr;
  mut?: boolean;
  name: string;
  type: Type;
}

/** An IR file: one build. */
export interface File {
  ir: Module;
}

/** A fn written in MKP. One with no return type is an action. */
export interface FnDecl {
  body: Stmt[];
  generics?: TypeParam[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  params: Param[];
  returns?: Type;
}

/** A read of something by name. */
export type Get =
  | { local: string }
  | { input: string }
  | { cell: string }
  | { "$state": string }
  | { let: string }
  | { token: string }
  | { slot: string }
  | { extern: string };

/** What runs when an event fires. */
export interface Handler {
  body: Stmt[];
  id: string;
  params?: Param[];
}

export interface Interface {
  events: Event[];
  fields: Field[];
  /** The names of its fns. A call of one is sent to the fn of the value's own type. */
  fns: string[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  params?: TypeParam[];
  widget: boolean;
}

export interface Lambda {
  body: Stmt[];
  params: Param[];
  returns?: Type;
}

export interface LetDecl {
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  /** What it reads, as in a binding; empty for a constant. */
  reads: string[];
  type: Type;
  value: Expr;
}

/** A level a target has (page 6): core.draw draws the extern widgets, core.live holds variables and runs events, core.gfx draws the canvas widgets. A target lists the ones it has, and a call, a widget or a page lists the ones it needs: none means its Markdown is enough. */
export type Level = "core.draw" | "core.live" | "core.gfx";

export interface Local {
  name: string;
  type: Type;
  value: Expr;
}

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  link?: Expr;
  strike?: boolean;
}

/** One build: the document (or pack) with the parts of core and of the given packs it uses, checked and lowered, ready to run. */
export interface Module {
  bindings: Binding[];
  declarations: Declaration[];
  handlers: Handler[];
  /** Every level the page needs: the union of its calls'. */
  levels: Level[];
  /** The version of the compiler that wrote it. */
  mkp: string;
  /** `doc` for a document, or the pack's name. */
  module: string;
  needs: Needs;
  templates: Template[];
  /** The IR's version. 0.3 writes 3. */
  version: number;
}

export interface NeedsPacks {
  externs: string[];
  name: string;
  version: number;
}

/** Every extern the page uses, by who supplies it. A target checks the list when it mounts the page. */
export interface Needs {
  /** The document's own channels' fns and values, supplied by the app when it mounts the page. */
  app: string[];
  /** core's externs, supplied by the target: widgets, fns and channels. */
  core: string[];
  packs: NeedsPacks[];
}

/** An extern widget, drawn by the target. */
export interface NodeExtern {
  events?: { [key: string]: string };
  /** Its Markdown, for a target without its level or without the widget. */
  fallback?: Node[];
  /** The levels this call needs (page 6), its slots' included. */
  levels?: Level[];
  name: string;
  props: { [key: string]: Expr };
  site: string;
  slots?: { [key: string]: Node[] };
  /** Where each `mut` input writes. */
  writes?: { [key: string]: Place };
}

/** A widget written in MKP. */
export interface NodeUse {
  args: { [key: string]: Expr };
  events?: { [key: string]: string };
  fallback?: Node[];
  /** The levels this call needs (page 6), its slots' included. */
  levels?: Level[];
  name: string;
  site: string;
  slots?: { [key: string]: Node[] };
}

/** Rows of a list follow their items; rows of a range are keyed by their number. */
export type NodeForKey = "item" | "number";

export interface NodeFor {
  body: Node[];
  /** Rows of a list follow their items; rows of a range are keyed by their number. */
  key: NodeForKey;
  mut: boolean;
  name: string;
  over: Expr;
  position?: string;
  site: string;
  type: Type;
}

export interface NodeIfBranches {
  then: Node[];
  when: Cond;
}

export interface NodeIf {
  branches: NodeIfBranches[];
  else: Node[];
  site: string;
}

export interface NodeMatchCases {
  then: Node[];
  when: Pattern[];
}

export interface NodeMatch {
  cases: NodeMatchCases[];
  else?: Node[];
  site: string;
  value: Expr;
}

/** A view value or a slot, drawn here. */
export interface NodePlace {
  site: string;
  view: Expr;
}

/** A `let` in a view. */
export interface NodeDeclare {
  let: Local;
}

/** A node of a template's view. */
export type Node =
  | { extern: NodeExtern }
  | { use: NodeUse }
  | { for: NodeFor }
  | { if: NodeIf }
  | { match: NodeMatch }
  | { place: NodePlace }
  | { declare: NodeDeclare };

/** An operator, by its symbol. `-` with one argument negates; `?` takes a condition and two values. */
export type OpName = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||" | "!" | "?";

export interface Param {
  mut?: boolean;
  name: string;
  type: Type;
}

export interface PatternCase {
  binds?: string[];
  enum: string;
  name: string;
}

export type Pattern =
  | { case: PatternCase }
  | { num: string }
  | { text: string }
  | { bool: boolean };

/** Where a write goes: a root and a path of fields and items. */
export interface Place {
  path: Step[];
  root: Root;
}

export interface Record {
  fields: Field[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  /** Type parameters. */
  params?: TypeParam[];
  requires: Require[];
  /** The fn `==` and `!=` call, when the record's pack writes one. Left out, records compare field by field. */
  same?: string;
}

/** A rule, checked whenever a value it reads changes. */
export interface Require {
  body: Stmt[];
  message: string;
  reads: string[];
}

export interface Rich {
  segments: Segment[];
}

export type Root =
  | { local: string }
  | { input: string }
  | { cell: string }
  | { "$state": string };

export type SegmentSegmentPart = "TEXT" | "CODE" | "MATH" | "IMAGE" | "NOTE" | "BREAK" | "VIEW";

export interface SegmentSegment {
  alt?: Expr;
  marks?: Marks;
  part: SegmentSegmentPart;
  src?: Expr;
  /** TEXT and CODE: the text; MATH: the `core/latex`; NOTE: the mark; VIEW: the view. */
  value?: Expr;
}

export interface Segment {
  segment: SegmentSegment;
}

export interface Slot {
  name: string;
  type: Type;
}

/** What a document's widgets share. */
export interface State {
  fields: Field[];
  requires: Require[];
}

export interface StepField {
  name: string;
}

export interface StepItem {
  at: Expr;
}

export type Step =
  | { field: StepField }
  | { item: StepItem };

export type StmtDeclare =
  | { let: Local }
  | { mut: Local };

export interface StmtSet {
  place: Place;
  value: Expr;
}

export interface StmtReturn {
  value?: Expr;
}

export interface StmtIfBranches {
  then: Stmt[];
  when: Cond;
}

export interface StmtIf {
  branches: StmtIfBranches[];
  else: Stmt[];
}

export interface StmtFor {
  body: Stmt[];
  mut: boolean;
  name: string;
  over: Expr;
  position?: string;
  type: Type;
}

export interface StmtMatchCases {
  then: Stmt[];
  when: Pattern[];
}

export interface StmtMatch {
  cases: StmtMatchCases[];
  else?: Stmt[];
  value: Expr;
}

export interface StmtInvoke {
  args: Expr[];
  event: string;
}

export interface StmtApply {
  args: Expr[];
  fn: Expr;
}

/** A statement of a fn, a handler or a rule. */
export type Stmt =
  | { declare: StmtDeclare }
  | { set: StmtSet }
  | { return: StmtReturn }
  | { if: StmtIf }
  | { for: StmtFor }
  | { match: StmtMatch }
  | { invoke: StmtInvoke }
  | { call: Call }
  | { apply: StmtApply };

/** Who supplies an extern: the target (core's), the pack that declares it, or the app (a document's channels). */
export type Supplier = "core" | "pack" | "app";

/** A widget written in MKP, lowered: its view as nodes. The document's own view is the template `doc`. */
export interface Template {
  /** Its own variables, each with its starting value. */
  cells: Field[];
  events: Event[];
  fns: FnDecl[];
  generics?: TypeParam[];
  inputs: Field[];
  /** The levels this widget needs wherever it is called: its own variables need core.live, and it needs every level its view's calls need. */
  levels: Level[];
  /** Its markdown block, lowered onto core's extern Markdown blocks; built from the view for a document's widget that has none. Empty when it writes nothing. */
  markdown: Node[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  requires: Require[];
  slots: Slot[];
  view: Node[];
}

/** A token type: an enum whose cases stand for values of one type. */
export interface Token {
  cases: CaseDecl[];
  /** A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`). */
  name: string;
  /** The type of the value each case stands for. */
  value: Type;
  /** Each named case's value, from the tokens blocks of the build. A target may give its own. */
  values: { [key: string]: Expr };
}

/** A type. `name` is a built-in type (`core/number`, `core/list`, …), a declared one (an alias among them), a type parameter (capitals), or `fn`, `record` or `any`, which use the parts that follow. */
export interface Type {
  args?: Type[];
  contract?: Contract;
  /** For `record`: an inline record's fields. */
  fields?: Field[];
  /** For `any`. */
  interface?: string;
  name: string;
  /** For `fn`. */
  params?: Param[];
  /** For `fn`; left out when it returns nothing. */
  returns?: Type;
}

export interface TypeParam {
  bounds?: string[];
  /** Capitals: `T`. */
  name: string;
}

export interface ViewValue {
  args: { [key: string]: Expr };
  events?: { [key: string]: string };
  slots?: { [key: string]: Node[] };
  widget: string;
}
