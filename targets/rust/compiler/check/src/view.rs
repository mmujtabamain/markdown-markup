//! Views: widget calls, slots, events and placed values, as the IR's nodes; widgets written in
//! MKP as templates; and markdown blocks, lowered onto core's Markdown blocks.

use crate::body::{Cx, LocalKind, WidgetCx};
pub const PROSE_MARK: &str = "@prose";
use crate::ty::Ty;
use crate::*;
use mkp_syntax::ast::{ExprKind as E, ProseNode};

impl Checker {
    fn site(&mut self, prefix: &str) -> String {
        self.next_site += 1;
        format!("{}{}", prefix, self.next_site)
    }

    pub(crate) fn widget_cx(&mut self, d: DefId) -> WidgetCx {
        let DefKind::Widget { inputs, slots, events, .. } = self.defs[d].kind.clone() else { unreachable!() };
        WidgetCx {
            def: d,
            inputs: inputs.iter().map(|f| (f.name.clone(), f.ty.clone(), f.mutable)).collect(),
            slots: slots.iter().map(|s| (s.name.clone(), s.ty.clone())).collect(),
            events,
            cells: Vec::new(),
            fns: HashMap::new(),
            declared: inputs.iter().map(|f| (f.name.clone(), f.ir.clone())).collect(),
        }
    }

    fn widget_of(&self, cx: &Cx, name: &str) -> Option<DefId> {
        match self.lookup_type(cx.file, name) {
            Some(TypeSym::Def(d)) if matches!(self.defs[d].kind, DefKind::Widget { .. }) => Some(d),
            _ => None,
        }
    }

    /// What follows `@` when it isn't a widget: a slot, a view held in a value, or a fn that returns one.
    fn placed_value(&mut self, cx: &mut Cx, call: &ast::ViewCall) -> Option<(ir::Expr, Ty)> {
        let name = &call.name.name;
        let viewish = |t: &Ty| !matches!(t, Ty::Num | Ty::Text | Ty::Bool | Ty::Dur);
        if let Some(l) = cx.local(name).cloned() {
            if call.args.is_none() && viewish(&l.ty) {
                return Some((ir::Expr::Get(ir::Get::Local(name.clone())), l.ty));
            }
            if let Ty::Fn(..) = self.vars.resolve(&l.ty) {
                let g = call.args.clone().unwrap_or_else(|| ast::Group::empty(call.span));
                let callee = ast::Expr { kind: E::Name(call.name.clone()), span: call.name.span };
                return Some(self.expr(cx, &ast::Expr { kind: E::Call { callee: Box::new(callee), args: g }, span: call.span }, None));
            }
        }
        if let Some(w) = cx.widget.clone() {
            if let Some((_, t)) = w.slots.iter().find(|s| &s.0 == name) {
                return Some((ir::Expr::Get(ir::Get::Slot(name.clone())), t.clone()));
            }
            if let Some((_, t, _)) = w.inputs.iter().find(|i| &i.0 == name) {
                if let Ty::Fn(..) = self.vars.resolve(t) {
                    let g = call.args.clone().unwrap_or_else(|| ast::Group::empty(call.span));
                    let callee = ast::Expr { kind: E::Name(call.name.clone()), span: call.name.span };
                    return Some(self.expr(cx, &ast::Expr { kind: E::Call { callee: Box::new(callee), args: g }, span: call.span }, None));
                }
                if viewish(t) {
                    return Some((ir::Expr::Get(ir::Get::Input(name.clone())), t.clone()));
                }
            }
            if w.fns.contains_key(name) {
                let g = call.args.clone().unwrap_or_else(|| ast::Group::empty(call.span));
                let callee = ast::Expr { kind: E::Name(call.name.clone()), span: call.name.span };
                return Some(self.expr(cx, &ast::Expr { kind: E::Call { callee: Box::new(callee), args: g }, span: call.span }, None));
            }
        }
        if let Some(ValueSym::Fn(f)) = self.lookup_value(cx.file, name) {
            if self.fns[f].ret.as_ref().map_or(false, |r| matches!(r, Ty::View | Ty::Def(..))) {
                let g = call.args.clone().unwrap_or_else(|| ast::Group::empty(call.span));
                let callee = ast::Expr { kind: E::Name(call.name.clone()), span: call.name.span };
                return Some(self.expr(cx, &ast::Expr { kind: E::Call { callee: Box::new(callee), args: g }, span: call.span }, None));
            }
        }
        None
    }

    /// A view written as an expression: `return @label(…)`, `let a: view = @x;`.
    pub(crate) fn view_value(&mut self, cx: &mut Cx, call: &ast::ViewCall) -> (ir::Expr, Ty) {
        if let Some(out) = self.placed_value(cx, call) {
            return out;
        }
        let Some(d) = self.widget_of(cx, &call.name.name) else {
            self.error(cx.file, codes::UNKNOWN_WIDGET, call.name.span, format!("there is no widget `{}`", call.name.name));
            return (ir::Expr::Num("0".into()), Ty::Err);
        };
        let parts = self.call_parts(cx, d, call);
        let full = self.defs[d].full.clone();
        let args = parts.props.into_iter().chain(parts.places.into_iter().map(|(k, p)| (k, ir::Expr::Place(p)))).collect();
        (ir::Expr::View(ir::ViewValue { widget: full, args, slots: parts.slots, events: parts.events }), Ty::Def(d, Vec::new()))
    }

    /// The nodes a block of view code makes.
    pub(crate) fn view_nodes(&mut self, cx: &mut Cx, b: &ast::Block) -> Vec<ir::Node> {
        cx.push();
        let mut out = Vec::new();
        for s in &b.stmts {
            out.extend(self.view_stmt(cx, &s.item));
        }
        cx.pop();
        out
    }

