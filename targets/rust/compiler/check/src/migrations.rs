//! Migrations (page 6): each `migration kit@1 to kit@2` is read against the surface it starts
//! from and the version it moves to. Every statement must name what is there, and the blocks,
//! applied to the older version, must account for every way it differs from the newer one.

use std::collections::{BTreeMap, BTreeSet};

use mkp_syntax::ast::{self, Expr, ExprKind, Item, MigrationItem, MigrationStmt, Stmt};
use mkp_syntax::span::Span;

use crate::versions::{breaks, Api, ApiItem, Break};
use crate::{codes, Checker};

/// The statements core declares, with the parameters each takes.
const STATEMENTS: &[(&str, &[&str])] = &[
    ("rename", &["input", "slot", "field", "event", "arg", "from", "to", "why"]),
    ("move", &["from", "to", "why"]),
    ("set", &["input", "field", "arg", "value", "when", "why"]),
    ("drop", &["input", "slot", "field", "event", "arg", "from", "why"]),
    ("wrap", &["parent", "why"]),
    ("notify", &["input", "slot", "field", "event", "arg", "why", "when"]),
    ("add", &["input", "field", "arg", "value", "why"]),
    ("nest", &["inputs", "into", "why"]),
    ("flatten", &["input", "why"]),
    ("split", &["from", "to", "why"]),
    ("example", &["before", "after"]),
];

/// The member kinds a parameter names, and what the API calls them.
const MEMBERS: &[(&str, &str)] = &[("input", "input"), ("slot", "slot"), ("field", "field"), ("event", "event"), ("arg", "arg")];

/// What a block's statements did to one declaration of the older version.
#[derive(Default, Debug)]
struct Fate {
    /// Its name in the newer version; `None` once dropped.
    now: Option<String>,
    dropped: bool,
    executed: bool,
    /// Each older member, by its older name: its name now, or `None` once dropped or moved.
    members: BTreeMap<String, Option<String>>,
    /// Members a statement gives a value to, or says something about, by their newer name.
    given: BTreeSet<String>,
    /// The widget a `wrap` put the uses inside.
    parent: Option<String>,
}

struct Step<'a> {
    file: usize,
    old: &'a Api,
    new: &'a Api,
    item: String,
    fate: Fate,
}

impl Checker {
    /// Every migration in the pack: its versions, each block, and whether it is complete.
    pub(crate) fn check_migrations(&mut self, pack: &str, version: u32) {
        let files = self.packs.get(pack).map(|r| r.files.clone()).unwrap_or_default();
        let mut found: Vec<(usize, ast::MigrationDecl, Span)> = Vec::new();
        let mut fns: BTreeMap<String, ast::MigrationFn> = BTreeMap::new();
        for f in files {
            for n in &self.files[f].ast.items {
                match &n.item {
                    Item::Decl(ast::Decl { kind: ast::DeclKind::Migration(m), span }) => found.push((f, m.clone(), *span)),
                    Item::Decl(ast::Decl { kind: ast::DeclKind::MigrationFn(m), .. }) => {
                        fns.insert(m.sig.name.name.clone(), m.clone());
                    }
                    _ => {}
                }
            }
        }
        found.sort_by_key(|(_, m, _)| m.from.version.name.parse::<u32>().unwrap_or(0));
        let mut chain_to: Option<u32> = None;
        for (file, m, span) in &found {
            let head = m.from.name.span.to(m.to.version.span);
            let (from, to) = (m.from.version.name.parse::<u32>().unwrap_or(0), m.to.version.name.parse::<u32>().unwrap_or(0));
            if m.from.name.name != pack || m.to.name.name != pack {
                self.error(*file, codes::MIGRATION, head, format!("a migration moves the uses of its own pack, from one of its versions to a later one: write `migration {}@{} to {}@{}`", pack, from, pack, to));
                continue;
            }
            if from >= to || to > version {
                self.error(*file, codes::MIGRATION, head, format!("a migration moves uses to a later version, and {} is at {}@{}: found {}@{} to {}@{}", pack, pack, version, pack, from, pack, to));
                continue;
            }
            if let Some(prev) = chain_to {
                if prev != from {
                    self.error(*file, codes::MIGRATION, head, format!("the migrations form one chain, each starting where the one before ends: the one before ends at {}@{}, and this one starts at {}@{}", pack, prev, pack, from));
                }
            }
            chain_to = Some(to);
            let start = format!("{}@{}", pack, from);
            if !self.packs.contains_key(&start) {
                self.error(*file, codes::MIGRATION, head, format!("this migration needs {}'s surface, a file that starts `package {};`: `mkp surface` writes it when that version is released", start, start));
                continue;
            }
            let end = if to == version { pack.to_string() } else { format!("{}@{}", pack, to) };
            if !self.packs.contains_key(&end) {
                self.error(*file, codes::MIGRATION, head, format!("this migration ends at {}@{}, whose surface isn't here: a migration that ends before the pack's own version needs that version's surface", pack, to));
                continue;
            }
            let old = self.api(&start, pack);
            let new = self.api(&end, pack);
            self.check_migration(*file, m, *span, &old, &new, &fns);
        }
        if let (Some(last), false) = (chain_to, found.is_empty()) {
            if last != version {
                let (file, m, _) = found.last().unwrap();
                self.error(*file, codes::MIGRATION, m.to.name.span.to(m.to.version.span), format!("the last migration ends at {}@{}, and the pack is at {}@{}: add `migration {}@{} to {}@{}`", pack, last, pack, version, pack, last, pack, version));
            }
        }
    }

