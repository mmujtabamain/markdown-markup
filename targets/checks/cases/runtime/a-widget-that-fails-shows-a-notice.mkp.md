$state {
    parts: int 0... = 0;
}

widget share() {
    view {
        @label(value = "Each: \{100 / $state.parts}");
    }
    markdown {
        Each: \{100 / $state.parts}
    }
}
@@@
# Shares

@share;

After the shares.
