//! What the Android target supplies to core: the value fns of its target.yaml
//! (`core/can_draw_tex`, `core/moment.local`), and the pixels a `shade` paints.

use std::rc::Rc;
use std::sync::Arc;

use mkp_eval::value::Record;
use mkp_runtime::{Binding, Num, Page, Value, ValueFn};

use crate::{failed, MkpError, Zone};

/// A record like `like`, its fields in the same order, with some of them changed.
fn with_fields(like: &Value, set: &[(&str, Value)]) -> Value {
    match like {
        Value::Record(r) => {
            let fields = r.fields.iter().map(|(k, v)| (k.clone(), set.iter().find(|(n, _)| **n == **k).map_or_else(|| v.clone(), |(_, x)| x.clone()))).collect();
            Value::Record(Rc::new(Record { ty: r.ty.clone(), fields }))
        }
        other => other.clone(),
    }
}

/// The value fns the Android target supplies.
///
/// - `core/can_draw_tex` is true: mkp-android draws the TeX core accepts, and shows TeX its
///   reader doesn't know as itself, as @mkp/dom does.
/// - `core/moment.local` is the same instant, with the offset the reader's zone uses at it, summer
///   time included: core works out the instant (`moment.utc`) and the fields (`moment_at`).
pub fn target_fns(zone: Arc<dyn Zone>) -> std::collections::HashMap<String, ValueFn> {
    let can_draw_tex: ValueFn = Rc::new(|_, _| Ok(Some(Value::Bool(true))));
    let local: ValueFn = Rc::new(move |m, args| {
        let m0 = args.first().cloned().unwrap_or_else(Value::none);
        let utc = m.call("core/moment.utc", vec![Binding::Value(m0.clone())])?.unwrap_or_else(Value::none);
        let minutes = match &utc {
            Value::Num(n) => n.to_i64().unwrap_or(0),
            _ => 0,
        };
        let east = zone.offset_minutes(minutes) as i64;
        let int = |n: i64| Value::Num(Num::int(n));
        let in_zone = with_fields(&m0, &[("east", Value::Bool(east >= 0)), ("offset_hour", int(east.abs() / 60)), ("offset_minute", int(east.abs() % 60))]);
        m.call("core/moment_at", vec![Binding::Value(utc), Binding::Value(in_zone)])
    });
    [("core/can_draw_tex".to_string(), can_draw_tex), ("core/moment.local".to_string(), local)].into_iter().collect()
}

fn num_field(v: Option<&Value>) -> Option<Num> {
    match v? {
        Value::Num(n) => Some(*n),
        Value::Opt(Some(x)) => num_field(Some(x)),
        _ => None,
    }
}

fn field<'a>(v: &'a Value, name: &str) -> Option<&'a Value> {
    match v {
        Value::Record(r) => r.get(name),
        Value::Opt(Some(x)) => field(x, name),
        _ => None,
    }
}

fn channel(pixel: &Value, name: &str, or: f64) -> u32 {
    let x = num_field(field(pixel, name)).and_then(|n| n.show().parse::<f64>().ok()).unwrap_or(or);
    (255.0 * x.clamp(0.0, 1.0)).round() as u32
}

/// A shade's pixels: `cols` by `rows` samples over its area, each its shader's colour at the
/// sample's middle, in the area's units (y up, so the top row is the area's highest), as ARGB.
pub fn shade(page: &Page, path: &str, cols: u32, rows: u32) -> Result<Vec<i32>, MkpError> {
    let d = page.find(path).ok_or_else(|| failed(format!("nothing is drawn at {}", path)))?;
    let shader = d.props.get("shader").cloned().ok_or_else(|| failed("the shade has no shader"))?;
    let args = d.props.get("args").cloned().unwrap_or_else(Value::none);
    let area = d.props.get("area").cloned().unwrap_or_else(Value::none);
    let corner = |p: &str, k: &str| field(&area, p).and_then(|pt| num_field(field(pt, k)));
    let (Some(fx), Some(fy), Some(tx), Some(ty)) = (corner("from", "x"), corner("from", "y"), corner("to", "x"), corner("to", "y")) else {
        return Err(failed("the shade's area isn't a region"));
    };
    let (cols, rows) = (cols.max(1), rows.max(1));
    let (lx, hx) = if fx < tx { (fx, tx) } else { (tx, fx) };
    let (ly, hy) = if fy < ty { (fy, ty) } else { (ty, fy) };
    let px = hx.sub(lx)?.div(Num::int(cols as i64))?;
    let py = hy.sub(ly)?.div(Num::int(rows as i64))?;
    let half = Num::parse("0.5").unwrap();
    let mut out = Vec::with_capacity((cols * rows) as usize);
    for j in 0..rows {
        let y = hy.sub(py.mul(Num::int(j as i64).add(half)?)?)?;
        for i in 0..cols {
            let x = lx.add(px.mul(Num::int(i as i64).add(half)?)?)?;
            let at = mkp_runtime::layout::pt_value(&mkp_runtime::Pt { x, y });
            let argb = match page.apply(&shader, vec![at, Value::Num(px), args.clone()]) {
                Ok(Some(c)) => (channel(&c, "a", 1.0) << 24) | (channel(&c, "r", 0.0) << 16) | (channel(&c, "g", 0.0) << 8) | channel(&c, "b", 0.0),
                _ => 0,
            };
            out.push(argb as i32);
        }
    }
    Ok(out)
}
