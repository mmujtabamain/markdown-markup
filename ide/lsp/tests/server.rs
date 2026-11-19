//! The language server, as a client sees it: a document opened, its diagnostics, and hover,
//! definition, references, outline, completion and formatting on it, with a pack the client gives.

use serde_json::{json, Value};
use xtmd_lsp::Server;

const PACK: &str = "package shelf;\n\npack shelf@1 {\n    provides row_of_books;\n}\n\n//@about A row of books, under a title.\nwidget row_of_books(title: text, count: int = 3) {\n    view {\n        @label(value = title);\n    }\n    markdown {\n        \\{title}\n    }\n}\n";
const DOC: &str = "import shelf;\n$state {\n    n: int = 0;\n}\n@@@\n# Books\n\n@row_of_books(title = \"Read\");\n\n@press(label = \"Add\", click = fn() {\n    $state.n = $state.n + 1;\n});\n";
const URI: &str = "file:///work/docs/books.xt.md";

fn req(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

fn note(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

/// The result of a request.
fn ask(s: &mut Server, id: u64, method: &str, params: Value) -> Value {
    let out = s.handle(&req(id, method, params));
    let reply = out.iter().find(|m| m["id"] == id).unwrap_or_else(|| panic!("no reply to {}: {:?}", method, out));
    assert!(reply.get("error").is_none(), "{}: {}", method, reply);
    reply["result"].clone()
}

/// A position: the line and character of the `nth` match of `needle` in `text`, plus `skip`.
fn at(text: &str, needle: &str, skip: usize) -> Value {
    let k = text.find(needle).unwrap() + skip;
    let line = text[..k].matches('\n').count();
    let character = k - text[..k].rfind('\n').map_or(0, |n| n + 1);
    json!({ "line": line, "character": character })
}

fn opened() -> Server {
    let mut s = Server::new();
    let caps = ask(&mut s, 1, "initialize", json!({ "capabilities": {} }));
    assert_eq!(caps["capabilities"]["hoverProvider"], true);
    s.handle(&note("initialized", json!({})));
    s.handle(&note("xtmd/packs", json!({ "uri": URI, "packs": [{ "path": "file:///work/shelf/shelf.xtpack", "text": PACK }] })));
    let out = s.handle(&note("textDocument/didOpen", json!({ "textDocument": { "uri": URI, "languageId": "xtmd", "version": 1, "text": DOC } })));
    let diags = &out[0]["params"]["diagnostics"];
    assert_eq!(out[0]["method"], "textDocument/publishDiagnostics");
    assert_eq!(diags.as_array().unwrap().len(), 0, "{}", diags);
    s
}

#[test]
fn a_document_with_an_error_says_it_with_its_rules_link() {
    let mut s = opened();
    let broken = DOC.replace("n: int = 0;", "n: int 0..3 = 9;");
    let out = s.handle(&note("textDocument/didChange", json!({ "textDocument": { "uri": URI, "version": 2 }, "contentChanges": [{ "text": broken }] })));
    let d = &out[0]["params"]["diagnostics"][0];
    assert_eq!(d["severity"], 1, "{}", d);
    assert_eq!(d["code"], "contracts.outside");
    assert!(d["codeDescription"]["href"].as_str().unwrap().contains("/docs/specs/"), "{}", d);
    assert_eq!(d["range"]["start"], at(&broken, "9;", 0));
    // closing clears them
    let out = s.handle(&note("textDocument/didClose", json!({ "textDocument": { "uri": URI } })));
    assert_eq!(out[0]["params"]["diagnostics"], json!([]));
}

#[test]
fn hover_says_what_a_name_is_and_its_type() {
    let mut s = opened();
    // a pack's widget: how it is declared, and its doc
    let h = ask(&mut s, 2, "textDocument/hover", json!({ "textDocument": { "uri": URI }, "position": at(DOC, "row_of_books(title", 3) }));
    let md = h["contents"]["value"].as_str().unwrap();
    assert!(md.contains("widget row_of_books(title: text, count: int = 3)") && md.contains("A row of books, under a title."), "{}", md);
    // one of core's widgets
    let h = ask(&mut s, 3, "textDocument/hover", json!({ "textDocument": { "uri": URI }, "position": at(DOC, "press(", 2) }));
    let md = h["contents"]["value"].as_str().unwrap();
    assert!(md.contains("extern widget press(") && md.contains("Something to press"), "{}", md);
    // an input given in a call
    let h = ask(&mut s, 4, "textDocument/hover", json!({ "textDocument": { "uri": URI }, "position": at(DOC, "title = ", 1) }));
    let md = h["contents"]["value"].as_str().unwrap();
    assert!(md.contains("title: text") && md.contains("an input of `row_of_books`"), "{}", md);
    // a $state field read
    let h = ask(&mut s, 5, "textDocument/hover", json!({ "textDocument": { "uri": URI }, "position": at(DOC, "$state.n + 1", 7) }));
    assert!(h["contents"]["value"].as_str().unwrap().contains("n: int"), "{}", h);
}

#[test]
fn definition_and_references_go_where_a_name_is_declared_and_used() {
    let mut s = opened();
    let d = ask(&mut s, 2, "textDocument/definition", json!({ "textDocument": { "uri": URI }, "position": at(DOC, "row_of_books(title", 2) }));
    assert_eq!(d["uri"], "file:///work/shelf/shelf.xtpack");
    assert_eq!(d["range"]["start"], at(PACK, "row_of_books(", 0));
    // core's press is in core's own source
    let d = ask(&mut s, 3, "textDocument/definition", json!({ "textDocument": { "uri": URI }, "position": at(DOC, "press(", 1) }));
    assert_eq!(d["uri"], "xtmd-core:/core/controls.xtpack");
    let core = ask(&mut s, 4, "xtmd/core", json!({ "path": "core/controls.xtpack" }));
    assert!(core["text"].as_str().unwrap().contains("extern widget press("));
    // $state.n: declared once, read once and written once
    let r = ask(&mut s, 5, "textDocument/references", json!({ "textDocument": { "uri": URI }, "position": at(DOC, "$state.n = ", 7) }));
    assert_eq!(r.as_array().unwrap().len(), 3, "{}", r);
}

#[test]
fn the_outline_lists_state_and_what_the_document_declares() {
    let mut s = opened();
    let syms = ask(&mut s, 2, "textDocument/documentSymbol", json!({ "textDocument": { "uri": URI } }));
    let names: Vec<&str> = syms.as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["$state"], "{}", syms);
    assert_eq!(syms[0]["children"][0]["name"], "n");
    assert_eq!(syms[0]["children"][0]["detail"], "int");
    // a pack's file, opened: its pack and widget, with the widget's inputs
    s.handle(&note("textDocument/didOpen", json!({ "textDocument": { "uri": "file:///work/shelf/shelf.xtpack", "languageId": "xtmd", "version": 1, "text": PACK } })));
    let syms = ask(&mut s, 3, "textDocument/documentSymbol", json!({ "textDocument": { "uri": "file:///work/shelf/shelf.xtpack" } }));
    let widget = syms.as_array().unwrap().iter().find(|s| s["name"] == "row_of_books").expect("the widget");
    let inputs: Vec<&str> = widget["children"].as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap()).collect();
    assert_eq!(inputs, ["title", "count"]);
}

