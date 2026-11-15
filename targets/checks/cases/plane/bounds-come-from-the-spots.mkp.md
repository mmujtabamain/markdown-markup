$state {
    seen: opt<region> = opt.NONE;
}

widget map() {
    view {
        @plane(label = "Two places", aspect = 2, drawn = $state.seen) {
            items {
                @spot(at = point { x = 0, y = 0 }) {
                    @label(value = "A");
                }
                @spot(at = point { x = 100, y = 50 }, anchor = anchor.SW) {
                    @label(value = "Bee");
                }
            }
        }
    }
}
@@@
@map;
