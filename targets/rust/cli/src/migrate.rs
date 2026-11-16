//! `mkp migrate`: brings documents written for an earlier version of a pack up to the version
//! they are built with, through the pack's migrations (page 6). It edits only the references the
//! checker finds, in place, after a summary, a warning and a y/n, and never writes a file that
//! doesn't compile afterwards.

use std::collections::BTreeMap;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use mkp_check::{FoundRef, Source};
use mkp_syntax::ast::{self, DeclKind, Expr, ExprKind, Item, MigrationItem, MigrationStmt, Stmt};
use mkp_syntax::{parse, Entry, Lines, Span};

const USAGE: &str = "usage: mkp migrate [<file|folder>…] [--pack a,b] [-c mkp.toml] [--from kit@1]
                  [--dry-run | --check | --diff] [--yes] [--allow-dirty]
  brings each document up to the version of each pack it is built with, in place.
  In a terminal it shows what it will change and asks first; elsewhere it writes only with --yes.
  --dry-run and --diff show what would change, --check fails if anything would.";

/// A pack in the build: its version, the surfaces of earlier ones, and its migrations.
struct Pack {
    name: String,
    version: u32,
    /// Its own files, without its surfaces.
    files: Vec<Source>,
    surfaces: BTreeMap<u32, Source>,
    steps: BTreeMap<u32, (ast::MigrationDecl, String)>,
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
}

