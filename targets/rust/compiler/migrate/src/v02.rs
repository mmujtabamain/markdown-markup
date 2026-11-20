//! The 0.2 → 0.3 step's results, and how a 0.2 document is told apart. A document written for MKP
//! 0.2 is read by 0.2.10's own compiler and written as 0.3 by the migrator, both frozen into one JS
//! file (tools/migrate-0.2/frozen) that runs with Node: the xtmd command runs it, and so does an
//! editor that has Node. What it writes is read here. Only Extended Mark 0.3.0 carries it.

use std::collections::BTreeMap;

/// What the frozen step wrote for one 0.2 document.
pub struct Migrated {
    pub doc: String,
    /// The packs it uses, as stand-ins made from their 0.2 definitions: name → `.xtmdpack` text.
    pub packs: BTreeMap<String, String>,
    /// What 0.3 can't say as 0.2 did, each left in the document with a TODO, by its 0.2 line.
    pub todos: Vec<String>,
    /// What changed on the way, to know.
    pub notes: Vec<String>,
    /// 0.2 found nothing of its own in it: no widget block, definition, constant or state, and the
    /// Markdown comes out as it went in. Such a file reads the same in 0.3.
    pub plain: bool,
}

/// Why the step gave no 0.3 document: 0.2.10 doesn't build the file, or the step couldn't run.
pub enum Failed {
    NotBuilt(String),
    NotRun(String),
}

impl Migrated {
    /// What the frozen step printed for a document whose text was `source`: its JSON object,
    /// `{release, doc, packs, notes, counts}`, or `{release, error, diagnostics}`.
    pub fn read(v: &serde_json::Value, source: &str) -> Result<Migrated, Failed> {
        if let Some(e) = v["error"].as_str() {
            let first = v["diagnostics"].as_array().and_then(|d| d.first()).and_then(|d| d.as_str()).map(|d| format!(": {}", d)).unwrap_or_default();
            return Err(Failed::NotBuilt(format!("{}{}", e, first)));
        }
        let counts = v["counts"].as_object().map_or(0, |c| c.values().filter_map(|x| x.as_u64()).sum::<u64>());
        let migrated = v["doc"].as_str().unwrap_or_default();
        let header = |l: &&str| l.starts_with("// Migrated from MKP 0.2") || l.starts_with("// Nothing to finish by hand") || *l == "@@@";
        let plain = counts == 0 && migrated.lines().filter(|l| !header(l)).eq(source.lines());
        let line = |n: &serde_json::Value| n["line"].as_u64().map(|l| format!("0.2 line {}: ", l)).unwrap_or_default();
        let notes = v["notes"].as_array().cloned().unwrap_or_default();
        Ok(Migrated {
            doc: v["doc"].as_str().unwrap_or_default().to_string(),
            packs: v["packs"].as_object().map(|m| m.iter().map(|(k, t)| (k.clone(), t.as_str().unwrap_or_default().to_string())).collect()).unwrap_or_default(),
            todos: notes.iter().filter(|n| n["kind"] == "todo").map(|n| format!("{}{}", line(n), n["what"].as_str().unwrap_or(""))).collect(),
            notes: notes.iter().filter(|n| n["kind"] != "todo").map(|n| format!("{}{}", line(n), n["what"].as_str().unwrap_or(""))).collect(),
            plain,
        })
    }
}

/// A front matter that says the document is MKP 0.2's: `mkp: 0.2.…` or `ir: 1`, as 0.2 stamps it.
pub fn stamped(text: &str) -> bool {
    let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) else { return false };
    rest.lines().take_while(|l| l.trim_end() != "---").any(|l| {
        let l = l.trim();
        l.strip_prefix("mkp:").map_or(false, |v| v.trim().trim_matches('"').starts_with("0.2.")) || l.strip_prefix("ir:").map_or(false, |v| v.trim() == "1")
    })
}

