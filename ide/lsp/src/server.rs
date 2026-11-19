//! The language server: the protocol's messages in, its replies and notifications out, with no
//! input or output of its own, so the same server runs behind `xtmd lsp`'s stdio and inside
//! @extended-mark/wasm in a browser. Documents are synced whole (`change: 1`).

use std::collections::HashMap;

use serde_json::{json, Value};
use xtmd_live::{BuildOptions, Compiler, Source};

use crate::analysis::{self, Index};
use crate::rules;
use crate::text::Text;

/// What the server knows of one open document.
struct Doc {
    /// The path the compiler is given: a `file:` URI's path, or the URI itself.
    path: String,
    text: String,
    /// The packs it is built with, as the client gave them or as its `xtmd.toml` names them.
    packs: Vec<Source>,
    index: Option<Index>,
    /// Its last build's diagnostics.
    diagnostics: Vec<xtmd_live::Diagnostic>,
}

/// The server.
pub struct Server {
    compiler: Compiler,
    docs: HashMap<String, Doc>,
    /// The packs the client gives a document (`xtmd/packs`), by its URI: in a browser, the server
    /// can't read them itself.
    given: HashMap<String, Vec<Source>>,
    /// Core's declarations, resolved and indexed once.
    core: Option<Index>,
    shut_down: bool,
    /// What `exit` asked for: 0 after `shutdown`, 1 without.
    pub exit: Option<i32>,
}

impl Default for Server {
    fn default() -> Self {
        Server::new()
    }
}

impl Server {
    pub fn new() -> Server {
        Server { compiler: Compiler::new(), docs: HashMap::new(), given: HashMap::new(), core: None, shut_down: false, exit: None }
    }

