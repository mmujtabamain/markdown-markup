//@about A count the app can read and write.
$state {
    n: int 0..10 = 0;
}

//@about A count and a note of its own: the page keeps them, not the app.
widget tally(label: text) {
    mut k: int 0..10 = 0;
    mut note: text = "";

    view {
        @label(value = "\{label}: \{k}");
        @press(label = "More \{label}", click = fn() {
            k = (k + 1).clamp(0, 10);
        });
        @field(label = "Note on \{label}", value = note);
    }

    markdown {
        \{label}: \{k}
    }
}
@@@
# Notes: \{$state.n}

@tally(label = "Apples");

@overlay(label = "More") {
@slot anchor {
@label(value = "More");
}
@slot body {
@label(value = "Hidden until opened");
}
}
