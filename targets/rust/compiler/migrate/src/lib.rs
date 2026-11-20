//! What `xtmd migrate` does, on texts: documents written for an earlier version of a pack brought up
//! to the version they are built with, through the pack's migrations (page 6), and every file through
//! the steps of each release after the one its tree is written for. It edits only the references the
//! checker finds. The xtmd command reads the files, asks a person, and writes them; an editor gives
//! the texts it has and applies the result as edits of its own.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use xtmd_check::Source;
use xtmd_syntax::ast::{self, DeclKind, Item};
use xtmd_syntax::{parse, Entry, Lines};

pub mod releases;
pub mod step;
pub mod v02;

/// This xtmd's release: what a tree is written for once `xtmd migrate` has moved it.
pub const RELEASE: &str = env!("CARGO_PKG_VERSION");
/// The release a tree whose xtmd.toml doesn't say is taken to be written for: the first of 0.3.
pub const FIRST: &str = "0.3.0";

/// `--allow-errors`: a file that doesn't compile afterwards is written all the same.
pub static ALLOW_ERRORS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A pack in the build: its version, the surfaces of earlier ones, and its migrations.
pub struct Pack {
    pub name: String,
    pub version: u32,
    /// Its own files, without its surfaces.
    pub files: Vec<Source>,
    pub surfaces: BTreeMap<u32, Source>,
    pub steps: BTreeMap<u32, (ast::MigrationDecl, String)>,
    /// Its migration fns, by name.
    pub fns: BTreeMap<String, ast::MigrationFn>,
}

/// What migrating one file came to.
#[derive(Default)]
pub struct Outcome {
    pub text: String,
    /// `kit@1 → kit@2` for each pack it moved through.
    pub moved: Vec<String>,
    pub changes: usize,
    pub deletions: Vec<String>,
    pub notices: Vec<String>,
    /// Why it can't be written: a use only a person can move, or errors after.
    pub refused: Vec<String>,
    pub inferred: Vec<String>,
    /// What `--allow-todos` left for a person, and the errors `--allow-errors` wrote it with.
    pub todos: Vec<String>,
    /// Each value renamed, set or added, with its statement's why.
    pub changed: Vec<String>,
    pub errors: Vec<String>,
    /// The stand-in packs it is checked against, written with it.
    pub stand_ins: Vec<String>,
}

/// A document: `.xtmd`, or `.mkp.md` as 0.2 named it.
pub fn is_doc(p: &str) -> bool {
    p.ends_with(".xtmd") || p.ends_with(".mkp.md")
}

/// Where a document is written: a 0.2 name, `name.mkp.md`, moves to `name.xtmd`.
pub fn written_as(p: &Path) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_suffix(".mkp.md")) {
        Some(stem) => PathBuf::from(format!("{}.xtmd", stem)),
        None => p.to_path_buf(),
    }
}

/// The build's packs, by their package lines: each one's version, surfaces and migrations.
pub fn packs_of(sources: &[Source]) -> Vec<Pack> {
    let mut packs: BTreeMap<String, Pack> = BTreeMap::new();
    for s in sources {
        let Some(f) = parse(&s.text, Entry::Xtmd).file else { continue };
        let Some(name) = f.package.as_ref().map(|p| p.item.name.clone()) else { continue };
        let p = packs.entry(name.clone()).or_insert_with(|| Pack { name, version: 0, files: Vec::new(), surfaces: BTreeMap::new(), steps: BTreeMap::new(), fns: BTreeMap::new() });
        if let Some(v) = f.surface.as_ref().and_then(|v| v.name.parse().ok()) {
            p.surfaces.insert(v, s.clone());
            continue;
        }
        p.files.push(s.clone());
        for n in &f.items {
            match &n.item {
                Item::Decl(ast::Decl { kind: DeclKind::Pack(b), .. }) => p.version = b.version.name.parse().unwrap_or(0),
                Item::Decl(ast::Decl { kind: DeclKind::Migration(m), .. }) => {
                    if let Ok(v) = m.from.version.name.parse::<u32>() {
                        p.steps.insert(v, (m.clone(), s.text.clone()));
                    }
                }
                Item::Decl(ast::Decl { kind: DeclKind::MigrationFn(f), .. }) => {
                    p.fns.insert(f.sig.name.name.clone(), f.clone());
                }
                _ => {}
            }
        }
    }
    packs.into_values().collect()
}

/// A release, `0.3.1`, as numbers to compare.
pub fn release_of(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.trim().split('.').map(|x| x.parse::<u32>().ok());
    let r = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(r)
}

/// An xtmd.toml's text with its `xtmd = "…"` set to a release.
pub fn with_release(text: &str, to: &str) -> String {
    let line = format!("xtmd = \"{}\"\n", to);
    let mut out = String::new();
    let mut done = false;
    let mut top = true;
    for l in text.split_inclusive('\n') {
        let t = l.trim();
        if t.starts_with('[') {
            top = false;
        }
        if top && !done && t.split_once('=').map_or(false, |(k, _)| k.trim() == "xtmd") {
            out.push_str(&line);
            done = true;
            continue;
        }
        out.push_str(l);
    }
    if !done {
        out = format!("{}{}", line, out);
    }
    out
}

