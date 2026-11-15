$state {
    center: point = point { x = 0, y = 0 };
    zoom: number 0.1..10 = 1;
    seen: opt<region> = opt.NONE;
    home: opt<region> = opt.NONE;
}

widget map() {
    view {
        @plane(label = "Map", bounds = region { from = point { x = -400, y = -300 }, to = point { x = 400, y = 300 } }, center = $state.center, zoom = $state.zoom, zoom_range = 1..4, aspect = 2, drawn = $state.seen) {
            items {
                @spot(at = point { x = 0, y = 0 }, box = $state.home) {
                    @label(value = "Home");
                }
            }
        }
    }
}
@@@
@map;
