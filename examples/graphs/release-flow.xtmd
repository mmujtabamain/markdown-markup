import graphs;

//@about The steps of a release, as a graph the reader can move around.
$state {
    steps: list<node>[1...] = [
        node { id = "build", at = point { x = 0, y = 0 }, label = "Build" },
        node { id = "test", at = point { x = 200, y = 0 }, label = "Test" },
        node { id = "ship", at = point { x = 400, y = 0 }, label = "Ship" },
    ];
}
@@@
# Release flow

@graph(label = "From a commit to a release", nodes = $state.steps, edges = [
    link { from = "build", to = "test", label = "passes" },
    link { from = "test", to = "ship", label = "approved" },
]);
