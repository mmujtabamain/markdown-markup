//! `mkp migrate`: brings documents written for an earlier version of a pack up to the version
//! they are built with, through the pack's migrations (page 6). It edits only the references the
//! checker finds, in place, after a summary, a warning and a y/n, and never writes a file that
//! doesn't compile afterwards.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use mkp_check::Source;
use mkp_syntax::ast::{self, DeclKind, Item};
use mkp_syntax::{parse, Entry, Lines};

const USAGE: &str = "usage: mkp migrate [<file|folder>…] [--pack a,b] [-c mkp.toml] [--from kit@1]
                  [--dry-run | --check | --diff] [--yes [1,2,…]] [--allow-dirty] [--answers answers.toml]
                  [--todo] [--allow-errors]
  brings each document up to the version of each pack it is built with, in place.
  In a terminal it shows what it will change and asks first; elsewhere it writes only with --yes.
  Its questions are numbered: --yes answers yes to all of them, --yes 1,3 to those only.
  --dry-run and --diff show what would change, --check fails if anything would.
  What a migration can't do refuses the file; --todo leaves that code as it was with a TODO above
  it. A file that doesn't compile afterwards isn't written; --allow-errors writes it anyway.";

/// `--allow-errors`: a file that doesn't compile afterwards is written all the same.
static ALLOW_ERRORS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A pack in the build: its version, the surfaces of earlier ones, and its migrations.
struct Pack {
    name: String,
    version: u32,
    /// Its own files, without its surfaces.
    files: Vec<Source>,
    surfaces: BTreeMap<u32, Source>,
    steps: BTreeMap<u32, (ast::MigrationDecl, String)>,
    /// Its migration fns, by name.
    fns: BTreeMap<String, ast::MigrationFn>,
}

/// What migrating one file came to.
#[derive(Default)]
struct Outcome {
    text: String,
    /// `kit@1 → kit@2` for each pack it moved through.
    moved: Vec<String>,
    changes: usize,
    deletions: Vec<String>,
    notices: Vec<String>,
    /// Why it can't be written: a use only a person can move, or errors after.
    refused: Vec<String>,
    inferred: Vec<String>,
    /// What `--todo` left for a person, and the errors `--allow-errors` wrote it with.
    todos: Vec<String>,
    errors: Vec<String>,
}

