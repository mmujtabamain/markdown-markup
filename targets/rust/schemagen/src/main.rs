//! `cargo run -p mkp-schemagen` writes the types; `-- --check` only says whether they are current.

use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let check = std::env::args().any(|a| a == "--check");
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut stale = false;
    for (path, text) in mkp_schemagen::generate(&repo) {
        let full = repo.join(&path);
        let current = std::fs::read_to_string(&full).unwrap_or_default();
        if current == text {
            continue;
        }
        if check {
            eprintln!("{} is not current: run `cargo run -p mkp-schemagen`", path.display());
            stale = true;
        } else {
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(&full, text).unwrap();
            println!("wrote {}", path.display());
        }
    }
    if stale {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}