    fn check_migration(&mut self, file: usize, m: &ast::MigrationDecl, span: Span, old: &Api, new: &Api, fns: &BTreeMap<String, ast::MigrationFn>) {
        let label = format!("{}@{} to {}@{}", m.from.name.name, m.from.version.name, m.to.name.name, m.to.version.name);
        let mut fates: BTreeMap<String, Fate> = BTreeMap::new();
        for item in m.items.iter() {
            let MigrationItem::Block(b) = item else { continue };
            let key = b.path.iter().map(|i| i.name.as_str()).collect::<Vec<_>>().join(".");
            let head = b.kind.span.to(b.path.last().unwrap().span);
            let Some(o) = old.items.get(&key) else {
                let names: Vec<&String> = old.items.iter().filter(|(_, i)| i.kind == kind_of(&b.kind.name)).map(|(k, _)| k).collect();
                self.error(file, codes::MIGRATION, head, format!("{} had no {} `{}`; its {}s are {}", m.from.name.name.clone() + "@" + &m.from.version.name, b.kind.name, key, b.kind.name, list(&names)));
                continue;
            };
            if o.kind != kind_of(&b.kind.name) {
                self.error(file, codes::MIGRATION, head, format!("`{}` was a {}, so its block is `{} {} {{`", key, o.kind, word_of(o.kind), key));
                continue;
            }
            if fates.contains_key(&key) {
                self.error(file, codes::MIGRATION, head, format!("`{}` already has a block in this migration: one block per declaration", key));
                continue;
            }
            let fate = Fate { now: Some(key.clone()), members: o.members.keys().map(|k| (k.clone(), Some(k.clone()))).collect(), ..Fate::default() };
            let mut step = Step { file, old, new, item: key.clone(), fate };
            for st in b.body.iter() {
                self.migration_stmt(&mut step, st, fns, 0);
            }
            fates.insert(key, step.fate);
        }
        // complete: what's left of the older version, renamed as the blocks say, against the newer
        let mut moved = Api::default();
        for (key, item) in &old.items {
            let Some(f) = fates.get(key) else {
                moved.items.insert(key.clone(), item.clone());
                continue;
            };
            if f.dropped || f.executed {
                continue;
            }
            let mut item = item.clone();
            item.members = item.members.into_iter().filter_map(|(k, v)| f.members.get(&k).cloned().flatten().map(|now| (now, v))).collect();
            moved.items.insert(f.now.clone().unwrap_or_else(|| key.clone()), item);
        }
        let given: BTreeMap<String, &Fate> = fates.values().filter_map(|f| f.now.clone().map(|n| (n, f))).collect();
        let mut missing = Vec::new();
        for b in breaks(&moved, new) {
            if b.kind == "case" {
                continue;
            }
            if let (Some(f), Some(member)) = (given.get(&b.item), &b.member) {
                if f.given.contains(member) {
                    continue;
                }
            }
            missing.push(b);
        }
        // a block is headed by the older name
        let older: BTreeMap<String, String> = fates.iter().filter_map(|(k, f)| f.now.clone().filter(|n| n != k).map(|n| (n, k.clone()))).collect();
        for mut b in missing {
            if let Some(o) = older.get(&b.item) {
                b.what = format!("{} (`{}` before)", b.what, o);
                b.item = o.clone();
            }
            let hint = hint(&b);
            self.error(file, codes::MIGRATION_INCOMPLETE, m.from.name.span.to(m.to.version.span), format!("migration {} leaves this unsaid: {}. {}", label, b.what, hint));
        }
        let _ = span;
    }

