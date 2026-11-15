//! Declarations: their signatures, and the IR they become.

use crate::ty::{FnParam, Ty};
use crate::*;

/// What the bodies became, for the IR.
#[derive(Default, Clone)]
pub struct Out {
    pub fn_bodies: HashMap<usize, Vec<ir::Stmt>>,
    pub let_values: HashMap<usize, ir::Expr>,
    pub requires: HashMap<DefId, Vec<ir::Require>>,
    pub defaults: HashMap<(DefId, String), ir::Expr>,
    pub case_defaults: HashMap<(DefId, String, String), ir::Expr>,
    pub token_values: HashMap<(DefId, String), ir::Expr>,
    pub channel_defaults: HashMap<(usize, String), ir::Expr>,
    pub state: Option<ir::State>,
    pub exposes: Vec<ir::Expose>,
    /// Widgets written in MKP, lowered, by their def.
    pub templates: Vec<(DefId, ir::Template)>,
    /// Extern widgets' markdown, as nodes.
    pub extern_markdown: HashMap<DefId, Vec<ir::Node>>,
    pub doc: Option<ir::Template>,
}

impl Checker {
    pub(crate) fn decl_of(&self, d: DefId) -> ast::DeclKind {
        let ast = self.files[self.defs[d].file].ast.clone();
        match &ast.items[self.defs[d].item].item {
            Item::Decl(x) => x.kind.clone(),
            _ => unreachable!(),
        }
    }

    fn fields(&mut self, file: usize, fields: &[&ast::Field], generics: &[String]) -> Vec<FieldSym> {
        fields
            .iter()
            .map(|f| FieldSym {
                name: f.name.name.clone(),
                ty: self.resolve(file, &f.ty, generics),
                ir: self.ir_type(file, &f.ty, generics),
                mutable: f.mutable,
                default: f.default.clone(),
                span: f.name.span,
            })
            .collect()
    }

    fn implements_of(&mut self, file: usize, list: &[ast::IfaceRef], generics: &[String]) -> Vec<(DefId, Vec<Ty>)> {
        let mut out = Vec::new();
        for i in list {
            match self.lookup_type(file, &i.name.name) {
                Some(TypeSym::Def(d)) if matches!(self.defs[d].kind, DefKind::Interface { .. }) => {
                    let args = i.args.iter().map(|a| self.resolve(file, a, generics)).collect();
                    out.push((d, args));
                }
                _ => self.error(file, codes::UNKNOWN_TYPE, i.name.span, format!("there is no interface `{}`", i.name.name)),
            }
        }
        out
    }

    pub(crate) fn params(&mut self, file: usize, ps: &ast::Group<ast::Param>, generics: &[String], self_ty: &Ty, self_ir: &ir::Type) -> Vec<ParamSym> {
        ps.iter()
            .map(|p| {
                if p.is_self {
                    let (ty, ir) = match &p.ty {
                        Some(t) => (self.resolve(file, t, generics), self.ir_type(file, t, generics)),
                        None => (self_ty.clone(), self_ir.clone()),
                    };
                    ParamSym { name: "self".into(), ty, ir, mutable: p.mutable, is_self: true }
                } else {
                    let t = p.ty.as_ref().unwrap();
                    let mut ty = self.resolve(file, t, generics);
                    if ty == Ty::SelfT {
                        ty = self_ty.clone();
                    }
                    ParamSym { name: p.name.name.clone(), ty, ir: self.ir_type(file, t, generics), mutable: p.mutable, is_self: false }
                }
            })
            .collect()
    }

