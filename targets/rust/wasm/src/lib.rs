//! The MKP compiler for the browser: what `mkp build` does, on a core compiled once when the
//! compiler is made. A real-time target compiles a document's text as it is edited, and draws the
//! IR as a run-time target draws one it was given; the IR is the binary's (@mkp/wasm's tests hold
//! it to that on every conformance case). The compiler itself is mkp-live's.
//!
//! Built for `wasm32-wasip1`, whose C library decNumber needs, it gives the page four plain
//! functions (`abi` below) and no generated glue: @mkp/wasm's loader is the whole of the JS side.

pub use mkp_live::{Built, Compiler, Source};
use serde_json::Value;

/// Builds as the page asks: `packs` a JSON list, `[{ "path", "text" }]`. Gives the reply's JSON,
/// `{ "ir": the IR file or null, "diagnostics": [...], "errors": n }`.
pub fn build_json(c: &Compiler, path: &str, text: &str, packs: &str) -> String {
    let packs: Vec<Source> = serde_json::from_str::<Vec<Value>>(packs)
        .unwrap_or_default()
        .iter()
        .filter_map(|p| Some(Source { path: p.get("path")?.as_str()?.to_string(), text: p.get("text")?.as_str()?.to_string() }))
        .collect();
    c.build(path, text, &packs).to_json()
}

/// What the page calls: a request's bytes written into memory the module gives, a reply read back.
#[cfg(target_arch = "wasm32")]
mod abi {
    use super::{build_json, Compiler};
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
        let reply = build_json(unsafe { &*c }, field("path"), field("text"), &packs).into_bytes();
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
