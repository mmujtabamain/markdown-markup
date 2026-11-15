//! The native fns: what core declares `extern fn` with no body, because MKP can't do it in terms
//! of anything else (page 5). List storage, Unicode text, exact numbers and their maths, the
//! interface fns of the built-in types, a range's ends, a duration's milliseconds, and `clamp`.

use crate::interp::{Binding, FailKind, Failure, Machine, MAX_ITEMS, R};
use crate::num::Num;
use crate::value::*;
use std::rc::Rc;

/// Every native fn, by its full name.
pub const NATIVES: &[&str] = &[
    "core/number.show", "core/number.same", "core/number.before", "core/number.add", "core/number.sub", "core/number.scale",
    "core/duration.show", "core/duration.same", "core/duration.before", "core/duration.add", "core/duration.sub", "core/duration.scale",
    "core/text.show", "core/text.same", "core/text.before",
    "core/bool.show", "core/bool.same", "core/bool.before",
    "core/range.low", "core/range.high", "core/range.stride", "core/range.has",
    "core/duration.ms",
    "core/number.round", "core/number.floor", "core/number.ceil", "core/number.abs", "core/number.fmt", "core/number.sign",
    "core/number.sqrt", "core/number.pow", "core/number.exp", "core/number.ln",
    "core/number.sin", "core/number.cos", "core/number.tan", "core/number.asin", "core/number.acos", "core/number.atan",
    "core/number.atan2", "core/number.sinh", "core/number.cosh", "core/number.tanh",
    "core/list.len", "core/list.at", "core/list.add", "core/list.insert", "core/list.remove_at", "core/list.move", "core/list.remove", "core/list.sort",
    "core/text.len", "core/text.slice", "core/text.chars", "core/text.lower", "core/text.upper", "core/text.trim", "core/text.has", "core/text.split", "core/text.number",
    "core/ordered.clamp",
];

pub fn exists(name: &str) -> bool {
    NATIVES.contains(&name)
}

/// Whole seconds as `2s`, anything else as `250ms`.
pub fn show_duration(ms: &Num) -> String {
    let thousand = Num::int(1000);
    match ms.div(thousand) {
        Ok(s) if s.is_int() => format!("{}s", s.show()),
        _ => format!("{}ms", ms.show()),
    }
}

fn num(m: &mut Machine, args: &[Binding], k: usize) -> R<Num> {
    m.value_of(&args[k])?.as_num().ok_or_else(|| Failure::ir("a native fn given something that isn't a number"))
}

fn text(m: &mut Machine, args: &[Binding], k: usize) -> R<Rc<str>> {
    match m.value_of(&args[k])? {
        Value::Text(t) => Ok(t),
        _ => Err(Failure::ir("a native fn given something that isn't a text")),
    }
}

fn list(m: &mut Machine, args: &[Binding], k: usize) -> R<Rc<List>> {
    match m.value_of(&args[k])? {
        Value::List(l) => Ok(l),
        _ => Err(Failure::ir("a native fn given something that isn't a list")),
    }
}

fn whole(n: Num, what: &str) -> R<i64> {
    n.to_i64().ok_or_else(|| Failure::new(FailKind::Position, format!("{} that isn't a whole number", what)))
}

/// Writes a changed list back through `mut self`.
fn set_list(m: &mut Machine, args: &[Binding], l: List) -> R<()> {
    if l.items.len() > MAX_ITEMS {
        return Err(Failure::new(FailKind::Limit(crate::interp::Limit::Items), "a list of more than 10,000 items"));
    }
    match &args[0] {
        Binding::Ref(p) => {
            let p = p.clone();
            m.write_place(&p, Value::List(Rc::new(l)))
        }
        Binding::Value(_) => Err(Failure::ir("a list fn that changes its list, given a list it can't write")),
    }
}

fn some_num(r: Option<Num>) -> Value {
    match r {
        Some(n) => Value::some(Value::Num(n)),
        None => Value::none(),
    }
}

/// Calls a native fn, or says it isn't one.
pub fn call(m: &mut Machine, name: &str, a: &[Binding]) -> Option<R<Option<Value>>> {
    if !exists(name) {
        return None;
    }
    Some(run(m, name, a).map(Some).or_else(|f| if f.kind == FailKind::Ir && f.message == "nothing" { Ok(None) } else { Err(f) }))
}

fn nothing() -> R<Value> {
    Err(Failure::ir("nothing"))
}