    /// One message from the client; gives what to send back, in order.
    pub fn handle(&mut self, msg: &Value) -> Vec<Value> {
        let method = msg["method"].as_str().unwrap_or("");
        let id = msg.get("id").cloned();
        let params = &msg["params"];
        let mut out = Vec::new();
        // a reply to a request of ours: there are none
        if method.is_empty() {
            return out;
        }
        let result: Result<Value, (i64, String)> = match method {
            "initialize" => Ok(capabilities()),
            "shutdown" => {
                self.shut_down = true;
                Ok(Value::Null)
            }
            "exit" => {
                self.exit = Some(if self.shut_down { 0 } else { 1 });
                return out;
            }
            "textDocument/didOpen" => {
                let d = &params["textDocument"];
                let uri = d["uri"].as_str().unwrap_or("").to_string();
                self.open(&uri, d["text"].as_str().unwrap_or(""));
                out.push(self.publish(&uri));
                return out;
            }
            "textDocument/didChange" => {
                let uri = params["textDocument"]["uri"].as_str().unwrap_or("").to_string();
                if let Some(text) = params["contentChanges"].as_array().and_then(|c| c.last()).and_then(|c| c["text"].as_str()) {
                    if let Some(doc) = self.docs.get_mut(&uri) {
                        doc.text = text.to_string();
                    }
                    self.rebuild(&uri);
                    out.push(self.publish(&uri));
                }
                return out;
            }
            "textDocument/didSave" => {
                // a pack or xtmd.toml may have changed on disk: every document reads its packs again
                let mut uris: Vec<String> = self.docs.keys().cloned().collect();
                uris.sort();
                for u in uris {
                    self.reload_packs(&u);
                    self.rebuild(&u);
                    out.push(self.publish(&u));
                }
                return out;
            }
            "textDocument/didClose" => {
                let uri = params["textDocument"]["uri"].as_str().unwrap_or("").to_string();
                self.docs.remove(&uri);
                out.push(json!({ "jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": { "uri": uri, "diagnostics": [] } }));
                return out;
            }
            // the packs a document is built with, given by a client that reads them itself
            "xtmd/packs" => {
                let uri = params["uri"].as_str().unwrap_or("").to_string();
                // a pack's `file:` URI is its path, as an open document's is, so the two are one file
                let packs = params["packs"].as_array().into_iter().flatten().filter_map(|p| Some(Source { path: path_of(p["path"].as_str()?), text: p["text"].as_str()?.to_string() })).collect();
                self.given.insert(uri.clone(), packs);
                if self.docs.contains_key(&uri) {
                    self.reload_packs(&uri);
                    self.rebuild(&uri);
                    out.push(self.publish(&uri));
                }
                return out;
            }
            "textDocument/hover" => Ok(self.at(params, |s, doc, offset| {
                let ix = doc.index.as_ref()?;
                let h = ix.hover(&doc.path, offset)?;
                let t = Text::new(&doc.text);
                let _ = s;
                Some(json!({ "contents": { "kind": "markdown", "value": h.markdown }, "range": t.range(h.span.0, h.span.1) }))
            })),
            "textDocument/definition" => Ok(self.at(params, |s, doc, offset| {
                let ix = doc.index.as_ref()?;
                let f = ix.definition(&doc.path, offset)?;
                s.location(ix, &f.file, f.span)
            })),
            "textDocument/references" => Ok(self.at(params, |s, doc, offset| {
                let ix = doc.index.as_ref()?;
                Some(Value::Array(ix.references(&doc.path, offset).iter().filter_map(|f| s.location(ix, &f.file, f.span)).collect()))
            })),
            "textDocument/documentSymbol" => {
                let uri = params["textDocument"]["uri"].as_str().unwrap_or("");
                Ok(match self.docs.get(uri) {
                    Some(doc) => match &doc.index {
                        Some(ix) => {
                            let t = Text::new(&doc.text);
                            analysis::symbols_json(&ix.symbols(&doc.path), &|(a, b)| t.range(a, b))
                        }
                        None => json!([]),
                    },
                    None => Value::Null,
                })
            }
            "textDocument/completion" => Ok(self.at(params, |_, doc, offset| {
                let ix = doc.index.as_ref()?;
                let t = Text::new(&doc.text);
                let items: Vec<Value> = ix
                    .completions(&doc.path, &doc.text, offset)
                    .into_iter()
                    .map(|c| {
                        let mut v = json!({ "label": c.label, "kind": c.kind, "detail": c.detail });
                        if let Some(d) = c.doc {
                            v["documentation"] = json!({ "kind": "markdown", "value": d });
                        }
                        let text = c.snippet.clone().unwrap_or_else(|| c.label.clone());
                        if c.snippet.is_some() {
                            v["insertTextFormat"] = json!(2);
                        }
                        // what it replaces, when that is more than the word at the cursor: the `@`
                        // too, so it is matched and written with it
                        match c.replace {
                            Some((a, b)) => {
                                v["textEdit"] = json!({ "range": t.range(a, b), "newText": text });
                                v["filterText"] = json!(doc.text[a..b].chars().next().map_or(String::new(), |at| format!("{}{}", at, c.label)));
                            }
                            None if c.snippet.is_some() => v["insertText"] = json!(text),
                            None => {}
                        }
                        v
                    })
                    .collect();
                Some(json!({ "isIncomplete": false, "items": items }))
            })),
            "textDocument/formatting" => {
                let uri = params["textDocument"]["uri"].as_str().unwrap_or("");
                Ok(match self.docs.get(uri) {
                    Some(doc) => match self.compiler.format(&doc.path, &doc.text).text {
                        Some(t) if t != doc.text => {
                            let whole = Text::new(&doc.text).range(0, doc.text.len());
                            json!([{ "range": whole, "newText": t }])
                        }
                        Some(_) => json!([]),
                        None => Value::Null,
                    },
                    None => Value::Null,
                })
            }
            // core's own source, for a definition in core: `xtmd-core:/core/controls.xtpack`
            "xtmd/core" => {
                let path = params["path"].as_str().unwrap_or("");
                Ok(xtmd_live::core().into_iter().find(|s| s.path == path).map_or(Value::Null, |s| json!({ "text": s.text })))
            }
            _ if id.is_none() => return out,
            _ => Err((-32601, format!("{} isn't something this server does", method))),
        };
        if let Some(id) = id {
            out.push(match result {
                Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
                Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
            });
        }
        out
    }