    pub(crate) fn signatures(&mut self) {
        for d in self.from.defs..self.defs.len() {
            self.def_signature(d);
        }
        for f in self.from.fns..self.fns.len() {
            self.fn_signature(f);
        }
        for l in self.from.lets..self.lets.len() {
            let file = self.lets[l].file;
            let ast = self.files[file].ast.clone();
            for node in &ast.items {
                if let Item::Decl(ast::Decl { kind: ast::DeclKind::Let(v), .. }) = &node.item {
                    if v.name.span == self.lets[l].span {
                        self.lets[l].ty = self.resolve(file, &v.ty, &[]);
                        self.lets[l].ir = self.ir_type(file, &v.ty, &[]);
                    }
                }
            }
        }
        for c in self.from.channels..self.channels.len() {
            let file = self.channels[c].file;
            let ast = self.files[file].ast.clone();
            for node in &ast.items {
                if let Item::Decl(ast::Decl { kind: ast::DeclKind::ExternBlock(b), .. }) = &node.item {
                    if format!("{}/{}", self.files[file].pack, b.name.name) != self.channels[c].full {
                        continue;
                    }
                    let mut values: Vec<ast::Field> = Vec::new();
                    let mut fns = Vec::new();
                    for m in b.members.iter() {
                        match m {
                            ast::ExternMember::Field(f) => values.push(f.clone()),
                            ast::ExternMember::Fn(sig) => {
                                let ps = self.params(file, &sig.params, &[], &Ty::Err, &ir::Type::named("T"));
                                let (ret, ret_ir) = match &sig.ret {
                                    Some(ast::RetType::Type(t)) => (Some(self.resolve(file, t, &[])), Some(self.ir_type(file, t, &[]))),
                                    _ => (None, None),
                                };
                                fns.push((sig.name.name.clone(), ps, ret, ret_ir));
                            }
                        }
                    }
                    let values: Vec<&ast::Field> = values.iter().collect();
                    self.channels[c].values = self.fields(file, &values, &[]);
                    self.channels[c].fns = fns;
                }
            }
        }
        self.collect_token_values();
    }

    fn def_signature(&mut self, d: DefId) {
        let file = self.defs[d].file;
        use ast::DeclKind as K;
        match self.decl_of(d) {
            K::Record(r) => {
                let g = self.generics(file, &r.generics);
                let names: Vec<String> = g.iter().map(|t| t.name.clone()).collect();
                let fs: Vec<&ast::Field> = r.members.iter().filter_map(|m| if let ast::Member::Field(f) = m { Some(f) } else { None }).collect();
                let fields = self.fields(file, &fs, &names);
                let imp = self.implements_of(file, &r.implements, &names);
                let def = &mut self.defs[d];
                def.generics = g;
                def.implements = imp;
                def.kind = DefKind::Record { fields };
            }
            K::Enum(e) => {
                let g = self.generics(file, &e.generics);
                let names: Vec<String> = g.iter().map(|t| t.name.clone()).collect();
                let cases = e.cases.iter().map(|c| self.case_sym(file, c, &names)).collect();
                self.defs[d].generics = g;
                self.defs[d].kind = DefKind::Enum { cases };
            }
            K::Token(t) => {
                let value = self.resolve(file, &t.ty, &[]);
                let value_ir = self.ir_type(file, &t.ty, &[]);
                let cases = t.cases.iter().map(|c| self.case_sym(file, c, &[])).collect();
                let imp = self.implements_of(file, &t.implements, &[]);
                self.defs[d].implements = imp;
                self.defs[d].kind = DefKind::Token { value, value_ir, cases };
            }
            K::Alias(_) => {
                self.alias_target(d);
            }
            K::Interface(i) => {
                let g = self.generics(file, &i.generics);
                let names: Vec<String> = g.iter().map(|t| t.name.clone()).collect();
                let mut fields = Vec::new();
                let mut fns = Vec::new();
                let mut events = Vec::new();
                for m in i.members.iter() {
                    match m {
                        ast::IfaceMember::Field(f) => fields.push(f.clone()),
                        ast::IfaceMember::Fn(sig) => {
                            fns.push(sig.name.name.clone());
                            let id = self.fns.len();
                            let pack = self.defs[d].pack.clone();
                            self.fns.push(FnSym {
                                full: format!("{}/{}.{}", pack, i.name.name, sig.name.name),
                                name: sig.name.name.clone(),
                                pack,
                                file,
                                span: sig.name.span,
                                on: Some(Recv::Iface(d)),
                                generics: Vec::new(),
                                params: Vec::new(),
                                ret: None,
                                ret_ir: None,
                                body: None,
                                external: true,
                                widget: None,
                                sig: Some(sig.clone()),
                            });
                            let _ = id;
                        }
                        ast::IfaceMember::Event(e) => {
                            let params = self.params(file, &e.params, &names, &Ty::Err, &ir::Type::named("T"));
                            events.push(EventSym { name: e.name.name.clone(), params });
                        }
                    }
                }
                let fr: Vec<&ast::Field> = fields.iter().collect();
                let fields = self.fields(file, &fr, &names);
                self.defs[d].generics = g;
                self.defs[d].kind = DefKind::Interface { widget: i.widget, fields, fns, events };
            }
            K::Widget(w) | K::ExternWidget(w) => {
                let external = matches!(self.decl_of(d), K::ExternWidget(_));
                let g = self.generics(file, &w.generics);
                let names: Vec<String> = g.iter().map(|t| t.name.clone()).collect();
                let mut ins: Vec<ast::Field> = w.inputs.iter().cloned().collect();
                let mut slots = Vec::new();
                let mut events = Vec::new();
                if let Some(b) = &w.body {
                    for m in b.iter() {
                        match m {
                            ast::WidgetMember::Param(f) => ins.push(f.clone()),
                            ast::WidgetMember::Slot(s) => slots.push(SlotSym { name: s.name.name.clone(), ty: self.resolve(file, &s.ty, &names), ir: self.ir_type(file, &s.ty, &names) }),
                            ast::WidgetMember::Event(e) => {
                                let params = self.params(file, &e.params, &names, &Ty::Err, &ir::Type::named("T"));
                                events.push(EventSym { name: e.name.name.clone(), params });
                            }
                            _ => {}
                        }
                    }
                }
                let ir_refs: Vec<&ast::Field> = ins.iter().collect();
                let inputs = self.fields(file, &ir_refs, &names);
                let imp = self.implements_of(file, &w.implements, &names);
                self.defs[d].generics = g;
                self.defs[d].implements = imp;
                self.defs[d].kind = DefKind::Widget { external, inputs, slots, events };
            }
            K::ExternType(t) => {
                let g = self.generics(file, &t.generics);
                self.defs[d].generics = g;
            }
            _ => {}
        }
    }

