//! One migration applied to one file: each use of a changed declaration is read as a call (its
//! arguments, its block, the widgets put around it), the block's statements are applied to it in
//! order, and it is written back. Other references (types, imports, field reads, cases, fn calls)
//! are renamed where they are. Every edit is at a span the checker found.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{IsTerminal, Write};

use mkp_check::{FoundRef, Source};
use mkp_syntax::ast::{self, DeclKind, Expr, ExprKind, Item, MigrationItem, MigrationStmt, Stmt, WidgetMember};
use mkp_syntax::printer::print_expr;
use mkp_syntax::{parse, Entry, Lines, Span};

/// A text edit: what's between `start` and `end` becomes `text`.
#[derive(Debug, Clone)]
pub(crate) struct Edit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// The edits, with an edit inside a larger one left to that one.
pub(crate) fn apply(text: &str, edits: &[Edit]) -> String {
    let mut sorted: Vec<&Edit> = edits.iter().collect();
    sorted.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
    let mut out = String::new();
    let mut at = 0;
    for e in sorted {
        if e.start < at || (e.start == at && e.end == e.start && out.ends_with(&e.text) && !e.text.is_empty() && false) {
            continue;
        }
        out.push_str(&text[at..e.start]);
        out.push_str(&e.text);
        at = e.end;
    }
    out.push_str(&text[at..]);
    out
}

/// The edits inside `span`, applied to that part of the text.
fn within(text: &str, span: (usize, usize), edits: &[Edit]) -> String {
    let inner: Vec<Edit> = edits.iter().filter(|e| e.start >= span.0 && e.end <= span.1 && !(e.start == span.0 && e.end == span.1)).map(|e| Edit { start: e.start - span.0, end: e.end - span.0, text: e.text.clone() }).collect();
    apply(&text[span.0..span.1], &inner)
}

pub(crate) struct Step<'a> {
    pub text: &'a str,
    pub doc: &'a str,
    pub refs: &'a [FoundRef],
    pub pack: &'a str,
    pub step: &'a ast::MigrationDecl,
    pub label: &'a str,
    /// The pack's migration fns, by name.
    pub fns: &'a BTreeMap<String, ast::MigrationFn>,
    /// The surface the file is written for, and the pack's files at the version it moves to.
    pub old: &'a [Source],
    pub new: &'a [Source],
    /// A document, whose calls below `@@@` are prose; a pack's file has none.
    pub prose: bool,
}

#[derive(Default)]
pub(crate) struct Done {
    pub edits: Vec<Edit>,
    pub changes: usize,
    pub deletions: Vec<String>,
    pub notices: Vec<String>,
    pub refused: Vec<String>,
    /// What `--allow-todos` left for a person, each with a TODO above it.
    pub todos: Vec<String>,
    /// Where those TODOs go, and what each says: placed once the other edits are known.
    pending: Vec<(usize, String)>,
}

/// One statement, with migration fns' calls replaced by their bodies.
#[derive(Clone, Debug)]
enum Op {
    Call(String, Vec<(String, Expr)>),
    Execute(ast::Block),
    Event(String, Vec<Op>),
}

/// One argument of a use, as MKP's parser read it: its name, its value (with the edits inside it
/// made), and the comments around it.
#[derive(Clone, Debug)]
struct UseArg(String, String, Notes);

/// The comments around an argument, and whether it starts a line of its own.
#[derive(Clone, Debug, Default)]
struct Notes {
    leading: Vec<String>,
    trailing: Vec<(u32, String)>,
    newline: bool,
}

impl UseArg {
    fn new(name: impl Into<String>, value: impl Into<String>) -> UseArg {
        UseArg(name.into(), value.into(), Notes::default())
    }
}

/// A use as a call: `@name(args) { block }`, or a record literal `name { args }`.
#[derive(Clone, Debug)]
struct Use {
    name: String,
    args: Vec<UseArg>,
    /// Written over several lines: kept so, one argument a line, each with its comments.
    multiline: bool,
    /// The indentation of the line the use starts on.
    indent: String,
    parens: bool,
    block: Option<String>,
    record: bool,
    wrappers: Vec<(String, Vec<(String, String)>)>,
    /// What an execute returned, written as it stands, or `Some(None)` to remove the use.
    replaced: Option<Option<String>>,
    /// The spans of its argument names, which the use's own rendering renames.
    arg_names: Vec<(usize, usize)>,
    /// Why it was removed, for the comment it stays as.
    why: String,
}

/// What a declaration is in one version: its inputs (name, type's name, default), slots and
/// events (name, parameters as written).
#[derive(Default, Debug, Clone)]
struct DeclInfo {
    inputs: Vec<(String, Option<String>, Option<Expr>)>,
    slots: Vec<String>,
    events: Vec<(String, Vec<(String, String)>)>,
}

fn decl_info(srcs: &[Source], name: &str) -> Option<DeclInfo> {
    for s in srcs {
        let Some(f) = parse(&s.text, Entry::Mkp).file else { continue };
        for n in &f.items {
            let Item::Decl(d) = &n.item else { continue };
            let ty_name = |t: &ast::Type| match &t.base {
                ast::TypeBase::Named { name, .. } => Some(name.name.clone()),
                _ => None,
            };
            match &d.kind {
                DeclKind::Widget(w) | DeclKind::ExternWidget(w) if w.name.name == name => {
                    let mut info = DeclInfo { inputs: w.inputs.iter().map(|i| (i.name.name.clone(), ty_name(&i.ty), i.default.clone())).collect(), ..DeclInfo::default() };
                    for m in w.body.iter().flat_map(|b| b.iter()) {
                        match m {
                            WidgetMember::Slot(sl) => info.slots.push(sl.name.name.clone()),
                            WidgetMember::Event(e) => info.events.push((e.name.name.clone(), e.params.iter().map(|p| (p.name.name.clone(), p.ty.as_ref().map(|t| s.text[t.span.range()].to_string()).unwrap_or_default())).collect())),
                            _ => {}
                        }
                    }
                    return Some(info);
                }
                DeclKind::Record(r) if r.name.name == name => {
                    let inputs = r.members.iter().filter_map(|m| if let ast::Member::Field(f) = m { Some((f.name.name.clone(), ty_name(&f.ty), f.default.clone())) } else { None }).collect();
                    return Some(DeclInfo { inputs, ..DeclInfo::default() });
                }
                _ => {}
            }
        }
    }
    None
}

