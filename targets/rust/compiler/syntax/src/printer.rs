//! `mkp fmt`'s printer: the syntax tree back to text, in the canonical layout.
//!
//! Inside a line, spacing is always the canonical one. Across lines, the printer keeps what the
//! author chose where the spec leaves a choice: a list written over several lines stays over
//! several lines, a lambda or a case body written on one line stays on one, blank lines stay
//! (one at most), and a comment at the end of a line keeps its distance from the code. Prose is
//! printed as written, with its holes printed as code.

use crate::ast::*;
use crate::lexer::Comment;

pub fn print(src: &str, file: &File) -> String {
    let mut p = Printer { src, out: String::new(), indent: 0 };
    p.file(file);
    p.out
}

struct Printer<'a> {
    src: &'a str,
    out: String,
    indent: usize,
}

const STEP: usize = 4;

impl<'a> Printer<'a> {
    fn w(&mut self, s: &str) {
        self.out.push_str(s);
    }

    fn nl(&mut self) {
        self.out.push('\n');
    }

    fn ind(&mut self) {
        for _ in 0..self.indent {
            self.out.push(' ');
        }
    }

    fn column(&self) -> usize {
        let start = self.out.rfind('\n').map(|k| k + 1).unwrap_or(0);
        self.out[start..].chars().count()
    }

    fn at_block_start(&self) -> bool {
        let t = self.out.trim_end_matches(' ');
        t.is_empty() || t.ends_with("{\n") || t.ends_with("(\n") || t.ends_with("[\n")
    }

    fn leading(&mut self, leading: &[Leading]) {
        let mut blank = false;
        for l in leading {
            match l {
                Leading::Blank => blank = true,
                Leading::Comment(c) => {
                    if blank && !self.at_block_start() {
                        self.nl();
                    }
                    blank = false;
                    self.ind();
                    self.w(&c.text);
                    self.nl();
                }
            }
        }
        if blank && !self.at_block_start() {
            self.nl();
        }
    }

    fn trailing(&mut self, trailing: &[Comment]) {
        let mut col = None;
        for c in trailing {
            match col {
                None => {
                    for _ in 0..c.gap.max(1) {
                        self.out.push(' ');
                    }
                    col = Some(self.column());
                }
                Some(k) => {
                    self.nl();
                    for _ in 0..k {
                        self.out.push(' ');
                    }
                }
            }
            self.w(&c.text);
        }
    }

    /// Items one per line, each with its comments, at the current indent.
    fn lines<T>(&mut self, items: &[Node<T>], dangling: &[Leading], mut item: impl FnMut(&mut Self, &T)) {
        for n in items {
            self.leading(&n.leading);
            self.ind();
            item(self, &n.item);
            self.trailing(&n.trailing);
            self.nl();
        }
        self.leading(dangling);
    }

    fn body<T>(&mut self, b: &Body<T>, item: impl FnMut(&mut Self, &T)) {
        if b.items.is_empty() && b.open.is_empty() && !has_comment(&b.dangling) {
            self.w("{ }");
            return;
        }
        self.w("{");
        self.trailing(&b.open);
        self.nl();
        self.indent += STEP;
        self.lines(&b.items, &b.dangling, item);
        self.indent -= STEP;
        self.ind();
        self.w("}");
    }

