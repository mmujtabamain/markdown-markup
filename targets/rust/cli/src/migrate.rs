//! `xtmd migrate`: brings documents written for an earlier version of a pack up to the version
//! they are built with, through the pack's migrations (page 6). It edits only the references the
//! checker finds, in place, after a summary, a warning and a y/n, and never writes a file that
//! doesn't compile afterwards.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use xtmd_check::Source;
use xtmd_syntax::ast::{self, DeclKind, Item};
use xtmd_syntax::{parse, Entry, Lines};

pub(crate) const USAGE: &str = "usage: xtmd migrate [<file|folder>…] [--pack a,b] [--config xtmd.toml] [--from kit@1]
                  [--dry-run | --check | --diff | --stdout] [--yes [all | 1,2,…]] [--answers answers.toml]
                  [--allow-dirty] [--allow-todos] [--allow-errors] [--report report.md|report.json]
                  [--out file] [--format json]
  Brings each document, and each pack that uses another, up to the version of each pack it is
  built with, in place. With no file or folder, the current folder; a folder's own xtmd.toml
  says its packs. A document that imports a pack the build doesn't have is refused.
  In a terminal it shows what it will change and asks first; elsewhere it writes only with --yes.
  A migration's questions are numbered. In a terminal they are listed, then asked one by one.
  --yes all answers every one yes; --yes 1,3 (or --yes 1 3) answers those yes and the rest no; a
  bare --yes, with questions open, lists them and writes nothing. --answers keeps answers in a
  file: [confirm] \"Make kit@1's badges small?\" = true, and [split] \"docs/a.xt.md:4 LATE\" = \"DONE\".
  --dry-run      what would change, file by file, each change with the statement's why; writes nothing
  --check        the same, and fails (exit 1) if anything would change: for CI
  --diff         the change as a unified diff on stdout (xtmd.toml's too), the summary on stderr
  --stdout       one document's result on stdout, written nowhere (what it says goes to stderr)
  --yes          writes, without a terminal; --allow-dirty writes files with uncommitted changes too
  --allow-todos  what a migration can't do is left as it was, with a TODO above it, and written
                 (even where that code doesn't compile); a 0.2 pack with no 0.3 release gets a stand-in
  --allow-errors writes a file that doesn't compile afterwards
  --report f     the whole run, as Markdown (f.md) or JSON (f.json)
  --from kit@1   the version the files are written for, where nothing says (xtmd.toml's [uses] does)
  A document written for MKP 0.2 is moved by 0.2.10's own compiler, run with Node (Extended Mark 0.3.0
  only); --pack takes its 0.2 packs (folders with a manifest.mkp) beside the 0.3 ones. Its name
  moves too: MKP named a document name.mkp.md, and Extended Mark names it name.xt.md.
  xtmd.toml's xtmd = \"0.3.x\" says the release the tree is written for (0.3.0 when it says none),
  and [uses] each pack's version; a run that moves the tree writes both.
  --format json prints a JSON line for each file, note and question, then the summary, and asks
  nothing.
  exit: 0 done, or nothing to do; 1 something is left: a file refused or skipped, a question open,
        or (with --check) a file that would change; 2 a usage error, or a file that can't be read
  e.g.  xtmd migrate --dry-run
        xtmd migrate docs --yes
        xtmd migrate docs --yes all --report migration.md";

/// This xtmd's release: what a tree is written for once `xtmd migrate` has moved it.
pub(crate) const RELEASE: &str = env!("CARGO_PKG_VERSION");
/// The release a tree whose xtmd.toml doesn't say is taken to be written for: the first of 0.3.
pub(crate) const FIRST: &str = "0.3.0";

/// `--allow-errors`: a file that doesn't compile afterwards is written all the same.
static ALLOW_ERRORS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A pack in the build: its version, the surfaces of earlier ones, and its migrations.
pub(crate) struct Pack {
    pub(crate) name: String,
    pub(crate) version: u32,
    /// Its own files, without its surfaces.
    pub(crate) files: Vec<Source>,
    pub(crate) surfaces: BTreeMap<u32, Source>,
    pub(crate) steps: BTreeMap<u32, (ast::MigrationDecl, String)>,
    /// Its migration fns, by name.
    pub(crate) fns: BTreeMap<String, ast::MigrationFn>,
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
    /// What `--allow-todos` left for a person, and the errors `--allow-errors` wrote it with.
    todos: Vec<String>,
    /// Each value renamed, set or added, with its statement's why.
    changed: Vec<String>,
    errors: Vec<String>,
    /// The stand-in packs it is checked against, written with it.
    stand_ins: Vec<String>,
}

pub fn migrate_cmd(args: &[String]) -> ExitCode {
    let flag = |f: &str| args.iter().any(|a| a == f);
    let (dry, check, diff, dirty_ok) = (flag("--dry-run"), flag("--check"), flag("--diff"), flag("--allow-dirty"));
    let stdout = flag("--stdout");
    crate::migrate_step::TODO.store(flag("--allow-todos"), std::sync::atomic::Ordering::Relaxed);
    // JSON is for a program: nothing is asked in a terminal
    crate::migrate_step::NO_ASKING.store(args.windows(2).any(|w| w[0] == "--format" && w[1] == "json"), std::sync::atomic::Ordering::Relaxed);
    ALLOW_ERRORS.store(flag("--allow-errors"), std::sync::atomic::Ordering::Relaxed);
    // `--yes`, or `--yes 1,3` / `--yes 1 3`: the questions to answer yes, by number
    let numbers = |v: &str| -> Option<Vec<usize>> { v.split(',').filter(|x| !x.is_empty()).map(|x| x.parse().ok()).collect::<Option<Vec<usize>>>().filter(|n| !n.is_empty()) };
    let mut yes = false;
    let mut yes_all = false;
    let mut yes_to: BTreeSet<usize> = BTreeSet::new();
    let mut from: BTreeMap<String, u32> = BTreeMap::new();
    let mut answers: Option<PathBuf> = None;
    let mut json = false;
    let mut report: Option<String> = None;
    let mut rest = Vec::new();
    let mut k = 0;
    while k < args.len() {
        match args[k].as_str() {
            "--from" => {
                if let Some(r) = args.get(k + 1).filter(|v| release_of(v).is_some()) {
                    eprintln!("error: --from {} names a release, as mkp 0.2's did; since xtmd 0.3.0 it names a pack and the version the files are written for (--from kit@1), and xtmd.toml's xtmd = \"…\" says the release", r);
                    return ExitCode::from(2);
                }
                let Some(v) = args.get(k + 1).and_then(|v| v.split_once('@')).and_then(|(p, n)| Some((p.to_string(), n.parse::<u32>().ok()?))) else {
                    eprintln!("--from takes a pack and the version the files are written for: --from kit@1");
                    return ExitCode::from(2);
                };
                from.insert(v.0, v.1);
                k += 2;
            }
            "--format" => {
                match args.get(k + 1).map(String::as_str) {
                    Some("json") => json = true,
                    Some("text") => json = false,
                    _ => {
                        eprintln!("--format takes json or text");
                        return ExitCode::from(2);
                    }
                }
                k += 2;
            }
            "--report" => {
                let Some(f) = args.get(k + 1).filter(|f| f.ends_with(".md") || f.ends_with(".json")) else {
                    eprintln!("--report takes a file to write the report to: report.md, or report.json");
                    return ExitCode::from(2);
                };
                report = Some(f.clone());
                k += 2;
            }
            "--answers" => {
                let Some(f) = args.get(k + 1) else {
                    eprintln!("--answers takes a file: --answers answers.toml");
                    return ExitCode::from(2);
                };
                // a file not there yet is where a terminal's answers are kept; one that isn't a file can't be
                match std::fs::read_to_string(f) {
                    Ok(text) => {
                        if let Err(e) = crate::migrate_step::load_answers(&text) {
                            eprintln!("{}: {}", f, e);
                            return ExitCode::from(2);
                        }
                    }
                    Err(_) if Path::new(f).exists() => {
                        eprintln!("--answers {}: not a file it can read", f);
                        return ExitCode::from(2);
                    }
                    Err(_) if !std::io::stdin().is_terminal() || flag("--format") => {
                        eprintln!("--answers {}: no such file. It holds answers as [confirm] \"question\" = true and [split] \"file:line CASE\" = \"CASE\"; in a terminal, xtmd migrate writes it with the answers given", f);
                        return ExitCode::from(2);
                    }
                    Err(_) => {}
                }
                answers = Some(PathBuf::from(f));
                k += 2;
            }
            "--yes" => {
                yes = true;
                k += 1;
                if args.get(k).map(String::as_str) == Some("all") {
                    yes_all = true;
                    k += 1;
                }
                while let Some(ns) = args.get(k).and_then(|v| numbers(v)) {
                    yes_to.extend(ns);
                    k += 1;
                }
            }
            a if a.starts_with("--yes=") => {
                let v = &a["--yes=".len()..];
                if v == "all" {
                    yes_all = true;
                } else {
                    let Some(ns) = numbers(v) else {
                        eprintln!("--yes= takes all, or the numbers of the questions to answer yes: --yes=1,3");
                        return ExitCode::from(2);
                    };
                    yes_to.extend(ns);
                }
                yes = true;
                k += 1;
            }
            "--dry-run" | "--check" | "--diff" | "--stdout" | "--allow-dirty" | "--allow-todos" | "--allow-errors" => k += 1,
            _ => {
                rest.push(args[k].clone());
                k += 1;
            }
        }
    }
    // a 0.2 pack (a folder with a manifest.mkp, or a .zip) is the 0.2 step's; the rest are 0.3's
    let (rest, packs02) = split_02_packs(rest);
    // --yes all: every question yes; --yes 1,3: those yes and the rest no; a bare --yes answers none
    if yes_all {
        *crate::migrate_step::YES.lock().unwrap() = Some(crate::migrate_step::Yes::All);
    } else if !yes_to.is_empty() {
        *crate::migrate_step::YES.lock().unwrap() = Some(crate::migrate_step::Yes::Numbers(yes_to));
    }
    let bare_yes = yes && !yes_all && crate::migrate_step::YES.lock().unwrap().is_none();
    let (targets, mut sources, _) = match crate::options(&rest) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let targets = if targets.is_empty() { vec![".".to_string()] } else { targets };
    if stdout && (json || targets.len() != 1 || !is_doc(&targets[0])) {
        eprintln!("--stdout prints one document's result: name one .xt.md file{}", if json { ", and leave out --format json" } else { "" });
        return ExitCode::from(2);
    }
    let mut docs: Vec<PathBuf> = Vec::new();
    for t in &targets {
        let p = Path::new(t);
        if p.is_dir() {
            find_docs(p, &mut docs);
        } else if is_doc(t) {
            docs.push(p.to_path_buf());
        } else {
            if t.ends_with("xtmd.toml") {
                eprintln!("{}: xtmd migrate moves an xtmd.toml with the tree it is in: name that folder (xtmd migrate {})", t, Path::new(t).parent().filter(|d| !d.as_os_str().is_empty()).map_or(".".to_string(), |d| d.display().to_string()));
            } else {
                eprintln!("{}: not a document (.xt.md) or a folder", t);
            }
            return ExitCode::from(2);
        }
    }
    let (uses, config) = uses_in_config(rest.iter().position(|a| a == "--config").and_then(|i| rest.get(i + 1)).map(String::as_str), targets.first().map(String::as_str));
    // the release of xtmd the tree is written for: xtmd.toml's `xtmd = "0.3.x"`
    let written_release = config.as_ref().and_then(|c| release_in_config(c));
    if let (Some(cfg), Some(r)) = (&config, &written_release) {
        match release_of(r) {
            None => {
                eprintln!("{}: xtmd = \"{}\" isn't a release of xtmd, such as \"{}\"", shown(cfg), r, RELEASE);
                return ExitCode::from(2);
            }
            Some(v) if v > release_of(RELEASE).unwrap_or_default() => {
                eprintln!("{}: xtmd = \"{}\" says the tree is written for xtmd {}, which is newer than this xtmd ({}): update xtmd, or, if the line is wrong, set it to the release the tree is written for", shown(cfg), r, r, RELEASE);
                return ExitCode::from(2);
            }
            _ => {}
        }
    }
    let record_moves = config.is_some() && written_release.as_deref() != Some(RELEASE);
    // the steps of each release after the one the tree is written for, before anything else
    let from_release = written_release.clone().unwrap_or_else(|| FIRST.to_string());
    let release_steps = crate::releases::between(&from_release, RELEASE, crate::releases::STEPS);
    let release_label = format!("xtmd {} → {}", from_release, RELEASE);
    let mut stepped: BTreeMap<String, (String, Vec<String>)> = BTreeMap::new();
    let mut step_refused: BTreeMap<String, (String, String)> = BTreeMap::new();
    for s in sources.iter_mut() {
        match crate::releases::run(&s.text, &s.path, &release_steps) {
            Ok((text, said)) if !said.is_empty() => {
                stepped.insert(s.path.clone(), (std::mem::replace(&mut s.text, text), said));
            }
            Ok(_) => {}
            Err(e) => {
                step_refused.insert(s.path.clone(), (s.text.clone(), e));
            }
        }
    }
    let packs = packs_of(&sources);
    let core = crate::core_sources();
    let base = xtmd_check::compile_core(&core);

    // the plan: a pass over every file; when it meets questions no one has answered, they are asked
    // in a terminal and the files planned again with the answers, and elsewhere the run stops
    // stand-ins for the 0.2 packs that have no 0.3 release here, beside the documents
    let stand_in_dir = targets.first().map(|t| if Path::new(t).is_dir() { PathBuf::from(t) } else { Path::new(t).parent().map(Path::to_path_buf).unwrap_or_default() }).unwrap_or_default().join("stand-ins");
    let mut asked_here = false;
    let (results, stand_ins) = loop {
        crate::migrate_step::new_pass();
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
        // a pack's file the release steps changed: compared with what is on disk, and written with what
        // they say; one they can't move is refused
        for (path, old, o) in results.iter_mut() {
            if let Some((disk, said)) = stepped.get(&path.display().to_string()) {
                *old = disk.clone();
                o.moved.insert(0, release_label.clone());
                o.changes += said.len();
                o.notices.extend(said.iter().cloned());
            }
        }
        for (path, (disk, said)) in &stepped {
            if !results.iter().any(|(p, _, _)| p.display().to_string() == *path) {
                let text = sources.iter().find(|s| s.path == *path).map(|s| s.text.clone()).unwrap_or_default();
                results.push((PathBuf::from(path), disk.clone(), Outcome { text, moved: vec![release_label.clone()], changes: said.len(), notices: said.clone(), ..Outcome::default() }));
            }
        }
        for (path, (disk, why)) in &step_refused {
            results.push((PathBuf::from(path), disk.clone(), Outcome { text: disk.clone(), moved: vec![release_label.clone()], refused: vec![why.clone()], ..Outcome::default() }));
        }
        let mut stand_ins: BTreeMap<String, (PathBuf, String)> = BTreeMap::new();
        for d in &docs {
            let Ok(text) = std::fs::read_to_string(d) else {
                eprintln!("{}: can't be read", d.display());
                return ExitCode::from(2);
            };
            let o = match migrate_02_doc(&base, &packs, &sources, &now, d, &text, &packs02, &mut stand_ins, &stand_in_dir, &uses) {
                Some(o) => o,
                None => doc_through_releases(&base, &packs, &sources, &now, d, &text, &from, &uses, &release_steps, &release_label),
            };
            results.push((d.clone(), text, o));
        }
        let waiting = crate::migrate_step::pending();
        if waiting.is_empty() {
            break (results, stand_ins);
        }
        if crate::migrate_step::can_ask() && !json && !stdout && !asked_here && !bare_yes {
            asked_here = true;
            if crate::migrate_step::ask_in_terminal(&waiting) {
                continue;
            }
            crate::out::text("Nothing written: not every question was answered.");
            return ExitCode::from(1);
        }
        // nobody to ask: nothing is planned or written until each is answered
        if json {
            for (n, q) in &waiting {
                crate::out::line(serde_json::json!({ "type": "question", "question": n, "asks": q.asks, "options": q.options, "answer": null, "how": crate::migrate_step::how_to_answer(*n, q) }));
            }
            crate::out::line(serde_json::json!({ "type": "summary", "files": results.len(), "unanswered": waiting.len(), "exit": 1 }));
        } else {
            let say = |l: String| if stdout { eprintln!("{}", l) } else { crate::out::text(&l) };
            say(format!("{} question{} no one has answered, so nothing is migrated:", waiting.len(), if waiting.len() == 1 { "" } else { "s" }));
            for (n, q) in &waiting {
                say(format!("  {}. {}{}", n, q.asks, if q.options.is_empty() { String::new() } else { format!(" ({})", q.options.join(" or ")) }));
                say(format!("     {}", crate::migrate_step::how_to_answer(*n, q)));
            }
            say(if bare_yes { "A bare --yes answers none of them: --yes all answers every one yes, --yes 1,3 those yes and the rest no." } else { "Run it in a terminal to be asked, or answer each as it says; --yes all answers every one yes." }.to_string());
        }
        return ExitCode::from(1);
    };

    // what was answered in a terminal, kept for the next run
    if let (Some(f), Some(text)) = (&answers, crate::migrate_step::answers_text()) {
        if let Err(e) = std::fs::write(f, text) {
            eprintln!("{}: {}", f.display(), e);
        }
    }
    // the summary: as text, or with --format json one JSON object per file and per note
    let human = !json;
    // with --stdout and --diff, stdout is the document or the patch: what it says goes to stderr
    macro_rules! say {
        ($($t:tt)*) => {
            if human && (stdout || diff) {
                eprintln!($($t)*);
            } else if human {
                crate::out::text(&format!($($t)*));
            }
        };
    }
    let width = results.iter().map(|(p, _, _)| p.display().to_string().len()).max().unwrap_or(0);
    let (mut to_write, mut need, mut fine) = (Vec::new(), 0, 0);
    for (p, old, o) in &results {
        let name = format!("{:width$}", p.display(), width = width);
        if !o.refused.is_empty() {
            need += 1;
            say!("{}  {}  not written: {}", name, o.moved.join(", "), o.refused.join("; "));
        } else if o.text == *old && written_as(p) == *p {
            fine += 1;
            say!("{}  up to date", name);
        } else {
            // a 0.2 document whose text reads the same in 0.3 only moves to its new name
            let mut parts = if o.text == *old { Vec::new() } else { vec![format!("{} change{}", o.changes, if o.changes == 1 { "" } else { "s" })] };
            if !o.deletions.is_empty() {
                parts.push(format!("{} deletion{}", o.deletions.len(), if o.deletions.len() == 1 { "" } else { "s" }));
            }
            if !o.notices.is_empty() {
                parts.push(format!("{} to know", o.notices.len()));
            }
            if !o.todos.is_empty() {
                parts.push(format!("{} TODO{}", o.todos.len(), if o.todos.len() == 1 { "" } else { "s" }));
            }
            if !o.stand_ins.is_empty() {
                parts.push(format!("{} stand-in{}", o.stand_ins.len(), if o.stand_ins.len() == 1 { "" } else { "s" }));
            }
            if !o.errors.is_empty() {
                parts.push("doesn't compile".to_string());
            }
            if written_as(p) != *p {
                parts.push(format!("renamed {}", written_as(p).file_name().map_or(String::new(), |n| n.to_string_lossy().into_owned())));
            }
            say!("{}  {}  {}{}", name, o.moved.join(", "), parts.join("; "), if o.inferred.is_empty() { String::new() } else { format!(" ({})", o.inferred.join(", ")) });
            to_write.push((p.clone(), old.clone(), o));
        }
    }
    // what xtmd.toml says once the tree moves: each pack it now uses, and this release
    let uses_to: BTreeMap<String, u32> = packs.iter().filter(|p| uses.get(&p.name).map_or(false, |v| *v < p.version)).map(|p| (p.name.clone(), p.version)).collect();
    let config_after = config.as_ref().and_then(|cfg| {
        let old = std::fs::read_to_string(cfg).ok()?;
        let mut new = if uses_to.is_empty() { old.clone() } else { with_uses(&old, &uses_to) };
        if record_moves {
            new = with_release(&new, RELEASE);
        }
        Some((old, new))
    });
    if let Some(cfg) = &config {
        let uses_line = if uses_to.is_empty() { String::new() } else { format!(", and [uses] {}", uses_to.iter().map(|(p, v)| format!("{} = {}", p, v)).collect::<Vec<_>>().join(", ")) };
        match &written_release {
            Some(r) if r == RELEASE && uses_to.is_empty() => say!("{}: written for xtmd {}.", shown(cfg), r),
            Some(r) if r == RELEASE => say!("{}: written for xtmd {}; migrating writes{}.", shown(cfg), r, &uses_line[5..]),
            Some(r) => say!("{}: written for xtmd {}; migrating writes xtmd = \"{}\" into it{}.", shown(cfg), r, RELEASE, uses_line),
            None => say!("{}: has no `xtmd =` line, so the tree is taken as written for xtmd {}; migrating writes xtmd = \"{}\" into it{}.", shown(cfg), FIRST, RELEASE, uses_line),
        }
    }
    let with_todos = to_write.iter().filter(|(_, _, o)| !o.todos.is_empty() || !o.stand_ins.is_empty()).count();
    say!(
        "{} file{}: {} to migrate{}, {} need{} a person, {} up to date.",
        results.len(),
        if results.len() == 1 { "" } else { "s" },
        to_write.len(),
        if with_todos > 0 { format!(" ({} with TODOs for a person)", with_todos) } else { String::new() },
        need,
        if need == 1 { "s" } else { "" },
        fine
    );
    let changed: Vec<&String> = to_write.iter().flat_map(|(_, _, o)| o.changed.iter()).collect();
    if !changed.is_empty() {
        say!("\nchanged, each by a statement of the migration (with its why):");
        for c in changed {
            say!("  {}", c);
        }
    }
    let notices: Vec<&String> = to_write.iter().flat_map(|(_, _, o)| o.notices.iter()).collect();
    if !notices.is_empty() {
        say!("\nto know:");
        for n in notices {
            say!("  {}", n);
        }
    }
    let asked = crate::migrate_step::ASKED.lock().unwrap().clone();
    if !asked.is_empty() {
        say!("\nquestions:");
        for (n, q, a, by) in asked.iter() {
            let answer = match (*a, *by) {
                (true, "--yes") => format!("yes: --yes {}", if yes_all { "all".to_string() } else { n.to_string() }),
                (false, "--yes") => "no: --yes names other questions".to_string(),
                (a, by) => format!("{}: {}", if a { "yes" } else { "no" }, by),
            };
            say!("  {}. {}  {}", n, q, answer);
        }
    }
    let todos: Vec<String> = to_write.iter().flat_map(|(p, _, o)| o.todos.iter().map(move |t| format!("{}: {}", p.display(), t))).collect();
    if !todos.is_empty() {
        say!("\nleft for a person, each with a TODO above it:");
        for t in &todos {
            say!("  {}", t);
        }
    }
    let mut needed: Vec<&String> = to_write.iter().flat_map(|(_, _, o)| o.stand_ins.iter()).collect();
    needed.sort();
    needed.dedup();
    if !needed.is_empty() {
        say!("\nstand-ins, each with a TODO at its top, until the pack's own 0.3 release replaces it:");
        for name in needed {
            say!("  {}: {}", stand_ins[name].0.display(), name);
        }
    }
    let errors: Vec<String> = to_write.iter().flat_map(|(p, _, o)| o.errors.iter().map(move |e| format!("{}: {}", p.display(), e))).collect();
    if !errors.is_empty() {
        say!("\nwritten though it doesn't compile:");
        for e in &errors {
            say!("  {}", e);
        }
    }
    let deletions: Vec<&String> = to_write.iter().flat_map(|(_, _, o)| o.deletions.iter()).collect();
    if !deletions.is_empty() {
        say!("\nwarning: the newer versions drop what these files give:");
        for d in deletions {
            say!("  {}", d);
        }
    }
    if diff && human {
        // what would change, refused files too, so a person can see what's left; xtmd.toml's too
        for (p, old, o) in &results {
            if o.text != *old {
                crate::out::print(&unified(&p.display().to_string(), old, &o.text));
            }
        }
        if let (Some(cfg), Some((old, new))) = (&config, &config_after) {
            if old != new && need == 0 {
                crate::out::print(&unified(&shown(cfg), old, new));
            }
        }
    }
    let terminal = std::io::stdin().is_terminal() && human;
    let mut wrote: Vec<PathBuf> = Vec::new();
    let mut skipped: Vec<PathBuf> = Vec::new();
    let mut moved_record = false;
    // git: what can be undone, and what has edits of its own that a run would mix with
    let to_paths: Vec<&Path> = to_write.iter().map(|(p, _, _)| p.as_path()).collect();
    let dirty = if stdout { None } else { git_dirty(if to_paths.is_empty() { config.as_slice().iter().map(PathBuf::as_path).collect::<Vec<_>>() } else { to_paths.clone() }.as_slice()) };
    let dirty_files: Vec<String> = dirty.iter().flatten().filter(|p| to_paths.contains(&p.as_path())).map(|p| p.display().to_string()).collect();
    let dirty_note = if dirty_files.is_empty() || dirty_ok {
        String::new()
    } else {
        format!("{} {} uncommitted changes, which a run without a terminal skips unless --allow-dirty is given too", dirty_files.join(", "), if dirty_files.len() == 1 { "has" } else { "have" })
    };
    let code = 'run: {
        // --stdout: the one document's result, written nowhere
        if stdout {
            let Some((_, _, o)) = results.iter().find(|(p, _, _)| is_doc(&p.display().to_string())) else { break 'run ExitCode::from(2) };
            if !o.refused.is_empty() {
                break 'run ExitCode::from(1);
            }
            crate::out::print(&o.text);
            break 'run if need > 0 { ExitCode::from(1) } else { ExitCode::SUCCESS };
        }
        // nothing to write: no file moves, and the release xtmd.toml says moves only with every file
        if to_write.is_empty() && (!record_moves || need > 0) {
            break 'run if need > 0 { ExitCode::from(1) } else { ExitCode::SUCCESS };
        }
        if check || dry || diff {
            if !dirty_note.is_empty() {
                say!("\ngit: {}.", dirty_note);
            }
            break 'run if check || need > 0 { ExitCode::from(1) } else { ExitCode::SUCCESS };
        }
        match &dirty {
            None => say!("\nnot in git: nothing can undo these changes; keep a copy first."),
            Some(d) if d.is_empty() => say!("\ngit: these files are in a git repository, and every change can be undone with git restore."),
            Some(d) => say!("\ngit: these files are in a git repository; {} {} uncommitted changes of {} own, which the migration's would mix with.", d.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "), if d.len() == 1 { "has" } else { "have" }, if d.len() == 1 { "its" } else { "their" }),
        }
        let toml_lines = match (record_moves, uses_to.is_empty()) {
            (true, true) => "its `xtmd =` line",
            (true, false) => "its `xtmd =` line and [uses]",
            (false, false) => "its [uses]",
            (false, true) => "",
        };
        if to_write.is_empty() {
            say!("warning: this rewrites xtmd.toml's `xtmd =` line.");
        } else if toml_lines.is_empty() {
            say!("warning: this rewrites {} file{} in place.", to_write.len(), if to_write.len() == 1 { "" } else { "s" });
        } else {
            say!("warning: this rewrites {} file{} in place, and xtmd.toml's {}.", to_write.len(), if to_write.len() == 1 { "" } else { "s" }, &toml_lines[4..]);
        }
        if terminal && !yes {
            print!("Continue? [y/N] ");
            let _ = std::io::stdout().flush();
            let mut answer = String::new();
            let _ = std::io::stdin().read_line(&mut answer);
            if !matches!(answer.trim(), "y" | "Y" | "yes") {
                say!("Nothing written.");
                break 'run ExitCode::from(1);
            }
        } else if !yes {
            say!(
                "Nothing written: without a terminal to ask in, xtmd migrate writes only with --yes{}. --dry-run shows what it would do.",
                if dirty_note.is_empty() { String::new() } else { format!(" (and --allow-dirty, as {} {} uncommitted changes)", dirty_files.join(", "), if dirty_files.len() == 1 { "has" } else { "have" }) }
            );
            break 'run ExitCode::from(1);
        }
        for (p, _, o) in &to_write {
            if !terminal && !dirty_ok && dirty.as_ref().map_or(false, |d| d.iter().any(|x| x == p)) {
                say!("{}: skipped: it has uncommitted changes (--allow-dirty writes it)", p.display());
                skipped.push(p.clone());
                continue;
            }
            let dest = written_as(p);
            if dest != *p && dest.exists() {
                say!("{}: skipped: {} is there already, so its 0.2 name can't move to it", p.display(), dest.display());
                skipped.push(p.clone());
                continue;
            }
            if let Err(e) = std::fs::write(&dest, &o.text).and_then(|_| if dest != *p { std::fs::remove_file(p) } else { Ok(()) }) {
                eprintln!("{}: {}", p.display(), e);
                return ExitCode::from(2);
            }
            wrote.push(p.clone());
            for name in &o.stand_ins {
                let (file, text) = &stand_ins[name];
                if std::fs::read_to_string(file).ok().as_deref() == Some(text.as_str()) {
                    continue;
                }
                let made = std::fs::create_dir_all(file.parent().unwrap_or(Path::new("."))).and_then(|_| std::fs::write(file, text));
                if let Err(e) = made {
                    eprintln!("{}: {}", file.display(), e);
                    return ExitCode::from(2);
                }
                say!("{}: a stand-in for {}, written from its 0.2 definitions.", file.display(), name);
            }
        }
        if to_write.iter().any(|(_, _, o)| !o.stand_ins.is_empty()) {
            say!("The documents are checked against the stand-ins with: xtmd check --pack {} …", stand_in_dir.display());
        }
        if !to_write.is_empty() {
            say!("Wrote {} file{}.", wrote.len(), if wrote.len() == 1 { "" } else { "s" });
        }
        // the tree is written for the newer versions once every file in it moved
        if let Some(cfg) = config.as_ref().filter(|_| need == 0 && wrote.len() == to_write.len()) {
            let to = &uses_to;
            if !to.is_empty() {
                if let Err(e) = bump_config(cfg, to) {
                    eprintln!("{}: {}", cfg.display(), e);
                    return ExitCode::from(2);
                }
                say!("{}: now written for {}.", shown(cfg), to.iter().map(|(p, v)| format!("{}@{}", p, v)).collect::<Vec<_>>().join(", "));
            }
            if record_moves {
                if let Err(e) = set_release(cfg, RELEASE) {
                    eprintln!("{}: {}", cfg.display(), e);
                    return ExitCode::from(2);
                }
                moved_record = true;
                say!("{}: now written for xtmd {}.", shown(cfg), RELEASE);
            }
        }
        // what --allow-todos and --allow-errors let through is written, and said, not a failure
        let (todos_left, stand_ins_left, errors_left) = to_write.iter().filter(|(p, _, _)| wrote.contains(p)).fold((0, 0, 0), |(t, s, e), (_, _, o)| (t + o.todos.len(), s + o.stand_ins.len(), e + usize::from(!o.errors.is_empty())));
        if todos_left + stand_ins_left + errors_left > 0 {
            let mut parts = Vec::new();
            if todos_left > 0 {
                parts.push(format!("{} TODO{}", todos_left, if todos_left == 1 { "" } else { "s" }));
            }
            if stand_ins_left > 0 {
                parts.push(format!("{} stand-in{}", stand_ins_left, if stand_ins_left == 1 { "" } else { "s" }));
            }
            if errors_left > 0 {
                parts.push(format!("{} file{} that {} compile", errors_left, if errors_left == 1 { "" } else { "s" }, if errors_left == 1 { "doesn't" } else { "don't" }));
            }
            say!("Left for a person, as asked: {} (listed above); xtmd check shows what still doesn't compile.", parts.join(", "));
        }
        if need > 0 || wrote.len() < to_write.len() {
            ExitCode::from(1)
        } else {
            ExitCode::SUCCESS
        }
    };
    // what happened, for CI and tools: JSON lines, and the report
    if json || report.is_some() {
        let r = Report { results: &results, asked: &asked, wrote: &wrote, skipped: &skipped, from: &from_release, record: config.as_ref().map(|c| (c.as_path(), written_release.as_deref(), record_moves, moved_record, &uses_to)), diff, code: if code == ExitCode::SUCCESS { 0 } else { 1 } };
        if json {
            for line in r.lines() {
                crate::out::text(&line);
            }
        }
        if let Some(f) = &report {
            let text = if f.ends_with(".json") { serde_json::to_string_pretty(&r.whole()).unwrap() + "\n" } else { r.markdown() };
            if let Err(e) = std::fs::write(f, text) {
                eprintln!("{}: {}", f, e);
                return ExitCode::from(2);
            }
        }
    }
    code
}

/// What a run did, file by file: `--format json`'s lines and `--report`'s file.
struct Report<'a> {
    results: &'a [(PathBuf, String, Outcome)],
    asked: &'a [(usize, String, bool, &'static str)],
    wrote: &'a [PathBuf],
    skipped: &'a [PathBuf],
    from: &'a str,
    /// The xtmd.toml: the release it says, whether a run that writes records this one, whether this
    /// run did, and the packs its [uses] moves to.
    record: Option<(&'a Path, Option<&'a str>, bool, bool, &'a BTreeMap<String, u32>)>,
    diff: bool,
    code: u8,
}

impl Report<'_> {
    /// What became of a file: up to date, migrated, to migrate (not written by this run), not
    /// written (refused) or skipped (it has edits of its own).
    fn result(&self, p: &PathBuf, old: &str, o: &Outcome) -> &'static str {
        if !o.refused.is_empty() {
            "not written"
        } else if o.text == old && written_as(p) == *p {
            "up to date"
        } else if self.wrote.contains(p) {
            "migrated"
        } else if self.skipped.contains(p) {
            "skipped"
        } else {
            "to migrate"
        }
    }

    fn file(&self, p: &PathBuf, old: &str, o: &Outcome, notes: bool) -> serde_json::Value {
        let mut v = serde_json::json!({
            "file": p.display().to_string(),
            "kind": if is_doc(&p.display().to_string()) { "document" } else { "pack" },
            "result": self.result(p, old, o),
            "moved": o.moved,
            "changes": o.changes,
        });
        // a 0.2 name, and the one it is written as
        if written_as(p) != *p {
            v["written_as"] = serde_json::json!(written_as(p).display().to_string());
        }
        if notes {
            for (k, xs) in [("inferred", &o.inferred), ("changed", &o.changed), ("deletions", &o.deletions), ("to_know", &o.notices), ("todos", &o.todos), ("errors", &o.errors), ("refused", &o.refused), ("stand_ins", &o.stand_ins)] {
                v[k] = serde_json::json!(xs);
            }
        }
        if self.diff && o.text != old {
            v["diff"] = serde_json::json!(unified(&p.display().to_string(), old, &o.text));
        }
        v
    }

    fn questions(&self) -> Vec<serde_json::Value> {
        self.asked.iter().map(|(n, q, a, by)| serde_json::json!({ "question": n, "asks": q, "answer": a, "by": by })).collect()
    }

    fn summary(&self) -> serde_json::Value {
        let count = |r: &str| self.results.iter().filter(|(p, old, o)| self.result(p, old, o) == r).count();
        let mut v = serde_json::json!({
            "files": self.results.len(),
            "migrated": count("migrated"),
            "to_migrate": count("to migrate"),
            "not_written": count("not written"),
            "skipped": count("skipped"),
            "up_to_date": count("up to date"),
            "release": { "from": self.from, "to": RELEASE },
            "exit": self.code,
        });
        if let Some((cfg, says, records, recorded, uses)) = self.record {
            v["xtmd_toml"] = serde_json::json!({ "file": shown(cfg), "says": says, "records": if records { Some(RELEASE) } else { None }, "recorded": recorded, "uses": uses });
        }
        v
    }

    /// `--format json`: a line for each file, one for each of its notes, one for each question,
    /// then the summary.
    fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (p, old, o) in self.results {
            let mut f = self.file(p, old, o, false);
            f["type"] = "file".into();
            out.push(f.to_string());
            for (kind, xs) in [("inferred", &o.inferred), ("changed", &o.changed), ("deletion", &o.deletions), ("to_know", &o.notices), ("todo", &o.todos), ("stand_in", &o.stand_ins), ("error", &o.errors), ("refused", &o.refused)] {
                for x in xs {
                    out.push(serde_json::json!({ "type": "note", "file": p.display().to_string(), "kind": kind, "text": x }).to_string());
                }
            }
        }
        for mut q in self.questions() {
            q["type"] = "question".into();
            out.push(q.to_string());
        }
        let mut s = self.summary();
        s["type"] = "summary".into();
        out.push(s.to_string());
        out
    }

    /// `--report f.json`: the run as one JSON document.
    fn whole(&self) -> serde_json::Value {
        serde_json::json!({
            "xtmd": RELEASE,
            "files": self.results.iter().map(|(p, old, o)| self.file(p, old, o, true)).collect::<Vec<_>>(),
            "questions": self.questions(),
            "summary": self.summary(),
        })
    }

    /// `--report f.md`: the run for a person to read, file by file.
    fn markdown(&self) -> String {
        let s = self.summary();
        let mut out = format!(
            "# xtmd migrate\n\nxtmd {}, from xtmd {}: {} file{}, {} migrated, {} to migrate, {} not written, {} skipped, {} up to date.\n",
            RELEASE, self.from, s["files"], if self.results.len() == 1 { "" } else { "s" }, s["migrated"], s["to_migrate"], s["not_written"], s["skipped"], s["up_to_date"]
        );
        for (p, old, o) in self.results {
            out.push_str(&format!("\n## {}\n\n{}{}.\n", p.display(), self.result(p, old, o), if o.moved.is_empty() { String::new() } else { format!(": {}", o.moved.join(", ")) }));
            for (title, xs) in [("Inferred", &o.inferred), ("Refused", &o.refused), ("Changed", &o.changed), ("Deleted", &o.deletions), ("To know", &o.notices), ("TODO", &o.todos), ("Stand-ins", &o.stand_ins), ("Errors", &o.errors)] {
                if !xs.is_empty() {
                    out.push_str(&format!("\n{}:\n\n", title));
                    for x in xs {
                        out.push_str(&format!("- {}\n", x));
                    }
                }
            }
        }
        if !self.asked.is_empty() {
            out.push_str("\n## Questions\n\n");
            for (n, q, a, by) in self.asked.iter() {
                out.push_str(&format!("{}. {} {} ({})\n", n, q, if *a { "Yes" } else { "No" }, by));
            }
        }
        out
    }
}