fn run(m: &mut Machine, name: &str, a: &[Binding]) -> R<Value> {
    let short = name.strip_prefix("core/").unwrap();
    Ok(match short {
        "number.show" => Value::text(&num(m, a, 0)?.show()),
        "number.same" | "duration.same" => Value::Bool(num(m, a, 0)? == num(m, a, 1)?),
        "number.before" | "duration.before" => Value::Bool(num(m, a, 0)? < num(m, a, 1)?),
        "number.add" => Value::Num(num(m, a, 0)?.add(num(m, a, 1)?)?),
        "number.sub" => Value::Num(num(m, a, 0)?.sub(num(m, a, 1)?)?),
        "number.scale" => Value::Num(num(m, a, 0)?.mul(num(m, a, 1)?)?),
        "duration.show" => Value::text(&show_duration(&num(m, a, 0)?)),
        "duration.add" => Value::Duration(num(m, a, 0)?.add(num(m, a, 1)?)?),
        "duration.sub" => Value::Duration(num(m, a, 0)?.sub(num(m, a, 1)?)?),
        "duration.scale" => Value::Duration(num(m, a, 0)?.mul(num(m, a, 1)?)?),
        "duration.ms" => Value::Num(num(m, a, 0)?),
        "text.show" => Value::Text(text(m, a, 0)?),
        "text.same" => Value::Bool(text(m, a, 0)? == text(m, a, 1)?),
        "text.before" => Value::Bool(text(m, a, 0)? < text(m, a, 1)?),
        "bool.show" => Value::text(if m.value_of(&a[0])?.as_bool().unwrap_or(false) { "true" } else { "false" }),
        "bool.same" => Value::Bool(m.value_of(&a[0])?.as_bool() == m.value_of(&a[1])?.as_bool()),
        "bool.before" => Value::Bool(!m.value_of(&a[0])?.as_bool().unwrap_or(false) && m.value_of(&a[1])?.as_bool().unwrap_or(false)),
        "range.low" | "range.high" | "range.stride" => {
            let Value::Range(r) = m.value_of(&a[0])? else {
                return Err(Failure::ir("a range fn given something that isn't a range"));
            };
            let part = match short {
                "range.low" => r.low.clone(),
                "range.high" => r.high.clone(),
                _ => r.step.clone(),
            };
            match part {
                Some(v) => Value::some(v),
                None => Value::none(),
            }
        }
        "range.has" => {
            let Value::Range(r) = m.value_of(&a[0])? else {
                return Err(Failure::ir("a range fn given something that isn't a range"));
            };
            let x = m.value_of(&a[1])?;
            if let Some(low) = &r.low {
                if m.before(&x, low)? {
                    return Ok(Value::Bool(false));
                }
            }
            if let Some(high) = &r.high {
                if m.before(high, &x)? {
                    return Ok(Value::Bool(false));
                }
            }
            if let (Some(step), Some(xn)) = (r.step.as_ref().and_then(|s| s.as_num()), x.as_num()) {
                let from = r.low.as_ref().and_then(|l| l.as_num()).unwrap_or(Num::zero());
                if !xn.sub(from)?.div(step)?.is_int() {
                    return Ok(Value::Bool(false));
                }
            }
            Value::Bool(true)
        }
        "number.round" => Value::Num(num(m, a, 0)?.round()),
        "number.floor" => Value::Num(num(m, a, 0)?.floor()),
        "number.ceil" => Value::Num(num(m, a, 0)?.ceil()),
        "number.abs" => Value::Num(num(m, a, 0)?.abs()),
        "number.sign" => Value::Num(num(m, a, 0)?.sign()),
        "number.fmt" => {
            let places = whole(num(m, a, 1)?, "a number of places")?.clamp(0, 10) as u32;
            Value::text(&num(m, a, 0)?.fmt(places))
        }
        "number.sqrt" => some_num(num(m, a, 0)?.sqrt()),
        "number.pow" => some_num(num(m, a, 0)?.pow(num(m, a, 1)?)?),
        "number.exp" => Value::Num(num(m, a, 0)?.exp()?),
        "number.ln" => some_num(num(m, a, 0)?.ln()),
        "number.sin" => Value::Num(num(m, a, 0)?.sin()?),
        "number.cos" => Value::Num(num(m, a, 0)?.cos()?),
        "number.tan" => Value::Num(num(m, a, 0)?.tan()?),
        "number.asin" => some_num(num(m, a, 0)?.asin()),
        "number.acos" => some_num(num(m, a, 0)?.acos()),
        "number.atan" => Value::Num(num(m, a, 0)?.atan()?),
        "number.atan2" => Value::Num(num(m, a, 0)?.atan2(num(m, a, 1)?)?),
        "number.sinh" => Value::Num(num(m, a, 0)?.sinh()?),
        "number.cosh" => Value::Num(num(m, a, 0)?.cosh()?),
        "number.tanh" => Value::Num(num(m, a, 0)?.tanh()?),
        "list.len" => Value::Num(Num::int(list(m, a, 0)?.items.len() as i64)),
        "list.at" => {
            let l = list(m, a, 0)?;
            let pos = num(m, a, 1)?;
            match pos.to_i64() {
                Some(k) if k >= 0 && (k as usize) < l.items.len() => Value::some(l.items[k as usize].value.clone()),
                _ => Value::none(),
            }
        }
        "list.add" => {
            let mut l = (*list(m, a, 0)?).clone();
            let value = m.value_of(&a[1])?;
            let id = m.new_id();
            l.items.push(Item { id, value });
            set_list(m, a, l)?;
            return nothing();
        }
        "list.insert" => {
            let mut l = (*list(m, a, 0)?).clone();
            let pos = whole(num(m, a, 1)?, "a position")?.max(0) as usize;
            let value = m.value_of(&a[2])?;
            let id = m.new_id();
            let at = pos.min(l.items.len());
            l.items.insert(at, Item { id, value });
            set_list(m, a, l)?;
            return nothing();
        }
        "list.remove_at" => {
            let mut l = (*list(m, a, 0)?).clone();
            let pos = whole(num(m, a, 1)?, "a position")?;
            if pos < 0 || pos as usize >= l.items.len() {
                return Err(Failure::new(FailKind::Position, "remove_at with a position outside the list"));
            }
            l.items.remove(pos as usize);
            set_list(m, a, l)?;
            return nothing();
        }
        "list.move" => {
            let mut l = (*list(m, a, 0)?).clone();
            let pos = whole(num(m, a, 1)?, "a position")?;
            let to = whole(num(m, a, 2)?, "a position")?;
            let n = l.items.len() as i64;
            if pos < 0 || pos >= n || to < 0 || to >= n {
                return Err(Failure::new(FailKind::Position, "move with a position outside the list"));
            }
            let item = l.items.remove(pos as usize);
            l.items.insert(to as usize, item);
            set_list(m, a, l)?;
            return nothing();
        }
        "list.remove" => {
            let l = list(m, a, 0)?;
            let x = m.value_of(&a[1])?;
            let mut kept = Vec::new();
            for i in l.items.iter() {
                if !m.equal(&i.value, &x)? {
                    kept.push(i.clone());
                }
            }
            set_list(m, a, List { items: kept })?;
            return nothing();
        }
        "list.sort" => {
            let l = list(m, a, 0)?;
            // a stable insertion of each item after every one that isn't after it
            let mut out: Vec<Item> = Vec::with_capacity(l.items.len());
            for item in l.items.iter() {
                let mut at = out.len();
                while at > 0 && m.before(&item.value, &out[at - 1].value)? {
                    at -= 1;
                }
                out.insert(at, item.clone());
            }
            set_list(m, a, List { items: out })?;
            return nothing();
        }
        "text.len" => Value::Num(Num::int(text(m, a, 0)?.chars().count() as i64)),
        "text.slice" => {
            let t = text(m, a, 0)?;
            let start = whole(num(m, a, 1)?, "a start")?.max(0) as usize;
            let count = whole(num(m, a, 2)?, "a count")?.max(0) as usize;
            Value::text(&t.chars().skip(start).take(count).collect::<String>())
        }
        "text.chars" => {
            let t = text(m, a, 0)?;
            let chars: Vec<Value> = t.chars().map(|c| Value::text(&c.to_string())).collect();
            m.make_list(chars)?
        }
        "text.lower" => Value::text(&text(m, a, 0)?.to_lowercase()),
        "text.upper" => Value::text(&text(m, a, 0)?.to_uppercase()),
        "text.trim" => Value::text(text(m, a, 0)?.trim()),
        "text.has" => Value::Bool(text(m, a, 0)?.contains(&*text(m, a, 1)?)),
        "text.split" => {
            let t = text(m, a, 0)?;
            let sep = text(m, a, 1)?;
            if sep.is_empty() {
                return Err(Failure::rule("split takes a separator of at least one character"));
            }
            let parts: Vec<Value> = t.split(&*sep).map(Value::text).collect();
            m.make_list(parts)?
        }
        "text.number" => {
            let t = text(m, a, 0)?;
            let body = t.strip_prefix('-').unwrap_or(&t);
            let mut parts = body.splitn(2, '.');
            let w = parts.next().unwrap_or("");
            let f = parts.next();
            let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
            if digits(w) && f.map_or(true, digits) {
                some_num(Num::parse(&t))
            } else {
                Value::none()
            }
        }
        "ordered.clamp" => {
            let x = m.value_of(&a[0])?;
            let low = m.value_of(&a[1])?;
            let high = m.value_of(&a[2])?;
            if m.before(&x, &low)? {
                low
            } else if m.before(&high, &x)? {
                high
            } else {
                x
            }
        }
        _ => return Err(Failure::ir(format!("no native `{}`", name))),
    })
}
