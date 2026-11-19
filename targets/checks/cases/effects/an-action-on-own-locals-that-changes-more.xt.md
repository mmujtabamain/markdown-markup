$state {
    count: number = 0;
}

fn push_one(mut xs: list<number>) {
    xs.add(1);
}

fn count_one() {
    $state.count = $state.count + 1;
}

fn push_and_count(mut xs: list<number>) {
    xs.add(1);
    count_one();
}

fn quiet(): number {
    mut xs: list<number> = [];
    push_one(xs);
    return xs.len();
}

fn loud(): number {
    mut xs: list<number> = [];
    push_and_count(xs);
    return xs.len();
}
@@@
Counts.
