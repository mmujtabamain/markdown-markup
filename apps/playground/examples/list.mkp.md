record task {
    title: text[1...];
    done: bool = false;
}

$state {
    tasks: list<task> = [
        task { title = "Write the page" },
        task { title = "Try it in the playground", done = true },
        task { title = "Ship it" },
    ];
    draft: text = "";
}

//@about One task: a box to tick.
widget task_row(mut t: task) {
    view {
        @press(
            label = t.title,
            kind = press_kind.CHECK,
            selected = t.done,
            click = fn() { t.done = !t.done; },
        );
    }

    markdown {
        @if (t.done) {
        - [x] \{t.title}
        } else {
        - [ ] \{t.title}
        }
    }
}

//@about Adds the draft as a task, and empties the draft.
fn add_draft() {
    if (let title: text[1...] = $state.draft.trim()) {
        $state.tasks.add(task { title = title });
    }
    $state.draft = "";
}

//@about The tasks, how many are done, and a field to add one.
widget board() {
    view {
        let done: int = $state.tasks.filter(fn(x) { return x.done; }).len();
        @column(
            gap = space.S,
            pad = space.M,
            stroke = color.LINE,
            radius = radius.CARD,
        ) {
            @label(
                value = "\{done} of \{$state.tasks.len()} done",
                size = text_size.SMALL,
                tone = color.MUTED,
            );
            mut for (t in $state.tasks) {
                if (mut x: task = t) {
                    @row(gap = space.S, align = align.CENTER, wrap = false) {
                        @grow {
                            @task_row(t = x);
                        }
                        @press(
                            label = "Drop",
                            kind = press_kind.PLAIN,
                            click = fn() { $state.tasks.remove(x); },
                        );
                    }
                }
            }
            @row(gap = space.S, align = align.END, wrap = false) {
                @grow {
                    @field(
                        value = $state.draft,
                        label = "New task",
                        placeholder = "What needs doing?",
                        submit = add_draft,
                    );
                }
                @press(
                    label = "Add",
                    disabled = $state.draft.trim() == "",
                    click = add_draft,
                );
            }
        }
    }

    markdown {
        @for (t in $state.tasks) {
        @if (t.done) {
        - [x] \{t.title}
        } else {
        - [ ] \{t.title}
        }
        }
    }
}
@@@
# A list with rows

Each row follows its task: tick one, drop one, or add one below.

@board;