pub fn migrate_cmd(args: &[String]) -> ExitCode {
    let flag = |f: &str| args.iter().any(|a| a == f);
    let (dry, check, diff, dirty_ok) = (flag("--dry-run"), flag("--check"), flag("--diff"), flag("--allow-dirty"));
    crate::migrate_step::TODO.store(flag("--todo"), std::sync::atomic::Ordering::Relaxed);
    ALLOW_ERRORS.store(flag("--allow-errors"), std::sync::atomic::Ordering::Relaxed);
    // `--yes`, or `--yes 1,3` / `--yes 1 3`: the questions to answer yes, by number
    let numbers = |v: &str| -> Option<Vec<usize>> { v.split(',').filter(|x| !x.is_empty()).map(|x| x.parse().ok()).collect::<Option<Vec<usize>>>().filter(|n| !n.is_empty()) };
    let mut yes = false;
    let mut yes_to: BTreeSet<usize> = BTreeSet::new();
    let mut from: BTreeMap<String, u32> = BTreeMap::new();
    let mut answers: Option<PathBuf> = None;
    let mut rest = Vec::new();
    let mut k = 0;
    while k < args.len() {
        match args[k].as_str() {
            "--from" => {
                let Some(v) = args.get(k + 1).and_then(|v| v.split_once('@')).and_then(|(p, n)| Some((p.to_string(), n.parse::<u32>().ok()?))) else {
                    eprintln!("--from takes a pack and the version the files are written for: --from kit@1");
                    return ExitCode::from(2);
                };
                from.insert(v.0, v.1);
                k += 2;
            }
            "--answers" => {
                let Some(f) = args.get(k + 1) else {
                    eprintln!("--answers takes a file: --answers answers.toml");
                    return ExitCode::from(2);
                };
                if let Ok(text) = std::fs::read_to_string(f) {
                    if let Err(e) = crate::migrate_step::load_answers(&text) {
                        eprintln!("{}: {}", f, e);
                        return ExitCode::from(2);
                    }
                }
                answers = Some(PathBuf::from(f));
                k += 2;
            }
            "--yes" | "-y" => {
                yes = true;
                k += 1;
                while let Some(ns) = args.get(k).and_then(|v| numbers(v)) {
                    yes_to.extend(ns);
                    k += 1;
                }
            }
            a if a.starts_with("--yes=") => {
                let Some(ns) = numbers(&a["--yes=".len()..]) else {
                    eprintln!("--yes= takes the numbers of the questions to answer yes: --yes=1,3");
                    return ExitCode::from(2);
                };
                yes = true;
                yes_to.extend(ns);
                k += 1;
            }
            "--dry-run" | "--check" | "--diff" | "--allow-dirty" | "--todo" | "--allow-errors" => k += 1,
            "--help" | "-h" => {
                println!("{}", USAGE);
                return ExitCode::SUCCESS;
            }
            _ => {
                rest.push(args[k].clone());
                k += 1;
            }
        }
    }
    if yes {
        *crate::migrate_step::YES.lock().unwrap() = Some(if yes_to.is_empty() { crate::migrate_step::Yes::All } else { crate::migrate_step::Yes::Numbers(yes_to) });
    }
    let (targets, sources, _) = match crate::options(&rest) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let targets = if targets.is_empty() { vec![".".to_string()] } else { targets };
    let mut docs: Vec<PathBuf> = Vec::new();
    for t in &targets {
        let p = Path::new(t);
        if p.is_dir() {
            find_docs(p, &mut docs);
        } else if t.ends_with(".mkp.md") {
            docs.push(p.to_path_buf());
        } else {
            eprintln!("{}: not a document (.mkp.md) or a folder", t);
            return ExitCode::from(2);
        }
    }
    let packs = packs_of(&sources);
    let (uses, config) = uses_in_config(rest.iter().position(|a| a == "-c" || a == "--config").and_then(|i| rest.get(i + 1)).map(String::as_str), docs.first());
    let core = crate::core_sources();
    let base = mkp_check::compile_core(&core);

    let mut results: Vec<(PathBuf, String, Outcome)> = Vec::new();
    // packs that use a migrated pack go first, so documents are checked against them as they end
    let mut now = sources.clone();
    for p in &packs {
        for (path, old, o) in migrate_pack(&base, &packs, &sources, p) {
            if o.refused.is_empty() {
                if let Some(s) = now.iter_mut().find(|s| s.path == path.display().to_string()) {
                    s.text = o.text.clone();
                }
            }
            results.push((path, old, o));
        }
    }
    for d in &docs {
        let Ok(text) = std::fs::read_to_string(d) else {
            eprintln!("{}: can't be read", d.display());
            return ExitCode::from(2);
        };
        let o = migrate_doc(&base, &packs, &sources, &now, d, &text, &from, &uses);
        results.push((d.clone(), text, o));
    }

    // what was answered in a terminal, kept for the next run
    if let (Some(f), Some(text)) = (&answers, crate::migrate_step::answers_text()) {
        if let Err(e) = std::fs::write(f, text) {
            eprintln!("{}: {}", f.display(), e);
        }
    }
    // the summary
    let width = results.iter().map(|(p, _, _)| p.display().to_string().len()).max().unwrap_or(0);
    let (mut to_write, mut need, mut fine) = (Vec::new(), 0, 0);
    for (p, old, o) in &results {
        let name = format!("{:width$}", p.display(), width = width);
        if !o.refused.is_empty() {
            need += 1;
            println!("{}  {}  not written: {}", name, o.moved.join(", "), o.refused.join("; "));
        } else if o.text == *old {
            fine += 1;
            println!("{}  up to date", name);
        } else {
            let mut parts = vec![format!("{} change{}", o.changes, if o.changes == 1 { "" } else { "s" })];
            if !o.deletions.is_empty() {
                parts.push(format!("{} deletion{}", o.deletions.len(), if o.deletions.len() == 1 { "" } else { "s" }));
            }
            if !o.notices.is_empty() {
                parts.push(format!("{} to know", o.notices.len()));
            }
            if !o.todos.is_empty() {
                parts.push(format!("{} TODO{}", o.todos.len(), if o.todos.len() == 1 { "" } else { "s" }));
            }
            if !o.errors.is_empty() {
                parts.push("doesn't compile".to_string());
            }
            println!("{}  {}  {}{}", name, o.moved.join(", "), parts.join("; "), if o.inferred.is_empty() { String::new() } else { format!(" ({})", o.inferred.join(", ")) });
            to_write.push((p.clone(), old.clone(), o));
        }
    }
    println!("{} file{}: {} to migrate, {} need{} a person, {} up to date.", results.len(), if results.len() == 1 { "" } else { "s" }, to_write.len(), need, if need == 1 { "s" } else { "" }, fine);
    let notices: Vec<&String> = to_write.iter().flat_map(|(_, _, o)| o.notices.iter()).collect();
    if !notices.is_empty() {
        println!("\nto know:");
        for n in notices {
            println!("  {}", n);
        }
    }
    let asked = crate::migrate_step::ASKED.lock().unwrap().clone();
    if !asked.is_empty() {
        println!("\nquestions:");
        for (k, (q, a, by)) in asked.iter().enumerate() {
            let hint = if *by == "nobody to ask" { format!(" (--yes {} answers yes)", k + 1) } else { String::new() };
            println!("  {}. {}  {}: {}{}", k + 1, q, if *a { "yes" } else { "no" }, by, hint);
        }
    }
    let todos: Vec<String> = to_write.iter().flat_map(|(p, _, o)| o.todos.iter().map(move |t| format!("{}: {}", p.display(), t))).collect();
    if !todos.is_empty() {
        println!("\nleft for a person, each with a TODO above it:");
        for t in &todos {
            println!("  {}", t);
        }
    }
    let errors: Vec<String> = to_write.iter().flat_map(|(p, _, o)| o.errors.iter().map(move |e| format!("{}: {}", p.display(), e))).collect();
    if !errors.is_empty() {
        println!("\nwritten with errors (--allow-errors):");
        for e in &errors {
            println!("  {}", e);
        }
    }
    let deletions: Vec<&String> = to_write.iter().flat_map(|(_, _, o)| o.deletions.iter()).collect();
    if !deletions.is_empty() {
        println!("\nwarning: the newer versions drop what these files give:");
        for d in deletions {
            println!("  {}", d);
        }
    }
    if diff {
        // what would change, refused files too, so a person can see what's left
        for (p, old, o) in &results {
            if o.text != *old {
                print!("{}", unified(&p.display().to_string(), old, &o.text));
            }
        }
    }
    if to_write.is_empty() {
        return if need > 0 { ExitCode::from(1) } else { ExitCode::SUCCESS };
    }
    if check {
        return ExitCode::from(1);
    }
    if dry || diff {
        return if need > 0 { ExitCode::from(1) } else { ExitCode::SUCCESS };
    }
    // git: what can be undone, and what has edits of its own
    let paths: Vec<&Path> = to_write.iter().map(|(p, _, _)| p.as_path()).collect();
    let dirty = git_dirty(&paths);
    match &dirty {
        None => println!("\nnot in git: nothing can undo these changes; keep a copy first."),
        Some(d) if d.is_empty() => println!("\ngit: these files are in a git repository, and every change can be undone with git restore."),
        Some(d) => println!("\ngit: these files are in a git repository; {} {} uncommitted changes of {} own, which the migration's would mix with.", d.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "), if d.len() == 1 { "has" } else { "have" }, if d.len() == 1 { "its" } else { "their" }),
    }
    println!("warning: this rewrites {} file{} in place.", to_write.len(), if to_write.len() == 1 { "" } else { "s" });
    if std::io::stdin().is_terminal() && !yes {
        print!("Continue? [y/N] ");
        let _ = std::io::stdout().flush();
        let mut answer = String::new();
        let _ = std::io::stdin().read_line(&mut answer);
        if !matches!(answer.trim(), "y" | "Y" | "yes") {
            println!("Nothing written.");
            return ExitCode::from(1);
        }
    } else if !yes {
        println!("There is no terminal to ask in: nothing written. Pass --yes to write, or --dry-run to only look.");
        return ExitCode::from(1);
    }
    let mut written = 0;
    for (p, _, o) in &to_write {
        if !std::io::stdin().is_terminal() && !dirty_ok && dirty.as_ref().map_or(false, |d| d.iter().any(|x| x == p)) {
            println!("{}: skipped: it has uncommitted changes (--allow-dirty writes it)", p.display());
            continue;
        }
        if let Err(e) = std::fs::write(p, &o.text) {
            eprintln!("{}: {}", p.display(), e);
            return ExitCode::from(2);
        }
        written += 1;
    }
    println!("Wrote {} file{}.", written, if written == 1 { "" } else { "s" });
    // the tree is written for the newer versions once every file in it moved
    if let Some(cfg) = config.filter(|_| need == 0 && written == to_write.len() && !uses.is_empty()) {
        let to: BTreeMap<String, u32> = packs.iter().filter(|p| uses.get(&p.name).map_or(false, |v| *v < p.version)).map(|p| (p.name.clone(), p.version)).collect();
        if !to.is_empty() {
            if let Err(e) = bump_config(&cfg, &to) {
                eprintln!("{}: {}", cfg.display(), e);
                return ExitCode::from(2);
            }
            println!("{}: now written for {}.", cfg.display(), to.iter().map(|(p, v)| format!("{}@{}", p, v)).collect::<Vec<_>>().join(", "));
        }
    }
    // a file written with a TODO or with errors is still a person's to finish
    let left = to_write.iter().any(|(_, _, o)| !o.todos.is_empty() || !o.errors.is_empty());
    if need > 0 || written < to_write.len() || left {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn find_docs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort();
    for p in entries {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if p.is_dir() {
            if !name.starts_with('.') && name != "node_modules" && name != "target" {
                find_docs(&p, out);
            }
        } else if name.ends_with(".mkp.md") {
            out.push(p);
        }
    }
}

/// The build's packs, by their package lines: each one's version, surfaces and migrations.
fn packs_of(sources: &[Source]) -> Vec<Pack> {
    let mut packs: BTreeMap<String, Pack> = BTreeMap::new();
    for s in sources {
        let Some(f) = parse(&s.text, Entry::Mkp).file else { continue };
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

/// `[uses]` in the mkp.toml: the version of each pack its tree is written for.
fn uses_in_config(named: Option<&str>, file: Option<&PathBuf>) -> (BTreeMap<String, u32>, Option<PathBuf>) {
    let path = match named {
        Some(p) => Some(PathBuf::from(p)),
        None => file.and_then(|f| std::fs::canonicalize(f).ok()).and_then(|f| f.ancestors().skip(1).map(|d| d.join("mkp.toml")).find(|p| p.is_file())),
    };
    let Some(text) = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()) else { return (BTreeMap::new(), path) };
    let Ok(v) = text.parse::<toml::Value>() else { return (BTreeMap::new(), path) };
    (v.get("uses").and_then(|u| u.as_table()).map(|t| t.iter().filter_map(|(k, v)| Some((k.clone(), v.as_integer()? as u32))).collect()).unwrap_or_default(), path)
}

/// The mkp.toml's `[uses]`, each pack at the version its files are now written for.
fn bump_config(path: &Path, to: &BTreeMap<String, u32>) -> std::io::Result<()> {
    let text = std::fs::read_to_string(path)?;
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
    std::fs::write(path, out)
}

/// The `// mkp … kit@1` stamp above a document's definitions: the versions it is written for.
fn stamp(text: &str) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    for line in text.lines().take_while(|l| l.trim().is_empty() || l.starts_with("//") || l.starts_with("---") || !l.contains("@@@")).take(40) {
        if let Some(rest) = line.trim().strip_prefix("// mkp ") {
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

#[allow(clippy::too_many_arguments)]
fn migrate_doc(base: &mkp_check::Checker, packs: &[Pack], sources: &[Source], now: &[Source], path: &Path, text: &str, from: &BTreeMap<String, u32>, uses: &BTreeMap<String, u32>) -> Outcome {
    let mut o = Outcome { text: text.to_string(), ..Outcome::default() };
    let doc_path = path.display().to_string();
    let stamped = stamp(text);
    let compiles = |world: &[Source], text: &str| -> bool {
        let c = mkp_check::compile_on(base, &[world.to_vec()], &[Source { path: doc_path.clone(), text: text.to_string() }], "doc");
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
            let (compiled, refs) = mkp_check::compile_refs(base, &[world], &[Source { path: doc_path.clone(), text: o.text.clone() }], "doc");
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
            let done = crate::migrate_step::Step { text: &current, doc: &doc_path, refs: &refs, pack: &pack.name, step, label: &label, fns: &pack.fns, old: &old_world, new: &new_world, prose: true }.run();
            let _ = step_src;
            o.deletions.extend(done.deletions);
            o.notices.extend(done.notices);
            o.todos.extend(done.todos);
            if !done.refused.is_empty() {
                o.refused.extend(done.refused);
                return o;
            }
            o.changes += done.changes;
            o.text = crate::migrate_step::apply(&o.text, &done.edits);
        }
    }
    if o.moved.is_empty() {
        return o;
    }
    // what it says it is written for, now
    o.text = restamp(&o.text, &stamped, packs);
    let c = mkp_check::compile_on(base, &[now.to_vec()], &[Source { path: doc_path.clone(), text: o.text.clone() }], "doc");
    if c.module.is_none() {
        let lines = Lines::new(&o.text);
        let errs: Vec<String> = c.errors().filter(|d| d.file == doc_path).take(3).map(|d| format!("line {}: {}", lines.place(d.diagnostic.span.start).line, d.diagnostic.message)).collect();
        let why = format!("it doesn't compile afterwards ({})", if errs.is_empty() { "an error in a pack".to_string() } else { errs.join("; ") });
        if ALLOW_ERRORS.load(std::sync::atomic::Ordering::Relaxed) {
            o.errors.push(why);
        } else {
            o.refused.push(why);
        }
    }
    o
}

/// A pack written for an earlier version of a pack it uses: its files moved as documents are,
/// and its `uses` line brought up to the version it now uses.
fn migrate_pack(base: &mkp_check::Checker, packs: &[Pack], sources: &[Source], p: &Pack) -> Vec<(PathBuf, String, Outcome)> {
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
            let (compiled, refs) = mkp_check::compile_refs(base, &[world], &main, "main");
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
                let mine: Vec<mkp_check::FoundRef> = refs.iter().filter(|r| r.file == *path).cloned().collect();
                let done = crate::migrate_step::Step { text, doc: path, refs: &mine, pack: &used.name, step, label: &label, fns: &used.fns, old: &old_world, new: &new_world, prose: false }.run();
                let o = outcomes.get_mut(path).unwrap();
                o.deletions.extend(done.deletions);
                o.notices.extend(done.notices);
                o.todos.extend(done.todos);
                o.refused.extend(done.refused);
                o.changes += done.changes;
                *text = crate::migrate_step::apply(text, &done.edits);
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
    let c = mkp_check::compile_on(base, &[world], &main, "main");
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
        let Some(file) = parse(&f.text, Entry::Mkp).file else { continue };
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
fn world_at(sources: &[Source], pack: &Pack, v: u32) -> Vec<Source> {
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
    let Some(f) = parse(text, Entry::Mkp).file else { return Vec::new() };
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
fn restamp(text: &str, stamped: &BTreeMap<String, u32>, packs: &[Pack]) -> String {
    if stamped.is_empty() {
        return text.to_string();
    }
    let mut out = String::new();
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with("// mkp ") {
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

/// The files among these with uncommitted changes, or `None` outside git.
fn git_dirty(paths: &[&Path]) -> Option<Vec<PathBuf>> {
    let dir = paths.first()?.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let inside = std::process::Command::new("git").arg("-C").arg(dir).args(["rev-parse", "--is-inside-work-tree"]).output().ok()?;
    if !inside.status.success() {
        return None;
    }
    let mut dirty = Vec::new();
    for p in paths {
        let d = p.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let name = p.file_name()?;
        let out = std::process::Command::new("git").arg("-C").arg(d).args(["status", "--porcelain", "--"]).arg(name).output().ok()?;
        if !String::from_utf8_lossy(&out.stdout).trim().is_empty() {
            dirty.push(p.to_path_buf());
        }
    }
    Some(dirty)
}

/// A unified diff of one file, line by line.
fn unified(path: &str, old: &str, new: &str) -> String {
    let (a, b): (Vec<&str>, Vec<&str>) = (old.lines().collect(), new.lines().collect());
    let mut out = format!("--- {}\n+++ {}\n", path, path);
    // the longest common subsequence, as a table: small files, small cost
    let (n, m) = (a.len(), b.len());
    let mut t = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            t[i][j] = if a[i] == b[j] { t[i + 1][j + 1] + 1 } else { t[i + 1][j].max(t[i][j + 1]) };
        }
    }
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            i += 1;
            j += 1;
        } else if j < m && (i == n || t[i][j + 1] >= t[i + 1][j]) {
            out.push_str(&format!("@@ {} @@\n+{}\n", j + 1, b[j]));
            j += 1;
        } else {
            out.push_str(&format!("@@ {} @@\n-{}\n", i + 1, a[i]));
            i += 1;
        }
    }
    out
}
