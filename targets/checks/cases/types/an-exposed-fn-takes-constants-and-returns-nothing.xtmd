$state {
    points: int 0... = 0;
}

// the app calls an exposed fn with values of its own and reads nothing back
expose scores {
    fn add(mut n: int) {
        n = 3;
        $state.points = n.clamp(0, 100);
    }

    fn total(): int {
        return $state.points;
    }
}
@@@
Points.
