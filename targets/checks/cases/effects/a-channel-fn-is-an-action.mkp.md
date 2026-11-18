extern scores {
    fn saved(total: int);
}

// a channel's fn with no return type is an action sent to the app: never called where nothing
// changes, directly or through a fn that calls it
fn loud(): number {
    scores.saved(1);
    return 1;
}

fn push_and_save(mut xs: list<number>) {
    xs.add(1);
    scores.saved(1);
}

fn quiet(): number {
    mut xs: list<number> = [];
    push_and_save(xs);
    return xs.len();
}
@@@
Counts.
