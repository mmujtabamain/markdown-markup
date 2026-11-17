//! The `mkp` command.

use std::process::ExitCode;

mod migrate;
mod examples;
mod flags;
mod out;
mod migrate_02;
mod releases;
mod migrate_step;
mod surface;
mod target;

use mkp_syntax::{entry_for, format, parse, Diagnostic};

include!(concat!(env!("OUT_DIR"), "/core.rs"));

fn core_sources() -> Vec<mkp_check::Source> {
    CORE.iter().map(|(p, t)| mkp_check::Source { path: p.to_string(), text: t.to_string() }).collect()
}

/// The packs `--pack` names: a comma-separated list of folders and `.mkp` files. A folder gives
/// every `.mkp` file under it; each file says its own pack with its `package` line.
fn pack_sources(list: &str) -> Result<Vec<mkp_check::Source>, String> {
    fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) -> Result<(), String> {
        let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(dir).map_err(|e| format!("{}: {}", dir.display(), e))?.filter_map(|e| e.ok().map(|e| e.path())).collect();
        entries.sort();
        for p in entries {
            if p.is_dir() {
                walk(&p, out)?;
            } else if p.extension().map_or(false, |x| x == "mkp") {
                out.push(p);
            }
        }
        Ok(())
    }
    let mut paths = Vec::new();
    for item in list.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let p = std::path::Path::new(item);
        if p.is_dir() {
            walk(p, &mut paths)?;
        } else if item.ends_with(".mkp") {
            paths.push(p.to_path_buf());
        } else {
            return Err(format!("--pack {}: not a folder or a .mkp file", item));
        }
    }
    paths
        .into_iter()
        .map(|p| {
            let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {}", p.display(), e))?;
            Ok(mkp_check::Source { path: p.to_string_lossy().into_owned(), text })
        })
        .collect()
}

/// `--pack a,b` and `--out file` taken out of the arguments, the files left.
/// What an `mkp.toml` holds: the packs a document uses, as `--pack` takes them, relative to it.
#[derive(serde::Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Config {
    #[serde(default)]
    packs: Vec<String>,
    /// The release of MKP the tree is written for.
    #[serde(default)]
    #[allow(dead_code)]
    mkp: Option<String>,
    /// The version of each pack the tree is written for, as `mkp migrate` reads it.
    #[serde(default)]
    #[allow(dead_code)]
    uses: std::collections::BTreeMap<String, u32>,
}

/// The `mkp.toml` named, or else the one beside the document or in a folder above it.
fn config_for(named: Option<&str>, file: Option<&String>) -> Result<Vec<mkp_check::Source>, String> {
    let path = match named {
        Some(p) => Some(std::path::PathBuf::from(p)),
        None => file.and_then(|f| {
            let start = std::fs::canonicalize(f).ok()?;
            start.ancestors().skip(1).map(|d| d.join("mkp.toml")).find(|p| p.is_file())
        }),
    };
    let Some(path) = path else { return Ok(Vec::new()) };
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let config: Config = toml::from_str(&text).map_err(|e| format!("{}: {}", path.display(), e.message()))?;
    let dir = path.parent().map(|d| d.to_path_buf()).unwrap_or_default();
    let mut out = Vec::new();
    for p in &config.packs {
        out.extend(pack_sources(&dir.join(p).to_string_lossy())?);
    }
    Ok(out)
}

