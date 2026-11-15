//@about What the page tells the app.
extern app {
    unit: text = "points";
    fn saved(n: number);
}

//@about The same count, and a field the first version didn't have.
$state {
    n: int 0..10 = 0;
    stride: int 1..5 = 2;
}
//@about What the app can do to the count.
expose app {
    fn reset() {
        $state.n = 0;
    }
}
@@@
# Total: \{$state.n} \{app.unit}, by \{$state.stride}

@press(label = "Add one", click = fn() {
    $state.n = ($state.n + 1).clamp(0, 10);
    app.saved($state.n);
});
