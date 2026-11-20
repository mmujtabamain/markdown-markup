//! `xtmd migrate`'s plan, for an editor: the files' texts in, what each becomes out, with nothing
//! read or written here. The editor gives the files as it has them (an open one's unsaved text too),
//! asks a person the migrations' questions and runs again with the answers, and applies the result as
//! edits it can undo. The plan is xtmd-migrate's, as the xtmd command's is.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use xtmd_live::{Compiler, Source};
use xtmd_migrate::step::{self, Answers};
use xtmd_migrate::v02::{Failed, Migrated};
use xtmd_migrate::{is_doc, packs_of, pass, release_in, release_of, step_packs, uses_after, uses_in, with_release, with_uses, written_as, Step02, Tree, ALLOW_ERRORS, FIRST, RELEASE};

fn sources(v: &Value) -> Vec<Source> {
    v.as_array().into_iter().flatten().filter_map(|p| Some(Source { path: p.get("path")?.as_str()?.to_string(), text: p.get("text")?.as_str()?.to_string() })).collect()
}

/// Plans a migration as the request asks:
/// `{ "sources": [{path, text}], "docs": [{path, text}], "config": {path, text} | null,
///    "from": {pack: version}, "answers": {"confirm": {key: bool}, "split": {key: case}},
///    "allowTodos": bool, "allowErrors": bool, "standIns": folder,
///    "step02": {doc path: what the frozen 0.2 step printed | {"notRun": why}}, "packs02": bool }`.
///
/// `sources` are the 0.3 packs' files (xtmd.toml's), `docs` the documents. A document that needs the
/// 0.2 step and has no `step02` entry is named in `needs02`: the editor runs the step (it needs Node)
/// and asks again. Gives `{ "files": [{path, to, old, text, result, moved, changes, deletions,
/// notices, refused, inferred, todos, changed, errors, standIns}], "standIns": [{name, path, text}],
/// "questions": [{number, key, asks, options}], "asked": [{number, asks, answer, by}], "needs02": [...],
/// "config": {path, old, text} | null, "release": {from, to} }`, or `{ "error" }`: what `xtmd migrate`
/// stops at before it plans anything.
pub fn migrate_json(c: &Compiler, req: &Value) -> String {
    plan(c, req).unwrap_or_else(|e| json!({ "error": e })).to_string()
}