    fn view_stmt(&mut self, cx: &mut Cx, s: &ast::Stmt) -> Vec<ir::Node> {
        use ast::Stmt as S;
        let file = cx.file;
        match s {
            S::Let(v) => {
                let ty = self.resolve(file, &v.ty, &cx.generics.clone());
                let ty_ir = self.ir_type(file, &v.ty, &cx.generics.clone());
                let (x, _) = self.expr(cx, &v.value, Some(&ty));
                self.want(cx, &v.value, &x, &ty_ir, format!("`{}`", v.name.name));
                self.declare_local(cx, &v.name, ty, false, LocalKind::Plain);
                crate::proof::set_known(cx, &v.name.name, crate::proof::Known::of(&ty_ir));
                vec![ir::Node::Declare(ir::NodeDeclare { let_: ir::Local { name: v.name.name.clone(), ty: ty_ir, value: x } })]
            }
            S::If(i) => {
                let site = self.site("s");
                let mut branches = Vec::new();
                for (c, b) in &i.branches {
                    cx.push();
                    let when = self.cond(cx, c);
                    let then = self.view_nodes(cx, b);
                    cx.pop();
                    branches.push(ir::NodeIfBranches { when, then });
                }
                let else_ = i.otherwise.as_ref().map(|b| self.view_nodes(cx, b)).unwrap_or_default();
                vec![ir::Node::If(ir::NodeIf { site, branches, else_ })]
            }
            S::For(f) => {
                let site = self.site("s");
                cx.push();
                let (over, item) = self.loop_over(cx, f.mutable, &f.over);
                let key = if matches!(self.vars.resolve(&self.expr_type_hint(&over)), Ty::Range(_)) { ir::NodeForKey::Number } else { ir::NodeForKey::Item };
                if let Some(k) = &f.key {
                    self.declare_local(cx, k, Ty::Num, false, LocalKind::Plain);
                }
                let var_ty = if f.mutable { Ty::opt(item.clone()) } else { item.clone() };
                self.declare_local(cx, &f.name, var_ty, false, if f.mutable { LocalKind::MutFor } else { LocalKind::Plain });
                if !f.mutable {
                    self.loop_known(cx, &f.over, f.key.as_ref(), &f.name);
                }
                self.begin_walk(cx, f.mutable, &f.over, &f.name);
                let body = self.view_nodes(cx, &f.body);
                cx.pop();
                vec![ir::Node::For(ir::NodeFor { mutable: f.mutable, name: f.name.name.clone(), position: f.key.as_ref().map(|k| k.name.clone()), ty: self.ir_ty(&item), over, key, site, body })]
            }
            S::Match(m) => {
                let site = self.site("s");
                let (v, vt) = self.expr(cx, &m.subject, None);
                let mut cases = Vec::new();
                let mut else_ = Vec::new();
                let mut has_else = false;
                for c in m.cases.iter() {
                    cx.push();
                    if c.patterns.is_empty() {
                        has_else = true;
                        else_ = self.view_nodes(cx, &c.body);
                    } else {
                        let when = self.patterns(cx, &c.patterns, &vt);
                        let then = self.view_nodes(cx, &c.body);
                        cases.push(ir::NodeMatchCases { when, then });
                    }
                    cx.pop();
                }
                self.check_match(file, &vt, &m.cases.items.iter().map(|n| n.item.patterns.clone()).collect::<Vec<_>>(), has_else, m.span);
                vec![ir::Node::Match(ir::NodeMatch { site, value: v, cases, else_ })]
            }
            S::Expr(ast::Expr { kind: E::View(call), .. }) => self.view_call_node(cx, call),
            other => {
                let span = match other {
                    S::Expr(e) => e.span,
                    _ => Span::default(),
                };
                self.error(file, codes::NOT_A_VIEW, span, "a view holds let, if, for, match and views");
                Vec::new()
            }
        }
    }

    fn expr_type_hint(&self, e: &ir::Expr) -> Ty {
        match e {
            ir::Expr::Range(_) => Ty::Range(Box::new(Ty::Num)),
            _ => Ty::Err,
        }
    }

    pub(crate) fn view_call_node(&mut self, cx: &mut Cx, call: &ast::ViewCall) -> Vec<ir::Node> {
        if let Some((x, t)) = self.placed_value(cx, call) {
            let site = self.site("s");
            // a slot that holds a list is placed item by item
            if let Ty::List(_) = self.vars.resolve(&t) {
                let name = format!("{}_item", call.name.name);
                return vec![ir::Node::For(ir::NodeFor {
                    mutable: false,
                    name: name.clone(),
                    position: None,
                    ty: ir::Type::named("core/view"),
                    over: x,
                    key: ir::NodeForKey::Item,
                    site: site.clone(),
                    body: vec![ir::Node::Place(ir::NodePlace { site: format!("{}p", site), view: ir::Expr::Get(ir::Get::Local(name)) })],
                })];
            }
            return vec![ir::Node::Place(ir::NodePlace { site, view: x })];
        }
        let Some(d) = self.widget_of(cx, &call.name.name) else {
            self.error(cx.file, codes::UNKNOWN_WIDGET, call.name.span, format!("there is no widget `{}`", call.name.name));
            return Vec::new();
        };
        self.warn_deprecated(cx.file, self.defs[d].file, self.defs[d].span, call.name.span);
        self.check_sizing_chain(cx, call);
        let site = self.site("s");
        let parts = self.call_parts(cx, d, call);
        let full = self.defs[d].full.clone();
        let external = matches!(self.defs[d].kind, DefKind::Widget { external: true, .. });
        if external {
            vec![ir::Node::Extern(ir::NodeExtern { name: full, site, props: parts.props, slots: parts.slots, events: parts.events, writes: parts.places, levels: Vec::new(), fallback: Vec::new() })]
        } else {
            let mut args = parts.props;
            for (k, p) in parts.places {
                args.insert(k, ir::Expr::Place(p));
            }
            vec![ir::Node::Use(ir::NodeUse { name: full, site, args, slots: parts.slots, events: parts.events, levels: Vec::new(), fallback: Vec::new() })]
        }
    }

