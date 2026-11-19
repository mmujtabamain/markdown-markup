// the counter from the plan
$state {
    n: number = 0;
}
@@@
# Counter

The count is \{$state.n}.

@press(label = "Add", click = fn() { $state.n = $state.n + 1; });
