import badge;

$state {
    count: int = 2;
}

widget tally() {
    view {
        @badge(label = "Votes", count = $state.count);
        @press(label = "Vote", click = fn() { $state.count = $state.count + 1; });
        @seal(text = "Checked by nobody");
    }
}
@@@
# Votes

@tally;