    fn case_sym(&mut self, file: usize, c: &ast::CaseDecl, generics: &[String]) -> CaseSym {
        let fields: Vec<&ast::Field> = c.fields.as_ref().map(|g| g.iter().collect()).unwrap_or_default();
        CaseSym { name: c.name.name.clone(), fields: self.fields(file, &fields, generics) }
    }

    fn fn_signature(&mut self, f: usize) {
        let Some(sig) = self.fns[f].sig.clone() else { return };
        let file = self.fns[f].file;
        let mut generics = Vec::new();
        let mut self_ty = Ty::Err;
        let mut self_ir = ir::Type::named("T");
        let mut on = self.fns[f].on;
        if let Some((recv, rg)) = &sig.on {
            let rgen = self.generics(file, rg);
            let rnames: Vec<Ty> = rgen.iter().map(|t| Ty::Param(t.name.clone())).collect();
            let rnames_ir: Vec<ir::Type> = rgen.iter().map(|t| ir::Type::named(&t.name)).collect();
            generics.extend(rgen);
            match self.lookup_type(file, &recv.name) {
                Some(TypeSym::Builtin(b)) => {
                    on = Some(Recv::Builtin(b));
                    let one = || rnames.first().cloned().unwrap_or(Ty::Param("T".into()));
                    self_ty = match b {
                        "number" => Ty::Num,
                        "bool" => Ty::Bool,
                        "text" => Ty::Text,
                        "duration" => Ty::Dur,
                        "view" => Ty::View,
                        "list" => Ty::list(one()),
                        "opt" => Ty::opt(one()),
                        "range" => Ty::Range(Box::new(one())),
                        _ => Ty::Err,
                    };
                    self_ir = ir::Type::of(&format!("core/{}", b), rnames_ir);
                }
                Some(TypeSym::Def(d)) => {
                    if let DefKind::Interface { .. } = self.defs[d].kind {
                        on = Some(Recv::Iface(d));
                        generics.push(TParam { name: "self".into(), bounds: vec![(d, Vec::new())] });
                        self_ty = Ty::Param("self".into());
                        self_ir = ir::Type::named(&self.defs[d].full);
                    } else {
                        on = Some(Recv::Def(d));
                        let dg: Vec<Ty> = if rnames.is_empty() { self.defs[d].generics.iter().map(|t| Ty::Param(t.name.clone())).collect() } else { rnames };
                        if rgen_is_empty(&sig) {
                            for t in self.defs[d].generics.clone() {
                                generics.push(t);
                            }
                        }
                        self_ty = Ty::Def(d, dg.clone());
                        self_ir = ir::Type::of(&self.defs[d].full, dg.iter().map(|t| self.ir_ty(t)).collect());
                    }
                }
                None => {
                    self.error(file, codes::UNKNOWN_TYPE, recv.span, format!("there is no type `{}` to add a fn to", recv.name));
                }
            }
        } else if let Some(Recv::Iface(d)) = on {
            // an interface's own fn: self is the type that fits it, and the interface's parameters are visible
            generics.extend(self.defs[d].generics.clone());
            generics.push(TParam { name: "self".into(), bounds: vec![(d, Vec::new())] });
            self_ty = Ty::Param("self".into());
            self_ir = ir::Type::named(&self.defs[d].full);
        }
        generics.extend(self.generics(file, &sig.generics));
        let names: Vec<String> = generics.iter().map(|t| t.name.clone()).collect();
        let params = self.params(file, &sig.params, &names, &self_ty, &self_ir);
        let (mut ret, ret_ir) = match &sig.ret {
            Some(ast::RetType::Type(t)) => (Some(self.resolve(file, t, &names)), Some(self.ir_type(file, t, &names))),
            _ => (None, None),
        };
        if ret == Some(Ty::SelfT) {
            ret = Some(self_ty.clone());
        }
        let ps = params.into_iter().map(|mut p| {
            if p.ty == Ty::SelfT {
                p.ty = self_ty.clone();
            }
            p
        });
        let sym = &mut self.fns[f];
        sym.on = on;
        sym.generics = generics;
        sym.params = ps.collect();
        sym.ret = ret;
        sym.ret_ir = ret_ir;
        if let Some(r) = on {
            let name = sym.name.clone();
            self.methods.entry(r).or_default().entry(name).or_default().push(f);
        }
    }

