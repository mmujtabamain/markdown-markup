//! Extended Mark's editor features and its language server. [`Server`] answers the Language Server
//! Protocol's messages with no input or output of its own: `xtmd lsp` runs it over stdio
//! ([`serve`]), and @extended-mark/wasm runs it in a browser, where the client gives it the packs
//! (`xtmd/packs`). The features are worked out from the checker's resolved IR ([`analysis`]), the
//! same the compiler writes for `xtmd build --rir`, with core's own declarations in it.

pub mod analysis;
#[cfg(feature = "fs")]
pub mod config;
pub mod rules;
mod server;
pub mod text;

pub use server::{path_of, uri_of, Server};

use std::io::{BufRead, Write};

/// Serves the protocol over a reader and a writer, as `xtmd lsp` does over stdio: each message
/// framed by its `Content-Length` header. Gives the exit code `exit` asked for (0 after
/// `shutdown`), or 1 when the input ends without one.
pub fn serve(mut input: impl BufRead, mut output: impl Write) -> i32 {
    let mut server = Server::new();
    loop {
        let Some(msg) = read_message(&mut input) else { return 1 };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&msg) else { continue };
        for reply in server.handle(&value) {
            let body = reply.to_string();
            if write!(output, "Content-Length: {}\r\n\r\n{}", body.len(), body).and_then(|_| output.flush()).is_err() {
                return 1;
            }
        }
        if let Some(code) = server.exit {
            return code;
        }
    }
}

/// One framed message's body, or none when the input has ended.
fn read_message(input: &mut impl BufRead) -> Option<Vec<u8>> {
    let mut length = None;
    loop {
        let mut line = String::new();
        if input.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some(v) = line.strip_prefix("Content-Length:") {
            length = v.trim().parse::<usize>().ok();
        }
    }
    let mut body = vec![0; length?];
    std::io::Read::read_exact(input, &mut body).ok()?;
    Some(body)
}
