//! The Extended Mark compiler for the browser: what `xtmd build` does, on a core compiled once when the
//! compiler is made. A real-time target compiles a document's text as it is edited, and draws the
//! IR as a run-time target draws one it was given; the IR is the binary's (@extended-mark/wasm's tests hold
//! it to that on every conformance case). The compiler itself is xtmd-live's.
//!
//! For an editor it does what `xtmd md` and `xtmd migrate` do too, on the texts the editor gives, so
//! an editor needs no xtmd binary.
//!
//! Built for `wasm32-wasip1`, whose C library decNumber needs, it gives the page nine plain
//! functions (`abi` below) and no generated glue: @extended-mark/wasm's loader is the whole of the JS side.

mod migrate;

pub use migrate::migrate_json;
pub use xtmd_live::{BuildOptions, Built, Compiler, Formatted, Source};
use serde_json::{json, Value};

/// Builds as the page asks: `packs` a JSON list, `[{ "path", "text" }]`. Gives the reply's JSON,
/// `{ "ir": the IR file or null, "diagnostics": [...], "errors": n, "sites": {...} }`, and `"rir"`
/// when `opts` asks for the resolved IR.
pub fn build_json(c: &Compiler, path: &str, text: &str, packs: &str, opts: BuildOptions) -> String {
    let packs: Vec<Source> = serde_json::from_str::<Vec<Value>>(packs)
        .unwrap_or_default()
        .iter()
        .filter_map(|p| Some(Source { path: p.get("path")?.as_str()?.to_string(), text: p.get("text")?.as_str()?.to_string() }))
        .collect();
    c.build_with(path, text, &packs, opts).to_json()
}

/// Formats as the page asks. Gives the reply's JSON, `{ "text": the canonical text or null,
/// "diagnostics": [...] }`.
pub fn format_json(c: &Compiler, path: &str, text: &str) -> String {
    let f: Formatted = c.format(path, text);
    serde_json::to_string(&f).unwrap_or_else(|e| format!("{{\"text\":null,\"diagnostics\":[],\"why\":{:?}}}", e.to_string()))
}

/// A document's Markdown, as `xtmd md` writes it: the page as it reads when it first loads. Gives the
/// reply's JSON, `{ "markdown": the text or null, "diagnostics": [...], "errors": n }`; a document that
/// doesn't compile has no Markdown, and its errors say why.
pub fn markdown_json(c: &Compiler, path: &str, text: &str, packs: &str) -> String {
    let packs: Vec<Source> = serde_json::from_str::<Vec<Value>>(packs)
        .unwrap_or_default()
        .iter()
        .filter_map(|p| Some(Source { path: p.get("path")?.as_str()?.to_string(), text: p.get("text")?.as_str()?.to_string() }))
        .collect();
    let b = c.build(path, text, &packs);
    let markdown = b.ir.as_ref().map(|f| xtmd_markdown::page(&f.ir).map(|blocks| xtmd_markdown::write_page(f.ir.front_matter.as_deref(), &blocks)));
    let (markdown, why) = match markdown {
        Some(Ok(m)) => (Some(m), None),
        Some(Err(e)) => (None, Some(format!("{}: writing its Markdown failed: {}", path, e.0))),
        None => (None, None),
    };
    json!({ "markdown": markdown, "diagnostics": b.diagnostics, "errors": b.errors, "why": why }).to_string()
}

/// What the page calls: a request's bytes written into memory the module gives, a reply read back.
#[cfg(target_arch = "wasm32")]
mod abi {
    use super::{build_json, format_json, markdown_json, migrate_json, BuildOptions, Compiler};
    use xtmd_lsp::Server;
    use serde_json::Value;
    use std::alloc::{alloc, dealloc, Layout};

    fn layout(len: usize) -> Layout {
        Layout::array::<u8>(len.max(1)).unwrap()
    }

    /// `len` bytes for the page to write a request into.
    #[no_mangle]
    pub extern "C" fn xtmd_alloc(len: usize) -> *mut u8 {
        unsafe { alloc(layout(len)) }
    }

    /// Gives back `len` bytes that `xtmd_alloc` or `xtmd_build` gave.
    #[no_mangle]
    pub extern "C" fn xtmd_free(ptr: *mut u8, len: usize) {
        unsafe { dealloc(ptr, layout(len)) }
    }

    /// A compiler, with core compiled.
    #[no_mangle]
    pub extern "C" fn xtmd_new() -> *mut Compiler {
        Box::into_raw(Box::new(Compiler::new()))
    }

