$state {
    side: text = "left";
}

let chosen: text = $state.side;

record pick {
    side: text only ("left", "right");
    other: text only ("up", chosen);
}
@@@
Picks.
