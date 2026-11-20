//! A block in prose is read with its common indent taken off, as a `markdown` block is, and
//! `xtmd fmt` indents each block four spaces past its opening line.

use xtmd_syntax::ast::{Prose, ProseNode};
use xtmd_syntax::{format, parse, Entry};

const FLAT: &str = "@@@\n# Shop\n\n@mut for (i in $state.items) {\n@if (let x: item = i) {\n@basket_row(name = x.name, remove = fn() { $state.items.remove(x); });\n}\n}\n";
const INDENTED: &str = "@@@\n# Shop\n\n@mut for (i in $state.items) {\n    @if (let x: item = i) {\n        @basket_row(name = x.name, remove = fn() { $state.items.remove(x); });\n    }\n}\n";

fn prose(src: &str) -> Prose {
    let parsed = parse(src, Entry::Document);
    assert!(!parsed.has_errors(), "{:?}", parsed.diagnostics);
    parsed.file.unwrap().prose.unwrap()
}

fn error(src: &str) -> &'static str {
    parse(src, Entry::Document).diagnostics.iter().find(|d| d.is_error()).map(|d| d.code).unwrap_or("none")
}

/// Each line of a block's prose as Markdown reads it: without the block's indent.
fn lines(src: &str, body: &Prose) -> Vec<String> {
    let mut out = Vec::new();
    for n in &body.nodes {
        match n {
            ProseNode::Text(l) => out.push(src[l.span.range()].to_string()),
            ProseNode::Fence(ls) | ProseNode::Maths(ls) => out.extend(ls.iter().map(|l| src[l.span.range()].to_string())),
            ProseNode::Comment { span, .. } => out.push(src[span.range()].to_string()),
            ProseNode::Call(c) => out.push(format!("@{}", &src[c.call.name.span.range()])),
            _ => out.push("<block>".to_string()),
        }
    }
    out
}

fn body(p: &Prose, k: usize) -> &Prose {
    match &p.nodes[k] {
        ProseNode::Call(c) => &c.block.as_ref().unwrap().0,
        ProseNode::For { body, .. } | ProseNode::Slot { body, .. } => body,
        ProseNode::If { branches, .. } => &branches[0].1,
        n => panic!("not a block: {:?}", n),
    }
}

#[test]
fn an_indented_block_reads_as_the_flat_one_does() {
    for src in [FLAT, INDENTED] {
        let p = prose(src);
        let ProseNode::For { body: loop_body, .. } = &p.nodes[2] else { panic!("{:?}", p.nodes[2]) };
        let ProseNode::If { branches, .. } = &loop_body.nodes[0] else { panic!("{:?}", loop_body.nodes) };
        assert_eq!(lines(src, &branches[0].1), ["@basket_row"]);
    }
}

#[test]
fn fmt_indents_each_block_four_spaces_past_its_opening_line() {
    assert_eq!(format(FLAT, Entry::Document).unwrap(), INDENTED);
    assert_eq!(format(INDENTED, Entry::Document).unwrap(), INDENTED, "an indented file is already canonical");
    // two spaces, or a closing brace out of line, come back as four and in line
    let loose = "@@@\n@card(title = \"a\") {\n  Text.\n      }\n";
    assert_eq!(format(loose, Entry::Document).unwrap(), "@@@\n@card(title = \"a\") {\n    Text.\n}\n");
}

#[test]
fn indented_text_in_a_block_is_a_paragraph_and_four_more_spaces_are_code() {
    let src = "@@@\n@card(title = \"Build\") {\n    It passed.\n\n        let x = 1;\n}\n";
    let p = prose(src);
    assert_eq!(lines(src, body(&p, 0)), ["It passed.", "", "    let x = 1;"]);
    // the least indent of the block's lines is taken off, even when the first sits deeper
    let deeper_first = "@@@\n@card(title = \"Build\") {\n        let x = 1;\n\n    It passed.\n}\n";
    let p = prose(deeper_first);
    assert_eq!(lines(deeper_first, body(&p, 0)), ["    let x = 1;", "", "It passed."]);
}

