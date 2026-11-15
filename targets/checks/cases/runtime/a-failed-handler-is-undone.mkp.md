$state {
    tries: int = 0;
    total: number = 10;
}

widget risky() {
    view {
        @press(label = "Split", click = fn() {
            $state.tries = $state.tries + 1;
            $state.total = $state.total / ($state.tries - 1);
        });
    }
    markdown {
        Tries: \{$state.tries}, total: \{$state.total}
    }
}
@@@
@risky;