    /// A widget call's inputs, `mut` inputs' places, events (as handlers) and slots.
    fn call_parts(&mut self, cx: &mut Cx, d: DefId, call: &ast::ViewCall) -> Parts {
        let file = cx.file;
        let DefKind::Widget { inputs, slots, events, .. } = self.defs[d].kind.clone() else { unreachable!() };
        let wname = self.defs[d].name.clone();
        let mut parts = Parts::default();
        let mut given: HashSet<String> = HashSet::new();
        let mut named: Vec<(ast::Ident, ast::Expr)> = Vec::new();
        if let Some(args) = &call.args {
            for a in args.iter() {
                match &a.name {
                    Some(n) => named.push((n.clone(), a.value.clone())),
                    None => self.error(file, codes::POSITIONAL, a.value.span, format!("`{}` is a widget: name each argument, `{} = …`", wname, inputs.first().map(|i| i.name.as_str()).unwrap_or("input"))),
                }
            }
        }
        let mut slot_blocks: Vec<(String, ast::Block, Span)> = Vec::new();
        match &call.block {
            None => {}
            Some(ast::CallBlock::Children(b)) => {
                if slots.len() == 1 {
                    slot_blocks.push((slots[0].name.clone(), b.clone(), b.span));
                } else if !b.stmts.is_empty() || slots.is_empty() {
                    self.error(file, codes::CHILDREN_ONE_SLOT, call.name.span, format!("`{}` has {} slots: fill each by its name, `slot {{ … }}`", wname, slots.len()));
                }
            }
            Some(ast::CallBlock::Named(body)) => {
                for e in body.iter() {
                    match e {
                        ast::NamedEntry::Input { name, value } => named.push((name.clone(), value.clone())),
                        ast::NamedEntry::Slot { name, block } => {
                            if slots.iter().any(|s| s.name == name.name) {
                                slot_blocks.push((name.name.clone(), block.clone(), name.span));
                            } else {
                                self.error(file, codes::UNKNOWN_SLOT, name.span, format!("`{}` has no slot `{}`", wname, name.name));
                            }
                        }
                    }
                }
            }
        }
        let map: HashMap<String, Ty> = self.defs[d].generics.clone().iter().map(|g| (g.name.clone(), self.vars.fresh())).collect();
        let bounds = cx.bounds.clone();
        for (n, value) in &named {
            given.insert(n.name.clone());
            if let Some(input) = inputs.iter().find(|i| i.name == n.name) {
                let it = input.ty.subst(&map);
                if input.mutable {
                    match self.place(cx, value) {
                        Some((p, pt)) => {
                            if self.accepts(&it, &pt, &bounds).is_none() {
                                let (a, b) = (self.show(&it), self.show(&pt));
                                self.error(file, codes::MISMATCH, value.span, format!("`{}` is a `mut {}`, given a {}", n.name, a, b));
                            }
                            // shared: the variable's own contract has to be inside the input's
                            if let Some(k) = self.place_known(cx, value) {
                                self.known_at.insert((file, value.span.start, value.span.end), k);
                                self.want_shared(cx, value, &input.ir, format!("`{}`'s `mut {}`", wname, n.name));
                            }
                            parts.places.insert(n.name.clone(), p);
                        }
                        None => {
                            self.expr(cx, value, Some(&it));
                            self.error(file, codes::NOT_MUT, value.span, format!("`{}` is a `mut` input: give it a variable it can write, or leave it out", n.name));
                        }
                    }
                } else {
                    let (x, _) = self.expr(cx, value, Some(&it));
                    self.want(cx, value, &x, &input.ir, format!("`{}`'s `{}`", wname, n.name));
                    // a shader written in MKP runs for every pixel within the step limit (page 5)
                    if self.defs[d].full == "core/shade" && n.name == "shader" {
                        let mkp_fn = match &value.kind {
                            E::Lambda(_) => true,
                            E::Name(fname) => matches!(self.lookup_value(file, &fname.name), Some(crate::ValueSym::Fn(f)) if !self.fns[f].external),
                            _ => false,
                        };
                        if mkp_fn {
                            self.warning(file, codes::SHADE_MKP_FN, value.span, "this shader is an MKP fn: the runtime calls it for each pixel within the step limit, so only a small area fits. An extern fn runs natively");
                        }
                    }
                    parts.props.insert(n.name.clone(), x);
                }
            } else if let Some(ev) = events.iter().find(|e| e.name == n.name) {
                let id = self.handler(cx, ev, value);
                parts.events.insert(n.name.clone(), id);
            } else if slots.iter().any(|s| s.name == n.name) {
                self.error(file, codes::SLOT_EQUALS, n.span, format!("`{}` is a slot: fill it with a block, `{} {{ … }}`, never with `=`", n.name, n.name));
            } else {
                self.error(file, codes::UNKNOWN_INPUT, n.span, format!("`{}` has no input or event `{}`", wname, n.name));
            }
        }
        let positional = call.args.as_ref().map_or(false, |a| a.iter().any(|x| x.name.is_none()));
        for i in &inputs {
            if i.default.is_none() && !given.contains(&i.name) && !positional {
                self.error(file, codes::MISSING_INPUT, call.name.span, format!("`{}` needs its input `{}`", wname, i.name));
            }
        }
        // a widget's require blocks, run by the compiler when its inputs are constants
        if matches!(self.defs[d].kind, DefKind::Widget { external: false, .. }) {
            self.require_checks.push((file, call.name.span, d, parts.props.clone()));
        }
        // a spot's point is checked against its plane's bounds
        let full = self.defs[d].full.clone();
        if full == "core/spot" {
            if let (Some(Some(bounds)), Some(at)) = (self.planes.last().cloned(), parts.props.get("at").cloned()) {
                self.spot_checks.push((file, call.name.span, at, bounds));
            }
        }
        if full == "core/plane" {
            let bounds = parts.props.get("bounds").cloned();
            self.planes.push(bounds);
        }
        let mut slot_list = Vec::new();
        for (name, block, at) in slot_blocks {
            let nodes = self.view_nodes(cx, &block);
            if let Some(s) = slots.iter().find(|s| s.name == name) {
                self.check_slot(file, &wname, s, &nodes, at);
            }
            slot_list.push((name, nodes));
        }
        for (name, nodes) in slot_list {
            parts.slots.insert(name, nodes);
        }
        if full == "core/plane" {
            self.planes.pop();
        }
        parts
    }

    /// An event set to a fn: its handler, by id.
    fn handler(&mut self, cx: &mut Cx, ev: &EventSym, value: &ast::Expr) -> String {
        let file = cx.file;
        let want = Ty::Fn(ev.params.iter().map(|p| ty::FnParam { ty: p.ty.clone(), mutable: p.mutable }).collect(), None);
        let (x, _) = self.expr(cx, value, Some(&want));
        let id = format!("h{}", self.next_handler);
        self.next_handler += 1;
        let (params, body) = match x {
            ir::Expr::Fn(l) => (l.params, l.body),
            other => {
                // a fn value: the handler applies it
                let params: Vec<ir::Param> = ev.params.iter().map(|p| ir::Param { name: p.name.clone(), ty: p.ir.clone(), mutable: false }).collect();
                let args = params.iter().map(|p| ir::Expr::Get(ir::Get::Local(p.name.clone()))).collect();
                (params, vec![ir::Stmt::Apply(ir::StmtApply { fn_: other, args })])
            }
        };
        let _ = file;
        self.handlers.push(ir::Handler { id: id.clone(), params, body });
        id
    }