    /// A comma-separated list in brackets. `spaced` puts a space inside braces: `{ a = 1 }`.
    fn group<T>(&mut self, g: &Group<T>, open: &str, close: &str, spaced: bool, mut item: impl FnMut(&mut Self, &T)) {
        let commented = !g.open.is_empty()
            || has_comment(&g.dangling)
            || g.items.iter().any(|n| !n.trailing.is_empty() || has_comment(&n.leading));
        if !g.multiline && !commented {
            self.w(open);
            if g.items.is_empty() {
                if spaced {
                    self.w(" ");
                }
            } else {
                if spaced {
                    self.w(" ");
                }
                for (k, n) in g.items.iter().enumerate() {
                    if k > 0 {
                        self.w(", ");
                    }
                    item(self, &n.item);
                }
                if spaced {
                    self.w(" ");
                }
            }
            self.w(close);
            return;
        }
        self.w(open);
        self.trailing(&g.open);
        self.indent += STEP;
        let mut after_comment = true;
        for (k, n) in g.items.iter().enumerate() {
            let own_line = k == 0 || n.newline || after_comment || has_comment(&n.leading) || n.leading.contains(&Leading::Blank);
            if own_line {
                self.nl();
                if has_comment(&n.leading) || n.leading.contains(&Leading::Blank) {
                    self.leading_in_group(&n.leading);
                }
                self.ind();
            } else {
                self.w(" ");
            }
            item(self, &n.item);
            self.w(",");
            self.trailing(&n.trailing);
            after_comment = !n.trailing.is_empty();
        }
        if has_comment(&g.dangling) {
            self.nl();
            let d: Vec<Leading> = g.dangling.iter().filter(|l| matches!(l, Leading::Comment(_))).cloned().collect();
            self.leading_in_group(&d);
            self.out.pop();
        }
        self.indent -= STEP;
        self.nl();
        self.ind();
        self.w(close);
    }

    /// Leading comments of an item in a list written over several lines; the line break
    /// before the item is already written.
    fn leading_in_group(&mut self, leading: &[Leading]) {
        let mut first = true;
        for l in leading {
            match l {
                Leading::Blank => {
                    if !first || !self.at_block_start() {
                        self.nl();
                    }
                }
                Leading::Comment(c) => {
                    self.ind();
                    self.w(&c.text);
                    self.nl();
                }
            }
            first = false;
        }
    }

    // ---- files

    fn file(&mut self, f: &File) {
        if let Some(fm) = f.front_matter {
            let text = self.src[fm.range()].to_string();
            self.w(&text);
            if !text.ends_with('\n') {
                self.nl();
            }
        }
        if let Some(pkg) = &f.package {
            self.leading(&pkg.leading);
            self.w("package ");
            self.w(&pkg.item.name);
            self.w(";");
            self.trailing(&pkg.trailing);
            self.nl();
        }
        self.lines(&f.items, &f.dangling, |p, item| p.item(item));
        if f.divider.is_some() {
            self.w("@@@\n");
        }
        if let Some(prose) = &f.prose {
            self.prose(prose, 0);
        }
    }

    fn item(&mut self, item: &Item) {
        match item {
            Item::Import(i) => {
                self.w("import ");
                let path: Vec<&str> = i.path.iter().map(|n| n.name.as_str()).collect();
                self.w(&path.join("."));
                if let Some(a) = &i.alias {
                    self.w(" as ");
                    self.w(&a.name);
                }
                self.w(";");
            }
            Item::Decl(d) => self.decl(&d.kind),
            Item::State(s) => {
                self.w("$state ");
                self.body(&s.members, |p, m| p.member(m));
            }
            Item::Expose(e) => {
                self.w("expose ");
                self.w(&e.name.name);
                self.w(" ");
                self.body(&e.fns, |p, f| p.fn_decl(f));
            }
            Item::Stmt(s) => self.stmt(s),
            Item::Field(f) => {
                self.field(f);
                self.w(";");
            }
            Item::Sig(s) => {
                self.fn_sig(s);
                self.w(";");
            }
        }
    }

