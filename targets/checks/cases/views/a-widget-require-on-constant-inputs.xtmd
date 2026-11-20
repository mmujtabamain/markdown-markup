widget gauge(low: number, high: number) {
    require "the low end is below the high end" {
        return low < high;
    }
    view {
        @label(value = "\{low} to \{high}");
    }
}
@@@
@gauge(low = 1, high = 5);

@gauge(low = 9, high = 5);
