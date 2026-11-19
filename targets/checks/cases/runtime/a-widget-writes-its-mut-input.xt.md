$state {
    level: int 0..10 = 5;
}
@@@
@slider(value = $state.level, label = "Level");
