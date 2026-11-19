// Written by xtmd-schemagen from schemas/check.schema.json. Don't edit: change the schema, then run
// `cargo run -p xtmd-schemagen`.

#![allow(clippy::all)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::ir::Empty;

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionEvent {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<crate::ir::Expr>,
    pub name: String,
    pub site: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionWrite {
    pub input: String,
    pub site: String,
    /// A value, in the IR's form.
    pub value: crate::ir::Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionSet {
    #[serde(rename = "$state")]
    pub state: BTreeMap<String, crate::ir::Expr>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionExpose {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<crate::ir::Expr>,
    pub channel: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionExtern {
    pub channel: String,
    pub values: BTreeMap<String, crate::ir::Expr>,
}

/// What a step does to the page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Action {
    /// A reader's event on a widget, by its site.
    #[serde(rename = "event")]
    Event(ActionEvent),
    /// A widget writing one of its `mut` inputs, as a slider or a field does.
    #[serde(rename = "write")]
    Write(ActionWrite),
    /// An app write to `$state`: one change, checked once.
    #[serde(rename = "set")]
    Set(ActionSet),
    /// The app calling an exposed fn.
    #[serde(rename = "expose")]
    Expose(ActionExpose),
    /// The app changing a channel's values.
    #[serde(rename = "extern")]
    Extern(ActionExtern),
    /// The app changing what it says about the page.
    #[serde(rename = "page")]
    Page(Page),
}

/// The result of `advertise`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Advertised {
    pub levels: Vec<crate::ir::Level>,
    pub name: String,
    pub protocol: String,
    /// The extern widgets and fns it draws or runs.
    pub supplies: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockHeading {
    pub inline: Vec<Inline>,
    pub level: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockBulletsItems {
    pub blocks: Vec<Block>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub done: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockBullets {
    pub items: Vec<BlockBulletsItems>,
    pub ordered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockCode {
    pub lang: String,
    pub src: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum BlockTableAlign {
    #[serde(rename = "START")]
    Start,
    #[serde(rename = "CENTER")]
    Center,
    #[serde(rename = "END")]
    End,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockTable {
    pub align: Vec<BlockTableAlign>,
    pub head: Vec<Vec<Inline>>,
    pub rows: Vec<Vec<Vec<Inline>>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockFootnote {
    pub blocks: Vec<Block>,
    pub mark: String,
}

/// A Markdown block, as the runner reads the page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Block {
    #[serde(rename = "paragraph")]
    Paragraph(Vec<Inline>),
    #[serde(rename = "heading")]
    Heading(BlockHeading),
    #[serde(rename = "bullets")]
    Bullets(BlockBullets),
    #[serde(rename = "quote")]
    Quote(Vec<Block>),
    #[serde(rename = "code")]
    Code(BlockCode),
    /// A maths block's TeX.
    #[serde(rename = "math")]
    Math(String),
    #[serde(rename = "table")]
    Table(BlockTable),
    #[serde(rename = "footnote")]
    Footnote(BlockFootnote),
    #[serde(rename = "divider")]
    Divider(Empty),
}

/// Where a `spot` landed, in its plane's units.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Box {
    pub from: Point,
    pub to: Point,
}

/// A rule that failed: a `require`'s message, or a contract's code, and where.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Broken {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CallCall {
    pub args: Vec<crate::ir::Expr>,
    pub name: String,
}

/// An extern fn the step called, with its arguments.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Call {
    pub call: CallCall,
}

/// What the compiler gives: its diagnostics, and the page's Markdown with its starting values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseExpect {
    pub diagnostics: Vec<Diagnostic>,
    /// The page's Markdown with its starting values, as `xtmd md` writes it, before any step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markdown: Option<MarkdownExpected>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseTarget {
    pub levels: Vec<crate::ir::Level>,
}

/// A target check: a source, the diagnostics it gives, and what every target must show after each step.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Case {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    /// What the compiler gives: its diagnostics, and the page's Markdown with its starting values.
    pub expect: CaseExpect,
    /// `group.name`, unique.
    pub id: String,
    /// Packs to build with, beside the case.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub packs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<Page>,
    /// The .xt.md or .xtpack file, beside the case.
    pub source: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<Step>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<CaseTarget>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DiagnosticSeverity {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "warning")]
    Warning,
}

/// A diagnostic, by its code and where it starts. Messages are never compared.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Diagnostic {
    pub code: String,
    /// Counted in characters, from 1.
    pub column: i64,
    pub line: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<DiagnosticSeverity>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedShadedSamples {
    pub at: crate::ir::Expr,
    pub pixel: crate::ir::Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedShaded {
    pub args: crate::ir::Expr,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<ExpectedShadedSamples>,
    pub shader: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedTree {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub props: BTreeMap<String, crate::ir::Expr>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub slots: BTreeMap<String, Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widget: Option<String>,
}

/// Only what a step states is compared with the case; every target's whole observation is compared with every other's.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Expected {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub boxes: BTreeMap<String, Box>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calls: Vec<Call>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markdown: Option<MarkdownExpected>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<Outcome>,
    /// Each shade drawn, by site: the fn it was given, by name ("" for a lambda), and its arguments; on the test target also the colour at the area's two corners and its middle, worked out by the shader.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub shaded: BTreeMap<String, ExpectedShaded>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub state: BTreeMap<String, crate::ir::Expr>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tree: BTreeMap<String, ExpectedTree>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InlineText {
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub strike: bool,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InlineImage {
    pub alt: String,
    pub src: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Inline {
    #[serde(rename = "text")]
    Text(InlineText),
    #[serde(rename = "code")]
    Code(String),
    #[serde(rename = "math")]
    Math(String),
    #[serde(rename = "image")]
    Image(InlineImage),
    #[serde(rename = "note")]
    Note(String),
    #[serde(rename = "break")]
    Break(Empty),
}

/// The params of `load`: the IR the xtmd binary wrote for the case, and the page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Load {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub externs: BTreeMap<String, BTreeMap<String, crate::ir::Expr>>,
    /// A path to the .ir.json file.
    pub ir: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<Page>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub state: BTreeMap<String, crate::ir::Expr>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum MarkdownExpected {
    /// The whole page, as blocks.
    #[serde(rename = "blocks")]
    Blocks(Vec<Block>),
    /// Blocks somewhere on the page.
    #[serde(rename = "has")]
    Has(Vec<Block>),
    /// The whole page, from a Markdown file beside the case, read as blocks.
    #[serde(rename = "file")]
    File(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mounted {
    pub props: BTreeMap<String, crate::ir::Expr>,
    /// Each slot's children, by site, in order.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub slots: BTreeMap<String, Vec<String>>,
    pub widget: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationShadedSamples {
    pub at: crate::ir::Expr,
    pub pixel: crate::ir::Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationShaded {
    pub args: crate::ir::Expr,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<ObservationShadedSamples>,
    pub shader: String,
}

/// Everything Extended Mark decides about the page, after a step.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub boxes: BTreeMap<String, Box>,
    pub calls: Vec<Call>,
    /// The page as Markdown, which the runner reads as blocks.
    pub markdown: String,
    pub outcome: Outcome,
    /// Each shade drawn, by site: the fn it was given, by name ("" for a lambda), and its arguments; on the test target also the colour at the area's two corners and its middle, worked out by the shader.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub shaded: BTreeMap<String, ObservationShaded>,
    pub state: BTreeMap<String, crate::ir::Expr>,
    /// The mounted extern widgets, by site.
    pub tree: BTreeMap<String, Mounted>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Outcome {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<Broken>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refused: Vec<Broken>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PageTheme {
    #[serde(rename = "LIGHT")]
    Light,
    #[serde(rename = "DARK")]
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PageWidth {
    #[serde(rename = "NARROW")]
    Narrow,
    #[serde(rename = "MEDIUM")]
    Medium,
    #[serde(rename = "WIDE")]
    Wide,
}

/// What the app tells the page about where it is read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub now: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<PageTheme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub today: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<PageWidth>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: crate::ir::Expr,
    pub y: crate::ir::Expr,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RequestMethod {
    #[serde(rename = "advertise")]
    Advertise,
    #[serde(rename = "load")]
    Load,
    #[serde(rename = "event")]
    Event,
    #[serde(rename = "write")]
    Write,
    #[serde(rename = "set")]
    Set,
    #[serde(rename = "expose")]
    Expose,
    #[serde(rename = "extern")]
    Extern,
    #[serde(rename = "page")]
    Page,
    #[serde(rename = "observe")]
    Observe,
    #[serde(rename = "quit")]
    Quit,
}

/// A JSON-RPC 2.0 request from `xtmd target check` to a target's check adapter, one per line on its standard input.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: i64,
    pub jsonrpc: String,
    pub method: RequestMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseError {
    pub code: i64,
    pub message: String,
}

/// The adapter's reply, on its standard output only; logs go to standard error.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ResponseError>,
    pub id: i64,
    pub jsonrpc: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    #[serde(rename = "do")]
    pub do_: Action,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expect: Option<Expected>,
}
