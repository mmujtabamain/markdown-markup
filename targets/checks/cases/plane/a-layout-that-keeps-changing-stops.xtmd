$state {
    seen: opt<region> = opt.NONE;
}

widget map() {
    view {
        @plane(label = "Runaway", bounds = region { from = point { x = -1000, y = -1000 }, to = point { x = 1000, y = 1000 } }) {
            items {
                @spot(at = point { x = $state.seen.or(region { from = point { x = 0, y = 0 }, to = point { x = 0, y = 0 } }).to.x, y = 0 }, box = $state.seen) {
                    @label(value = "Run");
                }
            }
        }
    }
}
@@@
@map;