    fn request(ptr: *const u8, len: usize) -> Value {
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(ptr, len) }).unwrap_or(Value::Null)
    }

    /// A reply's place: its length in the first four bytes (little-endian), then its JSON; the page
    /// frees the reply's 4 + length bytes.
    fn reply(json: String) -> *mut u8 {
        let reply = json.into_bytes();
        let out = xtmd_alloc(4 + reply.len());
        unsafe {
            std::ptr::copy_nonoverlapping((reply.len() as u32).to_le_bytes().as_ptr(), out, 4);
            std::ptr::copy_nonoverlapping(reply.as_ptr(), out.add(4), reply.len());
        }
        out
    }

    /// Builds the request at `ptr` (JSON: `{ "path", "text", "packs": [{ "path", "text" }],
    /// "rir": bool, "core": bool }`), and gives the reply's place.
    #[no_mangle]
    pub extern "C" fn xtmd_build(c: *const Compiler, ptr: *const u8, len: usize) -> *mut u8 {
        let req = request(ptr, len);
        let field = |k: &str| req.get(k).and_then(Value::as_str).unwrap_or("");
        let flag = |k: &str| req.get(k).and_then(Value::as_bool).unwrap_or(false);
        let packs = req.get("packs").map(Value::to_string).unwrap_or_else(|| "[]".into());
        let opts = BuildOptions { rir: flag("rir"), core: flag("core") };
        reply(build_json(unsafe { &*c }, field("path"), field("text"), &packs, opts))
    }

    /// Formats the request at `ptr` (JSON: `{ "path", "text" }`), and gives the reply's place.
    #[no_mangle]
    pub extern "C" fn xtmd_format(c: *const Compiler, ptr: *const u8, len: usize) -> *mut u8 {
        let req = request(ptr, len);
        let field = |k: &str| req.get(k).and_then(Value::as_str).unwrap_or("");
        reply(format_json(unsafe { &*c }, field("path"), field("text")))
    }

    /// The Markdown of the request at `ptr` (JSON: `{ "path", "text", "packs": [{ "path", "text" }] }`),
    /// and gives the reply's place.
    #[no_mangle]
    pub extern "C" fn xtmd_markdown(c: *const Compiler, ptr: *const u8, len: usize) -> *mut u8 {
        let req = request(ptr, len);
        let field = |k: &str| req.get(k).and_then(Value::as_str).unwrap_or("");
        let packs = req.get("packs").map(Value::to_string).unwrap_or_else(|| "[]".into());
        reply(markdown_json(unsafe { &*c }, field("path"), field("text"), &packs))
    }

    /// Plans the migration the request at `ptr` asks for (see `migrate_json`), and gives the reply's
    /// place.
    #[no_mangle]
    pub extern "C" fn xtmd_migrate(c: *const Compiler, ptr: *const u8, len: usize) -> *mut u8 {
        reply(migrate_json(unsafe { &*c }, &request(ptr, len)))
    }

    /// A language server, with its own compiler and core.
    #[no_mangle]
    pub extern "C" fn xtmd_lsp_new() -> *mut Server {
        Box::into_raw(Box::new(Server::new()))
    }

    /// One message from the client at `ptr` (the protocol's JSON); gives the reply's place: a JSON
    /// list of what the server sends back, in order.
    #[no_mangle]
    pub extern "C" fn xtmd_lsp(s: *mut Server, ptr: *const u8, len: usize) -> *mut u8 {
        let msg = request(ptr, len);
        let out = unsafe { &mut *s }.handle(&msg);
        reply(Value::Array(out).to_string())
    }

    /// decNumber's traps raise a signal; Extended Mark sets none, and wasm has no signals to raise
    #[no_mangle]
    pub extern "C" fn raise(_sig: i32) -> i32 {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_s_markdown_is_xtmd_md_s_and_one_that_doesn_t_compile_has_none() {
        let c = Compiler::new();
        let doc = "$state {\n    n: number = 2;\n}\n@@@\n# Count\n\nIt is \\{$state.n}.\n";
        let r: Value = serde_json::from_str(&markdown_json(&c, "page.xtmd", doc, "[]")).unwrap();
        assert_eq!(r["markdown"], "# Count\n\nIt is 2.\n", "{}", r);
        let r: Value = serde_json::from_str(&markdown_json(&c, "page.xtmd", "@@@\n@nope();\n", "[]")).unwrap();
        assert_eq!((r["markdown"].clone(), r["errors"].as_u64()), (Value::Null, Some(1)), "{}", r);
    }
}
