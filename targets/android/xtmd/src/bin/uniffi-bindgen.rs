//! uniffi-bindgen, built from the same UniFFI as the library, so the bindings it writes match it:
//! `cargo run -p xtmd-android --features bindgen --bin uniffi-bindgen -- generate --library …`.
fn main() {
    uniffi::uniffi_bindgen_main()
}
