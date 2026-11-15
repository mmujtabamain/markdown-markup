$state {
    presses: int = 0;
}

widget sample() {
    view {
        @press(label = "Pressed \{$state.presses} times", click = fn() { $state.presses = $state.presses + 1; });
        @press(label = "Bold", kind = press_kind.TOGGLE, selected = true);
        @press(label = "Off", disabled = true);
    }
}
@@@
@sample;