    fn decl(&mut self, d: &DeclKind) {
        match d {
            DeclKind::Enum(e) => {
                self.w("enum ");
                self.w(&e.name.name);
                self.generics(&e.generics);
                self.w(" ");
                self.group(&e.cases, "{", "}", true, |p, c| p.case_decl(c));
            }
            DeclKind::Token(t) => {
                self.w("token ");
                self.w(&t.name.name);
                self.w(": ");
                self.ty(&t.ty);
                self.implements(&t.implements);
                self.w(" ");
                self.group(&t.cases, "{", "}", true, |p, c| p.case_decl(c));
            }
            DeclKind::Record(r) => {
                self.w("record ");
                self.w(&r.name.name);
                self.generics(&r.generics);
                self.implements(&r.implements);
                self.w(" ");
                self.body(&r.members, |p, m| p.member(m));
            }
            DeclKind::Alias(a) => {
                self.w("type ");
                self.w(&a.name.name);
                self.w(" = ");
                self.ty(&a.ty);
                self.w(";");
            }
            DeclKind::Interface(i) => {
                if i.widget {
                    self.w("widget ");
                }
                self.w("interface ");
                self.w(&i.name.name);
                self.generics(&i.generics);
                self.w(" ");
                self.body(&i.members, |p, m| match m {
                    IfaceMember::Field(f) => {
                        p.field(f);
                        p.w(";");
                    }
                    IfaceMember::Fn(s) => {
                        p.fn_sig(s);
                        p.w(";");
                    }
                    IfaceMember::Event(e) => p.event(e),
                });
            }
            DeclKind::Fn(f) => self.fn_decl(f),
            DeclKind::ExternFn(f) => {
                self.w("extern ");
                self.fn_sig(&f.sig);
                match &f.body {
                    Some(b) => {
                        self.w(" ");
                        self.block(b);
                    }
                    None => self.w(";"),
                }
            }
            DeclKind::Widget(w) => self.widget(w, false),
            DeclKind::ExternWidget(w) => self.widget(w, true),
            DeclKind::ExternBlock(e) => {
                self.w("extern ");
                self.w(&e.name.name);
                self.w(" ");
                self.body(&e.members, |p, m| {
                    match m {
                        ExternMember::Field(f) => p.field(f),
                        ExternMember::Fn(s) => p.fn_sig(s),
                    }
                    p.w(";");
                });
            }
            DeclKind::ExternType(t) => {
                self.w("extern type ");
                self.w(&t.name.name);
                self.generics(&t.generics);
                self.implements(&t.implements);
                self.w(";");
            }
            DeclKind::Pack(pk) => {
                self.w("pack ");
                self.w(&pk.name.name);
                self.w("@");
                self.w(&pk.version.name);
                self.w(" ");
                self.body(&pk.lines, |p, l| {
                    match l {
                        PackLine::Uses(refs) => {
                            p.w("uses ");
                            let s: Vec<String> = refs.iter().map(|r| format!("{}@{}", r.name.name, r.version.name)).collect();
                            p.w(&s.join(", "));
                        }
                        PackLine::Provides(names) => {
                            p.w("provides ");
                            let s: Vec<&str> = names.iter().map(|n| n.name.as_str()).collect();
                            p.w(&s.join(", "));
                        }
                        PackLine::Implements(refs) => {
                            p.w("implements ");
                            let s: Vec<String> =
                                refs.iter().map(|r| format!("{}.{}@{}", r.pack.name, r.level.name, r.version.name)).collect();
                            p.w(&s.join(", "));
                        }
                    }
                    p.w(";");
                });
            }
            DeclKind::Tokens(t) => {
                self.w("tokens ");
                self.w(&t.name.name);
                self.w(" ");
                self.body(&t.lines, |p, l| {
                    p.w(&l.ty.name);
                    p.w(".");
                    p.w(&l.case.name);
                    p.w(" = ");
                    p.expr(&l.value);
                    p.w(";");
                });
            }
            DeclKind::Let(v) => self.var("let", v),
        }
    }

    fn case_decl(&mut self, c: &CaseDecl) {
        self.w(&c.name.name);
        if let Some(fields) = &c.fields {
            self.group(fields, "(", ")", false, |p, f| p.field(f));
        }
    }

    fn member(&mut self, m: &Member) {
        match m {
            Member::Field(f) => {
                self.field(f);
                self.w(";");
            }
            Member::Require(r) => self.require(r),
        }
    }

    fn require(&mut self, r: &Require) {
        self.w("require ");
        self.text(&r.message);
        self.w(" ");
        self.block(&r.body);
    }

    fn event(&mut self, e: &EventDecl) {
        self.w("event ");
        self.w(&e.name.name);
        self.group(&e.params, "(", ")", false, |p, x| p.param(x));
        self.w(";");
    }

    fn var(&mut self, word: &str, v: &Var) {
        self.w(word);
        self.w(" ");
        self.w(&v.name.name);
        self.w(": ");
        self.ty(&v.ty);
        self.w(" = ");
        self.expr(&v.value);
        self.w(";");
    }

