fn glow(at: point, px: number, args: number): pixel {
    return pixel { r = 0, g = 0, b = 0, a = 1 };
}

widget lit() {
    view {
        @canvas(label = "Glow") {
            @layer {
                @shade(area = region { from = point { x = 0, y = 0 }, to = point { x = 1, y = 1 } }, shader = glow, args = 1, label = "glow");
            }
        }
    }
}
@@@
@lit;
