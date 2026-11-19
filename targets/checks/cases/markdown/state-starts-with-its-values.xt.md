$state {
    tries: int = 2;
}
@@@
Tries: \{$state.tries}

@if ($state.tries > 1) {
Many tries.
} else {
Few tries.
}
