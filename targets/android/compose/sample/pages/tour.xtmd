//@about A tour of core's widgets on Android: blocks, controls, layout, a canvas and a plane.
$state {
    name: text = "";
    level: int 0..10 = 4;
    dark: bool = false;
    size: text = "M";
    tasks: list<text> = ["Draw the page", "Run the checks"];
    done: int = 1;
    p: point = point { x = 0.4, y = 0.3 };
    open: bool = false;
    center: point = point { x = 0, y = 0 };
    zoom: number 0.1..10 = 1;
    note: opt<region> = opt.NONE;
}

fn glow(at: point, px: number, args: number): pixel {
    return pixel { r = at.x.clamp(0, 1), g = 0.4, b = at.y.clamp(0, 1), a = 1 };
}

//@about An overlay opened from a press, telling what the controls above hold.
widget details() {
    view {
        @overlay(label = "Details", open = $state.open) {
            anchor {
                @press(label = "Show the details", kind = press_kind.PLAIN);
            }
            body {
                @label(value = "Size \{$state.size}, level \{$state.level}, \{$state.done} of 2 done.");
            }
        }
    }
}

//@about A plane with two notes, which the reader pans and zooms.
widget board() {
    view {
        @plane(label = "Notes on a board", bounds = region { from = point { x = -300, y = -200 }, to = point { x = 300, y = 200 } }, center = $state.center, zoom = $state.zoom, zoom_range = 0.5..3, aspect = 1.5) {
            items {
                @spot(at = point { x = -50, y = 40 }, box = $state.note) {
                    @column(pad = space.M, stroke = color.LINE, radius = radius.CARD) {
                        @label(value = "Pinch to zoom, drag to pan");
                    }
                }
                @spot(at = point { x = 10, y = -60 }, anchor = anchor.SW) {
                    @label(value = "Another note", tone = color.MUTED);
                }
            }
        }
    }
}
@@@
# A tour of Extended Mark on Android

Every block here is a **Jetpack Compose** widget drawn by *xtmd-android*, from the same IR the web runs. Links like [the spec](https://example.com) are checked first, `code` is mono, and maths reads $e^{i\pi} + 1 = 0$.

- [x] Draw the page
- [ ] Run the checks on a phone

> A quote, set off as Material 3 sets one off.

```kotlin
@Composable fun XtmdPage(page: CompiledPage, externs: Externs = Externs.None)
```

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

| Widget | Compose | Material 3 |
|:--|:--:|--:|
| press | Button | yes |
| slider | Slider | yes |

---

## Controls

@field(value = $state.name, label = "Your name", placeholder = "Ada");

Hello, \{$state.name.len() > 0 ? $state.name : "stranger"}.

@slider(value = $state.level, label = "Level");

@row(gap = space.S, align = align.CENTER) {
    @press(label = "Dark", kind = press_kind.SWITCH, selected = $state.dark, click = fn() { $state.dark = !$state.dark; });
    @icon(name = glyph.STAR, tone = color.WARN, label = "a star");
    @press(label = "Done one more", click = fn() { $state.done = ($state.done + 1).clamp(0, 2); });
}

@row(gap = space.S) {
    @press(label = "S", kind = press_kind.RADIO, selected = $state.size == "S", click = fn() { $state.size = "S"; });
    @press(label = "M", kind = press_kind.RADIO, selected = $state.size == "M", click = fn() { $state.size = "M"; });
    @press(label = "L", kind = press_kind.RADIO, selected = $state.size == "L", click = fn() { $state.size = "L"; });
}

@details;

## Layout

@grid(cols = cols.EQUAL(count = 3), gap = space.S) {
    @cell(span = 3) {
        @label(value = "A grid of three columns", weight = weight.BOLD);
    }
    @label(value = "one");
    @label(value = "two");
    @label(value = "three");
}

## A canvas

@canvas(label = "A dot, a line and a point to drag", x = -1..1, y = -1..1, aspect = 1.5) {
    @layer {
        @shade(area = region { from = point { x = -1, y = -1 }, to = point { x = 1, y = 1 } }, shader = glow, args = 1, opacity = 0.25, label = "a glow");
        @path(points = [point { x = -1, y = 0 }, point { x = 1, y = 0 }], stroke = color.LINE, head = head.ARROW, label = "the axis");
        @circle(at = point { x = 0, y = 0 }, r = 0.15, fill = color.ACCENT, label = "the centre");
    }
    @layer {
        @handle(at = $state.p, label = "the point");
        @place(at = $state.p, anchor = anchor.SW, nudge = point { x = 8, y = 8 }) {
            @label(value = "drag me");
        }
    }
}

## A plane

@board;