    fn migration_stmt(&mut self, step: &mut Step, st: &MigrationStmt, fns: &BTreeMap<String, ast::MigrationFn>, depth: usize) {
        match st {
            MigrationStmt::Execute(_) => step.fate.executed = true,
            MigrationStmt::Event { name, body } => {
                let o = step.old.items.get(&step.item);
                if o.and_then(|o| o.members.get(&name.name)).map_or(true, |m| m.kind != "event") {
                    self.error(step.file, codes::MIGRATION, name.span, format!("`{}` had no event `{}`", step.item, name.name));
                    return;
                }
                // an event's own statements: its new name, and the arguments its handlers take
                for s in body.iter() {
                    let MigrationStmt::Stmt(Stmt::Expr(e)) = s else { continue };
                    let Some((op, args)) = call(e) else { continue };
                    if op == "rename" {
                        if let Some(to) = args.iter().find(|(n, _)| n == "to").and_then(|(_, v)| bare(v)) {
                            step.fate.members.insert(name.name.clone(), Some(to.name.clone()));
                            step.fate.given.insert(to.name.clone());
                        }
                    } else if op == "add" || op == "drop" {
                        let now = step.fate.members.get(&name.name).cloned().flatten().unwrap_or_else(|| name.name.clone());
                        step.fate.given.insert(now);
                    } else {
                        self.error(step.file, codes::MIGRATION, e.span, format!("an event's block holds rename, add and drop: its new name and its handlers' arguments; found `{}`", op));
                    }
                }
            }
            MigrationStmt::Stmt(Stmt::Expr(e)) => {
                let Some((op, args)) = call(e) else {
                    self.error(step.file, codes::MIGRATION, e.span, "a block holds statements, each a call such as `rename(to = plot);`, and `execute { … }`".to_string());
                    return;
                };
                if let Some(f) = fns.get(&op) {
                    self.migration_fn_call(step, e, f, &args, fns, depth);
                    return;
                }
                let Some((_, params)) = STATEMENTS.iter().find(|(n, _)| *n == op) else {
                    let mut known: Vec<&str> = STATEMENTS.iter().map(|(n, _)| *n).collect();
                    known.extend(fns.keys().map(String::as_str));
                    self.error(step.file, codes::MIGRATION, e.span, format!("`{}` isn't a migration statement or a migration fn; there are {}", op, known.join(", ")));
                    return;
                };
                for (n, v) in &args {
                    if n.is_empty() {
                        self.error(step.file, codes::MIGRATION, v.span, format!("`{}`'s arguments are named: {}", op, params.join(", ")));
                        return;
                    }
                    if !params.contains(&n.as_str()) {
                        self.error(step.file, codes::MIGRATION, v.span, format!("`{}` has no parameter `{}`; it takes {}", op, n, params.join(", ")));
                        return;
                    }
                }
                if !args.iter().any(|(n, _)| n == "why") && !matches!(op.as_str(), "rename" | "example") {
                    let msg = if op == "notify" { "notify says something only with `why`: what whoever migrates should know".to_string() } else { format!("say why, with `why = \"…\"`: whoever migrates reads it beside each change `{}` makes", op) };
                    if op == "notify" {
                        self.error(step.file, codes::MIGRATION, e.span, msg);
                    } else {
                        self.warning(step.file, codes::MIGRATION_WHY, e.span, msg);
                    }
                }
                self.statement(step, &op, &args, e.span);
            }
            MigrationStmt::Stmt(other) => {
                let span = stmt_span(other);
                self.error(step.file, codes::MIGRATION, span, "a block holds statements and `execute { … }`; `for` and `if` belong in a migration fn or in `execute`".to_string());
            }
        }
    }