    /// A request at a position in a document: `f` with the document and the byte offset.
    fn at(&self, params: &Value, f: impl Fn(&Server, &Doc, usize) -> Option<Value>) -> Value {
        let uri = params["textDocument"]["uri"].as_str().unwrap_or("");
        let Some(doc) = self.docs.get(uri) else { return Value::Null };
        let offset = Text::new(&doc.text).offset(&params["position"]);
        f(self, doc, offset).unwrap_or(Value::Null)
    }

    /// A declaration's place as the protocol's Location.
    fn location(&self, ix: &Index, file: &str, span: (usize, usize)) -> Option<Value> {
        let text = self.docs.values().find(|d| d.path == file).map(|d| d.text.as_str()).or_else(|| ix.text(file))?;
        Some(json!({ "uri": uri_of(file), "range": Text::new(text).range(span.0, span.1) }))
    }

    fn open(&mut self, uri: &str, text: &str) {
        self.docs.insert(uri.to_string(), Doc { path: path_of(uri), text: text.to_string(), packs: Vec::new(), index: None, diagnostics: Vec::new() });
        self.reload_packs(uri);
        self.rebuild(uri);
    }

    /// The packs a document is built with: the client's, or else its `xtmd.toml`'s from disk.
    fn reload_packs(&mut self, uri: &str) {
        let Some(doc) = self.docs.get(uri) else { return };
        let packs = match self.given.get(uri) {
            Some(p) => p.clone(),
            None => disk_packs(&doc.path),
        };
        if let Some(doc) = self.docs.get_mut(uri) {
            doc.packs = packs;
        }
    }

    fn rebuild(&mut self, uri: &str) {
        let core = self.core_index().clone();
        let Some(doc) = self.docs.get(uri) else { return };
        // core's own source, opened from a definition: it is core, compiled once, not built again
        // on top of itself
        if doc.path.starts_with("core/") {
            let doc = self.docs.get_mut(uri).unwrap();
            doc.index = Some(core);
            doc.diagnostics = Vec::new();
            return;
        }
        // an open pack's text is the editor's, not the disk's
        let packs: Vec<Source> = doc
            .packs
            .iter()
            .map(|p| match self.docs.values().find(|d| d.path == p.path) {
                Some(open) => Source { path: p.path.clone(), text: open.text.clone() },
                None => p.clone(),
            })
            .collect();
        let built = self.compiler.build_with(&doc.path, &doc.text, &packs, BuildOptions { rir: true, core: false });
        let mut texts: HashMap<String, String> = packs.iter().map(|p| (p.path.clone(), p.text.clone())).collect();
        texts.insert(doc.path.clone(), doc.text.clone());
        let mut ix = core;
        if let Some(rir) = &built.rir {
            ix.extend(rir, texts);
        }
        let doc = self.docs.get_mut(uri).unwrap();
        doc.index = Some(ix);
        doc.diagnostics = built.diagnostics;
    }

    fn core_index(&mut self) -> &Index {
        if self.core.is_none() {
            let b = self.compiler.build_with("core.xt.md", "", &[], BuildOptions { rir: true, core: true });
            let texts: HashMap<String, String> = xtmd_live::core().into_iter().map(|s| (s.path, s.text)).collect();
            let mut core = b.rir.unwrap_or_default();
            // core's files only: the empty document it was built with is no one's
            if let Some(files) = core["files"].as_array_mut() {
                files.retain(|f| f["path"].as_str().is_some_and(|p| p.starts_with("core/")));
            }
            self.core = Some(Index::new(&core, texts));
        }
        self.core.as_ref().unwrap()
    }

