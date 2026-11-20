$state {
    p: point = point { x = 0.5, y = 0.5 };
}

widget sample() {
    view {
        @canvas(label = "A dot and a line", x = -1..1, y = -1..1, aspect = 1) {
            @layer {
                @circle(at = point { x = 0, y = 0 }, r = 0.2, fill = color.ACCENT, label = "the centre");
                @path(points = [point { x = -1, y = 0 }, point { x = 1, y = 0 }], stroke = color.LINE, label = "the axis");
            }
            @layer(opacity = 0.8) {
                @handle(at = $state.p, label = "the point");
                @place(at = $state.p, anchor = anchor.SW) {
                    @label(value = "here");
                }
            }
        }
    }
}
@@@
@sample;
