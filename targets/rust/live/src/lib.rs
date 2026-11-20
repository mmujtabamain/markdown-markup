//! What a real-time Extended Mark target embeds: the compiler, with core compiled once when it is made, which
//! builds a document's text (and the packs it uses, as text) into the IR `xtmd build` writes; and
//! [`Live`], a text followed as it is edited, which keeps the last IR that compiled while a draft
//! has errors. The run-time targets don't depend on this crate: an app that only draws pages it was
//! given carries no compiler.
//!
//! xtmd-egui-live and xtmd-android-live link it into the app; xtmd-wasm wraps it for the browser.

use std::collections::BTreeMap;

use xtmd_check::Checker;
use xtmd_syntax::Lines;
use serde::Serialize;

pub use xtmd_check::Source;
pub use xtmd_ir::ir;
pub use xtmd_syntax::Severity;

include!(concat!(env!("OUT_DIR"), "/core.rs"));

/// A line and a column, from 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Place {
    pub line: u32,
    pub column: u32,
}

/// A diagnostic, as `xtmd check --format json` writes one.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnostic {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub file: String,
    pub code: String,
    pub severity: Severity,
    pub line: u32,
    pub column: u32,
    pub end: Place,
    pub message: String,
    pub fix: Option<String>,
    /// The fix as edits, where there is exactly one right one: a place and what to write there.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<Edit>,
}

/// One edit of a diagnostic's fix: `text` in place of what is between `at` and `end`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Edit {
    pub line: u32,
    pub column: u32,
    pub end: Place,
    pub text: String,
}

impl Diagnostic {
    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }

    /// `file:line:column: message`, as a target shows a draft's first error.
    pub fn located(&self) -> String {
        format!("{}:{}:{}: {}", self.file, self.line, self.column, self.message)
    }
}

/// Where a call is written: its first line and column, and where it ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Written {
    pub line: u32,
    pub column: u32,
    pub end: Place,
}

/// What a build gives: the IR, or none when there are errors; the file's own diagnostics, and the
/// errors of the packs it uses; how many errors in all; and where each call in the file is written,
/// by its template and site, so an editor can mark the call a failed widget's site names. No IR
/// holds that: a page runs without its source. With [`BuildOptions::rir`], the resolved IR too.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Built {
    pub ir: Option<ir::File>,
    pub diagnostics: Vec<Diagnostic>,
    pub errors: usize,
    pub sites: BTreeMap<String, BTreeMap<String, Written>>,
    /// The resolved IR (schemas/rir.schema.json), as `xtmd build --rir` writes it, when asked: for
    /// an editor, so it is written for a text with errors too, with what was resolved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rir: Option<serde_json::Value>,
}

/// What else a build gives, for an editor.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BuildOptions {
    /// The resolved IR, in [`Built::rir`].
    pub rir: bool,
    /// Core's own files in the resolved IR, resolved too: what an editor completes and goes to.
    pub core: bool,
}

/// What formatting a text gives: its canonical layout (`xtmd fmt`'s), or the syntax errors that
/// stop it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Formatted {
    pub text: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
}

impl Built {
    /// As JSON, `{ "ir", "diagnostics", "errors", "sites" }`: the IR as `xtmd build` writes it, on one line.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|e| format!("{{\"ir\":null,\"diagnostics\":[],\"errors\":1,\"sites\":{{}},\"why\":{:?}}}", e.to_string()))
    }
}

/// The compiler, with core compiled: make it once (that is the slow part) and build every text with it.
pub struct Compiler {
    base: Checker,
    /// Core compiled again with its names' resolutions kept, the first time a resolved IR with
    /// core's files is asked for.
    logged: std::sync::OnceLock<Checker>,
}

impl Default for Compiler {
    fn default() -> Self {
        Self::new()
    }
}

impl Compiler {
    /// Compiles core, from the sources embedded in this library.
    pub fn new() -> Compiler {
        Compiler { base: xtmd_check::compile_core(&core()), logged: std::sync::OnceLock::new() }
    }

