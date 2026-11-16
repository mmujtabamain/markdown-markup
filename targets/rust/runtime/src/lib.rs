#![doc = include_str!("../README.md")]

pub mod layout;
mod markdown;
mod page;

pub use layout::{Measure, Pt, Region, Size, MAX_LAYOUT_PASSES};
pub use mkp_eval::{Binding, FailKind, Failure, Machine, Num, Value};
pub use mkp_ir::check::{Call, PageTheme, PageWidth};
pub use mkp_ir::ir;
pub use page::{failure_code, Broken, Drawn, Env, Handle, LayoutWrite, Outcome, Page, PageOptions, PageValues, Shaded, Supplies, ValueFn, WriteTo};
