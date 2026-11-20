//! Embeds core's Extended Mark sources in the binary, so `xtmd` compiles core itself, with no files around it.

use std::path::PathBuf;

fn main() {
    // the crate's own copy when it is packaged (the release puts core's files in), else the repository's
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let core = if here.join("core").is_dir() { here.join("core") } else { here.join("../../../core") };
    println!("cargo:rerun-if-changed={}", core.display());
    let mut files: Vec<PathBuf> = std::fs::read_dir(&core).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
    files.sort();
    let mut out = String::from("/// core's sources, as (path, text).\npub const CORE: &[(&str, &str)] = &[\n");
    for f in files {
        let name = f.file_name().unwrap().to_str().unwrap().to_string();
        println!("cargo:rerun-if-changed={}", f.display());
        out.push_str(&format!("    (\"core/{}\", include_str!({:?})),\n", name, f.canonicalize().unwrap()));
    }
    out.push_str("];\n");
    let dest = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("core.rs");
    std::fs::write(dest, out).unwrap();

    // the frozen 0.2 → 0.3 step (tools/migrate-0.2/frozen): its SHA-256 from its lock, and where it
    // is in the repository, when this build is made from one that has it
    let frozen = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tools/migrate-0.2/frozen");
    let lock = frozen.join("migrate-0.2.lock");
    println!("cargo:rerun-if-changed={}", lock.display());
    let sha = std::fs::read_to_string(&lock).ok().and_then(|t| t.lines().find_map(|l| l.strip_prefix("sha256 = ").map(|v| v.trim_matches('"').to_string()))).unwrap_or_default();
    let file = frozen.join("migrate-0.2.cjs");
    let in_repo = if sha.is_empty() || !file.is_file() { String::new() } else { file.canonicalize().unwrap().display().to_string() };
    println!("cargo:rustc-env=XTMD_MIGRATE_02_SHA256={}", sha);
    println!("cargo:rustc-env=XTMD_MIGRATE_02_REPO={}", in_repo);
}
