$state {
    votes: int 0..1000 = 0;
}

// the count reaches the label through a row's slot: the row's own inputs never change
widget badge(count: int 0...) {
    view {
        @row(gap = space.S) {
            @label(value = "Votes");
            @label(value = "\{count}");
        }
    }
    markdown {
        Votes: \{count}
    }
}

widget vote() {
    view {
        @press(label = "Vote", click = fn() { $state.votes = ($state.votes + 1).clamp(0, 1000); });
    }
    markdown {
        Vote.
    }
}
@@@
@badge(count = $state.votes);

@vote;
