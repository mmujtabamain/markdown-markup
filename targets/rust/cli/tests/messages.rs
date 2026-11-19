//! What `xtmd check` says for the checks that closed the 0.3 gaps (doc #1936, item 4): each
//! message names what is wrong and what to do, where a conformance case checks only the code.

use std::process::Command;

/// `xtmd check` on one file, with any packs beside it: everything it prints.
fn said(name: &str, text: &str, packs: &[(&str, &str)]) -> String {
    let dir = std::env::temp_dir().join(format!("xtmd-messages-{}-{}", name.replace('.', "-"), std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(name), text).unwrap();
    let mut args = vec!["check".to_string()];
    for (path, text) in packs {
        let p = dir.join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        args.push("--pack".into());
        args.push(p.to_str().unwrap().into());
    }
    args.push(dir.join(name).to_str().unwrap().into());
    let out = Command::new(env!("CARGO_BIN_EXE_xtmd")).args(&args).output().unwrap();
    format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))
}

#[test]
fn a_value_written_into_a_list_meets_its_items_contract() {
    let err = said("list.xtpack", "package t;\n\nfn fill(n: number): list<number 0..10> {\n    mut xs: list<number 0..10> = [1];\n    xs.add(11);\n    xs.insert(0, n);\n    xs[0] = 12;\n    return xs;\n}\n", &[]);
    assert!(err.contains("5:12: error[contracts.outside]: 11 is outside `add`'s `item`'s contract, number 0..10"), "{}", err);
    assert!(err.contains("6:18: error[contracts.needs-proof]: `insert`'s `item` is a number 0..10, and nothing proves this value is"), "{}", err);
    assert!(err.contains("7:13: error[contracts.outside]: 12 is outside this place's contract, number 0..10"), "{}", err);
}

#[test]
fn a_lambdas_return_meets_its_contract_and_a_fn_values_call_keeps_it() {
    let err = said("lambda.xtpack", "package t;\n\nfn apply(f: fn(x: number): number 0..10, n: number): number 0..10 {\n    return f(n);\n}\n\nfn go(n: number): number {\n    let b: fn(x: number): number = fn(x: number): number 0..10 { return 11; };\n    return apply(fn(x) { return x; }, n) + b(n);\n}\n", &[]);
    assert!(err.contains("8:73: error[contracts.outside]: 11 is outside the return value's contract, number 0..10"), "{}", err);
    assert!(err.contains("9:33: error[contracts.needs-proof]: the return value is a number 0..10, and nothing proves this value is"), "{}", err);
    // `return f(n);` needs no proof: f's declared type says what it returns
    assert!(!err.contains("lambda.xtpack:4:"), "{}", err);
}

#[test]
fn onlys_values_are_of_its_type_and_compared_with_same() {
    let err = said("only.xtpack", "package t;\n\nrecord pick {\n    side: text only (1, \"left\");\n    shown: list<label> only ([]);\n}\n\nfn day(d: date only (\"2026-11-10\")): date {\n    return d;\n}\n\nlet a: date = day(\"2026-11-10\");\n", &[]);
    assert!(err.contains("4:22: error[types.mismatch]: expected text, found number"), "{}", err);
    assert!(err.contains("5:12: error[contracts.only-needs-same]: `only (…)` lists values of a type that fits `same`, so they can be compared; `list<label>` doesn't"), "{}", err);
    // the date's value is a date: the call with it fits
    assert!(!err.contains("only.xtpack:12:"), "{}", err);
}

#[test]
fn an_exposed_fn_takes_constants_and_returns_nothing() {
    let err = said("expose.xt.md", "$state {\n    points: int 0... = 0;\n}\n\nexpose scores {\n    fn add(mut n: int) {\n        $state.points = n.clamp(0, 100);\n    }\n\n    fn total(): int {\n        return $state.points;\n    }\n\n    fn clear() {\n        return 1;\n    }\n}\n@@@\nPoints.\n", &[]);
    assert!(err.contains("6:16: error[types.exposed-mut-parameter]: `n` can't be `mut`: the app gives `scores.add` its values, and an exposed fn takes them as constants"), "{}", err);
    assert!(err.contains("10:17: error[types.return]: `scores.total` is called by the app, which reads nothing back: an exposed fn returns nothing, so leave out its return type"), "{}", err);
    assert!(err.contains("15:16: error[types.return]: an exposed fn returns nothing: the app calls it and reads nothing back, so `return;` ends it"), "{}", err);
    // the return type is reported once, not again at its `return`
    assert!(!err.contains("expose.xt.md:11:"), "{}", err);
}

