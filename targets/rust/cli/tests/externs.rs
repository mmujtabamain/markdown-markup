//! Every `extern fn` core declares with no body is implemented by the evaluator, or is on the
//! written list of target-only fns (plan tab 14): no target can be left without one.

use std::process::Command;

#[test]
fn every_bodyless_core_extern_fn_is_native_or_target_only() {
    let dir = std::env::temp_dir().join(format!("mkp-externs-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let page = dir.join("page.mkp.md");
    std::fs::write(&page, "@@@\nHello.\n").unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_mkp")).args(["build", page.to_str().unwrap()]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let ir: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let mut seen = 0;
    let mut missing = Vec::new();
    for d in ir["ir"]["declarations"].as_array().unwrap() {
        let Some(f) = d["declare"]["extern"].get("fn") else { continue };
        if f["supplier"] != "core" || f.get("default").map_or(false, |b| b.as_array().map_or(false, |b| !b.is_empty())) {
            continue;
        }
        seen += 1;
        let name = f["name"].as_str().unwrap();
        if !mkp_eval::natives::exists(name) && !mkp_eval::natives::TARGET_ONLY.contains(&name) {
            missing.push(name.to_string());
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    assert!(seen > 50, "only {} bodyless extern fns found", seen);
    assert!(missing.is_empty(), "core declares these with no body, and nothing implements them: {:?}", missing);
}
