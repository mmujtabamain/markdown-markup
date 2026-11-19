$state {
    tries: number = 0;
}

fn reset() {
    $state.tries = 0;
}

fn shown(): text {
    reset();
    return "\{$state.tries}";
}
@@@
Shown.