    /// The protocol's diagnostics for a document, from its last build.
    fn publish(&self, uri: &str) -> Value {
        let Some(doc) = self.docs.get(uri) else { return json!({ "jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": { "uri": uri, "diagnostics": [] } }) };
        let t = Text::new(&doc.text);
        let all = &doc.diagnostics;
        let mut list = Vec::new();
        for d in all.iter().filter(|d| d.file == doc.path) {
            let mut message = d.message.clone();
            if let Some(fix) = &d.fix {
                message.push_str(&format!("\nfix: {}", fix));
            }
            let mut v = json!({
                "range": { "start": t.from_xtmd(d.line, d.column), "end": t.from_xtmd(d.end.line, d.end.column) },
                "severity": if d.is_error() { 1 } else { 2 },
                "code": d.code,
                "source": "xtmd",
                "message": message,
            });
            if let Some(href) = rules::link(&d.code) {
                v["codeDescription"] = json!({ "href": href });
            }
            list.push(v);
        }
        // a pack's errors stop the document too: said at its first line, with where they are
        let others: Vec<String> = all.iter().filter(|d| d.file != doc.path && d.is_error()).map(|d| d.located()).collect();
        if !others.is_empty() {
            list.push(json!({
                "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 0 } },
                "severity": 1,
                "code": "packs.errors",
                "source": "xtmd",
                "message": format!("a pack it uses has errors:\n{}", others.join("\n")),
            }));
        }
        json!({ "jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": { "uri": uri, "diagnostics": list } })
    }
}

/// What the server does, for `initialize`.
fn capabilities() -> Value {
    json!({
        "capabilities": {
            "positionEncoding": "utf-16",
            "textDocumentSync": { "openClose": true, "change": 1, "save": { "includeText": false } },
            "hoverProvider": true,
            "definitionProvider": true,
            "referencesProvider": true,
            "documentSymbolProvider": true,
            "completionProvider": { "triggerCharacters": ["@", ".", "(", ",", " "] },
            "documentFormattingProvider": true
        },
        "serverInfo": { "name": "xtmd lsp", "version": env!("CARGO_PKG_VERSION") }
    })
}

#[cfg(feature = "fs")]
fn disk_packs(path: &str) -> Vec<Source> {
    if path.contains("://") {
        return Vec::new();
    }
    crate::config::packs_for(std::path::Path::new(path)).0
}

#[cfg(not(feature = "fs"))]
fn disk_packs(_path: &str) -> Vec<Source> {
    Vec::new()
}

/// The path the compiler is given for a URI: a `file:` URI's path, decoded; core's own source
/// (`xtmd-core:/core/controls.xtpack`) by core's path; any other URI as it is.
pub fn path_of(uri: &str) -> String {
    if let Some(p) = uri.strip_prefix("file://") {
        decode(p)
    } else if let Some(p) = uri.strip_prefix("xtmd-core:/") {
        p.to_string()
    } else {
        uri.to_string()
    }
}

/// The URI of a path the compiler was given: a URI as it is, core's files as `xtmd-core:`, and a
/// file's path as a `file:` URI.
pub fn uri_of(path: &str) -> String {
    if path.contains("://") {
        path.to_string()
    } else if path.starts_with("core/") {
        format!("xtmd-core:/{}", path)
    } else {
        format!("file://{}", encode(path))
    }
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut k = 0;
    while k < b.len() {
        if b[k] == b'%' && k + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[k + 1..k + 3], 16) {
                out.push(v);
                k += 3;
                continue;
            }
        }
        out.push(b[k]);
        k += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn encode(path: &str) -> String {
    let mut out = String::new();
    for b in path.bytes() {
        if b.is_ascii_alphanumeric() || b"/-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}