#[test]
fn completion_offers_widgets_after_at_and_inputs_in_a_call() {
    let mut s = opened();
    let text = format!("{}\n@ro", DOC);
    s.handle(&note("textDocument/didChange", json!({ "textDocument": { "uri": URI, "version": 2 }, "contentChanges": [{ "text": text }] })));
    let end = json!({ "line": text.matches('\n').count(), "character": 3 });
    let c = ask(&mut s, 2, "textDocument/completion", json!({ "textDocument": { "uri": URI }, "position": end }));
    let items = c["items"].as_array().unwrap();
    let row = items.iter().find(|i| i["label"] == "row_of_books").expect("the pack's widget");
    // the input it has to have is a stop to fill in; the one with a default isn't
    assert_eq!(row["textEdit"]["newText"], "@row_of_books(title = $1)$0");
    assert_eq!(row["filterText"], "@row_of_books");
    // it replaces the `@` and what was typed after it
    let line = text.matches('\n').count();
    assert_eq!(row["textEdit"]["range"], json!({ "start": { "line": line, "character": 0 }, "end": { "line": line, "character": 3 } }));
    assert!(items.iter().any(|i| i["label"] == "press") && items.iter().any(|i| i["label"] == "label"));
    let text = format!("{}\n@row_of_books(title = \"x\", ", DOC);
    s.handle(&note("textDocument/didChange", json!({ "textDocument": { "uri": URI, "version": 3 }, "contentChanges": [{ "text": text }] })));
    let end = json!({ "line": text.matches('\n').count(), "character": text.rsplit('\n').next().unwrap().len() });
    let c = ask(&mut s, 3, "textDocument/completion", json!({ "textDocument": { "uri": URI }, "position": end }));
    let labels: Vec<&str> = c["items"].as_array().unwrap().iter().map(|i| i["label"].as_str().unwrap()).collect();
    assert_eq!(labels, ["count"], "{}", c);
}

