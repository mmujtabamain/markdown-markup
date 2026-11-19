//! xtmd fmt: the canonical layout, what it keeps of the author's choices, and what it refuses.

use xtmd_syntax::{format, Entry};

fn fmt(src: &str) -> String {
    format(src, Entry::Xtmd).unwrap_or_else(|d| panic!("{:?}", d))
}

#[test]
fn spacing_and_braces_become_canonical() {
    let src = "package   kit ;\nrecord   stat{label:text[1...];\n  value : text ;mut seen:bool=false;}\nfn f(a:number,b:number):number{return a+b*2;}\n";
    let want = "package kit;\nrecord stat {\n    label: text[1...];\n    value: text;\n    mut seen: bool = false;\n}\nfn f(a: number, b: number): number {\n    return a + b * 2;\n}\n";
    assert_eq!(fmt(src), want);
    assert_eq!(fmt(want), want, "a second run changes nothing");
}

#[test]
fn a_comment_at_the_end_of_a_line_keeps_its_distance() {
    let src = "package t;\n\nrecord r {\n    a: text;      // first\n    bb: text;     // second\n                  // and more\n}\n";
    assert_eq!(fmt(src), src);
}

#[test]
fn blank_lines_are_kept_one_at_most() {
    let src = "package t;\n\n\n\nlet a: number = 1;\nlet b: number = 2;\n";
    assert_eq!(fmt(src), "package t;\n\nlet a: number = 1;\nlet b: number = 2;\n");
}

#[test]
fn a_list_over_several_lines_stays_so_with_a_comma_after_each_item() {
    let src = "package t;\n\nlet xs: list<number> = [\n    1, 2,\n    3\n];\n";
    assert_eq!(fmt(src), "package t;\n\nlet xs: list<number> = [\n    1, 2,\n    3,\n];\n");
    assert_eq!(fmt("package t;\n\nlet xs: list<number> = [1,2,3];\n"), "package t;\n\nlet xs: list<number> = [1, 2, 3];\n");
}

#[test]
fn a_lambda_on_one_line_stays_on_one_line_and_a_fn_body_does_not() {
    let src = "package t;\n\nfn f(xs: list<number>): bool { return xs.some(fn(x) { return x > 1; }); }\n";
    assert_eq!(fmt(src), "package t;\n\nfn f(xs: list<number>): bool {\n    return xs.some(fn(x) { return x > 1; });\n}\n");
}

#[test]
fn prose_is_kept_as_written_and_its_holes_are_printed_as_code() {
    let src = "# Title  \n\nIt is \\{$state.tries+1} today, *really*.\n\n@card(title=\"x\") {\nText.\n}\n";
    let want = "# Title  \n\nIt is \\{$state.tries + 1} today, *really*.\n\n@card(title = \"x\") {\nText.\n}\n";
    assert_eq!(format(src, Entry::Document).unwrap(), want);
}

#[test]
fn a_markdown_block_is_indented_one_step_inside_its_widget() {
    let src = "package t;\n\nwidget w(a: text) {\n    view {\n        @label(value = a);\n    }\n\n    markdown {\n  \\{a}\n\n  more\n    }\n}\n";
    let want = "package t;\n\nwidget w(a: text) {\n    view {\n        @label(value = a);\n    }\n\n    markdown {\n        \\{a}\n\n        more\n    }\n}\n";
    assert_eq!(fmt(src), want);
}

#[test]
fn a_comment_fmt_has_no_place_for_is_refused_not_dropped() {
    let src = "package t;\n\nlet a: number = 1 + // one\n    2;\n";
    let err = format(src, Entry::Xtmd).unwrap_err();
    assert_eq!(err[0].code, "fmt.comment-cannot-be-kept");
}

#[test]
fn a_comment_inside_a_list_written_on_one_line_opens_the_list_over_lines() {
    let src = "package t;\n\nlet a: number = f(1, // one\n    2);\n";
    assert_eq!(fmt(src), "package t;\n\nlet a: number = f(\n    1, // one\n    2,\n);\n");
}

#[test]
fn a_file_that_does_not_read_is_not_printed() {
    let err = format("package t;\n\nlet a = 1;\n", Entry::Xtmd).unwrap_err();
    assert_eq!(err.last().unwrap().code, "syntax.missing-type");
}

#[test]
fn a_migration_reads_and_prints_back_as_written() {
    let src = "package kit;\n\nmigration fn color_to_tone() {\n    rename(input = color, to = tone);\n    set(input = tone, value = color.BAD, when = tone == color.WARN);\n}\n\nmigration kit@1 to kit@2 {\n    fn tone_of(kind: text): tone {\n        return tone.INFO;\n    }\n\n    widget chart {\n        rename(to = plot);   // a plot now\n        color_to_tone();\n        drop(input = shadow, why = \"no shadows\");\n    }\n\n    widget button {\n        event click {\n            add(arg = at);\n        }\n    }\n\n    widget status {\n        execute {\n            return @status(label = label, tone = tone_of(kind));\n        }\n    }\n\n    fn text.slug {\n        rename(to = slugify);\n    }\n\n    enum state {\n        rename(from = state.LATE, to = state.OVERDUE);\n    }\n}\n";
    assert_eq!(fmt(src), src);
    let loose = "package kit;\nmigration kit@1 to kit@2 { widget chart { rename(to = plot); } }\n";
    assert_eq!(fmt(loose), "package kit;\nmigration kit@1 to kit@2 {\n    widget chart {\n        rename(to = plot);\n    }\n}\n");
}

#[test]
fn a_migration_holds_blocks_headed_by_a_kind_and_an_old_name() {
    let err = |src: &str| format(src, Entry::Xtmd).unwrap_err()[0].code;
    assert_eq!(err("package kit;\nmigration kit@1 to kit@2 { rename(to = plot); }\n"), "syntax.migration-line");
    assert_eq!(err("package kit;\nmigration kit@1 kit@2 { }\n"), "syntax.expected");
    assert_eq!(format("migration kit@1 to kit@2 { }\n@@@\nHi\n", Entry::Document).unwrap_err()[0].code, "syntax.migration-line");
    // `migration` is a word only at the start of one
    assert_eq!(fmt("package t;\n\nlet migration: number = 1;\n"), "package t;\n\nlet migration: number = 1;\n");
}

#[test]
fn a_surface_has_a_version_on_its_package_line() {
    let src = "package kit@1;\n\nextern widget chart(values: list<number>, color: color = color.ACCENT);\n";
    assert_eq!(fmt(src), src);
    assert_eq!(fmt("package   kit @ 1 ;\n"), "package kit@1;\n");
}
