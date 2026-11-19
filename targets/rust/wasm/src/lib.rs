//! The Extended Mark compiler for the browser: what `xtmd build` does, on a core compiled once when the
//! compiler is made. A real-time target compiles a document's text as it is edited, and draws the
//! IR as a run-time target draws one it was given; the IR is the binary's (@extended-mark/wasm's tests hold
//! it to that on every conformance case). The compiler itself is xtmd-live's.
//!
//! Built for `wasm32-wasip1`, whose C library decNumber needs, it gives the page seven plain
//! functions (`abi` below) and no generated glue: @extended-mark/wasm's loader is the whole of the JS side.

pub use xtmd_live::{BuildOptions, Built, Compiler, Formatted, Source};
use serde_json::Value;

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

/// What the page calls: a request's bytes written into memory the module gives, a reply read back.
#[cfg(target_arch = "wasm32")]
mod abi {
    use super::{build_json, format_json, BuildOptions, Compiler};
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
