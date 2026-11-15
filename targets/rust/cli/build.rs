//! Embeds core's MKP sources in the binary, so `mkp` compiles core itself, with no files around it.

use std::path::PathBuf;

fn main() {
    let core = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../core");
    println!("cargo:rerun-if-changed={}", core.display());
    let mut files: Vec<PathBuf> = std::fs::read_dir(&core).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "mkp")).collect();
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
}