/// An xtmd.toml's text with each pack under `[uses]` at its new version.
pub fn with_uses(text: &str, to: &BTreeMap<String, u32>) -> String {
    let mut out = String::new();
    let mut in_uses = false;
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for line in text.split_inclusive('\n') {
        let t = line.trim();
        if t.starts_with('[') {
            if in_uses {
                for (p, v) in to.iter().filter(|(p, _)| !seen.contains(*p)) {
                    out.push_str(&format!("{} = {}\n", p, v));
                }
                seen.extend(to.keys().cloned());
            }
            in_uses = t == "[uses]";
        }
        if in_uses {
            if let Some((k, _)) = t.split_once('=') {
                let k = k.trim().to_string();
                if let Some(v) = to.get(&k) {
                    out.push_str(&format!("{} = {}\n", k, v));
                    seen.insert(k);
                    continue;
                }
            }
        }
        out.push_str(line);
    }
    if !text.contains("[uses]") {
        out.push_str("\n[uses]\n");
        in_uses = true;
    }
    if in_uses {
        for (p, v) in to.iter().filter(|(p, _)| !seen.contains(*p)) {
            out.push_str(&format!("{} = {}\n", p, v));
        }
    }
    out
}

/// The `// xtmd … kit@1` stamp above a document's definitions: the versions it is written for.
pub fn stamp(text: &str) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    for line in text.lines().take_while(|l| l.trim().is_empty() || l.starts_with("//") || l.starts_with("---") || !l.contains("@@@")).take(40) {
        if let Some(rest) = line.trim().strip_prefix("// xtmd ") {
            for w in rest.split_whitespace() {
                if let Some((p, v)) = w.split_once('@') {
                    if let Ok(v) = v.parse() {
                        out.insert(p.to_string(), v);
                    }
                }
            }
        }
    }
    out
}

/// A 0.3 document: through the steps of the releases after the one it is written for, then up to the
/// versions of the packs it uses.
#[allow(clippy::too_many_arguments)]
pub fn doc_through_releases(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], now: &[Source], path: &Path, text: &str, from: &BTreeMap<String, u32>, uses: &BTreeMap<String, u32>, steps: &[&crate::releases::ReleaseStep], label: &str) -> Outcome {
    match crate::releases::run(text, &path.display().to_string(), steps) {
        Err(e) => Outcome { text: text.to_string(), moved: vec![label.to_string()], refused: vec![e], ..Outcome::default() },
        Ok((stepped, said)) => {
            let mut o = migrate_doc(base, packs, sources, now, path, &stepped, from, uses);
            if !said.is_empty() {
                o.moved.insert(0, label.to_string());
                o.changes += said.len();
                o.notices.extend(said);
            }
            o
        }
    }
}