    fn core_sources() -> Vec<Source> {
        core()
    }

    /// Core, compiled: what a tool built on the checker compiles on, as xtmd-migrate does.
    pub fn checker(&self) -> &xtmd_check::Checker {
        &self.base
    }

    /// Builds one file: `path` ending in `.xt.md` for a document, else a pack's file; its text;
    /// and the files of the packs it may use. The IR is the one `xtmd build` writes: every prop
    /// that isn't constant a binding, and a page's only what it uses.
    pub fn build(&self, path: &str, text: &str, packs: &[Source]) -> Built {
        self.build_with(path, text, packs, BuildOptions::default())
    }

    /// [`Compiler::build`], with the resolved IR when `opts` asks.
    pub fn build_with(&self, path: &str, text: &str, packs: &[Source], opts: BuildOptions) -> Built {
        let packs: Vec<Source> = packs.iter().filter(|p| p.path != path).cloned().collect();
        let module = if path.ends_with(".xt.md") { "doc" } else { "main" };
        let main = [Source { path: path.to_string(), text: text.to_string() }];
        let (c, rir) = if opts.rir {
            let base = if opts.core { self.logged.get_or_init(|| xtmd_check::compile_core_logged(&Self::core_sources())) } else { &self.base };
            xtmd_check::compile_rir_with(base, &[packs], &main, module, xtmd_check::RirOptions { core: opts.core, partial: true })
        } else {
            (xtmd_check::compile_on(&self.base, &[packs], &main, module), None)
        };
        let diagnostics = c
            .diagnostics
            .iter()
            .filter(|d| d.file == path || d.diagnostic.is_error())
            .map(|d| diagnostic(&d.file, c.texts.get(&d.file).map(String::as_str).unwrap_or(""), &d.diagnostic))
            .collect();
        let errors = c.diagnostics.iter().filter(|d| d.diagnostic.is_error()).count();
        let mut sites: BTreeMap<String, BTreeMap<String, Written>> = BTreeMap::new();
        let lines = Lines::new(text);
        for s in c.sites.iter().filter(|s| s.file == path) {
            let (at, end) = (lines.place(s.span.start), lines.place(s.span.end));
            sites.entry(s.template.clone()).or_default().insert(s.site.clone(), Written { line: at.line, column: at.column, end: Place { line: end.line, column: end.column } });
        }
        let ir = c.module.map(|mut m| {
            xtmd_lower::lower(&mut m);
            ir::File { ir: m }
        });
        Built { ir: if errors == 0 { ir } else { None }, diagnostics, errors, sites, rir }
    }

    /// `text` in the canonical layout, as `xtmd fmt` writes it: `path` says a document
    /// (`.xt.md`) or a pack's file (`.xtpack`). A text that doesn't read gives its syntax errors.
    pub fn format(&self, path: &str, text: &str) -> Formatted {
        let Some(entry) = xtmd_syntax::entry_for(path) else {
            let d = xtmd_syntax::Diagnostic::error("file.not-extended-mark", xtmd_syntax::Span { start: 0, end: 0 }, format!("{}: not an Extended Mark file (.xtpack or .xt.md)", path));
            return Formatted { text: None, diagnostics: vec![diagnostic(path, text, &d)] };
        };
        match xtmd_syntax::format(text, entry) {
            Ok(t) => Formatted { text: Some(t), diagnostics: Vec::new() },
            Err(ds) => Formatted { text: None, diagnostics: ds.iter().map(|d| diagnostic(path, text, d)).collect() },
        }
    }
}

/// Core's own files, as this library compiles them: `core/controls.xtpack` and the rest, with their
/// text, for an editor that shows core's declarations.
pub fn core() -> Vec<Source> {
    CORE.iter().map(|(p, t)| Source { path: p.to_string(), text: t.to_string() }).collect()
}

