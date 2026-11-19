//! The IR every target runs, and the target checks' protocol, as Rust types.
//!
//! Both modules are generated from the JSON Schemas in `schemas/`, which are the source:
//! change a schema, then run `cargo run -p xtmd-schemagen`.

pub mod check;
pub mod ir;

impl ir::Type {
    /// A type by its name, with nothing else: `core/number`, `doc/task`.
    pub fn named(name: &str) -> ir::Type {
        ir::Type { name: name.to_string(), args: Vec::new(), contract: None, params: Vec::new(), returns: None, fields: Vec::new(), interface: None }
    }

    /// A type with its type arguments: `core/list` of `doc/task`.
    pub fn of(name: &str, args: Vec<ir::Type>) -> ir::Type {
        ir::Type { args, ..ir::Type::named(name) }
    }
}