/// A document written for MKP 0.2: moved by the frozen 0.2 step, then through the packs'
/// migrations as a 0.3 document is. `None` for a document that is 0.3's: one with a `@@@` line, one
/// that compiles, or one 0.2.10 doesn't build either.
#[allow(clippy::too_many_arguments)]
fn migrate_02_doc(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], now: &[Source], path: &Path, text: &str, step02: &Step02, stand_ins: &mut BTreeMap<String, (PathBuf, String)>, stand_in_dir: &Path, uses: &BTreeMap<String, u32>) -> Option<Outcome> {
    // compiled as what it becomes: a 0.2 name is checked as the document it is written as
    let doc_path = written_as(path).display().to_string();
    let compiles = |world: &[Source], text: &str| xtmd_check::compile_on(base, &[world.to_vec()], &[Source { path: doc_path.clone(), text: text.to_string() }], "doc");
    let stamped = crate::v02::stamped(text);
    // 0.3's: a `@@@` line, or 0.3 in its prose; Markdown alone reads the same in both
    if !stamped && (text.lines().any(|l| l.trim_end() == "@@@") || crate::v02::speaks_03(text)) {
        return None;
    }
    let mut o = Outcome { text: text.to_string(), moved: vec!["mkp 0.2 → 0.3".to_string()], ..Outcome::default() };
    let m = match (step02.run)(path) {
        Ok(m) => m,
        Err(crate::v02::Failed::NotBuilt(e)) if stamped => {
            o.refused.push(if !step02.packs_given && e.contains("unknown-widget") {
                format!("{}. The 0.2 step builds the page with the 0.2 packs it was written with: pass each with --pack (a 0.2 pack is a folder with a manifest.mkp), beside the 0.3 ones", e)
            } else {
                e
            });
            return Some(o);
        }
        // the step couldn't run, so it can't say: a file that only 0.2 would write is refused
        Err(crate::v02::Failed::NotRun(e)) if stamped || crate::v02::looks_02(text).is_some() => {
            if !stamped {
                o.inferred.push(format!("taken as MKP 0.2's: it has {}", crate::v02::looks_02(text).unwrap_or("0.2's marks")));
            }
            o.refused.push(e);
            return Some(o);
        }
        Err(_) => return None,
    };
    if m.plain && !stamped {
        return None;
    }
    if !stamped {
        o.inferred.push("written for MKP 0.2, as 0.2.10 builds it".to_string());
    }
    o.changes = 1;
    o.notices = m.notes;
    o.todos = m.todos;
    // written as 0.3.0, then through the steps of each release after it
    match crate::releases::run(&m.doc, &doc_path, &crate::releases::between(FIRST, RELEASE, crate::releases::STEPS)) {
        Ok((t, said)) => {
            if !said.is_empty() {
                o.moved.push(format!("xtmd {} → {}", FIRST, RELEASE));
                o.changes += said.len();
                o.notices.extend(said);
            }
            o.text = t;
        }
        Err(e) => {
            o.refused.push(e);
            return Some(o);
        }
    }
    // each pack it uses: its own 0.3 release where the build has one, else a stand-in made from its
    // 0.2 definitions, which is a person's to replace
    let mut world = now.to_vec();
    let mut from: BTreeMap<String, u32> = BTreeMap::new();
    for (name, shim) in &m.packs {
        if packs.iter().any(|p| p.name == *name) {
            from.insert(name.clone(), crate::v02::version_of(shim).unwrap_or(1));
            continue;
        }
        let entry = stand_ins.entry(name.clone()).or_insert_with(|| (stand_in_dir.join(name).join(format!("{}.xtmdpack", name)), String::new()));
        entry.1 = if entry.1.is_empty() { crate::v02::marked(shim, name) } else { crate::v02::merge(&entry.1, shim) };
        o.stand_ins.push(name.clone());
        world.push(Source { path: entry.0.display().to_string(), text: entry.1.clone() });
    }
    if !o.stand_ins.is_empty() {
        let names: Vec<String> = o.stand_ins.iter().map(|n| format!("{} ({})", n, stand_ins[n].0.display())).collect();
        o.text = o.text.replacen("// Nothing to finish by hand.\n", &format!("// TODO(xtmd migrate): checked against a stand-in for {}, until the pack's own 0.3 release replaces it.\n", names.join(", ")), 1);
    }
    if (!o.todos.is_empty() || !o.stand_ins.is_empty()) && !crate::step::TODO.load(std::sync::atomic::Ordering::Relaxed) {
        let mut what: Vec<String> = o.todos.clone();
        what.extend(o.stand_ins.iter().map(|p| format!("{} has no 0.3 release here, so it needs a stand-in made from its 0.2 definitions", p)));
        let n = what.len();
        o.refused.push(format!("0.3 can't yet say {} thing{} the way 0.2 did ({}): --allow-todos writes it with a TODO at each", n, if n == 1 { "" } else { "s" }, what.join("; ")));
        return Some(o);
    }
    // then up to the versions of the 0.3 packs it uses, through their migrations
    if !from.is_empty() {
        let next = migrate_doc(base, packs, sources, &world, path, &o.text, &from, uses);
        o.moved.extend(next.moved.iter().cloned());
        o.changes += next.changes;
        o.deletions.extend(next.deletions);
        o.notices.extend(next.notices);
        o.todos.extend(next.todos);
        o.changed.extend(next.changed);
        o.errors.extend(next.errors);
        o.refused.extend(next.refused);
        o.inferred.extend(next.inferred);
        o.text = next.text;
        if !o.refused.is_empty() || next.moved.len() > 0 {
            return Some(o);
        }
    }
    let c = compiles(&world, &o.text);
    if c.module.is_none() {
        let lines = Lines::new(&o.text);
        let errs: Vec<String> = c.errors().filter(|d| d.file == doc_path).take(3).map(|d| format!("line {}: {}", lines.place(d.diagnostic.span.start).line, d.diagnostic.message)).collect();
        let why = format!("it doesn't compile as 0.3 ({})", if errs.is_empty() { "an error in a pack".to_string() } else { errs.join("; ") });
        if ALLOW_ERRORS.load(std::sync::atomic::Ordering::Relaxed) {
            o.errors.push(why);
        } else {
            o.refused.push(format!("{}; --allow-errors writes it anyway", why));
        }
    }
    Some(o)
}