    /// A widget written in MKP, as a template; an extern widget's markdown block, as nodes.
    pub(crate) fn widget(&mut self, d: DefId) {
        let file = self.defs[d].file;
        let (ast::DeclKind::Widget(w) | ast::DeclKind::ExternWidget(w)) = self.decl_of(d) else { return };
        let external = matches!(self.defs[d].kind, DefKind::Widget { external: true, .. });
        let mut cx = Cx::new(file);
        cx.generics = self.defs[d].generics.iter().map(|g| g.name.clone()).collect();
        cx.bounds = self.defs[d].generics.clone();
        // a widget reads $state, and its handlers write it
        cx.state = self.state_fields();
        let mut wcx = self.widget_cx(d);
        let DefKind::Widget { inputs, slots, events, .. } = self.defs[d].kind.clone() else { unreachable!() };
        // input defaults
        for i in &inputs {
            if let Some(def) = &i.default {
                let mut c = cx.clone();
                let (x, _) = self.expr(&mut c, def, Some(&i.ty));
                self.want(&c, def, &x, &i.ir, format!("`{}`'s default", i.name));
                self.out.defaults.insert((d, i.name.clone()), x);
            }
        }
        let Some(body) = &w.body else { return };
        let mut cells = Vec::new();
        let mut requires = Vec::new();
        let mut fns = Vec::new();
        let mut view = Vec::new();
        let mut markdown = None;
        let mut view_ast: Option<(Cx, ast::Block)> = None;
        let mut prefix: Vec<ir::Node> = Vec::new();
        // own variables, lets and fns first, so the view sees them all
        for m in body.iter() {
            match m {
                ast::WidgetMember::Own(v) => {
                    let t = self.resolve(file, &v.ty, &cx.generics.clone());
                    let ti = self.ir_type(file, &v.ty, &cx.generics.clone());
                    if self.is_view_type(&t) {
                        self.error(file, codes::VIEW_IN_MUT, v.name.span, "a view is a description, not a variable: hold it in a `let`, or keep the data it is drawn from in the variable instead");
                    }
                    wcx.cells.push((v.name.name.clone(), t));
                    wcx.declared.push((v.name.name.clone(), ti));
                }
                ast::WidgetMember::Fn(f) => {
                    let id = self.fns.len();
                    let full = format!("{}.{}", self.defs[d].full, f.sig.name.name);
                    let mut sym = FnSym {
                        full,
                        name: f.sig.name.name.clone(),
                        pack: self.defs[d].pack.clone(),
                        file,
                        span: f.sig.name.span,
                        on: None,
                        generics: self.defs[d].generics.clone(),
                        params: Vec::new(),
                        ret: None,
                        ret_ir: None,
                        body: f.body.clone(),
                        external: false,
                        widget: Some(d),
                        sig: Some(f.sig.clone()),
                    };
                    sym.params = self.params(file, &f.sig.params, &cx.generics.clone(), &Ty::Err, &ir::Type::named("T"));
                    if let Some(ast::RetType::Type(t)) = &f.sig.ret {
                        sym.ret = Some(self.resolve(file, t, &cx.generics.clone()));
                        sym.ret_ir = Some(self.ir_type(file, t, &cx.generics.clone()));
                    }
                    self.fns.push(sym);
                    wcx.fns.insert(f.sig.name.name.clone(), id);
                }
                _ => {}
            }
        }
        cx.widget = Some(wcx.clone());
        for m in body.iter() {
            match m {
                ast::WidgetMember::Own(v) => {
                    let t = self.resolve(file, &v.ty, &cx.generics.clone());
                    let ti = self.ir_type(file, &v.ty, &cx.generics.clone());
                    let mut c = cx.clone();
                    let (x, _) = self.expr(&mut c, &v.value, Some(&t));
                    self.want(&c, &v.value, &x, &ti, format!("`{}`", v.name.name));
                    cells.push(ir::Field { name: v.name.name.clone(), ty: ti, mutable: true, default: Some(x) });
                }
                ast::WidgetMember::Let(v) => {
                    let t = self.resolve(file, &v.ty, &cx.generics.clone());
                    let ti = self.ir_type(file, &v.ty, &cx.generics.clone());
                    let (x, _) = self.expr(&mut cx, &v.value, Some(&t));
                    self.want(&cx, &v.value, &x, &ti, format!("`{}`", v.name.name));
                    self.declare_local(&mut cx, &v.name, t, false, LocalKind::Plain);
                    crate::proof::set_known(&mut cx, &v.name.name, crate::proof::Known::of(&ti));
                    prefix.push(ir::Node::Declare(ir::NodeDeclare { let_: ir::Local { name: v.name.name.clone(), ty: ti, value: x } }));
                }
                ast::WidgetMember::Require(r) => {
                    let mut c = cx.clone();
                    c.ret = Some(Some(Ty::Bool));
                    let b = self.block(&mut c, &r.body);
                    let message = r.message.parts.iter().map(|p| if let ast::TextPart::Piece { raw, .. } = p { mkp_syntax::lexer::decode_piece(raw) } else { String::new() }).collect();
                    requires.push(ir::Require { message, reads: Vec::new(), body: b });
                }
                ast::WidgetMember::Fn(f) => {
                    let id = wcx.fns[&f.sig.name.name];
                    let s = self.fns[id].clone();
                    let mut c = cx.clone();
                    c.push();
                    for p in &s.params {
                        c.scopes.last_mut().unwrap().push(body::Local { name: p.name.clone(), ty: p.ty.clone(), mutable: p.mutable, kind: LocalKind::Plain, known: Some(crate::proof::Known::of(&p.ir)), own_origin: false });
                    }
                    c.ret = Some(s.ret.clone());
                    c.ret_ir = s.ret_ir.clone();
                    c.action = s.ret.is_none();
                    c.fn_id = Some(id);
                    c.fn_depth = c.scopes.len() - 1;
                    self.check_value_fn_params(file, &f.sig);
                    let b = self.block(&mut c, f.body.as_ref().unwrap());
                    fns.push(ir::FnDecl {
                        name: s.full.clone(),
                        params: s.params.iter().map(|p| ir::Param { name: p.name.clone(), ty: p.ir.clone(), mutable: p.mutable }).collect(),
                        generics: Vec::new(),
                        returns: s.ret_ir.clone(),
                        body: b,
                    });
                }
                ast::WidgetMember::View(b) => {
                    let mut c = cx.clone();
                    view = self.view_nodes(&mut c, b);
                    view_ast = Some((c, b.clone()));
                }
                ast::WidgetMember::Markdown(md) => {
                    if md.empty {
                        self.warning(file, codes::EMPTY_MARKDOWN, w.name.span, format!("`{}` writes no Markdown (`markdown {{ }}`): the widget around it says what it shows", w.name.name));
                        markdown = Some(Vec::new());
                    } else {
                        let mut c = cx.clone();
                        markdown = Some(self.prose_nodes(&mut c, &md.prose));
                    }
                }
                _ => {}
            }
        }
        if external {
            if let Some(md) = markdown {
                self.out.extern_markdown.insert(d, md);
            }
            return;
        }
        // a document's widget may leave its markdown out: it is built from the view (page 1)
        if markdown.is_none() {
            if let Some((c, b)) = &view_ast {
                self.warn_built_markdown(c, &b.stmts);
            }
            markdown = Some(view.clone());
        }
        let mut full_view = prefix.clone();
        full_view.extend(view);
        let mut md = prefix;
        md.extend(markdown.unwrap_or_default());
        let t = ir::Template {
            name: self.defs[d].full.clone(),
            generics: self.ir_generics(&self.defs[d].generics),
            inputs: inputs.iter().map(|f| ir::Field { name: f.name.clone(), ty: f.ir.clone(), mutable: f.mutable, default: self.out.defaults.get(&(d, f.name.clone())).cloned() }).collect(),
            slots: slots.iter().map(|s| ir::Slot { name: s.name.clone(), ty: s.ir.clone() }).collect(),
            events: events.iter().map(|e| ir::Event { name: e.name.clone(), params: e.params.iter().map(|p| ir::Param { name: p.name.clone(), ty: p.ir.clone(), mutable: p.mutable }).collect() }).collect(),
            cells,
            requires,
            fns,
            view: full_view,
            markdown: md,
            levels: Vec::new(),
        };
        self.out.templates.push((d, t));
    }