#[test]
fn blank_lines_and_the_lines_of_a_fence_do_not_count_toward_the_indent() {
    let src = "@@@\n@card(title = \"x\") {\n\n    ```js\nlet x = 1;\n      indented();\n    ```\n    After.\n}\n";
    let p = prose(src);
    assert_eq!(lines(src, body(&p, 0)), ["", "```js", "let x = 1;", "  indented();", "```", "After."]);
    // fmt moves the fence with its block, and its code reads the same
    let flat = "@@@\n@card(title = \"x\") {\n```js\nlet x = 1;\n  indented();\n```\n}\n";
    let printed = format(flat, Entry::Document).unwrap();
    assert_eq!(printed, "@@@\n@card(title = \"x\") {\n    ```js\n    let x = 1;\n      indented();\n    ```\n}\n");
    let again = prose(&printed);
    assert_eq!(lines(&printed, body(&again, 0)), ["```js", "let x = 1;", "  indented();", "```"]);
}

#[test]
fn else_case_and_slot_lines_sit_at_their_block_s_indent() {
    let src = "@@@\n@if ($state.n > 1) {\n    Many.\n} else if ($state.n == 1) {\n    One.\n} else {\n    None.\n}\n\n@match ($state.n) {\n    case 0 {\n        Zero.\n    }\n    case else {\n        @label(value = \"some\");\n    }\n}\n\n@box(title = \"Build\") {\n    @slot actions {\n        @press(label = \"Retry\", click = fn() { });\n    }\n    @slot body {\n        It passed.\n    }\n}\n";
    let p = prose(src);
    let ProseNode::If { branches, otherwise, .. } = &p.nodes[0] else { panic!() };
    assert_eq!(lines(src, &branches[1].1), ["One."]);
    assert_eq!(lines(src, &otherwise.as_ref().unwrap().0), ["None."]);
    let ProseNode::Match { cases, .. } = &p.nodes[2] else { panic!("{:?}", p.nodes[2]) };
    assert_eq!(cases.iter().map(|c| c.indent.as_str()).collect::<Vec<_>>(), ["", ""]);
    assert_eq!(lines(src, &cases[1].body), ["@label"]);
    let slots = body(&p, 4);
    assert_eq!(lines(src, body(slots, 1)), ["It passed."]);
    assert_eq!(format(src, Entry::Document).unwrap(), src);
    let flat: String = src.lines().map(|l| l.trim_start().to_string() + "\n").collect();
    assert_eq!(format(&flat, Entry::Document).unwrap(), src);
}

#[test]
fn comments_holes_and_maths_read_inside_an_indented_block() {
    let src = "@@@\n@card(title = \"x\") {\n    @// for whoever edits the file\n    Tries: \\{$state.tries}.\n\n    $$\n    x^\\{$state.n}\n    $$\n}\n";
    let p = prose(src);
    let b = body(&p, 0);
    assert!(matches!(b.nodes[0], ProseNode::Comment { .. }));
    let ProseNode::Text(l) = &b.nodes[1] else { panic!() };
    assert_eq!(l.holes.len(), 1);
    let ProseNode::Maths(m) = &b.nodes[3] else { panic!("{:?}", b.nodes[3]) };
    assert_eq!(m[1].holes.len(), 1);
    assert_eq!(format(src, Entry::Document).unwrap(), src);
}

#[test]
fn at_the_top_four_spaces_are_still_code_and_a_stray_brace_still_an_error() {
    let src = "@@@\nText.\n\n    @card(title = \"x\");\n";
    let p = prose(src);
    assert!(p.nodes.iter().all(|n| matches!(n, ProseNode::Text(_))), "{:?}", p.nodes);
    assert_eq!(error("@@@\n@mut for (i in $state.items) {\n    @if (i > 1) {\n        Text.\n    }\n}\n}\n"), "prose.stray-closing-brace");
    assert_eq!(error("@@@\n@card(title = \"x\") {\n    > @label(value = \"a\");\n}\n"), "prose.call-in-quote-or-item");
}
