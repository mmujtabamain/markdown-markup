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
