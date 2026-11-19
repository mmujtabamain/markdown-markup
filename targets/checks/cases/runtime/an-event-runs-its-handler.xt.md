$state {
    count: int = 0;
}

widget counter() {
    view {
        @press(label = "Add one", click = fn() { $state.count = $state.count + 1; });
    }
    markdown {
        Count: \{$state.count}
    }
}
@@@
@counter;
