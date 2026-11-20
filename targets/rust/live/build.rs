//! Embeds core's Extended Mark sources in the library, as cli/build.rs embeds them in the binary: an app (or
//! a browser, through xtmd-wasm) compiles core itself, once, with no files around it. Packs come
//! with each build, as text.

use std::path::{Path, PathBuf};

fn xtmd_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
    files.sort();
    files
}

fn main() {
    // the crate's own copy when it is packaged (the release puts core's files in), else the repository's
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let core = if here.join("core").is_dir() { here.join("core") } else { here.join("../../../core") };
    println!("cargo:rerun-if-changed={}", core.display());
    let mut out = String::from("/// core's sources, as (path, text).\npub const CORE: &[(&str, &str)] = &[\n");
    for f in xtmd_files(&core) {
        println!("cargo:rerun-if-changed={}", f.display());
        out.push_str(&format!("    (\"core/{}\", include_str!({:?})),\n", f.file_name().unwrap().to_str().unwrap(), f.canonicalize().unwrap()));
    }
    out.push_str("];\n");
    std::fs::write(PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("core.rs"), out).unwrap();
}