    /// A migration fn's body, with its parameters bound to the call's arguments.
    fn migration_fn_call(&mut self, step: &mut Step, e: &Expr, f: &ast::MigrationFn, args: &[(String, Expr)], fns: &BTreeMap<String, ast::MigrationFn>, depth: usize) {
        if depth > 16 {
            self.error(step.file, codes::MIGRATION, e.span, "migration fns call each other too deep to follow".to_string());
            return;
        }
        let mut bound: BTreeMap<String, Expr> = BTreeMap::new();
        for p in f.sig.params.iter() {
            match args.iter().find(|(n, _)| *n == p.name.name) {
                Some((_, v)) => {
                    bound.insert(p.name.name.clone(), v.clone());
                }
                None => {
                    self.error(step.file, codes::MIGRATION, e.span, format!("`{}` needs `{}`", f.sig.name.name, p.name.name));
                    return;
                }
            }
        }
        for (n, v) in args {
            if !f.sig.params.iter().any(|p| p.name.name == *n) {
                self.error(step.file, codes::MIGRATION, v.span, format!("`{}` has no parameter `{}`", f.sig.name.name, n));
                return;
            }
        }
        for st in f.body.iter() {
            self.bound_stmt(step, st, &bound, fns, depth);
        }
    }

    fn bound_stmt(&mut self, step: &mut Step, st: &MigrationStmt, bound: &BTreeMap<String, Expr>, fns: &BTreeMap<String, ast::MigrationFn>, depth: usize) {
        match st {
            MigrationStmt::Stmt(Stmt::For(f)) => {
                let over = subst(&f.over, bound);
                let ExprKind::List(items) = &over.kind else {
                    // a loop over something only known when migrating: what it does can't be followed
                    step.fate.executed = true;
                    return;
                };
                for x in items.iter() {
                    let mut inner = bound.clone();
                    inner.insert(f.name.name.clone(), x.clone());
                    for s in f.body.stmts.iter() {
                        self.bound_stmt(step, &MigrationStmt::Stmt(s.item.clone()), &inner, fns, depth);
                    }
                }
            }
            MigrationStmt::Stmt(Stmt::Expr(e)) => {
                let e = subst(e, bound);
                self.migration_stmt(step, &MigrationStmt::Stmt(Stmt::Expr(e)), fns, depth + 1);
            }
            MigrationStmt::Execute(_) => step.fate.executed = true,
            MigrationStmt::Stmt(_) => step.fate.executed = true,
            MigrationStmt::Event { .. } => self.migration_stmt(step, st, fns, depth + 1),
        }
    }