fn options(args: &[String]) -> Result<(Vec<String>, Vec<mkp_check::Source>, Option<String>), String> {
    let (mut files, mut packs, mut out) = (Vec::new(), Vec::new(), None);
    let mut config: Option<String> = None;
    let mut k = 0;
    while k < args.len() {
        match args[k].as_str() {
            "--out" | "--pack" | "--config" | "--format" => {
                let Some(v) = args.get(k + 1) else { return Err(format!("{} needs a value", args[k])) };
                match args[k].as_str() {
                    "--out" => out = Some(v.clone()),
                    "--pack" => packs.extend(pack_sources(v)?),
                    "--format" => {}
                    _ => config = Some(v.clone()),
                }
                k += 2;
            }
            a if a.starts_with("--pack=") => {
                packs.extend(pack_sources(&a["--pack=".len()..])?);
                k += 1;
            }
            a if a.starts_with("--") => k += 1,
            _ => {
                files.push(args[k].clone());
                k += 1;
            }
        }
    }
    // the config's packs, then --pack's; a file named twice is read once
    let mut all = config_for(config.as_deref(), files.first())?;
    all.extend(packs);
    let mut seen = std::collections::HashSet::new();
    all.retain(|s| seen.insert(std::fs::canonicalize(&s.path).unwrap_or_else(|_| s.path.clone().into())));
    Ok((files, all, out))
}

/// The packs without the file itself, however each names it: a relative path given, and the
/// same file found through an mkp.toml's absolute one, are one file.
fn without(packs: &[mkp_check::Source], path: &str) -> Vec<mkp_check::Source> {
    let me = std::fs::canonicalize(path).ok();
    packs.iter().filter(|p| std::path::Path::new(&p.path) != std::path::Path::new(path) && (me.is_none() || std::fs::canonicalize(&p.path).ok() != me)).cloned().collect()
}

/// `mkp build doc.mkp.md [--pack a,b] [--rir] [--out out.ir.json]`: one standalone IR, core and the packs
/// in it; with `--rir`, the resolved IR of the document and its packs instead.
fn build(args: &[String]) -> ExitCode {
    let (files, packs, out) = match options(args) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let Some(path) = files.first() else {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    };
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{}: {}", path, e);
            return ExitCode::from(1);
        }
    };
    let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
    let rir = args.iter().any(|a| a == "--rir");
    let json_diags = match json_or_exit(args) {
        Ok(j) => j,
        Err(c) => return c,
    };
    let main = [mkp_check::Source { path: path.clone(), text }];
    let packs = without(&packs, path);
    let (c, resolved) = if rir {
        let base = mkp_check::compile_core(&core_sources());
        mkp_check::compile_rir(&base, &[packs], &main, module)
    } else {
        (mkp_check::compile(&core_sources(), &[packs], &main, module), None)
    };
    for d in &c.diagnostics {
        if d.file == *path || d.diagnostic.is_error() {
            if json_diags {
                eprintln!("{}", out::diagnostic(&d.file, &c.texts[&d.file], &d.diagnostic));
            } else {
                eprintln!("{}", d.diagnostic.render(&d.file, &c.texts[&d.file]));
            }
        }
    }
    let Some(mut m) = c.module else { return ExitCode::from(1) };
    let json = match resolved {
        // the resolved IR: what the checker understood, for tools
        Some(r) => serde_json::to_string_pretty(&r).unwrap(),
        None => {
            // every prop that isn't constant becomes a binding with what it reads
            mkp_lower::lower(&mut m);
            serde_json::to_string_pretty(&mkp_ir::ir::File { ir: m }).unwrap()
        }
    };
    match out {
        Some(o) => {
            if let Err(e) = std::fs::write(&o, json) {
                eprintln!("{}: {}", o, e);
                return ExitCode::from(1);
            }
        }
        None => out::text(&json),
    }
    ExitCode::SUCCESS
}

