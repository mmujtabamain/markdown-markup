widget sample() {
    view {
        @flex(axis = axis.X, gap = space.M, pad = space.S, label = "A row") {
            @label(value = "one");
            @label(value = "two");
        }
    }
}
@@@
@sample;