    /// Prose as nodes. Each run of Markdown between MKP's own lines is split into blocks, and
    /// each block becomes the extern widget of its kind. A paragraph's text is read by core's
    /// `rich_text.read` when the constants are worked out (passes.rs).
    pub(crate) fn prose_nodes(&mut self, cx: &mut Cx, prose: &ast::Prose) -> Vec<ir::Node> {
        let file = cx.file;
        let src = self.files[file].src.clone();
        let mut out = Vec::new();
        let mut run = String::new();
        let mut holes: Vec<(ir::Expr, Ty, Span)> = Vec::new();
        for node in &prose.nodes {
            match node {
                ProseNode::Text(line) => {
                    if run.is_empty() {
                        self.prose_span = Span::new(line.span.start as usize, line.span.end as usize);
                    }
                    let mut at = line.span.start as usize;
                    for h in &line.holes {
                        run.push_str(&src[at..h.span.start as usize]);
                        let (x, t) = self.expr(cx, &h.expr, None);
                        run.push(char::from_u32(0xE000 + holes.len() as u32).unwrap_or('\u{E000}'));
                        holes.push((x, t, h.span));
                        at = h.span.end as usize;
                    }
                    run.push_str(&src[at..line.span.end as usize]);
                    run.push('\n');
                }
                ProseNode::Fence(lines) => {
                    for l in lines {
                        run.push_str(&src[l.span.range()]);
                        run.push('\n');
                    }
                }
                other => {
                    self.flush_markdown(cx, &mut run, &mut holes, &mut out);
                    match other {
                        ProseNode::Maths(lines) => {
                            let mut pieces = vec![String::new()];
                            let mut hs = Vec::new();
                            let inner = &lines[1..lines.len().saturating_sub(1)];
                            for (k, l) in inner.iter().enumerate() {
                                if k > 0 {
                                    pieces.last_mut().unwrap().push('\n');
                                }
                                let mut at = l.span.start as usize;
                                for h in &l.holes {
                                    pieces.last_mut().unwrap().push_str(&src[at..h.span.start as usize]);
                                    let (x, _) = self.expr(cx, &h.expr, None);
                                    hs.push(ir::Expr::Show(Box::new(ir::ExprShow { value: x })));
                                    pieces.push(String::new());
                                    at = h.span.end as usize;
                                }
                                pieces.last_mut().unwrap().push_str(&src[at..l.span.end as usize]);
                            }
                            let site = self.site("m");
                            self.prose_span = Span::new(lines[0].span.start as usize, lines[0].span.end as usize);
                            let tex = ir::Expr::Template(Box::new(ir::ExprTemplate { pieces, holes: hs, ty: ir::Type::named("core/latex") }));
                            let tex = self.prose_mark(cx, tex, "latex");
                            out.push(extern_node("core/math", site, vec![("tex", tex)], BTreeMap::new()));
                        }
                        ProseNode::Call(c) => {
                            let mut call = c.call.clone();
                            if let Some((body, _)) = &c.block {
                                // a call's block of prose fills its one slot
                                let nodes = self.prose_nodes(cx, body);
                                let mut n = self.view_call_node(cx, &call);
                                if let Some(ir::Node::Extern(e)) = n.first_mut() {
                                    self.fill_one_slot(&e.name.clone(), &mut e.slots, nodes);
                                } else if let Some(ir::Node::Use(u)) = n.first_mut() {
                                    self.fill_one_slot(&u.name.clone(), &mut u.slots, nodes);
                                }
                                out.extend(n);
                                continue;
                            }
                            call.block = None;
                            out.extend(self.view_call_node(cx, &call));
                        }
                        ProseNode::If { branches, otherwise, .. } => {
                            let site = self.site("m");
                            let mut bs = Vec::new();
                            for (c, body, _) in branches {
                                cx.push();
                                let when = self.cond(cx, c);
                                let then = self.prose_nodes(cx, body);
                                cx.pop();
                                bs.push(ir::NodeIfBranches { when, then });
                            }
                            let else_ = otherwise.as_ref().map(|(b, _)| self.prose_nodes(cx, b)).unwrap_or_default();
                            out.push(ir::Node::If(ir::NodeIf { site, branches: bs, else_ }));
                        }
                        ProseNode::For { mutable, key, name, over, body, .. } => {
                            let site = self.site("m");
                            cx.push();
                            let (o, item) = self.loop_over(cx, *mutable, over);
                            if let Some(k) = key {
                                self.declare_local(cx, k, Ty::Num, false, LocalKind::Plain);
                            }
                            let vt = if *mutable { Ty::opt(item.clone()) } else { item.clone() };
                            self.declare_local(cx, name, vt, false, if *mutable { LocalKind::MutFor } else { LocalKind::Plain });
                            if !*mutable {
                                self.loop_known(cx, over, key.as_ref(), name);
                            }
                            self.begin_walk(cx, *mutable, over, name);
                            let b = self.prose_nodes(cx, body);
                            cx.pop();
                            out.push(ir::Node::For(ir::NodeFor { mutable: *mutable, name: name.name.clone(), position: key.as_ref().map(|k| k.name.clone()), ty: self.ir_ty(&item), over: o, key: ir::NodeForKey::Item, site, body: b }));
                        }
                        ProseNode::Match { subject, cases, span, .. } => {
                            let site = self.site("m");
                            let (v, vt) = self.expr(cx, subject, None);
                            let mut cs = Vec::new();
                            let mut else_ = Vec::new();
                            let mut has_else = false;
                            for c in cases {
                                cx.push();
                                if c.patterns.is_empty() {
                                    has_else = true;
                                    else_ = self.prose_nodes(cx, &c.body);
                                } else {
                                    let when = self.patterns(cx, &c.patterns, &vt);
                                    let then = self.prose_nodes(cx, &c.body);
                                    cs.push(ir::NodeMatchCases { when, then });
                                }
                                cx.pop();
                            }
                            self.check_match(file, &vt, &cases.iter().map(|c| c.patterns.clone()).collect::<Vec<_>>(), has_else, *span);
                            out.push(ir::Node::Match(ir::NodeMatch { site, value: v, cases: cs, else_ }));
                        }
                        ProseNode::Slot { .. } | ProseNode::Text(_) | ProseNode::Fence(_) => {}
                    }
                }
            }
        }
        self.flush_markdown(cx, &mut run, &mut holes, &mut out);
        out
    }

