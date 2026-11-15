fn glow(at: point, px: number, args: number): pixel {
    return pixel { r = at.x.clamp(0, 1), g = 0, b = at.y.clamp(0, 1), a = 1 };
}

widget sample() {
    view {
        @canvas(label = "A gradient", x = 0..1, y = 0..1, aspect = 1) {
            @layer {
                @shade(area = region { from = point { x = 0, y = 0 }, to = point { x = 1, y = 1 } }, shader = glow, args = 1, label = "red across, blue up");
            }
        }
    }
}
@@@
@sample;
