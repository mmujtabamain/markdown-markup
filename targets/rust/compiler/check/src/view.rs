//! Views: widget calls, slots, events and placed values, as the IR's nodes; widgets written in
//! MKP as templates; and markdown blocks, lowered onto core's Markdown blocks.

use crate::body::{Cx, LocalKind, WidgetCx};
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
                self.declare_local(cx, &v.name, ty, false, LocalKind::Plain);
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
        let site = self.site("s");
        let parts = self.call_parts(cx, d, call);
        let full = self.defs[d].full.clone();
        let external = matches!(self.defs[d].kind, DefKind::Widget { external: true, .. });
        if external {
            vec![ir::Node::Extern(ir::NodeExtern { name: full, site, props: parts.props, slots: parts.slots, events: parts.events, writes: parts.places, level: None, fallback: Vec::new() })]
        } else {
            let mut args = parts.props;
            for (k, p) in parts.places {
                args.insert(k, ir::Expr::Place(p));
            }
            vec![ir::Node::Use(ir::NodeUse { name: full, site, args, slots: parts.slots, events: parts.events, level: None, fallback: Vec::new() })]
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
                            parts.places.insert(n.name.clone(), p);
                        }
                        None => {
                            self.expr(cx, value, Some(&it));
                            self.error(file, codes::NOT_MUT, value.span, format!("`{}` is a `mut` input: give it a variable it can write, or leave it out", n.name));
                        }
                    }
                } else {
                    let (x, _) = self.expr(cx, value, Some(&it));
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
        for (name, block, _) in slot_blocks {
            let nodes = self.view_nodes(cx, &block);
            parts.slots.insert(name, nodes);
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
        let mut wcx = self.widget_cx(d);
        let DefKind::Widget { inputs, slots, events, .. } = self.defs[d].kind.clone() else { unreachable!() };
        // input defaults
        for i in &inputs {
            if let Some(def) = &i.default {
                let mut c = cx.clone();
                let (x, _) = self.expr(&mut c, def, Some(&i.ty));
                self.out.defaults.insert((d, i.name.clone()), x);
            }
        }
        let Some(body) = &w.body else { return };
        let mut cells = Vec::new();
        let mut requires = Vec::new();
        let mut fns = Vec::new();
        let mut view = Vec::new();
        let mut markdown = None;
        let mut prefix: Vec<ir::Node> = Vec::new();
        // own variables, lets and fns first, so the view sees them all
        for m in body.iter() {
            match m {
                ast::WidgetMember::Own(v) => {
                    let t = self.resolve(file, &v.ty, &cx.generics.clone());
                    wcx.cells.push((v.name.name.clone(), t));
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
                    cells.push(ir::Field { name: v.name.name.clone(), ty: ti, mutable: true, default: Some(x) });
                }
                ast::WidgetMember::Let(v) => {
                    let t = self.resolve(file, &v.ty, &cx.generics.clone());
                    let ti = self.ir_type(file, &v.ty, &cx.generics.clone());
                    let (x, _) = self.expr(&mut cx, &v.value, Some(&t));
                    self.declare_local(&mut cx, &v.name, t, false, LocalKind::Plain);
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
                        c.scopes.last_mut().unwrap().push(body::Local { name: p.name.clone(), ty: p.ty.clone(), mutable: p.mutable, kind: LocalKind::Plain });
                    }
                    c.ret = Some(s.ret.clone());
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
            level: ir::Level::CoreDraw,
        };
        self.out.templates.push((d, t));
    }

    /// Prose as nodes. Each run of text lines is a paragraph; core's Markdown parser turns its
    /// text into `rich_text` (phase 3), so here a paragraph keeps its pieces and its holes.
    pub(crate) fn prose_nodes(&mut self, cx: &mut Cx, prose: &ast::Prose) -> Vec<ir::Node> {
        let file = cx.file;
        let src = self.files[file].src.clone();
        let mut out = Vec::new();
        let mut para: Vec<&ast::TextLine> = Vec::new();
        let flush = |me: &mut Checker, cx: &mut Cx, para: &mut Vec<&ast::TextLine>, out: &mut Vec<ir::Node>| {
            if para.is_empty() {
                return;
            }
            let lines = std::mem::take(para);
            // a line that is only a hole holding a view places that view
            if lines.len() == 1 && lines[0].holes.len() == 1 {
                let l = lines[0];
                let h = &l.holes[0];
                if src[l.span.range()].trim() == &src[h.span.range()] {
                    let (x, t) = me.expr(cx, &h.expr, None);
                    let t = me.vars.resolve(&t);
                    let is_view = matches!(t, Ty::View | Ty::Any(..) | Ty::List(_) | Ty::Opt(_)) || matches!(&t, Ty::Def(d, _) if matches!(me.defs[*d].kind, DefKind::Widget { .. })) || matches!(&t, Ty::Param(_));
                    if is_view {
                        let site = me.site("m");
                        out.push(ir::Node::Place(ir::NodePlace { site, view: x }));
                        return;
                    }
                }
            }
            let mut pieces = Vec::new();
            let mut holes = Vec::new();
            let mut piece = String::new();
            for (k, l) in lines.iter().enumerate() {
                if k > 0 {
                    piece.push('\n');
                }
                let mut at = l.span.start as usize;
                for h in &l.holes {
                    piece.push_str(&src[at..h.span.start as usize]);
                    pieces.push(std::mem::take(&mut piece));
                    let (x, t) = me.expr(cx, &h.expr, None);
                    let t = me.vars.resolve(&t);
                    holes.push(if t == Ty::Text || matches!(t, Ty::View | Ty::Def(..)) && me.is_widget(&t) { x } else { ir::Expr::Show(Box::new(ir::ExprShow { value: x })) });
                    at = h.span.end as usize;
                }
                piece.push_str(&src[at..l.span.end as usize]);
            }
            pieces.push(piece);
            let site = me.site("m");
            let value = ir::Expr::Template(Box::new(ir::ExprTemplate { pieces, holes, ty: ir::Type::named("core/rich_text") }));
            let mut props = BTreeMap::new();
            props.insert("value".to_string(), value);
            out.push(ir::Node::Extern(ir::NodeExtern { name: "core/paragraph".into(), site, props, slots: BTreeMap::new(), events: BTreeMap::new(), writes: BTreeMap::new(), level: None, fallback: Vec::new() }));
        };
        for node in &prose.nodes {
            match node {
                ProseNode::Text(line) => {
                    if src[line.span.range()].trim().is_empty() {
                        flush(self, cx, &mut para, &mut out);
                    } else {
                        para.push(line);
                    }
                }
                other => {
                    flush(self, cx, &mut para, &mut out);
                    match other {
                        ProseNode::Fence(_) | ProseNode::Maths(_) => {}
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
                        ProseNode::Slot { .. } | ProseNode::Text(_) => {}
                    }
                }
            }
        }
        flush(self, cx, &mut para, &mut out);
        out
    }

    fn is_widget(&self, t: &Ty) -> bool {
        matches!(t, Ty::View) || matches!(t, Ty::Def(d, _) if matches!(self.defs[*d].kind, DefKind::Widget { .. }))
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

#[derive(Default)]
struct Parts {
    props: BTreeMap<String, ir::Expr>,
    places: BTreeMap<String, ir::Place>,
    slots: BTreeMap<String, Vec<ir::Node>>,
    events: BTreeMap<String, String>,
}
