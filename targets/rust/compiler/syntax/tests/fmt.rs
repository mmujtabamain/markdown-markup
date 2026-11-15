//! mkp fmt: the canonical layout, what it keeps of the author's choices, and what it refuses.

use mkp_syntax::{format, Entry};

fn fmt(src: &str) -> String {
    format(src, Entry::Mkp).unwrap_or_else(|d| panic!("{:?}", d))
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
    let err = format(src, Entry::Mkp).unwrap_err();
    assert_eq!(err[0].code, "fmt.comment-cannot-be-kept");
}

#[test]
fn a_comment_inside_a_list_written_on_one_line_opens_the_list_over_lines() {
    let src = "package t;\n\nlet a: number = f(1, // one\n    2);\n";
    assert_eq!(fmt(src), "package t;\n\nlet a: number = f(\n    1, // one\n    2,\n);\n");
}

#[test]
fn a_file_that_does_not_read_is_not_printed() {
    let err = format("package t;\n\nlet a = 1;\n", Entry::Mkp).unwrap_err();
    assert_eq!(err.last().unwrap().code, "syntax.missing-type");
}
