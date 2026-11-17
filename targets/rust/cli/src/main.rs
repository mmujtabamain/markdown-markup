//! The `mkp` command.

use std::process::ExitCode;

mod migrate;
mod examples;
mod flags;
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

/// `--pack a,b` and `-o out` taken out of the arguments, the files left.
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
            "-o" | "--pack" | "--config" | "-c" => {
                let Some(v) = args.get(k + 1) else { return Err(format!("{} needs a value", args[k])) };
                match args[k].as_str() {
                    "-o" => out = Some(v.clone()),
                    "--pack" => packs.extend(pack_sources(v)?),
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

/// `mkp build doc.mkp.md [--pack a,b] [--rir] [-o out.ir.json]`: one standalone IR, core and the packs
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
    let main = [mkp_check::Source { path: path.clone(), text }];
    let (c, resolved) = if rir {
        let base = mkp_check::compile_core(&core_sources());
        mkp_check::compile_rir(&base, &[packs], &main, module)
    } else {
        (mkp_check::compile(&core_sources(), &[packs], &main, module), None)
    };
    for d in &c.diagnostics {
        if d.file == *path || d.diagnostic.is_error() {
            eprintln!("{}", d.diagnostic.render(&d.file, &c.texts[&d.file]));
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
        None => println!("{}", json),
    }
    ExitCode::SUCCESS
}

const USAGE: &str = "usage:
  mkp fmt [--check|--diff|--stdout] <file>...   print each file back in the canonical layout: in place,
                                    or only check, show the change, or print one file
  mkp check [--json] [--pack a,b] <file>...   report every error and warning in each file
  mkp parse <file>                  print a file's syntax tree as JSON
  mkp build <file> [--pack a,b] [-o out.ir.json]   write a document's IR, with core and the packs it uses
            [--rir]                 or its resolved IR, what the checker understood, for tools
  mkp md <file> [--pack a,b] [--json] [-o out.md]  write a document's Markdown, with its starting values
  mkp surface <pack> [--pack a,b] [-o file] [--check|--diff|--stdout] [--force]
                                    write what this version of the pack provides
  mkp migrate [<file|folder>…] [--pack a,b] [--from kit@1] [--dry-run|--check|--diff|--stdout] [--yes]
                                    bring documents up to the versions of the packs they are built with
  mkp target check [target…] [--cases dir] [--defect name] [--expect-failures]
                                    run the target checks on targets, through their check adapters
  (--pack takes a comma-separated list of folders and .mkp files; --config/-c names an mkp.toml,
   and left out, mkp looks for one beside the file and in the folders above: packs = [\"kit\", \"extra.mkp\"];
   mkp migrate keeps mkp = \"0.3.0\" there, the release of mkp the tree is written for, and [uses],
   the version of each pack)";

fn read(path: &str) -> Result<(String, mkp_syntax::Entry), String> {
    let entry = entry_for(path).ok_or_else(|| format!("{}: not an MKP file (.mkp or .mkp.md)", path))?;
    let src = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path, e))?;
    Ok((src, entry))
}

fn report(path: &str, src: &str, diags: &[Diagnostic]) {
    for d in diags {
        eprintln!("{}", d.render(path, src));
    }
}

fn fmt(args: &[String]) -> ExitCode {
    let check = args.iter().any(|a| a == "--check");
    let diff = args.iter().any(|a| a == "--diff");
    let stdout = args.iter().any(|a| a == "--stdout");
    let files: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if files.is_empty() {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    }
    if stdout && files.len() != 1 {
        eprintln!("--stdout prints one file in the canonical layout: name one file");
        return ExitCode::from(2);
    }
    let mut failed = false;
    for path in files {
        let (src, entry) = match read(path) {
            Ok(x) => x,
            Err(e) => {
                eprintln!("{}", e);
                failed = true;
                continue;
            }
        };
        match format(&src, entry) {
            // --stdout: the file in the canonical layout, written nowhere
            Ok(out) if stdout => print!("{}", out),
            Ok(out) if out == src => {}
            Ok(out) if diff => print!("{}", migrate::unified(path, &src, &out)),
            Ok(out) => {
                if check {
                    eprintln!("{}: not in the canonical layout", path);
                    failed = true;
                } else if let Err(e) = std::fs::write(path, out) {
                    eprintln!("{}: {}", path, e);
                    failed = true;
                }
            }
            Err(diags) => {
                report(path, &src, &diags);
                failed = true;
            }
        }
    }
    if failed {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn parse_cmd(args: &[String]) -> ExitCode {
    let Some(path) = args.first() else {
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
    report(path, &src, &parsed.diagnostics);
    let errors = parsed.has_errors();
    match parsed.file {
        Some(f) => {
            println!("{}", serde_json::to_string_pretty(&f).unwrap());
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
    let json = args.iter().any(|a| a == "--json");
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
    let mut all = Vec::new();
    let base = mkp_check::compile_core(&core_sources());
    for path in &files {
        let (src, _) = match read(path) {
            Ok(x) => x,
            Err(e) => {
                eprintln!("{}", e);
                failed = true;
                continue;
            }
        };
        // each file with core and the packs: a document, or a pack's file with the rest of its pack
        let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
        let packs: Vec<mkp_check::Source> = packs.iter().filter(|p| std::path::Path::new(&p.path) != std::path::Path::new(path)).cloned().collect();
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
        for found in c.diagnostics.iter().filter(|d| d.file == *path || d.diagnostic.is_error()) {
            let (file, d) = (&found.file, &found.diagnostic);
            let text = c.texts.get(file.as_str()).map(String::as_str).unwrap_or("");
            if json {
                let lines = mkp_syntax::Lines::new(text);
                let at = lines.place(d.span.start);
                let end = lines.place(d.span.end);
                all.push(serde_json::json!({
                    "file": file, "code": d.code, "severity": d.severity, "line": at.line, "column": at.column,
                    "end": {"line": end.line, "column": end.column}, "message": d.message, "fix": d.fix,
                }));
            } else {
                eprintln!("{}", d.render(file, text));
            }
        }
    }
    if json {
        println!("{}", serde_json::to_string_pretty(&all).unwrap());
    }
    if failed {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

/// `mkp md doc.mkp.md [--pack a,b] [--json] [-o out.md]`: the page as Markdown, with its starting
/// values; `--json` gives its blocks as the checks read them.
fn md(args: &[String]) -> ExitCode {
    let json = args.iter().any(|a| a == "--json");
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
    let c = mkp_check::compile(&core_sources(), &[packs], &[mkp_check::Source { path: path.clone(), text }], module);
    for d in c.diagnostics.iter().filter(|d| d.diagnostic.is_error()) {
        eprintln!("{}", d.diagnostic.render(&d.file, &c.texts[&d.file]));
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
    let written = if json { serde_json::to_string_pretty(&mkp_markdown::blocks_json(&blocks)).unwrap() } else { mkp_markdown::write_page(m.front_matter.as_deref(), &blocks) };
    match out {
        Some(o) => {
            if let Err(e) = std::fs::write(&o, written) {
                eprintln!("{}: {}", o, e);
                return ExitCode::from(1);
            }
        }
        None => print!("{}", written),
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