/// What only MKP 0.2 wrote: a ```mkp fence of definitions, a fence named after a widget and its
/// version (```distance@1), or a container (:::callout). A file with one is taken for 0.2's when the
/// 0.2 step can't run to say.
pub fn looks_02(text: &str) -> Option<&'static str> {
    text.lines().map(str::trim_start).find_map(|l| {
        if let Some(info) = l.strip_prefix("```") {
            let info = info.trim();
            if info == "mkp" {
                return Some("a ```mkp fence");
            }
            if info.split_once('@').map_or(false, |(w, v)| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':') && v.parse::<u32>().is_ok()) {
                return Some("a widget's fence, ```name@N");
            }
        }
        l.strip_prefix(":::").and_then(|r| r.chars().next()).filter(|c| c.is_ascii_lowercase()).map(|_| "a :::container")
    })
}

/// Extended Mark 0.3 in a document's prose: a call, a control line or a hole, as 0.3's parser reads it. A
/// 0.2 document has none: its widgets are fences and its values `\val{…}`.
pub fn speaks_03(text: &str) -> bool {
    fn any(p: &xtmd_syntax::ast::Prose) -> bool {
        p.nodes.iter().any(|n| match n {
            xtmd_syntax::ast::ProseNode::Text(l) => !l.holes.is_empty(),
            xtmd_syntax::ast::ProseNode::Fence(_) | xtmd_syntax::ast::ProseNode::Maths(_) | xtmd_syntax::ast::ProseNode::Comment { .. } => false,
            _ => true,
        })
    }
    xtmd_syntax::parse(text, xtmd_syntax::Entry::Document).file.as_ref().and_then(|f| f.prose.as_ref()).map_or(false, any)
}

/// The version a stand-in says it stands for: `pack units@1 {`.
pub fn version_of(stand_in: &str) -> Option<u32> {
    stand_in.lines().find_map(|l| l.trim().strip_prefix("pack ")).and_then(|r| r.split('@').nth(1)).and_then(|v| v.trim_end_matches(|c: char| c == '{' || c.is_whitespace()).parse().ok())
}

/// A stand-in with a TODO under its `package` line: a person replaces it with the pack's own release.
pub fn marked(stand_in: &str, name: &str) -> String {
    let todo = format!("// TODO(xtmd migrate): a stand-in made from the 0.2 definitions of {}, so the documents that use it compile; the pack's own 0.3 release replaces it.\n", name);
    match stand_in.find('\n') {
        Some(i) => format!("{}\n{}{}", &stand_in[..i], todo, &stand_in[i + 1..]),
        None => format!("{}\n{}", stand_in, todo),
    }
}

