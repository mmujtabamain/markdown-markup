$state {
    level: int 0..10 = 4;
    limit: int 0..10 = 7;

    require "the level stays at or below the limit" {
        return level <= limit;
    }
}

//@about Two sliders, held together by a rule on $state.
widget mixer() {
    view {
        let full: bool = $state.level == $state.limit;
        @column(
            gap = space.M,
            pad = space.M,
            stroke = color.LINE,
            radius = radius.CARD,
        ) {
            @slider(value = $state.level, label = "Level");
            @slider(value = $state.limit, label = "Limit");
            @meter(
                value = $state.level,
                max = 10,
                label = "Level",
                tone = full ? color.WARN : color.OK,
            );
            @label(
                value = "Level \{$state.level} of a limit of \{$state.limit}",
                size = text_size.SMALL,
                tone = color.MUTED,
            );
        }
    }

    markdown {
        Level **\{$state.level}**, limit **\{$state.limit}**
    }
}
@@@
# A slider with a rule

`$state` says the level stays at or below the limit. Drag the level past the
limit, or set it higher in the `$state` tab: the write is refused, and the rule
says why.

@mixer;