    fn fn_decl(&mut self, f: &FnDecl) {
        self.fn_sig(&f.sig);
        match &f.body {
            Some(b) => {
                self.w(" ");
                self.block(b);
            }
            None => self.w(";"),
        }
    }

    fn fn_sig(&mut self, s: &FnSig) {
        self.w("fn ");
        if let Some((on, g)) = &s.on {
            self.w(&on.name);
            self.generics(g);
            self.w(".");
        }
        self.w(&s.name.name);
        self.generics(&s.generics);
        self.group(&s.params, "(", ")", false, |p, x| p.param(x));
        self.ret(&s.ret);
    }

    fn ret(&mut self, r: &Option<RetType>) {
        match r {
            None => {}
            Some(RetType::Void(_)) => self.w(": void"),
            Some(RetType::Type(t)) => {
                self.w(": ");
                self.ty(t);
            }
        }
    }

    fn param(&mut self, x: &Param) {
        if x.mutable {
            self.w("mut ");
        }
        self.w(&x.name.name);
        if let Some(t) = &x.ty {
            self.w(": ");
            self.ty(t);
        }
    }

    fn field(&mut self, f: &Field) {
        if f.param {
            self.w("param ");
        }
        if f.mutable {
            self.w("mut ");
        }
        self.w(&f.name.name);
        self.w(": ");
        self.ty(&f.ty);
        if let Some(d) = &f.default {
            self.w(" = ");
            self.expr(d);
        }
    }

    fn widget(&mut self, w: &WidgetDecl, external: bool) {
        if external {
            self.w("extern ");
        }
        self.w("widget ");
        self.w(&w.name.name);
        self.generics(&w.generics);
        self.group(&w.inputs, "(", ")", false, |p, f| p.field(f));
        self.implements(&w.implements);
        match &w.body {
            None => self.w(";"),
            Some(b) => {
                self.w(" ");
                self.body(b, |p, m| p.widget_member(m));
            }
        }
    }

    fn widget_member(&mut self, m: &WidgetMember) {
        match m {
            WidgetMember::Param(f) => {
                self.field(f);
                self.w(";");
            }
            WidgetMember::Slot(s) => {
                self.w("slot ");
                self.w(&s.name.name);
                self.w(": ");
                self.ty(&s.ty);
                self.w(";");
            }
            WidgetMember::Event(e) => self.event(e),
            WidgetMember::Require(r) => self.require(r),
            WidgetMember::Own(v) => self.var("mut", v),
            WidgetMember::Let(v) => self.var("let", v),
            WidgetMember::Fn(f) => self.fn_decl(f),
            WidgetMember::View(b) => {
                self.w("view ");
                self.block(b);
            }
            WidgetMember::Markdown(md) => {
                if md.empty {
                    self.w("markdown { }");
                    return;
                }
                self.w("markdown {");
                self.nl();
                let base = self.indent + STEP;
                self.prose(&md.prose, base);
                self.ind();
                self.w("}");
            }
        }
    }

    fn generics(&mut self, g: &Option<Generics>) {
        let Some(g) = g else { return };
        self.w("<");
        for (k, t) in g.params.iter().enumerate() {
            if k > 0 {
                self.w(", ");
            }
            self.w(&t.name.name);
            for (j, b) in t.bounds.iter().enumerate() {
                self.w(if j == 0 { ": " } else { " + " });
                self.iface(b);
            }
        }
        self.w(">");
    }

    fn iface(&mut self, i: &IfaceRef) {
        self.w(&i.name.name);
        if !i.args.is_empty() {
            self.w("<");
            for (k, t) in i.args.iter().enumerate() {
                if k > 0 {
                    self.w(", ");
                }
                self.ty(t);
            }
            self.w(">");
        }
    }

    fn implements(&mut self, list: &[IfaceRef]) {
        for (k, i) in list.iter().enumerate() {
            self.w(if k == 0 { " implements " } else { ", " });
            self.iface(i);
        }
    }

    // ---- types

