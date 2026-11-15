$state {
    open: bool = false;
}

widget sample() {
    view {
        @overlay(label = "More", open = $state.open) {
            anchor {
                @label(value = "More");
            }
            body {
                @label(value = "The rest");
            }
        }
    }
}
@@@
@sample;
