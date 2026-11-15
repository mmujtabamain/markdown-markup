widget card(title: text) {
    slot body: view;
    view {
        @column {
            @label(value = title);
            @body;
        }
    }
    markdown {
        **\{title}**

        \{body}
    }
}
@@@
@card(title = "Deploys") {
We shipped **42** times.
}
