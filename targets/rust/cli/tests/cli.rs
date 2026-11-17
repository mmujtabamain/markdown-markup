//! The `mkp` binary itself: `check` runs the whole checker, and `--pack` takes folders and files.

use std::path::PathBuf;
use std::process::Command;

fn mkp(args: &[&str]) -> (i32, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_mkp")).args(args).output().unwrap();
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned())
}

fn scratch(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mkp-cli-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for (path, text) in files {
        let p = dir.join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

const SHELF: &str = "package shelf;\n\npack shelf@1 {\n    provides row_of_books;\n}\n\nwidget row_of_books(title: text) {\n    view {\n        @label(value = title);\n    }\n    markdown {\n        \\{title}\n    }\n}\n";
const DOC: &str = "import shelf;\n@@@\n# Books\n\n@row_of_books(title = \"Read\");\n";

#[test]
fn check_reports_the_checker_s_errors() {
    let dir = scratch("check", &[("bad.mkp", "package t;\n\nlet x: number = y;\n")]);
    let (code, _, err) = mkp(&["check", dir.join("bad.mkp").to_str().unwrap()]);
    assert_eq!(code, 1);
    assert!(err.contains("bad.mkp:3:17: error[names.unknown-name]"), "{}", err);
    let (code, out, _) = mkp(&["check", "--json", dir.join("bad.mkp").to_str().unwrap()]);
    assert_eq!(code, 1);
    let found: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(found[0]["code"], "names.unknown-name");
    assert_eq!((found[0]["line"].as_u64(), found[0]["column"].as_u64()), (Some(3), Some(17)));
}

#[test]
fn packs_from_folders_and_files() {
    let dir = scratch("packs", &[("packs/shelf/shelf.mkp", SHELF), ("extra.mkp", "package extra;\n\nlet answer: number = 42;\n"), ("doc.mkp.md", DOC)]);
    let doc = dir.join("doc.mkp.md");
    let (code, _, err) = mkp(&["check", doc.to_str().unwrap()]);
    assert_eq!(code, 1, "no pack given: {}", err);
    assert!(err.contains("names.unknown-pack"), "{}", err);
    let packs = format!("{},{}", dir.join("packs").display(), dir.join("extra.mkp").display());
    let (code, _, err) = mkp(&["check", "--pack", &packs, doc.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    let out = dir.join("doc.ir.json");
    let (code, _, err) = mkp(&["build", doc.to_str().unwrap(), "--pack", &packs, "-o", out.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    let ir: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    assert!(ir.to_string().contains("shelf/row_of_books"), "the pack's widget is in the IR");
    let (code, _, err) = mkp(&["build", doc.to_str().unwrap(), "--pack", "nowhere.txt"]);
    assert_eq!(code, 2);
    assert!(err.contains("not a folder or a .mkp file"), "{}", err);
}

#[test]
fn an_mkp_toml_names_the_packs() {
    // beside the document
    let dir = scratch("config", &[("packs/shelf/shelf.mkp", SHELF), ("mkp.toml", "packs = [\"packs\"]\n"), ("doc.mkp.md", DOC)]);
    let doc = dir.join("doc.mkp.md");
    let (code, _, err) = mkp(&["check", doc.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    // in a folder above, and named with -c
    let dir = scratch("config-above", &[("site/packs/shelf/shelf.mkp", SHELF), ("site/mkp.toml", "packs = [\"packs\"]\n"), ("site/pages/doc.mkp.md", DOC), ("other.toml", "packs = [\"site/packs\"]\n")]);
    let doc = dir.join("site/pages/doc.mkp.md");
    let (code, _, err) = mkp(&["check", doc.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    let (code, _, err) = mkp(&["build", doc.to_str().unwrap(), "-c", dir.join("other.toml").to_str().unwrap(), "-o", dir.join("doc.ir.json").to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    // a key mkp.toml doesn't have
    let dir = scratch("config-bad", &[("mkp.toml", "pack = [\"packs\"]\n"), ("doc.mkp.md", "# Hi\n")]);
    let (code, _, err) = mkp(&["check", dir.join("doc.mkp.md").to_str().unwrap()]);
    assert_eq!(code, 2, "{}", err);
    assert!(err.contains("unknown field `pack`"), "{}", err);
}

#[test]
fn a_required_capability_a_target_leaves_out_fails_the_run() {
    let yaml = "name: tiny\nlevels: [core.draw]\nsupplies:\n  widgets: [core/*]\n  fns: [core/moment.local]\ncannot:\n  core/math: \"no maths renderer\"\ncheck_adapter: exec false\n";
    let dir = scratch("require", &[("targets/checks/cases/.keep", ""), ("targets/tiny/target.yaml", yaml)]);
    let run = |args: &[&str]| {
        let out = Command::new(env!("CARGO_BIN_EXE_mkp")).args(args).current_dir(&dir).output().unwrap();
        (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stderr).into_owned())
    };
    let (code, err) = run(&["target", "check", "tiny", "--require", "tiny:core/math"]);
    assert_eq!(code, 1);
    assert!(err.contains("tiny can't supply core/math: no maths renderer"), "{}", err);
    let (code, err) = run(&["target", "check", "tiny", "--require", "tiny:acme/chart"]);
    assert_eq!(code, 1);
    assert!(err.contains("tiny can't supply acme/chart: it isn't in the target's supplies"), "{}", err);
    // what it supplies passes the requirement, and the run goes on to its adapter
    let (_, err) = run(&["target", "check", "tiny", "--require", "tiny:core/press", "--require", "tiny:core/moment.local"]);
    assert!(!err.contains("can't supply"), "{}", err);
    let (code, err) = run(&["target", "check", "--require", "tiny"]);
    assert_eq!(code, 2, "{}", err);
}

#[test]
fn surface_writes_what_a_version_provides_and_then_holds_the_pack_to_it() {
    let pack = "package kit;\n\npack kit@1 {\n    provides chart, stat;\n}\n\nrecord stat {\n    label: text;\n    require \"a label\" {\n        return label != \"\";\n    }\n}\n\nrecord inner {\n    n: number;\n}\n\n//@about A chart.\nwidget chart(values: list<number>, color: color = color.ACCENT) {\n    view {\n        @label(value = \"chart\");\n    }\n    markdown {\n        A chart.\n    }\n}\n\nfn stat.first(self): inner {\n    return inner { n = 1 };\n}\n";
    let dir = scratch("surface", &[("kit/kit.mkp", pack)]);
    let kit = dir.join("kit");
    let (code, out, err) = mkp(&["surface", kit.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    assert!(out.contains("wrote kit@1's surface"), "{}", out);
    let written = std::fs::read_to_string(kit.join("surfaces/kit@1.mkp")).unwrap();
    assert_eq!(written, "package kit@1;\n\nrecord stat {\n    label: text;\n}\n\nrecord inner {\n    n: number;\n}\n\n//@about A chart.\nextern widget chart(values: list<number>, color: color = color.ACCENT);\n\nextern fn stat.first(self): inner;\n");
    // a second run changes nothing, and --check agrees
    assert_eq!(mkp(&["surface", kit.to_str().unwrap()]).0, 0);
    assert_eq!(mkp(&["surface", kit.to_str().unwrap(), "--check"]).0, 0);
    // the pack compiles beside it, and a break at the same version doesn't
    assert_eq!(mkp(&["check", "--pack", kit.to_str().unwrap(), kit.join("kit.mkp").to_str().unwrap()]).0, 0);
    std::fs::write(kit.join("kit.mkp"), pack.replace("color: color = color.ACCENT", "tone: color = color.ACCENT")).unwrap();
    let (code, _, err) = mkp(&["check", "--pack", kit.to_str().unwrap(), kit.join("kit.mkp").to_str().unwrap()]);
    assert_eq!(code, 1);
    assert!(err.contains("error[pack.version-break]") && err.contains("`chart` has no input `color` now"), "{}", err);
    // and a changed surface isn't written over without --force
    let (code, _, err) = mkp(&["surface", kit.to_str().unwrap()]);
    assert_eq!(code, 1);
    assert!(err.contains("doesn't compile") || err.contains("already written"), "{}", err);
}

const KIT1_SURFACE: &str = "package kit@1;\n\nrecord stat {\n    label: text;\n    value: text;\n}\n\nenum state { DONE, LATE }\n\nextern widget chart(values: list<number>, color: color = color.ACCENT);\nextern widget badge(label: text, shadow: bool = false);\nextern widget sparkline(values: list<number>);\nextern widget stats(items: list<stat>);\n";
const KIT2: &str = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides plot, badge, stat, state, stats;\n}\n\nrecord stat {\n    title: text;\n    value: text;\n    unit: text;\n}\n\nenum state { DONE, OVERDUE }\n\nextern widget plot(values: list<number>, tone: color = color.ACCENT);\nextern widget badge(label: text, size: size = size.M);\nextern widget stats(items: list<stat>);\n";
const MIGRATION: &str = "package kit;\n\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n        rename(input = color, to = tone);\n    }\n\n    widget badge {\n        drop(input = shadow, why = \"badges have no shadow\");\n        set(input = size, value = size.S, when = !given(size), why = \"kit@1's badges were small\");\n    }\n\n    widget sparkline {\n        drop(why = \"use plot\");\n    }\n\n    record stat {\n        rename(field = label, to = title);\n        add(field = unit, value = \"\", why = \"a stat names its unit\");\n    }\n\n    enum state {\n        rename(from = state.LATE, to = state.OVERDUE);\n    }\n}\n";
const OLD_DOC: &str = "import kit;\n\n$state {\n    s: state = state.LATE;\n}\n@@@\n# Report\n\n@chart(values = [1, 2], color = color.OK);\n\n@badge(label = \"Beta\", shadow = true);\n\n@sparkline(values = [3]);\n\n@stats(items = [stat { label = \"Deploys\", value = \"42\" }]);\n";

fn kit_tree(name: &str, config: &str) -> PathBuf {
    scratch(name, &[("kit/kit.mkp", KIT2), ("kit/surfaces/kit@1.mkp", KIT1_SURFACE), ("kit/migrations/kit@2.mkp", MIGRATION), ("mkp.toml", config), ("docs/report.mkp.md", OLD_DOC)])
}

#[test]
fn migrate_moves_a_document_to_the_packs_version_and_then_leaves_it_alone() {
    let dir = kit_tree("migrate", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n");
    let docs = dir.join("docs");
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--dry-run"]);
    assert_eq!(code, 0, "{}", out);
    assert!(out.contains("kit@1 → kit@2") && out.contains("2 deletions"), "{}", out);
    assert!(out.contains("shadow = true: badges have no shadow") && out.contains("@sparkline(values = [3]) (kept as a comment): use plot"), "{}", out);
    // no terminal and no --yes: nothing is written
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap()]);
    assert_eq!(code, 1);
    assert!(out.contains("Pass --yes to write"), "{}", out);
    assert_eq!(std::fs::read_to_string(docs.join("report.mkp.md")).unwrap(), OLD_DOC);
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert_eq!(
        std::fs::read_to_string(docs.join("report.mkp.md")).unwrap(),
        "import kit;\n\n$state {\n    s: state = state.OVERDUE;\n}\n@@@\n# Report\n\n@plot(values = [1, 2], tone = color.OK);\n\n@badge(label = \"Beta\", size = size.S);\n\n@// kit@2 dropped sparkline: use plot\n@// @sparkline(values = [3]);\n\n@stats(items = [stat { title = \"Deploys\", value = \"42\", unit = \"\" }]);\n"
    );
    assert!(std::fs::read_to_string(dir.join("mkp.toml")).unwrap().contains("[uses]\nkit = 2\n"));
    assert_eq!(mkp(&["check", docs.join("report.mkp.md").to_str().unwrap()]).0, 0);
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--check"]);
    assert_eq!(code, 0, "{}", out);
    assert!(out.contains("up to date"), "{}", out);
}

#[test]
fn migrate_finds_the_version_a_document_compiles_against_and_writes_nothing_broken() {
    // no [uses]: the document compiles against kit@1's surface, so it is written for kit@1
    let dir = kit_tree("migrate-infer", "packs = [\"kit\"]\n");
    let docs = dir.join("docs");
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--dry-run"]);
    assert_eq!(code, 0, "{}", out);
    assert!(out.contains("written for kit@1, as it compiles against that surface"), "{}", out);
    // a decision only a person can make, and no terminal to ask in: reported, left as it was
    std::fs::write(dir.join("kit/migrations/kit@2.mkp"), MIGRATION.replace("rename(from = state.LATE, to = state.OVERDUE);", "split(from = state.LATE, to = [state.OVERDUE, state.DONE], why = \"late is now overdue, or done\");")).unwrap();
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 1);
    assert!(out.contains("not written") && out.contains("only a person knows which this one is"), "{}", out);
    assert_eq!(std::fs::read_to_string(docs.join("report.mkp.md")).unwrap(), OLD_DOC);
    // answered in a file, as CI would: the run writes it
    let key = format!("{}:4 LATE", docs.join("report.mkp.md").display());
    std::fs::write(dir.join("answers.toml"), format!("[split]\n\"{}\" = \"DONE\"\n", key)).unwrap();
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty", "--answers", dir.join("answers.toml").to_str().unwrap()]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert!(std::fs::read_to_string(docs.join("report.mkp.md")).unwrap().contains("s: state = state.DONE;"));
}

#[test]
fn migrate_runs_execute_move_wrap_and_migration_fns_over_each_use() {
    let surface = "package kit@1;\n\nextern widget status(label: text, kind: text = \"info\");\nextern widget callout(text: text);\nextern widget card(title: text) {\n    slot body: view;\n}\nextern widget chart(values: list<number>, color: color = color.ACCENT, width: number = 2);\n";
    let pack = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides status, tone, callout, card, holder, chart, chart_style;\n}\n\nenum tone { INFO, WARN }\n\nrecord chart_style {\n    color: color = color.ACCENT;\n    width: number = 2;\n}\n\nextern widget status(label: text, tone: tone = tone.INFO);\nextern widget callout() {\n    slot body: view;\n}\nextern widget holder(title: text) {\n    slot body: view;\n}\nextern widget card() {\n    slot body: view;\n}\nextern widget chart(values: list<number>, style: chart_style = chart_style {});\n";
    let migration = "package kit;\n\nmigration fn into_style(inputs: list<input>) {\n    nest(inputs = inputs, into = style, why = \"a chart's look is one record now\");\n}\n\nmigration kit@1 to kit@2 {\n    widget status {\n        execute {\n            match (kind) {\n                case \"warn\" {\n                    return @status(label = label, tone = tone.WARN);\n                }\n                case else {\n                    return @status(label = label);\n                }\n            }\n        }\n    }\n\n    widget callout {\n        move(from = text, to = body, why = \"the text is the callout's children now\");\n    }\n\n    widget card {\n        wrap(parent = holder, why = \"a holder keeps the title now\");\n        move(from = title, to = holder.title, why = \"the title is the holder's\");\n    }\n\n    widget chart {\n        into_style(inputs = [color, width]);\n    }\n}\n";
    let doc = "import kit;\n@@@\n# Ops\n\n@status(label = \"Deploys\", kind = \"warn\");\n@status(label = \"Builds\");\n\n@callout(text = \"Deploys pause on Friday.\");\n\n@card(title = \"Q3\") {\nRevenue grew.\n}\n\n@chart(values = [1, 2], color = color.OK);\n";
    let dir = scratch("migrate-execute", &[("kit/kit.mkp", pack), ("kit/surfaces/kit@1.mkp", surface), ("kit/migrations/kit@2.mkp", migration), ("mkp.toml", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n"), ("docs/ops.mkp.md", doc)]);
    let docs = dir.join("docs");
    assert_eq!(mkp(&["check", "--pack", dir.join("kit").to_str().unwrap(), dir.join("kit/migrations/kit@2.mkp").to_str().unwrap()]).0, 0, "the migration itself checks");
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert_eq!(
        std::fs::read_to_string(docs.join("ops.mkp.md")).unwrap(),
        "import kit;\n@@@\n# Ops\n\n@status(label = \"Deploys\", tone = tone.WARN);\n@status(label = \"Builds\");\n\n@callout {\nDeploys pause on Friday.\n}\n\n@holder(title = \"Q3\") {\n@card {\nRevenue grew.\n}\n}\n\n@chart(values = [1, 2], style = chart_style { color = color.OK });\n"
    );
}

#[test]
fn migrate_renames_fn_calls_and_changes_handlers_for_an_events_new_arguments() {
    let surface = "package kit@1;\n\nextern fn text.slug(self): text;\n\nextern widget button(label: text) {\n    event click();\n}\n";
    let pack = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides button;\n}\n\nextern fn text.slugify(self, sep: text): text;\n\nextern widget button(label: text) {\n    event press(at: point);\n}\n";
    let migration = "package kit;\n\nmigration kit@1 to kit@2 {\n    fn text.slug {\n        rename(to = slugify);\n        add(arg = sep, value = \"-\");\n    }\n\n    widget button {\n        event click {\n            rename(to = press);\n            add(arg = at);\n        }\n    }\n}\n";
    let doc = "import kit;\n\n$state {\n    n: number = 0;\n}\n\nfn id_of(t: text): text {\n    return t.slug();\n}\n@@@\n@button(label = \"Add\", click = fn() { $state.n = $state.n + 1; });\n";
    let dir = scratch("migrate-fns", &[("kit/kit.mkp", pack), ("kit/surfaces/kit@1.mkp", surface), ("kit/migrations/kit@2.mkp", migration), ("mkp.toml", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n"), ("docs/a.mkp.md", doc)]);
    let docs = dir.join("docs");
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert_eq!(
        std::fs::read_to_string(docs.join("a.mkp.md")).unwrap(),
        "import kit;\n\n$state {\n    n: number = 0;\n}\n\nfn id_of(t: text): text {\n    return t.slugify(\"-\");\n}\n@@@\n@button(label = \"Add\", press = fn(at: point) { $state.n = $state.n + 1; });\n"
    );
}

#[test]
fn migrate_moves_a_pack_that_uses_a_migrated_pack_and_its_uses_line() {
    let report = "package report;\n\nimport kit;\n\npack report@1 {\n    uses core@1, kit@1;\n    provides summary;\n}\n\nwidget summary(n: number) {\n    view {\n        @chart(values = [n], color = color.OK);\n    }\n    markdown {\n        A summary.\n    }\n}\n";
    let doc = "import report;\n@@@\n@summary(n = 3);\n";
    let dir = scratch("migrate-pack", &[("kit/kit.mkp", KIT2), ("kit/surfaces/kit@1.mkp", KIT1_SURFACE), ("kit/migrations/kit@2.mkp", MIGRATION), ("report/report.mkp", report), ("mkp.toml", "packs = [\"kit\", \"report\"]\n"), ("docs/a.mkp.md", doc)]);
    let (code, out, err) = mkp(&["migrate", dir.join("docs").to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert!(out.contains("report.mkp  kit@1 → kit@2"), "{}", out);
    let moved = std::fs::read_to_string(dir.join("report/report.mkp")).unwrap();
    assert!(moved.contains("    uses core@1, kit@2;\n") && moved.contains("        @plot(values = [n], tone = color.OK);\n"), "{}", moved);
    assert_eq!(mkp(&["check", "--pack", &format!("{},{}", dir.join("kit").display(), dir.join("report").display()), dir.join("docs/a.mkp.md").to_str().unwrap()]).0, 0);
}

#[test]
fn migrate_keeps_a_change_inside_a_use_it_also_changes() {
    // the outer widget's block comes first in the migration, the inner record's after it
    let surface = "package kit@1;\n\nrecord stat {\n    label: text;\n    value: text;\n}\n\nextern widget stats(items: list<stat>);\n";
    let pack = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides board, stat;\n}\n\nrecord stat {\n    title: text;\n    value: text;\n}\n\nextern widget board(rows: list<stat>);\n";
    let migration = "package kit;\n\nmigration kit@1 to kit@2 {\n    widget stats {\n        rename(to = board);\n        rename(input = items, to = rows);\n    }\n\n    record stat {\n        rename(field = label, to = title);\n    }\n}\n";
    let doc = "import kit;\n@@@\n@stats(items = [stat { label = \"A\", value = \"1\" }, stat { label = \"B\", value = \"2\" }]);\n";
    let dir = scratch("migrate-nested", &[("kit/kit.mkp", pack), ("kit/surfaces/kit@1.mkp", surface), ("kit/migrations/kit@2.mkp", migration), ("mkp.toml", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n"), ("docs/a.mkp.md", doc)]);
    let docs = dir.join("docs");
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert_eq!(std::fs::read_to_string(docs.join("a.mkp.md")).unwrap(), "import kit;\n@@@\n@board(rows = [stat { title = \"A\", value = \"1\" }, stat { title = \"B\", value = \"2\" }]);\n");
}

#[test]
fn a_hole_shows_the_theme_in_words() {
    let dir = scratch("theme", &[("t.mkp.md", "$state {\n    t: theme = theme.DARK;\n}\n@@@\nThis page is drawn in the \\{$state.t} theme.\n")]);
    let (code, out, err) = mkp(&["md", dir.join("t.mkp.md").to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    assert_eq!(out.trim(), "This page is drawn in the dark theme.");
}

#[test]
fn a_long_line_of_inline_markdown_reads_within_the_step_limit() {
    // 0.2's changelog has a 3,189-character list item of code spans; emphasis is as costly a case
    let code: Vec<String> = (0..400).map(|k| format!("`name{}`", k)).collect();
    let em: Vec<String> = (0..300).map(|k| format!("*w{}*", k)).collect();
    let doc = format!("@@@\n# Changes\n\n- {}\n- {}\n", code.join(", "), em.join(", "));
    assert!(doc.len() > 5000);
    let dir = scratch("long-inline", &[("t.mkp.md", &doc)]);
    let (code, out, err) = mkp(&["md", dir.join("t.mkp.md").to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    assert!(out.contains("`name399`") && out.contains("*w299*"), "{}", &out[..200.min(out.len())]);
}

#[test]
fn migrate_keeps_a_rewritten_uses_lines_and_comments() {
    let surface = "package kit@1;\n\nextern widget chart(values: list<number>, color: color = color.ACCENT, title: text = \"\");\n";
    let pack = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides plot;\n}\n\nextern widget plot(values: list<number>, tone: color = color.ACCENT, title: text = \"\");\n";
    let migration = "package kit;\n\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n        rename(input = color, to = tone);\n    }\n}\n";
    let doc = "import kit;\n\nwidget panel() {\n    view {\n        @chart(\n            // the week's numbers\n            values = [1, 2, 3],\n            color = color.OK,   // green for good\n            title = \"Sales\",\n        );\n    }\n}\n@@@\n@panel;\n\n@chart(values = [4], color = color.BAD);\n";
    let dir = scratch("migrate-comments", &[("kit/kit.mkp", pack), ("kit/surfaces/kit@1.mkp", surface), ("kit/migrations/kit@2.mkp", migration), ("mkp.toml", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n"), ("docs/a.mkp.md", doc)]);
    let docs = dir.join("docs");
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    let moved = std::fs::read_to_string(docs.join("a.mkp.md")).unwrap();
    assert_eq!(moved, "import kit;\n\nwidget panel() {\n    view {\n        @plot(\n            // the week's numbers\n            values = [1, 2, 3],\n            tone = color.OK,   // green for good\n            title = \"Sales\",\n        );\n    }\n}\n@@@\n@panel;\n\n@plot(values = [4], tone = color.BAD);\n");
    // what it wrote is canonical
    assert_eq!(mkp(&["fmt", "--check", docs.join("a.mkp.md").to_str().unwrap()]).0, 0);
}

#[test]
fn migrate_numbers_its_questions_and_yes_answers_the_ones_named() {
    let dir = kit_tree("migrate-yes", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n");
    let migration = MIGRATION
        .replace("when = !given(size)", "when = confirm(why = \"Make kit@1's badges small?\")")
        .replace("rename(input = color, to = tone);", "rename(input = color, to = tone);\n        set(input = tone, value = color.ACCENT, when = confirm(why = \"Reset every chart's tone?\"), why = \"one tone for charts\");");
    std::fs::write(dir.join("kit/migrations/kit@2.mkp"), migration).unwrap();
    let docs = dir.join("docs");
    // no terminal: every question is a no, and the summary says how to answer each
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--dry-run"]);
    assert_eq!(code, 0, "{}", out);
    assert!(out.contains("questions:\n  1. Make kit@1's badges small?  no: nobody to ask (--yes 1 answers yes)\n  2. Reset every chart's tone?  no: nobody to ask (--yes 2 answers yes)"), "{}", out);
    // --yes 2: yes to the second only, and the files are written
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "2", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert!(out.contains("1. Make kit@1's badges small?  no: --yes") && out.contains("2. Reset every chart's tone?  yes: --yes"), "{}", out);
    let text = std::fs::read_to_string(docs.join("report.mkp.md")).unwrap();
    assert!(text.contains("@plot(values = [1, 2], tone = color.ACCENT);") && text.contains("@badge(label = \"Beta\");"), "{}", text);
    // and a number that isn't one is a usage error, as is --yes= with nothing
    assert_eq!(mkp(&["migrate", docs.to_str().unwrap(), "--yes=", "--dry-run"]).0, 2);
}

#[test]
fn migrate_leaves_a_todo_with_todo_and_writes_errors_only_with_allow_errors() {
    let doc = format!("{}\n@badge(label = $state.s == state.LATE ? \"Late\" : \"On time\");\n", OLD_DOC);
    let dir = scratch("migrate-todo", &[("kit/kit.mkp", KIT2), ("kit/surfaces/kit@1.mkp", KIT1_SURFACE), ("kit/migrations/kit@2.mkp", &MIGRATION.replace("rename(from = state.LATE, to = state.OVERDUE);", "split(from = state.LATE, to = [state.OVERDUE, state.DONE], why = \"late is now overdue, or done\");")), ("mkp.toml", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n"), ("docs/report.mkp.md", &doc)]);
    let docs = dir.join("docs");
    let file = docs.join("report.mkp.md");
    // --todo leaves both cases as they were, with a TODO, and the file then doesn't compile
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty", "--todo"]);
    assert_eq!(code, 1);
    assert!(out.contains("not written") && out.contains("it doesn't compile afterwards"), "{}", out);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), doc);
    // --allow-errors writes it, says so, and the run still fails: a person has to finish it
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty", "--todo", "--allow-errors"]);
    assert_eq!(code, 1, "{}{}", out, err);
    assert!(out.contains("left for a person, each with a TODO above it:") && out.contains("written with errors (--allow-errors):"), "{}", out);
    let text = std::fs::read_to_string(&file).unwrap();
    // in code, `//`; on a line of prose, `@//`; the rest of the migration is done around them
    assert!(text.contains("$state {\n    // TODO(mkp migrate): kit@2 splits LATE into OVERDUE or DONE: write the one this is (late is now overdue, or done)\n"), "{}", text);
    assert!(text.contains("\n    s: state = state.LATE;\n"), "{}", text);
    assert!(text.contains("\n@// TODO(mkp migrate): kit@2 splits LATE into OVERDUE or DONE: write the one this is (late is now overdue, or done)\n@badge(") && text.contains("\n@badge(label = $state.s == state.LATE ? \"Late\" : \"On time\", size = size.S);\n"), "{}", text);
    assert!(text.contains("@plot(values = [1, 2], tone = color.OK);"), "{}", text);
}

#[test]
fn migrate_takes_a_prose_calls_block_from_the_parser_fences_and_all() {
    let surface = "package kit@1;\n\nextern widget card(title: text) {\n    slot body: view;\n}\n";
    let pack = "package kit;\n\npack kit@2 {\n    uses core@1;\n    provides card, holder;\n}\n\nextern widget holder(title: text) {\n    slot body: view;\n}\nextern widget card() {\n    slot body: view;\n}\n";
    let migration = "package kit;\n\nmigration kit@1 to kit@2 {\n    widget card {\n        wrap(parent = holder, why = \"a holder keeps the title now\");\n        move(from = title, to = holder.title, why = \"the title is the holder's\");\n    }\n}\n";
    // a fence in the block holds a line that is only `}`: the block doesn't end there
    let doc = "import kit;\n@@@\n# Code\n\n@card(title = \"Q3\") {\n```js\nif (x) {\n}\n```\n}\n\nAfter.\n";
    let dir = scratch("migrate-fence", &[("kit/kit.mkp", pack), ("kit/surfaces/kit@1.mkp", surface), ("kit/migrations/kit@2.mkp", migration), ("mkp.toml", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n"), ("docs/code.mkp.md", doc)]);
    let docs = dir.join("docs");
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert_eq!(std::fs::read_to_string(docs.join("code.mkp.md")).unwrap(), "import kit;\n@@@\n# Code\n\n@holder(title = \"Q3\") {\n@card {\n```js\nif (x) {\n}\n```\n}\n}\n\nAfter.\n");
}

const COUNTER_02: &str = "---\nteaches: \"reader state, a press and an event\"\n---\n# A counter\n\n```mkp\ncounter \"A number the reader steps up or down.\"\n  in start int = 0 \"where it begins\"\n  var n int = start\n  row gap=m align=center\n    press label=\"one less\"\n      icon name=minus\n      @click set n=(n - 1)\n    text \"\\val{n}\" font=mono size=large weight=bold\n    press label=\"one more\"\n      icon name=plus\n      @click set n=(n + 1)\n  project md = \"Count: \" + format(n, 0)\n```\n\n```counter\nstart: 3\nsummary: A counter that starts at 3.\n```\n";
const RUNS_02: &str = "---\nmkp: 0.2.10\nir: 1\n---\n# Two runs\n\n```distance@1\nkm: 21.0975\nlabel: A half marathon\nsummary: A half marathon's distance.\n```\n";
const UNITS_02_MANIFEST: &str = "pack units@1 \"Distances shown in kilometres and miles.\"\n  requires core@1\n  provides distance\n";
const UNITS_02_DISTANCE: &str = "distance@1 \"A distance in kilometres, with its miles beside it.\"\n  in km num \"the distance in kilometres\"\n  in label text = \"\" \"what the distance is\"\n  miles = km / 1.609344\n  row gap=s align=baseline\n    text label tone=muted if=(label != \"\")\n    text \"\\val{format(km, 1)} km\" font=mono weight=bold\n    text \"(\\val{format(miles, 1)} mi)\" tone=muted\n  project md = (if(label != \"\", label + \": \", \"\")) + format(km, 1) + \" km (\" + format(miles, 1) + \" mi)\"\n";

#[test]
fn migrate_moves_a_0_2_document_with_0_2_10s_own_compiler() {
    let plain = "# Notes\n\n```js\nlet x = 1;\n```\n";
    let files = [("docs/counter.mkp.md", COUNTER_02), ("docs/runs.mkp.md", RUNS_02), ("docs/plain.mkp.md", plain), ("old/units/manifest.mkp", UNITS_02_MANIFEST), ("old/units/distance.mkp", UNITS_02_DISTANCE)];
    let dir = scratch("migrate-02", &files);
    let (docs, old) = (dir.join("docs"), dir.join("old/units"));
    let (d, o) = (docs.to_str().unwrap(), old.to_str().unwrap());
    // the counter is 0.2's by what 0.2.10 finds in it, runs.mkp.md by its stamp; plain Markdown reads the same in both
    let (code, out, _) = mkp(&["migrate", d, "--pack", o, "--dry-run"]);
    assert_eq!(code, 1, "{}", out);
    assert!(out.contains("counter.mkp.md  mkp 0.2 → 0.3  1 change; 1 to know (written for MKP 0.2, as 0.2.10 builds it)"), "{}", out);
    assert!(out.contains("plain.mkp.md    up to date"), "{}", out);
    // units has no 0.3 release here: only a stand-in, so runs.mkp.md is refused without --todo
    assert!(out.contains("runs.mkp.md     mkp 0.2 → 0.3  not written: 0.3 can't yet say 1 thing") && out.contains("--todo writes it"), "{}", out);
    let (code, out, err) = mkp(&["migrate", d, "--pack", o, "--yes", "--todo"]);
    assert_eq!(code, 1, "a stand-in is a person's to replace: {}{}", out, err);
    let counter = std::fs::read_to_string(docs.join("counter.mkp.md")).unwrap();
    assert!(counter.contains("widget counter(start: int = 0) {") && counter.contains("\n@@@\n") && counter.contains("@counter(start = 3);"), "{}", counter);
    assert_eq!(std::fs::read_to_string(docs.join("plain.mkp.md")).unwrap(), plain);
    let stand_in = std::fs::read_to_string(docs.join("stand-ins/units/units.mkp")).unwrap();
    assert!(stand_in.starts_with("package units;\n// TODO(mkp migrate): a stand-in made from the 0.2 definitions of units,") && stand_in.contains("extern widget distance(km: number"), "{}", stand_in);
    let runs = std::fs::read_to_string(docs.join("runs.mkp.md")).unwrap();
    assert!(!runs.contains("mkp: 0.2.10") && runs.contains("import units;") && runs.contains("@distance(km = 21.0975, label = \"A half marathon\""), "{}", runs);
    let stand_ins = docs.join("stand-ins");
    assert_eq!(mkp(&["check", "--pack", stand_ins.to_str().unwrap(), docs.join("runs.mkp.md").to_str().unwrap(), docs.join("counter.mkp.md").to_str().unwrap()]).0, 0);
    // now 0.3: a second run leaves them alone
    let (code, out, _) = mkp(&["migrate", d, "--pack", &format!("{},{}", stand_ins.display(), o), "--check"]);
    assert_eq!(code, 0, "{}", out);
}

#[test]
fn migrate_uses_a_packs_own_0_3_release_and_checks_the_0_2_step_it_runs() {
    let units3 = "package units;\n\npack units@1 {\n    uses core@1;\n    provides distance;\n}\n\nextern widget distance(km: number, label: text = \"\", summary: text = \"\");\n";
    let dir = scratch("migrate-02-own", &[("docs/runs.mkp.md", RUNS_02), ("old/units/manifest.mkp", UNITS_02_MANIFEST), ("old/units/distance.mkp", UNITS_02_DISTANCE), ("units/units.mkp", units3)]);
    let docs = dir.join("docs");
    let packs = format!("{},{}", dir.join("old/units").display(), dir.join("units").display());
    // with units' own 0.3 release in the build, nothing is a stand-in and nothing needs --todo
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--pack", &packs, "--yes"]);
    assert_eq!(code, 0, "{}{}", out, err);
    assert!(!docs.join("stand-ins").exists());
    assert_eq!(mkp(&["check", "--pack", dir.join("units").to_str().unwrap(), docs.join("runs.mkp.md").to_str().unwrap()]).0, 0);
    // a frozen step that isn't the one mkp was built with is never run
    std::fs::write(docs.join("runs.mkp.md"), RUNS_02).unwrap();
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tools/migrate-0.2/frozen/migrate-0.2.cjs");
    let changed = dir.join("migrate-0.2.cjs");
    std::fs::write(&changed, format!("{}\n// changed\n", std::fs::read_to_string(repo).unwrap())).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_mkp")).args(["migrate", docs.to_str().unwrap(), "--pack", &packs, "--dry-run"]).env("MKP_MIGRATE_02", &changed).output().unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1));
    assert!(text.contains("isn't the 0.2 → 0.3 step this mkp was built with (its SHA-256 differs): not run"), "{}", text);
}

#[test]
fn migrate_keeps_the_release_a_tree_is_written_for_in_mkp_toml() {
    let release = env!("CARGO_PKG_VERSION");
    // no record: taken as 0.3.0, and the run that moves the tree writes this mkp's release
    let dir = kit_tree("migrate-release", "packs = [\"kit\"]\n\n[uses]\nkit = 1\n");
    let docs = dir.join("docs");
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--dry-run"]);
    assert_eq!(code, 0, "{}", out);
    assert!(out.contains(&format!("says no release of mkp, so it is taken as written for 0.3.0, and moves to {}.", release)), "{}", out);
    let (code, out, err) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}{}", out, err);
    let toml = std::fs::read_to_string(dir.join("mkp.toml")).unwrap();
    assert!(toml.starts_with(&format!("mkp = \"{}\"\npacks = [\"kit\"]\n", release)) && toml.contains("[uses]\nkit = 2\n"), "{}", toml);
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--check"]);
    assert_eq!(code, 0, "{}", out);
    assert!(out.contains(&format!("written for mkp {}.", release)), "{}", out);
    // an older record with nothing else to move: --check fails, and a run writes only the record
    std::fs::write(dir.join("mkp.toml"), toml.replace(&format!("mkp = \"{}\"", release), "mkp = \"0.0.1\"")).unwrap();
    assert_eq!(mkp(&["migrate", docs.to_str().unwrap(), "--check"]).0, 1);
    let (code, out, _) = mkp(&["migrate", docs.to_str().unwrap(), "--yes", "--allow-dirty"]);
    assert_eq!(code, 0, "{}", out);
    assert!(std::fs::read_to_string(dir.join("mkp.toml")).unwrap().starts_with(&format!("mkp = \"{}\"\n", release)));
    // a newer release than this mkp, or no release at all, stops it
    std::fs::write(dir.join("mkp.toml"), toml.replace(&format!("mkp = \"{}\"", release), "mkp = \"9.0.0\"")).unwrap();
    let (code, _, err) = mkp(&["migrate", docs.to_str().unwrap(), "--dry-run"]);
    assert_eq!(code, 2);
    assert!(err.contains("written for mkp 9.0.0, which is newer than this mkp"), "{}", err);
    std::fs::write(dir.join("mkp.toml"), toml.replace(&format!("mkp = \"{}\"", release), "mkp = \"soon\"")).unwrap();
    assert_eq!(mkp(&["migrate", docs.to_str().unwrap(), "--dry-run"]).0, 2);
}
