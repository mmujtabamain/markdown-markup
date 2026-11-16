//! A surface (`package kit@1;`) is read beside its pack and never joins the pack's scope.

use mkp_check::{compile, Source};
use std::path::PathBuf;

fn core_sources() -> Vec<Source> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "mkp")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

const PACK: &str = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides plot, badge;\n}\n\nextern widget plot(values: list<number>);\nextern widget badge(label: text);\n";
const MIGRATION: &str = "package kit;\n\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n    }\n}\n";
const SURFACE: &str = "package kit@1;\n\nextern widget chart(values: list<number>);\nextern widget badge(label: text, shadow: bool = false);\n";

fn src(path: &str, text: &str) -> Source {
    Source { path: path.into(), text: text.into() }
}

#[test]
fn a_pack_with_a_surface_beside_it_compiles_and_documents_see_only_the_pack() {
    let packs = vec![src("kit/kit.mkp", PACK), src("kit/migrations/kit@2.mkp", MIGRATION), src("kit/surfaces/kit@1.mkp", SURFACE)];
    let ok = compile(&core_sources(), &[packs.clone()], &[src("doc.mkp.md", "import kit;\n@@@\n@badge(label = \"new\");\n")], "doc");
    assert!(ok.module.is_some(), "{:?}", ok.diagnostics.iter().map(|d| &d.diagnostic.message).collect::<Vec<_>>());
    // the surface's chart is kit@1's, which kit@2 no longer has
    let old = compile(&core_sources(), &[packs], &[src("doc.mkp.md", "import kit;\n@@@\n@chart(values = [1]);\n")], "doc");
    assert!(old.module.is_none());
}

#[test]
fn a_surface_holds_signatures_only() {
    let bad = "package kit@1;\n\nfn f(): number {\n    return 1;\n}\n";
    let c = compile(&core_sources(), &[vec![src("kit/kit.mkp", PACK), src("kit/surfaces/kit@1.mkp", bad)]], &[], "main");
    assert!(c.diagnostics.iter().any(|d| d.diagnostic.code == "pack.surface" && d.diagnostic.message.contains("extern fn")));
}

const KIT1: &str = "package kit;\n\npack kit@1 {\n    uses core@1;\n    provides chart, stat, state;\n}\n\nrecord stat {\n    label: text[1...];\n    value: text;\n}\n\nenum state { DONE, LATE }\n\nextern widget chart(values: list<number>, color: color = color.ACCENT);\n";
const KIT1_SURFACE: &str = "package kit@1;\n\nrecord stat {\n    label: text[1...];\n    value: text;\n}\n\nenum state { DONE, LATE }\n\nextern widget chart(values: list<number>, color: color = color.ACCENT);\n";

fn promise(pack: &str) -> Vec<String> {
    let c = compile(&core_sources(), &[vec![src("kit/surfaces/kit@1.mkp", KIT1_SURFACE)]], &[src("kit/kit.mkp", pack)], "main");
    c.diagnostics.iter().filter(|d| d.diagnostic.code == "pack.version-break").map(|d| d.diagnostic.message.clone()).collect()
}

#[test]
fn a_version_keeps_what_its_surface_says() {
    assert_eq!(promise(KIT1), Vec::<String>::new());
    // more is fine: a new widget, an input with a default, a type that takes more
    let more = KIT1.replace("provides chart, stat, state;", "provides chart, stat, state, badge;").replace("label: text[1...];", "label: text;").replace("color: color = color.ACCENT)", "color: color = color.ACCENT, small: bool = false)") + "extern widget badge(label: text);\n";
    assert_eq!(promise(&more), Vec::<String>::new());
}

#[test]
fn a_break_without_a_new_version_is_a_compile_error() {
    let broken = KIT1.replace("color: color = color.ACCENT", "tone: color = color.ACCENT").replace("enum state { DONE, LATE }", "enum state { DONE, LATE, LOST }").replace("value: text;", "value: text;\n    unit: text;");
    let found = promise(&broken);
    assert_eq!(found.len(), 3, "{:?}", found);
    assert!(found.iter().any(|m| m.contains("`chart` has no input `color` now")));
    assert!(found.iter().any(|m| m.contains("`state` has a new case `LOST`")));
    assert!(found.iter().any(|m| m.contains("`stat` has a new field `unit` with no default")));
    assert!(found.iter().all(|m| m.contains("write `pack kit@2`")));
    let default = KIT1.replace("color: color = color.ACCENT", "color: color = color.OK");
    assert!(promise(&default)[0].contains("default was `color.ACCENT` and is `color.OK` now"));
}

