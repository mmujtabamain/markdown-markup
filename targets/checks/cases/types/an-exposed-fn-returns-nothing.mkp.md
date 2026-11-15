extern scores {
    fn saved(total: int);
}

$state {
    points: int 0... = 0;
}

expose scores {
    fn clear() {
        $state.points = 0;
        return 1;
    }
}
@@@
Points.
