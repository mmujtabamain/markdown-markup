//! The syntax tree. It is untyped and lossless: every comment and blank line is kept, and every
//! bracketed list remembers whether it was written on one line, so `xtmd fmt` can print a file
//! back in the canonical layout without losing anything an author wrote.

use crate::lexer::Comment;
use crate::span::Span;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Ident {
    pub name: String,
    pub span: Span,
}

/// What comes before an item on lines of its own: comments, and blank lines between them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Leading {
    Blank,
    Comment(Comment),
}

/// An item of a list or a block, with the comments around it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Node<T> {
    pub leading: Vec<Leading>,
    pub item: T,
    /// A comment on the item's last line, and comments lined up under it.
    pub trailing: Vec<Comment>,
    /// The item starts a line of its own (in a list written over several lines).
    pub newline: bool,
}

impl<T> Node<T> {
    pub fn new(item: T) -> Node<T> {
        Node { leading: Vec::new(), item, trailing: Vec::new(), newline: false }
    }

    /// The doc comments above the item: `//@about`, `//@param`, `//@deprecated`.
    pub fn docs(&self) -> impl Iterator<Item = &Comment> {
        self.leading.iter().filter_map(|l| match l {
            Leading::Comment(c) if c.is_doc() => Some(c),
            _ => None,
        })
    }
}

/// A bracketed, comma-separated list: arguments, parameters, list items, record fields, cases.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Group<T> {
    pub items: Vec<Node<T>>,
    /// Written over several lines: one line per item (or per line of items), each with a comma.
    pub multiline: bool,
    /// A comment after the opening bracket, on its line.
    pub open: Vec<Comment>,
    /// Comments before the closing bracket.
    pub dangling: Vec<Leading>,
    pub span: Span,
}

