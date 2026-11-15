$state {
    low: number = 20;
    high: number = 80;

    require "the low end stays at or below the high end" {
        return low <= high;
    }
}
@@@
From \{$state.low} to \{$state.high}.