#[test]
fn a_surface_never_reaches_the_ir() {
    let c = compile(&core_sources(), &[vec![src("kit/kit.mkp", KIT1), src("kit/surfaces/kit@1.mkp", KIT1_SURFACE)]], &[src("doc.mkp.md", "import kit;\n@@@\n@chart(values = [1]);\n")], "doc");
    let json = serde_json::to_string(&c.module.expect("compiles")).unwrap();
    assert!(!json.contains("kit@1"), "a surface's names are in the IR");
}

const KIT2: &str = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides plot, stat, state;\n}\n\nrecord stat {\n    title: text[1...];\n    value: text;\n    unit: text;\n}\n\nenum state { DONE, OVERDUE }\n\nextern widget plot(values: list<number>, tone: color = color.ACCENT);\n";

fn migrate(migration: &str) -> Vec<(String, String)> {
    let c = compile(&core_sources(), &[vec![src("kit/kit.mkp", KIT2), src("kit/surfaces/kit@1.mkp", KIT1_SURFACE)]], &[src("kit/migrations/kit@2.mkp", migration)], "main");
    c.diagnostics.iter().filter(|d| d.diagnostic.code.starts_with("pack.")).map(|d| (d.diagnostic.code.to_string(), d.diagnostic.message.clone())).collect()
}

const COMPLETE: &str = "package kit;\n\nmigration fn color_to_tone() {\n    rename(input = color, to = tone);\n}\n\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n        color_to_tone();\n    }\n\n    record stat {\n        rename(field = label, to = title);\n        add(field = unit, value = \"\", why = \"a stat names its unit\");\n    }\n\n    enum state {\n        rename(from = state.LATE, to = state.OVERDUE);\n    }\n}\n";

#[test]
fn a_complete_migration_compiles() {
    assert_eq!(migrate(COMPLETE), Vec::<(String, String)>::new());
    // execute says everything about its declaration
    let executed = COMPLETE.replace("        rename(to = plot);\n        color_to_tone();\n", "        rename(to = plot);\n        execute {\n            return @plot(values = values, tone = color);\n        }\n");
    assert_eq!(migrate(&executed), Vec::<(String, String)>::new());
}

#[test]
fn a_migration_names_only_what_is_there() {
    let found = migrate(&COMPLETE.replace("rename(field = label, to = title)", "rename(field = lable, to = title)").replace("enum state {", "enum stage {").replace("add(field = unit,", "add(field = units,"));
    let messages: Vec<&str> = found.iter().filter(|(c, _)| c == "pack.migration").map(|(_, m)| m.as_str()).collect();
    assert!(messages.iter().any(|m| m.contains("`stat` has no field `lable` at this point; it has `label`, `value`")), "{:?}", messages);
    assert!(messages.iter().any(|m| m.contains("kit@1 had no enum `stage`; its enums are `state`")), "{:?}", messages);
    assert!(messages.iter().any(|m| m.contains("has no field `units`")), "{:?}", messages);
    assert!(migrate(&COMPLETE.replace("rename(to = plot);", "shrink(to = plot);")).iter().any(|(_, m)| m.contains("`shrink` isn't a migration statement or a migration fn")));
}

#[test]
fn a_migration_that_leaves_a_change_unsaid_is_incomplete() {
    let found = migrate(&COMPLETE.replace("        add(field = unit, value = \"\", why = \"a stat names its unit\");\n", "").replace("    enum state {\n        rename(from = state.LATE, to = state.OVERDUE);\n    }\n", ""));
    let incomplete: Vec<&str> = found.iter().filter(|(c, _)| c == "pack.migration-incomplete").map(|(_, m)| m.as_str()).collect();
    assert_eq!(incomplete.len(), 2, "{:?}", incomplete);
    assert!(incomplete.iter().any(|m| m.contains("`stat` has a new field `unit` with no default") && m.contains("add(")));
    assert!(incomplete.iter().any(|m| m.contains("`state` has no case `LATE` now")));
}

#[test]
fn migrations_form_a_chain_from_a_surface() {
    let found = migrate(&COMPLETE.replace("migration kit@1 to kit@2 {", "migration kit@0 to kit@2 {"));
    assert!(found.iter().any(|(_, m)| m.contains("needs kit@0's surface")), "{:?}", found);
    let found = migrate(&COMPLETE.replace("migration kit@1 to kit@2 {", "migration kit@1 to kit@3 {"));
    assert!(found.iter().any(|(_, m)| m.contains("a migration moves uses to a later version, and kit is at kit@2")), "{:?}", found);
}
