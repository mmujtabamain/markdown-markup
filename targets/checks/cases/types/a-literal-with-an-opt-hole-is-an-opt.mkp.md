// a literal with a hole that holds an opt is an opt: opt.NONE when the hole is, else the literal
fn was(c: opt<text>): opt<text> {
    return "was \{c}";
}

fn note(c: opt<text>): opt<rich_text> {
    return "**Note:** \{c}";
}

let shown: rich_text = note("up").or("*none*");
let hidden: rich_text = note(opt.NONE).or("*none*");
@@@
A: \{was(opt.NONE).or("none")}.

B: \{was("up").or("none")}.

C: \{shown}

D: \{hidden}