    /// One statement, applied to what the block's declaration is at this point.
    fn statement(&mut self, step: &mut Step, op: &str, args: &[(String, Expr)], span: Span) {
        let arg = |n: &str| args.iter().find(|(k, _)| k == n).map(|(_, v)| v);
        let member_arg = args.iter().find(|(k, _)| MEMBERS.iter().any(|(m, _)| m == k)).map(|(k, v)| (k.clone(), v.clone()));
        let file = step.file;
        let old_item = step.old.items.get(&step.item).cloned();
        let new_item = |step: &Step| step.fate.now.as_ref().and_then(|n| step.new.items.get(n)).cloned();
        match op {
            "rename" => {
                let Some(to) = arg("to") else {
                    self.error(file, codes::MIGRATION, span, "rename needs `to`: the new name".to_string());
                    return;
                };
                if let Some((kind, m)) = &member_arg {
                    let Some(m) = self.member_named(step, kind, m, span) else { return };
                    let Some(to) = bare(to) else {
                        self.error(file, codes::MIGRATION, to.span, "the new name, written bare: `to = tone`".to_string());
                        return;
                    };
                    let now = step.fate.now.clone().unwrap_or_default();
                    match new_item(step).and_then(|n| n.members.get(&to.name).cloned()) {
                        Some(_) => {}
                        None => {
                            let there: Vec<String> = new_item(step).map(|n| n.members.keys().cloned().collect()).unwrap_or_default();
                            self.error(file, codes::MIGRATION, to.span, format!("{}'s `{}` has no {} `{}` to rename `{}` to; it has {}", label_new(step), now, kind, to.name, m, list(&there)));
                            return;
                        }
                    }
                    step.fate.members.insert(m, Some(to.name.clone()));
                } else if let Some(from) = arg("from") {
                    // a case: `rename(from = state.LATE, to = state.OVERDUE)`
                    let (Some(c), Some(t)) = (case_name(from), case_name(to)) else {
                        self.error(file, codes::MIGRATION, span, "a case is written in full, as everywhere: `rename(from = state.LATE, to = state.OVERDUE)`".to_string());
                        return;
                    };
                    if old_item.as_ref().and_then(|o| o.members.get(&c)).map_or(true, |m| m.kind != "case") {
                        self.error(file, codes::MIGRATION, from.span, format!("`{}` had no case `{}`", step.item, c));
                        return;
                    }
                    if new_item(step).and_then(|n| n.members.get(&t).cloned()).is_none() {
                        self.error(file, codes::MIGRATION, to.span, format!("{}'s `{}` has no case `{}`", label_new(step), step.fate.now.clone().unwrap_or_default(), t));
                        return;
                    }
                    step.fate.members.insert(c, Some(t));
                } else {
                    let Some(to) = bare(to) else {
                        self.error(file, codes::MIGRATION, to.span, "the new name, written bare: `to = plot`".to_string());
                        return;
                    };
                    let kind = old_item.as_ref().map(|o| o.kind).unwrap_or("");
                    match step.new.items.get(&rename_key(&step.item, &to.name)) {
                        Some(n) if n.kind == kind => step.fate.now = Some(rename_key(&step.item, &to.name)),
                        _ => {
                            let there: Vec<&String> = step.new.items.iter().filter(|(_, i)| i.kind == kind).map(|(k, _)| k).collect();
                            self.error(file, codes::MIGRATION, to.span, format!("{} provides no {} `{}`; its {}s are {}", label_new(step), kind, to.name, kind, list(&there)));
                        }
                    }
                }
            }
            "drop" => match &member_arg {
                Some((kind, m)) => {
                    if let Some(m) = self.member_named(step, kind, m, span) {
                        step.fate.members.insert(m, None);
                    }
                }
                None => step.fate.dropped = true,
            },
            "set" | "add" => {
                let Some((kind, m)) = &member_arg else {
                    self.error(file, codes::MIGRATION, span, format!("{} names what it gives a value to: `input =`, `field =` or `arg =`", op));
                    return;
                };
                let Some(m) = bare(m) else {
                    self.error(file, codes::MIGRATION, m.span, "a name, written bare: `input = size`".to_string());
                    return;
                };
                if arg("value").is_none() && !(op == "add" && kind == "arg") {
                    self.error(file, codes::MIGRATION, span, format!("{} needs `value`", op));
                    return;
                }
                let has_new = new_item(step).and_then(|n| n.members.get(&m.name).cloned()).is_some();
                if !has_new {
                    let there: Vec<String> = new_item(step).map(|n| n.members.keys().cloned().collect()).unwrap_or_default();
                    self.error(file, codes::MIGRATION, m.span, format!("{}'s `{}` has no {} `{}`; it has {}", label_new(step), step.fate.now.clone().unwrap_or_default(), kind, m.name, list(&there)));
                    return;
                }
                if op == "add" && step.fate.members.values().any(|v| v.as_deref() == Some(m.name.as_str())) {
                    self.error(file, codes::MIGRATION, m.span, format!("`{}` was already there: add is for a member the older version didn't have, and set gives one a value", m.name));
                    return;
                }
                step.fate.given.insert(m.name.clone());
            }
            "notify" => {
                if let Some((kind, m)) = &member_arg {
                    if let Some(m) = self.member_named(step, kind, m, span) {
                        let now = step.fate.members.get(&m).cloned().flatten().unwrap_or(m);
                        step.fate.given.insert(now);
                    }
                }
            }
            "wrap" => match arg("parent").and_then(bare) {
                Some(p) if step.new.items.get(&p.name).map_or(false, |i| i.kind == "widget") => step.fate.parent = Some(p.name.clone()),
                _ => self.error(file, codes::MIGRATION, span, format!("wrap needs `parent`, a widget {} provides", label_new(step))),
            },
            "move" => {
                let (Some(from), Some(to)) = (arg("from"), arg("to")) else {
                    self.error(file, codes::MIGRATION, span, "move needs `from` and `to`".to_string());
                    return;
                };
                let Some(fm) = path_head(from) else {
                    self.error(file, codes::MIGRATION, from.span, "a place: an input or a slot, or a field of one, `style.color`".to_string());
                    return;
                };
                if let Some(m) = self.member_named(step, "member", &name_expr(&fm, from.span), span) {
                    step.fate.members.insert(m, None);
                }
                match path_head(to) {
                    Some(head) if step.fate.parent.as_deref() == Some(head.as_str()) => {}
                    Some(head) => match new_item(step).and_then(|n| n.members.get(&head).cloned()) {
                        Some(_) => {
                            step.fate.given.insert(head);
                        }
                        None => self.error(file, codes::MIGRATION, to.span, format!("{}'s `{}` has no `{}` to move to", label_new(step), step.fate.now.clone().unwrap_or_default(), head)),
                    },
                    None => self.error(file, codes::MIGRATION, to.span, "a place: an input or a slot, a field of one, or one of the parent's after wrap".to_string()),
                }
            }
            "nest" => {
                let (Some(inputs), Some(into)) = (arg("inputs"), arg("into").and_then(bare)) else {
                    self.error(file, codes::MIGRATION, span, "nest needs `inputs`, a list of inputs, and `into`, the record input they go into".to_string());
                    return;
                };
                let ExprKind::List(items) = &inputs.kind else {
                    self.error(file, codes::MIGRATION, inputs.span, "a list of inputs: `inputs = [color, width]`".to_string());
                    return;
                };
                for x in items.iter() {
                    if let Some(m) = self.member_named(step, "input", x, x.span) {
                        step.fate.members.insert(m, None);
                    }
                }
                step.fate.given.insert(into.name.clone());
            }
            "flatten" => {
                if let Some(m) = arg("input").and_then(|v| self.member_named(step, "input", v, span)) {
                    step.fate.members.insert(m, None);
                }
                if let Some(n) = new_item(step) {
                    let names: Vec<String> = n.members.keys().cloned().collect();
                    step.fate.given.extend(names);
                }
            }
            "split" => {
                if let Some(c) = arg("from").and_then(case_name) {
                    step.fate.members.insert(c, None);
                }
            }
            _ => {}
        }
    }

