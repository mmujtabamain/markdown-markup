//! The IR every target runs, and the target checks' protocol, as Rust types.
//!
//! Both modules are generated from the JSON Schemas in `schemas/`, which are the source:
//! change a schema, then run `cargo run -p mkp-schemagen`.

pub mod check;
pub mod ir;
