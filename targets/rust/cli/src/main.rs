//! The `mkp` command.

use std::process::ExitCode;

use mkp_syntax::{entry_for, format, parse, Diagnostic};

include!(concat!(env!("OUT_DIR"), "/core.rs"));

fn core_sources() -> Vec<mkp_check::Source> {
    CORE.iter().map(|(p, t)| mkp_check::Source { path: p.to_string(), text: t.to_string() }).collect()
}

/// `mkp build doc.mkp.md [-o out.ir.json]`: the IR, with core and nothing else for now.
fn build(args: &[String]) -> ExitCode {
    let mut out = None;
    let mut files = Vec::new();
    let mut k = 0;
    while k < args.len() {
        if args[k] == "-o" {
            out = args.get(k + 1).cloned();
            k += 2;
            continue;
        }
        files.push(args[k].clone());
        k += 1;
    }
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
    let c = mkp_check::compile(&core_sources(), &[], &[mkp_check::Source { path: path.clone(), text }], module);
    for d in &c.diagnostics {
        if d.file == *path || d.diagnostic.is_error() {
            eprintln!("{}", d.diagnostic.render(&d.file, &c.texts[&d.file]));
        }
    }
    let Some(m) = c.module else { return ExitCode::from(1) };
    let json = serde_json::to_string_pretty(&mkp_ir::ir::File { ir: m }).unwrap();
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
  mkp fmt [--check] <file>...      print each file back in the canonical layout (in place, or check only)
  mkp check [--json] <file>...      report every error and warning in each file
  mkp parse <file>                  print a file's syntax tree as JSON
  mkp build <file> [-o out.ir.json] write a document's IR";

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
    let files: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if files.is_empty() {
        eprintln!("{}", USAGE);
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
            Ok(out) if out == src => {}
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
    let files: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if files.is_empty() {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    }
    let mut failed = false;
    let mut all = Vec::new();
    for path in files {
        let (src, entry) = match read(path) {
            Ok(x) => x,
            Err(e) => {
                eprintln!("{}", e);
                failed = true;
                continue;
            }
        };
        let parsed = parse(&src, entry);
        failed |= parsed.has_errors();
        if json {
            let lines = mkp_syntax::Lines::new(&src);
            for d in &parsed.diagnostics {
                let at = lines.place(d.span.start);
                let end = lines.place(d.span.end);
                all.push(serde_json::json!({
                    "file": path, "code": d.code, "severity": d.severity, "line": at.line, "column": at.column,
                    "end": {"line": end.line, "column": end.column}, "message": d.message, "fix": d.fix,
                }));
            }
        } else {
            report(path, &src, &parsed.diagnostics);
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

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("fmt") => fmt(&args[1..]),
        Some("parse") => parse_cmd(&args[1..]),
        Some("check") => check(&args[1..]),
        Some("build") => build(&args[1..]),
        _ => {
            eprintln!("{}", USAGE);
            ExitCode::from(2)
        }
    }
}
