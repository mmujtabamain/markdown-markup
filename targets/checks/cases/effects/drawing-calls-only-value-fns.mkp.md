$state {
    tries: number = 0;
}

fn reset() {
    $state.tries = 0;
}

fn tries_left(): number {
    reset();
    return 3;
}
@@@
Tries.