const USAGE: &str = "usage:
  mkp fmt [--check|--diff|--stdout] <file>...   print each file back in the canonical layout: in place,
                                    or only check, show the change, or print one file
  mkp check [--pack a,b] <file>...   report every error and warning in each file
  mkp parse <file>                  print a file's syntax tree as JSON
  mkp build <file> [--pack a,b] [--out out.ir.json]   write a document's IR, with core and the packs it uses
            [--rir]                 or its resolved IR, what the checker understood, for tools
  mkp md <file> [--pack a,b] [--out out.md]  write a document's Markdown, with its starting values
  mkp surface <pack> [--pack a,b] [--out file] [--check|--diff|--stdout] [--force]
                                    write what this version of the pack provides
  mkp migrate [<file|folder>…] [--pack a,b] [--from kit@1] [--dry-run|--check|--diff|--stdout] [--yes]
                                    bring documents up to the versions of the packs they are built with
  mkp target check [target…] [--cases dir] [--defect name] [--expect-failures]
                                    run the target checks on targets, through their check adapters
  --format json, on every command: one that writes a document (build, md, parse) prints it as JSON;
  one that reports (check, fmt, surface, migrate, target check) prints a JSON object a line, with
  its \"type\", and a summary last; diagnostics are JSON wherever they go.
  --out <file>, on every command: what it prints goes to the file (build, md and surface: their document).
  (--pack takes a comma-separated list of folders and .mkp files; --config names an mkp.toml,
   and left out, mkp looks for one beside the file and in the folders above: packs = [\"kit\", \"extra.mkp\"];
   mkp migrate keeps mkp = \"0.3.0\" there, the release of mkp the tree is written for, and [uses],
   the version of each pack)";

fn read(path: &str) -> Result<(String, mkp_syntax::Entry), String> {
    let entry = entry_for(path).ok_or_else(|| format!("{}: not an MKP file (.mkp or .mkp.md)", path))?;
    let src = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path, e))?;
    Ok((src, entry))
}

fn report(path: &str, src: &str, diags: &[Diagnostic], json: bool) {
    for d in diags {
        if json {
            eprintln!("{}", out::diagnostic(path, src, d));
        } else {
            eprintln!("{}", d.render(path, src));
        }
    }
}

/// `--format`'s choice, or the usage error it is.
fn json_or_exit(args: &[String]) -> Result<bool, ExitCode> {
    out::wants_json(args).map_err(|e| {
        eprintln!("{}", e);
        ExitCode::from(2)
    })
}

/// The arguments that aren't flags, and not the value of one that takes a value.
fn positional(args: &[String]) -> Vec<&String> {
    let mut out = Vec::new();
    let mut k = 0;
    while k < args.len() {
        match args[k].as_str() {
            "--format" | "--out" | "--pack" | "--config" => k += 2,
            a if a.starts_with('-') && a.len() > 1 => k += 1,
            _ => {
                out.push(&args[k]);
                k += 1;
            }
        }
    }
    out
}

