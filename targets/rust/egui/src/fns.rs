//! The value fns egui supplies (target.yaml's `fns`): `core/moment.local`, the same instant with
//! the offset the reader's zone uses on its date, summer time included. `can_draw_tex` keeps
//! core's default: egui draws no maths, and shows TeX as itself.

use std::collections::HashMap;
use std::rc::Rc;

use chrono::{Datelike, Offset, TimeZone, Timelike};
use mkp_eval::value::Record;
use mkp_runtime::{Binding, Num, Value, ValueFn};

use crate::values::{field, num};

fn int(n: i64) -> Value {
    Value::Num(Num::int(n))
}

/// A record like `like`, its fields in the same order, with some of them changed.
fn with_fields(like: &Value, set: &[(&str, Value)]) -> Value {
    let Value::Record(r) = like else { return like.clone() };
    let fields = r.fields.iter().map(|(k, v)| (k.clone(), set.iter().find(|(n, _)| *n == &**k).map_or_else(|| v.clone(), |(_, x)| x.clone()))).collect();
    Value::Record(Rc::new(Record { ty: r.ty.clone(), fields }))
}

/// `core/moment.local` in the reader's own zone: worked out from the moment's fields, as the
/// page may call it while it is still being made.
pub fn local_moment(m: &Value) -> Option<Value> {
    let day = field(Some(m), "day")?;
    let n = |v: Option<&Value>| num(v).unwrap_or(0.0) as i64;
    let east = matches!(field(Some(m), "east"), Some(Value::Bool(true)));
    let offset = (if east { 1 } else { -1 }) * (n(field(Some(m), "offset_hour")) * 60 + n(field(Some(m), "offset_minute")));
    let date = chrono::NaiveDate::from_ymd_opt(n(field(Some(day), "year")) as i32, n(field(Some(day), "month")) as u32, n(field(Some(day), "day")) as u32)?;
    let at = date.and_hms_opt(0, 0, 0)? + chrono::Duration::minutes(n(field(Some(m), "hour")) * 60 + n(field(Some(m), "minute")) - offset);
    let local = chrono::Local.from_utc_datetime(&at);
    let east_min = local.offset().fix().local_minus_utc() as i64 / 60;
    let day_v = with_fields(day, &[("year", int(local.year() as i64)), ("month", int(local.month() as i64)), ("day", int(local.day() as i64))]);
    Some(with_fields(
        m,
        &[
            ("day", day_v),
            ("hour", int(local.hour() as i64)),
            ("minute", int(local.minute() as i64)),
            ("east", Value::Bool(east_min >= 0)),
            ("offset_hour", int(east_min.abs() / 60)),
            ("offset_minute", int(east_min.abs() % 60)),
        ],
    ))
}

/// The value fns an app's page gets from egui: the reader's own time zone.
pub fn egui_fns() -> HashMap<String, ValueFn> {
    let local: ValueFn = Rc::new(|_, args| Ok(args.first().and_then(local_moment)));
    HashMap::from([("core/moment.local".to_string(), local)])
}

/// The value fns of the checks: the reader is in UTC, as on every target, so observations agree.
pub fn check_fns() -> HashMap<String, ValueFn> {
    let local: ValueFn = Rc::new(|m, args| {
        let m0 = args.first().cloned().unwrap_or_else(Value::none);
        let utc = m.call("core/moment.utc", vec![Binding::Value(m0.clone())])?.unwrap_or_else(Value::none);
        let in_utc = with_fields(&m0, &[("east", Value::Bool(true)), ("offset_hour", Value::Num(Num::zero())), ("offset_minute", Value::Num(Num::zero()))]);
        m.call("core/moment_at", vec![Binding::Value(utc), Binding::Value(in_utc)])
    });
    HashMap::from([("core/moment.local".to_string(), local)])
}