#[allow(clippy::too_many_arguments)]
pub fn migrate_doc(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], now: &[Source], path: &Path, text: &str, from: &BTreeMap<String, u32>, uses: &BTreeMap<String, u32>) -> Outcome {
    let mut o = Outcome { text: text.to_string(), ..Outcome::default() };
    // checked as the document it is written as, for a 0.2 name too
    let doc_path = written_as(path).display().to_string();
    // a pack it imports that isn't in the build: nothing can say which version it is written for
    let missing: Vec<String> = imported(text).into_iter().filter(|n| !packs.iter().any(|p| p.name == *n) && !core_packs(base).contains(n)).collect();
    if !missing.is_empty() {
        o.refused.push(format!(
            "it imports {}, which {} in the build: pass {} folder with --pack, or list it in xtmd.toml's packs",
            missing.join(", "),
            if missing.len() == 1 { "isn't" } else { "aren't" },
            if missing.len() == 1 { "its" } else { "each one's" }
        ));
        return o;
    }
    let stamped = stamp(text);
    let compiles = |world: &[Source], text: &str| -> bool {
        let c = xtmd_check::compile_on(base, &[world.to_vec()], &[Source { path: doc_path.clone(), text: text.to_string() }], "doc");
        c.module.is_some()
    };
    for pack in packs.iter().filter(|p| !p.steps.is_empty() || !p.surfaces.is_empty()) {
        // the version the file is written for: said, or found by what it compiles against
        let said = from.get(&pack.name).or_else(|| stamped.get(&pack.name)).or_else(|| uses.get(&pack.name)).copied();
        let written_for = match said {
            Some(v) => v,
            None => {
                if !mentions(text, &pack.name) || compiles(sources, &o.text) {
                    continue;
                }
                let found = pack.surfaces.keys().rev().copied().find(|v| compiles(&world_at(sources, pack, *v), &o.text));
                match found {
                    Some(v) => {
                        o.inferred.push(format!("written for {}@{}, as it compiles against that surface", pack.name, v));
                        v
                    }
                    None => continue,
                }
            }
        };
        if written_for >= pack.version {
            continue;
        }
        o.moved.push(format!("{}@{} → {}@{}", pack.name, written_for, pack.name, pack.version));
        for v in written_for..pack.version {
            let Some((step, step_src)) = pack.steps.get(&v) else {
                o.refused.push(format!("{} has no migration from {}@{}", pack.name, pack.name, v));
                return o;
            };
            let world = world_at(sources, pack, v);
            let (compiled, refs) = xtmd_check::compile_refs(base, &[world], &[Source { path: doc_path.clone(), text: o.text.clone() }], "doc");
            if compiled.module.is_none() {
                o.refused.push(format!("it doesn't compile against {}@{}, the version it is written for", pack.name, v));
                return o;
            }
            let label = format!("{}@{}", pack.name, v + 1);
            let current = o.text.clone();
            let old_world: Vec<Source> = pack.surfaces.get(&v).cloned().into_iter().collect();
            let new_world: Vec<Source> = match pack.surfaces.get(&(v + 1)) {
                Some(s) if v + 1 < pack.version => vec![s.clone()],
                _ => pack.files.clone(),
            };
            let done = crate::step::Step { text: &current, doc: &doc_path, refs: &refs, pack: &pack.name, step, label: &label, fns: &pack.fns, old: &old_world, new: &new_world, prose: true }.run();
            let _ = step_src;
            o.deletions.extend(done.deletions);
            o.notices.extend(done.notices);
            o.todos.extend(done.todos);
            o.changed.extend(done.changed);
            if !done.refused.is_empty() {
                o.refused.extend(done.refused);
                return o;
            }
            o.changes += done.changes;
            o.text = crate::step::apply(&o.text, &done.edits);
        }
    }
    if o.moved.is_empty() {
        return o;
    }
    // what it says it is written for, now
    o.text = restamp(&o.text, &stamped, packs);
    let c = xtmd_check::compile_on(base, &[now.to_vec()], &[Source { path: doc_path.clone(), text: o.text.clone() }], "doc");
    if c.module.is_none() {
        let lines = Lines::new(&o.text);
        let at: Vec<u32> = c.errors().filter(|d| d.file == doc_path).map(|d| lines.place(d.diagnostic.span.start).line).collect();
        let errs: Vec<String> = c.errors().filter(|d| d.file == doc_path).take(3).map(|d| format!("line {}: {}", lines.place(d.diagnostic.span.start).line, d.diagnostic.message)).collect();
        let why = format!("it doesn't compile afterwards ({})", if errs.is_empty() { "an error in a pack".to_string() } else { errs.join("; ") });
        // code --allow-todos left as it was, under its TODO, is the TODO's to fix
        let at_todos = !o.todos.is_empty() && !at.is_empty() && at.iter().all(|l| under_a_todo(&o.text, *l));
        if ALLOW_ERRORS.load(std::sync::atomic::Ordering::Relaxed) || at_todos {
            o.errors.push(if at_todos { format!("{}, at the TODOs", why) } else { why });
        } else {
            o.refused.push(format!("{}; --allow-errors writes it anyway", why));
        }
    }
    o
}

/// Whether line `n` (from 1) is code a TODO of xtmd migrate's is above: in the three lines before it.
fn under_a_todo(text: &str, n: u32) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    let n = n as usize;
    (n.saturating_sub(3).max(1)..n).any(|k| lines.get(k - 1).map_or(false, |l| l.contains("TODO(xtmd migrate)")))
}

/// The packs a file imports, by name.
fn imported(text: &str) -> Vec<String> {
    let Some(f) = parse(text, Entry::Document).file else { return Vec::new() };
    let mut out: Vec<String> = f.items.iter().filter_map(|n| if let Item::Import(i) = &n.item { i.path.first().map(|p| p.name.clone()) } else { None }).collect();
    out.dedup();
    out
}

