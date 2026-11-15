$state {
    level: number = 3;
}

widget sample() {
    view {
        @slider(value = $state.level, label = "Level", range = 0..10);
    }
}
@@@
@sample;
