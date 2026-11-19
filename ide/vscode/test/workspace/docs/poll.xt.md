import kit;

$state {
    yes: int 0... = 3;
    no: int 0... = 1;
    agree: bool = false;
}

fn share(a: int 0..., b: int 0...): int 0..100 {
    return a + b == 0 ? 0 : (a * 100 / (a + b)).round().clamp(0, 100);
}
@@@
# Should the team ship on Fridays?

\{share($state.yes, $state.no)}% say yes so far.

@tally(name = "Yes", count = $state.yes);

@tally(name = "No", count = $state.no, by = 1);

@press(label = "I have read the rules", kind = press_kind.CHECK, selected = $state.agree, click = fn() {
    $state.agree = !$state.agree;
});