    /// The older member a statement names, by the name it has at this point; `None`, reported,
    /// when there is none.
    fn member_named(&mut self, step: &Step, kind: &str, e: &Expr, at: Span) -> Option<String> {
        let Some(name) = bare(e) else {
            self.error(step.file, codes::MIGRATION, e.span, format!("a name, written bare: `{} = color`", kind));
            return None;
        };
        let old = step.old.items.get(&step.item)?;
        let found = step.fate.members.iter().find(|(_, now)| now.as_deref() == Some(name.name.as_str())).map(|(o, _)| o.clone());
        let api_kind = MEMBERS.iter().find(|(k, _)| *k == kind).map(|(_, a)| *a);
        match found {
            Some(o) if api_kind.map_or(true, |k| old.members.get(&o).map_or(false, |m| m.kind == k)) => Some(o),
            Some(o) => {
                self.error(step.file, codes::MIGRATION, name.span, format!("`{}.{}` is a {}, not a {}", step.item, o, old.members[&o].kind, kind));
                None
            }
            None => {
                let there: Vec<String> = step.fate.members.values().flatten().cloned().collect();
                let _ = at;
                self.error(step.file, codes::MIGRATION, name.span, format!("`{}` has no {} `{}` at this point; it has {}", step.item, if kind == "member" { "input or slot" } else { kind }, name.name, list(&there)));
                None
            }
        }
    }
}

fn label_new(step: &Step) -> String {
    let _ = step;
    "the newer version".to_string()
}

/// `name(a = …, b = …)`, with each argument's name (empty for one written without).
fn call(e: &Expr) -> Option<(String, Vec<(String, Expr)>)> {
    let ExprKind::Call { callee, args } = &e.kind else { return None };
    let ExprKind::Name(n) = &callee.kind else { return None };
    Some((n.name.clone(), args.iter().map(|a| (a.name.as_ref().map(|i| i.name.clone()).unwrap_or_default(), a.value.clone())).collect()))
}

fn bare(e: &Expr) -> Option<&ast::Ident> {
    match &e.kind {
        ExprKind::Name(n) => Some(n),
        _ => None,
    }
}

