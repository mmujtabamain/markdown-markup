//! Finds core's table of HTML's named characters for the Markdown reader: the crate's own copy
//! when it is packaged (the release puts core's files in), else the repository's.

use std::path::PathBuf;

fn main() {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let file = [here.join("core/entities.mkp"), here.join("../../../../core/entities.mkp")].into_iter().find(|p| p.is_file()).expect("core/entities.mkp, in the crate or the repository");
    println!("cargo:rerun-if-changed={}", file.display());
    println!("cargo:rustc-env=MKP_ENTITIES={}", file.canonicalize().unwrap().display());
}
