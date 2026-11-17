//! `--format json`, the same on every command. A command that writes a document (build, md,
//! parse) prints that document, as JSON. A command that reports (check, fmt, surface, migrate,
//! target check) prints one JSON object per line, each with its `type`, and a `summary` last.
//! Diagnostics are JSON objects wherever they go, with the same fields everywhere.

use mkp_syntax::Diagnostic;
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
    let lines = mkp_syntax::Lines::new(text);
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

/// `--out`: where what a command prints goes, when it isn't standard output.
static SINK: std::sync::Mutex<Option<std::fs::File>> = std::sync::Mutex::new(None);

/// What the command prints from here on goes to `path`.
pub(crate) fn to_file(path: &str) -> Result<(), String> {
    let f = std::fs::File::create(path).map_err(|e| format!("--out {}: {}", path, e))?;
    *SINK.lock().unwrap() = Some(f);
    Ok(())
}

/// Whether `--out` took what the command prints.
pub(crate) fn to_a_file() -> bool {
    SINK.lock().unwrap().is_some()
}

/// What the command prints: to standard output, or the `--out` file.
pub(crate) fn print(s: &str) {
    use std::io::Write;
    match SINK.lock().unwrap().as_mut() {
        Some(f) => {
            let _ = f.write_all(s.as_bytes());
        }
        None => {
            print!("{}", s);
        }
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