    /// A run of Markdown, as blocks.
    fn flush_markdown(&mut self, cx: &mut Cx, run: &mut String, holes: &mut Vec<(ir::Expr, Ty, Span)>, out: &mut Vec<ir::Node>) {
        if run.trim().is_empty() {
            run.clear();
            holes.clear();
            return;
        }
        let doc = mkp_syntax::markdown::parse(run);
        for l in &doc.links {
            let key = mkp_syntax::markdown::normalize_label(&l.label);
            if !self.prose_links.iter().any(|(k, _)| *k == key) {
                self.prose_links.push((key, l.dest.clone()));
            }
        }
        let hs = std::mem::take(holes);
        for b in &doc.blocks {
            let n = self.md_block(cx, b, &hs);
            out.extend(n);
        }
        run.clear();
    }

    fn md_blocks(&mut self, cx: &mut Cx, blocks: &[mkp_syntax::markdown::MdBlock], holes: &[(ir::Expr, Ty, Span)]) -> Vec<ir::Node> {
        let mut out = Vec::new();
        for b in blocks {
            out.extend(self.md_block(cx, b, holes));
        }
        out
    }

    fn md_block(&mut self, cx: &mut Cx, b: &mkp_syntax::markdown::MdBlock, holes: &[(ir::Expr, Ty, Span)]) -> Vec<ir::Node> {
        use mkp_syntax::markdown::{Align, MdBlock};
        let site = self.site("m");
        let node = match b {
            MdBlock::Paragraph(text) => {
                // a paragraph that is only a hole holding a view places that view
                let t: Vec<char> = text.chars().collect();
                if t.len() == 1 && ('\u{E000}'..='\u{F8FF}').contains(&t[0]) {
                    let k = t[0] as usize - 0xE000;
                    if let Some((x, ty, _)) = holes.get(k) {
                        if self.is_view_type(ty) {
                            return vec![ir::Node::Place(ir::NodePlace { site, view: x.clone() })];
                        }
                    }
                }
                let value = self.rich_template(cx, text, holes);
                extern_node("core/paragraph", site, vec![("value", value)], BTreeMap::new())
            }
            MdBlock::Heading { level, text } => {
                let value = self.rich_template(cx, text, holes);
                extern_node("core/heading", site, vec![("level", ir::Expr::Num(level.to_string())), ("value", value)], BTreeMap::new())
            }
            MdBlock::Bullets { ordered, start, items, .. } => {
                let mut nodes = Vec::new();
                for it in items {
                    let isite = self.site("m");
                    let body = self.md_blocks(cx, &it.blocks, holes);
                    let done = match it.done {
                        Some(d) => ir::Expr::Some(Box::new(ir::Expr::Bool(d))),
                        None => ir::Expr::None(ir::Empty {}),
                    };
                    let mut slots = BTreeMap::new();
                    slots.insert("body".to_string(), body);
                    nodes.push(extern_node("core/item", isite, vec![("done", done)], slots));
                }
                let mut slots = BTreeMap::new();
                slots.insert("items".to_string(), nodes);
                extern_node("core/bullets", site, vec![("ordered", ir::Expr::Bool(*ordered)), ("start", ir::Expr::Num(start.to_string()))], slots)
            }
            MdBlock::Quote(blocks) => {
                let mut slots = BTreeMap::new();
                slots.insert("body".to_string(), self.md_blocks(cx, blocks, holes));
                extern_node("core/quote", site, vec![], slots)
            }
            MdBlock::Code { lang, src } => extern_node("core/code", site, vec![("src", ir::Expr::Text(unsentinel(src, holes))), ("lang", ir::Expr::Text(lang.clone()))], BTreeMap::new()),
            MdBlock::Html(text) => {
                // raw HTML is shown as text, never run
                let rich = ir::Expr::Rich(ir::Rich { segments: vec![ir::Segment { segment: ir::SegmentSegment { part: ir::SegmentSegmentPart::Text, value: Some(ir::Expr::Text(unsentinel(text, holes))), src: None, alt: None, marks: None } }] });
                extern_node("core/paragraph", site, vec![("value", rich)], BTreeMap::new())
            }
            MdBlock::Table { align, head, rows } => {
                let head: Vec<ir::Expr> = head.iter().map(|c| self.rich_template(cx, c, holes)).collect();
                let rows: Vec<ir::Expr> = rows.iter().map(|r| ir::Expr::List(r.iter().map(|c| self.rich_template(cx, c, holes)).collect())).collect();
                let align: Vec<ir::Expr> = align
                    .iter()
                    .map(|a| {
                        let name = match a {
                            Align::Center => "CENTER",
                            Align::End => "END",
                            _ => "START",
                        };
                        ir::Expr::Case(ir::ExprCase { enum_: "core/cell_align".into(), name: name.into(), values: BTreeMap::new() })
                    })
                    .collect();
                extern_node("core/table", site, vec![("head", ir::Expr::List(head)), ("rows", ir::Expr::List(rows)), ("align", ir::Expr::List(align))], BTreeMap::new())
            }
            MdBlock::Footnote { mark, blocks } => {
                let mut slots = BTreeMap::new();
                slots.insert("body".to_string(), self.md_blocks(cx, blocks, holes));
                extern_node("core/footnote", site, vec![("mark", ir::Expr::Text(mark.clone()))], slots)
            }
            MdBlock::Divider => extern_node("core/divider", site, vec![], BTreeMap::new()),
        };
        vec![node]
    }

    /// Inline Markdown with holes, as a template core reads when the constants are worked out.
    fn rich_template(&mut self, cx: &mut Cx, text: &str, holes: &[(ir::Expr, Ty, Span)]) -> ir::Expr {
        // in a sentence `$` starts maths, so a bare `$state.x` shows as text (page 1)
        if bare_state(text) {
            self.warning(cx.file, codes::BARE_STATE, self.prose_span, "`$state.…` in a sentence is shown as text, since `$` starts maths there: put it in a hole, `\\{$state.tries}`");
        }
        let mut pieces = vec![String::new()];
        let mut hs = Vec::new();
        for c in text.chars() {
            if ('\u{E000}'..='\u{F8FF}').contains(&c) {
                let k = c as usize - 0xE000;
                if let Some((x, ty, span)) = holes.get(k) {
                    let ty = self.vars.resolve(ty);
                    self.check_hole(cx, &ty, *span, true);
                    if matches!(&ty, Ty::Def(d, _) if self.defs[*d].full == "core/md") {
                        self.error(cx.file, codes::MD_HOLE, *span, "an `md` holds blocks, so it goes in no hole: place its blocks with `@blocks(value = …);`");
                    }
                    if let Ty::Opt(_) = ty {
                        self.error(cx.file, codes::OPT_HOLE, *span, "a paragraph takes rich_text, not an opt: give this hole a fallback, `\\{x.or(…)}`, or open it first with `@if (let …)`");
                    }
                    hs.push(if ty == Ty::Text || self.is_view_type(&ty) { x.clone() } else { ir::Expr::Show(Box::new(ir::ExprShow { value: x.clone() })) });
                    pieces.push(String::new());
                    continue;
                }
            }
            pieces.last_mut().unwrap().push(c);
        }
        let t = ir::Expr::Template(Box::new(ir::ExprTemplate { pieces, holes: hs, ty: ir::Type::named("core/rich_text") }));
        self.prose_mark(cx, t, "rich_text")
    }