/// A document: `.xt.md`, or `.mkp.md` as 0.2 named it.
pub(crate) fn is_doc(p: &str) -> bool {
    p.ends_with(".xt.md") || p.ends_with(".mkp.md")
}

/// Where a document is written: a 0.2 name, `name.mkp.md`, moves to `name.xt.md`.
pub(crate) fn written_as(p: &Path) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_suffix(".mkp.md")) {
        Some(stem) => PathBuf::from(format!("{}.xt.md", stem)),
        None => p.to_path_buf(),
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
        } else if is_doc(name) {
            out.push(p);
        }
    }
}

/// The build's packs, by their package lines: each one's version, surfaces and migrations.
pub(crate) fn packs_of(sources: &[Source]) -> Vec<Pack> {
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

/// `[uses]` in the xtmd.toml: the version of each pack its tree is written for.
fn uses_in_config(named: Option<&str>, target: Option<&str>) -> (BTreeMap<String, u32>, Option<PathBuf>) {
    let path = match named {
        Some(p) => Some(PathBuf::from(p)),
        None => crate::find_config(target),
    };
    let Some(text) = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()) else { return (BTreeMap::new(), path) };
    let Ok(v) = text.parse::<toml::Value>() else { return (BTreeMap::new(), path) };
    (v.get("uses").and_then(|u| u.as_table()).map(|t| t.iter().filter_map(|(k, v)| Some((k.clone(), v.as_integer()? as u32))).collect()).unwrap_or_default(), path)
}

