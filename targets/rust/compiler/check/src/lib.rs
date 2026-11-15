//! The checker: names and types, and the IR they become.
//!
//! It reads every file of core, of the packs a build is given, and the document, finds what
//! each name means (pass 1, names), works out the type of every expression (pass 2, types),
//! and writes the checked program as IR. Constants are worked out with mkp-eval, the same
//! evaluator the native runtime uses.

mod body;
mod decl;
mod fit;
mod passes;
pub mod ty;
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
    pub const NO_LITERAL: &str = "types.no-literal";
    pub const MATCH_ELSE: &str = "types.match-on-token-needs-else";
    pub const MATCH_CASES: &str = "types.match-misses-cases";
    pub const RETURN: &str = "types.return";
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
    pub const VIEW_NEEDS_AT: &str = "views.view-needs-at";
    pub const EMPTY_MARKDOWN: &str = "widget.markdown-empty";
    pub const OPT_HOLE: &str = "prose.opt-hole";
    pub const INLINE_REFUSED: &str = "prose.inline-refused";
}

/// A source file: its path and its text.
#[derive(Clone)]
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
        }
    }

    pub fn error(&mut self, file: usize, code: &'static str, span: Span, message: impl Into<String>) {
        let path = self.files[file].path.clone();
        self.diags.push(Found { file: path, diagnostic: Diagnostic::error(code, span, message) });
    }

    pub fn warning(&mut self, file: usize, code: &'static str, span: Span, message: impl Into<String>) {
        let path = self.files[file].path.clone();
        self.diags.push(Found { file: path, diagnostic: Diagnostic::warning(code, span, message) });
    }

    /// Reads a file and adds it to its pack. A file that doesn't read gives its syntax error.
    pub fn add_file(&mut self, src: &Source) -> Option<usize> {
        let entry = mkp_syntax::entry_for(&src.path).unwrap_or(mkp_syntax::Entry::Mkp);
        let parsed = mkp_syntax::parse(&src.text, entry);
        for d in parsed.diagnostics {
            self.diags.push(Found { file: src.path.clone(), diagnostic: d });
        }
        let file = parsed.file?;
        let pack = match &file.package {
            Some(p) => p.item.name.clone(),
            None => self.module.clone(),
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
                        add.push((name, other.types.get(&one.name).copied(), other.values.get(&one.name).copied()));
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
                    Some(TypeSym::Def(d)) => self.defs[d].full.clone(),
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
        if let Some(c) = &t.contract {
            let c = self.contract(file, c);
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
                Some(ValueSym::Let(l)) => ir::Expr::Get(ir::Get::Let(self.lets[l].full.clone())),
                _ => {
                    self.error(file, codes::UNKNOWN_NAME, n.span, format!("there is no constant `{}`", n.name));
                    ir::Expr::Num("0".into())
                }
            },
            ast::Bound::Expr(e) => self.constant_expr(file, e),
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

    fn contract(&mut self, file: usize, c: &ast::Contract) -> ir::Contract {
        let mut out = empty_contract();
        match c {
            ast::Contract::Range(r) => {
                out.range = Some(self.range_bounds(file, r));
                out.step = r.step.as_ref().map(|s| self.bound(file, s));
            }
            ast::Contract::Step(s) => out.step = Some(self.bound(file, s)),
            ast::Contract::Only(values) => {
                for v in values.iter() {
                    let e = self.constant_expr(file, v);
                    out.only.push(e);
                }
            }
        }
        out
    }

    /// An expression with nothing but constants around it: a bound, an `only` value.
    pub fn constant_expr(&mut self, file: usize, e: &ast::Expr) -> ir::Expr {
        let mut cx = body::Cx::new(file);
        let (x, _) = self.expr(&mut cx, e, None);
        x
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
    c.signatures();
    c.bodies();
    c
}

/// Compiles packs and a document (or a pack) on top of a compiled core, into one IR module.
pub fn compile_on(base: &Checker, packs: &[Vec<Source>], main: &[Source], module: &str) -> Compiled {
    let mut c = base.clone();
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
        return Compiled { module: None, diagnostics: c.diags, texts, constants: HashMap::new() };
    }
    c.collect();
    c.scopes();
    c.signatures();
    c.bodies();
    let failed = c.diags.iter().any(|d| d.diagnostic.is_error());
    let module = if failed { None } else { Some(c.module_ir()) };
    Compiled { module, diagnostics: c.diags, texts, constants: c.constants }
}

/// Compiles core, the packs and the document (or a pack) into one IR module.
pub fn compile(core: &[Source], packs: &[Vec<Source>], main: &[Source], module: &str) -> Compiled {
    let base = compile_core(core);
    compile_on(&base, packs, main, module)
}