    fn collect_token_values(&mut self) {
        for file in self.from.files..self.files.len() {
            let ast = self.files[file].ast.clone();
            for node in &ast.items {
                let Item::Decl(ast::Decl { kind: ast::DeclKind::Tokens(t), .. }) = &node.item else { continue };
                for line in t.lines.iter() {
                    match self.lookup_type(file, &line.ty.name) {
                        Some(TypeSym::Def(d)) => {
                            if let DefKind::Token { cases, .. } = &mut self.defs[d].kind {
                                if !cases.iter().any(|c| c.name == line.case.name) {
                                    // a pack adds a case by giving it a value
                                    cases.push(CaseSym { name: line.case.name.clone(), fields: Vec::new() });
                                }
                                self.token_values.push((d, line.case.name.clone(), file, line.value.clone()));
                            } else {
                                self.error(file, codes::NOT_A_TOKEN_TYPE, line.ty.span, format!("`{}` is not a token type: a tokens block gives values to token cases", line.ty.name));
                            }
                        }
                        _ => self.error(file, codes::UNKNOWN_TYPE, line.ty.span, format!("there is no token type `{}`", line.ty.name)),
                    }
                }
            }
        }
    }

    /// The type a fn's parameters and return make, as a value.
    pub(crate) fn fn_type(&self, f: usize) -> Ty {
        let s = &self.fns[f];
        Ty::Fn(s.params.iter().map(|p| FnParam { ty: p.ty.clone(), mutable: p.mutable }).collect(), s.ret.clone().map(Box::new))
    }

    fn ir_fields(&self, fields: &[FieldSym], defaults: impl Fn(&str) -> Option<ir::Expr>) -> Vec<ir::Field> {
        fields.iter().map(|f| ir::Field { name: f.name.clone(), ty: f.ir.clone(), mutable: f.mutable, default: defaults(&f.name) }).collect()
    }