/// The packs core is made of, which every build has.
fn core_packs(base: &xtmd_check::Checker) -> Vec<String> {
    base.packs.keys().cloned().collect()
}

/// A pack written for an earlier version of a pack it uses: its files moved as documents are,
/// and its `uses` line brought up to the version it now uses.
pub fn migrate_pack(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], p: &Pack) -> Vec<(PathBuf, String, Outcome)> {
    let mut out: Vec<(PathBuf, String, Outcome)> = Vec::new();
    let mut texts: Vec<(String, String)> = p.files.iter().map(|f| (f.path.clone(), f.text.clone())).collect();
    let mut outcomes: BTreeMap<String, Outcome> = texts.iter().map(|(path, t)| (path.clone(), Outcome { text: t.clone(), ..Outcome::default() })).collect();
    let uses = uses_line(&p.files);
    let mut moved = Vec::new();
    for used in packs.iter().filter(|u| u.name != p.name) {
        let Some(&from) = uses.get(&used.name) else { continue };
        if from >= used.version {
            continue;
        }
        moved.push(format!("{}@{} → {}@{}", used.name, from, used.name, used.version));
        for v in from..used.version {
            let Some((step, _)) = used.steps.get(&v) else {
                for o in outcomes.values_mut() {
                    o.refused.push(format!("{} has no migration from {}@{}", used.name, used.name, v));
                }
                break;
            };
            let own: std::collections::HashSet<&str> = p.files.iter().map(|f| f.path.as_str()).collect();
            let world: Vec<Source> = world_at(sources, used, v).into_iter().filter(|s| !own.contains(s.path.as_str())).collect();
            let main: Vec<Source> = texts.iter().map(|(path, t)| Source { path: path.clone(), text: t.clone() }).collect();
            let (compiled, refs) = xtmd_check::compile_refs(base, &[world], &main, "main");
            if compiled.module.is_none() {
                for o in outcomes.values_mut() {
                    o.refused.push(format!("{} doesn't compile against {}@{}, the version it uses", p.name, used.name, v));
                }
                break;
            }
            let old_world: Vec<Source> = used.surfaces.get(&v).cloned().into_iter().collect();
            let new_world: Vec<Source> = match used.surfaces.get(&(v + 1)) {
                Some(s) if v + 1 < used.version => vec![s.clone()],
                _ => used.files.clone(),
            };
            let label = format!("{}@{}", used.name, v + 1);
            for (path, text) in texts.iter_mut() {
                let mine: Vec<xtmd_check::FoundRef> = refs.iter().filter(|r| r.file == *path).cloned().collect();
                let done = crate::step::Step { text, doc: path, refs: &mine, pack: &used.name, step, label: &label, fns: &used.fns, old: &old_world, new: &new_world, prose: false }.run();
                let o = outcomes.get_mut(path).unwrap();
                o.deletions.extend(done.deletions);
                o.notices.extend(done.notices);
                o.todos.extend(done.todos);
                o.changed.extend(done.changed);
                o.refused.extend(done.refused);
                o.changes += done.changes;
                *text = crate::step::apply(text, &done.edits);
            }
        }
    }
    if moved.is_empty() {
        return out;
    }
    // the uses line, and the pack as it now is, compiled with what it uses
    for (_, text) in texts.iter_mut() {
        let mut t = String::new();
        for line in text.split_inclusive('\n') {
            if line.trim_start().starts_with("uses ") {
                let mut l = line.to_string();
                for used in packs {
                    if let Some(v) = uses.get(&used.name) {
                        l = l.replace(&format!("{}@{}", used.name, v), &format!("{}@{}", used.name, used.version));
                    }
                }
                t.push_str(&l);
            } else {
                t.push_str(line);
            }
        }
        *text = t;
    }
    let own: std::collections::HashSet<&str> = p.files.iter().map(|f| f.path.as_str()).collect();
    let world: Vec<Source> = sources.iter().filter(|s| !own.contains(s.path.as_str())).cloned().collect();
    let main: Vec<Source> = texts.iter().map(|(path, t)| Source { path: path.clone(), text: t.clone() }).collect();
    let c = xtmd_check::compile_on(base, &[world], &main, "main");
    let errors: Vec<String> = c.errors().take(3).map(|d| format!("{}: {}", d.file, d.diagnostic.message)).collect();
    for (path, text) in texts {
        let mut o = outcomes.remove(&path).unwrap();
        o.text = text;
        o.moved = moved.clone();
        if !errors.is_empty() && o.refused.is_empty() {
            let why = format!("the pack doesn't compile afterwards ({})", errors.join("; "));
            if ALLOW_ERRORS.load(std::sync::atomic::Ordering::Relaxed) {
                o.errors.push(why);
            } else {
                o.refused.push(why);
            }
        }
        let old = p.files.iter().find(|f| f.path == path).map(|f| f.text.clone()).unwrap_or_default();
        out.push((PathBuf::from(path), old, o));
    }
    // a pack is written whole or not at all
    if out.iter().any(|(_, _, o)| !o.refused.is_empty()) {
        let why: Vec<String> = out.iter().flat_map(|(_, _, o)| o.refused.clone()).collect();
        for (_, _, o) in out.iter_mut() {
            if o.refused.is_empty() {
                o.refused.push(format!("another file of {} can't be moved: {}", p.name, why.first().cloned().unwrap_or_default()));
            }
        }
    }
    out
}