impl<'a> Step<'a> {
    pub(crate) fn run(&self) -> Done {
        let mut done = Done::default();
        let lines = Lines::new(self.text);
        let line_of = |at: usize| lines.place(at as u32).line as usize;
        let prose_from = if self.prose { self.text.find("\n@@@\n").map(|i| i + 5).or_else(|| self.text.starts_with("@@@\n").then_some(4)).unwrap_or(0) } else { usize::MAX };
        let mut edits: Vec<Edit> = Vec::new();
        // where each call in prose ends, its block and closing line included, as the parser read it
        let prose_calls = if self.prose { prose_call_ends(self.text) } else { BTreeMap::new() };
        // what each block does, and the uses of its declaration
        struct Plan<'r> {
            key: String,
            full: String,
            ops: Vec<Op>,
            old: DeclInfo,
            new: DeclInfo,
            now: String,
            renamed: BTreeMap<String, String>,
            uses: Vec<&'r FoundRef>,
        }
        let mut plans: Vec<Plan> = Vec::new();
        for item in self.step.items.iter() {
            let MigrationItem::Block(b) = item else { continue };
            let key = b.path.iter().map(|i| i.name.as_str()).collect::<Vec<_>>().join(".");
            let full = format!("{}/{}", self.pack, key);
            if !self.refs.iter().any(|r| r.decl == full) {
                continue;
            }
            let mut ops = Vec::new();
            flatten(&b.body, self.fns, &BTreeMap::new(), &mut ops, 0);
            if b.kind.name == "fn" {
                self.fn_block(&key, &full, &ops, &mut edits, &mut done, &line_of);
                continue;
            }
            let old = decl_info(self.old, &key).unwrap_or_default();
            // the declaration's name and members as they end up, for references outside uses
            let mut now = key.clone();
            let mut renamed: BTreeMap<String, String> = BTreeMap::new();
            for op in &ops {
                match op {
                    Op::Call(o, args) if o == "rename" => match (member(args), arg_name(args, "to")) {
                        (Some(m), Some(to)) => {
                            let first = renamed.iter().find(|(_, v)| **v == m).map(|(k, _)| k.clone()).unwrap_or(m);
                            renamed.insert(first, to);
                        }
                        (None, Some(to)) if !args.iter().any(|(n, _)| n == "from") => now = to,
                        _ => {}
                    },
                    Op::Event(e, inner) => {
                        for i in inner {
                            if let Op::Call(o, a) = i {
                                if o == "rename" {
                                    if let Some(to) = arg_name(a, "to") {
                                        renamed.insert(e.clone(), to);
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            let new = decl_info(self.new, &now).unwrap_or_default();
            let uses: Vec<&FoundRef> = self.refs.iter().filter(|r| r.decl == full && r.member.is_none() && is_use(&self.text[r.whole.range()], &key)).collect();
            plans.push(Plan { key, full, ops, old, new, now, renamed, uses });
        }
        // a use's own argument names are its rendering's to rename, not a point edit's
        let mut arg_spans: BTreeSet<(usize, usize)> = BTreeSet::new();
        for plan in &plans {
            for u in &plan.uses {
                if let Some(m) = read_use(self.text, u.whole.start as usize, u.whole.end as usize, &[]) {
                    arg_spans.extend(m.arg_names.iter().copied());
                }
            }
        }
        // every other reference renamed where it is: a type, an import, a field read, a case
        for plan in &plans {
            for r in self.refs.iter().filter(|r| r.decl == plan.full) {
                let (s, e) = (r.at.start as usize, r.at.end as usize);
                if arg_spans.contains(&(s, e)) || plan.uses.iter().any(|u| u.at == r.at) {
                    continue;
                }
                let here = &self.text[s..e];
                let to = match (&r.member, r.case) {
                    (None, _) if here == plan.key && plan.now != plan.key => Some(plan.now.clone()),
                    (Some(m), false) if here == m => plan.renamed.get(m).cloned(),
                    (Some(c), true) if here == c => self.case_rename(&plan.ops, c, s, &mut done, &line_of),
                    _ => None,
                };
                if let Some(to) = to {
                    if to != here {
                        done.changes += 1;
                        edits.push(Edit { start: s, end: e, text: to });
                    }
                }
            }
        }
        // then every use, innermost first, so a use around another writes the inner one as changed
        let mut all: Vec<(usize, &FoundRef)> = plans.iter().enumerate().flat_map(|(k, p)| p.uses.iter().map(move |u| (k, *u))).collect();
        all.sort_by_key(|(_, u)| u.whole.end - u.whole.start);
        for (k, u) in all {
            let plan = &plans[k];
            let (ws, mut we) = (u.whole.start as usize, u.whole.end as usize);
            let prose = ws >= prose_from && self.text[..ws].rsplit('\n').next().map_or(true, |l| l.trim().is_empty());
            // a call in prose: its block runs to its closing line, and its `;` ends it
            let line_end = self.text[we..].find('\n').map(|i| we + i).unwrap_or(self.text.len());
            let tail = self.text[we..line_end].trim_end();
            let mut semi = false;
            if prose && tail.trim() == "{" {
                if let Some(end) = prose_calls.get(&ws) {
                    we = *end;
                }
            } else if tail.starts_with(';') && self.text[ws..].starts_with('@') {
                // a call's `;` is its own, and goes with it if it gets a block; a record's is the
                // statement's
                we += 1;
                semi = true;
            }
            let Some(mut model) = read_use(self.text, ws, we, &edits) else {
                self.cannot(&mut done, ws, format!("a use of {} written in a way {} can't read yet", plan.key, self.label), &line_of);
                continue;
            };
            let before = render(&model, false);
            let mut said = Vec::new();
            let mut failed = None;
            for op in &plan.ops {
                if let Err(why) = self.apply_op(op, &mut model, &plan.old, &plan.new, &plan.key, ws, &mut done, &mut said, &line_of) {
                    failed = Some(why);
                    break;
                }
            }
            done.notices.extend(said);
            // a use the statements can't finish is left as it was
            if let Some(why) = failed {
                self.cannot(&mut done, ws, why, &line_of);
                continue;
            }
            let after = match &model.replaced {
                Some(None) => {
                    done.deletions.push(format!("{}:{}  {} (kept as a comment){}", self.doc, line_of(ws), first_line(&self.text[ws..u.whole.end as usize]), model.why));
                    comment_out(&self.text[ws..we], &self.text[..ws], prose, &format!("{} dropped {}{}", self.label, plan.key, model.why))
                }
                _ => {
                    let t = render(&model, prose);
                    if semi && !t.ends_with('}') {
                        format!("{};", t)
                    } else {
                        t
                    }
                }
            };
            let before = if semi { format!("{};", before) } else { before };
            // a use the statements leave as it was isn't written again: the edits inside it stand
            if after != before || model.replaced.is_some() {
                done.changes += 1;
                edits.push(Edit { start: ws, end: we, text: after });
            }
        }
        for (at, why) in std::mem::take(&mut done.pending) {
            place_todo(self.text, &mut edits, at, prose_from, &why);
        }
        done.edits = edits;
        done
    }

    /// What a statement can't do to the code at `at`: the file is refused, or with `--allow-todos`, the
    /// code is left as it was with a TODO above it.
    fn cannot(&self, done: &mut Done, at: usize, why: String, line_of: &dyn Fn(usize) -> usize) {
        self.cannot_with(done, at, why.clone(), why, line_of);
    }

    /// As `cannot`, where the TODO says it for the file and `why` for the run.
    fn cannot_with(&self, done: &mut Done, at: usize, why: String, todo: String, line_of: &dyn Fn(usize) -> usize) {
        if TODO.load(std::sync::atomic::Ordering::Relaxed) {
            done.todos.push(format!("line {}: {}", line_of(at), todo));
            done.pending.push((at, todo));
        } else {
            done.refused.push(format!("line {}: {}", line_of(at), why));
        }
    }

    /// A case's new name: one `rename(from = …)` gives, or the one a person picks for `split`.
    fn case_rename(&self, ops: &[Op], case: &str, at: usize, done: &mut Done, line_of: &dyn Fn(usize) -> usize) -> Option<String> {
        for op in ops {
            let Op::Call(o, args) = op else { continue };
            let from = args.iter().find(|(n, _)| n == "from").and_then(|(_, v)| case_of(v));
            if from.as_deref() != Some(case) {
                continue;
            }
            match o.as_str() {
                "rename" => return args.iter().find(|(n, _)| n == "to").and_then(|(_, v)| case_of(v)),
                "split" => {
                    let options: Vec<String> = match args.iter().find(|(n, _)| n == "to").map(|(_, v)| &v.kind) {
                        Some(ExprKind::List(xs)) => xs.iter().filter_map(case_of).collect(),
                        _ => Vec::new(),
                    };
                    let why = args.iter().find(|(n, _)| n == "why").map(|(_, v)| literal_text(v)).unwrap_or_default();
                    let key = format!("{}:{} {}", self.doc, line_of(at), case);
                    match ask(&key, &format!("{}:{} uses {}, which {} replaces{}", self.doc, line_of(at), case, self.label, if why.is_empty() { String::new() } else { format!(": {}", why) }), &options) {
                        Some(pick) => return Some(pick),
                        None => {
                            let why_said = why.clone();
                            let why = format!("{} splits {} into {}, and only a person knows which this one is: run mkp migrate in a terminal, or answer it in --answers as [split] \"{}\" = \"{}\"", self.label, case, options.join(", "), key, options.first().cloned().unwrap_or_default());
                            let todo = format!("{} splits {} into {}: write the one this is{}", self.label, case, options.join(" or "), if why_said.is_empty() { String::new() } else { format!(" ({})", why_said) });
                            self.cannot_with(done, at, why, todo, line_of);
                            return None;
                        }
                    }
                }
                _ => {}
            }
        }
        None
    }

    /// A fn's block: its calls renamed, and arguments added in the place the newer one has them.
    fn fn_block(&self, key: &str, full: &str, ops: &[Op], edits: &mut Vec<Edit>, done: &mut Done, line_of: &dyn Fn(usize) -> usize) {
        let old_name = key.rsplit('.').next().unwrap_or(key).to_string();
        for r in self.refs.iter().filter(|r| r.decl == full) {
            let (s, e) = (r.at.start as usize, r.at.end as usize);
            if self.text[s..e] != old_name {
                continue;
            }
            for op in ops {
                let Op::Call(o, args) = op else { continue };
                match o.as_str() {
                    "rename" => {
                        if let Some(to) = arg_name(args, "to") {
                            done.changes += 1;
                            edits.push(Edit { start: s, end: e, text: to });
                        }
                    }
                    "add" => {
                        let Some(v) = args.iter().find(|(n, _)| n == "value").map(|(_, v)| print_expr(v)) else { continue };
                        let open = self.text[e..].find('(').map(|i| e + i);
                        match open.and_then(|o| matching(self.text, o).map(|c| (o, c))) {
                            Some((o, c)) => {
                                let inner = self.text[o + 1..c].trim();
                                done.changes += 1;
                                edits.push(Edit { start: c, end: c, text: if inner.is_empty() { v } else { format!(", {}", v) } });
                            }
                            None => self.cannot(done, s, format!("{} adds an argument to {}, and this call can't be read", self.label, key), line_of),
                        }
                    }
                    "drop" | "set" | "move" => self.cannot(done, s, format!("{} changes {}'s arguments ({}): change this call yourself", self.label, key, o), line_of),
                    _ => {}
                }
            }
        }
    }

    /// One statement applied to a use.
    #[allow(clippy::too_many_arguments)]
    fn apply_op(&self, op: &Op, u: &mut Use, old: &DeclInfo, new: &DeclInfo, key: &str, at: usize, done: &mut Done, said: &mut Vec<String>, line_of: &dyn Fn(usize) -> usize) -> Result<(), String> {
        if u.replaced.is_some() {
            return Ok(());
        }
        let line = line_of(at);
        match op {
            Op::Execute(b) => {
                let env = Env::of(u, old);
                match run(b, &env, said, &format!("{}:{}  {}, {}", self.doc, line, self.label, key)) {
                    Flow::Return(Some(e)) => u.replaced = Some(Some(print_expr(&env.subst(&e)))),
                    Flow::Return(None) => u.replaced = Some(None),
                    Flow::Next => return Err(format!("{}'s execute for {} ends without a return", self.label, key)),
                    Flow::Unknown(why) => return Err(format!("{}'s execute for {} can't decide this use: {}", self.label, key, why)),
                }
            }
            Op::Event(name, inner) => {
                // the event's name as the statements before have left it
                let mut current = name.clone();
                for i in inner {
                    let Op::Call(o, args) = i else { continue };
                    let pos = u.args.iter().position(|a| a.0 == current);
                    match o.as_str() {
                        "rename" => {
                            if let Some(to) = arg_name(args, "to") {
                                if let Some(p) = pos {
                                    u.args[p].0 = to.clone();
                                }
                                current = to;
                            }
                        }
                        "add" | "drop" => {
                            let Some(p) = pos else { continue };
                            let param = arg_name(args, "arg").ok_or_else(|| format!("{} {}s an argument of {} with no name", self.label, o, name))?;
                            let ev = u.args[p].0.clone();
                            let handler = u.args[p].1.clone();
                            let ty = new.events.iter().find(|(n, _)| *n == ev).and_then(|(_, ps)| ps.iter().find(|(n, _)| *n == param)).map(|(_, t)| t.clone());
                            u.args[p].1 = edit_handler(&handler, o, &param, ty.as_deref()).ok_or_else(|| format!("{} {}s the argument `{}` of {}'s handlers, and this handler is one to change yourself", self.label, o, param, ev))?;
                        }
                        _ => {}
                    }
                }
            }
            Op::Call(o, args) => {
                let why = args.iter().find(|(n, _)| n == "why").map(|(_, v)| literal_text(v)).filter(|w| !w.is_empty()).map(|w| format!(": {}", w)).unwrap_or_default();
                let mem = member(args);
                let when = args.iter().find(|(n, _)| n == "when").map(|(_, v)| v.clone());
                let env = Env::of(u, old);
                let holds = |w: &Option<Expr>| -> Result<bool, String> {
                    match w {
                        None => Ok(true),
                        Some(w) => env.decide(w).ok_or_else(|| format!("whether {}'s `{}` applies here depends on more than this use gives: decide it yourself", self.label, o)),
                    }
                };
                match o.as_str() {
                    "rename" => {
                        if let (Some(m), Some(to)) = (&mem, arg_name(args, "to")) {
                            if let Some(p) = u.args.iter().position(|a| a.0 == *m) {
                                u.args[p].0 = to;
                            }
                        } else if let Some(to) = arg_name(args, "to") {
                            if !args.iter().any(|(n, _)| n == "from") {
                                u.name = to;
                            }
                        }
                    }
                    "drop" => match &mem {
                        Some(m) => {
                            if let Some(p) = u.args.iter().position(|a| a.0 == *m) {
                                let v = u.args[p].1.clone();
                                if v.contains('\n') || v.trim_start().starts_with("fn(") {
                                    return Err(format!("{} drops {}.{}, and this use gives it code of its own: move it yourself", self.label, key, m));
                                }
                                done.deletions.push(format!("{}:{}  {} = {}{}", self.doc, line, m, v, why));
                                u.args.remove(p);
                            }
                        }
                        None => {
                            u.replaced = Some(None);
                            u.why = why.clone();
                        }
                    },
                    "set" | "add" => {
                        let m = mem.ok_or("a set with no member")?;
                        if !holds(&when)? {
                            return Ok(());
                        }
                        let value = args.iter().find(|(n, _)| n == "value").map(|(_, v)| print_expr(&env.subst(v))).ok_or("a set with no value")?;
                        match u.args.iter().position(|a| a.0 == m) {
                            Some(p) => u.args[p].1 = value,
                            None => u.args.push(UseArg::new(m, value)),
                        }
                        u.parens = true;
                    }
                    "notify" => {
                        if when.as_ref().map_or(Some(true), |w| env.decide(w)) != Some(false) {
                            said.push(format!("{}:{}  {}, {}{}", self.doc, line, self.label, key, why));
                        }
                    }
                    "move" => {
                        let from = args.iter().find(|(n, _)| n == "from").map(|(_, v)| place(v)).flatten().ok_or("a move with no `from`")?;
                        let to = args.iter().find(|(n, _)| n == "to").map(|(_, v)| place(v)).flatten().ok_or("a move with no `to`")?;
                        self.move_value(u, &from, &to, new, key)?;
                    }
                    "nest" => {
                        let into = arg_name(args, "into").ok_or("a nest with no `into`")?;
                        let inputs: Vec<String> = match args.iter().find(|(n, _)| n == "inputs").map(|(_, v)| &v.kind) {
                            Some(ExprKind::List(xs)) => xs.iter().filter_map(|x| bare(x)).collect(),
                            _ => Vec::new(),
                        };
                        for i in inputs {
                            self.move_value(u, &vec![i.clone()], &vec![into.clone(), i], new, key)?;
                        }
                    }
                    "flatten" => {
                        let r = arg_name(args, "input").ok_or("a flatten with no `input`")?;
                        if let Some(p) = u.args.iter().position(|a| a.0 == r) {
                            let (_, fields) = read_record(&u.args[p].1).ok_or_else(|| format!("{} flattens {}.{}, and this use gives it something other than a record written out", self.label, key, r))?;
                            u.args.remove(p);
                            for (n, v) in fields.into_iter().rev() {
                                u.args.insert(p, UseArg::new(n, v));
                            }
                        }
                    }
                    "wrap" => {
                        let parent = arg_name(args, "parent").ok_or("a wrap with no `parent`")?;
                        u.wrappers.push((parent, Vec::new()));
                    }
                    "split" | "example" => {}
                    other => return Err(format!("{} uses `{}`, which mkp migrate can't apply", self.label, other)),
                }
            }
        }
        Ok(())
    }

    /// What a use gives at one place, moved to another: an input, a field of a record input, a
    /// slot, or an input of the widget a wrap put around it.
    fn move_value(&self, u: &mut Use, from: &[String], to: &[String], new: &DeclInfo, key: &str) -> Result<(), String> {
        // take it out
        let value = match from {
            [m] => match u.args.iter().position(|a| a.0 == *m) {
                Some(p) => u.args.remove(p).1,
                None => return Ok(()),
            },
            [r, f] => {
                let Some(p) = u.args.iter().position(|a| a.0 == *r) else { return Ok(()) };
                let (ty, mut fields) = read_record(&u.args[p].1).ok_or_else(|| format!("{} moves {}.{}.{}, and this use doesn't write {} out as a record", self.label, key, r, f, r))?;
                let Some(fp) = fields.iter().position(|(n, _)| n == f) else { return Ok(()) };
                let v = fields.remove(fp).1;
                if fields.is_empty() {
                    u.args.remove(p);
                } else {
                    u.args[p].1 = write_record(&ty, &fields);
                }
                v
            }
            _ => return Err(format!("{} moves from a place it can't name", self.label)),
        };
        // and put it where it goes
        match to {
            [w, m] if u.wrappers.iter().any(|(n, _)| n == w) => {
                let wp = u.wrappers.iter().position(|(n, _)| n == w).unwrap();
                u.wrappers[wp].1.push((m.clone(), value));
            }
            [s] if new.slots.contains(s) => {
                u.block = Some(format!("{{\n{}\n}}", as_prose(&value)));
            }
            [m] => {
                u.args.push(UseArg::new(m.clone(), value));
                u.parens = true;
            }
            [r, f] => {
                let ty = new.inputs.iter().find(|(n, _, _)| n == r).and_then(|(_, t, _)| t.clone()).ok_or_else(|| format!("{} moves into {}.{}, whose type isn't a record it can write", self.label, r, f))?;
                match u.args.iter().position(|a| a.0 == *r) {
                    Some(p) => {
                        let (t, mut fields) = read_record(&u.args[p].1).ok_or_else(|| format!("{} moves into {}.{}, and this use gives {} something other than a record written out", self.label, r, f, r))?;
                        fields.push((f.clone(), value));
                        u.args[p].1 = write_record(&t, &fields);
                    }
                    None => {
                        u.args.push(UseArg::new(r.clone(), write_record(&ty, &[(f.clone(), value)])));
                        u.parens = true;
                    }
                }
            }
            _ => return Err(format!("{} moves to a place it can't name", self.label)),
        }
        Ok(())
    }
}

/// Statements in order, a migration fn's call replaced by its body with its parameters bound.
fn flatten(body: &ast::Body<MigrationStmt>, fns: &BTreeMap<String, ast::MigrationFn>, bound: &BTreeMap<String, Expr>, out: &mut Vec<Op>, depth: usize) {
    for st in body.iter() {
        flatten_one(st, fns, bound, out, depth);
    }
}

fn flatten_one(st: &MigrationStmt, fns: &BTreeMap<String, ast::MigrationFn>, bound: &BTreeMap<String, Expr>, out: &mut Vec<Op>, depth: usize) {
    match st {
        MigrationStmt::Execute(b) => out.push(Op::Execute(b.clone())),
        MigrationStmt::Event { name, body } => {
            let mut inner = Vec::new();
            flatten(body, fns, bound, &mut inner, depth);
            out.push(Op::Event(name.name.clone(), inner));
        }
        MigrationStmt::Stmt(Stmt::Expr(e)) => {
            let e = subst_bound(e, bound);
            let Some((op, args)) = call(&e) else { return };
            match fns.get(&op) {
                Some(f) if depth < 16 => {
                    let mut inner: BTreeMap<String, Expr> = BTreeMap::new();
                    for (n, v) in &args {
                        inner.insert(n.clone(), v.clone());
                    }
                    flatten(&f.body, fns, &inner, out, depth + 1);
                }
                _ => out.push(Op::Call(op, args)),
            }
        }
        MigrationStmt::Stmt(Stmt::For(f)) => {
            let over = subst_bound(&f.over, bound);
            if let ExprKind::List(xs) = &over.kind {
                for x in xs.iter() {
                    let mut inner = bound.clone();
                    inner.insert(f.name.name.clone(), x.clone());
                    for s in f.body.stmts.iter() {
                        flatten_one(&MigrationStmt::Stmt(s.item.clone()), fns, &inner, out, depth);
                    }
                }
            }
        }
        MigrationStmt::Stmt(_) => {}
    }
}

fn subst_bound(e: &Expr, bound: &BTreeMap<String, Expr>) -> Expr {
    let mut e = e.clone();
    walk_names(&mut e, &mut |n| bound.get(n).cloned());
    e
}

/// Each name that stands for a value, as `f` replaces it; a case's type and a fn's name stay.
fn walk_names(e: &mut Expr, f: &mut dyn FnMut(&str) -> Option<Expr>) {
    if let ExprKind::Name(n) = &e.kind {
        if let Some(v) = f(&n.name) {
            *e = v;
        }
        return;
    }
    match &mut e.kind {
        ExprKind::Call { callee, args } => {
            if !matches!(callee.kind, ExprKind::Name(_)) {
                walk_names(callee, f);
            }
            for a in args.items.iter_mut() {
                walk_names(&mut a.item.value, f);
            }
        }
        ExprKind::Field { target, .. } | ExprKind::Paren(target) | ExprKind::Try(target) => walk_names(target, f),
        ExprKind::Index { target, index } => {
            walk_names(target, f);
            walk_names(index, f);
        }
        ExprKind::List(xs) => {
            for x in xs.items.iter_mut() {
                walk_names(&mut x.item, f);
            }
        }
        ExprKind::Record { inits, .. } | ExprKind::With { inits, .. } => {
            for i in inits.items.iter_mut() {
                walk_names(&mut i.item.value, f);
            }
        }
        ExprKind::Unary { operand, .. } => walk_names(operand, f),
        ExprKind::Binary { left, right, .. } => {
            walk_names(left, f);
            walk_names(right, f);
        }
        ExprKind::Ternary { cond, then, otherwise } => {
            walk_names(cond, f);
            walk_names(then, f);
            walk_names(otherwise, f);
        }
        ExprKind::View(v) => {
            if let Some(args) = v.args.as_mut() {
                for a in args.items.iter_mut() {
                    walk_names(&mut a.item.value, f);
                }
            }
        }
        _ => {}
    }
}

/// A use's old values, by name, as the migration's code sees them: what the use gives, or its
/// old default where it gives nothing.
struct Env {
    vals: BTreeMap<String, String>,
    given: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum Val {
    Text(String),
    Num(String),
    Bool(bool),
    Case(String, String),
}

impl Env {
    fn of(u: &Use, old: &DeclInfo) -> Env {
        let mut vals = BTreeMap::new();
        for (n, _, d) in &old.inputs {
            if let Some(d) = d {
                vals.insert(n.clone(), print_expr(d));
            }
        }
        let mut given = BTreeSet::new();
        for UseArg(n, v, _) in &u.args {
            vals.insert(n.clone(), v.clone());
            given.insert(n.clone());
        }
        Env { vals, given }
    }

    /// An expression with the use's values in place of the names they have.
    fn subst(&self, e: &Expr) -> Expr {
        let mut e = e.clone();
        walk_names(&mut e, &mut |n| {
            self.vals.get(n).map(|v| {
                let text = if v.contains(' ') && !(v.starts_with('"') || v.starts_with('[') || v.starts_with('@') || v.starts_with('(')) && !v.ends_with('}') { format!("({})", v) } else { v.clone() };
                Expr { kind: ExprKind::Name(ast::Ident { name: text, span: Span::default() }), span: Span::default() }
            })
        });
        e
    }

    fn val(&self, e: &Expr) -> Option<Val> {
        match &e.kind {
            ExprKind::Bool(b) => Some(Val::Bool(*b)),
            ExprKind::Number(n) => Some(Val::Num(n.clone())),
            ExprKind::Text(t) if t.parts.iter().all(|p| matches!(p, ast::TextPart::Piece { .. })) => Some(Val::Text(literal_text(e))),
            ExprKind::Case { target, name, args: None } => match &target.kind {
                ExprKind::Name(t) => Some(Val::Case(t.name.clone(), name.name.clone())),
                _ => None,
            },
            ExprKind::Paren(x) => self.val(x),
            ExprKind::Name(n) => {
                let v = self.vals.get(&n.name)?;
                let parsed = parse(&format!("let x: number = {};\n", v), Entry::Body).file?;
                match parsed.items.first().map(|i| &i.item) {
                    Some(Item::Stmt(Stmt::Let(var))) => self.val(&var.value).filter(|v| !matches!(v, Val::Text(_)) || true),
                    Some(Item::Decl(ast::Decl { kind: DeclKind::Let(var), .. })) => self.val(&var.value),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Whether a condition holds for this use; `None` when it depends on more than it gives.
    fn decide(&self, e: &Expr) -> Option<bool> {
        match &e.kind {
            ExprKind::Paren(x) => self.decide(x),
            ExprKind::Unary { operand, .. } => self.decide(operand).map(|b| !b),
            ExprKind::Binary { op, left, right } => match op {
                ast::BinOp::And => match (self.decide(left), self.decide(right)) {
                    (Some(false), _) | (_, Some(false)) => Some(false),
                    (Some(true), Some(true)) => Some(true),
                    _ => None,
                },
                ast::BinOp::Or => match (self.decide(left), self.decide(right)) {
                    (Some(true), _) | (_, Some(true)) => Some(true),
                    (Some(false), Some(false)) => Some(false),
                    _ => None,
                },
                ast::BinOp::Eq | ast::BinOp::Ne => {
                    let (l, r) = (self.val(left)?, self.val(right)?);
                    Some((l == r) == matches!(op, ast::BinOp::Eq))
                }
                _ => None,
            },
            ExprKind::Call { callee, args } => match &callee.kind {
                ExprKind::Name(n) if n.name == "given" => args.iter().next().and_then(|a| bare(&a.value)).map(|m| self.given.contains(&m)),
                ExprKind::Name(n) if n.name == "confirm" => {
                    let why = args.iter().find(|a| a.name.as_ref().map_or(false, |n| n.name == "why")).map(|a| literal_text(&a.value)).unwrap_or_default();
                    confirm(&why)
                }
                _ => None,
            },
            _ => match self.val(e)? {
                Val::Bool(b) => Some(b),
                _ => None,
            },
        }
    }
}

enum Flow {
    Next,
    Return(Option<Expr>),
    Unknown(String),
}

/// An execute's body, run over a use's values: what it returns, or why it can't say.
fn run(b: &ast::Block, env: &Env, said: &mut Vec<String>, at: &str) -> Flow {
    let mut env = Env { vals: env.vals.clone(), given: env.given.clone() };
    for n in &b.stmts {
        match &n.item {
            Stmt::Return(r) => return Flow::Return(r.clone()),
            Stmt::Let(v) => {
                let e = env.subst(&v.value);
                env.vals.insert(v.name.name.clone(), print_expr(&e));
            }
            Stmt::Expr(e) => {
                if let Some((op, args)) = call(e) {
                    if op == "notify" {
                        let why = args.iter().find(|(n, _)| n == "why").map(|(_, v)| literal_text(v)).unwrap_or_default();
                        said.push(format!("{}: {}", at, why));
                    }
                }
            }
            Stmt::If(i) => {
                let mut taken = None;
                for (c, blk) in &i.branches {
                    let ast::Cond::Expr(c) = c else { return Flow::Unknown("an `if` that opens an opt".into()) };
                    match env.decide(c) {
                        Some(true) => {
                            taken = Some(blk);
                            break;
                        }
                        Some(false) => {}
                        None => return Flow::Unknown(format!("`if ({})`", print_expr(c))),
                    }
                }
                let blk = match (taken, &i.otherwise) {
                    (Some(b), _) => b,
                    (None, Some(o)) => o,
                    (None, None) => continue,
                };
                match run(blk, &env, said, at) {
                    Flow::Next => {}
                    other => return other,
                }
            }
            Stmt::Match(m) => {
                let Some(v) = env.val(&m.subject) else { return Flow::Unknown(format!("`match ({})`, whose value this use doesn't give as a constant", print_expr(&m.subject))) };
                let case = m.cases.iter().find(|c| c.patterns.is_empty() || c.patterns.iter().any(|p| pattern_is(p, &v)));
                if let Some(c) = case {
                    match run(&c.body, &env, said, at) {
                        Flow::Next => {}
                        other => return other,
                    }
                }
            }
            Stmt::For(_) => return Flow::Unknown("a `for` loop".into()),
            _ => {}
        }
    }
    Flow::Next
}

fn pattern_is(p: &ast::Pattern, v: &Val) -> bool {
    match (p, v) {
        (ast::Pattern::Case { ty, case, binds: None }, Val::Case(t, c)) => ty.name == *t && case.name == *c,
        (ast::Pattern::Number { negative, text, .. }, Val::Num(n)) => (if *negative { format!("-{}", text) } else { text.clone() }) == *n,
        (ast::Pattern::Text(t), Val::Text(s)) => t.parts.iter().map(|p| if let ast::TextPart::Piece { raw, .. } = p { raw.clone() } else { String::new() }).collect::<String>() == *s,
        (ast::Pattern::Bool(b, _), Val::Bool(x)) => b == x,
        _ => false,
    }
}

/// Whether a reference's text is a use: a call (`@chart(…)`) or a record literal (`stat { … }`).
fn is_use(whole: &str, key: &str) -> bool {
    (whole.starts_with('@') && whole[1..].starts_with(key)) || (whole.starts_with(key) && whole[key.len()..].trim_start().starts_with('{'))
}

/// A use read from the text by MKP's own parser: its head (`@name(…)` or `name { … }`) as a
/// call or a record, each argument with its value's span, its comments and its line, and a call's
/// block after it as it stands. Values come with the edits inside them made.
fn read_use(text: &str, ws: usize, we: usize, edits: &[Edit]) -> Option<Use> {
    let s = &text[ws..we];
    let record = !s.starts_with('@');
    let name_start = if record { 0 } else { 1 };
    let name_len = s[name_start..].find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(s.len() - name_start);
    let name = s[name_start..name_start + name_len].to_string();
    let line_start = text[..ws].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let indent: String = text[line_start..ws].chars().take_while(|c| *c == ' ' || *c == '\t').collect();
    let mut u = Use { name, args: Vec::new(), multiline: false, indent, parens: false, block: None, record, wrappers: Vec::new(), replaced: None, arg_names: Vec::new(), why: String::new() };
    let open = if record { '{' } else { '(' };
    let mut k = name_start + name_len;
    let rest = &s[k..];
    let skip = rest.len() - rest.trim_start().len();
    if s[k + skip..].starts_with(open) {
        let close = matching(s, k + skip)?;
        // the head alone, parsed as a statement: a record literal is a let's value
        let head = &s[..close + 1];
        let prefix = if record { "let x: x = " } else { "" };
        let parsed = parse(&format!("{}{};\n", prefix, head), Entry::Body);
        if parsed.diagnostics.iter().any(|d| d.is_error()) {
            return None;
        }
        let file = parsed.file?;
        let at = |pos: u32| ws + pos as usize - prefix.len();
        let item = &file.items.first()?.item;
        let group: Vec<(Option<ast::Ident>, Expr, &[ast::Leading], &[mkp_syntax::lexer::Comment], bool)>;
        let multiline;
        match item {
            Item::Stmt(Stmt::Expr(Expr { kind: ExprKind::View(v), .. })) if !record => {
                let g = v.args.as_ref()?;
                multiline = g.multiline;
                group = g.items.iter().map(|n| (n.item.name.clone(), n.item.value.clone(), n.leading.as_slice(), n.trailing.as_slice(), n.newline)).collect();
            }
            // a let at the top of a fragment reads as a declaration
            Item::Stmt(Stmt::Let(var)) | Item::Decl(ast::Decl { kind: DeclKind::Let(var), .. }) if record => {
                let ExprKind::Record { inits, .. } = &var.value.kind else { return None };
                multiline = inits.multiline;
                group = inits.items.iter().map(|n| (Some(n.item.name.clone()), n.item.value.clone(), n.leading.as_slice(), n.trailing.as_slice(), n.newline)).collect();
            }
            _ => return None,
        }
        u.parens = !record;
        u.multiline = multiline;
        for (name, value, leading, trailing, newline) in group {
            // a positional argument: not a widget's or a record's, so not one a migration reads
            let name = name?;
            u.arg_names.push((at(name.span.start), at(name.span.end)));
            let notes = Notes {
                leading: leading.iter().filter_map(|l| if let ast::Leading::Comment(c) = l { Some(c.text.clone()) } else { None }).collect(),
                trailing: trailing.iter().map(|c| (c.gap, c.text.clone())).collect(),
                newline,
            };
            let v = within(text, (at(value.span.start), at(value.span.end)), edits);
            u.args.push(UseArg(name.name, v, notes));
        }
        k = close + 1;
    }
    if !record {
        let rest = &s[k..];
        let skip = rest.len() - rest.trim_start().len();
        if s[k + skip..].starts_with('{') {
            let c = matching(s, k + skip)?;
            u.block = Some(within(text, (ws + k + skip, ws + c + 1), edits));
            k = c + 1;
        }
    }
    if !s[k..].trim().is_empty() && s[k..].trim() != ";" {
        return None;
    }
    Some(u)
}

/// A use's arguments written back: on one line, or one a line, as the use had them, each with
/// its comments.
fn write_args(u: &Use) -> String {
    let commented = u.args.iter().any(|a| !a.2.leading.is_empty() || !a.2.trailing.is_empty());
    if !u.multiline && !commented {
        return u.args.iter().map(|a| format!("{} = {}", a.0, a.1)).collect::<Vec<_>>().join(", ");
    }
    let inner = format!("{}    ", u.indent);
    let mut out = String::new();
    let mut open_line = false;
    for (k, a) in u.args.iter().enumerate() {
        let own_line = k == 0 || a.2.newline || !a.2.leading.is_empty() || !open_line;
        if own_line {
            for c in &a.2.leading {
                out.push_str(&format!("\n{}{}", inner, c));
            }
            out.push_str(&format!("\n{}", inner));
        } else {
            out.push(' ');
        }
        out.push_str(&format!("{} = {},", a.0, a.1));
        open_line = true;
        for (gap, c) in &a.2.trailing {
            out.push_str(&" ".repeat((*gap).max(1) as usize));
            out.push_str(c);
            open_line = false;
        }
    }
    out.push('\n');
    out.push_str(&u.indent);
    out
}

/// The end of a prose call's block that opens on the line before `from`: its closing `}` line.
/// Where each call in a document's prose ends, by where it starts: after its closing `}` line,
/// without that line's break, for a call with a block.
fn prose_call_ends(text: &str) -> BTreeMap<usize, usize> {
    fn walk(p: &ast::Prose, text: &str, out: &mut BTreeMap<usize, usize>) {
        for n in &p.nodes {
            match n {
                ast::ProseNode::Call(c) => {
                    let end = c.span.end as usize;
                    out.insert(c.span.start as usize, if text[..end].ends_with('\n') { end - 1 } else { end });
                    if let Some((b, _)) = &c.block {
                        walk(b, text, out);
                    }
                }
                ast::ProseNode::If { branches, otherwise, .. } => {
                    for b in branches.iter().map(|(_, b, _)| b).chain(otherwise.iter().map(|(b, _)| b)) {
                        walk(b, text, out);
                    }
                }
                ast::ProseNode::For { body, .. } | ast::ProseNode::Slot { body, .. } => walk(body, text, out),
                ast::ProseNode::Match { cases, .. } => cases.iter().for_each(|c| walk(&c.body, text, out)),
                _ => {}
            }
        }
    }
    let mut out = BTreeMap::new();
    if let Some(p) = parse(text, Entry::Document).file.as_ref().and_then(|f| f.prose.as_ref()) {
        walk(p, text, &mut out);
    }
    out
}

/// A use written back: `@name(args)` with its block, inside any widgets put around it.
fn render(u: &Use, prose: bool) -> String {
    if let Some(Some(t)) = &u.replaced {
        return t.clone();
    }
    let args = write_args(u);
    let spread = args.starts_with('\n');
    let mut out = if u.record {
        if args.is_empty() { format!("{} {{}}", u.name) } else if spread { format!("{} {{{}}}", u.name, args) } else { format!("{} {{ {} }}", u.name, args) }
    } else {
        let mut t = format!("@{}", u.name);
        if !u.args.is_empty() || (u.parens && u.block.is_none()) {
            t.push_str(&format!("({})", args));
        }
        if let Some(b) = &u.block {
            t.push(' ');
            t.push_str(b);
        }
        t
    };
    for (w, wargs) in &u.wrappers {
        let a = wargs.iter().map(|(n, v)| format!("{} = {}", n, v)).collect::<Vec<_>>().join(", ");
        let head = if a.is_empty() { format!("@{}", w) } else { format!("@{}({})", w, a) };
        out = if prose { format!("{} {{\n{}\n}}", head, out) } else { format!("{} {{ {} }}", head, out) };
    }
    out
}

/// `T { a = 1, b = 2 }` read by MKP's parser, as its type and its fields as written.
fn read_record(v: &str) -> Option<(String, Vec<(String, String)>)> {
    let v = v.trim();
    let prefix = "let x: x = ";
    let parsed = parse(&format!("{}{};\n", prefix, v), Entry::Body);
    if parsed.diagnostics.iter().any(|d| d.is_error()) {
        return None;
    }
    let file = parsed.file?;
    let var = match &file.items.first()?.item {
        Item::Stmt(Stmt::Let(var)) | Item::Decl(ast::Decl { kind: DeclKind::Let(var), .. }) => var.clone(),
        _ => return None,
    };
    let ExprKind::Record { ty: Some(ty), inits } = &var.value.kind else { return None };
    let text = |e: &Expr| v[e.span.start as usize - prefix.len()..e.span.end as usize - prefix.len()].to_string();
    Some((ty.name.clone(), inits.iter().map(|i| (i.name.name.clone(), text(&i.value))).collect()))
}

fn write_record(ty: &str, fields: &[(String, String)]) -> String {
    if fields.is_empty() {
        return format!("{} {{}}", ty);
    }
    format!("{} {{ {} }}", ty, fields.iter().map(|(n, v)| format!("{} = {}", n, v)).collect::<Vec<_>>().join(", "))
}

/// A value moved into a slot, as prose: a text's words, or a hole for anything else.
fn as_prose(v: &str) -> String {
    let t = v.trim();
    if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 && !t[1..t.len() - 1].contains("\\{") {
        let inner = &t[1..t.len() - 1];
        let words = inner.replace("\\\"", "\"").replace("\\n", "\n").replace("\\\\", "\\");
        // what prose would read otherwise: a call, a comment, a closing brace at a line's start
        return words.lines().map(|l| if l.starts_with('@') || l.starts_with('}') { format!("\\{}", l) } else { l.to_string() }).collect::<Vec<_>>().join("\n");
    }
    format!("\\{{{}}}", t)
}

/// A handler with an argument added or taken out; `None` when that changes what it does.
fn edit_handler(h: &str, op: &str, param: &str, ty: Option<&str>) -> Option<String> {
    let t = h.trim();
    if let Some(rest) = t.strip_prefix("fn(") {
        let close = matching(t, 2)?;
        let params: Vec<String> = rest[..close - 3].split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
        let body = &t[close + 1..];
        let mut params = params;
        if op == "add" {
            params.push(match ty {
                Some(ty) => format!("{}: {}", param, ty),
                None => param.to_string(),
            });
        } else {
            let p = params.iter().position(|p| p.split(':').next().map(str::trim) == Some(param))?;
            // the body still reads it: taking it away would change what the handler does
            if body.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).any(|w| w == param) {
                return None;
            }
            params.remove(p);
        }
        return Some(format!("fn({}){}", params.join(", "), body));
    }
    // a handler given by name, wrapped so the fn it names stays as it is
    if op == "add" && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Some(format!("fn({}) {{ {}(); }}", ty.map(|ty| format!("{}: {}", param, ty)).unwrap_or_else(|| param.to_string()), t));
    }
    None
}

/// A use kept as a comment: `@//` lines in prose, `//` in code.
fn comment_out(body: &str, before: &str, prose: bool, note: &str) -> String {
    let line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let indent = &before[line_start..];
    let mark = if prose { "@//" } else { "//" };
    let mut out = format!("{} {}\n", mark, note);
    for (k, l) in body.lines().enumerate() {
        if k > 0 {
            out.push('\n');
            out.push_str(indent);
        } else if !prose {
            out.push_str(indent);
        }
        out.push_str(mark);
        out.push(' ');
        out.push_str(l);
    }
    if !prose {
        out = out.trim_start().to_string();
    }
    out
}

fn line_start(text: &str, at: usize) -> usize {
    text[..at].rfind('\n').map(|i| i + 1).unwrap_or(0)
}

/// A TODO line above the code at `at`. Its line takes the comment that is right there: `//` in
/// code and inside a call's arguments, `@//` on a line of prose. Inside a fence, a maths block or
/// a case line of `@match`, it goes above the whole block, where a comment is read as one.
fn place_todo(text: &str, edits: &mut Vec<Edit>, at: usize, prose_from: usize, why: &str) {
    fn walk(p: &ast::Prose, at: usize, text: &str) -> Option<(usize, &'static str)> {
        let inside = |s: Span| s.start as usize <= at && at <= s.end as usize;
        for n in &p.nodes {
            match n {
                ast::ProseNode::Fence(ls) | ast::ProseNode::Maths(ls) => {
                    let (first, last) = (ls.first()?, ls.last()?);
                    if inside(first.span.to(last.span)) {
                        return Some((line_start(text, first.span.start as usize), "@//"));
                    }
                }
                ast::ProseNode::Call(c) if inside(c.span) => {
                    if at <= c.call.span.end as usize {
                        let ls = line_start(text, at);
                        return Some((ls, if ls == line_start(text, c.span.start as usize) { "@//" } else { "//" }));
                    }
                    return c.block.as_ref().and_then(|(b, _)| walk(b, at, text));
                }
                ast::ProseNode::If { branches, otherwise, span, .. } if inside(*span) => {
                    return branches.iter().map(|(_, b, _)| b).chain(otherwise.iter().map(|(b, _)| b)).find_map(|b| walk(b, at, text));
                }
                ast::ProseNode::For { body, span, .. } | ast::ProseNode::Slot { body, span, .. } if inside(*span) => return walk(body, at, text),
                ast::ProseNode::Match { cases, span, .. } if inside(*span) => {
                    for c in cases.iter().filter(|c| inside(c.span)) {
                        if line_start(text, at) == line_start(text, c.span.start as usize) {
                            return Some((line_start(text, span.start as usize), "@//"));
                        }
                        return walk(&c.body, at, text);
                    }
                    return None;
                }
                _ => {}
            }
        }
        None
    }
    let ls = line_start(text, at);
    let (mut ls, mark) = if at < prose_from {
        (ls, "//")
    } else {
        let parsed = parse(text, Entry::Document);
        parsed.file.as_ref().and_then(|f| f.prose.as_ref()).and_then(|p| walk(p, at, text)).unwrap_or((ls, "@//"))
    };
    // above an edit that spans the line, so the TODO is never inside replaced text
    while let Some(e) = edits.iter().filter(|e| e.start < ls && ls < e.end).min_by_key(|e| e.start) {
        ls = line_start(text, e.start);
    }
    let indent: String = text[ls..].chars().take_while(|c| *c == ' ' || *c == '\t').collect();
    let line = format!("{}{} TODO(mkp migrate): {}\n", indent, mark, why);
    // an edit starting on the TODO's own spot takes the line in front of its text
    if let Some(e) = edits.iter_mut().find(|e| e.start == ls && e.end > ls) {
        e.text = format!("{}{}", line, e.text);
    } else {
        edits.push(Edit { start: ls, end: ls, text: line });
    }
}

pub(crate) fn matching(s: &str, open: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    let (o, c) = match bytes.get(open)? {
        b'(' => (b'(', b')'),
        b'{' => (b'{', b'}'),
        b'[' => (b'[', b']'),
        _ => return None,
    };
    let (mut depth, mut in_text) = (0, false);
    let mut k = open;
    while k < bytes.len() {
        let b = bytes[k];
        if in_text {
            if b == b'\\' {
                k += 1;
            } else if b == b'"' {
                in_text = false;
            }
        } else if b == b'"' {
            in_text = true;
        } else if b == o {
            depth += 1;
        } else if b == c {
            depth -= 1;
            if depth == 0 {
                return Some(k);
            }
        }
        k += 1;
    }
    None
}

fn call(e: &Expr) -> Option<(String, Vec<(String, Expr)>)> {
    let ExprKind::Call { callee, args } = &e.kind else { return None };
    let ExprKind::Name(n) = &callee.kind else { return None };
    Some((n.name.clone(), args.iter().map(|a| (a.name.as_ref().map(|i| i.name.clone()).unwrap_or_default(), a.value.clone())).collect()))
}

fn bare(e: &Expr) -> Option<String> {
    match &e.kind {
        ExprKind::Name(n) => Some(n.name.clone()),
        _ => None,
    }
}

fn arg_name(args: &[(String, Expr)], name: &str) -> Option<String> {
    args.iter().find(|(n, _)| n == name).and_then(|(_, v)| bare(v))
}

fn member(args: &[(String, Expr)]) -> Option<String> {
    args.iter().find(|(n, _)| matches!(n.as_str(), "input" | "slot" | "field" | "event" | "arg")).and_then(|(_, v)| bare(v))
}

fn case_of(e: &Expr) -> Option<String> {
    match &e.kind {
        ExprKind::Case { name, .. } => Some(name.name.clone()),
        _ => None,
    }
}

/// A place: `color`, or `style.color`.
fn place(e: &Expr) -> Option<Vec<String>> {
    match &e.kind {
        ExprKind::Name(n) => Some(vec![n.name.clone()]),
        ExprKind::Field { target, name } => {
            let mut p = place(target)?;
            p.push(name.name.clone());
            Some(p)
        }
        _ => None,
    }
}

/// A text literal's words, as written.
fn literal_text(e: &Expr) -> String {
    match &e.kind {
        ExprKind::Text(t) => t.parts.iter().map(|p| match p {
            ast::TextPart::Piece { raw, .. } => raw.clone(),
            _ => String::new(),
        }).collect(),
        _ => String::new(),
    }
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("")
}

/// The answers to the questions a migration asks: read from `--answers`, and kept there when
/// someone answers one in a terminal.
#[derive(Default)]
pub(crate) struct Answers {
    pub confirm: BTreeMap<String, bool>,
    pub split: BTreeMap<String, String>,
    pub changed: bool,
}

pub(crate) static ANSWERS: std::sync::Mutex<Option<Answers>> = std::sync::Mutex::new(None);

pub(crate) fn load_answers(text: &str) -> Result<(), String> {
    let v: toml::Value = text.parse().map_err(|e: toml::de::Error| e.message().to_string())?;
    let mut a = Answers::default();
    for (k, x) in v.get("confirm").and_then(|t| t.as_table()).into_iter().flatten() {
        a.confirm.insert(k.clone(), x.as_bool().ok_or_else(|| format!("[confirm] \"{}\" is true or false", k))?);
    }
    for (k, x) in v.get("split").and_then(|t| t.as_table()).into_iter().flatten() {
        a.split.insert(k.clone(), x.as_str().ok_or_else(|| format!("[split] \"{}\" names a case, such as \"OVERDUE\"", k))?.to_string());
    }
    *ANSWERS.lock().unwrap() = Some(a);
    Ok(())
}

/// The answers as a file, when someone answered something new in a terminal.
pub(crate) fn answers_text() -> Option<String> {
    let guard = ANSWERS.lock().unwrap();
    let a = guard.as_ref().filter(|a| a.changed)?;
    let q = |k: &str| format!("\"{}\"", k.replace('\\', "\\\\").replace('"', "\\\""));
    let mut out = String::from("# mkp migrate's answers: kept so a run without a terminal answers the same\n\n[confirm]\n");
    for (k, v) in &a.confirm {
        out.push_str(&format!("{} = {}\n", q(k), v));
    }
    out.push_str("\n[split]\n");
    for (k, v) in &a.split {
        out.push_str(&format!("{} = {}\n", q(k), q(v)));
    }
    Some(out)
}

/// `--allow-todos`: what a migration can't do is left as it was, with a TODO above it, instead of the
/// file being refused.
pub(crate) static TODO: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// `--format json`: no question is asked in a terminal, as where there is none.
pub(crate) static NO_ASKING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) fn can_ask() -> bool {
    std::io::stdin().is_terminal() && !NO_ASKING.load(std::sync::atomic::Ordering::Relaxed)
}

/// `--yes`: every question answered yes, or only the ones numbered (`--yes 1,3`).
pub(crate) enum Yes {
    All,
    Numbers(BTreeSet<usize>),
}

pub(crate) static YES: std::sync::Mutex<Option<Yes>> = std::sync::Mutex::new(None);

/// Every yes or no answered in this pass: its number, the question, its answer, and who gave it.
pub(crate) static ASKED: std::sync::Mutex<Vec<(usize, String, bool, &'static str)>> = std::sync::Mutex::new(Vec::new());

/// A question a migration asks: one yes or no for the whole run (`confirm`), or a choice about
/// one use (`ask`, and `split`), with its options.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Question {
    /// What identifies it in `--answers`: the `why` of a yes or no, `file:line CASE` of a choice.
    pub key: String,
    pub asks: String,
    /// Empty for a yes or no.
    pub options: Vec<String>,
}

/// Every question the run has met, numbered in the order it first came up (as `--yes 2` names
/// them), and the ones no one has answered yet.
static QUESTIONS: std::sync::Mutex<Vec<Question>> = std::sync::Mutex::new(Vec::new());
static PENDING: std::sync::Mutex<Vec<usize>> = std::sync::Mutex::new(Vec::new());
/// The questions answered in this terminal, by key.
static ANSWERED_HERE: std::sync::Mutex<BTreeSet<String>> = std::sync::Mutex::new(BTreeSet::new());

/// A question's number, registering it the first time it comes up.
fn number(q: Question) -> usize {
    let mut all = QUESTIONS.lock().unwrap();
    match all.iter().position(|x| x.key == q.key) {
        Some(k) => k + 1,
        None => {
            all.push(q);
            all.len()
        }
    }
}

fn wait_for(n: usize) {
    let mut p = PENDING.lock().unwrap();
    if !p.contains(&n) {
        p.push(n);
    }
}

/// A new pass over the files: what was answered stays, what was waiting is met again.
pub(crate) fn new_pass() {
    ASKED.lock().unwrap().clear();
    PENDING.lock().unwrap().clear();
}

/// The questions this pass met that no one has answered, with their numbers, in order.
pub(crate) fn pending() -> Vec<(usize, Question)> {
    let all = QUESTIONS.lock().unwrap();
    let mut p = PENDING.lock().unwrap().clone();
    p.sort();
    p.into_iter().map(|n| (n, all[n - 1].clone())).collect()
}

/// In a terminal: every question waiting, listed, then each asked in turn until it gets y or n
/// (a choice, its number). `false` when the terminal closes before every one is answered.
pub(crate) fn ask_in_terminal(questions: &[(usize, Question)]) -> bool {
    println!("\n{} question{} to answer before anything is written:", questions.len(), if questions.len() == 1 { "" } else { "s" });
    for (n, q) in questions {
        println!("  {}. {}{}", n, q.asks, if q.options.is_empty() { String::new() } else { format!(" ({})", q.options.join(" or ")) });
    }
    println!();
    let mut guard = ANSWERS.lock().unwrap();
    let answers = guard.get_or_insert_with(Answers::default);
    for (n, q) in questions {
        let mut again = false;
        loop {
            // asked once in full; an answer that isn't one is asked for again, briefly
            match (q.options.is_empty(), again) {
                (true, false) => print!("{}. {} [y/n] ", n, q.asks),
                (true, true) => print!("   y or n: "),
                (false, false) => {
                    println!("{}. {}", n, q.asks);
                    for (k, o) in q.options.iter().enumerate() {
                        println!("     {}) {}", k + 1, o);
                    }
                    print!("   [1-{}] ", q.options.len());
                }
                (false, true) => print!("   a number from 1 to {}: ", q.options.len()),
            }
            again = true;
            let _ = std::io::stdout().flush();
            let mut s = String::new();
            if std::io::stdin().read_line(&mut s).map_or(true, |read| read == 0) {
                println!();
                return false;
            }
            let s = s.trim();
            if q.options.is_empty() {
                let a = match s {
                    "y" | "Y" | "yes" => true,
                    "n" | "N" | "no" => false,
                    _ => continue,
                };
                answers.confirm.insert(q.key.clone(), a);
            } else {
                let Some(pick) = s.parse::<usize>().ok().filter(|k| *k >= 1 && *k <= q.options.len()) else { continue };
                answers.split.insert(q.key.clone(), q.options[pick - 1].clone());
            }
            answers.changed = true;
            ANSWERED_HERE.lock().unwrap().insert(q.key.clone());
            break;
        }
    }
    true
}

/// How a question no one answered can be: by number, or in the answers file.
pub(crate) fn how_to_answer(n: usize, q: &Question) -> String {
    let quoted = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
    if q.options.is_empty() {
        format!("--yes {}, or in --answers: [confirm] {} = true", n, quoted(&q.key))
    } else {
        format!("in --answers: [split] {} = {}", quoted(&q.key), quoted(&q.options[0]))
    }
}

/// A yes or no for the whole run: from the answers or `--yes`; else it waits, to be asked once
/// every question is known, and counts as no in the meantime.
fn confirm(question: &str) -> Option<bool> {
    let mut asked = ASKED.lock().unwrap();
    if let Some((_, _, a, _)) = asked.iter().find(|(_, q, _, _)| q == question) {
        return Some(*a);
    }
    let n = number(Question { key: question.to_string(), asks: question.to_string(), options: Vec::new() });
    let mut guard = ANSWERS.lock().unwrap();
    let answers = guard.get_or_insert_with(Answers::default);
    let here = ANSWERED_HERE.lock().unwrap().contains(question);
    let (a, by) = match (answers.confirm.get(question), &*YES.lock().unwrap()) {
        (Some(a), _) => (*a, if here { "asked" } else { "--answers" }),
        (None, Some(Yes::All)) => (true, "--yes"),
        (None, Some(Yes::Numbers(ns))) => (ns.contains(&n), "--yes"),
        (None, None) => {
            wait_for(n);
            return Some(false);
        }
    };
    asked.push((n, question.to_string(), a, by));
    Some(a)
}

/// A choice about one use: from the answers, by `key`; else it waits to be asked, or with
/// `--allow-todos` is left for a person (`None`).
fn ask(key: &str, question: &str, options: &[String]) -> Option<String> {
    let mut guard = ANSWERS.lock().unwrap();
    let answers = guard.get_or_insert_with(Answers::default);
    if let Some(a) = answers.split.get(key) {
        return options.iter().find(|o| *o == a).cloned();
    }
    if !options.is_empty() && !TODO.load(std::sync::atomic::Ordering::Relaxed) {
        wait_for(number(Question { key: key.to_string(), asks: question.to_string(), options: options.to_vec() }));
    }
    None
}