fn fmt(args: &[String]) -> ExitCode {
    let check = args.iter().any(|a| a == "--check");
    let diff = args.iter().any(|a| a == "--diff");
    let stdout = args.iter().any(|a| a == "--stdout");
    let json = match json_or_exit(args) {
        Ok(j) => j,
        Err(c) => return c,
    };
    let files = positional(args);
    if files.is_empty() {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    }
    if stdout && files.len() != 1 {
        eprintln!("--stdout prints one file in the canonical layout: name one file");
        return ExitCode::from(2);
    }
    let mut failed = false;
    // with --format json, what became of each file: canonical, formatted, would change, printed, or failed
    let mut counts: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
    let mut tell = |file: &str, result: &'static str, more: serde_json::Value| {
        *counts.entry(result).or_default() += 1;
        if json {
            let mut v = serde_json::json!({ "type": "file", "file": file, "result": result });
            if let serde_json::Value::Object(m) = more {
                v.as_object_mut().unwrap().extend(m);
            }
            out::line(v);
        }
    };
    for path in files {
        let (src, entry) = match read(path) {
            Ok(x) => x,
            Err(e) => {
                if !json {
                    eprintln!("{}", e);
                }
                tell(path, "not read", serde_json::json!({ "why": e }));
                failed = true;
                continue;
            }
        };
        match format(&src, entry) {
            // --stdout: the file in the canonical layout, written nowhere
            Ok(text) if stdout => {
                if json {
                    tell(path, "printed", serde_json::json!({ "text": text }));
                } else {
                    out::print(&text);
                }
            }
            Ok(text) if text == src => tell(path, "canonical", serde_json::json!({})),
            Ok(text) if diff => {
                let d = migrate::unified(path, &src, &text);
                if !json {
                    out::print(&d);
                }
                tell(path, "would change", serde_json::json!({ "diff": d }));
            }
            Ok(text) => {
                if check {
                    if !json {
                        eprintln!("{}: not in the canonical layout", path);
                    }
                    tell(path, "would change", serde_json::json!({}));
                    failed = true;
                } else if let Err(e) = std::fs::write(path, text) {
                    if !json {
                        eprintln!("{}: {}", path, e);
                    }
                    tell(path, "not written", serde_json::json!({ "why": e.to_string() }));
                    failed = true;
                } else {
                    tell(path, "formatted", serde_json::json!({}));
                }
            }
            Err(diags) => {
                if json {
                    for d in &diags {
                        out::line(out::diagnostic(path, &src, d));
                    }
                } else {
                    report(path, &src, &diags, false);
                }
                tell(path, "doesn't read", serde_json::json!({}));
                failed = true;
            }
        }
    }
    if json {
        let mut v = serde_json::json!({ "type": "summary", "exit": if failed { 1 } else { 0 } });
        for (k, n) in &counts {
            v[k.replace(' ', "_").replace('\'', "")] = serde_json::json!(n);
        }
        out::line(v);
    }
    if failed {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn parse_cmd(args: &[String]) -> ExitCode {
    // its syntax tree is JSON whatever --format says; --format json makes its diagnostics JSON too
    let json = match json_or_exit(args) {
        Ok(j) => j,
        Err(c) => return c,
    };
    let Some(path) = positional(args).first().copied() else {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    };
    let (src, entry) = match read(path) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(1);
        }
    };
    let parsed = parse(&src, entry);
    report(path, &src, &parsed.diagnostics, json);
    let errors = parsed.has_errors();
    match parsed.file {
        Some(f) => {
            out::text(&serde_json::to_string_pretty(&f).unwrap());
            if errors {
                ExitCode::from(1)
            } else {
                ExitCode::SUCCESS
            }
        }
        None => ExitCode::from(1),
    }
}

