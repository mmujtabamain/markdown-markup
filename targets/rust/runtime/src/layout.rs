//! The plane's layout (page 5, plane; plan tab 15). A target measures what it drew; this works
//! out, in the plane's units, where each spot landed, the plane's bounds when they are left out,
//! its centre kept inside them and the region it draws, and writes them as one change per pass.
//! A port of @mkp/runtime's `layout.ts`.
//!
//! At zoom 1 one unit of the plane is one of the page's own lengths (an egui point, an Android
//! dp), so a spot's box is its child's size on the page, placed at its point: panning and
//! zooming never change it.

use std::rc::Rc;

use mkp_eval::interp::R;
use mkp_eval::value::Record;
use mkp_eval::{Num, Value};

use crate::page::{Drawn, LayoutWrite, Page};

/// A size on the page, in its own lengths.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Size {
    pub width: Num,
    pub height: Num,
}

/// A point in a plane's units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pt {
    pub x: Num,
    pub y: Num,
}

/// A region in a plane's units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Region {
    pub from: Pt,
    pub to: Pt,
}

/// What a target tells the layout: the size of each spot's child, and the width a plane is given
/// when it says none.
pub trait Measure {
    fn spot(&mut self, page: &Page, spot: &Drawn) -> Size;
    fn plane_width(&mut self, page: &Page, plane: &Drawn) -> Num;
}

/// A layout still changing after this many passes is stopped: a failure of the plane.
pub const MAX_LAYOUT_PASSES: usize = 8;

fn half() -> Num {
    Num::parse("0.5").unwrap()
}

/// Where a spot's child lands: the anchor's part of it on the point, moved by the nudge.
pub fn place(at: Pt, anchor: &str, nudge: Pt, size: Size) -> R<Region> {
    // how much of the width is left of the point, and of the height below it
    let left = if anchor.ends_with('W') {
        Num::zero()
    } else if anchor.ends_with('E') {
        size.width
    } else {
        size.width.mul(half())?
    };
    let below = if anchor.starts_with('S') {
        Num::zero()
    } else if anchor.starts_with('N') {
        size.height
    } else {
        size.height.mul(half())?
    };
    let x = at.x.add(nudge.x)?.sub(left)?;
    let y = at.y.add(nudge.y)?.sub(below)?;
    Ok(Region { from: Pt { x, y }, to: Pt { x: x.add(size.width)?, y: y.add(size.height)? } })
}

/// The region around every box.
pub fn around(boxes: &[Region]) -> Option<Region> {
    let min = |a: Num, b: Num| if a < b { a } else { b };
    let max = |a: Num, b: Num| if a > b { a } else { b };
    let mut it = boxes.iter();
    let first = *it.next()?;
    Some(it.fold(first, |r, b| Region {
        from: Pt { x: min(r.from.x, b.from.x), y: min(r.from.y, b.from.y) },
        to: Pt { x: max(r.to.x, b.to.x), y: max(r.to.y, b.to.y) },
    }))
}

/// A centre kept where the drawn area stays inside the bounds, on each axis; their middle where
/// the bounds are smaller than it.
pub fn keep_inside(center: Pt, half_size: Pt, bounds: Region) -> R<Pt> {
    let axis = |c: Num, h: Num, lo: Num, hi: Num| -> R<Num> {
        if hi.sub(lo)? < h.add(h)? {
            return Ok(lo.add(hi)?.mul(half())?);
        }
        if c.sub(h)? < lo {
            return Ok(lo.add(h)?);
        }
        if c.add(h)? > hi {
            return Ok(hi.sub(h)?);
        }
        Ok(c)
    };
    Ok(Pt { x: axis(center.x, half_size.x, bounds.from.x, bounds.to.x)?, y: axis(center.y, half_size.y, bounds.from.y, bounds.to.y)? })
}

// ---- values

pub fn pt_of(v: Option<&Value>) -> Option<Pt> {
    let Some(Value::Record(r)) = v else { return None };
    match (r.get("x"), r.get("y")) {
        (Some(Value::Num(x)), Some(Value::Num(y))) => Some(Pt { x: *x, y: *y }),
        _ => None,
    }
}

pub fn region_of(v: Option<&Value>) -> Option<Region> {
    match v? {
        Value::Opt(x) => region_of(x.as_deref()),
        Value::Record(r) => Some(Region { from: pt_of(r.get("from"))?, to: pt_of(r.get("to"))? }),
        _ => None,
    }
}

