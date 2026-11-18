//! The MKP compiler for the browser: what `mkp build` does, on a core compiled once when the
//! compiler is made. A real-time target compiles a document's text as it is edited, and draws the
//! IR as a run-time target draws one it was given; the IR is the same as the binary's, byte for
//! byte (the tests hold it to that).
//!
//! Built for `wasm32-wasip1`, whose C library decNumber needs, it gives the page four plain
//! functions (`abi` below) and no generated glue: @mkp/wasm's loader is the whole of the JS side.

use mkp_check::{Checker, Source};
use mkp_syntax::{Diagnostic, Lines};
use serde_json::{json, Value};

include!(concat!(env!("OUT_DIR"), "/core.rs"));

/// The compiler, with core compiled: make it once and build every document with it.
pub struct Compiler {
    base: Checker,
}

/// A diagnostic as `mkp check --format json` writes one.
fn diagnostic(file: &str, text: &str, d: &Diagnostic) -> Value {
    let lines = Lines::new(text);
    let (at, end) = (lines.place(d.span.start), lines.place(d.span.end));
    json!({
        "type": "diagnostic", "file": file, "code": d.code, "severity": d.severity, "line": at.line, "column": at.column,
        "end": { "line": end.line, "column": end.column }, "message": d.message, "fix": d.fix,
    })
}

impl Default for Compiler {
    fn default() -> Self {
        Self::new()
    }
}

impl Compiler {
    /// Compiles core: the slow part, done once.
    pub fn new() -> Compiler {
        let core: Vec<Source> = CORE.iter().map(|(p, t)| Source { path: p.to_string(), text: t.to_string() }).collect();
        Compiler { base: mkp_check::compile_core(&core) }
    }

    /// Builds one file: its path (`page.mkp.md` for a document, else a pack's file), its text, and the
    /// packs it may use as JSON, `[{ "path", "text" }]`. Gives JSON: `{ "ir": the IR file or null,
    /// "diagnostics": [...], "errors": n }`, the IR as `mkp build` writes it, but on one line.
    pub fn build(&self, path: &str, text: &str, packs: &str) -> String {
        let packs: Vec<Source> = serde_json::from_str::<Vec<Value>>(packs)
            .unwrap_or_default()
            .iter()
            .filter_map(|p| Some(Source { path: p.get("path")?.as_str()?.to_string(), text: p.get("text")?.as_str()?.to_string() }))
            .filter(|p| p.path != path)
            .collect();
        let module = if path.ends_with(".mkp.md") { "doc" } else { "main" };
        let c = mkp_check::compile_on(&self.base, &[packs], &[Source { path: path.to_string(), text: text.to_string() }], module);
        let diagnostics: Vec<Value> = c
            .diagnostics
            .iter()
            .filter(|d| d.file == path || d.diagnostic.is_error())
            .map(|d| diagnostic(&d.file, c.texts.get(&d.file).map(String::as_str).unwrap_or(""), &d.diagnostic))
            .collect();
        let errors = c.diagnostics.iter().filter(|d| d.diagnostic.is_error()).count();
        let ir = c.module.map_or_else(
            || "null".to_string(),
            |mut m| {
                // as `mkp build` writes it: every prop that isn't constant a binding, and only what the page uses
                mkp_lower::lower(&mut m);
                serde_json::to_string(&mkp_ir::ir::File { ir: m }).unwrap_or_else(|_| "null".into())
            },
        );
        // the IR written as it is, its fields in the binary's order
        format!("{{\"ir\":{},\"diagnostics\":{},\"errors\":{}}}", ir, Value::Array(diagnostics), errors)
    }
}

/// What the page calls: a request's bytes written into memory the module gives, a reply read back.
#[cfg(target_arch = "wasm32")]
mod abi {
    use super::Compiler;
    use serde_json::Value;
    use std::alloc::{alloc, dealloc, Layout};

    fn layout(len: usize) -> Layout {
        Layout::array::<u8>(len.max(1)).unwrap()
    }

    /// `len` bytes for the page to write a request into.
    #[no_mangle]
    pub extern "C" fn mkp_alloc(len: usize) -> *mut u8 {
        unsafe { alloc(layout(len)) }
    }

    /// Gives back `len` bytes that `mkp_alloc` or `mkp_build` gave.
    #[no_mangle]
    pub extern "C" fn mkp_free(ptr: *mut u8, len: usize) {
        unsafe { dealloc(ptr, layout(len)) }
    }

    /// A compiler, with core compiled.
    #[no_mangle]
    pub extern "C" fn mkp_new() -> *mut Compiler {
        Box::into_raw(Box::new(Compiler::new()))
    }

    /// Builds the request at `ptr` (JSON: `{ "path", "text", "packs": [{ "path", "text" }] }`), and
    /// gives the reply's place: its length in the first four bytes (little-endian), then its JSON;
    /// the page frees the reply's 4 + length bytes.
    #[no_mangle]
    pub extern "C" fn mkp_build(c: *const Compiler, ptr: *const u8, len: usize) -> *mut u8 {
        let req: Value = serde_json::from_slice(unsafe { std::slice::from_raw_parts(ptr, len) }).unwrap_or(Value::Null);
        let field = |k: &str| req.get(k).and_then(Value::as_str).unwrap_or("");
        let packs = req.get("packs").map(Value::to_string).unwrap_or_else(|| "[]".into());
        let reply = unsafe { &*c }.build(field("path"), field("text"), &packs).into_bytes();
        let out = mkp_alloc(4 + reply.len());
        unsafe {
            std::ptr::copy_nonoverlapping((reply.len() as u32).to_le_bytes().as_ptr(), out, 4);
            std::ptr::copy_nonoverlapping(reply.as_ptr(), out.add(4), reply.len());
        }
        out
    }

    /// decNumber's traps raise a signal; MKP sets none, and wasm has no signals to raise
    #[no_mangle]
    pub extern "C" fn raise(_sig: i32) -> i32 {
        0
    }
}