    fn ty(&mut self, t: &Type) {
        match &t.base {
            TypeBase::Named { name, args, length } => {
                self.w(&name.name);
                if let Some(args) = args {
                    self.w("<");
                    for (k, a) in args.iter().enumerate() {
                        if k > 0 {
                            self.w(", ");
                        }
                        self.ty(a);
                    }
                    self.w(">");
                }
                self.length(length);
            }
            TypeBase::Param { name, length } => {
                self.w(&name.name);
                self.length(length);
            }
            TypeBase::Any(i) => {
                self.w("any ");
                self.iface(i);
            }
            TypeBase::View => self.w("view"),
            TypeBase::SelfType => self.w("self"),
            TypeBase::Fn { params, ret } => {
                self.w("fn");
                self.group(params, "(", ")", false, |p, x| p.param(x));
                if let Some(r) = ret {
                    let r = Some((**r).clone());
                    self.ret(&r);
                }
            }
            TypeBase::Record(fields) => self.group(fields, "{", "}", true, |p, f| p.field(f)),
        }
        if let Some(c) = &t.contract {
            self.w(" ");
            match c {
                Contract::Range(r) => self.range_contract(r),
                Contract::Step(b) => {
                    self.w("step ");
                    self.bound(b);
                }
                Contract::Only(values) => {
                    self.w("only ");
                    self.group(values, "(", ")", false, |p, e| p.expr(e));
                }
            }
        }
    }

    fn length(&mut self, l: &Option<Length>) {
        match l {
            None => {}
            Some(Length::Exact(b)) => {
                self.w("[");
                self.bound(b);
                self.w("]");
            }
            Some(Length::Range(r)) => {
                self.w("[");
                self.range_contract(r);
                self.w("]");
            }
        }
    }

    fn range_contract(&mut self, r: &RangeContract) {
        match (&r.low, &r.high) {
            (Some(l), Some(h)) => {
                self.bound(l);
                self.w("..");
                self.bound(h);
            }
            (Some(l), None) => {
                self.bound(l);
                self.w("...");
            }
            (None, Some(h)) => {
                self.w("...");
                self.bound(h);
            }
            (None, None) => {}
        }
        if let Some(s) = &r.step {
            self.w(" step ");
            self.bound(s);
        }
    }

    fn bound(&mut self, b: &Bound) {
        match b {
            Bound::Number { negative, text, .. } => {
                if *negative {
                    self.w("-");
                }
                self.w(text);
            }
            Bound::Name(n) => self.w(&n.name),
            Bound::Expr(e) => self.expr(e),
        }
    }

    // ---- statements

    fn block(&mut self, b: &Block) {
        let quiet = b.open.is_empty() && !has_comment(&b.dangling) && b.stmts.iter().all(|n| n.trailing.is_empty() && !has_comment(&n.leading));
        if b.stmts.is_empty() && quiet {
            self.w("{ }");
            return;
        }
        let may_stay = matches!(b.kind, BlockKind::Lambda | BlockKind::Case) && b.one_line && quiet && b.stmts.iter().all(|n| simple(&n.item));
        if may_stay {
            self.w("{ ");
            for (k, n) in b.stmts.iter().enumerate() {
                if k > 0 {
                    self.w(" ");
                }
                self.stmt(&n.item);
            }
            self.w(" }");
            return;
        }
        self.w("{");
        self.trailing(&b.open);
        self.nl();
        self.indent += STEP;
        self.lines(&b.stmts, &b.dangling, |p, s| p.stmt(s));
        self.indent -= STEP;
        self.ind();
        self.w("}");
    }