    /// A template core reads when the constants are worked out, marked with where it is.
    pub(crate) fn prose_mark(&mut self, cx: &Cx, t: ir::Expr, ty: &str) -> ir::Expr {
        let id = self.pending.len();
        self.pending.push(body::Pending { file: cx.file, span: self.prose_span, ty: ty.to_string() });
        ir::Expr::Call(Box::new(ir::Call { name: format!("{}#{}", PROSE_MARK, id), args: vec![t], ty: None }))
    }

    pub(crate) fn is_view_type(&self, t: &Ty) -> bool {
        let t = self.vars.resolve(t);
        matches!(t, Ty::View | Ty::Any(..)) || matches!(&t, Ty::Def(d, _) if matches!(self.defs[*d].kind, DefKind::Widget { .. }))
    }

    fn fill_one_slot(&mut self, widget: &str, slots: &mut BTreeMap<String, Vec<ir::Node>>, nodes: Vec<ir::Node>) {
        let d = self.defs.iter().position(|d| d.full == widget);
        if let Some(d) = d {
            if let DefKind::Widget { slots: s, .. } = &self.defs[d].kind {
                if let Some(first) = s.first() {
                    slots.insert(first.name.clone(), nodes);
                }
            }
        }
    }
}

fn extern_node(name: &str, site: String, props: Vec<(&str, ir::Expr)>, slots: BTreeMap<String, Vec<ir::Node>>) -> ir::Node {
    ir::Node::Extern(ir::NodeExtern {
        name: name.to_string(),
        site,
        props: props.into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
        slots,
        events: BTreeMap::new(),
        writes: BTreeMap::new(),
        levels: Vec::new(),
        fallback: Vec::new(),
    })
}

/// Text with any hole sentinels written back as holes would read.
fn unsentinel(s: &str, _holes: &[(ir::Expr, Ty, Span)]) -> String {
    s.chars().map(|c| if ('\u{E000}'..='\u{F8FF}').contains(&c) { '\u{FFFD}' } else { c }).collect()
}

#[derive(Default)]
struct Parts {
    props: BTreeMap<String, ir::Expr>,
    places: BTreeMap<String, ir::Place>,
    slots: BTreeMap<String, Vec<ir::Node>>,
    events: BTreeMap<String, String>,
}

// ---- slots' types and lengths, and a document widget's built Markdown

impl Checker {
    /// A slot with a widget type takes only calls of that type, through `for`, `if` and `match`;
    /// a length contract is checked here when the children are written out one by one.
    pub(crate) fn check_slot(&mut self, file: usize, widget: &str, slot: &crate::SlotSym, nodes: &[ir::Node], at: Span) {
        // the element type: a list's items, an opt's inside
        let mut el = &slot.ir;
        if matches!(el.name.as_str(), "core/list" | "core/opt") {
            if let Some(a) = el.args.first() {
                el = a;
            }
        }
        let want: Option<(String, Option<DefId>)> = match el.name.as_str() {
            "core/view" => None,
            "any" => el.interface.clone().map(|i| (i.clone(), self.defs.iter().position(|d| d.full == i))),
            name => self.defs.iter().any(|d| d.full == name && matches!(d.kind, DefKind::Widget { .. })).then(|| (name.to_string(), None)),
        };
        let mut calls = Vec::new();
        let mut one_by_one = true;
        collect_calls(nodes, &mut calls, &mut one_by_one);
        if let Some((name, iface)) = &want {
            for c in &calls {
                let ok = match (c, iface) {
                    (Some(called), Some(i)) => match self.defs.iter().position(|d| d.full == *called) {
                        Some(w) => self.accepts(&Ty::Any(*i, Vec::new()), &Ty::Def(w, self.defs[w].generics.iter().map(|_| Ty::Err).collect()), &[]).is_some(),
                        None => false,
                    },
                    (Some(called), None) => called == name,
                    (None, _) => false,
                };
                if !ok {
                    let short = name.rsplit('/').next().unwrap_or(name);
                    let what = match c {
                        Some(called) => format!("`{}`", called.rsplit('/').next().unwrap_or(called)),
                        None => "text or a view held in a value".into(),
                    };
                    let takes = if iface.is_some() { format!("widgets that fit `{}`", short) } else { format!("`{}` widgets", short) };
                    self.error(file, codes::SLOT_TYPE, at, format!("`{}`'s slot `{}` takes only {}, with `for`, `if` and `match` around them; {} can't go there", widget, slot.name, takes, what));
                    break;
                }
            }
        }
        // a length, when the children are written out one by one
        if one_by_one && slot.ir.name == "core/list" {
            if let Some(len) = slot.ir.contract.as_ref().and_then(|c| c.length.clone()) {
                let n = calls.len() as i64;
                let num = |x: &Option<ir::Expr>| match x {
                    Some(ir::Expr::Num(t)) => t.parse::<i64>().ok(),
                    _ => None,
                };
                let (lo, hi) = (num(&len.low), num(&len.high));
                if lo.map_or(false, |l| n < l) || hi.map_or(false, |h| n > h) {
                    let shown = crate::proof::show_contract(&slot.ir);
                    self.error(file, codes::SLOT_LENGTH, at, format!("`{}`'s slot `{}` is a {}, and {} {} written here", widget, slot.name, shown, n, if n == 1 { "is" } else { "are" }));
                }
            }
        }
    }