/// The versions a pack's `uses` line asks for.
fn uses_line(files: &[Source]) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    for f in files {
        let Some(file) = parse(&f.text, Entry::Xtmd).file else { continue };
        for n in &file.items {
            if let Item::Decl(ast::Decl { kind: DeclKind::Pack(b), .. }) = &n.item {
                for l in b.lines.iter() {
                    if let ast::PackLine::Uses(refs) = l {
                        for r in refs {
                            if let Ok(v) = r.version.name.parse() {
                                out.insert(r.name.name.clone(), v);
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

fn mentions(text: &str, pack: &str) -> bool {
    text.lines().any(|l| l.trim_start().starts_with(&format!("import {}", pack)))
}

/// The build as it was at `pack@v`: its surface standing in for the pack, under the pack's name.
pub fn world_at(sources: &[Source], pack: &Pack, v: u32) -> Vec<Source> {
    let own: std::collections::HashSet<&str> = pack.files.iter().chain(pack.surfaces.values()).map(|s| s.path.as_str()).collect();
    let mut out: Vec<Source> = sources.iter().filter(|s| !own.contains(s.path.as_str())).cloned().collect();
    if let Some(s) = pack.surfaces.get(&v) {
        let text = s.text.replacen(&format!("package {}@{};", pack.name, v), &format!("package {};", pack.name), 1);
        // a pack block, so the surface provides what it lists
        let names = provided(&text);
        let text = text.replacen(&format!("package {};", pack.name), &format!("package {};\n\npack {}@{} {{\n    provides {};\n}}\n", pack.name, pack.name, v, names.join(", ")), 1);
        out.push(Source { path: s.path.clone(), text });
    }
    out
}

/// Every top-level name a surface declares.
fn provided(text: &str) -> Vec<String> {
    let Some(f) = parse(text, Entry::Xtmd).file else { return Vec::new() };
    f.items
        .iter()
        .filter_map(|n| match &n.item {
            Item::Decl(d) => match &d.kind {
                DeclKind::Fn(x) | DeclKind::ExternFn(x) if x.sig.on.is_some() => None,
                DeclKind::Tokens(_) | DeclKind::Pack(_) => None,
                k => Some(k.name().name.clone()),
            },
            _ => None,
        })
        .collect()
}

/// The stamp brought up to the versions the file now is written for, where it has one.
pub fn restamp(text: &str, stamped: &BTreeMap<String, u32>, packs: &[Pack]) -> String {
    if stamped.is_empty() {
        return text.to_string();
    }
    let mut out = String::new();
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with("// xtmd ") {
            let mut l = line.to_string();
            for p in packs {
                if let Some(v) = stamped.get(&p.name) {
                    l = l.replace(&format!("{}@{}", p.name, v), &format!("{}@{}", p.name, p.version));
                }
            }
            out.push_str(&l);
        } else {
            out.push_str(line);
        }
    }
    out
}

/// A unified diff of one file, as git writes one (`a/` and `b/` before its path, so `git apply`
/// and `patch -p1` take it): its changes in hunks, with three lines around each, the old lines
/// before the new.
pub fn unified(path: &str, old: &str, new: &str) -> String {
    let (a, b): (Vec<&str>, Vec<&str>) = (old.lines().collect(), new.lines().collect());
    // the longest common subsequence, as a table: small files, small cost
    let (n, m) = (a.len(), b.len());
    let mut t = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            t[i][j] = if a[i] == b[j] { t[i + 1][j + 1] + 1 } else { t[i + 1][j].max(t[i][j + 1]) };
        }
    }
    // the edit, line by line: (' ' | '-' | '+', old line, new line)
    let mut ops: Vec<(char, usize, usize)> = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            ops.push((' ', i, j));
            i += 1;
            j += 1;
        } else if i < n && (j == m || t[i + 1][j] >= t[i][j + 1]) {
            ops.push(('-', i, j));
            i += 1;
        } else {
            ops.push(('+', i, j));
            j += 1;
        }
    }
    const AROUND: usize = 3;
    let changed: Vec<usize> = ops.iter().enumerate().filter(|(_, o)| o.0 != ' ').map(|(k, _)| k).collect();
    let name = path.trim_start_matches("./");
    let mut out = if name.starts_with('/') { format!("--- {}\n+++ {}\n", name, name) } else { format!("--- a/{}\n+++ b/{}\n", name, name) };
    let mut k = 0;
    while k < changed.len() {
        // one hunk: changes closer than twice the context run together
        let first = changed[k];
        let mut last = first;
        while k + 1 < changed.len() && changed[k + 1] - last <= 2 * AROUND + 1 {
            k += 1;
            last = changed[k];
        }
        k += 1;
        let (from, to) = (first.saturating_sub(AROUND), (last + AROUND + 1).min(ops.len()));
        let part = &ops[from..to];
        let olds = part.iter().filter(|o| o.0 != '+').count();
        let news = part.iter().filter(|o| o.0 != '-').count();
        let (a0, b0) = (part[0].1, part[0].2);
        let start = |at: usize, len: usize| if len == 0 { at } else { at + 1 };
        out.push_str(&format!("@@ -{},{} +{},{} @@\n", start(a0, olds), olds, start(b0, news), news));
        for (op, x, y) in part {
            let line = if *op == '+' { b[*y] } else { a[*x] };
            out.push_str(&format!("{}{}\n", op, line));
        }
    }
    out
}

/// The 0.2 → 0.3 step, as whoever runs the migration has it: the xtmd command runs the frozen file
/// with Node; an editor gives what it ran, or says why it couldn't.
pub struct Step02<'a> {
    pub run: &'a dyn Fn(&Path) -> Result<v02::Migrated, v02::Failed>,
    /// Whether 0.2 packs were given to build the documents with.
    pub packs_given: bool,
}

/// What a pass over the files works with: the build as the release steps left it, and what the tree
/// is written for.
pub struct Tree<'a> {
    /// Core, compiled.
    pub base: &'a xtmd_check::Checker,
    /// The packs' files, after the release steps.
    pub sources: &'a [Source],
    pub packs: &'a [Pack],
    /// Each pack file the release steps changed: its text before them, and what they say.
    pub stepped: &'a BTreeMap<String, (String, Vec<String>)>,
    /// Each pack file they can't move: its text, and why.
    pub step_refused: &'a BTreeMap<String, (String, String)>,
    pub release_steps: &'a [&'a releases::ReleaseStep],
    /// `xtmd 0.3.0 → 0.3.1`: the release steps' part of what a file moved through.
    pub release_label: &'a str,
    /// The version each pack's files are written for, where nothing in them says (`--from kit@1`).
    pub from: &'a BTreeMap<String, u32>,
    /// xtmd.toml's [uses].
    pub uses: &'a BTreeMap<String, u32>,
    /// Where the stand-ins for 0.2 packs with no 0.3 release go.
    pub stand_in_dir: &'a Path,
    pub step02: &'a Step02<'a>,
}

