widget sample() {
    view {
        @grid(cols = cols.EQUAL(count = 2), gap = space.S) {
            @cell(span = 2) {
                @label(value = "wide");
            }
            @label(value = "left");
            @sizing(grow = 1, min_width = size.XS) {
                @label(value = "right");
            }
        }
    }
}
@@@
@sample;