    fn stmt(&mut self, s: &Stmt) {
        match s {
            Stmt::Let(v) => self.var("let", v),
            Stmt::Mut(v) => self.var("mut", v),
            Stmt::Return(e) => {
                self.w("return");
                if let Some(e) = e {
                    self.w(" ");
                    self.expr(e);
                }
                self.w(";");
            }
            Stmt::Invoke { name, args } => {
                self.w("invoke ");
                self.w(&name.name);
                self.args(args);
                self.w(";");
            }
            Stmt::If(i) => {
                for (k, (c, b)) in i.branches.iter().enumerate() {
                    self.w(if k == 0 { "if (" } else { " else if (" });
                    self.cond(c);
                    self.w(") ");
                    self.block(b);
                }
                if let Some(b) = &i.otherwise {
                    self.w(" else ");
                    self.block(b);
                }
            }
            Stmt::For(f) => {
                if f.mutable {
                    self.w("mut ");
                }
                self.w("for (");
                self.loop_head(&f.key, &f.name, &f.over);
                self.w(") ");
                self.block(&f.body);
            }
            Stmt::Match(m) => {
                self.w("match (");
                self.expr(&m.subject);
                self.w(") ");
                self.body(&m.cases, |p, c| {
                    p.w("case ");
                    p.patterns(&c.patterns);
                    p.w(" ");
                    p.block(&c.body);
                });
            }
            Stmt::Expr(e) => {
                self.expr(e);
                let blocked = matches!(&e.kind, ExprKind::View(v) if v.block.is_some());
                if !blocked {
                    self.w(";");
                }
            }
            Stmt::Assign { place, value } => {
                self.expr(place);
                self.w(" = ");
                self.expr(value);
                self.w(";");
            }
        }
    }

    fn loop_head(&mut self, key: &Option<Ident>, name: &Ident, over: &Expr) {
        if let Some(k) = key {
            self.w(&k.name);
            self.w(", ");
        }
        self.w(&name.name);
        self.w(" in ");
        self.expr(over);
    }

    fn cond(&mut self, c: &Cond) {
        match c {
            Cond::Expr(e) => self.expr(e),
            Cond::Open { mutable, name, ty, value } => {
                self.w(if *mutable { "mut " } else { "let " });
                self.w(&name.name);
                self.w(": ");
                self.ty(ty);
                self.w(" = ");
                self.expr(value);
            }
        }
    }

    fn patterns(&mut self, pats: &[Pattern]) {
        if pats.is_empty() {
            self.w("else");
            return;
        }
        for (k, pat) in pats.iter().enumerate() {
            if k > 0 {
                self.w(", ");
            }
            match pat {
                Pattern::Case { ty, case, binds } => {
                    self.w(&ty.name);
                    self.w(".");
                    self.w(&case.name);
                    if let Some(b) = binds {
                        let names: Vec<&str> = b.iter().map(|n| n.name.as_str()).collect();
                        self.w("(");
                        self.w(&names.join(", "));
                        self.w(")");
                    }
                }
                Pattern::Number { negative, text, .. } => {
                    if *negative {
                        self.w("-");
                    }
                    self.w(text);
                }
                Pattern::Text(t) => self.text(t),
                Pattern::Bool(b, _) => self.w(if *b { "true" } else { "false" }),
            }
        }
    }

    // ---- expressions

    fn args(&mut self, g: &Group<Arg>) {
        self.group(g, "(", ")", false, |p, a| {
            if let Some(n) = &a.name {
                p.w(&n.name);
                p.w(" = ");
            }
            p.expr(&a.value);
        });
    }

    fn inits(&mut self, g: &Group<Init>) {
        self.group(g, "{", "}", true, |p, i| {
            if i.mutable {
                p.w("mut ");
            }
            p.w(&i.name.name);
            p.w(" = ");
            p.expr(&i.value);
        });
    }

    fn text(&mut self, t: &TextLit) {
        self.w("\"");
        for part in &t.parts {
            match part {
                TextPart::Piece { raw, .. } => self.w(raw),
                TextPart::Hole(e) => {
                    self.w("\\{");
                    self.expr(e);
                    self.w("}");
                }
            }
        }
        self.w("\"");
    }

