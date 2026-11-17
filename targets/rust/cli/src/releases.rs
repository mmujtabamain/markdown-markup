//! Steps between releases of MKP 0.3: what a release changes in the files written for an earlier
//! one, beyond any pack's migrations. Each step is a fn from a file to its edits, made with MKP's own
//! reader (the parser, or its lexer for a form the parser no longer reads), never by searching the
//! text. `mkp migrate` runs the steps of every release after the one a tree is written for
//! (mkp.toml's `mkp`), oldest first and before anything else; a 0.2 document's run once the 0.2
//! step has written it as 0.3.0.

use mkp_syntax::Entry;

use crate::migrate::release_of;
use crate::migrate_step::{apply, Edit};

/// One release's change to a file.
pub(crate) struct ReleaseStep {
    /// The release that makes the change: the step runs on files written for an earlier one.
    pub release: &'static str,
    /// What changes and why, as whoever migrates is told.
    pub why: &'static str,
    /// The edits it makes to one file, read as a document or a `.mkp` file; an error says why the
    /// file can't be moved, and refuses it.
    pub edits: fn(&str, Entry) -> Result<Vec<Edit>, String>,
}

/// Every release's steps, oldest first. 0.3.0 is the first release of 0.3, so there are none yet.
pub(crate) static STEPS: &[ReleaseStep] = &[];

/// The steps of the releases after `from`, up to `to` and including it, oldest first.
pub(crate) fn between<'s>(from: &str, to: &str, steps: &'s [ReleaseStep]) -> Vec<&'s ReleaseStep> {
    let (Some(from), Some(to)) = (release_of(from), release_of(to)) else { return Vec::new() };
    let mut out: Vec<&ReleaseStep> = steps.iter().filter(|s| release_of(s.release).map_or(false, |r| r > from && r <= to)).collect();
    out.sort_by_key(|s| release_of(s.release));
    out
}

/// A file moved through the steps: its text after them, and what each step that changed it says.
pub(crate) fn run(text: &str, path: &str, steps: &[&ReleaseStep]) -> Result<(String, Vec<String>), String> {
    let Some(entry) = mkp_syntax::entry_for(path) else { return Ok((text.to_string(), Vec::new())) };
    let mut now = text.to_string();
    let mut said = Vec::new();
    for s in steps {
        let edits = (s.edits)(&now, entry).map_err(|e| format!("mkp {}: {}", s.release, e))?;
        if edits.is_empty() {
            continue;
        }
        now = apply(&now, &edits);
        said.push(format!("mkp {}: {}", s.release, s.why));
    }
    Ok((now, said))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use mkp_syntax::ast::ProseNode;

    /// A release that renamed core's `rule` to `divider`: every call of it in prose.
    fn rule(text: &str, entry: Entry) -> Result<Vec<Edit>, String> {
        let parsed = mkp_syntax::parse(text, entry);
        let file = parsed.file.ok_or("it doesn't read")?;
        let mut out = Vec::new();
        for n in file.prose.iter().flat_map(|p| p.nodes.iter()) {
            if let ProseNode::Call(c) = n {
                if c.call.name.name == "rule" {
                    out.push(Edit { start: c.call.name.span.start as usize, end: c.call.name.span.end as usize, text: "divider".into() });
                }
            }
        }
        Ok(out)
    }

    fn broken(_: &str, _: Entry) -> Result<Vec<Edit>, String> {
        Err("a form only a person can rewrite".into())
    }

    pub(crate) const STEPS: &[ReleaseStep] = &[
        ReleaseStep { release: "0.3.2", why: "`rule` is `divider` now", edits: rule },
        ReleaseStep { release: "0.3.1", why: "nothing in these files", edits: |_, _| Ok(Vec::new()) },
        ReleaseStep { release: "0.4.0", why: "later", edits: broken },
    ];

    #[test]
    fn a_tree_takes_the_steps_of_each_release_after_its_own_oldest_first() {
        let names = |v: Vec<&ReleaseStep>| v.iter().map(|s| s.release).collect::<Vec<_>>();
        assert_eq!(names(between("0.3.0", "0.3.2", STEPS)), ["0.3.1", "0.3.2"]);
        assert_eq!(names(between("0.3.1", "0.3.2", STEPS)), ["0.3.2"]);
        assert!(between("0.3.2", "0.3.2", STEPS).is_empty());
        assert_eq!(names(between("0.3.0", "0.4.0", STEPS)), ["0.3.1", "0.3.2", "0.4.0"]);
        assert!(between("0.3.0", "0.3.0", super::STEPS).is_empty());
    }

    #[test]
    fn a_step_edits_what_the_reader_finds_and_says_why() {
        let doc = "# Notes\n\nA rule, in words.\n\n@rule();\n";
        let (text, said) = run(doc, "notes.mkp.md", &between("0.3.0", "0.3.2", STEPS)).unwrap();
        assert_eq!(text, "# Notes\n\nA rule, in words.\n\n@divider();\n");
        assert_eq!(said, ["mkp 0.3.2: `rule` is `divider` now"]);
        let e = run(doc, "notes.mkp.md", &between("0.3.2", "0.4.0", STEPS)).unwrap_err();
        assert_eq!(e, "mkp 0.4.0: a form only a person can rewrite");
    }
}