pub fn pt_value(p: &Pt) -> Value {
    Value::Record(Rc::new(Record { ty: Rc::from("core/point"), fields: vec![(Rc::from("x"), Value::Num(p.x)), (Rc::from("y"), Value::Num(p.y))] }))
}

pub fn region_value(r: &Region) -> Value {
    Value::Record(Rc::new(Record { ty: Rc::from("core/region"), fields: vec![(Rc::from("from"), pt_value(&r.from)), (Rc::from("to"), pt_value(&r.to))] }))
}

fn num_of(v: Option<&Value>, or: Num) -> Num {
    match v {
        Some(Value::Num(n)) => *n,
        _ => or,
    }
}

// ---- a pass

/// Every plane in the tree, outermost first.
pub fn planes(nodes: &[Drawn]) -> Vec<&Drawn> {
    fn walk<'a>(nodes: &'a [Drawn], out: &mut Vec<&'a Drawn>) {
        for n in nodes {
            if n.widget == "core/plane" {
                out.push(n);
            }
            for kids in n.slots.values() {
                walk(kids, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(nodes, &mut out);
    out
}

/// What one plane writes after a layout: each spot's box, its centre when it had to move, and
/// the region it draws. Boxes come first, so bounds left out are worked out from them. `started`
/// holds the planes laid out once already, by identity: `fit` only sets where they start.
pub fn plane_writes(page: &Page, plane: &Drawn, measure: &mut dyn Measure, started: &mut std::collections::HashSet<String>) -> R<Vec<LayoutWrite>> {
    let mut writes = Vec::new();
    let mut boxes = Vec::new();
    let zero = Pt { x: Num::zero(), y: Num::zero() };
    let given = region_of(plane.props.get("bounds"));
    for s in plane.slots.get("items").into_iter().flatten() {
        if s.widget != "core/spot" {
            continue;
        }
        let at = pt_of(s.props.get("at")).unwrap_or(zero);
        // a spot outside bounds the caller gave is a warning, and is clipped where it is drawn
        if let Some(g) = given {
            page.spot_inside(&s.path, at.x >= g.from.x && at.x <= g.to.x && at.y >= g.from.y && at.y <= g.to.y);
        }
        let anchor = match s.props.get("anchor") {
            Some(Value::Case(c)) => c.name.to_string(),
            _ => "CENTER".to_string(),
        };
        let nudge = pt_of(s.props.get("nudge")).unwrap_or(zero);
        let size = measure.spot(page, s);
        let b = defective(page, plane, place(at, &anchor, nudge, size)?)?;
        boxes.push(b);
        writes.push(LayoutWrite { path: s.path.clone(), input: "box".into(), value: Value::some(region_value(&b)) });
    }
    let bounds = region_of(plane.props.get("bounds")).or_else(|| around(&boxes));
    let aspect = num_of(plane.props.get("aspect"), Num::parse("1.5").unwrap());
    let measured = measure.plane_width(page, plane);
    let width = match plane.props.get("width") {
        Some(Value::Opt(Some(w))) => num_of(token_num(page, w)?.as_ref(), measured),
        _ => measured,
    };
    // the zoom: `fit` starts it where the whole of bounds fits, and zoom_range counts from there
    let was_zoom = num_of(plane.props.get("zoom"), Num::int(1));
    let fit = matches!(plane.props.get("fit"), Some(Value::Bool(true)));
    let mut base = Num::int(1);
    if let (true, Some(b)) = (fit, bounds) {
        let bw = b.to.x.sub(b.from.x)?;
        let bh = b.to.y.sub(b.from.y)?;
        if !bw.is_zero() && !bh.is_zero() {
            let across = width.div(bw)?;
            let up = width.div(aspect)?.div(bh)?;
            base = if across < up { across } else { up };
        }
    }
    let mut zoom = was_zoom;
    if !started.contains(&plane.key) {
        started.insert(plane.key.clone());
        if fit {
            zoom = base;
        }
    }
    if let Some(Value::Range(range)) = plane.props.get("zoom_range") {
        let lo = match &range.low {
            Some(Value::Num(n)) => Some(n.mul(base)?),
            _ => None,
        };
        let hi = match &range.high {
            Some(Value::Num(n)) => Some(n.mul(base)?),
            _ => None,
        };
        if let Some(lo) = lo {
            if zoom < lo {
                zoom = lo;
            }
        }
        if let Some(hi) = hi {
            if zoom > hi {
                zoom = hi;
            }
        }
    }
    // and inside what the zoom input allows
    let least = Num::parse("0.1").unwrap();
    let most = Num::int(10);
    if zoom < least {
        zoom = least;
    }
    if zoom > most {
        zoom = most;
    }
    if zoom != was_zoom {
        writes.push(LayoutWrite { path: plane.path.clone(), input: "zoom".into(), value: Value::Num(zoom) });
    }
    // the drawn area, in the plane's units: the widget's size on the page over the zoom
    let half_size = Pt { x: width.div(zoom)?.mul(half())?, y: width.div(aspect)?.div(zoom)?.mul(half())? };
    let was = pt_of(plane.props.get("center")).unwrap_or(zero);
    let center = match bounds {
        Some(b) => keep_inside(was, half_size, b)?,
        None => was,
    };
    if center.x != was.x || center.y != was.y {
        writes.push(LayoutWrite { path: plane.path.clone(), input: "center".into(), value: pt_value(&center) });
    }
    let drawn = Region { from: Pt { x: center.x.sub(half_size.x)?, y: center.y.sub(half_size.y)? }, to: Pt { x: center.x.add(half_size.x)?, y: center.y.add(half_size.y)? } };
    writes.push(LayoutWrite { path: plane.path.clone(), input: "drawn".into(), value: Value::some(region_value(&drawn)) });
    Ok(writes)
}

/// The test targets' defects: a box in screen pixels changes with every zoom, and one measured
/// from the drawn area's corner changes with every pan. The checks catch both.
fn defective(page: &Page, plane: &Drawn, b: Region) -> R<Region> {
    let zoom = num_of(plane.props.get("zoom"), Num::int(1));
    if page.rt().defect("boxes-in-pixels") {
        let scale = |p: Pt| -> R<Pt> { Ok(Pt { x: p.x.mul(zoom)?, y: p.y.mul(zoom)? }) };
        return Ok(Region { from: scale(b.from)?, to: scale(b.to)? });
    }
    if page.rt().defect("boxes-follow-the-view") {
        let c = pt_of(plane.props.get("center")).unwrap_or(Pt { x: Num::zero(), y: Num::zero() });
        let shift = |p: Pt| -> R<Pt> { Ok(Pt { x: p.x.sub(c.x)?, y: p.y.sub(c.y)? }) };
        return Ok(Region { from: shift(b.from)?, to: shift(b.to)? });
    }
    Ok(b)
}

fn token_num(page: &Page, v: &Value) -> R<Option<Value>> {
    match v {
        Value::Num(_) => Ok(Some(v.clone())),
        Value::Case(_) => page.token_value(v).map(Some),
        _ => Ok(None),
    }
}

impl Page {
    /// Lays the page's planes out until nothing changes: each pass's writes are one change. A
    /// page still changing after [`MAX_LAYOUT_PASSES`] passes is stopped, and is a failure of its
    /// planes, held until something outside the layout changes the page: a target that lays out
    /// again on every frame would otherwise run it for ever.
    pub fn layout(&mut self, measure: &mut dyn Measure) -> R<()> {
        if self.held_layout == Some(self.changes()) {
            return Ok(());
        }
        self.held_layout = None;
        for _ in 0..MAX_LAYOUT_PASSES {
            let mut started = std::mem::take(&mut self.started);
            let pass = (|| -> R<Option<Vec<LayoutWrite>>> {
                let all = planes(self.tree());
                if all.is_empty() {
                    return Ok(None);
                }
                let mut writes = Vec::new();
                for p in all {
                    writes.extend(plane_writes(self, p, measure, &mut started)?);
                }
                Ok(Some(writes))
            })();
            self.started = started;
            let Some(writes) = pass? else { return Ok(()) };
            if !self.layout_write(writes)? {
                return Ok(());
            }
        }
        let paths: Vec<String> = planes(self.tree()).iter().map(|p| p.path.clone()).collect();
        for p in paths {
            self.layout_failed(&p);
        }
        self.held_layout = Some(self.changes());
        Ok(())
    }
}