    fn ir_params(&self, ps: &[ParamSym]) -> Vec<ir::Param> {
        ps.iter().map(|p| ir::Param { name: p.name.clone(), ty: p.ir.clone(), mutable: p.mutable }).collect()
    }

    fn supplier(&self, pack: &str) -> ir::Supplier {
        if pack == "core" {
            ir::Supplier::Core
        } else if pack == self.module && !self.packs.get(pack).map_or(false, |p| p.provides.is_some()) {
            ir::Supplier::App
        } else {
            ir::Supplier::Pack
        }
    }

    /// The whole build as one IR module.
    pub(crate) fn module_ir(&mut self) -> ir::Module {
        let out = std::mem::take(&mut self.out);
        let mut decls = Vec::new();
        let decl = |d: ir::Decl| ir::Declaration { declare: d };
        for (d, def) in self.defs.iter().enumerate() {
            match &def.kind {
                DefKind::Record { fields } => {
                    let same = self.methods.get(&Recv::Def(d)).and_then(|m| m.get("same")).and_then(|f| f.first()).map(|f| self.fns[*f].full.clone());
                    decls.push(decl(ir::Decl::Record(ir::Record {
                        name: def.full.clone(),
                        params: self.ir_generics(&def.generics),
                        fields: self.ir_fields(fields, |n| out.defaults.get(&(d, n.to_string())).cloned()),
                        requires: out.requires.get(&d).cloned().unwrap_or_default(),
                        same,
                    })));
                }
                DefKind::Enum { cases } => {
                    let ordered = cases.iter().all(|c| c.fields.is_empty());
                    decls.push(decl(ir::Decl::Enum(ir::Enum {
                        name: def.full.clone(),
                        params: self.ir_generics(&def.generics),
                        cases: cases.iter().map(|c| ir::CaseDecl { name: c.name.clone(), fields: self.ir_fields(&c.fields, |_| None) }).collect(),
                        ordered,
                    })));
                }
                DefKind::Token { value_ir, cases, .. } => {
                    let values = cases.iter().filter_map(|c| out.token_values.get(&(d, c.name.clone())).map(|v| (c.name.clone(), v.clone()))).collect();
                    decls.push(decl(ir::Decl::Token(ir::Token {
                        name: def.full.clone(),
                        value: value_ir.clone(),
                        cases: cases.iter().map(|c| ir::CaseDecl { name: c.name.clone(), fields: self.ir_fields(&c.fields, |_| None) }).collect(),
                        values,
                    })));
                }
                DefKind::Alias { target } => {
                    let is = target.clone().map(|t| t.1).unwrap_or_else(|| ir::Type::named("T"));
                    decls.push(decl(ir::Decl::Type(ir::DeclType { name: def.full.clone(), params: Vec::new(), is })));
                }
                DefKind::Interface { widget, fields, fns, events } => {
                    decls.push(decl(ir::Decl::Interface(ir::Interface {
                        name: def.full.clone(),
                        widget: *widget,
                        params: self.ir_generics(&def.generics),
                        fields: self.ir_fields(fields, |_| None),
                        fns: fns.clone(),
                        events: events.iter().map(|e| ir::Event { name: e.name.clone(), params: self.ir_params(&e.params) }).collect(),
                    })));
                }
                DefKind::Widget { external: true, inputs, slots, events } => {
                    let level = if def.pack == "core" && ["canvas", "layer", "circle", "path", "place", "handle", "shade"].contains(&def.name.as_str()) { ir::Level::CoreGfx } else { ir::Level::CoreDraw };
                    decls.push(decl(ir::Decl::Extern(ir::Extern::Widget(ir::ExternWidget {
                        name: def.full.clone(),
                        generics: self.ir_generics(&def.generics),
                        inputs: self.ir_fields(inputs, |n| out.defaults.get(&(d, n.to_string())).cloned()),
                        slots: slots.iter().map(|s| ir::Slot { name: s.name.clone(), ty: s.ir.clone() }).collect(),
                        events: events.iter().map(|e| ir::Event { name: e.name.clone(), params: self.ir_params(&e.params) }).collect(),
                        markdown: out.extern_markdown.get(&d).cloned().unwrap_or_default(),
                        level,
                        supplier: self.supplier(&def.pack),
                    }))));
                }
                DefKind::ExternType => {
                    decls.push(decl(ir::Decl::Extern(ir::Extern::Type(ir::ExternType { name: def.full.clone(), params: self.ir_generics(&def.generics), supplier: self.supplier(&def.pack) }))));
                }
                DefKind::Widget { .. } => {}
            }
        }
        for (k, f) in self.fns.iter().enumerate() {
            if f.sig.is_none() || (f.body.is_none() && !f.external) {
                continue;
            }
            if f.external && matches!(f.on, Some(Recv::Iface(_))) && f.body.is_none() && self.is_member(k) {
                continue;
            }
            if f.widget.is_some() {
                continue;
            }
            let body = out.fn_bodies.get(&k).cloned().unwrap_or_default();
            if f.external {
                decls.push(decl(ir::Decl::Extern(ir::Extern::Fn(ir::ExternFn {
                    name: f.full.clone(),
                    params: self.ir_params(&f.params),
                    returns: f.ret_ir.clone(),
                    default: body,
                    supplier: self.supplier(&f.pack),
                }))));
            } else {
                decls.push(decl(ir::Decl::Fn(ir::FnDecl {
                    name: f.full.clone(),
                    params: self.ir_params(&f.params),
                    generics: self.ir_generics(&f.generics),
                    returns: f.ret_ir.clone(),
                    body,
                })));
            }
        }
        for (k, c) in self.channels.iter().enumerate() {
            decls.push(decl(ir::Decl::Extern(ir::Extern::Channel(ir::ExternChannel {
                name: c.full.clone(),
                values: self.ir_fields(&c.values, |n| out.channel_defaults.get(&(k, n.to_string())).cloned()),
                fns: c.fns.iter().map(|(n, ps, _, r)| ir::ExternChannelFns { name: n.clone(), params: self.ir_params(ps), returns: r.clone() }).collect(),
                supplier: self.supplier(&c.pack),
            }))));
        }
        for (k, l) in self.lets.iter().enumerate() {
            if let Some(v) = out.let_values.get(&k) {
                decls.push(decl(ir::Decl::Let(ir::LetDecl { name: l.full.clone(), ty: l.ir.clone(), value: v.clone(), reads: Vec::new() })));
            }
        }
        if let Some(s) = out.state {
            decls.push(decl(ir::Decl::State(s)));
        }
        for e in out.exposes {
            decls.push(decl(ir::Decl::Expose(e)));
        }
        let mut templates: Vec<ir::Template> = out.templates.into_iter().map(|(_, t)| t).collect();
        if let Some(doc) = out.doc {
            templates.push(doc);
        }
        let core_needs: Vec<String> = self.defs.iter().filter(|d| d.pack == "core" && matches!(d.kind, DefKind::Widget { external: true, .. })).map(|d| d.full.clone()).collect();
        let app_needs: Vec<String> = self.channels.iter().filter(|c| c.pack == self.module).flat_map(|c| c.fns.iter().map(move |f| format!("{}.{}", c.full, f.0))).collect();
        ir::Module {
            version: 3,
            mkp: env!("CARGO_PKG_VERSION").to_string(),
            module: self.module.clone(),
            level: ir::Level::CoreLive,
            needs: ir::Needs { core: core_needs, packs: Vec::new(), app: app_needs },
            declarations: decls,
            templates,
            bindings: Vec::new(),
            handlers: std::mem::take(&mut self.handlers),
        }
    }

    /// Whether a fn is an interface's own member (sent to each type's fn), not one added to it.
    pub(crate) fn is_member(&self, f: usize) -> bool {
        match self.fns[f].on {
            Some(Recv::Iface(d)) => {
                if let DefKind::Interface { fns, .. } = &self.defs[d].kind {
                    fns.contains(&self.fns[f].name) && self.fns[f].body.is_none() && self.fns[f].sig.as_ref().map_or(false, |s| s.on.is_none())
                } else {
                    false
                }
            }
            _ => false,
        }
    }
}

fn rgen_is_empty(sig: &ast::FnSig) -> bool {
    sig.on.as_ref().map_or(true, |(_, g)| g.is_none())
}
