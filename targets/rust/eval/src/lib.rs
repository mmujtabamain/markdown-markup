//! Extended Mark's evaluator: exact numbers, values, the native fns and the limits.
//!
//! The compiler runs it on constants (a literal's `from`, a `require` on constants, a constant
//! `let`), and the native runtime runs pages on it, so compile time and run time are the same
//! code.

pub mod interp;
pub mod natives;
pub mod num;
pub mod value;

pub use interp::{Binding, Constants, FailKind, Failure, Host, Machine, Program, Row};
pub use num::Num;
pub use value::Value;