    pub(crate) fn expr(&mut self, e: &Expr) {
        match &e.kind {
            ExprKind::Number(n) | ExprKind::Duration(n) => self.w(n),
            ExprKind::Text(t) => self.text(t),
            ExprKind::Bool(b) => self.w(if *b { "true" } else { "false" }),
            ExprKind::SelfValue => self.w("self"),
            ExprKind::State => self.w("$state"),
            ExprKind::Name(n) => self.w(&n.name),
            ExprKind::Paren(inner) => {
                self.w("(");
                self.expr(inner);
                self.w(")");
            }
            ExprKind::List(items) => self.group(items, "[", "]", false, |p, x| p.expr(x)),
            ExprKind::Record { ty, inits } => {
                if let Some(t) = ty {
                    self.w(&t.name);
                    self.w(" ");
                }
                self.inits(inits);
            }
            ExprKind::Field { target, name } => {
                self.expr(target);
                self.w(".");
                self.w(&name.name);
            }
            ExprKind::Case { target, name, args } => {
                self.expr(target);
                self.w(".");
                self.w(&name.name);
                if let Some(a) = args {
                    self.args(a);
                }
            }
            ExprKind::Index { target, index } => {
                self.expr(target);
                self.w("[");
                self.expr(index);
                self.w("]");
            }
            ExprKind::Call { callee, args } => {
                self.expr(callee);
                self.args(args);
            }
            ExprKind::With { target, inits } => {
                self.expr(target);
                self.w(" with ");
                self.inits(inits);
            }
            ExprKind::Unary { op, operand } => {
                self.w(match op {
                    UnOp::Not => "!",
                    UnOp::Neg => "-",
                });
                self.expr(operand);
            }
            ExprKind::Binary { op, left, right } => {
                self.expr(left);
                self.w(" ");
                self.w(op.text());
                self.w(" ");
                self.expr(right);
            }
            ExprKind::Ternary { cond, then, otherwise } => {
                self.expr(cond);
                self.w(" ? ");
                self.expr(then);
                self.w(" : ");
                self.expr(otherwise);
            }
            ExprKind::Range { low, high, step } => {
                match (low, high) {
                    (Some(l), Some(h)) => {
                        self.expr(l);
                        self.w("..");
                        self.expr(h);
                    }
                    (Some(l), None) => {
                        self.expr(l);
                        self.w("...");
                    }
                    (None, Some(h)) => {
                        self.w("...");
                        self.expr(h);
                    }
                    (None, None) => {}
                }
                if let Some(s) = step {
                    self.w(" step ");
                    self.expr(s);
                }
            }
            ExprKind::Try(inner) => {
                self.w("try ");
                self.expr(inner);
            }
            ExprKind::Lambda(l) => {
                self.w("fn");
                self.group(&l.params, "(", ")", false, |p, x| p.param(x));
                self.ret(&l.ret);
                self.w(" ");
                self.block(&l.body);
            }
            ExprKind::View(v) => self.view_call(v),
        }
    }

    fn view_call(&mut self, v: &ViewCall) {
        self.w("@");
        self.w(&v.name.name);
        if let Some(a) = &v.args {
            self.args(a);
        }
        match &v.block {
            None => {}
            Some(CallBlock::Children(b)) => {
                self.w(" ");
                self.block(b);
            }
            Some(CallBlock::Named(body)) => {
                self.w(" ");
                self.body(body, |p, e| match e {
                    NamedEntry::Input { name, value } => {
                        p.w(&name.name);
                        p.w(" = ");
                        p.expr(value);
                        p.w(";");
                    }
                    NamedEntry::Slot { name, block } => {
                        p.w(&name.name);
                        p.w(" ");
                        p.block(block);
                    }
                });
            }
        }
    }

    // ---- prose

    fn prose_line(&mut self, line: &TextLine, base: usize) {
        let raw = &self.src[line.span.range()];
        if raw.trim().is_empty() {
            self.nl();
            return;
        }
        for _ in 0..base {
            self.out.push(' ');
        }
        let mut at = line.span.start as usize;
        for h in &line.holes {
            let piece = self.src[at..h.span.start as usize].to_string();
            self.w(&piece);
            self.w("\\{");
            self.expr(&h.expr);
            self.w("}");
            at = h.span.end as usize;
        }
        let rest = self.src[at..line.span.end as usize].to_string();
        self.w(&rest);
        self.nl();
    }

    fn mkp_line_start(&mut self, base: usize, indent: &str) {
        for _ in 0..base {
            self.out.push(' ');
        }
        self.w(indent);
    }