/// Two stand-ins of one pack, from two documents, as one: each declaration once, and every name
/// either provides. The frozen step writes them in one fixed shape, so they are read by it: the
/// pack block, then declarations a blank line apart.
pub fn merge(a: &str, b: &str) -> String {
    fn parts(t: &str) -> (String, Vec<String>, Vec<String>) {
        let pack_at = t.find("\npack ").map(|i| i + 1).unwrap_or(0);
        let close = t[pack_at..].find("\n}\n").map(|i| pack_at + i + 3).unwrap_or(t.len());
        let provides: Vec<String> = t[pack_at..close].lines().find_map(|l| l.trim().strip_prefix("provides ")).map(|r| r.trim_end_matches(';').split(',').map(|x| x.trim().to_string()).collect()).unwrap_or_default();
        let decls: Vec<String> = t[close..].split("\n\n").map(|d| d.trim_matches('\n').to_string()).filter(|d| !d.is_empty()).collect();
        (t[..close].to_string(), provides, decls)
    }
    fn name(d: &str) -> String {
        let line = d.lines().find(|l| !l.trim_start().starts_with("//")).unwrap_or("");
        let words: Vec<&str> = line.split(|c: char| !(c.is_alphanumeric() || c == '_')).filter(|w| !w.is_empty()).collect();
        words.iter().skip_while(|w| matches!(**w, "extern" | "widget" | "record" | "enum" | "fn" | "type" | "token" | "let")).next().unwrap_or(&"").to_string()
    }
    let (head, mut provides, mut decls) = parts(a);
    let (_, more, others) = parts(b);
    for p in more {
        if !provides.contains(&p) {
            provides.push(p);
        }
    }
    for d in others {
        if !decls.iter().any(|x| name(x) == name(&d)) {
            decls.push(d);
        }
    }
    let head = match head.lines().find(|l| l.trim().starts_with("provides ")) {
        Some(old) => head.replacen(old, &format!("    provides {};", provides.join(", ")), 1),
        None => head,
    };
    format!("{}\n{}\n", head, decls.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "package kit;\n\n// The kit@1 pack's interface, migrated from MKP 0.2 by tools/migrate-0.2.\n\npack kit@1 {\n    uses core@1;\n    provides stat, stats;\n}\n\nrecord stat {\n    label: text;\n}\n\nextern widget stats(items: list<stat>) {\n    markdown {\n        x\n    }\n}\n";
    const B: &str = "package kit;\n\n// The kit@1 pack's interface, migrated from MKP 0.2 by tools/migrate-0.2.\n\npack kit@1 {\n    uses core@1;\n    provides stat, callout;\n}\n\nrecord stat {\n    label: text;\n}\n\n//@about A box.\nextern widget callout(title: text) {\n    markdown {\n        y\n    }\n}\n";

    #[test]
    fn two_documents_stand_ins_of_one_pack_merge_into_one() {
        let m = merge(&marked(A, "kit"), B);
        assert!(m.contains("// TODO(xtmd migrate): a stand-in made from the 0.2 definitions of kit,"), "{}", m);
        assert!(m.contains("    provides stat, stats, callout;\n"), "{}", m);
        assert_eq!(m.matches("record stat {").count(), 1, "{}", m);
        assert!(m.contains("extern widget stats(") && m.contains("//@about A box.\nextern widget callout("), "{}", m);
        assert_eq!(version_of(&m), Some(1));
    }

    #[test]
    fn what_only_0_2_wrote_marks_a_file_as_0_2s() {
        assert_eq!(looks_02("# A\n\n```mkp\ncounter\n```\n"), Some("a ```mkp fence"));
        assert_eq!(looks_02("```distance@1\nkm: 1\n```\n"), Some("a widget's fence, ```name@N"));
        assert_eq!(looks_02(":::callout title=\"x\"\nHi\n:::\n"), Some("a :::container"));
        assert_eq!(looks_02("# A\n\n```js\nlet a = b@1;\n```\n"), None);
    }

    #[test]
    fn a_0_2_stamp_is_in_the_front_matter() {
        assert!(stamped("---\nmkp: 0.2.10\nir: 1\n---\n# A\n"));
        assert!(stamped("---\ntitle: x\nir: 1\n---\n"));
        assert!(!stamped("---\nmkp: 0.3.0\n---\n# A\n"));
        assert!(!stamped("# mkp: 0.2.10\n"));
    }

    #[test]
    fn a_document_speaks_0_3_with_a_call_or_a_hole_in_its_prose() {
        assert!(speaks_03("# A\n\n@press(label = \"x\");\n"));
        assert!(speaks_03("The count is \\{$state.n}.\n"));
        assert!(!speaks_03("# A\n\n```mkp\ncounter\n  @click set n=(n + 1)\n```\n"));
    }

    #[test]
    fn the_steps_output_reads_as_a_migrated_document_or_why_not() {
        let v = serde_json::json!({ "release": "0.2.10", "doc": "@@@\n# A\n", "packs": { "kit": "package kit;\n" }, "notes": [{ "kind": "todo", "line": 3, "what": "a layout" }, { "kind": "note", "what": "renamed" }], "counts": { "widgets": 1 } });
        let Ok(m) = Migrated::read(&v, "# A\n") else { panic!("it reads") };
        assert_eq!((m.doc.as_str(), m.packs.len(), m.plain), ("@@@\n# A\n", 1, false));
        assert_eq!((m.todos, m.notes), (vec!["0.2 line 3: a layout".to_string()], vec!["renamed".to_string()]));
        let plain = serde_json::json!({ "doc": "// Migrated from MKP 0.2\n@@@\n# A\n", "counts": {} });
        assert!(Migrated::read(&plain, "# A\n").map_or(false, |m| m.plain));
        let failed = serde_json::json!({ "error": "0.2.10 doesn't build it", "diagnostics": ["unknown-widget x"] });
        assert!(matches!(Migrated::read(&failed, ""), Err(Failed::NotBuilt(e)) if e == "0.2.10 doesn't build it: unknown-widget x"));
    }
}
