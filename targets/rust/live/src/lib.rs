//! What a real-time MKP target embeds: the compiler, with core compiled once when it is made, which
//! builds a document's text (and the packs it uses, as text) into the IR `mkp build` writes; and
//! [`Live`], a text followed as it is edited, which keeps the last IR that compiled while a draft
//! has errors. The run-time targets don't depend on this crate: an app that only draws pages it was
//! given carries no compiler.
//!
//! mkp-egui-live and mkp-android-live link it into the app; mkp-wasm wraps it for the browser.

use std::collections::BTreeMap;

use mkp_check::Checker;
use mkp_syntax::Lines;
use serde::Serialize;

pub use mkp_check::Source;
pub use mkp_ir::ir;
pub use mkp_syntax::Severity;

include!(concat!(env!("OUT_DIR"), "/core.rs"));

/// A line and a column, from 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Place {
    pub line: u32,
    pub column: u32,
}

/// A diagnostic, as `mkp check --format json` writes one.
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
/// holds that: a page runs without its source.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Built {
    pub ir: Option<ir::File>,
    pub diagnostics: Vec<Diagnostic>,
    pub errors: usize,
    pub sites: BTreeMap<String, BTreeMap<String, Written>>,
}

impl Built {
    /// As JSON, `{ "ir", "diagnostics", "errors", "sites" }`: the IR as `mkp build` writes it, on one line.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|e| format!("{{\"ir\":null,\"diagnostics\":[],\"errors\":1,\"sites\":{{}},\"why\":{:?}}}", e.to_string()))
    }
}

/// The compiler, with core compiled: make it once (that is the slow part) and build every text with it.
pub struct Compiler {
    base: Checker,
}

impl Default for Compiler {
    fn default() -> Self {
        Self::new()
    }
}

impl Compiler {
    /// Compiles core, from the sources embedded in this library.
    pub fn new() -> Compiler {
        let core: Vec<Source> = CORE.iter().map(|(p, t)| Source { path: p.to_string(), text: t.to_string() }).collect();
        Compiler { base: mkp_check::compile_core(&core) }
    }

    /// Builds one file: `path` ending in `.mkp.md` for a document, else a pack's file; its text;
    /// and the files of the packs it may use. The IR is the one `mkp build` writes: every prop
    /// that isn't constant a binding, and a page's only what it uses.
    pub fn build(&self, path: &str, text: &str, packs: &[Source]) -> Built {
        let packs: Vec<Source> = packs.iter().filter(|p| p.path != path).cloned().collect();
        let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
        let c = mkp_check::compile_on(&self.base, &[packs], &[Source { path: path.to_string(), text: text.to_string() }], module);
        let diagnostics = c
            .diagnostics
            .iter()
            .filter(|d| d.file == path || d.diagnostic.is_error())
            .map(|d| {
                let text = c.texts.get(&d.file).map(String::as_str).unwrap_or("");
                let lines = Lines::new(text);
                let (at, end) = (lines.place(d.diagnostic.span.start), lines.place(d.diagnostic.span.end));
                Diagnostic {
                    kind: "diagnostic",
                    file: d.file.clone(),
                    code: d.diagnostic.code.to_string(),
                    severity: d.diagnostic.severity,
                    line: at.line,
                    column: at.column,
                    end: Place { line: end.line, column: end.column },
                    message: d.diagnostic.message.clone(),
                    fix: d.diagnostic.fix.clone(),
                }
            })
            .collect();
        let errors = c.diagnostics.iter().filter(|d| d.diagnostic.is_error()).count();
        let mut sites: BTreeMap<String, BTreeMap<String, Written>> = BTreeMap::new();
        let lines = Lines::new(text);
        for s in c.sites.iter().filter(|s| s.file == path) {
            let (at, end) = (lines.place(s.span.start), lines.place(s.span.end));
            sites.entry(s.template.clone()).or_default().insert(s.site.clone(), Written { line: at.line, column: at.column, end: Place { line: end.line, column: end.column } });
        }
        let ir = c.module.map(|mut m| {
            mkp_lower::lower(&mut m);
            ir::File { ir: m }
        });
        Built { ir: if errors == 0 { ir } else { None }, diagnostics, errors, sites }
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
        Live::new("page.mkp.md")
    }
}

impl Live {
    /// A text to follow at `path` (`page.mkp.md` for a document), for diagnostics and the module.
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

    /// The latest text's errors as one line, as a target tells an app: `page.mkp.md doesn't
    /// compile (1 error): page.mkp.md:5:3: …`; none when it compiled.
    pub fn why(&self) -> Option<String> {
        if self.errors == 0 {
            return None;
        }
        let first = self.diagnostics.iter().find(|d| d.is_error()).map(Diagnostic::located).unwrap_or_else(|| "it has errors".into());
        Some(format!("{} doesn't compile ({} error{}): {}", self.path, self.errors, if self.errors == 1 { "" } else { "s" }, first))
    }
}