    fn close_line(&mut self, base: usize, indent: &str, text: &str) {
        self.mkp_line_start(base, indent);
        self.w(text);
        self.nl();
    }

    fn prose(&mut self, prose: &Prose, base: usize) {
        let saved = self.indent;
        for node in &prose.nodes {
            match node {
                ProseNode::Text(line) => self.prose_line(line, base),
                ProseNode::Fence(lines) => {
                    for l in lines {
                        let raw = self.src[l.span.range()].to_string();
                        if raw.trim().is_empty() {
                            self.nl();
                        } else {
                            for _ in 0..base {
                                self.out.push(' ');
                            }
                            self.w(&raw);
                            self.nl();
                        }
                    }
                }
                ProseNode::Maths(lines) => {
                    for l in lines {
                        self.prose_line(l, base);
                    }
                }
                ProseNode::Comment { indent, span } => {
                    self.mkp_line_start(base, indent);
                    let raw = self.src[span.range()].trim_end().to_string();
                    self.w(&raw);
                    self.nl();
                }
                ProseNode::Call(c) => {
                    self.mkp_line_start(base, &c.indent);
                    self.indent = base + c.indent.len();
                    self.view_call(&c.call);
                    match &c.block {
                        None => {
                            self.w(";");
                            self.nl();
                        }
                        Some((body, close)) => {
                            self.w(" {");
                            self.nl();
                            self.prose(body, base);
                            self.close_line(base, close, "}");
                        }
                    }
                }
                ProseNode::If { indent, branches, otherwise, .. } => {
                    self.mkp_line_start(base, indent);
                    self.indent = base + indent.len();
                    for (k, (cond, body, close)) in branches.iter().enumerate() {
                        if k == 0 {
                            self.w("@if (");
                        }
                        self.cond(cond);
                        self.w(") {");
                        self.nl();
                        self.prose(body, base);
                        self.mkp_line_start(base, close);
                        if k + 1 < branches.len() {
                            self.w("} else if (");
                        } else if otherwise.is_some() {
                            self.w("} else {");
                            self.nl();
                        } else {
                            self.w("}");
                            self.nl();
                        }
                    }
                    if let Some((body, close)) = otherwise {
                        self.prose(body, base);
                        self.close_line(base, close, "}");
                    }
                }
                ProseNode::For { indent, mutable, key, name, over, body, close, .. } => {
                    self.mkp_line_start(base, indent);
                    self.indent = base + indent.len();
                    self.w(if *mutable { "@mut for (" } else { "@for (" });
                    self.loop_head(key, name, over);
                    self.w(") {");
                    self.nl();
                    self.prose(body, base);
                    self.close_line(base, close, "}");
                }
                ProseNode::Match { indent, subject, cases, close, .. } => {
                    self.mkp_line_start(base, indent);
                    self.indent = base + indent.len();
                    self.w("@match (");
                    self.expr(subject);
                    self.w(") {");
                    self.nl();
                    for c in cases {
                        self.mkp_line_start(base, &c.indent);
                        self.w("case ");
                        self.patterns(&c.patterns);
                        self.w(" {");
                        self.nl();
                        self.prose(&c.body, base);
                        self.close_line(base, &c.close, "}");
                    }
                    self.close_line(base, close, "}");
                }
                ProseNode::Slot { indent, name, body, close, .. } => {
                    self.mkp_line_start(base, indent);
                    self.w("@slot ");
                    self.w(&name.name);
                    self.w(" {");
                    self.nl();
                    self.prose(body, base);
                    self.close_line(base, close, "}");
                }
            }
            self.indent = saved;
        }
    }
}

fn has_comment(leading: &[Leading]) -> bool {
    leading.iter().any(|l| matches!(l, Leading::Comment(_)))
}

/// A statement that may stay on one line inside a one-line lambda or case body.
fn simple(s: &Stmt) -> bool {
    match s {
        Stmt::If(_) | Stmt::For(_) | Stmt::Match(_) => false,
        Stmt::Expr(e) => !matches!(&e.kind, ExprKind::View(v) if v.block.is_some()),
        _ => true,
    }
}
