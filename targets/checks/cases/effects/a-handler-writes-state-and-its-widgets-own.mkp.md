$state {
    tries: int = 0;
}

widget retry(mut total: int) {
    mut open: bool = false;
    view {
        @press(label = "Retry", click = fn() {
            $state.tries = $state.tries + 1;
            open = !open;
            total = total + 1;
        });
    }
    markdown {
        Retry
    }
}
@@@
@retry(total = $state.tries);