#[test]
fn formatting_gives_the_canonical_layout_as_one_edit() {
    let mut s = opened();
    let messy = DOC.replace("    n: int = 0;", "  n: int = 0;");
    s.handle(&note("textDocument/didChange", json!({ "textDocument": { "uri": URI, "version": 2 }, "contentChanges": [{ "text": messy }] })));
    let edits = ask(&mut s, 2, "textDocument/formatting", json!({ "textDocument": { "uri": URI }, "options": { "tabSize": 4, "insertSpaces": true } }));
    assert_eq!(edits[0]["newText"], DOC);
    // in the canonical layout already: no edit
    s.handle(&note("textDocument/didChange", json!({ "textDocument": { "uri": URI, "version": 3 }, "contentChanges": [{ "text": DOC }] })));
    assert_eq!(ask(&mut s, 3, "textDocument/formatting", json!({ "textDocument": { "uri": URI }, "options": {} })), json!([]));
}

#[test]
fn shutdown_then_exit_is_a_clean_exit_and_an_unknown_request_an_error() {
    let mut s = opened();
    let out = s.handle(&req(9, "textDocument/rename", json!({})));
    assert_eq!(out[0]["error"]["code"], -32601);
    assert_eq!(ask(&mut s, 10, "shutdown", Value::Null), Value::Null);
    s.handle(&note("exit", Value::Null));
    assert_eq!(s.exit, Some(0));
}

#[test]
fn serve_frames_messages_over_a_reader_and_a_writer() {
    let msgs = [req(1, "initialize", json!({ "capabilities": {} })), req(2, "shutdown", Value::Null), note("exit", Value::Null)];
    let input: String = msgs.iter().map(|m| format!("Content-Length: {}\r\n\r\n{}", m.to_string().len(), m)).collect();
    let mut output = Vec::new();
    let code = xtmd_lsp::serve(input.as_bytes(), &mut output);
    assert_eq!(code, 0);
    let out = String::from_utf8(output).unwrap();
    assert_eq!(out.matches("Content-Length: ").count(), 2, "{}", out);
    assert!(out.contains("\"serverInfo\"") && out.contains("\"id\":2,\"jsonrpc\":\"2.0\",\"result\":null") || out.contains("\"result\":null"), "{}", out);
}

#[test]
fn a_pack_s_own_file_opened_is_built_without_itself_as_a_pack() {
    let mut s = opened();
    let pack = "file:///work/shelf/shelf.xtpack";
    s.handle(&note("xtmd/packs", json!({ "uri": pack, "packs": [{ "path": pack, "text": PACK }] })));
    let out = s.handle(&note("textDocument/didOpen", json!({ "textDocument": { "uri": pack, "languageId": "xtmd", "version": 1, "text": PACK } })));
    assert_eq!(out[0]["params"]["diagnostics"], json!([]), "{}", out[0]);
}

#[test]
fn cores_own_source_opened_is_read_not_built_again() {
    let mut s = opened();
    let text = ask(&mut s, 2, "xtmd/core", json!({ "path": "core/controls.xtpack" }))["text"].as_str().unwrap().to_string();
    let uri = "xtmd-core:/core/controls.xtpack";
    let out = s.handle(&note("textDocument/didOpen", json!({ "textDocument": { "uri": uri, "languageId": "xtmd", "version": 1, "text": text } })));
    assert_eq!(out[0]["params"]["diagnostics"], json!([]), "{}", out[0]);
    // and it has its hover and outline, as core's
    let syms = ask(&mut s, 3, "textDocument/documentSymbol", json!({ "textDocument": { "uri": uri } }));
    assert!(syms.as_array().unwrap().iter().any(|s| s["name"] == "press"), "{}", syms);
}

#[test]
fn a_slip_has_a_quick_fix_that_writes_the_name_meant() {
    let mut s = opened();
    let slip = DOC.replace("@press(label", "@prss(label");
    let out = s.handle(&note("textDocument/didChange", json!({ "textDocument": { "uri": URI, "version": 2 }, "contentChanges": [{ "text": slip }] })));
    let d = out[0]["params"]["diagnostics"].as_array().unwrap().iter().find(|d| d["code"] == "names.unknown-widget").cloned().expect("the slip's error");
    assert_eq!(d["data"]["edits"][0]["newText"], "press", "{}", d);
    let actions = ask(&mut s, 2, "textDocument/codeAction", json!({ "textDocument": { "uri": URI }, "range": d["range"], "context": { "diagnostics": [d] } }));
    let a = &actions[0];
    assert_eq!(a["title"], "Change to `press`");
    assert_eq!(a["kind"], "quickfix");
    let edit = &a["edit"]["changes"][URI][0];
    assert_eq!(edit["newText"], "press");
    assert_eq!(edit["range"]["start"], at(&slip, "prss", 0));
    // a diagnostic with no fix has no action
    let none = ask(&mut s, 3, "textDocument/codeAction", json!({ "textDocument": { "uri": URI }, "range": d["range"], "context": { "diagnostics": [{ "range": d["range"], "message": "x", "source": "xtmd", "code": "types.mismatch" }] } }));
    assert_eq!(none, json!([]));
}
