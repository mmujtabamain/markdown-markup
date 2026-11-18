//! The checker: names and types, and the IR they become.
//!
//! It reads every file of core, of the packs a build is given, and the document, finds what
//! each name means (pass 1, names), works out the type of every expression (pass 2, types),
//! and writes the checked program as IR. Constants are worked out with mkp-eval, the same
//! evaluator the native runtime uses.

mod body;
mod decl;
mod declared;
mod effects;
mod fit;
pub mod levels;
mod passes;
pub mod proof;
pub mod ty;
mod migrations;
mod rir;
pub use rir::{compile_rir, sha256_hex};
mod versions;
mod view;

use mkp_ir::ir;
use mkp_syntax::ast::{self, Item};
use mkp_syntax::diag::Diagnostic;
use mkp_syntax::span::Span;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;
use ty::{DefId, FnParam, Ty, Vars};

/// Every code the checker reports.
pub mod codes {
    pub const UNKNOWN_TYPE: &str = "names.unknown-type";
    pub const UNKNOWN_NAME: &str = "names.unknown-name";
    pub const UNKNOWN_WIDGET: &str = "names.unknown-widget";
    pub const UNKNOWN_CASE: &str = "names.unknown-case";
    pub const UNKNOWN_FIELD: &str = "names.unknown-field";
    pub const UNKNOWN_FN: &str = "names.unknown-fn";
    pub const UNKNOWN_PACK: &str = "names.unknown-pack";
    pub const DUPLICATE: &str = "names.duplicate";
    pub const SHADOWING: &str = "names.shadowing";
    pub const IMPORT_CLASH: &str = "names.import-clash";
    pub const NOT_A_TOKEN_TYPE: &str = "names.not-a-token-type";
    pub const NOT_PROVIDED: &str = "names.not-provided";
    pub const MISMATCH: &str = "types.mismatch";
    pub const NOT_CALLABLE: &str = "types.not-callable";
    pub const ARGUMENTS: &str = "types.arguments";
    pub const NOT_MUT: &str = "types.not-mut";
    pub const LITERAL: &str = "types.literal-refused";
    pub const MATCH_ELSE: &str = "types.match-on-token-needs-else";
    pub const MATCH_CASES: &str = "types.match-misses-cases";
    pub const RETURN: &str = "types.return";
    pub const EXPOSED_MUT: &str = "types.exposed-mut-parameter";
    pub const INTERFACE_ALONE: &str = "types.interface-alone";
    pub const CONSTANT: &str = "types.constant-failed";
    pub const POSITIONAL: &str = "views.positional-argument";
    pub const UNKNOWN_INPUT: &str = "views.unknown-input";
    pub const MISSING_INPUT: &str = "views.missing-input";
    pub const CHILDREN_ONE_SLOT: &str = "views.children-need-one-slot";
    pub const UNKNOWN_SLOT: &str = "views.unknown-slot";
    pub const NAMED_TO_FN: &str = "views.named-arguments-to-fn";
    pub const SLOT_EQUALS: &str = "views.slot-given-with-equals";
    pub const NOT_A_VIEW: &str = "views.not-a-view";
    pub const EMPTY_MARKDOWN: &str = "widget.markdown-empty";
    pub const OPT_HOLE: &str = "prose.opt-hole";
    pub const MD_HOLE: &str = "prose.md-in-hole";
    pub const SLOT_TYPE: &str = "views.slot-takes-its-type";
    pub const SLOT_LENGTH: &str = "views.slot-length";
    pub const BUILT_MARKDOWN: &str = "widget.built-markdown-reads-a-variable";
    pub const NEEDS_PROOF: &str = "contracts.needs-proof";
    pub const OUTSIDE: &str = "contracts.outside";
    pub const LENGTH_CHANGE: &str = "contracts.length-change";
    pub const BOUND_NOT_CONSTANT: &str = "contracts.bound-not-constant";
    pub const WRITE_IN_VALUE: &str = "effects.write-where-nothing-changes";
    pub const ACTION_CALL: &str = "effects.action-where-nothing-changes";
    pub const MUT_PARAM: &str = "effects.mut-parameter-on-value-fn";
    pub const LAMBDA_OUTER: &str = "effects.lambda-writes-outer-local";
    pub const FOR_CHANGES: &str = "effects.for-changes-its-list";
    pub const ONE_MUT: &str = "effects.one-value-one-mut";
    pub const INTERFACE_MUT: &str = "types.interface-mut-field";
    pub const IMPLEMENTS: &str = "types.implements-unkept";
    pub const RECURSIVE: &str = "types.recursive-type";
    pub const UNUSED_PARAM: &str = "types.type-parameter-unused";
    pub const ANY_SELF: &str = "types.any-of-a-self-interface";
    pub const RANGE_UNORDERED: &str = "contracts.range-on-unordered";
    pub const CANNOT_BOTH: &str = "contracts.cannot-both-hold";
    pub const ONLY_NOT_SAME: &str = "contracts.only-needs-same";
    pub const NOT_COMPARABLE: &str = "types.not-comparable";
    pub const MATCH_SUBJECT: &str = "types.match-subject";
    pub const HOLE_NOT_SHOWN: &str = "types.hole-not-shown";
    pub const VIEW_IN_TEXT: &str = "types.view-in-text";
    pub const VIEW_IN_MUT: &str = "views.view-in-mut";
    pub const WIDGET_VALUE_ASSIGN: &str = "views.widget-value-input-assigned";
    pub const RESTYLE_CORE: &str = "names.core-token-restyled";
    pub const TOKEN_CASE_TWICE: &str = "names.token-case-twice";
    pub const TOKEN_NO_VALUE: &str = "names.token-case-without-value";
    pub const VIEW_NAMED_LIKE_WIDGET: &str = "names.view-named-like-a-widget";
    pub const DEPRECATED: &str = "names.deprecated";
    pub const BARE_STATE: &str = "prose.bare-state";
    pub const SHADE_MKP_FN: &str = "views.shade-given-an-mkp-fn";
    pub const SPOT_OUTSIDE: &str = "views.spot-outside-bounds";
    pub const HTML_COMMENT: &str = "prose.html-comment";
    pub const SURFACE: &str = "pack.surface";
    pub const VERSION_BREAK: &str = "pack.version-break";
    pub const MIGRATION: &str = "pack.migration";
    pub const MIGRATION_INCOMPLETE: &str = "pack.migration-incomplete";
    pub const MIGRATION_WHY: &str = "pack.migration-why";
    pub const REMOVED_USED: &str = "effects.removed-item-used";
    pub const SIZING_TWICE: &str = "views.sizing-set-twice";
    pub const FN_CLASH: &str = "names.fn-clash";
    pub const WIDGET_REQUIRE: &str = "views.widget-require-false";
    pub const INLINE_REFUSED: &str = "prose.inline-refused";
}

