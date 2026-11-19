//! Extended Mark's real-time Android target, native side: [`NativeCompiler`], xtmd-live's compiler with core
//! compiled once, behind UniFFI (`xtmd.android.live.ffi`). Kotlin gives it a document's text and its
//! packs' files, and gets back the IR `xtmd build` writes, as JSON, with the diagnostics. Nothing
//! else crosses: xtmd-android's `XtmdDoc` runs the IR on xtmd-android's own library, so no object is
//! shared between the two.

uniffi::setup_scaffolding!();

use std::sync::{Arc, Mutex};

use xtmd_live::{Compiler, Source};

/// A file a pack is made of: its path, as its `package` and imports name it, and its text.
#[derive(Clone, Debug, uniffi::Record)]
pub struct PackFile {
    pub path: String,
    pub text: String,
}

/// A diagnostic, as `xtmd check --format json` writes one: lines and columns from 1.
#[derive(Clone, Debug, PartialEq, uniffi::Record)]
pub struct Diagnostic {
    pub file: String,
    pub code: String,
    /// `error` or `warning`.
    pub severity: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub message: String,
    pub fix: Option<String>,
}

/// What a build gives: the IR file as JSON, or none when there are errors; the file's own
/// diagnostics, and its packs' errors; how many errors; and the first one as a line.
#[derive(Clone, Debug, uniffi::Record)]
pub struct Built {
    pub ir_json: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
    pub errors: u32,
    /// `page.xt.md doesn't compile (1 error): page.xt.md:5:3: …`; none when it compiled.
    pub why: Option<String>,
}

/// The compiler lives on one thread at a time behind the lock; nothing of it is handed out.
struct Held(Compiler);
unsafe impl Send for Held {}

/// The compiler, with core compiled: make it once (the slow part, best off the main thread) and
/// build every text with it.
#[derive(uniffi::Object)]
pub struct NativeCompiler {
    inner: Mutex<Held>,
}

#[uniffi::export]
impl NativeCompiler {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(NativeCompiler { inner: Mutex::new(Held(Compiler::new())) })
    }

    /// Builds one file: `path` ending in `.xt.md` for a document, else a pack's file; its text;
    /// and the files of the packs it uses.
    pub fn build(&self, path: String, text: String, packs: Vec<PackFile>) -> Built {
        let packs: Vec<Source> = packs.into_iter().map(|p| Source { path: p.path, text: p.text }).collect();
        let b = self.inner.lock().unwrap_or_else(|e| e.into_inner()).0.build(&path, &text, &packs);
        let diagnostics: Vec<Diagnostic> = b
            .diagnostics
            .iter()
            .map(|d| Diagnostic {
                file: d.file.clone(),
                code: d.code.clone(),
                severity: if d.is_error() { "error".into() } else { "warning".into() },
                line: d.line,
                column: d.column,
                end_line: d.end.line,
                end_column: d.end.column,
                message: d.message.clone(),
                fix: d.fix.clone(),
            })
            .collect();
        let why = (b.errors > 0).then(|| {
            let first = b.diagnostics.iter().find(|d| d.is_error()).map(|d| d.located()).unwrap_or_else(|| "it has errors".into());
            format!("{} doesn't compile ({} error{}): {}", path, b.errors, if b.errors == 1 { "" } else { "s" }, first)
        });
        let ir_json = b.ir.as_ref().and_then(|ir| serde_json::to_string(ir).ok());
        Built { ir_json, diagnostics, errors: b.errors as u32, why }
    }
}
