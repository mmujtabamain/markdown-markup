//! A block in prose may be indented (page 1, Indentation): the page `xtmd fmt` indents compiles to
//! the IR the flat page does, so it draws and writes the same Markdown.

use xtmd_check::{compile_core, compile_on, Source};
use xtmd_syntax::{format, Entry};
use std::path::PathBuf;

fn core_sources() -> Vec<Source> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

const FLAT: &str = r#"$state {
    items: list<text> = ["Tea", "Honey"];
    n: int = 2;
    open: bool = false;
}

widget tally(names: list<text>) {
    view {
        @label(value = "\{names.len()}");
    }

    markdown {
        @for (x in names) {
        - \{x}
        }
    }
}
@@@
# Indented

@frame(title = "Build") {
It passed in **4 minutes**.

```sh
make
  all
```

@// for whoever edits the file
Tries: \{$state.n}.

$$
x^\{$state.n}
$$
}

@for (x in $state.items) {
- \{x}
}

@if ($state.n > 1) {
Many.
} else if ($state.n == 1) {
One.
} else {
None.
}

@match ($state.n) {
case 0 {
Zero.
}
case else {
@label(value = "some");
}
}

@overlay(label = "More", open = $state.open) {
@slot anchor {
@label(value = "More");
}
@slot body {
Hidden until opened.
}
}

@tally(names = $state.items);
"#;

#[test]
fn an_indented_page_compiles_to_the_flat_page_s_ir() {
    let indented = format(FLAT, Entry::Document).unwrap();
    assert!(indented.contains("\n    It passed in **4 minutes**.\n\n    ```sh\n    make\n      all\n    ```\n"), "{}", indented);
    assert!(indented.contains("        @for (x in names) {\n            - \\{x}\n        }\n"), "{}", indented);
    assert!(indented.contains("@match ($state.n) {\n    case 0 {\n        Zero.\n    }\n"), "{}", indented);
    let base = compile_core(&core_sources());
    let ir = |text: &str| {
        let c = compile_on(&base, &[], &[Source { path: "page.xt.md".into(), text: text.into() }], "doc");
        let errors: Vec<String> = c.errors().map(|d| format!("{}: {}", d.file, d.diagnostic.message)).collect();
        assert!(errors.is_empty(), "{:?}", errors);
        serde_json::to_value(c.module.unwrap()).unwrap()
    };
    assert_eq!(ir(&indented), ir(FLAT));
}
