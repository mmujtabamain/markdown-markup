$state {
    count: int = 0;
}

//@about Buttons that change a number, and the number.
widget counter(by: int = 1) {
    fn add(n: int) {
        $state.count = $state.count + n;
    }

    view {
        @column(
            gap = space.S,
            pad = space.M,
            stroke = color.LINE,
            radius = radius.CARD,
        ) {
            @label(value = "Count", size = text_size.SMALL, tone = color.MUTED);
            @label(value = "\{$state.count}", size = text_size.LARGE);
            @row(gap = space.S) {
                @press(label = "Add \{by}", click = fn() { add(by); });
                @press(label = "Take \{by}", click = fn() { add(-by); });
                @press(
                    label = "Reset",
                    kind = press_kind.PLAIN,
                    disabled = $state.count == 0,
                    click = fn() { $state.count = 0; },
                );
            }
        }
    }

    markdown {
        Count: **\{$state.count}**
    }
}
@@@
# A counter

Press the buttons: the number, this page's Markdown and `$state` all change
together.

@counter;

Edit the source on the left. Try `@counter(by = 5);` below this line.