fn check(args: &[String]) -> ExitCode {
    let json = match json_or_exit(args) {
        Ok(j) => j,
        Err(c) => return c,
    };
    let (files, packs, _) = match options(args) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    if files.is_empty() {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    }
    let mut failed = false;
    let (mut errors, mut warnings) = (0, 0);
    let base = mkp_check::compile_core(&core_sources());
    for path in &files {
        let (src, _) = match read(path) {
            Ok(x) => x,
            Err(e) => {
                if json {
                    out::line(serde_json::json!({ "type": "file", "file": path, "result": "not read", "why": e }));
                } else {
                    eprintln!("{}", e);
                }
                failed = true;
                continue;
            }
        };
        // each file with core and the packs: a document, or a pack's file with the rest of its pack
        let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
        let packs = without(&packs, path);
        let c = mkp_check::compile_on(&base, &[packs.clone()], &[mkp_check::Source { path: path.to_string(), text: src.clone() }], module);
        failed |= c.module.is_none();
        // a pack's migrations: each example run through its block, once the file compiles
        let mut c = c;
        if c.module.is_some() && module == "main" {
            crate::migrate_step::NO_ASKING.store(true, std::sync::atomic::Ordering::Relaxed);
            for d in examples::check(&base, path, &src, &packs) {
                failed = true;
                c.diagnostics.push(mkp_check::Found { file: path.to_string(), diagnostic: d });
            }
        }
        // this file's errors and warnings, and any pack's errors
        let (mut e, mut w) = (0, 0);
        for found in c.diagnostics.iter().filter(|d| d.file == *path || d.diagnostic.is_error()) {
            let (file, d) = (&found.file, &found.diagnostic);
            let text = c.texts.get(file.as_str()).map(String::as_str).unwrap_or("");
            if d.is_error() {
                e += 1;
            } else {
                w += 1;
            }
            if json {
                out::line(out::diagnostic(file, text, d));
            } else if out::to_a_file() {
                // what check reports is its diagnostics: with --out, they go to the file
                out::text(&d.render(file, text));
            } else {
                eprintln!("{}", d.render(file, text));
            }
        }
        if json {
            out::line(serde_json::json!({ "type": "file", "file": path, "result": if e > 0 { "errors" } else if w > 0 { "warnings" } else { "clean" }, "errors": e, "warnings": w }));
        }
        errors += e;
        warnings += w;
    }
    if json {
        out::line(serde_json::json!({ "type": "summary", "files": files.len(), "errors": errors, "warnings": warnings, "exit": if failed { 1 } else { 0 } }));
    }
    if failed {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

/// `mkp md doc.mkp.md [--pack a,b] [--format json] [--out out.md]`: the page as Markdown, with its
/// starting values; `--format json` gives its blocks as the checks read them.
fn md(args: &[String]) -> ExitCode {
    let json = match json_or_exit(args) {
        Ok(j) => j,
        Err(c) => return c,
    };
    let (files, packs, out) = match options(args) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let Some(path) = files.first() else {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    };
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{}: {}", path, e);
            return ExitCode::from(1);
        }
    };
    let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
    let c = mkp_check::compile(&core_sources(), &[without(&packs, path)], &[mkp_check::Source { path: path.clone(), text }], module);
    for d in c.diagnostics.iter().filter(|d| d.diagnostic.is_error()) {
        if json {
            eprintln!("{}", out::diagnostic(&d.file, &c.texts[&d.file], &d.diagnostic));
        } else {
            eprintln!("{}", d.diagnostic.render(&d.file, &c.texts[&d.file]));
        }
    }
    let Some(mut m) = c.module else { return ExitCode::from(1) };
    mkp_lower::lower(&mut m);
    let blocks = match mkp_markdown::page(&m) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("{}: writing its Markdown failed: {}", path, e.0);
            return ExitCode::from(1);
        }
    };
    let written = if json { serde_json::to_string_pretty(&mkp_markdown::blocks_json(&blocks)).unwrap() + "\n" } else { mkp_markdown::write_page(m.front_matter.as_deref(), &blocks) };
    match out {
        Some(o) => {
            if let Err(e) = std::fs::write(&o, written) {
                eprintln!("{}: {}", o, e);
                return ExitCode::from(1);
            }
        }
        None => out::print(&written),
    }
    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // each command's flags: an unknown one is ignored with a warning, a dropped one stops it
    let (cmd, rest) = match args.first().map(String::as_str) {
        Some("target") if args.get(1).map(String::as_str) == Some("check") => ("target check", &args[2..]),
        Some(c) => (c, &args[1.min(args.len())..]),
        None => ("", &args[..]),
    };
    if !cmd.is_empty() && !flags::ok(cmd, rest) {
        return ExitCode::from(2);
    }
    // --out: build, md and surface write their document there; the rest, what they print
    if !matches!(cmd, "build" | "md" | "surface") {
        if let Some(p) = out::out_path(rest) {
            if let Err(e) = out::to_file(&p) {
                eprintln!("{}", e);
                return ExitCode::from(2);
            }
        }
    }
    match args.first().map(String::as_str) {
        Some("fmt") => fmt(&args[1..]),
        Some("parse") => parse_cmd(&args[1..]),
        Some("check") => check(&args[1..]),
        Some("build") => build(&args[1..]),
        Some("md") => md(&args[1..]),
        Some("surface") => surface::surface_cmd(&args[1..]),
        Some("migrate") => migrate::migrate_cmd(&args[1..]),
        Some("target") if args.get(1).map(String::as_str) == Some("check") => target::target_check(&args[2..]),
        _ => {
            eprintln!("{}", USAGE);
            ExitCode::from(2)
        }
    }
}