/// A release, `0.3.1`, as numbers to compare.
pub(crate) fn release_of(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.trim().split('.').map(|x| x.parse::<u32>().ok());
    let r = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(r)
}

/// xtmd.toml's `xtmd = "0.3.x"`: the release of xtmd the tree is written for.
fn release_in_config(path: &Path) -> Option<String> {
    let v: toml::Value = std::fs::read_to_string(path).ok()?.parse().ok()?;
    v.get("xtmd").and_then(|m| m.as_str()).map(str::to_string)
}

/// xtmd.toml's `xtmd = "…"` set to a release: in place, or as its first line.
fn set_release(path: &Path, to: &str) -> std::io::Result<()> {
    let text = std::fs::read_to_string(path)?;
    std::fs::write(path, with_release(&text, to))
}

/// An xtmd.toml's text with its `xtmd = "…"` set to a release.
fn with_release(text: &str, to: &str) -> String {
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

/// The xtmd.toml's `[uses]`, each pack at the version its files are now written for.
fn bump_config(path: &Path, to: &BTreeMap<String, u32>) -> std::io::Result<()> {
    let text = std::fs::read_to_string(path)?;
    std::fs::write(path, with_uses(&text, to))
}

/// An xtmd.toml's text with each pack under `[uses]` at its new version.
fn with_uses(text: &str, to: &BTreeMap<String, u32>) -> String {
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
fn stamp(text: &str) -> BTreeMap<String, u32> {
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

/// The `--pack` folders and files that are 0.2 packs, taken out of the arguments the 0.3 build reads.
fn split_02_packs(args: Vec<String>) -> (Vec<String>, Vec<PathBuf>) {
    let (mut rest, mut old) = (Vec::new(), Vec::new());
    let mut k = 0;
    while k < args.len() {
        let list = match args[k].as_str() {
            "--pack" if k + 1 < args.len() => {
                k += 1;
                Some(args[k].clone())
            }
            a if a.starts_with("--pack=") => Some(a["--pack=".len()..].to_string()),
            _ => None,
        };
        match list {
            Some(list) => {
                let (o2, o3): (Vec<&str>, Vec<&str>) = list.split(',').filter(|x| !x.is_empty()).partition(|x| crate::migrate_02::is_pack(Path::new(x)));
                old.extend(o2.into_iter().map(PathBuf::from));
                if !o3.is_empty() {
                    rest.push("--pack".to_string());
                    rest.push(o3.join(","));
                }
            }
            None => rest.push(args[k].clone()),
        }
        k += 1;
    }
    (rest, old)
}

/// A 0.3 document: through the steps of the releases after the one it is written for, then up to the
/// versions of the packs it uses.
#[allow(clippy::too_many_arguments)]
fn doc_through_releases(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], now: &[Source], path: &Path, text: &str, from: &BTreeMap<String, u32>, uses: &BTreeMap<String, u32>, steps: &[&crate::releases::ReleaseStep], label: &str) -> Outcome {
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
fn migrate_02_doc(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], now: &[Source], path: &Path, text: &str, packs02: &[PathBuf], stand_ins: &mut BTreeMap<String, (PathBuf, String)>, stand_in_dir: &Path, uses: &BTreeMap<String, u32>) -> Option<Outcome> {
    // compiled as what it becomes: a 0.2 name is checked as the document it is written as
    let doc_path = written_as(path).display().to_string();
    let compiles = |world: &[Source], text: &str| xtmd_check::compile_on(base, &[world.to_vec()], &[Source { path: doc_path.clone(), text: text.to_string() }], "doc");
    let stamped = crate::migrate_02::stamped(text);
    // 0.3's: a `@@@` line, or 0.3 in its prose; Markdown alone reads the same in both
    if !stamped && (text.lines().any(|l| l.trim_end() == "@@@") || crate::migrate_02::speaks_03(text)) {
        return None;
    }
    let mut o = Outcome { text: text.to_string(), moved: vec!["mkp 0.2 → 0.3".to_string()], ..Outcome::default() };
    let m = match crate::migrate_02::run(path, packs02) {
        Ok(m) => m,
        Err(crate::migrate_02::Failed::NotBuilt(e)) if stamped => {
            o.refused.push(if packs02.is_empty() && e.contains("unknown-widget") {
                format!("{}. The 0.2 step builds the page with the 0.2 packs it was written with: pass each with --pack (a 0.2 pack is a folder with a manifest.mkp), beside the 0.3 ones", e)
            } else {
                e
            });
            return Some(o);
        }
        // the step couldn't run, so it can't say: a file that only 0.2 would write is refused
        Err(crate::migrate_02::Failed::NotRun(e)) if stamped || crate::migrate_02::looks_02(text).is_some() => {
            if !stamped {
                o.inferred.push(format!("taken as MKP 0.2's: it has {}", crate::migrate_02::looks_02(text).unwrap_or("0.2's marks")));
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
            from.insert(name.clone(), crate::migrate_02::version_of(shim).unwrap_or(1));
            continue;
        }
        let entry = stand_ins.entry(name.clone()).or_insert_with(|| (stand_in_dir.join(name).join(format!("{}.xtpack", name)), String::new()));
        entry.1 = if entry.1.is_empty() { crate::migrate_02::marked(shim, name) } else { crate::migrate_02::merge(&entry.1, shim) };
        o.stand_ins.push(name.clone());
        world.push(Source { path: entry.0.display().to_string(), text: entry.1.clone() });
    }
    if !o.stand_ins.is_empty() {
        let names: Vec<String> = o.stand_ins.iter().map(|n| format!("{} ({})", n, stand_ins[n].0.display())).collect();
        o.text = o.text.replacen("// Nothing to finish by hand.\n", &format!("// TODO(xtmd migrate): checked against a stand-in for {}, until the pack's own 0.3 release replaces it.\n", names.join(", ")), 1);
    }
    if (!o.todos.is_empty() || !o.stand_ins.is_empty()) && !crate::migrate_step::TODO.load(std::sync::atomic::Ordering::Relaxed) {
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
fn migrate_doc(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], now: &[Source], path: &Path, text: &str, from: &BTreeMap<String, u32>, uses: &BTreeMap<String, u32>) -> Outcome {
    let mut o = Outcome { text: text.to_string(), ..Outcome::default() };
    // checked as the document it is written as, for a 0.2 name too
    let doc_path = written_as(path).display().to_string();
    // a pack it imports that isn't in the build: nothing can say which version it is written for
    let missing: Vec<String> = imported(text).into_iter().filter(|n| !packs.iter().any(|p| p.name == *n) && !core_packs().contains(n)).collect();
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
            let done = crate::migrate_step::Step { text: &current, doc: &doc_path, refs: &refs, pack: &pack.name, step, label: &label, fns: &pack.fns, old: &old_world, new: &new_world, prose: true }.run();
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
            o.text = crate::migrate_step::apply(&o.text, &done.edits);
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
fn core_packs() -> Vec<String> {
    crate::core_sources().iter().filter_map(|s| parse(&s.text, Entry::Xtmd).file?.package.map(|p| p.item.name)).collect()
}

/// A pack written for an earlier version of a pack it uses: its files moved as documents are,
/// and its `uses` line brought up to the version it now uses.
fn migrate_pack(base: &xtmd_check::Checker, packs: &[Pack], sources: &[Source], p: &Pack) -> Vec<(PathBuf, String, Outcome)> {
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
                let done = crate::migrate_step::Step { text, doc: path, refs: &mine, pack: &used.name, step, label: &label, fns: &used.fns, old: &old_world, new: &new_world, prose: false }.run();
                let o = outcomes.get_mut(path).unwrap();
                o.deletions.extend(done.deletions);
                o.notices.extend(done.notices);
                o.todos.extend(done.todos);
                o.changed.extend(done.changed);
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
pub(crate) fn world_at(sources: &[Source], pack: &Pack, v: u32) -> Vec<Source> {
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
fn restamp(text: &str, stamped: &BTreeMap<String, u32>, packs: &[Pack]) -> String {
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

/// A path as a person reads it: relative to the current folder when it is under it.
pub(crate) fn shown(p: &Path) -> String {
    let here = std::env::current_dir().ok().and_then(|d| std::fs::canonicalize(d).ok());
    match here.and_then(|h| p.strip_prefix(&h).ok().map(Path::to_path_buf)) {
        Some(rel) if !rel.as_os_str().is_empty() => rel.display().to_string(),
        _ => p.display().to_string(),
    }
}

/// A unified diff of one file, as git writes one (`a/` and `b/` before its path, so `git apply`
/// and `patch -p1` take it): its changes in hunks, with three lines around each, the old lines
/// before the new.
pub(crate) fn unified(path: &str, old: &str, new: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_written_for_an_earlier_release_takes_its_steps_then_compiles() {
        let base = xtmd_check::compile_core(&crate::core_sources());
        let steps = crate::releases::between("0.3.0", "0.3.2", crate::releases::tests::STEPS);
        let doc = "# Notes\n\n@rule();\n";
        let o = doc_through_releases(&base, &[], &[], &[], Path::new("notes.xt.md"), doc, &BTreeMap::new(), &BTreeMap::new(), &steps, "xtmd 0.3.0 → 0.3.2");
        assert!(o.refused.is_empty(), "{:?}", o.refused);
        assert_eq!(o.text, "# Notes\n\n@divider();\n");
        assert_eq!(o.moved, ["xtmd 0.3.0 → 0.3.2"]);
        assert_eq!(o.notices, ["xtmd 0.3.2: `rule` is `divider` now"]);
        // a release whose step can't move it refuses it, as it was
        let later = crate::releases::between("0.3.2", "0.4.0", crate::releases::tests::STEPS);
        let o = doc_through_releases(&base, &[], &[], &[], Path::new("notes.xt.md"), doc, &BTreeMap::new(), &BTreeMap::new(), &later, "xtmd 0.3.2 → 0.4.0");
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