    /// A document widget with no `markdown` block: whether its view's branches read a variable,
    /// which its built Markdown, written with the starting values, can't follow.
    pub(crate) fn warn_built_markdown(&mut self, cx: &Cx, stmts: &[ast::Node<ast::Stmt>]) {
        for s in stmts {
            match &s.item {
                ast::Stmt::If(i) => {
                    for (c, b) in &i.branches {
                        let e = match c {
                            ast::Cond::Expr(e) => e,
                            ast::Cond::Open { value, .. } => value,
                        };
                        if self.reads_variable(cx, e) {
                            self.warning(cx.file, codes::BUILT_MARKDOWN, e.span, "this branch reads a variable, and the widget's Markdown is built from its view with the starting values: write a `markdown` block to say what it is either way");
                        }
                        self.warn_built_markdown(cx, &b.stmts);
                    }
                    if let Some(b) = &i.otherwise {
                        self.warn_built_markdown(cx, &b.stmts);
                    }
                }
                ast::Stmt::Match(m) => {
                    if self.reads_variable(cx, &m.subject) {
                        self.warning(cx.file, codes::BUILT_MARKDOWN, m.span, "this match reads a variable, and the widget's Markdown is built from its view with the starting values: write a `markdown` block to say what it is either way");
                    }
                    for c in m.cases.iter() {
                        self.warn_built_markdown(cx, &c.body.stmts);
                    }
                }
                ast::Stmt::For(f) => self.warn_built_markdown(cx, &f.body.stmts),
                ast::Stmt::Expr(ast::Expr { kind: ast::ExprKind::View(v), .. }) => match &v.block {
                    Some(ast::CallBlock::Children(b)) => self.warn_built_markdown(cx, &b.stmts),
                    Some(ast::CallBlock::Named(body)) => {
                        for entry in body.iter() {
                            if let ast::NamedEntry::Slot { block, .. } = entry {
                                self.warn_built_markdown(cx, &block.stmts);
                            }
                        }
                    }
                    None => {}
                },
                _ => {}
            }
        }
    }

    /// Whether an expression reads `$state`, the widget's own variable or a `mut` input.
    fn reads_variable(&self, cx: &Cx, e: &ast::Expr) -> bool {
        use ast::ExprKind as E;
        let r = |x: &ast::Expr| self.reads_variable(cx, x);
        match &e.kind {
            E::State => true,
            E::Name(n) => cx.local(&n.name).is_none() && cx.widget.as_ref().map_or(false, |w| w.cells.iter().any(|c| c.0 == n.name) || w.inputs.iter().any(|i| i.0 == n.name && i.2)),
            E::Paren(x) | E::Try(x) => r(x),
            E::Field { target, .. } => r(target),
            E::Index { target, index } => r(target) || r(index),
            E::Call { callee, args } => r(callee) || args.iter().any(|a| r(&a.value)),
            E::Case { target, args, .. } => r(target) || args.as_ref().map_or(false, |a| a.iter().any(|x| r(&x.value))),
            E::With { target, inits } => r(target) || inits.iter().any(|i| r(&i.value)),
            E::Record { inits, .. } => inits.iter().any(|i| r(&i.value)),
            E::List(items) => items.iter().any(|x| r(x)),
            E::Unary { operand, .. } => r(operand),
            E::Binary { left, right, .. } => r(left) || r(right),
            E::Ternary { cond, then, otherwise } => r(cond) || r(then) || r(otherwise),
            E::Range { low, high, step } => [low, high, step].iter().any(|x| x.as_ref().map_or(false, |x| r(x))),
            E::Text(t) => t.parts.iter().any(|p| matches!(p, ast::TextPart::Hole(h) if r(h))),
            _ => false,
        }
    }
}

/// The calls a slot is filled with, through loops and branches; `None` for anything that isn't
/// a call. Whether they are written out one by one, with no loop or branch around them.
fn collect_calls(nodes: &[ir::Node], out: &mut Vec<Option<String>>, one_by_one: &mut bool) {
    for n in nodes {
        match n {
            ir::Node::Extern(e) => out.push(Some(e.name.clone())),
            ir::Node::Use(u) => out.push(Some(u.name.clone())),
            ir::Node::Place(_) => out.push(None),
            ir::Node::For(f) => {
                *one_by_one = false;
                collect_calls(&f.body, out, one_by_one);
            }
            ir::Node::If(i) => {
                *one_by_one = false;
                for b in &i.branches {
                    collect_calls(&b.then, out, one_by_one);
                }
                collect_calls(&i.else_, out, one_by_one);
            }
            ir::Node::Match(m) => {
                *one_by_one = false;
                for c in &m.cases {
                    collect_calls(&c.then, out, one_by_one);
                }
                collect_calls(&m.else_, out, one_by_one);
            }
            ir::Node::Declare(_) => {}
        }
    }
}

/// Whether a sentence holds `$state.` outside a code span.
fn bare_state(text: &str) -> bool {
    let mut in_code = false;
    let chars: Vec<char> = text.chars().collect();
    for (k, c) in chars.iter().enumerate() {
        if *c == '`' {
            in_code = !in_code;
        } else if !in_code && *c == '$' && chars[k + 1..].iter().take(6).collect::<String>() == "state." && (k == 0 || chars[k - 1] != '\\') {
            return true;
        }
    }
    false
}

impl Checker {
    /// The properties a core sizing wrapper sets, as `sizing` names them; `None` for any other widget.
    fn sizing_props(&self, cx: &Cx, call: &ast::ViewCall) -> Option<Vec<(String, Span)>> {
        let d = self.widget_of(cx, &call.name.name)?;
        let full = self.defs[d].full.as_str();
        let given: Vec<(String, Span)> = call.args.as_ref().map(|a| a.iter().filter_map(|x| x.name.as_ref().map(|n| (n.name.clone(), n.span))).collect()).unwrap_or_default();
        let at = call.name.span;
        Some(match full {
            "core/grow" => vec![("grow".into(), at)],
            "core/shrink" => vec![("shrink".into(), at)],
            "core/basis" => vec![("basis".into(), at)],
            "core/aspect" => vec![("aspect".into(), at)],
            "core/min_size" => given.into_iter().map(|(n, s)| (format!("min_{}", n), s)).collect(),
            "core/max_size" => given.into_iter().map(|(n, s)| (format!("max_{}", n), s)).collect(),
            "core/sizing" => given,
            _ => return None,
        })
    }

    /// A chain of sizing wrappers around one child is one set of properties, so setting one
    /// property twice in it is an error (page 5).
    fn check_sizing_chain(&mut self, cx: &Cx, call: &ast::ViewCall) {
        let Some(mut props) = self.sizing_props(cx, call) else { return };
        let mut seen: Vec<String> = props.drain(..).map(|(n, _)| n).collect();
        let mut at = call.clone();
        loop {
            // the wrapper's one child, when it is another sizing wrapper
            let Some(ast::CallBlock::Children(b)) = &at.block else { return };
            if b.stmts.len() != 1 {
                return;
            }
            let ast::Stmt::Expr(ast::Expr { kind: E::View(inner), .. }) = &b.stmts[0].item else { return };
            let Some(more) = self.sizing_props(cx, inner) else { return };
            for (name, span) in more {
                if seen.contains(&name) {
                    if self.sizing_reported.insert((cx.file, span.start)) {
                        self.error(cx.file, codes::SIZING_TWICE, span, format!("`{}` is set twice in this chain of sizing wrappers, which is one set of properties on its child: keep one", name));
                    }
                } else {
                    seen.push(name);
                }
            }
            at = inner.clone();
        }
    }
}
