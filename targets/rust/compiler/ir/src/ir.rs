// Written by xtmd-schemagen from schemas/ir.schema.json. Don't edit: change the schema, then run
// `cargo run -p xtmd-schemagen`.

#![allow(clippy::all)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// An object with nothing in it: `{}`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Empty {}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A prop that isn't constant: its value, and everything it reads.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub id: String,
    /// `cell:n`, `input:t.title`, `$state:spent`, `let:doc/open`, `extern:core/page.width`. Never too few.
    pub reads: Vec<String>,
    pub value: Expr,
}

/// Both ends are included; a missing one is open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high: Option<Expr>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low: Option<Expr>,
}

/// A call of a fn by its full name: one written in Extended Mark, an extern, or an interface's, which goes to the fn of the value's own type.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Call {
    pub args: Vec<Expr>,
    pub name: String,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub ty: Option<Type>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseDecl {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<Field>,
    pub name: String,
}

/// Opening an `opt`: `if (let …)` or `if (mut …)`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CondOpen {
    #[serde(rename = "mut")]
    pub mutable: bool,
    pub name: String,
    pub opt: Expr,
    #[serde(rename = "type")]
    pub ty: Type,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Cond {
    #[serde(rename = "cond")]
    Cond(Expr),
    #[serde(rename = "open")]
    Open(CondOpen),
}

/// What narrows a type. Every part that is given has to hold.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contract {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<Bounds>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub only: Vec<Expr>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<Bounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<Expr>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeclType {
    pub is: Type,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<TypeParam>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Decl {
    #[serde(rename = "record")]
    Record(Record),
    #[serde(rename = "enum")]
    Enum(Enum),
    #[serde(rename = "token")]
    Token(Token),
    #[serde(rename = "interface")]
    Interface(Interface),
    #[serde(rename = "fn")]
    Fn(FnDecl),
    #[serde(rename = "extern")]
    Extern(Extern),
    /// The document's one `$state` block.
    #[serde(rename = "$state")]
    State(State),
    #[serde(rename = "expose")]
    Expose(Expose),
    /// A top-level `let`: a constant, or a value worked out again when what it reads changes.
    #[serde(rename = "let")]
    Let(LetDecl),
    /// A type alias: another name for a type. A contract written after the alias's name adds to its own (`core/int` is `core/number` with step 1).
    #[serde(rename = "type")]
    Type(DeclType),
}