fn plan(c: &Compiler, req: &Value) -> Result<Value, String> {
    // a run from the start, with what the request allows
    step::reset();
    step::NO_ASKING.store(true, std::sync::atomic::Ordering::Relaxed);
    step::TODO.store(req["allowTodos"].as_bool().unwrap_or(false), std::sync::atomic::Ordering::Relaxed);
    ALLOW_ERRORS.store(req["allowErrors"].as_bool().unwrap_or(false), std::sync::atomic::Ordering::Relaxed);
    let mut answers = Answers::default();
    for (k, v) in req["answers"]["confirm"].as_object().into_iter().flatten() {
        if let Some(b) = v.as_bool() {
            answers.confirm.insert(k.clone(), b);
        }
    }
    for (k, v) in req["answers"]["split"].as_object().into_iter().flatten() {
        if let Some(s) = v.as_str() {
            answers.split.insert(k.clone(), s.to_string());
        }
    }
    *step::ANSWERS.lock().unwrap() = Some(answers);

    let mut sources = sources(&req["sources"]);
    let docs: Vec<(PathBuf, String)> = self::sources(&req["docs"]).into_iter().filter(|d| is_doc(&d.path)).map(|d| (PathBuf::from(d.path), d.text)).collect();
    let from: BTreeMap<String, u32> = req["from"].as_object().into_iter().flatten().filter_map(|(k, v)| Some((k.clone(), v.as_u64()? as u32))).collect();
    let config = req["config"]["path"].as_str().zip(req["config"]["text"].as_str());
    let uses = config.map_or_else(BTreeMap::new, |(_, t)| uses_in(t));
    // the release of xtmd the tree is written for: xtmd.toml's `xtmd = "0.3.x"`
    let written_release = config.and_then(|(_, t)| release_in(t));
    if let (Some((cfg, _)), Some(r)) = (config, &written_release) {
        match release_of(r) {
            None => return Err(format!("{}: xtmd = \"{}\" isn't a release of xtmd, such as \"{}\"", cfg, r, RELEASE)),
            Some(v) if v > release_of(RELEASE).unwrap_or_default() => {
                return Err(format!("{}: xtmd = \"{}\" says the tree is written for xtmd {}, which is newer than this extension's ({}): update the extension, or, if the line is wrong, set it to the release the tree is written for", cfg, r, r, RELEASE));
            }
            _ => {}
        }
    }
    let record_moves = config.is_some() && written_release.as_deref() != Some(RELEASE);
    let from_release = written_release.clone().unwrap_or_else(|| FIRST.to_string());
    let release_steps = xtmd_migrate::releases::between(&from_release, RELEASE, xtmd_migrate::releases::STEPS);
    let release_label = format!("xtmd {} → {}", from_release, RELEASE);
    let (stepped, step_refused) = step_packs(&mut sources, &release_steps);
    let packs = packs_of(&sources);
    let stand_in_dir = PathBuf::from(req["standIns"].as_str().unwrap_or("stand-ins"));

    // the 0.2 step: what the editor ran, or a note that it is needed
    let ran = req["step02"].as_object().cloned().unwrap_or_default();
    let needs02: RefCell<Vec<String>> = RefCell::new(Vec::new());
    let docs_text: BTreeMap<String, String> = docs.iter().map(|(p, t)| (p.display().to_string(), t.clone())).collect();
    let run_02 = |p: &Path| -> Result<Migrated, Failed> {
        let key = p.display().to_string();
        match ran.get(&key) {
            Some(v) => match v["notRun"].as_str() {
                Some(why) => Err(Failed::NotRun(why.to_string())),
                None => Migrated::read(v, docs_text.get(&key).map(String::as_str).unwrap_or("")),
            },
            None => {
                needs02.borrow_mut().push(key);
                Err(Failed::NotRun("the 0.2 → 0.3 step hasn't run on it yet".to_string()))
            }
        }
    };
    let step02 = Step02 { run: &run_02, packs_given: req["packs02"].as_bool().unwrap_or(false) };
    let tree = Tree { base: c.checker(), sources: &sources, packs: &packs, stepped: &stepped, step_refused: &step_refused, release_steps: &release_steps, release_label: &release_label, from: &from, uses: &uses, stand_in_dir: &stand_in_dir, step02: &step02 };
    let (results, stand_ins) = pass(&tree, &docs);

    let questions: Vec<Value> = step::pending().into_iter().map(|(n, q)| json!({ "number": n, "key": q.key, "asks": q.asks, "options": q.options })).collect();
    let asked: Vec<Value> = step::ASKED.lock().unwrap().iter().map(|(n, q, a, by)| json!({ "number": n, "asks": q, "answer": a, "by": by })).collect();
    let mut need = 0;
    let files: Vec<Value> = results
        .iter()
        .map(|(p, old, o)| {
            let to = written_as(p);
            let result = if !o.refused.is_empty() {
                need += 1;
                "refused"
            } else if o.text == *old && to == *p {
                "up to date"
            } else {
                "migrate"
            };
            json!({
                "path": p.display().to_string(), "to": to.display().to_string(), "old": old, "text": o.text, "result": result,
                "moved": o.moved, "changes": o.changes, "deletions": o.deletions, "notices": o.notices, "refused": o.refused,
                "inferred": o.inferred, "todos": o.todos, "changed": o.changed, "errors": o.errors, "standIns": o.stand_ins,
            })
        })
        .collect();
    // xtmd.toml once the tree moves: each pack it now uses, and this release; only with every file
    let uses_to = uses_after(&packs, &uses);
    let config_after = config.and_then(|(path, old)| {
        let mut new = if uses_to.is_empty() { old.to_string() } else { with_uses(old, &uses_to) };
        if record_moves {
            new = with_release(&new, RELEASE);
        }
        (need == 0 && questions.is_empty() && new != old).then(|| json!({ "path": path, "old": old, "text": new }))
    });
    let mut written: Vec<&String> = results.iter().filter(|(_, _, o)| o.refused.is_empty()).flat_map(|(_, _, o)| o.stand_ins.iter()).collect();
    written.sort();
    written.dedup();
    Ok(json!({
        "files": files,
        "standIns": written.iter().map(|n| json!({ "name": n, "path": stand_ins[*n].0.display().to_string(), "text": stand_ins[*n].1 })).collect::<Vec<_>>(),
        "questions": questions,
        "asked": asked,
        "needs02": needs02.into_inner(),
        "config": config_after,
        "release": { "from": from_release, "to": RELEASE },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // as the CLI's tests have them: kit@2 renames and drops what kit@1 had
    const KIT1_SURFACE: &str = "package kit@1;\n\nrecord stat {\n    label: text;\n    value: text;\n}\n\nenum state { DONE, LATE }\n\nextern widget chart(values: list<number>, color: color = color.ACCENT);\nextern widget badge(label: text, shadow: bool = false);\nextern widget sparkline(values: list<number>);\nextern widget stats(items: list<stat>);\n";
    const KIT2: &str = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides plot, badge, stat, state, stats;\n}\n\nrecord stat {\n    title: text;\n    value: text;\n    unit: text;\n}\n\nenum state { DONE, OVERDUE }\n\nextern widget plot(values: list<number>, tone: color = color.ACCENT);\nextern widget badge(label: text, size: size = size.M);\nextern widget stats(items: list<stat>);\n";
    const MIGRATION: &str = "package kit;\n\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n        rename(input = color, to = tone);\n    }\n\n    widget badge {\n        drop(input = shadow, why = \"badges have no shadow\");\n        set(input = size, value = size.S, when = !given(size), why = \"kit@1's badges were small\");\n    }\n\n    widget sparkline {\n        drop(why = \"use plot\");\n    }\n\n    record stat {\n        rename(field = label, to = title);\n        add(field = unit, value = \"\", why = \"a stat names its unit\");\n    }\n\n    enum state {\n        rename(from = state.LATE, to = state.OVERDUE);\n    }\n}\n";
    const OLD_DOC: &str = "import kit;\n\n$state {\n    s: state = state.LATE;\n}\n@@@\n# Report\n\n@chart(values = [1, 2], color = color.OK);\n\n@badge(label = \"Beta\", shadow = true);\n\n@sparkline(values = [3]);\n\n@stats(items = [stat { label = \"Deploys\", value = \"42\" }]);\n";

    fn request(migration: &str) -> Value {
        json!({
            "sources": [{ "path": "kit/kit.xtpack", "text": KIT2 }, { "path": "kit/surfaces/kit@1.xtpack", "text": KIT1_SURFACE }, { "path": "kit/migrations/kit@2.xtpack", "text": migration }],
            "docs": [{ "path": "docs/report.xt.md", "text": OLD_DOC }],
            "config": { "path": "xtmd.toml", "text": "packs = [\"kit\"]\n\n[uses]\nkit = 1\n" },
        })
    }

    fn run(c: &Compiler, req: &Value) -> Value {
        serde_json::from_str(&migrate_json(c, req)).unwrap()
    }

    /// The migration's questions are the process's, as they are the xtmd command's: one test at a time.
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn a_document_written_for_a_pack_s_earlier_version_moves_as_xtmd_migrate_moves_it() {
        let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let c = Compiler::new();
        let r = run(&c, &request(MIGRATION));
        assert_eq!(r["questions"], json!([]), "{}", r);
        let f = &r["files"][0];
        assert_eq!((f["result"].as_str(), f["moved"][0].as_str(), f["deletions"].as_array().map(Vec::len)), (Some("migrate"), Some("kit@1 → kit@2"), Some(2)), "{}", r);
        assert_eq!(
            f["text"],
            "import kit;\n\n$state {\n    s: state = state.OVERDUE;\n}\n@@@\n# Report\n\n@plot(values = [1, 2], tone = color.OK);\n\n@badge(label = \"Beta\", size = size.S);\n\n@// kit@2 dropped sparkline: use plot\n@// @sparkline(values = [3]);\n\n@stats(items = [stat { title = \"Deploys\", value = \"42\", unit = \"\" }]);\n"
        );
        // xtmd.toml moves with it: the pack's version, and this release
        assert_eq!(r["config"]["text"], format!("xtmd = \"{}\"\npacks = [\"kit\"]\n\n[uses]\nkit = 2\n", RELEASE));
        // nothing is kept from one run to the next
        assert_eq!(run(&c, &request(MIGRATION)), r);
    }

    #[test]
    fn a_question_waits_for_its_answer_and_the_answer_moves_it() {
        let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let c = Compiler::new();
        let split = MIGRATION.replace("rename(from = state.LATE, to = state.OVERDUE);", "split(from = state.LATE, to = [state.OVERDUE, state.DONE], why = \"late is now overdue, or done\");");
        let r = run(&c, &request(&split));
        let q = &r["questions"][0];
        assert_eq!((q["number"].as_u64(), q["key"].as_str(), q["options"].clone()), (Some(1), Some("docs/report.xt.md:4 LATE"), json!(["OVERDUE", "DONE"])), "{}", r);
        // planned with the questions open, the tree isn't moved
        assert_eq!(r["config"], Value::Null);
        let mut req = request(&split);
        req["answers"] = json!({ "split": { "docs/report.xt.md:4 LATE": "DONE" } });
        let r = run(&c, &req);
        assert_eq!(r["questions"], json!([]), "{}", r);
        assert!(r["files"][0]["text"].as_str().unwrap().contains("s: state = state.DONE;"), "{}", r);
    }

    #[test]
    fn a_0_2_document_waits_for_the_0_2_step_and_a_newer_tree_is_refused() {
        let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let c = Compiler::new();
        let doc = "---\nmkp: 0.2.10\n---\n# A\n\n```mkp\ncounter\n```\n";
        let docs = json!([{ "path": "docs/a.mkp.md", "text": doc }]);
        let r = run(&c, &json!({ "docs": docs }));
        assert_eq!(r["needs02"], json!(["docs/a.mkp.md"]));
        assert_eq!(r["files"][0]["result"], "refused");
        // what the step printed: the document as 0.3, under its new name
        let ran = json!({ "release": "0.2.10", "doc": "// Migrated from MKP 0.2.\n// Nothing to finish by hand.\n@@@\n# A\n", "packs": {}, "notes": [], "counts": { "widgets": 1 } });
        let r = run(&c, &json!({ "docs": docs, "step02": { "docs/a.mkp.md": ran } }));
        let f = &r["files"][0];
        assert_eq!((f["result"].as_str(), f["to"].as_str(), r["needs02"].clone()), (Some("migrate"), Some("docs/a.xt.md"), json!([])), "{}", r);
        // where the step can't run, the document is refused with why
        let r = run(&c, &json!({ "docs": docs, "step02": { "docs/a.mkp.md": { "notRun": "no Node here" } } }));
        assert_eq!(r["files"][0]["refused"], json!(["no Node here"]));
        let newer = run(&c, &json!({ "config": { "path": "xtmd.toml", "text": "xtmd = \"9.0.0\"\n" } }));
        assert!(newer["error"].as_str().unwrap().contains("newer than this extension's"), "{}", newer);
    }
}
