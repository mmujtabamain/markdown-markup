//! `--format json`, the same on every command. A command that writes a document (build, md,
//! parse) prints that document, as JSON. A command that reports (check, fmt, surface, migrate,
//! target check) prints one JSON object per line, each with its `type`, and a `summary` last.
//! Diagnostics are JSON objects wherever they go, with the same fields everywhere.

use xtmd_syntax::Diagnostic;
use serde_json::{json, Value};

/// `--format json`, or `--format text` (the default); anything else is a usage error.
pub(crate) fn wants_json(args: &[String]) -> Result<bool, String> {
    let mut json = false;
    let mut k = 0;
    while k < args.len() {
        let value = if args[k] == "--format" {
            k += 1;
            args.get(k).map(String::as_str)
        } else if let Some(v) = args[k].strip_prefix("--format=") {
            Some(v)
        } else {
            k += 1;
            continue;
        };
        match value {
            Some("json") => json = true,
            Some("text") => json = false,
            _ => return Err("--format takes json or text".into()),
        }
        k += 1;
    }
    Ok(json)
}

/// A diagnostic as JSON: its file, code and severity, where it starts and ends by line and column,
/// its message and its fix.
pub(crate) fn diagnostic(file: &str, text: &str, d: &Diagnostic) -> Value {
    let lines = xtmd_syntax::Lines::new(text);
    let (at, end) = (lines.place(d.span.start), lines.place(d.span.end));
    json!({
        "type": "diagnostic", "file": file, "code": d.code, "severity": d.severity, "line": at.line, "column": at.column,
        "end": { "line": end.line, "column": end.column }, "message": d.message, "fix": d.fix,
    })
}

/// One line of a report.
pub(crate) fn line(v: Value) {
    print(&format!("{}\n", v));
}

/// `--out`: the file what a command prints goes to, and what it has printed so far. It is written
/// when the command ends, so one that stops at a usage error leaves the file as it was.
static SINK: std::sync::Mutex<Option<(String, Vec<u8>)>> = std::sync::Mutex::new(None);

/// What the command prints from here on goes to `path`, once it ends.
pub(crate) fn to_file(path: &str) {
    *SINK.lock().unwrap() = Some((path.to_string(), Vec::new()));
}

/// Whether `--out` took what the command prints.
pub(crate) fn to_a_file() -> bool {
    SINK.lock().unwrap().is_some()
}

/// The command has ended with `code`: what it printed goes to the `--out` file, unless it stopped at
/// a usage error (2) before printing anything, when the file is left as it was.
pub(crate) fn finish(code: std::process::ExitCode) -> std::process::ExitCode {
    let Some((path, text)) = SINK.lock().unwrap().take() else { return code };
    if code == std::process::ExitCode::from(2) && text.is_empty() {
        return code;
    }
    match write_file(&path, &text) {
        Ok(()) => code,
        Err(e) => {
            eprintln!("--out {}", e);
            std::process::ExitCode::from(2)
        }
    }
}

/// A file written, its folder made first when it isn't there.
pub(crate) fn write_file(path: &str, text: impl AsRef<[u8]>) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if let Some(dir) = p.parent().filter(|d| !d.as_os_str().is_empty() && !d.exists()) {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: can't make its folder {}: {}", path, dir.display(), e))?;
    }
    std::fs::write(p, text).map_err(|e| format!("{}: {}", path, e))
}

/// What the command prints: to standard output, or the `--out` file.
pub(crate) fn print(s: &str) {
    use std::io::Write;
    match SINK.lock().unwrap().as_mut() {
        Some((_, buf)) => buf.extend_from_slice(s.as_bytes()),
        None => {
            // a pipe closed early (`xtmd build … | head`) ends xtmd quietly, as SIGPIPE ends a C
            // program, and with its exit code
            if let Err(e) = std::io::stdout().write_all(s.as_bytes()) {
                if e.kind() == std::io::ErrorKind::BrokenPipe {
                    std::process::exit(141);
                }
            }
        }
    }
}

/// A line for a person, beside what the command prints: on standard error, or with `--out` in the
/// file with the rest.
pub(crate) fn note(s: &str) {
    if to_a_file() {
        text(s);
    } else {
        eprintln!("{}", s);
    }
}

/// A line of text the command prints.
pub(crate) fn text(s: &str) {
    print(&format!("{}\n", s));
}

/// The value after `--out` (or in `--out=…`), if the arguments give one.
pub(crate) fn out_path(args: &[String]) -> Option<String> {
    args.iter().position(|a| a == "--out").and_then(|k| args.get(k + 1).cloned()).or_else(|| args.iter().find_map(|a| a.strip_prefix("--out=").map(str::to_string)))
}