/// The release steps, run on the packs' files before anything else: `sources` holds their texts after
/// them. Gives each file they change (its text before, and what they say), and each they can't move
/// (its text, and why).
#[allow(clippy::type_complexity)]
pub fn step_packs(sources: &mut [Source], steps: &[&releases::ReleaseStep]) -> (BTreeMap<String, (String, Vec<String>)>, BTreeMap<String, (String, String)>) {
    let mut stepped: BTreeMap<String, (String, Vec<String>)> = BTreeMap::new();
    let mut step_refused: BTreeMap<String, (String, String)> = BTreeMap::new();
    for s in sources.iter_mut() {
        match releases::run(&s.text, &s.path, steps) {
            Ok((text, said)) if !said.is_empty() => {
                stepped.insert(s.path.clone(), (std::mem::replace(&mut s.text, text), said));
            }
            Ok(_) => {}
            Err(e) => {
                step_refused.insert(s.path.clone(), (s.text.clone(), e));
            }
        }
    }
    (stepped, step_refused)
}

/// One pass over every file: the packs that use a migrated pack first, then each document (its path
/// and text). Gives each file's outcome with its text before, and the stand-ins for the 0.2 packs that
/// have no 0.3 release here, by name. The questions it met that no one has answered are
/// [`step::pending`]: answered, the files are planned again.
#[allow(clippy::type_complexity)]
pub fn pass(t: &Tree, docs: &[(PathBuf, String)]) -> (Vec<(PathBuf, String, Outcome)>, BTreeMap<String, (PathBuf, String)>) {
    step::new_pass();
    let (base, packs, sources) = (t.base, t.packs, t.sources);
    let mut results: Vec<(PathBuf, String, Outcome)> = Vec::new();
    // packs that use a migrated pack go first, so documents are checked against them as they end
    let mut now = sources.to_vec();
    for p in packs {
        for (path, old, o) in migrate_pack(base, packs, sources, p) {
            if o.refused.is_empty() {
                if let Some(s) = now.iter_mut().find(|s| s.path == path.display().to_string()) {
                    s.text = o.text.clone();
                }
            }
            results.push((path, old, o));
        }
    }
    // a pack's file the release steps changed: compared with what is on disk, and written with what
    // they say; one they can't move is refused
    for (path, old, o) in results.iter_mut() {
        if let Some((disk, said)) = t.stepped.get(&path.display().to_string()) {
            *old = disk.clone();
            o.moved.insert(0, t.release_label.to_string());
            o.changes += said.len();
            o.notices.extend(said.iter().cloned());
        }
    }
    for (path, (disk, said)) in t.stepped {
        if !results.iter().any(|(p, _, _)| p.display().to_string() == *path) {
            let text = sources.iter().find(|s| s.path == *path).map(|s| s.text.clone()).unwrap_or_default();
            results.push((PathBuf::from(path), disk.clone(), Outcome { text, moved: vec![t.release_label.to_string()], changes: said.len(), notices: said.clone(), ..Outcome::default() }));
        }
    }
    for (path, (disk, why)) in t.step_refused {
        results.push((PathBuf::from(path), disk.clone(), Outcome { text: disk.clone(), moved: vec![t.release_label.to_string()], refused: vec![why.clone()], ..Outcome::default() }));
    }
    let mut stand_ins: BTreeMap<String, (PathBuf, String)> = BTreeMap::new();
    for (d, text) in docs {
        let o = match migrate_02_doc(base, packs, sources, &now, d, text, t.step02, &mut stand_ins, t.stand_in_dir, t.uses) {
            Some(o) => o,
            None => doc_through_releases(base, packs, sources, &now, d, text, t.from, t.uses, t.release_steps, t.release_label),
        };
        results.push((d.clone(), text.clone(), o));
    }
    (results, stand_ins)
}

