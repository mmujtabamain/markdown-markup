//! `xtmd migrate`: brings documents written for an earlier version of a pack up to the version
//! they are built with, through the pack's migrations (page 6). It edits only the references the
//! checker finds, in place, after a summary, a warning and a y/n, and never writes a file that
//! doesn't compile afterwards.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use xtmd_migrate::{pass, release_in, step_packs, uses_after, uses_in, with_release, with_uses, Outcome, Step02, Tree, ALLOW_ERRORS, FIRST};
pub(crate) use xtmd_migrate::{is_doc, packs_of, release_of, unified, world_at, written_as, RELEASE};

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
  file: [confirm] \"Make kit@1's badges small?\" = true, and [split] \"docs/a.xtmd:4 LATE\" = \"DONE\".
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
  moves too: MKP named a document name.mkp.md, and Extended Mark names it name.xtmd.
  xtmd.toml's xtmd = \"0.3.x\" says the release the tree is written for (0.3.0 when it says none),
  and [uses] each pack's version; a run that moves the tree writes both.
  --format json prints a JSON line for each file, note and question, then the summary, and asks
  nothing.
  exit: 0 done, or nothing to do; 1 something is left: a file refused or skipped, a question open,
        or (with --check) a file that would change; 2 a usage error, or a file that can't be read
  e.g.  xtmd migrate --dry-run
        xtmd migrate docs --yes
        xtmd migrate docs --yes all --report migration.md";

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
        eprintln!("--stdout prints one document's result: name one .xtmd file{}", if json { ", and leave out --format json" } else { "" });
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
                eprintln!("{}: not a document (.xtmd) or a folder", t);
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
    let release_steps = xtmd_migrate::releases::between(&from_release, RELEASE, xtmd_migrate::releases::STEPS);
    let release_label = format!("xtmd {} → {}", from_release, RELEASE);
    let (stepped, step_refused) = step_packs(&mut sources, &release_steps);
    let packs = packs_of(&sources);
    let base = xtmd_check::compile_core(&crate::core_sources());

    // the plan: a pass over every file; when it meets questions no one has answered, they are asked
    // in a terminal and the files planned again with the answers, and elsewhere the run stops
    // stand-ins for the 0.2 packs that have no 0.3 release here, beside the documents
    let stand_in_dir = targets.first().map(|t| if Path::new(t).is_dir() { PathBuf::from(t) } else { Path::new(t).parent().map(Path::to_path_buf).unwrap_or_default() }).unwrap_or_default().join("stand-ins");
    let mut asked_here = false;
    // the documents, read once: each pass plans them again
    let mut texts: Vec<(PathBuf, String)> = Vec::new();
    for d in &docs {
        let Ok(text) = std::fs::read_to_string(d) else {
            eprintln!("{}: can't be read", d.display());
            return ExitCode::from(2);
        };
        texts.push((d.clone(), text));
    }
    let run_02 = |p: &Path| crate::migrate_02::run(p, &packs02);
    let step02 = Step02 { run: &run_02, packs_given: !packs02.is_empty() };
    let tree = Tree { base: &base, sources: &sources, packs: &packs, stepped: &stepped, step_refused: &step_refused, release_steps: &release_steps, release_label: &release_label, from: &from, uses: &uses, stand_in_dir: &stand_in_dir, step02: &step02 };
    let (results, stand_ins) = loop {
        let (results, stand_ins) = pass(&tree, &texts);
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
    let uses_to = uses_after(&packs, &uses);
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

/// `[uses]` in the xtmd.toml: the version of each pack its tree is written for.
fn uses_in_config(named: Option<&str>, target: Option<&str>) -> (BTreeMap<String, u32>, Option<PathBuf>) {
    let path = match named {
        Some(p) => Some(PathBuf::from(p)),
        None => crate::find_config(target),
    };
    let Some(text) = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()) else { return (BTreeMap::new(), path) };
    (uses_in(&text), path)
}

/// xtmd.toml's `xtmd = "0.3.x"`: the release of xtmd the tree is written for.
fn release_in_config(path: &Path) -> Option<String> {
    release_in(&std::fs::read_to_string(path).ok()?)
}

/// xtmd.toml's `xtmd = "…"` set to a release: in place, or as its first line.
fn set_release(path: &Path, to: &str) -> std::io::Result<()> {
    let text = std::fs::read_to_string(path)?;
    std::fs::write(path, with_release(&text, to))
}

/// The xtmd.toml's `[uses]`, each pack at the version its files are now written for.
fn bump_config(path: &Path, to: &BTreeMap<String, u32>) -> std::io::Result<()> {
    let text = std::fs::read_to_string(path)?;
    std::fs::write(path, with_uses(&text, to))
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