/// A declaration the page uses.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Declaration {
    pub declare: Decl,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enum {
    pub cases: Vec<CaseDecl>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    /// Its cases carry nothing, so they are ordered as written.
    pub ordered: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<TypeParam>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub name: String,
    pub params: Vec<Param>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExposeFns {
    pub body: Vec<Stmt>,
    pub name: String,
    pub params: Vec<Param>,
}

/// Fns the app may call, answering the extern channel of the same name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Expose {
    pub channel: String,
    pub fns: Vec<ExposeFns>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprRecord {
    pub fields: BTreeMap<String, Expr>,
    #[serde(rename = "type")]
    pub ty: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprCase {
    #[serde(rename = "enum")]
    pub enum_: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub values: BTreeMap<String, Expr>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprRange {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high: Option<Expr>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low: Option<Expr>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<Expr>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprTokval {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprTemplate {
    pub holes: Vec<Expr>,
    pub pieces: Vec<String>,
    #[serde(rename = "type")]
    pub ty: Type,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprField {
    pub name: String,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprApply {
    pub args: Vec<Expr>,
    #[serde(rename = "fn")]
    pub fn_: Expr,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub ty: Option<Type>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprOp {
    pub args: Vec<Expr>,
    pub name: OpName,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub ty: Option<Type>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprShow {
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprTry {
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExprWith {
    pub fields: BTreeMap<String, Expr>,
    pub value: Expr,
}

/// An expression. Values are expressions too.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Expr {
    #[serde(rename = "num")]
    Num(String),
    #[serde(rename = "text")]
    Text(String),
    #[serde(rename = "bool")]
    Bool(bool),
    #[serde(rename = "duration")]
    Duration(String),
    #[serde(rename = "list")]
    List(Vec<Expr>),
    /// A record made; its rules run when it is made.
    #[serde(rename = "record")]
    Record(ExprRecord),
    /// An enum's or a token's case, with its values.
    #[serde(rename = "case")]
    Case(ExprCase),
    #[serde(rename = "some")]
    Some(Box<Expr>),
    #[serde(rename = "none")]
    None(Empty),
    #[serde(rename = "range")]
    Range(Box<ExprRange>),
    /// A token, by its name. A target draws it with its own value.
    #[serde(rename = "token")]
    Token(String),
    /// A token made from a plain value, through its case that carries one: `stroke.PX(2.5)`.
    #[serde(rename = "tokval")]
    Tokval(Box<ExprTokval>),
    /// Inline Markdown, already parsed: a `core/rich_text`.
    #[serde(rename = "rich")]
    Rich(Rich),
    /// A literal with holes: a text when `type` is `core/text`, a `core/template` otherwise.
    #[serde(rename = "template")]
    Template(Box<ExprTemplate>),
    /// A view as a value: a description of a call, drawn where it is placed.
    #[serde(rename = "view")]
    View(ViewValue),
    #[serde(rename = "get")]
    Get(Get),
    /// A prop worked out by a binding.
    #[serde(rename = "bind")]
    Bind(String),
    #[serde(rename = "field")]
    Field(Box<ExprField>),
    #[serde(rename = "call")]
    Call(Box<Call>),
    /// A call of a fn held in a value.
    #[serde(rename = "apply")]
    Apply(Box<ExprApply>),
    #[serde(rename = "op")]
    Op(Box<ExprOp>),
    /// A value shown as text, as a hole shows it.
    #[serde(rename = "show")]
    Show(Box<ExprShow>),
    #[serde(rename = "fn")]
    Fn(Box<Lambda>),
    /// Where a `mut` argument writes.
    #[serde(rename = "place")]
    Place(Place),
    /// The value, or `none` when one of its contracts or rules fails.
    #[serde(rename = "try")]
    Try(Box<ExprTry>),
    #[serde(rename = "with")]
    With(Box<ExprWith>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternFn {
    /// The default body, run when the supplier gives none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub default: Vec<Stmt>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    pub params: Vec<Param>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<Type>,
    pub supplier: Supplier,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternChannelFns {
    pub name: String,
    pub params: Vec<Param>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<Type>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternChannel {
    pub fns: Vec<ExternChannelFns>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    pub supplier: Supplier,
    pub values: Vec<Field>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternType {
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<TypeParam>,
    pub supplier: Supplier,
}

/// Something supplied from outside Extended Mark.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Extern {
    /// An extern fn: native to every target (core's), a pack's, or the app's.
    #[serde(rename = "fn")]
    Fn(ExternFn),
    #[serde(rename = "widget")]
    Widget(ExternWidget),
    /// An extern block: values the app gives and fns Extended Mark calls.
    #[serde(rename = "channel")]
    Channel(ExternChannel),
    #[serde(rename = "type")]
    Type(ExternType),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternWidget {
    pub events: Vec<Event>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generics: Vec<TypeParam>,
    pub inputs: Vec<Field>,
    /// The levels drawing this widget needs: core.draw, or core.gfx for the canvas widgets.
    pub levels: Vec<Level>,
    /// What it writes as Markdown when nobody supplies it, or when the target only writes Markdown. Left out for Markdown's own blocks, which write themselves.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub markdown: Vec<Node>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    pub slots: Vec<Slot>,
    pub supplier: Supplier,
}

/// A record's field, a widget's input or own variable, or a `$state` field.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Expr>,
    #[serde(rename = "mut", default, skip_serializing_if = "is_false")]
    pub mutable: bool,
    pub name: String,
    #[serde(rename = "type")]
    pub ty: Type,
}

/// An IR file: one build.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct File {
    pub ir: Module,
}

/// A fn written in Extended Mark. One with no return type is an action.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FnDecl {
    pub body: Vec<Stmt>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generics: Vec<TypeParam>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    pub params: Vec<Param>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<Type>,
}

/// A read of something by name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Get {
    /// A local, a parameter or a loop variable.
    #[serde(rename = "local")]
    Local(String),
    /// An input of the widget the code is in.
    #[serde(rename = "input")]
    Input(String),
    /// A widget's own variable.
    #[serde(rename = "cell")]
    Cell(String),
    /// A field of the document's `$state`.
    #[serde(rename = "$state")]
    State(String),
    /// A top-level `let`, by its full name.
    #[serde(rename = "let")]
    Let(String),
    /// A named token: `core/space.S`.
    #[serde(rename = "token")]
    Token(String),
    /// A slot of the widget the code is in.
    #[serde(rename = "slot")]
    Slot(String),
    /// A value of an extern channel: `core/page.width`, `doc/scores.unit`.
    #[serde(rename = "extern")]
    Extern(String),
}

/// What runs when an event fires.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Handler {
    pub body: Vec<Stmt>,
    pub id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<Param>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Interface {
    pub events: Vec<Event>,
    pub fields: Vec<Field>,
    /// The names of its fns. A call of one is sent to the fn of the value's own type.
    pub fns: Vec<String>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<TypeParam>,
    pub widget: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lambda {
    pub body: Vec<Stmt>,
    pub params: Vec<Param>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<Type>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LetDecl {
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    /// What it reads, as in a binding; empty for a constant.
    pub reads: Vec<String>,
    #[serde(rename = "type")]
    pub ty: Type,
    pub value: Expr,
}

/// A level a target has (page 6): core.draw draws the extern widgets, core.live holds variables and runs events, core.gfx draws the canvas widgets. A target lists the ones it has, and a call, a widget or a page lists the ones it needs: none means its Markdown is enough.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Level {
    #[serde(rename = "core.draw")]
    CoreDraw,
    #[serde(rename = "core.live")]
    CoreLive,
    #[serde(rename = "core.gfx")]
    CoreGfx,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Local {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: Type,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Marks {
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<Expr>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub strike: bool,
}

/// One build: the document (or pack) with the parts of core and of the given packs it uses, checked and lowered, ready to run.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Module {
    pub bindings: Vec<Binding>,
    pub declarations: Vec<Declaration>,
    /// A document's YAML front matter, without its --- lines, passed to the app untouched (page 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub front_matter: Option<String>,
    pub handlers: Vec<Handler>,
    /// Every level the page needs: the union of its calls'.
    pub levels: Vec<Level>,
    /// `doc` for a document, or the pack's name.
    pub module: String,
    pub needs: Needs,
    pub templates: Vec<Template>,
    /// The IR's version. 0.3 writes 3.
    pub version: i64,
    /// The version of the compiler that wrote it.
    pub xtmd: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NeedsPacks {
    pub externs: Vec<String>,
    pub name: String,
    pub version: i64,
}

/// Every extern the page uses, by who supplies it. A target checks the list when it mounts the page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Needs {
    /// The document's own channels' fns and values, supplied by the app when it mounts the page.
    pub app: Vec<String>,
    /// core's externs, supplied by the target: widgets, fns and channels.
    pub core: Vec<String>,
    pub packs: Vec<NeedsPacks>,
}

/// An extern widget, drawn by the target.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeExtern {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub events: BTreeMap<String, String>,
    /// The levels this call needs (page 6), its slots' included.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub levels: Vec<Level>,
    pub name: String,
    pub props: BTreeMap<String, Expr>,
    pub site: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub slots: BTreeMap<String, Vec<Node>>,
    /// Where each `mut` input writes.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub writes: BTreeMap<String, Place>,
}

/// A widget written in Extended Mark.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeUse {
    pub args: BTreeMap<String, Expr>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub events: BTreeMap<String, String>,
    /// The levels this call needs (page 6), its slots' included.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub levels: Vec<Level>,
    pub name: String,
    pub site: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub slots: BTreeMap<String, Vec<Node>>,
}

/// Rows of a list follow their items; rows of a range are keyed by their number.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum NodeForKey {
    #[serde(rename = "item")]
    Item,
    #[serde(rename = "number")]
    Number,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeFor {
    pub body: Vec<Node>,
    /// Rows of a list follow their items; rows of a range are keyed by their number.
    pub key: NodeForKey,
    #[serde(rename = "mut")]
    pub mutable: bool,
    pub name: String,
    pub over: Expr,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    pub site: String,
    #[serde(rename = "type")]
    pub ty: Type,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeIfBranches {
    pub then: Vec<Node>,
    pub when: Cond,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeIf {
    pub branches: Vec<NodeIfBranches>,
    #[serde(rename = "else")]
    pub else_: Vec<Node>,
    pub site: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeMatchCases {
    pub then: Vec<Node>,
    pub when: Vec<Pattern>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeMatch {
    pub cases: Vec<NodeMatchCases>,
    #[serde(rename = "else", default, skip_serializing_if = "Vec::is_empty")]
    pub else_: Vec<Node>,
    pub site: String,
    pub value: Expr,
}

/// A view value or a slot, drawn here.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodePlace {
    pub site: String,
    pub view: Expr,
}

/// A `let` in a view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeDeclare {
    #[serde(rename = "let")]
    pub let_: Local,
}

/// A node of a template's view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Node {
    #[serde(rename = "extern")]
    Extern(NodeExtern),
    #[serde(rename = "use")]
    Use(NodeUse),
    #[serde(rename = "for")]
    For(NodeFor),
    #[serde(rename = "if")]
    If(NodeIf),
    #[serde(rename = "match")]
    Match(NodeMatch),
    #[serde(rename = "place")]
    Place(NodePlace),
    #[serde(rename = "declare")]
    Declare(NodeDeclare),
}

/// An operator, by its symbol. `-` with one argument negates; `?` takes a condition and two values.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum OpName {
    #[serde(rename = "+")]
    Plus,
    #[serde(rename = "-")]
    Minus,
    #[serde(rename = "*")]
    Times,
    #[serde(rename = "/")]
    Divide,
    #[serde(rename = "%")]
    Rem,
    #[serde(rename = "==")]
    Eq,
    #[serde(rename = "!=")]
    Ne,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Le,
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Ge,
    #[serde(rename = "&&")]
    And,
    #[serde(rename = "||")]
    Or,
    #[serde(rename = "!")]
    Not,
    #[serde(rename = "?")]
    Pick,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Param {
    #[serde(rename = "mut", default, skip_serializing_if = "is_false")]
    pub mutable: bool,
    pub name: String,
    #[serde(rename = "type")]
    pub ty: Type,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatternCase {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub binds: Vec<String>,
    #[serde(rename = "enum")]
    pub enum_: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Pattern {
    #[serde(rename = "case")]
    Case(PatternCase),
    #[serde(rename = "num")]
    Num(String),
    #[serde(rename = "text")]
    Text(String),
    #[serde(rename = "bool")]
    Bool(bool),
}

/// Where a write goes: a root and a path of fields and items.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Place {
    pub path: Vec<Step>,
    pub root: Root,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub fields: Vec<Field>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    /// Type parameters.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<TypeParam>,
    pub requires: Vec<Require>,
    /// The fn `==` and `!=` call, when the record's pack writes one. Left out, records compare field by field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same: Option<String>,
}

/// A rule, checked whenever a value it reads changes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Require {
    pub body: Vec<Stmt>,
    pub message: String,
    pub reads: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rich {
    pub segments: Vec<Segment>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Root {
    #[serde(rename = "local")]
    Local(String),
    #[serde(rename = "input")]
    Input(String),
    #[serde(rename = "cell")]
    Cell(String),
    #[serde(rename = "$state")]
    State(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum SegmentSegmentPart {
    #[serde(rename = "TEXT")]
    Text,
    #[serde(rename = "CODE")]
    Code,
    #[serde(rename = "MATH")]
    Math,
    #[serde(rename = "IMAGE")]
    Image,
    #[serde(rename = "NOTE")]
    Note,
    #[serde(rename = "BREAK")]
    Break,
    #[serde(rename = "VIEW")]
    View,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentSegment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<Expr>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marks: Option<Marks>,
    pub part: SegmentSegmentPart,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<Expr>,
    /// TEXT and CODE: the text; MATH: the `core/latex`; NOTE: the mark; VIEW: the view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Expr>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    pub segment: SegmentSegment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Slot {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: Type,
}

/// What a document's widgets share.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub fields: Vec<Field>,
    pub requires: Vec<Require>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepField {
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepItem {
    pub at: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Step {
    #[serde(rename = "field")]
    Field(StepField),
    #[serde(rename = "item")]
    Item(StepItem),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum StmtDeclare {
    #[serde(rename = "let")]
    Let(Local),
    #[serde(rename = "mut")]
    Mut(Local),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtSet {
    pub place: Place,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtReturn {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Expr>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtIfBranches {
    pub then: Vec<Stmt>,
    pub when: Cond,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtIf {
    pub branches: Vec<StmtIfBranches>,
    #[serde(rename = "else")]
    pub else_: Vec<Stmt>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtFor {
    pub body: Vec<Stmt>,
    #[serde(rename = "mut")]
    pub mutable: bool,
    pub name: String,
    pub over: Expr,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(rename = "type")]
    pub ty: Type,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtMatchCases {
    pub then: Vec<Stmt>,
    pub when: Vec<Pattern>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtMatch {
    pub cases: Vec<StmtMatchCases>,
    #[serde(rename = "else", default, skip_serializing_if = "Vec::is_empty")]
    pub else_: Vec<Stmt>,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtInvoke {
    pub args: Vec<Expr>,
    pub event: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StmtApply {
    pub args: Vec<Expr>,
    #[serde(rename = "fn")]
    pub fn_: Expr,
}

/// A statement of a fn, a handler or a rule.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Stmt {
    /// A local.
    #[serde(rename = "declare")]
    Declare(StmtDeclare),
    #[serde(rename = "set")]
    Set(StmtSet),
    #[serde(rename = "return")]
    Return(StmtReturn),
    #[serde(rename = "if")]
    If(StmtIf),
    /// `over` is a list, a range, or for `mut for` a place.
    #[serde(rename = "for")]
    For(StmtFor),
    #[serde(rename = "match")]
    Match(StmtMatch),
    #[serde(rename = "invoke")]
    Invoke(StmtInvoke),
    /// An action.
    #[serde(rename = "call")]
    Call(Call),
    /// An action held in a value.
    #[serde(rename = "apply")]
    Apply(StmtApply),
}

/// Who supplies an extern: the target (core's), the pack that declares it, or the app (a document's channels).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Supplier {
    #[serde(rename = "core")]
    Core,
    #[serde(rename = "pack")]
    Pack,
    #[serde(rename = "app")]
    App,
}

/// A widget written in Extended Mark, lowered: its view as nodes. The document's own view is the template `doc`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Template {
    /// Its own variables, each with its starting value.
    pub cells: Vec<Field>,
    pub events: Vec<Event>,
    pub fns: Vec<FnDecl>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generics: Vec<TypeParam>,
    pub inputs: Vec<Field>,
    /// The levels this widget needs wherever it is called: its own variables need core.live, and it needs every level its view's calls need.
    pub levels: Vec<Level>,
    /// Its markdown block, lowered onto core's extern Markdown blocks; built from the view for a document's widget that has none. Empty when it writes nothing.
    pub markdown: Vec<Node>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    pub requires: Vec<Require>,
    pub slots: Vec<Slot>,
    pub view: Vec<Node>,
}

/// A token type: an enum whose cases stand for values of one type.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Token {
    pub cases: Vec<CaseDecl>,
    /// A declaration's full name: its pack, a slash, its name (`core/date`, `doc/task`). A fn on a type adds a dot and the fn's name (`core/list.some`).
    pub name: String,
    /// The type of the value each case stands for.
    pub value: Type,
    /// Each named case's value, from the tokens blocks of the build. A target may give its own.
    pub values: BTreeMap<String, Expr>,
}

/// A type. `name` is a built-in type (`core/number`, `core/list`, …), a declared one (an alias among them), a type parameter (capitals), or `fn`, `record` or `any`, which use the parts that follow.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Type {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<Type>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<Contract>,
    /// For `record`: an inline record's fields.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<Field>,
    /// For `any`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface: Option<String>,
    pub name: String,
    /// For `fn`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<Param>,
    /// For `fn`; left out when it returns nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<Box<Type>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeParam {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bounds: Vec<String>,
    /// Capitals: `T`.
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewValue {
    pub args: BTreeMap<String, Expr>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub events: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub slots: BTreeMap<String, Vec<Node>>,
    pub widget: String,
}