/// xtmd.toml's `[uses]`: the version of each pack its tree is written for.
pub fn uses_in(text: &str) -> BTreeMap<String, u32> {
    let Ok(v) = text.parse::<toml::Value>() else { return BTreeMap::new() };
    v.get("uses").and_then(|u| u.as_table()).map(|t| t.iter().filter_map(|(k, v)| Some((k.clone(), v.as_integer()? as u32))).collect()).unwrap_or_default()
}

/// xtmd.toml's `xtmd = "0.3.x"`: the release of xtmd the tree is written for.
pub fn release_in(text: &str) -> Option<String> {
    let v: toml::Value = text.parse().ok()?;
    v.get("xtmd").and_then(|m| m.as_str()).map(str::to_string)
}

/// What xtmd.toml's `[uses]` says once the tree moves: each pack written for an earlier version than
/// the build's, at the build's.
pub fn uses_after(packs: &[Pack], uses: &BTreeMap<String, u32>) -> BTreeMap<String, u32> {
    packs.iter().filter(|p| uses.get(&p.name).map_or(false, |v| *v < p.version)).map(|p| (p.name.clone(), p.version)).collect()
}

#[cfg(test)]
fn core_sources() -> Vec<Source> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_string_lossy()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_s_packs_are_the_ones_its_files_name() {
        let core = core_sources();
        let mut named: Vec<String> = core.iter().filter_map(|s| parse(&s.text, Entry::Xtmd).file?.package.map(|p| p.item.name)).collect();
        named.sort();
        named.dedup();
        assert_eq!(core_packs(&xtmd_check::compile_core(&core)), named);
    }

    #[test]
    fn a_document_written_for_an_earlier_release_takes_its_steps_then_compiles() {
        let base = xtmd_check::compile_core(&core_sources());
        let steps = crate::releases::between("0.3.0", "0.3.2", crate::releases::tests::STEPS);
        let doc = "# Notes\n\n@rule();\n";
        let o = doc_through_releases(&base, &[], &[], &[], Path::new("notes.xtmd"), doc, &BTreeMap::new(), &BTreeMap::new(), &steps, "xtmd 0.3.0 → 0.3.2");
        assert!(o.refused.is_empty(), "{:?}", o.refused);
        assert_eq!(o.text, "# Notes\n\n@divider();\n");
        assert_eq!(o.moved, ["xtmd 0.3.0 → 0.3.2"]);
        assert_eq!(o.notices, ["xtmd 0.3.2: `rule` is `divider` now"]);
        // a release whose step can't move it refuses it, as it was
        let later = crate::releases::between("0.3.2", "0.4.0", crate::releases::tests::STEPS);
        let o = doc_through_releases(&base, &[], &[], &[], Path::new("notes.xtmd"), doc, &BTreeMap::new(), &BTreeMap::new(), &later, "xtmd 0.3.2 → 0.4.0");
        assert_eq!((o.text.as_str(), o.refused), (doc, vec!["xtmd 0.4.0: a form only a person can rewrite".to_string()]));
    }
}

#[cfg(test)]
mod diff_tests {
    use super::unified;

    #[test]
    fn a_diff_is_hunks_with_three_lines_around_each_change_old_before_new() {
        let old = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\n";
        let new = "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nM\n";
        assert_eq!(unified("f", old, new), "--- a/f\n+++ b/f\n@@ -1,5 +1,5 @@\n a\n-b\n+B\n c\n d\n e\n@@ -10,4 +10,4 @@\n j\n k\n l\n-m\n+M\n");
        // changes close together share a hunk; a file that was empty starts at line 0
        assert_eq!(unified("f", "a\nb\nc\n", "a\nx\nc\ny\n"), "--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n a\n-b\n+x\n c\n+y\n");
        assert_eq!(unified("f", "", "a\n"), "--- a/f\n+++ b/f\n@@ -0,0 +1,1 @@\n+a\n");
    }
}
