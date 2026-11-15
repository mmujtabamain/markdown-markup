widget map() {
    view {
        @plane(label = "Map", bounds = region { from = point { x = 0, y = 0 }, to = point { x = 10, y = 10 } }) {
            items {
                @spot(at = point { x = 5, y = 5 }) {
                    @label(value = "in");
                }
                @spot(at = point { x = 20, y = 5 }) {
                    @label(value = "out");
                }
            }
        }
    }
}
@@@
@map;