pub fn migrate_cmd(args: &[String]) -> ExitCode {
    let flag = |f: &str| args.iter().any(|a| a == f);
    let (dry, check, diff, yes, dirty_ok) = (flag("--dry-run"), flag("--check"), flag("--diff"), flag("--yes") || flag("-y"), flag("--allow-dirty"));
    let mut from: BTreeMap<String, u32> = BTreeMap::new();
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
            "--dry-run" | "--check" | "--diff" | "--yes" | "-y" | "--allow-dirty" => k += 1,
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
    for d in &docs {
        let Ok(text) = std::fs::read_to_string(d) else {
            eprintln!("{}: can't be read", d.display());
            return ExitCode::from(2);
        };
        let o = migrate_doc(&base, &packs, &sources, d, &text, &from, &uses);
        results.push((d.clone(), text, o));
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
    if need > 0 || written < to_write.len() {
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
        let p = packs.entry(name.clone()).or_insert_with(|| Pack { name, version: 0, files: Vec::new(), surfaces: BTreeMap::new(), steps: BTreeMap::new() });
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

fn migrate_doc(base: &mkp_check::Checker, packs: &[Pack], sources: &[Source], path: &Path, text: &str, from: &BTreeMap<String, u32>, uses: &BTreeMap<String, u32>) -> Outcome {
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
            let edits = step_edits(&current, &doc_path, &refs, &pack.name, step, step_src, &label, &mut o);
            if !o.refused.is_empty() {
                return o;
            }
            o.changes += edits.len();
            o.text = apply(&o.text, edits);
        }
    }
    if o.moved.is_empty() {
        return o;
    }
    // what it says it is written for, now
    o.text = restamp(&o.text, &stamped, packs);
    let c = mkp_check::compile_on(base, &[sources.to_vec()], &[Source { path: doc_path.clone(), text: o.text.clone() }], "doc");
    if c.module.is_none() {
        let lines = Lines::new(&o.text);
        let errs: Vec<String> = c.errors().filter(|d| d.file == doc_path).take(3).map(|d| format!("line {}: {}", lines.place(d.diagnostic.span.start).line, d.diagnostic.message)).collect();
        o.refused.push(format!("it doesn't compile afterwards ({})", if errs.is_empty() { "an error in a pack".to_string() } else { errs.join("; ") }));
    }
    o
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

/// A text edit: what's between `start` and `end` becomes `text`.
#[derive(Debug, Clone)]
struct Edit {
    start: usize,
    end: usize,
    text: String,
}

fn apply(text: &str, mut edits: Vec<Edit>) -> String {
    edits.sort_by_key(|e| (e.start, e.end));
    // an edit inside a deletion goes with it
    let mut kept: Vec<Edit> = Vec::new();
    for e in edits {
        if let Some(last) = kept.last() {
            if e.start < last.end {
                if e.end <= last.end && last.text.is_empty() {
                    continue;
                }
                if last.end <= e.end && e.text.is_empty() && e.start <= last.start {
                    kept.pop();
                }
            }
        }
        kept.push(e);
    }
    let mut out = String::new();
    let mut at = 0;
    for e in kept {
        if e.start < at {
            continue;
        }
        out.push_str(&text[at..e.start]);
        out.push_str(&e.text);
        at = e.end;
    }
    out.push_str(&text[at..]);
    out
}

/// The edits one migration makes to one file, from the references the checker found in it.
#[allow(clippy::too_many_arguments)]
fn step_edits(text: &str, doc: &str, refs: &[FoundRef], pack: &str, step: &ast::MigrationDecl, step_src: &str, label: &str, o: &mut Outcome) -> Vec<Edit> {
    let lines = Lines::new(text);
    let line_of = |s: Span| lines.place(s.start).line;
    let mut edits = Vec::new();
    let replace = |edits: &mut Vec<Edit>, r: &FoundRef, old: &str, new: &str| {
        if &text[r.at.range()] == old {
            edits.push(Edit { start: r.at.start as usize, end: r.at.end as usize, text: new.to_string() });
        }
    };
    for item in step.items.iter() {
        let MigrationItem::Block(b) = item else { continue };
        let key = b.path.iter().map(|i| i.name.as_str()).collect::<Vec<_>>().join(".");
        let full = format!("{}/{}", pack, key);
        let uses: Vec<&FoundRef> = refs.iter().filter(|r| r.decl == full && r.member.is_none()).collect();
        let full_ref = &full;
        let members = |m: &str| refs.iter().filter(|r| r.decl == *full_ref && r.member.as_deref() == Some(m) && !r.case).collect::<Vec<_>>();
        if uses.is_empty() && !refs.iter().any(|r| r.decl == full) {
            continue;
        }
        if b.path.len() > 1 {
            o.refused.push(format!("line {}: fns' migrations aren't applied yet ({} {})", uses.first().map(|r| line_of(r.at)).unwrap_or(1), b.kind.name, key));
            continue;
        }
        for st in b.body.iter() {
            let (op, args) = match st {
                MigrationStmt::Stmt(Stmt::Expr(e)) => match call(e) {
                    Some(c) => c,
                    None => continue,
                },
                MigrationStmt::Event { name, body } => {
                    for s in body.iter() {
                        let MigrationStmt::Stmt(Stmt::Expr(e)) = s else { continue };
                        match call(e) {
                            Some((op, a)) if op == "rename" => {
                                if let Some(to) = arg_name(&a, "to") {
                                    for r in members(&name.name) {
                                        replace(&mut edits, r, &name.name, &to);
                                    }
                                }
                            }
                            Some((op, _)) => {
                                if let Some(r) = members(&name.name).first() {
                                    o.refused.push(format!("line {}: an event's `{}` isn't applied yet: change the handler of {} yourself", line_of(r.at), op, name.name));
                                }
                            }
                            None => {}
                        }
                    }
                    continue;
                }
                MigrationStmt::Execute(_) | MigrationStmt::Stmt(_) => {
                    if let Some(r) = uses.first() {
                        o.refused.push(format!("line {}: `execute` in {}'s migration isn't applied yet", line_of(r.at), key));
                    }
                    continue;
                }
            };
            let why = args.iter().find(|(n, _)| n == "why").map(|(_, v)| text_of(v, step_src)).map(|w| format!(": {}", w)).unwrap_or_default();
            let member = args.iter().find(|(n, _)| matches!(n.as_str(), "input" | "slot" | "field" | "event" | "arg")).and_then(|(_, v)| bare(v));
            match op.as_str() {
                "rename" => {
                    let to = arg_name(&args, "to").unwrap_or_default();
                    if let Some(m) = &member {
                        for r in members(m) {
                            replace(&mut edits, r, m, &to);
                        }
                    } else if let Some(c) = args.iter().find(|(n, _)| n == "from").and_then(|(_, v)| case_of(v)) {
                        let t = args.iter().find(|(n, _)| n == "to").and_then(|(_, v)| case_of(&v.clone())).unwrap_or_default();
                        for r in refs.iter().filter(|r| r.decl == full && r.case && r.member.as_deref() == Some(c.as_str())) {
                            replace(&mut edits, r, &c, &t);
                        }
                    } else {
                        for r in &uses {
                            replace(&mut edits, r, &key, &to);
                        }
                    }
                }
                "drop" => match &member {
                    Some(m) => {
                        for r in members(m) {
                            let whole = &text[r.whole.range()];
                            if whole.contains('\n') || whole.contains("fn(") {
                                o.refused.push(format!("line {}: {} drops {}.{}, and this use gives it code of its own: move it yourself", line_of(r.at), label, key, m));
                                continue;
                            }
                            o.deletions.push(format!("{}:{}  {}{}", doc, line_of(r.at), whole, why));
                            edits.push(deletion(text, r.whole));
                        }
                    }
                    None => {
                        for r in &uses {
                            let whole = &text[r.whole.range()];
                            if whole.starts_with('@') {
                                o.deletions.push(format!("{}:{}  {} (kept as a comment){}", doc, line_of(r.at), first_line(whole), why));
                                edits.push(comment_out(text, r.whole, &format!("{} dropped {}{}", label, key, why)));
                            } else {
                                o.refused.push(format!("line {}: {} drops {}, used here: change it yourself", line_of(r.at), label, key));
                            }
                        }
                    }
                },
                "set" | "add" => {
                    let Some(m) = member else { continue };
                    let Some(value) = args.iter().find(|(n, _)| n == "value").map(|(_, v)| v.clone()) else { continue };
                    let when = args.iter().find(|(n, _)| n == "when").map(|(_, v)| v.clone());
                    for r in &uses {
                        let given = refs.iter().any(|x| x.decl == full && x.member.as_deref() == Some(m.as_str()) && x.at.start >= r.whole.start && x.at.end <= r.whole.end);
                        let holds = match &when {
                            None => Some(!given || op == "set"),
                            Some(w) => decide(w, given),
                        };
                        match holds {
                            Some(false) => {}
                            Some(true) if given && op == "set" => {
                                o.refused.push(format!("line {}: {} sets {}.{} where this use already gives it: change it yourself", line_of(r.at), label, key, m));
                            }
                            Some(true) => match insertion(text, r.whole, &format!("{} = {}", m, &step_src[value.span.range()])) {
                                Some(e) => edits.push(e),
                                None => o.refused.push(format!("line {}: {} gives {}.{} a value, and this use's shape isn't one it can add to yet", line_of(r.at), label, key, m)),
                            },
                            None => o.refused.push(format!("line {}: whether {} sets {}.{} here depends on more than what the use gives: decide it yourself", line_of(r.at), label, key, m)),
                        }
                    }
                }
                "notify" => {
                    let when = args.iter().find(|(n, _)| n == "when").map(|(_, v)| v.clone());
                    for r in &uses {
                        if when.as_ref().map_or(Some(true), |w| decide(w, false)) != Some(false) {
                            o.notices.push(format!("{}:{}  {}, {}{}", doc, line_of(r.at), label, key, why));
                        }
                    }
                }
                "example" => {}
                other => {
                    if let Some(r) = uses.first() {
                        o.refused.push(format!("line {}: `{}` in {}'s migration isn't applied yet", line_of(r.at), other, key));
                    }
                }
            }
        }
    }
    edits
}

/// Whether a `when` holds for a use, from what it gives: `given`, `!`, `&&`, `||`, `true`,
/// `false`, and `confirm`, asked as a yes or no. `None` when it depends on more.
fn decide(e: &Expr, given: bool) -> Option<bool> {
    match &e.kind {
        ExprKind::Bool(b) => Some(*b),
        ExprKind::Paren(x) => decide(x, given),
        ExprKind::Unary { operand, .. } => decide(operand, given).map(|b| !b),
        ExprKind::Binary { op, left, right } => {
            let (l, r) = (decide(left, given), decide(right, given));
            match op {
                ast::BinOp::And => match (l, r) {
                    (Some(false), _) | (_, Some(false)) => Some(false),
                    (Some(true), Some(true)) => Some(true),
                    _ => None,
                },
                ast::BinOp::Or => match (l, r) {
                    (Some(true), _) | (_, Some(true)) => Some(true),
                    (Some(false), Some(false)) => Some(false),
                    _ => None,
                },
                _ => None,
            }
        }
        ExprKind::Call { callee, args } => match &callee.kind {
            ExprKind::Name(n) if n.name == "given" => Some(given),
            ExprKind::Name(n) if n.name == "confirm" => {
                let why = args.iter().find(|a| a.name.as_ref().map_or(false, |n| n.name == "why")).map(|a| format!("{:?}", a.value.kind)).unwrap_or_default();
                Some(confirm(&why))
            }
            _ => None,
        },
        _ => None,
    }
}

/// A yes or no for the whole run: asked once in a terminal, no elsewhere.
fn confirm(question: &str) -> bool {
    use std::sync::Mutex;
    static ANSWERS: Mutex<Vec<(String, bool)>> = Mutex::new(Vec::new());
    let mut answers = ANSWERS.lock().unwrap();
    if let Some((_, a)) = answers.iter().find(|(q, _)| q == question) {
        return *a;
    }
    let a = if std::io::stdin().is_terminal() {
        print!("{} [y/N] ", question.trim_matches('"'));
        let _ = std::io::stdout().flush();
        let mut s = String::new();
        let _ = std::io::stdin().read_line(&mut s);
        matches!(s.trim(), "y" | "Y" | "yes")
    } else {
        false
    };
    answers.push((question.to_string(), a));
    a
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

fn case_of(e: &Expr) -> Option<String> {
    match &e.kind {
        ExprKind::Case { name, .. } => Some(name.name.clone()),
        _ => None,
    }
}

/// A value as the migration writes it: a text's contents for `why`, the source otherwise.
fn text_of(e: &Expr, src: &str) -> String {
    match &e.kind {
        ExprKind::Text(t) => t.parts.iter().map(|p| match p {
            ast::TextPart::Piece { raw, .. } => raw.clone(),
            _ => String::new(),
        }).collect(),
        _ => src[e.span.range()].to_string(),
    }
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("")
}

/// A named argument or a field taken out, with the comma that joins it to its neighbours.
fn deletion(text: &str, whole: Span) -> Edit {
    let (mut start, mut end) = (whole.start as usize, whole.end as usize);
    let after = &text[end..];
    let skip = after.len() - after.trim_start_matches([' ', '\t']).len();
    if after[skip..].starts_with(',') {
        end += skip + 1;
        let more = &text[end..];
        end += more.len() - more.trim_start_matches([' ', '\t']).len();
    } else {
        let before = &text[..start];
        let back = before.trim_end_matches([' ', '\t']);
        if back.ends_with(',') {
            start = back.len() - 1;
        }
    }
    Edit { start, end, text: String::new() }
}

/// A use of a dropped widget, kept as a comment with why.
fn comment_out(text: &str, whole: Span, note: &str) -> Edit {
    let (ws, we) = (whole.start as usize, whole.end as usize);
    let line_start = text[..ws].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let indent = &text[line_start..ws];
    let body = &text[ws..we];
    let mut out = format!("@// {}\n", note);
    for (k, l) in body.lines().enumerate() {
        if k > 0 {
            out.push('\n');
            out.push_str(indent);
        }
        out.push_str("@// ");
        out.push_str(l);
    }
    Edit { start: ws, end: we, text: out }
}

/// `name = value` written into a use: a call's arguments or a record literal's fields.
fn insertion(text: &str, whole: Span, arg: &str) -> Option<Edit> {
    let use_text = &text[whole.range()];
    let ws = whole.start as usize;
    if use_text.starts_with('@') {
        let name_end = use_text[1..].find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).map(|i| i + 1).unwrap_or(use_text.len());
        if use_text[name_end..].starts_with('(') {
            let close = matching(use_text, name_end)?;
            let inner = use_text[name_end + 1..close].trim();
            let at = ws + close;
            let t = if inner.is_empty() { arg.to_string() } else { format!(", {}", arg) };
            return Some(Edit { start: at, end: at, text: t });
        }
        let at = ws + name_end;
        return Some(Edit { start: at, end: at, text: format!("({})", arg) });
    }
    // a record literal: `stat { … }`
    let open = use_text.find('{')?;
    let close = matching(use_text, open)?;
    let inner = use_text[open + 1..close].trim();
    let body = &use_text[open + 1..close];
    let at = ws + open + 1 + body.trim_end().len();
    let t = if inner.is_empty() { format!(" {} ", arg) } else { format!(", {}", arg) };
    Some(Edit { start: at, end: at, text: t })
}

/// The bracket that closes the one at `open`, past texts and nested brackets.
fn matching(s: &str, open: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    let (o, c) = match bytes[open] {
        b'(' => (b'(', b')'),
        b'{' => (b'{', b'}'),
        b'[' => (b'[', b']'),
        _ => return None,
    };
    let mut depth = 0;
    let mut in_text = false;
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
