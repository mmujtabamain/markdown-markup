//@about What the page tells the app.
extern app {
    unit: text = "points";
    fn saved(n: number);
}

//@about A count the app can read and write.
$state {
    n: int 0..10 = 0;
}
//@about What the app can do to the count.
expose app {
    fn reset() {
        $state.n = 0;
    }
}
@@@
# Count: \{$state.n} \{app.unit}

@press(label = "Add one", click = fn() {
    $state.n = ($state.n + 1).clamp(0, 10);
    app.saved($state.n);
});
