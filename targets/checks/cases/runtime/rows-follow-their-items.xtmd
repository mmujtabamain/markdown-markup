record task {
    title: text;
}

$state {
    tasks: list<task> = [task { title = "write" }, task { title = "test" }, task { title = "ship" }];
}

widget row(t: task) {
    mut votes: int = 0;
    view {
        @press(label = "\{t.title}: \{votes}", click = fn() { votes = votes + 1; });
    }
    markdown {
        \{t.title}: \{votes}
    }
}

widget board() {
    view {
        mut for (t in $state.tasks) {
            if (mut x: task = t) {
                @row(t = x);
                @press(label = "Drop \{x.title}", click = fn() { $state.tasks.remove(x); });
            }
        }
    }
    markdown {
        @for (t in $state.tasks) {
        - \{t.title}
        }
    }
}
@@@
@board;