impl<T> Group<T> {
    pub fn empty(span: Span) -> Group<T> {
        Group { items: Vec::new(), multiline: false, open: Vec::new(), dangling: Vec::new(), span }
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.items.iter().map(|n| &n.item)
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

/// The members between the braces of a declaration, one per line.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Body<T> {
    pub items: Vec<Node<T>>,
    pub open: Vec<Comment>,
    pub dangling: Vec<Leading>,
    pub span: Span,
}

impl<T> Body<T> {
    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.items.iter().map(|n| &n.item)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    /// A .xtpack file: `package`, imports and declarations.
    Xtmd,
    /// A .xt.md document: definitions, a `@@@` line and prose.
    Document,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct File {
    pub kind: FileKind,
    /// The YAML front matter, `---` lines included, passed on untouched.
    pub front_matter: Option<Span>,
    pub package: Option<Node<Ident>>,
    /// The version on the package line, `package kit@1;`: the file is that version's surface.
    pub surface: Option<Ident>,
    pub items: Vec<Node<Item>>,
    /// Comments after the last item.
    pub dangling: Vec<Leading>,
    /// The `@@@` line.
    pub divider: Option<Span>,
    /// The document below the `@@@` line, or the whole of a document that has none.
    pub prose: Option<Prose>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Item {
    Import(Import),
    Decl(Decl),
    State(StateBlock),
    Expose(Expose),
    /// A view statement: only in a fragment of view code, as the spec's examples write them.
    Stmt(Stmt),
    /// A field ending in `;`: only in a fragment of fields.
    Field(Field),
    /// A fn signature ending in `;`: only in a fragment of signatures.
    Sig(FnSig),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Import {
    /// `kit`, or `kit.stats`.
    pub path: Vec<Ident>,
    pub alias: Option<Ident>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Decl {
    pub kind: DeclKind,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum DeclKind {
    Enum(EnumDecl),
    Record(RecordDecl),
    Token(TokenDecl),
    Alias(AliasDecl),
    Interface(InterfaceDecl),
    Fn(FnDecl),
    Widget(WidgetDecl),
    ExternBlock(ExternBlock),
    ExternType(ExternType),
    ExternFn(FnDecl),
    ExternWidget(WidgetDecl),
    Pack(PackDecl),
    Tokens(TokensDecl),
    Let(Var),
    Migration(MigrationDecl),
    MigrationFn(MigrationFn),
}

impl DeclKind {
    pub fn name(&self) -> &Ident {
        match self {
            DeclKind::Enum(d) => &d.name,
            DeclKind::Record(d) => &d.name,
            DeclKind::Token(d) => &d.name,
            DeclKind::Alias(d) => &d.name,
            DeclKind::Interface(d) => &d.name,
            DeclKind::Fn(d) | DeclKind::ExternFn(d) => &d.sig.name,
            DeclKind::Widget(d) | DeclKind::ExternWidget(d) => &d.name,
            DeclKind::ExternBlock(d) => &d.name,
            DeclKind::ExternType(d) => &d.name,
            DeclKind::Pack(d) => &d.name,
            DeclKind::Tokens(d) => &d.name,
            DeclKind::Let(d) => &d.name,
            DeclKind::Migration(d) => &d.to.name,
            DeclKind::MigrationFn(d) => &d.sig.name,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Generics {
    pub params: Vec<TypeParam>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TypeParam {
    pub name: Ident,
    pub bounds: Vec<IfaceRef>,
}

/// An interface named with its type arguments: `chart`, `literal<text>`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct IfaceRef {
    pub name: Ident,
    pub args: Vec<Type>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EnumDecl {
    pub name: Ident,
    pub generics: Option<Generics>,
    pub cases: Group<CaseDecl>,
}

/// An enum's or a token's case: `DONE`, or `FAILED(why: text)`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CaseDecl {
    pub name: Ident,
    pub fields: Option<Group<Field>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecordDecl {
    pub name: Ident,
    pub generics: Option<Generics>,
    pub implements: Vec<IfaceRef>,
    pub members: Body<Member>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Member {
    Field(Field),
    Require(Require),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TokenDecl {
    pub name: Ident,
    pub ty: Type,
    pub implements: Vec<IfaceRef>,
    pub cases: Group<CaseDecl>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AliasDecl {
    pub name: Ident,
    pub ty: Type,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct InterfaceDecl {
    pub widget: bool,
    pub name: Ident,
    pub generics: Option<Generics>,
    pub members: Body<IfaceMember>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum IfaceMember {
    Field(Field),
    Fn(FnSig),
    Event(EventDecl),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FnDecl {
    pub sig: FnSig,
    /// Left out only for an `extern fn` that has no default.
    pub body: Option<Block>,
}

/// `fn [type [<…>] .] name [<…>] (params) [: type]`
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FnSig {
    /// The type a fn is added to, with its type parameters: `list<T>` in `fn list<T>.some(…)`.
    pub on: Option<(Ident, Option<Generics>)>,
    pub name: Ident,
    pub generics: Option<Generics>,
    pub params: Group<Param>,
    pub ret: Option<RetType>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum RetType {
    Void(Span),
    Type(Type),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Param {
    pub mutable: bool,
    /// `self`, or a name.
    pub name: Ident,
    pub is_self: bool,
    /// Left out for `self`, and for a lambda's parameters where the type comes from its use.
    pub ty: Option<Type>,
}

/// `[mut] name: type [= value]`: a record's field, a widget's input, a `$state` field.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Field {
    pub mutable: bool,
    /// Written with `param` in a widget's body.
    pub param: bool,
    pub name: Ident,
    pub ty: Type,
    pub default: Option<Expr>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WidgetDecl {
    pub name: Ident,
    pub generics: Option<Generics>,
    pub inputs: Group<Field>,
    pub implements: Vec<IfaceRef>,
    /// Left out only for an extern widget written with `;`.
    pub body: Option<Body<WidgetMember>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum WidgetMember {
    Param(Field),
    Slot(SlotDecl),
    Event(EventDecl),
    Require(Require),
    Own(Var),
    Let(Var),
    Fn(FnDecl),
    View(Block),
    Markdown(MarkdownBlock),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SlotDecl {
    pub name: Ident,
    pub ty: Type,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EventDecl {
    pub name: Ident,
    pub params: Group<Param>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Require {
    pub message: TextLit,
    pub body: Block,
}

/// `let` or `mut`: `name: type = value`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Var {
    pub name: Ident,
    pub ty: Type,
    pub value: Expr,
}

/// A widget's `markdown` block: prose, with the common indent of its lines taken off.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MarkdownBlock {
    /// `markdown { }`: the widget writes nothing.
    pub empty: bool,
    pub prose: Prose,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ExternBlock {
    pub name: Ident,
    pub members: Body<ExternMember>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum ExternMember {
    Field(Field),
    Fn(FnSig),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ExternType {
    pub name: Ident,
    pub generics: Option<Generics>,
    pub implements: Vec<IfaceRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PackDecl {
    pub name: Ident,
    pub version: Ident,
    pub lines: Body<PackLine>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum PackLine {
    Uses(Vec<PackRef>),
    Provides(Vec<Ident>),
    Implements(Vec<LevelRef>),
}

/// `migration kit@1 to kit@2 { … }`: how a use of one version becomes a use of the next.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MigrationDecl {
    pub from: PackRef,
    pub to: PackRef,
    pub items: Body<MigrationItem>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum MigrationItem {
    /// A fn that works out values for the statements, run only when migrating.
    Fn(FnDecl),
    Block(MigrationBlock),
}

/// `widget chart { … }`: what happens to each use of one kit@1 declaration.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MigrationBlock {
    /// `widget`, `record`, `enum`, `token`, `fn`, `type`, `let` or `interface`.
    pub kind: Ident,
    /// The declaration's kit@1 name; `text.slug` for a fn on a type.
    pub path: Vec<Ident>,
    pub body: Body<MigrationStmt>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum MigrationStmt {
    /// An operation, `rename(to = plot);`, a migration fn's call, or `if`, `for` and `let`.
    Stmt(Stmt),
    /// `execute { … }`: a fn body from the kit@1 use to the kit@2 one.
    Execute(Block),
    /// `event click { … }`, inside a widget's block.
    Event { name: Ident, body: Body<MigrationStmt> },
}

/// `migration fn nest(inputs: list<input>, into: input) { … }`: a migration to reuse.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MigrationFn {
    pub sig: FnSig,
    pub body: Body<MigrationStmt>,
}

/// `charts@2`
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PackRef {
    pub name: Ident,
    pub version: Ident,
}

/// `core.draw@1`
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LevelRef {
    pub pack: Ident,
    pub level: Ident,
    pub version: Ident,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TokensDecl {
    pub name: Ident,
    pub lines: Body<TokenLine>,
}

/// `color.ACCENT = color_value { … };`
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TokenLine {
    pub ty: Ident,
    pub case: Ident,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StateBlock {
    pub members: Body<Member>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Expose {
    pub name: Ident,
    pub fns: Body<FnDecl>,
}

// ---- types

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Type {
    pub base: TypeBase,
    pub contract: Option<Contract>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum TypeBase {
    /// `stat`, `list<stat>`, `text[1...]`. `args` is `None` when no angle brackets are written.
    Named { name: Ident, args: Option<Vec<Type>>, length: Option<Length> },
    /// A type parameter: `T`.
    Param { name: Ident, length: Option<Length> },
    /// `any chart`
    Any(IfaceRef),
    View,
    SelfType,
    /// `fn(item: T): bool`
    Fn { params: Group<Param>, ret: Option<Box<RetType>> },
    /// `{ name: text, up: bool }`
    Record(Group<Field>),
}

/// A length contract: `[3]`, `[1...]`, `[1..50]`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Length {
    Exact(Bound),
    Range(RangeContract),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Contract {
    Range(RangeContract),
    Step(Bound),
    Only(Group<Expr>),
}

/// `low..high`, `low...` or `...high`, with an optional `step`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RangeContract {
    pub low: Option<Bound>,
    pub high: Option<Bound>,
    pub step: Option<Bound>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Bound {
    /// A number or a duration, with its sign.
    Number { negative: bool, text: String, duration: bool, span: Span },
    Name(Ident),
    /// `(expr)`
    Expr(Box<Expr>),
}

// ---- statements

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    /// A fn's body, or a branch inside one.
    Code,
    /// A `view` block, a call's children, a slot's block, or a branch inside one.
    View,
    /// A lambda's body, which may stay on one line.
    Lambda,
    /// A case's body, which may stay on one line.
    Case,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Block {
    pub stmts: Vec<Node<Stmt>>,
    pub kind: BlockKind,
    /// Written on one line, as a lambda's or a case's body may be.
    pub one_line: bool,
    pub open: Vec<Comment>,
    pub dangling: Vec<Leading>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Stmt {
    Let(Var),
    Mut(Var),
    Return(Option<Expr>),
    Invoke { name: Ident, args: Group<Arg> },
    If(IfStmt),
    For(ForStmt),
    Match(MatchStmt),
    /// An expression, a view among them. A view call with a block ends without `;`.
    Expr(Expr),
    Assign { place: Expr, value: Expr },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct IfStmt {
    pub branches: Vec<(Cond, Block)>,
    pub otherwise: Option<Block>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Cond {
    Expr(Expr),
    /// `let name: type = value` or `mut name: type = value`: opening an `opt`.
    Open { mutable: bool, name: Ident, ty: Type, value: Expr },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ForStmt {
    pub mutable: bool,
    /// The position, in `for (k, x in xs)`.
    pub key: Option<Ident>,
    pub name: Ident,
    pub over: Expr,
    pub body: Block,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MatchStmt {
    pub subject: Expr,
    pub cases: Body<MatchCase>,
    /// The `match` keyword.
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MatchCase {
    /// Empty for `case else`.
    pub patterns: Vec<Pattern>,
    pub body: Block,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Pattern {
    /// `stage.FAILED(why)`
    Case { ty: Ident, case: Ident, binds: Option<Vec<Ident>> },
    Number { negative: bool, text: String, span: Span },
    Text(TextLit),
    Bool(bool, Span),
}

// ---- expressions

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Expr {
    pub kind: ExprKind,
    pub span: Span,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum UnOp {
    Not,
    Neg,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum BinOp {
    Or,
    And,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    In,
    Add,
    Sub,
    Mul,
    Div,
    Rem,
}

impl BinOp {
    pub fn text(self) -> &'static str {
        match self {
            BinOp::Or => "||",
            BinOp::And => "&&",
            BinOp::Eq => "==",
            BinOp::Ne => "!=",
            BinOp::Lt => "<",
            BinOp::Le => "<=",
            BinOp::Gt => ">",
            BinOp::Ge => ">=",
            BinOp::In => "in",
            BinOp::Add => "+",
            BinOp::Sub => "-",
            BinOp::Mul => "*",
            BinOp::Div => "/",
            BinOp::Rem => "%",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum ExprKind {
    Number(String),
    Duration(String),
    Text(TextLit),
    Bool(bool),
    SelfValue,
    State,
    Name(Ident),
    Paren(Box<Expr>),
    List(Group<Expr>),
    /// `stat { … }`, or `{ … }` with no name.
    Record { ty: Option<Ident>, inits: Group<Init> },
    /// `a.b`
    Field { target: Box<Expr>, name: Ident },
    /// `stage.DONE`, or `stage.FAILED("x")` with values.
    Case { target: Box<Expr>, name: Ident, args: Option<Group<Arg>> },
    Index { target: Box<Expr>, index: Box<Expr> },
    Call { callee: Box<Expr>, args: Group<Arg> },
    With { target: Box<Expr>, inits: Group<Init> },
    Unary { op: UnOp, operand: Box<Expr> },
    Binary { op: BinOp, left: Box<Expr>, right: Box<Expr> },
    Ternary { cond: Box<Expr>, then: Box<Expr>, otherwise: Box<Expr> },
    /// `a..b`, `a...`, `...b`, with an optional `step`. Each bound is an atom.
    Range { low: Option<Box<Expr>>, high: Option<Box<Expr>>, step: Option<Box<Expr>> },
    Try(Box<Expr>),
    Lambda(Lambda),
    View(ViewCall),
}

/// `[mut] name = value` in a record, an inline record or a `with`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Init {
    pub mutable: bool,
    pub name: Ident,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Arg {
    /// Set for a widget's named arguments.
    pub name: Option<Ident>,
    pub value: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Lambda {
    pub params: Group<Param>,
    pub ret: Option<RetType>,
    pub body: Block,
}

/// `@name(…)` with its optional block.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ViewCall {
    pub name: Ident,
    /// `None` when no parentheses are written.
    pub args: Option<Group<Arg>>,
    pub block: Option<CallBlock>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum CallBlock {
    /// Children, for a widget with one slot.
    Children(Block),
    /// Inputs as lines, and each slot under its name.
    Named(Body<NamedEntry>),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum NamedEntry {
    Input { name: Ident, value: Expr },
    Slot { name: Ident, block: Block },
}

/// A text literal: its pieces as written, and its holes.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TextLit {
    pub parts: Vec<TextPart>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum TextPart {
    /// Characters as written, escapes included.
    Piece { raw: String, span: Span },
    /// `\{expr}`
    Hole(Expr),
}

impl TextLit {
    pub fn has_holes(&self) -> bool {
        self.parts.iter().any(|p| matches!(p, TextPart::Hole(_)))
    }
}

// ---- prose

/// Prose: lines of Markdown, with Extended Mark's own lines among them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Prose {
    pub nodes: Vec<ProseNode>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum ProseNode {
    /// A line of Markdown, with the holes in it.
    Text(TextLine),
    /// A fenced code block, fences included, kept as written.
    Fence(Vec<TextLine>),
    /// A maths block, its `$$` lines included.
    Maths(Vec<TextLine>),
    Call(ProseCall),
    If { indent: String, branches: Vec<(Cond, Prose, String)>, otherwise: Option<(Prose, String)>, span: Span },
    For { indent: String, mutable: bool, key: Option<Ident>, name: Ident, over: Expr, body: Prose, close: String, span: Span },
    Match { indent: String, subject: Expr, cases: Vec<ProseCase>, close: String, span: Span },
    /// `@slot name {`, directly inside a call's block.
    Slot { indent: String, name: Ident, body: Prose, close: String, span: Span },
    /// `@// …` to the end of the line: a comment in prose, which nothing draws or writes.
    Comment { indent: String, span: Span },
}

/// One line of prose: what it says once its common indent is taken off, and its holes.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TextLine {
    /// The line, without its common indent and without its line break.
    pub span: Span,
    pub holes: Vec<ProseHole>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProseHole {
    /// From `\{` to `}`.
    pub span: Span,
    pub expr: Expr,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProseCall {
    /// Up to three spaces in front of the `@`.
    pub indent: String,
    pub call: ViewCall,
    /// The block after ` {`, and the indent of its closing `}`.
    pub block: Option<(Prose, String)>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProseCase {
    pub indent: String,
    pub patterns: Vec<Pattern>,
    pub body: Prose,
    pub close: String,
    pub span: Span,
}