#[test]
fn a_channel_fn_is_an_action_and_its_arguments_meet_their_contracts() {
    let err = said("channel.xt.md", "extern scores {\n    fn saved(total: int 0..10);\n}\n\nfn loud(): number {\n    scores.saved(11);\n    return 1;\n}\n\nfn push_and_save(mut xs: list<number>) {\n    xs.add(1);\n    scores.saved(1);\n}\n\nfn quiet(): number {\n    mut xs: list<number> = [];\n    push_and_save(xs);\n    return xs.len();\n}\n@@@\nCounts.\n", &[]);
    assert!(err.contains("6:5: error[effects.action-where-nothing-changes]: `scores.saved` is an action sent to the app, and a fn that returns a value changes nothing: call it from a handler or another action"), "{}", err);
    assert!(err.contains("6:18: error[contracts.outside]: 11 is outside `scores.saved`'s `total`'s contract, int 0..10"), "{}", err);
    assert!(err.contains("17:5: error[effects.action-where-nothing-changes]: `push_and_save` changes more than the locals it is given (`$state`, a variable, an input, an item or an event, or it sends the app an action)"), "{}", err);
}

#[test]
fn a_literal_its_from_reads_names_the_hole_and_the_record_to_build() {
    let err = said("date.xtpack", "package t;\n\nfn first_of(month: int 1..12): date {\n    let start: date = \"2026-\\{month}-01\";\n    return start;\n}\n", &[]);
    assert!(err.contains("4:31: error[types.mismatch]: a date literal is read by `date.from` when the page is built, and `\\{month}` isn't known then: build it instead, `date { year = …, month = month, day = … }`"), "{}", err);
}

#[test]
fn an_import_with_a_version_says_where_versions_are_chosen() {
    let err = said("versions.xt.md", "import kit.limit@1;\n@@@\nKit.\n", &[]);
    assert!(err.contains("1:17: error[syntax.version-in-import]: a document writes no versions: `import kit.limit;`. Whoever builds it decides which version it gets, by the packs it is built with (an xtmd.toml's `[uses]`)"), "{}", err);
    let err = said("shapes.xtpack", "package shapes;\n\nimport kit@1;\n\npack shapes@1 {\n    uses kit@1;\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n", &[]);
    assert!(err.contains("3:11: error[syntax.version-in-import]: an import writes no version: the pack block's `uses kit@…;` says which version of `kit` this pack builds on"), "{}", err);
}

#[test]
fn a_type_fn_is_called_by_the_name_it_is_imported_as() {
    let a = "package a;\n\npack a@1 {\n    provides slug;\n}\n\nfn text.slug(self): text {\n    return self.lower();\n}\n";
    let b = "package b;\n\npack b@1 {\n    provides slug;\n}\n\nfn text.slug(self): text {\n    return self.upper();\n}\n";
    let packs = [("a/a.xtpack", a), ("b/b.xtpack", b)];
    // renamed, it is called by its new name, and the old name is the other pack's
    let err = said("renamed.xt.md", "import a.slug;\nimport b.slug as b_slug;\nlet s: text = \"Hi\".slug();\nlet t: text = \"Hi\".b_slug();\n@@@\n\\{s} \\{t}\n", &packs);
    assert!(err.contains("clean"), "{}", err);
    // with no import of either pack, text has no slug
    let err = said("unimported.xt.md", "let s: text = \"Hi\".slug();\n@@@\n\\{s}\n", &packs);
    assert!(err.contains("1:20: error[names.unknown-fn]: text has no fn `slug`"), "{}", err);
    // both, under one name: the clash, on the second import
    let err = said("both.xt.md", "import a;\nimport b;\n@@@\nBoth.\n", &packs);
    assert!(err.contains("2:1: error[names.fn-clash]: `slug` comes from `a` and `b` on one type: import one under another name, `import b.slug as b_slug;`"), "{}", err);
}

#[test]
fn a_literal_with_an_opt_hole_is_an_opt_and_says_so_where_a_plain_value_is_wanted() {
    let ok = said("opt.xtpack", "package t;\n\nfn was(c: opt<text>): opt<text> {\n    return \"was \\{c}\";\n}\n\nfn note(c: opt<text>): opt<rich_text> {\n    return \"**Note:** \\{c}\";\n}\n", &[]);
    assert!(ok.contains("clean"), "{}", ok);
    let err = said("plain.xtpack", "package t;\n\nfn notes(change: opt<text>): text {\n    let r: rich_text = \"Note: \\{change}\";\n    return \"was \\{change}\";\n}\n", &[]);
    assert!(err.contains("4:33: error[types.mismatch]: this hole holds an opt, so the literal is an `opt<rich_text>`, and a rich_text is wanted here: give the hole a fallback, `\\{x.or(…)}`, or open it first with `if (let …)`"), "{}", err);
    assert!(err.contains("5:19: error[types.mismatch]: this hole holds an opt, so the literal is an `opt<text>`, and a text is wanted here"), "{}", err);
}
