extern scores {
    fn saved(total: int 0..10);
}

$state {
    total: int 0..10 = 0;
}

// called from an action and from a handler, with values that fit
fn save() {
    scores.saved($state.total);
}

widget saver() {
    view {
        @press(label = "Save", click = fn() { scores.saved(3); save(); });
    }
}
@@@
@saver;
