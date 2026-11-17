//! The `mkp` command.

use std::process::ExitCode;

mod migrate;
mod examples;
mod flags;
mod help;
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
        if migrate_02::is_pack(p) {
            return Err(format!("--pack {}: an MKP 0.2 pack (it has a manifest.mkp). mkp migrate takes it, beside the 0.3 packs, to move a 0.2 document; the rest of mkp needs its 0.3 release, or the stand-in mkp migrate writes", item));
        }
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

/// The `mkp.toml` for a file or folder: the one in its folder (a folder's own, for a folder) or in a
/// folder above it; for nothing named, the current folder's.
pub(crate) fn find_config(file: Option<&str>) -> Option<std::path::PathBuf> {
    let start = std::fs::canonicalize(file.unwrap_or(".")).ok()?;
    let skip = usize::from(!start.is_dir());
    start.ancestors().skip(skip).map(|d| d.join("mkp.toml")).find(|p| p.is_file())
}

/// The packs of the `mkp.toml` named, or else of the one `find_config` finds.
fn config_for(named: Option<&str>, file: Option<&String>) -> Result<Vec<mkp_check::Source>, String> {
    let path = match named {
        Some(p) => Some(std::path::PathBuf::from(p)),
        None => find_config(file.map(String::as_str)),
    };
    let Some(path) = path else { return Ok(Vec::new()) };
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let config: Config = toml::from_str(&text).map_err(|e| format!("{}: {}", path.display(), e.message()))?;
    let dir = path.parent().map(|d| d.to_path_buf()).unwrap_or_default();
    let mut out = Vec::new();
    for p in &config.packs {
        let packs = pack_sources(&dir.join(p).to_string_lossy()).map_err(|e| format!("{}: packs = [\"{}\"]: {}", path.display(), p, e.split_once(": ").map_or(e.as_str(), |(_, why)| why)))?;
        out.extend(packs);
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
            a if flags::is_flag(a) => k += 1,
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


/// The MKP files a folder holds, documents and packs' files, at any depth.
fn under(dir: &std::path::Path, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<std::path::PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort();
    for p in entries {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if p.is_dir() {
            if !name.starts_with('.') && !matches!(name, "node_modules" | "target" | "dist") {
                under(&p, out);
            }
        } else if entry_for(&p.to_string_lossy()).is_some() {
            out.push(p.to_string_lossy().into_owned());
        }
    }
}

/// The files named, each folder as the MKP files under it.
fn expand(files: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for f in files {
        if std::path::Path::new(f).is_dir() {
            under(std::path::Path::new(f), &mut out);
        } else {
            out.push(f.clone());
        }
    }
    out
}

/// A command that takes one file, given more: the usage error it is.
fn one_file(cmd: &str, files: &[String]) -> Result<(), ExitCode> {
    if files.len() > 1 {
        eprintln!("mkp {} takes one file, and was given {}: {}", cmd, files.len(), files.join(", "));
        return Err(ExitCode::from(2));
    }
    Ok(())
}

/// The surfaces a pack's file has released: `surfaces/` in its pack's folder (the file's, or the
/// one above `migrations/`), so a change that breaks one is an error.
fn released_surfaces(path: &str) -> Vec<mkp_check::Source> {
    let file = std::path::Path::new(path);
    let Some(mut dir) = file.parent() else { return Vec::new() };
    if dir.file_name().map_or(false, |n| n == "migrations" || n == "surfaces") {
        dir = dir.parent().unwrap_or(dir);
    }
    let surfaces = dir.join("surfaces");
    if !surfaces.is_dir() {
        return Vec::new();
    }
    pack_sources(&surfaces.to_string_lossy()).unwrap_or_default()
}

/// The codes of the errors a missing pack brings with it: its names, looked for and not found.
const FOLLOWS_A_MISSING_PACK: &[&str] = &["names.unknown-type", "names.unknown-widget", "names.unknown-fn", "names.unknown-name", "names.unknown-case"];

/// A pack the build doesn't have: its error says how to add it, and the errors that follow from it
/// in the same file are left out until it is found, its message counting them.
fn missing_packs(c: &mut mkp_check::Compiled) {
    let files: std::collections::HashSet<String> = c.diagnostics.iter().filter(|d| d.diagnostic.code == "names.unknown-pack").map(|d| d.file.clone()).collect();
    if files.is_empty() {
        return;
    }
    let mut left: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    c.diagnostics.retain(|d| {
        let follows = files.contains(&d.file) && FOLLOWS_A_MISSING_PACK.contains(&d.diagnostic.code);
        if follows {
            *left.entry(d.file.clone()).or_default() += 1;
        }
        !follows
    });
    for d in c.diagnostics.iter_mut().filter(|d| d.diagnostic.code == "names.unknown-pack") {
        let name = d.diagnostic.message.split('`').nth(1).unwrap_or("it").to_string();
        if d.diagnostic.fix.is_none() {
            d.diagnostic.fix = Some(format!("pass its folder with --pack (--pack {} for ./{}), or list it in mkp.toml: packs = [\"{}\"]", name, name, name));
        }
        if let Some(n) = left.remove(&d.file) {
            d.diagnostic.message = format!("{} ({} more error{} that follow from it are left out until it is found)", d.diagnostic.message, n, if n == 1 { "" } else { "s" });
        }
    }
}

/// A document that looks like MKP 0.2's, which 0.3 reads as plain Markdown: a warning that says so.
fn written_for_02(src: &str) -> Option<Diagnostic> {
    let what = if migrate_02::stamped(src) {
        "its front matter says mkp: 0.2"
    } else {
        let marks = migrate_02::looks_02(src)?;
        if migrate_02::speaks_03(src) {
            return None;
        }
        marks
    };
    Some(Diagnostic::warning(
        "file.mkp-0.2",
        mkp_syntax::Span { start: 0, end: 0 },
        format!("this looks like an MKP 0.2 document ({}), which 0.3 reads as plain Markdown: mkp migrate brings it to 0.3", what),
    ))
}

/// The levels a compiled document needs, by name.
fn levels_of(m: &mkp_ir::ir::Module) -> Vec<String> {
    m.levels.iter().filter_map(|l| serde_json::to_value(l).ok()).filter_map(|v| v.as_str().map(str::to_string)).collect()
}

fn plural(n: usize, one: &str) -> String {
    format!("{} {}{}", n, one, if n == 1 { "" } else { "s" })
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
    if let Err(c) = one_file("build", &files) {
        return c;
    }
    let Some(path) = files.first() else {
        eprintln!("{}", help::of("build").unwrap());
        return ExitCode::from(2);
    };
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{}: {}", path, e);
            return ExitCode::from(2);
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
    let (mut c, resolved) = if rir {
        let base = mkp_check::compile_core(&core_sources());
        mkp_check::compile_rir(&base, &[packs], &main, module)
    } else {
        (mkp_check::compile(&core_sources(), &[packs], &main, module), None)
    };
    missing_packs(&mut c);
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
        // the resolved IR: what the checker understood, for tools, and what the document needs
        Some(mut r) => {
            if module == "doc" {
                r["levels"] = serde_json::json!(levels_of(&m));
            }
            serde_json::to_string_pretty(&r).unwrap()
        }
        None => {
            // every prop that isn't constant becomes a binding with what it reads
            mkp_lower::lower(&mut m);
            serde_json::to_string_pretty(&mkp_ir::ir::File { ir: m }).unwrap()
        }
    };
    match out {
        Some(o) => {
            if let Err(e) = out::write_file(&o, json) {
                eprintln!("{}", e);
                return ExitCode::from(1);
            }
        }
        None => out::text(&json),
    }
    ExitCode::SUCCESS
}

fn read(path: &str) -> Result<(String, mkp_syntax::Entry), String> {
    if std::path::Path::new(path).is_dir() {
        return Err(format!("{}: a folder", path));
    }
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
    // --out alone: one file's canonical text, written there, the file left as it was
    let copy = out::to_a_file() && !check && !diff && !args.iter().any(|a| a == "--stdout");
    let stdout = args.iter().any(|a| a == "--stdout") || copy;
    let json = match json_or_exit(args) {
        Ok(j) => j,
        Err(c) => return c,
    };
    let files = expand(&positional(args).into_iter().cloned().collect::<Vec<_>>());
    if files.is_empty() {
        eprintln!("{}", help::of("fmt").unwrap());
        return ExitCode::from(2);
    }
    if stdout && files.len() != 1 {
        if copy {
            eprintln!("--out takes one file's canonical text: name one file, or add --check or --diff for a report on several");
        } else {
            eprintln!("--stdout prints one file in the canonical layout: name one file");
        }
        return ExitCode::from(2);
    }
    // what fmt says of each file: on stderr, so --stdout and --diff print only the text; with --out
    // and --check, in the report
    let say = |line: &str| if diff || stdout { eprintln!("{}", line) } else { out::note(line) };
    let (mut failed, mut unread) = (false, false);
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
    for path in &files {
        let (src, entry) = match read(path) {
            Ok(x) => x,
            Err(e) => {
                if !json {
                    eprintln!("{}", e);
                }
                tell(path, "not read", serde_json::json!({ "why": e }));
                unread = true;
                continue;
            }
        };
        match format(&src, entry) {
            // --stdout: the file in the canonical layout, written nowhere (or to --out's file)
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
                failed |= check;
            }
            Ok(text) => {
                if check {
                    if !json {
                        say(&format!("{}: not in the canonical layout (mkp fmt {} rewrites it)", path, path));
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
                    if !json {
                        say(&format!("{}: formatted", path));
                    }
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
    let code: u8 = if unread { 2 } else if failed { 1 } else { 0 };
    if json {
        let mut v = serde_json::json!({ "type": "summary", "files": files.len(), "exit": code });
        for (k, n) in &counts {
            v[k.replace(' ', "_").replace('\'', "")] = serde_json::json!(n);
        }
        out::line(v);
    } else if !stdout {
        let parts: Vec<String> = counts.iter().map(|(k, n)| format!("{} {}", n, if *k == "canonical" { "already canonical" } else { k })).collect();
        say(&format!("{}: {}", plural(files.len(), "file"), parts.join(", ")));
    }
    ExitCode::from(code)
}

fn parse_cmd(args: &[String]) -> ExitCode {
    // its syntax tree is JSON whatever --format says; --format json makes its diagnostics JSON too
    let json = match json_or_exit(args) {
        Ok(j) => j,
        Err(c) => return c,
    };
    let files: Vec<String> = positional(args).into_iter().cloned().collect();
    if let Err(c) = one_file("parse", &files) {
        return c;
    }
    let Some(path) = files.first() else {
        eprintln!("{}", help::of("parse").unwrap());
        return ExitCode::from(2);
    };
    let (src, entry) = match read(path) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
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
    let (named, packs, _) = match options(args) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let files = expand(&named);
    if files.is_empty() {
        if named.is_empty() {
            eprintln!("{}", help::of("check").unwrap());
        } else {
            eprintln!("{}: no MKP files (.mkp or .mkp.md) in it", named.join(", "));
        }
        return ExitCode::from(2);
    }
    let (mut failed, mut unread) = (false, 0);
    let (mut errors, mut warnings, mut with_errors) = (0, 0, 0);
    let base = mkp_check::compile_core(&core_sources());
    for path in &files {
        let (src, _) = match read(path) {
            Ok(x) => x,
            Err(e) => {
                if json {
                    out::line(serde_json::json!({ "type": "file", "file": path, "result": "not read", "why": e }));
                } else {
                    out::note(&e);
                }
                unread += 1;
                continue;
            }
        };
        // each file with core and the packs: a document, or a pack's file with the rest of its pack
        // and the surfaces it has released
        let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
        let mut packs = without(&packs, path);
        if module == "main" {
            let mut seen: std::collections::HashSet<std::path::PathBuf> = packs.iter().filter_map(|s| std::fs::canonicalize(&s.path).ok()).collect();
            packs.extend(released_surfaces(path).into_iter().filter(|s| std::fs::canonicalize(&s.path).map_or(true, |p| seen.insert(p))));
            packs = without(&packs, path);
        }
        let mut c = mkp_check::compile_on(&base, &[packs.clone()], &[mkp_check::Source { path: path.to_string(), text: src.clone() }], module);
        missing_packs(&mut c);
        failed |= c.module.is_none();
        // a pack's migrations: each example run through its block, once the file compiles
        if c.module.is_some() && module == "main" {
            crate::migrate_step::NO_ASKING.store(true, std::sync::atomic::Ordering::Relaxed);
            for d in examples::check(&base, path, &src, &packs) {
                failed = true;
                c.diagnostics.push(mkp_check::Found { file: path.to_string(), diagnostic: d });
            }
        }
        // a document 0.3 reads as plain Markdown, written for 0.2
        if module == "doc" {
            if let Some(d) = written_for_02(&src) {
                c.diagnostics.insert(0, mkp_check::Found { file: path.to_string(), diagnostic: d });
            }
        }
        // this file's errors and warnings, and any pack's errors
        let (mut e, mut w) = (0, 0);
        for found in c.diagnostics.iter().filter(|d| d.file == *path || d.diagnostic.is_error()) {
            let (file, d) = (&found.file, &found.diagnostic);
            let text = c.texts.get(file.as_str()).map(String::as_str).unwrap_or(src.as_str());
            if d.is_error() {
                e += 1;
            } else {
                w += 1;
            }
            if json {
                out::line(out::diagnostic(file, text, d));
            } else {
                // what check reports is its diagnostics: with --out, they go to the file
                out::note(&d.render(file, text));
            }
        }
        let levels = c.module.as_ref().filter(|_| module == "doc").map(levels_of);
        if json {
            let mut v = serde_json::json!({ "type": "file", "file": path, "result": if e > 0 { "errors" } else if w > 0 { "warnings" } else { "clean" }, "errors": e, "warnings": w });
            if let Some(l) = &levels {
                v["levels"] = serde_json::json!(l);
            }
            out::line(v);
        } else {
            let verdict = if e + w == 0 { "clean".to_string() } else { format!("{}, {}", plural(e, "error"), plural(w, "warning")) };
            let needs = levels.as_ref().filter(|l| !l.is_empty()).map_or(String::new(), |l| format!("; needs {}", l.join(", ")));
            out::note(&format!("{}: {}{}", path, verdict, needs));
        }
        with_errors += usize::from(e > 0);
        errors += e;
        warnings += w;
    }
    let code: u8 = if unread > 0 { 2 } else if failed { 1 } else { 0 };
    if json {
        out::line(serde_json::json!({ "type": "summary", "files": files.len(), "errors": errors, "warnings": warnings, "with_errors": with_errors, "unreadable": unread, "exit": code }));
    } else if files.len() > 1 {
        let read_note = if unread > 0 { format!(", {} not read", unread) } else { String::new() };
        out::note(&format!("{}: {} with errors, {} without{}; {}, {}", plural(files.len(), "file"), with_errors, files.len() - with_errors - unread, read_note, plural(errors, "error"), plural(warnings, "warning")));
    }
    ExitCode::from(code)
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
    if let Err(c) = one_file("md", &files) {
        return c;
    }
    let Some(path) = files.first() else {
        eprintln!("{}", help::of("md").unwrap());
        return ExitCode::from(2);
    };
    let text = match read(path) {
        Ok((t, _)) => t,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
    let mut c = mkp_check::compile(&core_sources(), &[without(&packs, path)], &[mkp_check::Source { path: path.clone(), text }], module);
    missing_packs(&mut c);
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
            if let Err(e) = out::write_file(&o, written) {
                eprintln!("{}", e);
                return ExitCode::from(1);
            }
        }
        None => out::print(&written),
    }
    ExitCode::SUCCESS
}

/// The commands, as `mkp help` names them.
const COMMANDS: &[&str] = &["fmt", "check", "parse", "build", "md", "surface", "migrate", "target check"];

/// Flags written before the command (`mkp --format json check …`), moved to after it, where each
/// command reads them.
fn command_first(args: Vec<String>) -> Vec<String> {
    let mut lead = Vec::new();
    let mut k = 0;
    while k < args.len() && flags::is_flag(&args[k]) && !matches!(args[k].as_str(), "--help" | "--version") {
        lead.push(args[k].clone());
        if flags::VALUED.contains(&args[k].as_str()) {
            if let Some(v) = args.get(k + 1) {
                lead.push(v.clone());
                k += 1;
            }
        }
        k += 1;
    }
    if lead.is_empty() || k >= args.len() {
        return args;
    }
    let n = if args[k] == "target" && args.get(k + 1).map(String::as_str) == Some("check") { 2 } else { 1 };
    let mut out: Vec<String> = args[k..k + n].to_vec();
    out.extend(lead);
    out.extend(args[k + n..].iter().cloned());
    out
}

fn run(args: &[String]) -> ExitCode {
    match args.first().map(String::as_str) {
        None | Some("--help") => {
            out::text(help::TOP);
            return ExitCode::SUCCESS;
        }
        Some("help") => {
            let name = args[1..].join(" ");
            if name.is_empty() {
                out::text(help::TOP);
                return ExitCode::SUCCESS;
            }
            let Some(h) = help::of(&name) else {
                eprintln!("mkp has no command {}: the commands are {}", name, COMMANDS.join(", "));
                return ExitCode::from(2);
            };
            out::text(h);
            return ExitCode::SUCCESS;
        }
        Some("--version") => {
            out::text(&format!("mkp {} (MKP 0.3; resolved IR: rir 1)", migrate::RELEASE));
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    let (cmd, rest) = match args[0].as_str() {
        "target" if args.get(1).map(String::as_str) == Some("check") => ("target check", &args[2..]),
        "target" if args.get(1).map(String::as_str) == Some("--help") => ("target check", &args[1..]),
        c => (c, &args[1..]),
    };
    if !COMMANDS.contains(&cmd) {
        if flags::is_flag(cmd) {
            eprintln!("mkp: {} isn't a command; a flag goes with one: mkp <command> {} …", cmd, cmd);
        } else if cmd == "target" {
            eprintln!("mkp target has one command: mkp target check [target…]");
        } else {
            eprintln!("mkp has no command {}: the commands are {}", cmd, COMMANDS.join(", "));
        }
        eprintln!("{}", help::TOP);
        return ExitCode::from(2);
    }
    // --help: the command's own usage, and nothing run
    if rest.iter().any(|a| a == "--help") {
        out::text(help::of(cmd).unwrap());
        return ExitCode::SUCCESS;
    }
    // each command's flags: an unknown one is ignored with a warning, a dropped one stops it
    let (unknown, ok) = flags::check(cmd, rest);
    if !ok {
        return ExitCode::from(2);
    }
    let json = match json_or_exit(rest) {
        Ok(j) => j,
        Err(c) => return c,
    };
    for f in &unknown {
        let w = flags::warning(cmd, f);
        if json {
            eprintln!("{}", serde_json::json!({ "type": "warning", "code": "flag.unknown", "flag": f, "message": w }));
        } else {
            eprintln!("warning: {}", w);
        }
    }
    // a run that would write the person's files writes nothing with a flag it doesn't know
    if !unknown.is_empty() && flags::writes(cmd, rest) {
        eprintln!("Nothing written: mkp {} doesn't know {}, so it stops before writing any file. Correct it and run it again.", cmd, unknown.join(", "));
        return ExitCode::from(2);
    }
    // --out: build, md and surface write their document there; the rest, what they print
    if !matches!(cmd, "build" | "md" | "surface") {
        if let Some(p) = out::out_path(rest) {
            out::to_file(&p);
        }
    }
    match cmd {
        "fmt" => fmt(rest),
        "parse" => parse_cmd(rest),
        "check" => check(rest),
        "build" => build(rest),
        "md" => md(rest),
        "surface" => surface::surface_cmd(rest),
        "migrate" => migrate::migrate_cmd(rest),
        _ => target::target_check(rest),
    }
}

fn main() -> ExitCode {
    let args = command_first(std::env::args().skip(1).collect());
    let code = run(&args);
    out::finish(code)
}
