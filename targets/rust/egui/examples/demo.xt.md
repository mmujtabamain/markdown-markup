$state {
    name: text = "Ada";
    level: int 0..10 = 5;
    done: bool = false;
    open: bool = false;
}

widget demo() {
    view {
        @label(value = "Hello, \{$state.name}", size = text_size.LARGE, weight = weight.BOLD);
        @field(value = $state.name, label = "Name", placeholder = "Your name");
        @slider(value = $state.level, label = "Level");
        @press(label = "Done", kind = press_kind.CHECK, selected = $state.done, click = fn() { $state.done = !$state.done; });
        @overlay(label = "More", open = $state.open) {
            anchor {
                @label(value = "More");
            }
            body {
                @label(value = "Drawn over the page, from its anchor.");
            }
        }
        @plane(label = "A board", width = size.L, aspect = 2, zoom_range = 1..4) {
            items {
                @spot(at = point { x = -80, y = 20 }) {
                    @label(value = "Build");
                }
                @spot(at = point { x = 80, y = -20 }) {
                    @label(value = "Ship");
                }
            }
        }
    }
}
@@@
# xtmd-egui

A page drawn with **egui**: its widgets read the props the runtime worked out, and write through
checked writes. The plane pans with a drag and zooms with the wheel.

@demo;

Maths shows as its TeX on egui:

$$
x^2 + y^2 = r^2
$$
