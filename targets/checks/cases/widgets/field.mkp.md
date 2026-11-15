$state {
    name: text = "Ada";
}

widget sample() {
    view {
        @field(value = $state.name, label = "Name", placeholder = "Your name");
        @label(value = "Hello, \{$state.name}");
    }
}
@@@
@sample;
