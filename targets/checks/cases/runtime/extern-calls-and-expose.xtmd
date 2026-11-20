extern scores {
    unit: text = "K";
    fn saved(total: int);
}

$state {
    points: int 0... = 0;
}

expose scores {
    fn clear() {
        $state.points = 0;
    }
}

widget tally(mut points: int) {
    fn add() {
        points = points + 1;
        scores.saved(points);
    }

    view {
        @press(label = "Add a point", click = add);
    }
    markdown {
        \{points} \{scores.unit}
    }
}
@@@
@tally(points = $state.points);