/// A diagnostic of `file`, whose text is `text`, as `xtmd check --format json` writes one.
fn diagnostic(file: &str, text: &str, d: &xtmd_syntax::Diagnostic) -> Diagnostic {
    let lines = Lines::new(text);
    let (at, end) = (lines.place(d.span.start), lines.place(d.span.end));
    Diagnostic {
        kind: "diagnostic",
        file: file.to_string(),
        code: d.code.to_string(),
        severity: d.severity,
        line: at.line,
        column: at.column,
        end: Place { line: end.line, column: end.column },
        message: d.message.clone(),
        fix: d.fix.clone(),
        edits: d
            .edits
            .iter()
            .map(|e| {
                let (a, b) = (lines.place(e.span.start), lines.place(e.span.end));
                Edit { line: a.line, column: a.column, end: Place { line: b.line, column: b.column }, text: e.text.clone() }
            })
            .collect(),
    }
}

/// What a new text did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Followed {
    /// The text the last build had: nothing was built.
    Same,
    /// It compiled: [`Live::ir`] is its IR now.
    Compiled,
    /// It has errors: [`Live::ir`] is still the last that compiled, and [`Live::diagnostics`] says why.
    Broken,
}

/// A document's text, followed as it is edited: a text that compiles replaces the IR, one that
/// doesn't leaves the last that did. When to give it a text (each key, a pause, a save) is the
/// app's.
#[derive(Clone, Debug)]
pub struct Live {
    path: String,
    packs: Vec<Source>,
    built: Option<(String, Vec<Source>)>,
    ir: Option<ir::File>,
    diagnostics: Vec<Diagnostic>,
    errors: usize,
    revision: u64,
}

impl Default for Live {
    fn default() -> Self {
        Live::new("page.xt.md")
    }
}

impl Live {
    /// A text to follow at `path` (`page.xt.md` for a document), for diagnostics and the module.
    pub fn new(path: &str) -> Live {
        Live { path: path.to_string(), packs: Vec::new(), built: None, ir: None, diagnostics: Vec::new(), errors: 0, revision: 0 }
    }

    /// The files of the packs the text uses, given with every build.
    pub fn with_packs(mut self, packs: Vec<Source>) -> Live {
        self.packs = packs;
        self
    }

    pub fn set_packs(&mut self, packs: Vec<Source>) {
        self.packs = packs;
    }

    /// Builds `text`, unless it and the packs are what the last build had.
    pub fn follow(&mut self, compiler: &Compiler, text: &str) -> Followed {
        if self.built.as_ref().is_some_and(|(t, p)| t == text && *p == self.packs) {
            return Followed::Same;
        }
        let b = compiler.build(&self.path, text, &self.packs);
        self.built = Some((text.to_string(), self.packs.clone()));
        self.diagnostics = b.diagnostics;
        self.errors = b.errors;
        match b.ir {
            Some(ir) => {
                self.ir = Some(ir);
                self.revision += 1;
                Followed::Compiled
            }
            None => Followed::Broken,
        }
    }

    /// The last IR that compiled, if one has.
    pub fn ir(&self) -> Option<&ir::File> {
        self.ir.as_ref()
    }

    /// Bumped at each text that compiled: a target starts its page again when it moves.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The latest text's diagnostics, warnings included.
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }

    /// The latest text's errors: 0 when it compiled.
    pub fn errors(&self) -> usize {
        self.errors
    }

    /// The latest text's errors as one line, as a target tells an app: `page.xt.md doesn't
    /// compile (1 error): page.xt.md:5:3: …`; none when it compiled.
    pub fn why(&self) -> Option<String> {
        if self.errors == 0 {
            return None;
        }
        let first = self.diagnostics.iter().find(|d| d.is_error()).map(Diagnostic::located).unwrap_or_else(|| "it has errors".into());
        Some(format!("{} doesn't compile ({} error{}): {}", self.path, self.errors, if self.errors == 1 { "" } else { "s" }, first))
    }
}