/// A source file: its path and its text.
#[derive(Clone, Debug, PartialEq)]
pub struct Source {
    pub path: String,
    pub text: String,
}

/// A diagnostic and the file it is in.
#[derive(Clone, Debug)]
pub struct Found {
    pub file: String,
    pub diagnostic: Diagnostic,
}

pub struct Compiled {
    /// Left out when there were errors.
    pub module: Option<ir::Module>,
    pub diagnostics: Vec<Found>,
    pub texts: HashMap<String, String>,
    /// The constants worked out at compile time, by the let's full name.
    pub constants: HashMap<String, mkp_eval::Value>,
}

impl Compiled {
    pub fn errors(&self) -> impl Iterator<Item = &Found> {
        self.diagnostics.iter().filter(|d| d.diagnostic.is_error())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Recv {
    Builtin(&'static str),
    Def(DefId),
    Iface(DefId),
}

#[derive(Clone, Debug)]
pub struct TParam {
    pub name: String,
    pub bounds: Vec<(DefId, Vec<Ty>)>,
}

#[derive(Clone, Debug)]
pub struct FieldSym {
    pub name: String,
    pub ty: Ty,
    pub ir: ir::Type,
    pub mutable: bool,
    pub default: Option<ast::Expr>,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct CaseSym {
    pub name: String,
    pub fields: Vec<FieldSym>,
}

#[derive(Clone, Debug)]
pub struct EventSym {
    pub name: String,
    pub params: Vec<ParamSym>,
}

#[derive(Clone, Debug)]
pub struct SlotSym {
    pub name: String,
    pub ty: Ty,
    pub ir: ir::Type,
}

#[derive(Clone, Debug)]
pub struct ParamSym {
    pub name: String,
    pub ty: Ty,
    pub ir: ir::Type,
    pub mutable: bool,
    pub is_self: bool,
}

#[derive(Clone, Debug)]
pub enum DefKind {
    Record { fields: Vec<FieldSym> },
    Enum { cases: Vec<CaseSym> },
    Token { value: Ty, value_ir: ir::Type, cases: Vec<CaseSym> },
    Alias { target: Option<(Ty, ir::Type)> },
    Interface { widget: bool, fields: Vec<FieldSym>, fns: Vec<String>, events: Vec<EventSym> },
    Widget { external: bool, inputs: Vec<FieldSym>, slots: Vec<SlotSym>, events: Vec<EventSym> },
    ExternType,
}

#[derive(Clone, Debug)]
pub struct Def {
    pub name: String,
    pub pack: String,
    pub full: String,
    pub file: usize,
    pub item: usize,
    pub span: Span,
    pub generics: Vec<TParam>,
    pub implements: Vec<(DefId, Vec<Ty>)>,
    pub kind: DefKind,
}

#[derive(Clone, Debug)]
pub struct FnSym {
    pub full: String,
    pub name: String,
    pub pack: String,
    pub file: usize,
    pub span: Span,
    pub on: Option<Recv>,
    pub generics: Vec<TParam>,
    pub params: Vec<ParamSym>,
    pub ret: Option<Ty>,
    pub ret_ir: Option<ir::Type>,
    pub body: Option<ast::Block>,
    pub external: bool,
    /// The widget a widget's own fn belongs to.
    pub widget: Option<DefId>,
    pub sig: Option<ast::FnSig>,
}

#[derive(Clone, Debug)]
pub struct LetSym {
    pub full: String,
    pub name: String,
    pub pack: String,
    pub file: usize,
    pub span: Span,
    pub ty: Ty,
    pub ir: ir::Type,
    pub value: ast::Expr,
}

#[derive(Clone, Debug)]
pub struct ChannelSym {
    pub full: String,
    pub name: String,
    pub pack: String,
    pub file: usize,
    pub values: Vec<FieldSym>,
    pub fns: Vec<(String, Vec<ParamSym>, Option<Ty>, Option<ir::Type>)>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TypeSym {
    Builtin(&'static str),
    Def(DefId),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ValueSym {
    Fn(usize),
    Let(usize),
    Channel(usize),
}

#[derive(Default, Clone)]
pub struct Scope {
    pub types: HashMap<String, TypeSym>,
    pub values: HashMap<String, ValueSym>,
}

#[derive(Clone)]
pub struct FileRec {
    pub path: String,
    pub src: Rc<str>,
    pub ast: Rc<ast::File>,
    pub pack: String,
    pub scope: Scope,
}

#[derive(Default, Clone)]
pub struct PackRec {
    pub files: Vec<usize>,
    pub types: HashMap<String, TypeSym>,
    pub values: HashMap<String, ValueSym>,
    pub provides: Option<HashSet<String>>,
}

pub const BUILTINS: &[&str] = &["number", "bool", "text", "duration", "list", "opt", "range", "view"];

/// Where the files, declarations and fns a compile adds start, after the ones it was given.
#[derive(Clone, Copy, Default)]
pub struct From {
    pub files: usize,
    pub defs: usize,
    pub fns: usize,
    pub lets: usize,
    pub channels: usize,
    pub tokens: usize,
}

/// A name in a file and what the checker read it as: kept, when asked for, by `mkp migrate`,
/// which edits a reference only where the checker found one.
#[derive(Clone, Debug)]
pub struct Ref {
    pub file: usize,
    /// The name itself.
    pub at: Span,
    /// What a deletion takes out: a named argument or a record field with its value.
    pub whole: Span,
    pub target: RefTarget,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RefTarget {
    Decl(DefId),
    /// An input, a slot, an event or a field of the declaration, by its name.
    Member(DefId, String),
    Case(DefId, String),
    /// A fn called by its name: `slug` in `title.slug()`.
    Fn(usize),
}

#[derive(Clone)]
pub struct Checker {
    pub files: Vec<FileRec>,
    pub packs: BTreeMap<String, PackRec>,
    pub defs: Vec<Def>,
    pub fns: Vec<FnSym>,
    pub lets: Vec<LetSym>,
    pub channels: Vec<ChannelSym>,
    pub methods: HashMap<Recv, HashMap<String, Vec<usize>>>,
    pub vars: Vars,
    pub diags: Vec<Found>,
    pub decls: Vec<ir::Declaration>,
    pub templates: Vec<ir::Template>,
    pub handlers: Vec<ir::Handler>,
    pub next_handler: usize,
    /// Token values from every tokens block: (token def, case) -> (file, value).
    pub token_values: Vec<(DefId, String, usize, ast::Expr)>,
    /// The document's `$state` fields, and its extern channels' expose blocks.
    pub state: Option<(usize, ast::StateBlock)>,
    pub exposes: Vec<(usize, ast::Expose)>,
    /// Constants worked out at compile time, by the let's full name.
    pub constants: HashMap<String, mkp_eval::Value>,
    pub module: String,
    pub out: decl::Out,
    pub pending: Vec<body::Pending>,
    pub next_site: usize,
    /// The document's link reference definitions, by their normalized labels.
    pub prose_links: Vec<(String, String)>,
    pub prose_span: Span,
    pub from: From,
    /// Proofs wanted where values meet contracts, settled with the constants.
    pub proofs: Vec<proof::Proof>,
    /// The references found, when asked for (`Some`).
    pub refs: Option<Vec<Ref>>,
    /// Each expression's type and what it compiled to, by (file, start, end), when asked for.
    pub typed: Option<HashMap<(usize, u32, u32), (Ty, ir::Expr)>>,
    /// What is known of each expression checked so far, by file and span.
    pub known_at: HashMap<(usize, u32, u32), proof::Known>,
    /// Contract bounds that name a constant or work one out, checked with the constants.
    pub bound_checks: Vec<(usize, Span, ir::Expr)>,
    /// What each action changes, for calls from where nothing may change.
    pub effects: effects::Effects,
    /// Rules on types as written, checked once every signature is known.
    pub type_rules: Vec<declared::TypeRule>,
    /// `//@deprecated` declarations, by their file and where their name starts: the message.
    pub deprecated: HashMap<(usize, u32), String>,
    /// The bounds of each plane being checked, innermost last, for its spots.
    pub planes: Vec<Option<ir::Expr>>,
    /// A spot's point and its plane's bounds, compared once the constants are known.
    pub spot_checks: Vec<(usize, Span, ir::Expr, ir::Expr)>,
    /// Sizing properties already reported as set twice, by file and where.
    pub sizing_reported: std::collections::HashSet<(usize, u32)>,
    /// Calls of widgets that have `require` blocks, with their arguments: run at compile time
    /// when the inputs are constants.
    pub require_checks: Vec<(usize, Span, DefId, BTreeMap<String, ir::Expr>)>,
    /// Lets whose checking reported an error: not reported again when worked out.
    pub failed_lets: std::collections::HashSet<usize>,
    /// The declared fn type the lambda being checked is given to, contracts and all: what its
    /// `return`s are held to when it writes no return type.
    pub(crate) lambda_want: Option<ir::Type>,
}

impl Checker {
    pub fn new() -> Checker {
        Checker {
            files: Vec::new(),
            packs: BTreeMap::new(),
            defs: Vec::new(),
            fns: Vec::new(),
            lets: Vec::new(),
            channels: Vec::new(),
            methods: HashMap::new(),
            vars: Vars::default(),
            diags: Vec::new(),
            decls: Vec::new(),
            templates: Vec::new(),
            handlers: Vec::new(),
            next_handler: 0,
            token_values: Vec::new(),
            state: None,
            exposes: Vec::new(),
            constants: HashMap::new(),
            module: "doc".into(),
            out: decl::Out::default(),
            pending: Vec::new(),
            next_site: 0,
            prose_links: Vec::new(),
            prose_span: Span::default(),
            from: From::default(),
            proofs: Vec::new(),
            refs: None,
            typed: None,
            known_at: HashMap::new(),
            bound_checks: Vec::new(),
            effects: effects::Effects::default(),
            type_rules: Vec::new(),
            deprecated: HashMap::new(),
            planes: Vec::new(),
            spot_checks: Vec::new(),
            sizing_reported: Default::default(),
            require_checks: Vec::new(),
            lambda_want: None,
            failed_lets: Default::default(),
        }
    }

    pub fn error(&mut self, file: usize, code: &'static str, span: Span, message: impl Into<String>) {
        let path = self.files[file].path.clone();
        self.report(Found { file: path, diagnostic: Diagnostic::error(code, span, message) });
    }

    /// A diagnostic, once: a name read in several passes is reported where it is, not once a pass.
    fn report(&mut self, f: Found) {
        let d = &f.diagnostic;
        if !self.diags.iter().any(|x| x.file == f.file && x.diagnostic.code == d.code && x.diagnostic.span == d.span && x.diagnostic.message == d.message) {
            self.diags.push(f);
        }
    }

    /// A reference, logged when the log is on.
    pub(crate) fn note_ref(&mut self, file: usize, at: Span, whole: Span, target: RefTarget) {
        if let Some(r) = self.refs.as_mut() {
            r.push(Ref { file, at, whole, target });
        }
    }

    pub fn warning(&mut self, file: usize, code: &'static str, span: Span, message: impl Into<String>) {
        let path = self.files[file].path.clone();
        self.report(Found { file: path, diagnostic: Diagnostic::warning(code, span, message) });
    }

    /// Reads a file and adds it to its pack. A file that doesn't read gives its syntax error.
    pub fn add_file(&mut self, src: &Source) -> Option<usize> {
        let entry = mkp_syntax::entry_for(&src.path).unwrap_or(mkp_syntax::Entry::Mkp);
        let parsed = mkp_syntax::parse(&src.text, entry);
        for d in parsed.diagnostics {
            self.diags.push(Found { file: src.path.clone(), diagnostic: d });
        }
        let file = parsed.file?;
        let mut surface = None;
        if let Some(v) = &file.surface {
            // `package kit@1;`: what an earlier version provided. It compiles as a pack of its own,
            // `kit@1`, which nothing can import and no IR holds, read only against kit and its
            // migrations. It holds signatures.
            let pack = file.package.as_ref().map(|p| p.item.name.clone()).unwrap_or_default();
            for n in &file.items {
                let Item::Decl(d) = &n.item else { continue };
                let what = match &d.kind {
                    ast::DeclKind::Fn(_) => "a fn with a body: write it as `extern fn …;`",
                    ast::DeclKind::Widget(_) => "a widget with a body: write it as `extern widget …;`",
                    ast::DeclKind::Pack(_) => "a pack block: a surface belongs to the pack block of a later version",
                    _ => continue,
                };
                let msg = format!("{}@{} is a surface, which holds signatures only; found {}", pack, v.name, what);
                self.diags.push(Found { file: src.path.clone(), diagnostic: Diagnostic::error(codes::SURFACE, d.kind.name().span, msg) });
            }
            surface = Some(format!("{}@{}", pack, v.name));
        }
        let pack = match (&surface, &file.package) {
            (Some(s), _) => s.clone(),
            (None, Some(p)) => p.item.name.clone(),
            (None, None) => self.module.clone(),
        };
        let id = self.files.len();
        self.files.push(FileRec { path: src.path.clone(), src: Rc::from(src.text.as_str()), ast: Rc::new(file), pack: pack.clone(), scope: Scope::default() });
        self.packs.entry(pack).or_default().files.push(id);
        Some(id)
    }

    pub fn def_full(&self, d: DefId) -> &str {
        &self.defs[d].full
    }

    /// A type as a reader would write it, for messages.
    pub fn show(&self, t: &Ty) -> String {
        let t = self.vars.resolve(t);
        match &t {
            Ty::Num => "number".into(),
            Ty::Bool => "bool".into(),
            Ty::Text => "text".into(),
            Ty::Dur => "duration".into(),
            Ty::View => "view".into(),
            Ty::List(x) => format!("list<{}>", self.show(x)),
            Ty::Opt(x) => format!("opt<{}>", self.show(x)),
            Ty::Range(x) => format!("range<{}>", self.show(x)),
            Ty::Def(d, args) | Ty::Any(d, args) => {
                let base = if matches!(t, Ty::Any(..)) { format!("any {}", self.defs[*d].name) } else { self.defs[*d].name.clone() };
                if args.is_empty() {
                    base
                } else {
                    format!("{}<{}>", base, args.iter().map(|a| self.show(a)).collect::<Vec<_>>().join(", "))
                }
            }
            Ty::Param(n) => n.clone(),
            Ty::Var(_) => "_".into(),
            Ty::Fn(ps, r) => {
                let ps: Vec<String> = ps.iter().map(|p| format!("{}{}", if p.mutable { "mut " } else { "" }, self.show(&p.ty))).collect();
                match r {
                    Some(r) => format!("fn({}): {}", ps.join(", "), self.show(r)),
                    None => format!("fn({})", ps.join(", ")),
                }
            }
            Ty::Inline(fs) => format!("{{ {} }}", fs.iter().map(|(n, t)| format!("{}: {}", n, self.show(t))).collect::<Vec<_>>().join(", ")),
            Ty::SelfT => "self".into(),
            Ty::Err => "?".into(),
        }
    }

    /// The IR's form of a type.
    pub fn ir_ty(&self, t: &Ty) -> ir::Type {
        let t = self.vars.resolve(t);
        match &t {
            Ty::Num => ir::Type::named("core/number"),
            Ty::Bool => ir::Type::named("core/bool"),
            Ty::Text => ir::Type::named("core/text"),
            Ty::Dur => ir::Type::named("core/duration"),
            Ty::View => ir::Type::named("core/view"),
            Ty::List(x) => ir::Type::of("core/list", vec![self.ir_ty(x)]),
            Ty::Opt(x) => ir::Type::of("core/opt", vec![self.ir_ty(x)]),
            Ty::Range(x) => ir::Type::of("core/range", vec![self.ir_ty(x)]),
            Ty::Def(d, args) => ir::Type::of(&self.defs[*d].full, args.iter().map(|a| self.ir_ty(a)).collect()),
            Ty::Param(n) => ir::Type::named(n),
            Ty::Var(_) | Ty::Err | Ty::SelfT => ir::Type::named("T"),
            Ty::Fn(ps, r) => ir::Type {
                params: ps.iter().enumerate().map(|(k, p)| ir::Param { name: format!("p{}", k), ty: self.ir_ty(&p.ty), mutable: p.mutable }).collect(),
                returns: r.as_ref().map(|r| Box::new(self.ir_ty(r))),
                ..ir::Type::named("fn")
            },
            Ty::Inline(fs) => ir::Type {
                fields: fs.iter().map(|(n, t)| ir::Field { name: n.clone(), ty: self.ir_ty(t), mutable: false, default: None }).collect(),
                ..ir::Type::named("record")
            },
            Ty::Any(d, _) => ir::Type { interface: Some(self.defs[*d].full.clone()), ..ir::Type::named("any") },
        }
    }

    // ---- pass 1: names

    fn collect(&mut self) {
        for file in self.from.files..self.files.len() {
            let ast = self.files[file].ast.clone();
            let pack = self.files[file].pack.clone();
            for (k, node) in ast.items.iter().enumerate() {
                match &node.item {
                    Item::Decl(d) => self.collect_decl(file, k, &pack, d),
                    Item::State(s) => self.state = Some((file, s.clone())),
                    Item::Expose(e) => self.exposes.push((file, e.clone())),
                    _ => {}
                }
            }
        }
    }

    fn declare_type(&mut self, file: usize, pack: &str, name: &ast::Ident, def: DefId) {
        let p = self.packs.get_mut(pack).unwrap();
        if p.types.contains_key(&name.name) {
            self.error(file, codes::DUPLICATE, name.span, format!("`{}` is declared twice in pack `{}`", name.name, pack));
            return;
        }
        p.types.insert(name.name.clone(), TypeSym::Def(def));
    }

    fn declare_value(&mut self, file: usize, pack: &str, name: &ast::Ident, v: ValueSym) {
        let p = self.packs.get_mut(pack).unwrap();
        if p.values.contains_key(&name.name) {
            self.error(file, codes::DUPLICATE, name.span, format!("`{}` is declared twice in pack `{}`", name.name, pack));
            return;
        }
        p.values.insert(name.name.clone(), v);
    }

    fn new_def(&mut self, file: usize, item: usize, pack: &str, name: &ast::Ident, kind: DefKind) -> DefId {
        let id = self.defs.len();
        self.defs.push(Def {
            name: name.name.clone(),
            pack: pack.to_string(),
            full: format!("{}/{}", pack, name.name),
            file,
            item,
            span: name.span,
            generics: Vec::new(),
            implements: Vec::new(),
            kind,
        });
        self.declare_type(file, pack, name, id);
        id
    }

    fn collect_decl(&mut self, file: usize, item: usize, pack: &str, d: &ast::Decl) {
        use ast::DeclKind as K;
        match &d.kind {
            K::Enum(e) => {
                self.new_def(file, item, pack, &e.name, DefKind::Enum { cases: Vec::new() });
            }
            K::Record(r) => {
                self.new_def(file, item, pack, &r.name, DefKind::Record { fields: Vec::new() });
            }
            K::Token(t) => {
                self.new_def(file, item, pack, &t.name, DefKind::Token { value: Ty::Err, value_ir: ir::Type::named("T"), cases: Vec::new() });
            }
            K::Alias(a) => {
                self.new_def(file, item, pack, &a.name, DefKind::Alias { target: None });
            }
            K::Interface(i) => {
                self.new_def(file, item, pack, &i.name, DefKind::Interface { widget: i.widget, fields: Vec::new(), fns: Vec::new(), events: Vec::new() });
            }
            K::Widget(w) => {
                self.new_def(file, item, pack, &w.name, DefKind::Widget { external: false, inputs: Vec::new(), slots: Vec::new(), events: Vec::new() });
            }
            K::ExternWidget(w) => {
                self.new_def(file, item, pack, &w.name, DefKind::Widget { external: true, inputs: Vec::new(), slots: Vec::new(), events: Vec::new() });
            }
            K::ExternType(t) => {
                self.new_def(file, item, pack, &t.name, DefKind::ExternType);
            }
            K::Fn(f) | K::ExternFn(f) => {
                let external = matches!(&d.kind, K::ExternFn(_));
                let id = self.fns.len();
                let full = match &f.sig.on {
                    Some((on, _)) => format!("{}/{}.{}", pack, on.name, f.sig.name.name),
                    None => format!("{}/{}", pack, f.sig.name.name),
                };
                self.fns.push(FnSym {
                    full,
                    name: f.sig.name.name.clone(),
                    pack: pack.to_string(),
                    file,
                    span: f.sig.name.span,
                    on: None,
                    generics: Vec::new(),
                    params: Vec::new(),
                    ret: None,
                    ret_ir: None,
                    body: f.body.clone(),
                    external,
                    widget: None,
                    sig: Some(f.sig.clone()),
                });
                if f.sig.on.is_none() {
                    self.declare_value(file, pack, &f.sig.name, ValueSym::Fn(id));
                }
            }
            K::Let(v) => {
                let id = self.lets.len();
                self.lets.push(LetSym {
                    full: format!("{}/{}", pack, v.name.name),
                    name: v.name.name.clone(),
                    pack: pack.to_string(),
                    file,
                    span: v.name.span,
                    ty: Ty::Err,
                    ir: ir::Type::named("T"),
                    value: v.value.clone(),
                });
                self.declare_value(file, pack, &v.name, ValueSym::Let(id));
            }
            K::ExternBlock(b) => {
                let id = self.channels.len();
                self.channels.push(ChannelSym { full: format!("{}/{}", pack, b.name.name), name: b.name.name.clone(), pack: pack.to_string(), file, values: Vec::new(), fns: Vec::new() });
                self.declare_value(file, pack, &b.name, ValueSym::Channel(id));
            }
            K::Pack(p) => {
                let mut names = HashSet::new();
                for line in p.lines.iter() {
                    if let ast::PackLine::Provides(ns) = line {
                        for n in ns {
                            names.insert(n.name.clone());
                        }
                    }
                }
                let rec = self.packs.get_mut(pack).unwrap();
                rec.provides.get_or_insert_with(HashSet::new).extend(names);
            }
            K::Tokens(_) => {}
            // read against the surfaces when the pack is checked, never part of a page
            K::Migration(_) | K::MigrationFn(_) => {}
        }
    }

    /// Each file's names: built-in types, core's, its own pack's, and what it imports.
    fn scopes(&mut self) {
        for file in self.from.files..self.files.len() {
            let mut scope = Scope::default();
            for b in BUILTINS {
                scope.types.insert(b.to_string(), TypeSym::Builtin(b));
            }
            let pack = self.files[file].pack.clone();
            if pack != "core" {
                if let Some(core) = self.packs.get("core") {
                    let provides = core.provides.clone().unwrap_or_default();
                    for (n, t) in &core.types {
                        if provides.contains(n) {
                            scope.types.insert(n.clone(), *t);
                        }
                    }
                    for (n, v) in &core.values {
                        if provides.contains(n) {
                            scope.values.insert(n.clone(), *v);
                        }
                    }
                }
            }
            let ast = self.files[file].ast.clone();
            for node in &ast.items {
                let Item::Import(imp) = &node.item else { continue };
                let from = &imp.path[0].name;
                let Some(other) = self.packs.get(from) else {
                    self.error(file, codes::UNKNOWN_PACK, imp.path[0].span, format!("there is no pack `{}` in this build", from));
                    continue;
                };
                let provides = other.provides.clone().unwrap_or_default();
                let mut add: Vec<(String, Option<TypeSym>, Option<ValueSym>)> = Vec::new();
                match imp.path.get(1) {
                    None => {
                        for n in &provides {
                            add.push((n.clone(), other.types.get(n).copied(), other.values.get(n).copied()));
                        }
                    }
                    Some(one) => {
                        if !provides.contains(&one.name) {
                            self.error(file, codes::NOT_PROVIDED, one.span, format!("pack `{}` doesn't provide `{}`", from, one.name));
                            continue;
                        }
                        let name = imp.alias.as_ref().map(|a| a.name.clone()).unwrap_or_else(|| one.name.clone());
                        let (t, v) = (other.types.get(&one.name).copied(), other.values.get(&one.name).copied());
                        if let Some(TypeSym::Def(d)) = t {
                            self.note_ref(file, one.span, one.span, RefTarget::Decl(d));
                        }
                        add.push((name, t, v));
                    }
                }
                for (n, t, v) in add {
                    if let Some(t) = t {
                        if scope.types.get(&n).map_or(false, |x| *x != t) {
                            self.error(file, codes::IMPORT_CLASH, imp.span, format!("`{}` is already a visible type: rename one with `as`", n));
                        }
                        scope.types.insert(n.clone(), t);
                    }
                    if let Some(v) = v {
                        if scope.values.get(&n).map_or(false, |x| *x != v) {
                            self.error(file, codes::IMPORT_CLASH, imp.span, format!("`{}` is already a visible name: rename one with `as`", n));
                        }
                        scope.values.insert(n.clone(), v);
                    }
                }
            }
            let own = self.packs.get(&pack).unwrap();
            for (n, t) in &own.types {
                scope.types.insert(n.clone(), *t);
            }
            for (n, v) in &own.values {
                scope.values.insert(n.clone(), *v);
            }
            self.files[file].scope = scope;
        }
    }

    // ---- types from the syntax

    pub fn lookup_type(&self, file: usize, name: &str) -> Option<TypeSym> {
        self.files[file].scope.types.get(name).copied()
    }

    pub fn lookup_value(&self, file: usize, name: &str) -> Option<ValueSym> {
        self.files[file].scope.values.get(name).copied()
    }

    /// A type as written, in a file, with these type parameters visible.
    pub fn resolve(&mut self, file: usize, t: &ast::Type, generics: &[String]) -> Ty {
        use ast::TypeBase as B;
        match &t.base {
            B::Named { name, args, .. } => {
                let args: Vec<Ty> = args.as_ref().map(|a| a.iter().map(|x| self.resolve(file, x, generics)).collect()).unwrap_or_default();
                match self.lookup_type(file, &name.name) {
                    Some(TypeSym::Builtin(b)) => {
                        let one = || args.first().cloned().unwrap_or(Ty::Err);
                        match b {
                            "number" => Ty::Num,
                            "bool" => Ty::Bool,
                            "text" => Ty::Text,
                            "duration" => Ty::Dur,
                            "view" => Ty::View,
                            "list" => Ty::list(one()),
                            "opt" => Ty::opt(one()),
                            "range" => Ty::Range(Box::new(one())),
                            _ => Ty::Err,
                        }
                    }
                    Some(TypeSym::Def(d)) => {
                        self.note_ref(file, name.span, name.span, RefTarget::Decl(d));
                        self.warn_deprecated(file, self.defs[d].file, self.defs[d].span, name.span);
                        if let DefKind::Alias { .. } = self.defs[d].kind {
                            return self.alias_target(d).0;
                        }
                        if let DefKind::Interface { .. } = self.defs[d].kind {
                            self.error(file, codes::INTERFACE_ALONE, name.span, format!("`{}` is an interface, not a type: write `any {}` for any type that fits it, or `<T: {}>` for one", name.name, name.name, name.name));
                            return Ty::Err;
                        }
                        Ty::Def(d, args)
                    }
                    None => {
                        self.error(file, codes::UNKNOWN_TYPE, name.span, format!("there is no type `{}`", name.name));
                        Ty::Err
                    }
                }
            }
            B::Param { name, .. } => {
                if generics.contains(&name.name) {
                    Ty::Param(name.name.clone())
                } else {
                    self.error(file, codes::UNKNOWN_TYPE, name.span, format!("there is no type parameter `{}` here", name.name));
                    Ty::Err
                }
            }
            B::Any(i) => match self.lookup_type(file, &i.name.name) {
                Some(TypeSym::Def(d)) if matches!(self.defs[d].kind, DefKind::Interface { .. }) => {
                    let args = i.args.iter().map(|a| self.resolve(file, a, generics)).collect();
                    Ty::Any(d, args)
                }
                _ => {
                    self.error(file, codes::UNKNOWN_TYPE, i.name.span, format!("there is no interface `{}`", i.name.name));
                    Ty::Err
                }
            },
            B::View => Ty::View,
            B::SelfType => Ty::SelfT,
            B::Fn { params, ret } => {
                let ps = params.iter().map(|p| FnParam { ty: p.ty.as_ref().map(|t| self.resolve(file, t, generics)).unwrap_or(Ty::Err), mutable: p.mutable }).collect();
                let r = match ret.as_deref() {
                    Some(ast::RetType::Type(t)) => Some(Box::new(self.resolve(file, t, generics))),
                    _ => None,
                };
                Ty::Fn(ps, r)
            }
            B::Record(fields) => Ty::Inline(fields.iter().map(|f| (f.name.name.clone(), self.resolve(file, &f.ty, generics))).collect()),
        }
    }

    pub fn alias_target(&mut self, d: DefId) -> (Ty, ir::Type) {
        if let DefKind::Alias { target: Some(t) } = &self.defs[d].kind {
            return t.clone();
        }
        let (file, item) = (self.defs[d].file, self.defs[d].item);
        let ast = self.files[file].ast.clone();
        let Item::Decl(ast::Decl { kind: ast::DeclKind::Alias(a), .. }) = &ast.items[item].item else {
            return (Ty::Err, ir::Type::named("T"));
        };
        // guard against an alias of itself
        self.defs[d].kind = DefKind::Alias { target: Some((Ty::Err, ir::Type::named("T"))) };
        let t = self.resolve(file, &a.ty, &[]);
        let i = self.ir_type(file, &a.ty, &[]);
        self.defs[d].kind = DefKind::Alias { target: Some((t.clone(), i.clone())) };
        (t, i)
    }

    /// The IR's form of a type as written: aliases kept by name, contracts included.
    pub fn ir_type(&mut self, file: usize, t: &ast::Type, generics: &[String]) -> ir::Type {
        use ast::TypeBase as B;
        let mut out = match &t.base {
            B::Named { name, args, length } => {
                let full = match self.lookup_type(file, &name.name) {
                    Some(TypeSym::Builtin(b)) => format!("core/{}", b),
                    Some(TypeSym::Def(d)) => self.defs[d].full.clone(),
                    None => name.name.clone(),
                };
                let args = args.as_ref().map(|a| a.iter().map(|x| self.ir_type(file, x, generics)).collect()).unwrap_or_default();
                let mut out = ir::Type::of(&full, args);
                if let Some(l) = length {
                    out.contract.get_or_insert_with(empty_contract).length = Some(self.length(file, l));
                }
                out
            }
            B::Param { name, length } => {
                let mut out = ir::Type::named(&name.name);
                if let Some(l) = length {
                    out.contract.get_or_insert_with(empty_contract).length = Some(self.length(file, l));
                }
                out
            }
            B::Any(i) => {
                let full = match self.lookup_type(file, &i.name.name) {
                    Some(TypeSym::Def(d)) => {
                        if matches!(self.defs[d].kind, DefKind::Interface { .. }) {
                            self.type_rules.push(declared::TypeRule::Any { file, span: t.span, iface: d });
                        }
                        self.defs[d].full.clone()
                    }
                    _ => i.name.name.clone(),
                };
                ir::Type { interface: Some(full), ..ir::Type::named("any") }
            }
            B::View => ir::Type::named("core/view"),
            B::SelfType => ir::Type::named("self"),
            B::Fn { params, ret } => ir::Type {
                params: params
                    .iter()
                    .map(|p| ir::Param {
                        name: p.name.name.clone(),
                        ty: p.ty.as_ref().map(|t| self.ir_type(file, t, generics)).unwrap_or_else(|| ir::Type::named("T")),
                        mutable: p.mutable,
                    })
                    .collect(),
                returns: match ret.as_deref() {
                    Some(ast::RetType::Type(t)) => Some(Box::new(self.ir_type(file, t, generics))),
                    _ => None,
                },
                ..ir::Type::named("fn")
            },
            B::Record(fields) => ir::Type {
                fields: fields.iter().map(|f| ir::Field { name: f.name.name.clone(), ty: self.ir_type(file, &f.ty, generics), mutable: f.mutable, default: None }).collect(),
                ..ir::Type::named("record")
            },
        };
        if let Some(written) = &t.contract {
            // rules that need every signature: checked once they are known
            if let B::Named { name, .. } = &t.base {
                match (self.lookup_type(file, &name.name), written) {
                    (Some(TypeSym::Builtin(b @ ("bool" | "list" | "opt" | "view" | "range"))), ast::Contract::Range(r)) => {
                        self.error(file, codes::RANGE_UNORDERED, r.span, format!("a range is for numbers, durations, dates and other types that fit `ordered`; `{}` doesn't", b));
                    }
                    (Some(TypeSym::Def(d)), ast::Contract::Range(r)) => self.type_rules.push(declared::TypeRule::Range { file, span: r.span, def: d }),
                    _ => {}
                }
            }
        }
        // `only (…)`'s values are of the type they narrow, which has to compare them
        let base = match &t.contract {
            Some(ast::Contract::Only(_)) => {
                let before = self.diags.len();
                let ty = self.resolve(file, t, generics);
                self.diags.truncate(before);
                self.type_rules.push(declared::TypeRule::Only { file, span: t.span, ty: ty.clone() });
                Some(ty)
            }
            _ => None,
        };
        if let Some(c) = &t.contract {
            let c = self.contract(file, c, base.as_ref());
            if let B::Named { name, .. } = &t.base {
                if let Some(TypeSym::Def(d)) = self.lookup_type(file, &name.name) {
                    if matches!(self.defs[d].kind, DefKind::Alias { .. }) {
                        self.type_rules.push(declared::TypeRule::Both { file, span: t.span, alias: d, written: c.clone() });
                    }
                }
            }
            let slot = out.contract.get_or_insert_with(empty_contract);
            slot.range = c.range.or(slot.range.take());
            slot.step = c.step.or(slot.step.take());
            if !c.only.is_empty() {
                slot.only = c.only;
            }
        }
        out
    }

    fn bound(&mut self, file: usize, b: &ast::Bound) -> ir::Expr {
        match b {
            ast::Bound::Number { negative, text, duration, .. } => {
                let mut t = text.replace('_', "");
                let mut dur = false;
                if *duration {
                    dur = true;
                    t = duration_ms(&t);
                }
                if *negative {
                    t = format!("-{}", t);
                }
                if dur {
                    ir::Expr::Duration(t)
                } else {
                    ir::Expr::Num(t)
                }
            }
            ast::Bound::Name(n) => match self.lookup_value(file, &n.name) {
                Some(ValueSym::Let(l)) => {
                    let x = ir::Expr::Get(ir::Get::Let(self.lets[l].full.clone()));
                    self.bound_checks.push((file, n.span, x.clone()));
                    x
                }
                _ => {
                    self.error(file, codes::UNKNOWN_NAME, n.span, format!("there is no constant `{}`", n.name));
                    ir::Expr::Num("0".into())
                }
            },
            ast::Bound::Expr(e) => {
                let x = self.constant_expr(file, e);
                self.bound_checks.push((file, e.span, x.clone()));
                x
            }
        }
    }

    fn range_bounds(&mut self, file: usize, r: &ast::RangeContract) -> ir::Bounds {
        ir::Bounds { low: r.low.as_ref().map(|b| self.bound(file, b)), high: r.high.as_ref().map(|b| self.bound(file, b)) }
    }

    fn length(&mut self, file: usize, l: &ast::Length) -> ir::Bounds {
        match l {
            ast::Length::Exact(b) => {
                let v = self.bound(file, b);
                ir::Bounds { low: Some(v.clone()), high: Some(v) }
            }
            ast::Length::Range(r) => self.range_bounds(file, r),
        }
    }

    fn contract(&mut self, file: usize, c: &ast::Contract, base: Option<&Ty>) -> ir::Contract {
        let mut out = empty_contract();
        match c {
            ast::Contract::Range(r) => {
                out.range = Some(self.range_bounds(file, r));
                out.step = r.step.as_ref().map(|s| self.bound(file, s));
            }
            ast::Contract::Step(s) => out.step = Some(self.bound(file, s)),
            ast::Contract::Only(values) => {
                for v in values.iter() {
                    let e = self.constant_expr_of(file, v, base);
                    // only's values are constants, as bounds are
                    self.bound_checks.push((file, v.span, e.clone()));
                    out.only.push(e);
                }
            }
        }
        out
    }

    /// An expression with nothing but constants around it: a bound, an `only` value.
    pub fn constant_expr(&mut self, file: usize, e: &ast::Expr) -> ir::Expr {
        self.constant_expr_of(file, e, None)
    }

    /// A constant of a type: an `only` value is one of the type it narrows, so a text literal
    /// there is a `date` when the type is. Contracts sit in types, which no later pass rewrites,
    /// so such a literal is worked out here, by its type's `from`, when that is compiled (core's
    /// are); one that isn't yet is kept as it is written.
    fn constant_expr_of(&mut self, file: usize, e: &ast::Expr, ty: Option<&Ty>) -> ir::Expr {
        let mut cx = body::Cx::new(file);
        let (x, _) = self.expr(&mut cx, e, ty);
        let ir::Expr::Call(c) = &x else { return x };
        if !c.name.starts_with(body::LITERAL_MARK) {
            return x;
        }
        let inner = c.args[0].clone();
        let prog = self.program();
        let mut m = mkp_eval::Machine::new(&prog, Box::new(mkp_eval::interp::Constants));
        match m.eval(&inner) {
            Ok(mkp_eval::Value::Opt(Some(v))) => v.to_ir(),
            Ok(_) => {
                let why = m.last_rule.clone().map(|r| format!(": {}", r)).unwrap_or_default();
                self.error(file, codes::LITERAL, e.span, format!("this literal is not a {}{}", self.show(ty.unwrap_or(&Ty::Err)), why));
                inner
            }
            Err(_) => match &inner {
                ir::Expr::Call(from) => from.args[0].clone(),
                other => other.clone(),
            },
        }
    }

    pub fn generics(&mut self, file: usize, g: &Option<ast::Generics>) -> Vec<TParam> {
        let Some(g) = g else { return Vec::new() };
        let mut out = Vec::new();
        for p in &g.params {
            let mut bounds = Vec::new();
            for b in &p.bounds {
                match self.lookup_type(file, &b.name.name) {
                    Some(TypeSym::Def(d)) if matches!(self.defs[d].kind, DefKind::Interface { .. }) => {
                        let names: Vec<String> = out.iter().map(|t: &TParam| t.name.clone()).chain(std::iter::once(p.name.name.clone())).collect();
                        let args = b.args.iter().map(|a| self.resolve(file, a, &names)).collect();
                        bounds.push((d, args));
                    }
                    _ => self.error(file, codes::UNKNOWN_TYPE, b.name.span, format!("there is no interface `{}`", b.name.name)),
                }
            }
            out.push(TParam { name: p.name.name.clone(), bounds });
        }
        out
    }

    pub fn ir_generics(&self, g: &[TParam]) -> Vec<ir::TypeParam> {
        g.iter().map(|t| ir::TypeParam { name: t.name.clone(), bounds: t.bounds.iter().map(|(d, _)| self.defs[*d].full.clone()).collect() }).collect()
    }
}

pub fn empty_contract() -> ir::Contract {
    ir::Contract { range: None, step: None, length: None, only: Vec::new() }
}

/// `250ms` and `2s`, as milliseconds.
pub fn duration_ms(t: &str) -> String {
    if let Some(ms) = t.strip_suffix("ms") {
        return ms.to_string();
    }
    let s = t.trim_end_matches('s');
    match mkp_eval::Num::parse(s).and_then(|n| n.mul(mkp_eval::Num::int(1000)).ok()) {
        Some(n) => n.show(),
        None => s.to_string(),
    }
}

/// Compiles core alone, to build other compiles on.
pub fn compile_core(core: &[Source]) -> Checker {
    let mut c = Checker::new();
    c.module = "core".into();
    for s in core {
        c.add_file(s);
    }
    c.collect();
    c.scopes();
    c.collect_deprecated();
    c.signatures();
    c.check_declarations();
    c.bodies();
    c
}

/// Compiles packs and a document (or a pack) on top of a compiled core, into one IR module.
pub fn compile_on(base: &Checker, packs: &[Vec<Source>], main: &[Source], module: &str) -> Compiled {
    compile_with(base.clone(), packs, main, module).0
}

pub(crate) fn compile_with(mut c: Checker, packs: &[Vec<Source>], main: &[Source], module: &str) -> (Compiled, Checker) {
    c.module = module.to_string();
    c.from = From { files: c.files.len(), defs: c.defs.len(), fns: c.fns.len(), lets: c.lets.len(), channels: c.channels.len(), tokens: c.token_values.len() };
    let before = c.diags.len();
    for s in packs.iter().flatten().chain(main.iter()) {
        c.add_file(s);
    }
    let mut texts: HashMap<String, String> = c.files.iter().map(|f| (f.path.clone(), f.src.to_string())).collect();
    // a file that didn't read has its text too, for its diagnostics
    for s in packs.iter().flatten().chain(main.iter()) {
        texts.entry(s.path.clone()).or_insert_with(|| s.text.clone());
    }
    if c.diags[before..].iter().any(|d| d.diagnostic.is_error()) {
        let diagnostics = std::mem::take(&mut c.diags);
        return (Compiled { module: None, diagnostics, texts, constants: HashMap::new() }, c);
    }
    c.collect();
    c.scopes();
    c.collect_deprecated();
    c.signatures();
    c.check_declarations();
    c.bodies();
    if module != "doc" {
        c.check_versions();
    }
    let failed = c.diags.iter().any(|d| d.diagnostic.is_error());
    let module = if failed { None } else { Some(c.module_ir()) };
    let diagnostics = std::mem::take(&mut c.diags);
    let constants = std::mem::take(&mut c.constants);
    (Compiled { module, diagnostics, texts, constants }, c)
}

/// A reference in a file, as `mkp migrate` reads it: the declaration's full name (`kit/chart`),
/// and the member or case it names.
#[derive(Clone, Debug, PartialEq)]
pub struct FoundRef {
    pub file: String,
    pub at: Span,
    pub whole: Span,
    pub decl: String,
    pub member: Option<String>,
    pub case: bool,
}

/// As `compile_on`, keeping every reference the checker finds in `main`'s files.
pub fn compile_refs(base: &Checker, packs: &[Vec<Source>], main: &[Source], module: &str) -> (Compiled, Vec<FoundRef>) {
    let mut c = base.clone();
    c.refs = Some(Vec::new());
    let (compiled, c) = compile_with(c, packs, main, module);
    let mains: std::collections::HashSet<&str> = main.iter().map(|s| s.path.as_str()).collect();
    let mut out: Vec<FoundRef> = Vec::new();
    for r in c.refs.clone().unwrap_or_default() {
        let file = c.files[r.file].path.clone();
        if !mains.contains(file.as_str()) {
            continue;
        }
        let (decl, member, case) = match &r.target {
            RefTarget::Decl(d) => (c.defs[*d].full.clone(), None, false),
            RefTarget::Member(d, m) => (c.defs[*d].full.clone(), Some(m.clone()), false),
            RefTarget::Case(d, m) => (c.defs[*d].full.clone(), Some(m.clone()), true),
            RefTarget::Fn(f) => (c.fns[*f].full.clone(), None, false),
        };
        let found = FoundRef { file, at: r.at, whole: r.whole, decl, member, case };
        if !out.contains(&found) {
            out.push(found);
        }
    }
    (compiled, out)
}

/// Compiles core, the packs and the document (or a pack) into one IR module.
pub fn compile(core: &[Source], packs: &[Vec<Source>], main: &[Source], module: &str) -> Compiled {
    let base = compile_core(core);
    compile_on(&base, packs, main, module)
}