fn name_expr(name: &str, span: Span) -> Expr {
    Expr { kind: ExprKind::Name(ast::Ident { name: name.to_string(), span }), span }
}

/// The first name of a place: `color`, or `style` in `style.color`.
fn path_head(e: &Expr) -> Option<String> {
    match &e.kind {
        ExprKind::Name(n) => Some(n.name.clone()),
        ExprKind::Field { target, .. } => path_head(target),
        _ => None,
    }
}

/// `state.LATE`'s case.
fn case_name(e: &Expr) -> Option<String> {
    match &e.kind {
        ExprKind::Case { name, .. } => Some(name.name.clone()),
        _ => None,
    }
}

/// A renamed declaration's key: a fn on a type keeps its type, `text.slug` to `text.slugify`.
fn rename_key(old: &str, to: &str) -> String {
    match old.rsplit_once('.') {
        Some((on, _)) => format!("{}.{}", on, to),
        None => to.to_string(),
    }
}

fn kind_of(word: &str) -> &'static str {
    match word {
        "widget" => "widget",
        "record" => "record",
        "enum" => "enum",
        "token" => "token",
        "fn" => "fn",
        "type" => "type",
        "let" => "let",
        "interface" => "interface",
        _ => "",
    }
}

fn word_of(kind: &str) -> &str {
    match kind {
        "token case" => "token",
        "extern" => "extern",
        k => k,
    }
}

fn list<T: AsRef<str>>(names: &[T]) -> String {
    if names.is_empty() {
        return "none".into();
    }
    names.iter().map(|n| format!("`{}`", n.as_ref())).collect::<Vec<_>>().join(", ")
}

fn hint(b: &Break) -> String {
    let member = b.member.clone().unwrap_or_default();
    match (b.kind, b.member.is_some()) {
        ("gone", false) => format!("Add a block for `{}` that renames it, `rename(to = …)`, or drops it", b.item),
        ("gone", true) => format!("In `{}`'s block, rename, move or drop `{}`", b.item, member),
        ("required", _) => format!("In `{}`'s block, give it a value: `add(…, value = …)`", b.item),
        ("type", _) => format!("In `{}`'s block, convert it: `set(… = {}, value = …)`", b.item, member),
        ("default", _) => format!("In `{}`'s block, set the old default where a use leaves it out (`when = !given({})`), or notify", b.item, member),
        _ => format!("In `{}`'s block, say what happens: `execute {{ … }}`, or notify", b.item),
    }
}

fn stmt_span(s: &Stmt) -> Span {
    match s {
        Stmt::Expr(e) | Stmt::Return(Some(e)) => e.span,
        Stmt::For(f) => f.name.span,
        Stmt::Let(v) | Stmt::Mut(v) => v.name.span,
        Stmt::Invoke { name, .. } => name.span,
        Stmt::Assign { place, .. } => place.span,
        Stmt::If(i) => i.branches.first().map(|(c, _)| match c {
            ast::Cond::Expr(e) => e.span,
            ast::Cond::Open { name, .. } => name.span,
        }).unwrap_or_default(),
        Stmt::Match(m) => m.subject.span,
        Stmt::Return(None) => Span::default(),
    }
}

/// An expression with a migration fn's parameters replaced by what the call gave them.
fn subst(e: &Expr, bound: &BTreeMap<String, Expr>) -> Expr {
    let mut e = e.clone();
    fn walk(e: &mut Expr, bound: &BTreeMap<String, Expr>) {
        if let ExprKind::Name(n) = &e.kind {
            if let Some(v) = bound.get(&n.name) {
                *e = v.clone();
                return;
            }
        }
        match &mut e.kind {
            ExprKind::Call { callee, args } => {
                walk(callee, bound);
                for a in args.items.iter_mut() {
                    walk(&mut a.item.value, bound);
                }
            }
            ExprKind::Field { target, .. } | ExprKind::Paren(target) => walk(target, bound),
            ExprKind::List(items) => {
                for x in items.items.iter_mut() {
                    walk(&mut x.item, bound);
                }
            }
            ExprKind::Unary { operand, .. } => walk(operand, bound),
            ExprKind::Binary { left, right, .. } => {
                walk(left, bound);
                walk(right, bound);
            }
            _ => {}
        }
    }
    walk(&mut e, bound);
    e
}

#[allow(dead_code)]
fn unused(_: &ApiItem) {}
