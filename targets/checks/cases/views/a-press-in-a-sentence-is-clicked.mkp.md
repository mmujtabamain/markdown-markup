$state {
    count: int = 0;
}
@@@
Press \{@press(label = "Add one", click = fn() { $state.count = $state.count + 1; })} and the count, \{$state.count}, goes up.
